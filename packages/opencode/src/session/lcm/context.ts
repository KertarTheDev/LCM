// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { Context, Effect, Layer, Schema } from "effect"
import { readAndValidateLcmArtifact, renderLargeFileMarker } from "./artifacts"
import { LcmDb } from "./db"
import { resolveLcmDbLayout } from "./db-layout"
import { namespacedHash, stableHash } from "./hash"
import { createOperationID } from "./id"
import { RUNTIME_DEFAULTS } from "./config"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID } from "../schema"
import type { ModelID, ProviderID } from "../../provider/schema"
import {
  attachLcmRenderOriginToMessage,
  prepareKiloModelInput,
  type LcmPreparedRenderInput,
  type PrepareKiloModelInput,
} from "./render-prep"
import { renderRetrievalCueModelText } from "./retrieval"
import { LCM_PROVIDER_VALIDATOR_NAMESPACE, classifyLcmProviderFamily } from "./provider-protocol"
import { isLcmProviderCapacityDeferredError } from "./provider-capacity"
import {
  allocateContextItemID,
  allocateSnapshotID,
  allocateSummaryID,
  allocateSummaryLineagePointerID,
  allocateUsageRecordID,
} from "./id-allocation"
import {
  failIfOperationCanceled,
  operationCanceled,
  operationTimeout,
  throwIfOperationCanceled,
} from "./operation-control"
import {
  clampProviderTransformOverhead,
  loadProviderTransformOverheadReserve,
  providerInputLimitWithTransformReserve,
} from "./provider-overhead"
import {
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
  LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
  computeSummaryGenerationMaxOutputTokens,
  renderSummaryWrapper,
  renderArchiveStubWrapper,
  isLcmSummaryObjectiveFailedError,
  runCondenseSummaryGeneration,
  runLeafSummaryGeneration,
  summaryTinyTokenFloor,
  type LcmCondenseSummarySourceItem,
  type LcmLeafSummaryGenerator,
  type LcmLeafSummarySourceItem,
  type LcmSummaryAttemptEvidence,
  type LcmSummaryCondenseGenerator,
} from "./summary"
import {
  isCompleteBoundaryMetadataV1,
  validateArtifactPath,
  validateBoundaryMetadataV1,
  validateContextItemReference,
} from "./validators"
import { parseLcmSafeError } from "./safe-error-schema"
import {
  createLcmSafeError,
  type ContextItem,
  type ContextItemID,
  type ContextItemType,
  type ConversationID,
  type LcmAssemblyInput,
  type LcmAssemblyResult,
  type LcmFileID,
  type LcmLifecycleState,
  type LcmHardLimitInput,
  type LcmLeafCompactionInput,
  type LcmMaintenanceResult,
  type LcmPreparedProviderPayload,
  type LcmProtectedCurrentUserInput,
  type LcmProviderRequestSnapshotTerminalStatus,
  type LcmRecoveryResult,
  type LcmRenderedSpan,
  type LcmRenderedSpanProtectedReason,
  type LcmRenderedSpanProviderFamily,
  type LcmRenderInputManifestV1,
  type LcmRetrievalCueLifecycleState,
  type LcmRetrievalCuePayload,
  type LcmSafeError,
  type LcmSummaryFallbackMode,
  type LcmSummaryObjectiveStatus,
  type LcmSummaryReasoningPolicy,
  type LcmStrategy,
  type LcmThresholdDecision,
  type LcmThresholdInput,
  type LcmTokenCounterMode,
  type LcmUsageMode,
  type LcmValidatedModelMessages,
  type MessageRowID,
  type OperationID,
  type SessionID,
  type SummaryID,
} from "./types"
import {
  LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
  LCM_TOKEN_BUDGET_CACHE_VERSION,
  computeTokenBudget,
  computeThresholdDecision,
  createDeterministicFallbackTokenCounter,
  createTokenCacheKey,
  deterministicFallbackTokenCount,
  renderManifestHash,
  stableTokenText,
  type LcmLaneSourceItem,
  type LcmTokenCounter,
} from "./token-budget"
import type { LcmRuntimePreparedProviderPayload } from "./provider-payload"

// Maintainer boundary: this service owns derived context state. Keep provider
// snapshot lifecycle, hard-limit convergence, retrieval cue placement, and raw
// leaf rendering changes covered by the focused LCM suites before moving code
// across this boundary.
export interface Interface {
  readonly runtimeDbBinding?: "lcm_context_layer"
  readonly getCurrentContext: (input: {
    conversationID: string
    abortSignal?: AbortSignal
  }) => Effect.Effect<ContextItem[], LcmSafeError>
  readonly rebuildActiveContext: (input: {
    conversationID: string
    reason: string
    strategy?: LcmStrategy
    abortSignal?: AbortSignal
  }) => Effect.Effect<LcmRecoveryResult, LcmSafeError>
  readonly replaceRetrievalCues: (input: {
    conversationID: string
    targetCurrentUserSourceMessageID: string
    cuePayloads: readonly LcmRetrievalCuePayload[]
    abortSignal?: AbortSignal
    nowMs?: number
  }) => Effect.Effect<{ insertedCues: number }, LcmSafeError>
  readonly finalizeProviderRequestSnapshot: (input: {
    requestSnapshotID: string
    status: LcmProviderRequestSnapshotTerminalStatus
    conversationID?: ConversationID
    nowMs?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly recordProviderRequestSnapshotFinalValidation: (input: {
    requestSnapshotID: string
    providerValidatorHash: string
    providerFamily?: LcmRenderedSpanProviderFamily
    providerTransformOverheadTokenCount?: number
    conversationID?: ConversationID
  }) => Effect.Effect<void, LcmSafeError>
  readonly assembleModelMessages: (
    input: LcmAssemblyInput & { readonly abortSignal?: AbortSignal },
  ) => Effect.Effect<LcmAssemblyResult, LcmSafeError>
  readonly isOverThreshold: (input: LcmThresholdRuntimeInput) => Effect.Effect<LcmThresholdDecision, LcmSafeError>
  readonly compactLeavesToSprig: (
    input: LcmLeafCompactionRuntimeInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly compactUntilUnderHardLimit: (
    input: LcmHardLimitRuntimeInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LcmContext") {}

export const LCM_CONTEXT_RESTORE_MANIFEST_VERSION = "lcm-context-restore-manifest-v2"
export const LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION = LCM_CONTEXT_RESTORE_MANIFEST_VERSION
export const LCM_CONTEXT_SHELL_TOKEN_COUNTER_MODE = "fake" satisfies LcmTokenCounterMode
export const LCM_CONTEXT_SHELL_TOKEN_COUNTER_VERSION = "lcm-context-shell-fake-token-counter-v1"
export const LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE = "deterministic_fallback" satisfies LcmTokenCounterMode
export const LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION = LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION
const LCM_PROVIDER_VALIDATOR_PENDING_M39 = "lcm-provider-validator-pending-m39-v1"
const LCM_PROVIDER_REQUEST_SNAPSHOT_TTL_MS = 30 * 60 * 1000
const softSkipFingerprints = new Map<ConversationID, string>()

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

interface Transactional extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>
}

interface ConversationRow {
  conversation_id: ConversationID
  lifecycle_state: string
  strategy?: LcmStrategy | null
  boundary_metadata_json: unknown
}

interface ContextRow {
  context_item_id: ContextItemID
  conversation_id: ConversationID
  item_order: number | string | bigint
  item_type: ContextItemType
  message_row_id: MessageRowID | null
  summary_id: SummaryID | null
  pointer_id: string | null
  file_id: LcmFileID | null
  cue_id?: string | null
  cue_payload_json: unknown | null
  cue_lifecycle_state?: LcmRetrievalCueLifecycleState | null
  cue_superseded_by_id?: string | null
  cue_superseded_by_generation_id?: string | null
  cue_target_source_message_id?: string | null
  cue_generation_id?: string | null
  token_count: number | string | bigint | null
  cache_key: string | null
  cache_version: number | string | bigint | null
  created_at_ms: number | string | bigint
  updated_at_ms: number | string | bigint
}

interface ProviderRequestSnapshotRow {
  request_snapshot_id: string
  operation_id: string
  conversation_id: ConversationID
  source_session_id: string
  provider_id: string
  model_id: string
  status: "in_flight" | "resolved" | "canceled" | "expired"
  cue_ids_json: unknown
  render_unit_ids_json: unknown
  source_selection_hash: string
  request_snapshot_protection_hash: string
  visibility_hash: string
  protected_span_hash: string
  provider_transform_hash: string
  provider_validator_hash: string | null
  created_at_ms: number | string | bigint
  expires_at_ms: number | string | bigint
  terminal_at_ms: number | string | bigint | null
}

interface SnapshotRow {
  snapshot_id: string
  conversation_id: ConversationID
  created_at_ms: number | string | bigint
  strategy: LcmStrategy
  active_tokens: number | string | bigint
  hard_limit: number | string | bigint
  soft_threshold: number | string | bigint
  soft_backlog_tokens?: number | string | bigint | null
  soft_backlog_item_count?: number | string | bigint | null
  context_item_count: number | string | bigint
  token_counter_mode: LcmTokenCounterMode
  token_counter_version: string
  metrics_json: unknown
  restore_manifest_json: unknown
}

interface FileRow {
  file_id: LcmFileID
  conversation_id: ConversationID
  source_kind: string
  boundary_metadata_json: unknown
  artifact_storage_kind: "none" | "file"
  artifact_path: string | null
  artifact_byte_count: number | string | bigint
  artifact_content_sha256: string | null
}

interface SourceMessageRow {
  message_row_id: MessageRowID
  conversation_id: ConversationID
  source_session_id: string
  source_message_id: string
  role: string
  message_order: number | string | bigint
  created_at_ms: number | string | bigint
  completed_at_ms: number | string | bigint | null
  provider_id: string | null
  model_id: string | null
  agent_name: string | null
  metadata_json: unknown
  ignored: boolean
  synthetic: boolean
  compatibility: boolean
  source_version: number | string | bigint
}

interface SourcePartRow {
  part_row_id: string
  message_row_id: MessageRowID
  conversation_id: ConversationID
  source_part_id: string | null
  source_part_key: string
  part_order: number | string | bigint
  part_kind: string
  ignored: boolean
  synthetic: boolean
  compatibility: boolean
  terminal_state: string | null
  text_content: string | null
  reasoning_content: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_input_json: unknown | null
  tool_output_text: string | null
  tool_error_text: string | null
  file_url: string | null
  media_mime: string | null
  media_name: string | null
  provider_metadata_json: unknown
  render_metadata_json: unknown
  content_storage_kind: string
  content_file_id: string | null
  content_byte_count: number | string | bigint | null
  content_sha256: string | null
  search_text: string
  created_at_ms: number | string | bigint
  completed_at_ms: number | string | bigint | null
}

const RAW_LEAF_MESSAGE_ROLES = ["user", "assistant"] as const
const RAW_LEAF_PART_KINDS = [
  "text",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
  "subtask",
] as const
const RAW_LEAF_TERMINAL_TOOL_STATES = ["completed", "error"] as const
const RAW_LEAF_FILE_SOURCE_KINDS = ["file", "symbol", "resource"] as const

export type LcmRawLeafRenderPreparationInput = Omit<PrepareKiloModelInput, "messages" | "lastUser"> & {
  readonly lastUser?: MessageV2.User
  readonly lastUserMessageID?: string
}

export interface LcmRawLeafAssemblyInput extends LcmAssemblyInput {
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly threshold?: LcmThresholdDecision
  readonly abortSignal?: AbortSignal
}

export interface LcmThresholdRuntimeInput extends LcmThresholdInput {
  readonly recordSnapshot?: boolean
  readonly abortSignal?: AbortSignal
}

export interface LcmRawLeafThresholdInput extends LcmThresholdRuntimeInput {
  readonly renderPreparation?: LcmRawLeafRenderPreparationInput
  readonly tokenCounter?: LcmTokenCounter
  readonly explicitOutputReserve?: number
  readonly providerOutputReserve?: number
  readonly systemPromptText?: string
  readonly toolSchemaText?: string
}

export interface LcmLeafCompactionRuntimeInput extends LcmLeafCompactionInput {
  readonly sessionID?: SessionID
  readonly operationID?: OperationID
  readonly providerID?: string
  readonly modelID?: string
  readonly tokenCounter?: LcmTokenCounter
  readonly generator?: LcmLeafSummaryGenerator
  readonly protectedMessageRowIDs?: readonly MessageRowID[]
  readonly protectedCurrentUser?: LcmProtectedCurrentUserInput
  readonly maxAttempts?: number
  readonly retrySummaryReasoningPolicy?: LcmSummaryReasoningPolicy
  readonly softThreshold?: number
  readonly abortSignal?: AbortSignal
  readonly nowMs?: number
}

export type LcmHardLimitProgressPhase = "leaf_summary" | "condensation" | "aggressive_condensation" | "archive_stub"

export interface LcmHardLimitProgress {
  readonly phase: LcmHardLimitProgressPhase
  readonly round: number
  readonly lane?: "sprigs" | "bindles"
}

export interface LcmHardLimitRuntimeInput extends LcmHardLimitInput {
  readonly operationID?: OperationID
  readonly providerContextLimit?: number
  readonly providerInputLimit?: number
  readonly providerOutputLimit?: number
  readonly renderPreparation?: LcmRawLeafRenderPreparationInput
  readonly tokenCounter?: LcmTokenCounter
  readonly leafGenerator?: LcmLeafSummaryGenerator
  readonly condenseGenerator?: LcmSummaryCondenseGenerator
  readonly maxAttempts?: number
  readonly retrySummaryReasoningPolicy?: LcmSummaryReasoningPolicy
  readonly maxElapsedMs?: number
  readonly elapsedNowMs?: () => number
  readonly abortSignal?: AbortSignal
  readonly onProgress?: (progress: LcmHardLimitProgress) => Effect.Effect<void>
  readonly nowMs?: number
}

type SummaryCondensePromptVersion =
  | typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION
  | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION

interface RestoreManifestBaseItem {
  contextItemID: ContextItemID
  conversationID: ConversationID
  itemOrder: number
  itemType: ContextItemType
  tokenCount?: number
  cacheKey?: string
  cacheVersion?: number
  createdAtMs: number
  updatedAtMs: number
}

type LcmContextRestoreManifestItem =
  | (RestoreManifestBaseItem & { itemType: "raw_message"; messageRowID: MessageRowID })
  | (RestoreManifestBaseItem & { itemType: "summary"; summaryID: SummaryID })
  | (RestoreManifestBaseItem & { itemType: "archive_stub"; summaryID: SummaryID; pointerID: string })
  | (RestoreManifestBaseItem & { itemType: "large_file_marker"; fileID: LcmFileID })
  | (RestoreManifestBaseItem & {
      itemType: "retrieval_cue"
      cueID: string
      cuePayload: LcmRetrievalCuePayload
      cueLifecycleState?: LcmRetrievalCueLifecycleState
      cueTargetSourceMessageID?: string
      cueGenerationID?: string
      cueSupersededByID?: string
      cueSupersededByGenerationID?: string
    })

interface LcmContextRestoreManifestBase {
  snapshotID: string
  conversationID: ConversationID
  createdAtMs: number
  strategy: LcmStrategy
  activeTokens: number
  hardLimit: number
  softThreshold: number
  freshTailTokens: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  contextItemCount: number
  tokenCounterMode: LcmTokenCounterMode
  tokenCounterVersion: string
}

type LcmContextRestoreManifestItemV2 = LcmContextRestoreManifestItem & {
  renderUnitID: string
  canonicalOrder: number
  effectiveOrder: number
  placementSlot: LcmAssemblyPlacementSlot
}

interface LcmContextRestoreManifestV2 extends LcmContextRestoreManifestBase {
  schemaVersion: typeof LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION
  softBacklogTokens: number
  softBacklogItemCount: number
  renderUnitOrderHash: string
  effectivePlacementHash: string
  sourceSelectionHash: string
  requestSnapshotProtectionHash: string
  visibilityHash: string
  protectedSpanHash: string
  providerTransformHash: string
  providerValidatorHash: string
  assemblyValidatorHash: string
  items: LcmContextRestoreManifestItemV2[]
}

type LcmContextRestoreManifest = LcmContextRestoreManifestV2

interface ValidationResult {
  ok: boolean
  reason?: string
  rows?: ContextRow[]
  items?: ContextItem[]
}

interface ContextCandidate {
  itemType: ContextItemType
  originalOrder: number
  createdAtMs: number
  stableID: string
  messageRowID?: MessageRowID
  summaryID?: SummaryID
  pointerID?: string
  fileID?: LcmFileID
  cuePayload?: LcmRetrievalCuePayload
}

interface ThresholdContextItemCount {
  readonly row: ContextRow
  readonly tokenCount: number
  readonly cacheKey: string
  readonly lane: LcmLaneSourceItem
}

interface ProviderSafeSnapshotItem {
  readonly contextItemID: ContextItemID
  readonly renderUnitID: string
  readonly canonicalOrder: number
  readonly effectiveOrder: number
  readonly placementSlot: LcmAssemblyPlacementSlot
}

interface ProviderSafeSnapshotEvidence {
  readonly renderInputManifest: LcmRenderInputManifestV1
  readonly items: ReadonlyMap<ContextItemID, ProviderSafeSnapshotItem>
  readonly providerTransformOverheadTokenCount?: number
}

interface ThresholdAssemblyCache {
  readonly conversationID: ConversationID
  readonly lifecycleState: LcmLifecycleState
  readonly contextItems: readonly ContextItem[]
  readonly targetCurrentUserHash: string
  readonly renderOptionsHash: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly prepared: LcmPreparedRenderInput
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly renderInputManifest: LcmRenderInputManifestV1
  readonly activeTokens: number
  readonly providerSafe: ProviderSafeSnapshotEvidence
}

const thresholdAssemblyCache = new WeakMap<LcmThresholdDecision, ThresholdAssemblyCache>()

interface SummaryMetadata {
  readonly summaryType: LcmLaneSourceItem["summaryType"]
  readonly summaryLevel: number
  readonly text: string
  readonly promptVersion: string
  readonly objectiveStatus: LcmSummaryObjectiveStatus
  readonly fallbackMode: LcmSummaryFallbackMode
  readonly sourceTokenCount: number
  readonly summaryTokenCount: number
  readonly parentSummaryIDs: SummaryID[]
  readonly coveredMessageRowIDs: ReadonlySet<MessageRowID>
  readonly coveredSourceChronology: number
}

type LcmAssemblyPlacementSlot = LcmRenderedSpan["placementSlot"]

type LcmRenderUnitSource =
  | {
      kind: "raw_message"
      contextItemID: ContextItemID
      messageRowID: MessageRowID
      sourceVersion: number
    }
  | {
      kind: "summary"
      contextItemID: ContextItemID
      summaryID: SummaryID
    }
  | {
      kind: "archive_stub"
      contextItemID: ContextItemID
      summaryID: SummaryID
      pointerID: string
    }
  | {
      kind: "large_file_marker"
      contextItemID: ContextItemID
      fileID: LcmFileID
    }
  | {
      kind: "retrieval_cue"
      contextItemID: ContextItemID
      cueID: string
      cueLifecycleState: "active" | "superseded" | "tombstoned"
      cueTargetSourceMessageID: string
      cueGenerationID: string
      placementSlot: "before_current_user"
    }
  | {
      kind: "target_current_user"
      sourceSessionID: SessionID
      sourceMessageID: string
      messageRowID?: MessageRowID
      promptOperationID: OperationID
      visibilityBaseMessageID: string
      sourceChronologicalOrder: number
    }

interface LcmRenderUnit {
  readonly renderUnitID: string
  readonly conversationID: ConversationID
  readonly source: LcmRenderUnitSource
  readonly sourceKind: LcmRenderedSpan["sourceKind"]
  readonly sourceHandle?: string
  readonly provenanceHandles: readonly string[]
  readonly canonicalOrder: number
  readonly effectiveOrder: number
  readonly placementSlot: LcmAssemblyPlacementSlot
  readonly requiredVisibilityHash?: string
  readonly requiredForContinuation: boolean
  readonly protocolGroupID?: string
  readonly message: MessageV2.WithParts
}

interface RawLeafMessageEntry {
  readonly item: Extract<ContextItem, { itemType: "raw_message" }>
  readonly sourceRow: SourceMessageRow
  readonly partRows: readonly SourcePartRow[]
  readonly message: MessageV2.WithParts
}

interface LcmVisibilityProvenance {
  readonly hiddenContextItemIDs: ReadonlySet<ContextItemID>
  readonly missingContextItemIDs: ReadonlySet<ContextItemID>
}

function pending(diagnosticCode: string) {
  return createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: false },
    retryable: false,
    diagnosticCode,
  })
}

function invalidRequest(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

function tokenBudgetDiagnostic(error: unknown) {
  return error instanceof Error && error.name === "LcmTokenBudgetError" ? error.message : "lcm_token_budget_failed"
}

function recoveryRequired(diagnosticCode: string, conversationID: ConversationID): LcmSafeError {
  return createLcmSafeError({
    code: "recovery_required",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      conversationID,
      action: "retry",
    },
    retryable: true,
    diagnosticCode,
  })
}

function missingSource(diagnosticCode: string, conversationID: ConversationID): LcmSafeError {
  return createLcmSafeError({
    code: "missing_source",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      conversationID,
      action: "repeat_input",
    },
    retryable: false,
    diagnosticCode,
  })
}

function hardLimitUnresolved(input: {
  diagnosticCode: string
  operationID?: OperationID
  conversationID: ConversationID
  beforeTokens?: number
  hardLimit?: number
}): LcmSafeError {
  return createLcmSafeError({
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: {
      operationID: input.operationID,
      conversationID: input.conversationID,
      beforeTokens: input.beforeTokens,
      hardLimit: input.hardLimit,
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode: input.diagnosticCode,
  })
}

function staleFile(diagnosticCode: string, fileID: LcmFileID): LcmSafeError {
  return createLcmSafeError({
    code: "stale_source",
    templateKey: "lcm.file.stale",
    safeParams: {
      fileID,
      staleState: "artifact_missing",
      action: "re_register_file",
    },
    retryable: false,
    diagnosticCode,
  })
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function lcmSafeError(value: unknown): LcmSafeError | undefined {
  return parseLcmSafeError(value)
}

function asNumber(value: number | string | bigint | null | undefined) {
  return Number(value ?? 0)
}

function optionalNumber(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined) return undefined
  return Number(value)
}

function hasRawLeafRenderPreparation(input: LcmAssemblyInput): input is LcmRawLeafAssemblyInput {
  return isObject((input as { renderPreparation?: unknown }).renderPreparation)
}

function hasRawLeafThresholdPreparation(input: LcmThresholdInput): input is LcmRawLeafThresholdInput {
  return isObject((input as { renderPreparation?: unknown }).renderPreparation)
}

const PROVIDER_SAFE_MANIFEST_FIELDS = [
  "sourceSelectionHash",
  "requestSnapshotProtectionHash",
  "renderUnitOrderHash",
  "effectivePlacementHash",
  "protectedSpanHash",
  "providerTransformHash",
  "providerValidatorHash",
  "assemblyValidatorHash",
  "messageVisibilityHash",
] as const satisfies readonly (keyof LcmRenderInputManifestV1)[]

const RENDER_OPTION_HASH_ALIASES = [
  "rendererVersion",
  "renderPreparationVersion",
  "sourceSelectionHash",
  "requestSnapshotProtectionHash",
  "renderUnitOrderHash",
  "effectivePlacementHash",
  "protectedSpanHash",
  "providerTransformHash",
  "providerValidatorHash",
  "assemblyValidatorHash",
  "systemPromptVersion",
  "systemPromptHash",
  "toolSchemaVersion",
  "toolSchemaHash",
  "pluginTransformVersion",
  "pluginTransformHash",
  "dynamicPromptVersion",
  "dynamicPromptHash",
  "messageVisibilityVersion",
  "messageVisibilityHash",
] as const satisfies readonly (keyof LcmRenderInputManifestV1)[]

function validateProviderSafeManifestFields(manifest: LcmRenderInputManifestV1) {
  for (const field of PROVIDER_SAFE_MANIFEST_FIELDS) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      return `lcm_provider_safe_manifest_missing_${field}`
    }
  }
  return undefined
}

function validateRenderOptionAliases(input: {
  readonly renderOptions: LcmAssemblyInput["renderOptions"]
  readonly manifest: LcmRenderInputManifestV1
}) {
  for (const field of RENDER_OPTION_HASH_ALIASES) {
    const alias = input.renderOptions[field]
    if (alias !== undefined && alias !== input.manifest[field]) return `lcm_render_options_alias_mismatch_${field}`
  }
  return validateProviderSafeManifestFields(input.manifest)
}

function providerSafeIdentityFromManifest(manifest: LcmRenderInputManifestV1) {
  return {
    renderUnitOrderHash: manifest.renderUnitOrderHash,
    effectivePlacementHash: manifest.effectivePlacementHash,
    sourceSelectionHash: manifest.sourceSelectionHash,
    requestSnapshotProtectionHash: manifest.requestSnapshotProtectionHash,
    visibilityHash: manifest.messageVisibilityHash,
    protectedSpanHash: manifest.protectedSpanHash,
    providerTransformHash: manifest.providerTransformHash,
    providerValidatorHash: manifest.providerValidatorHash,
    assemblyValidatorHash: manifest.assemblyValidatorHash,
  }
}

function lcmSyntheticMessageID(seed: string) {
  return MessageID.make(`msg_lcm_${stableHash(seed).slice(0, 32)}`)
}

function lcmSyntheticPartID(seed: string) {
  return PartID.make(`prt_lcm_${stableHash(seed).slice(0, 32)}`)
}

function renderUnitSourceHandle(source: LcmRenderUnitSource) {
  if (source.kind === "raw_message") return source.messageRowID
  if (source.kind === "summary") return source.summaryID
  if (source.kind === "archive_stub") return `${source.summaryID}:${source.pointerID}`
  if (source.kind === "large_file_marker") return source.fileID
  if (source.kind === "retrieval_cue") return source.cueID
  return source.messageRowID ?? `${source.sourceSessionID}:${source.sourceMessageID}`
}

function renderUnitID(input: {
  readonly conversationID: ConversationID
  readonly source: LcmRenderUnitSource
  readonly sourceHandle?: string
  readonly provenanceHandles: readonly string[]
}) {
  return namespacedHash("lcm-render-unit-v1", input)
}

function providerTransformOverheadRenderUnitID(input: {
  readonly providerID: string
  readonly modelID: string
  readonly transformStage: string
  readonly index: number
  readonly reason: string
}) {
  return namespacedHash("lcm-provider-transform-overhead-v1", input)
}

export function createProviderTransformOverheadRenderUnitID(input: {
  readonly providerID: string
  readonly modelID: string
  readonly transformStage: string
  readonly index: number
  readonly reason: string
}) {
  return providerTransformOverheadRenderUnitID(input)
}

function renderedSpanHash(span: Omit<LcmRenderedSpan, "spanHash">, providerTransformHash: string) {
  return namespacedHash("lcm-rendered-span-v1", {
    renderUnitID: span.renderUnitID,
    sourceKind: span.sourceKind,
    sourceHandle: span.sourceHandle,
    canonicalOrder: span.canonicalOrder,
    effectiveOrder: span.effectiveOrder,
    placementSlot: span.placementSlot,
    startIndex: span.startIndex,
    messageCount: span.messageCount,
    protected: span.protected,
    protectedReason: span.protected ? span.protectedReason : undefined,
    protocolSpanID: span.protected ? span.protocolSpanID : undefined,
    providerFamily: span.providerFamily,
    transformStage: span.transformStage,
    providerTransformHash: providerTransformHash || "none",
  })
}

function protocolSpanID(input: {
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly protocolGroupKind: string
  readonly protocolGroupID: string
  readonly contributingRenderUnitIDs: readonly string[]
  readonly startIndex: number
  readonly messageCount: number
  readonly transformStage: string
}) {
  return namespacedHash("lcm-protocol-span-v1", input)
}

function sourcePartProvenance(row: SourcePartRow) {
  return {
    partRowID: row.part_row_id,
    sourcePartID: row.source_part_id,
    sourcePartKey: row.source_part_key,
    partKind: row.part_kind,
    contentSHA256: row.content_sha256,
    contentStorageKind: row.content_storage_kind,
    contentFileID: row.content_file_id,
  }
}

function normalizeModelMessageValue(value: unknown, key?: string): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined
  if (value instanceof Uint8Array)
    return { byteLength: value.byteLength, base64: Buffer.from(value).toString("base64") }
  if (value instanceof ArrayBuffer)
    return { byteLength: value.byteLength, base64: Buffer.from(value).toString("base64") }
  if (Array.isArray(value))
    return value.map((item) => normalizeModelMessageValue(item)).filter((item) => item !== undefined)
  if (!isObject(value)) return value

  const output: Record<string, unknown> = {}
  for (const entryKey of Object.keys(value).sort()) {
    if (entryKey === "id" && key === undefined) continue
    const normalized = normalizeModelMessageValue(value[entryKey], entryKey)
    if (normalized !== undefined) output[entryKey] = normalized
  }
  return output
}

export function normalizeModelMessagesForRawLeafParity(modelMessages: unknown[]) {
  return normalizeModelMessageValue(modelMessages)
}

export function rawLeafNormalizedParityKey(input: {
  readonly modelMessages: unknown[]
  readonly renderInputManifest: unknown
}) {
  return stableHash({
    renderNormalizationVersion: "render-normalization-v1",
    renderInputManifest: input.renderInputManifest,
    modelMessages: normalizeModelMessagesForRawLeafParity(input.modelMessages),
  })
}

function toIso(value: number | string | bigint) {
  return new Date(Number(value)).toISOString()
}

function rowCuePayload(row: Pick<ContextRow, "cue_payload_json">): LcmRetrievalCuePayload | undefined {
  const payload = jsonValue(row.cue_payload_json)
  return isRetrievalCuePayload(payload) ? payload : undefined
}

function rowCueID(row: Pick<ContextRow, "context_item_id" | "cue_id">) {
  return row.cue_id ?? row.context_item_id
}

function rowToItem(row: ContextRow): ContextItem {
  const base = {
    contextItemID: row.context_item_id,
    conversationID: row.conversation_id,
    itemOrder: asNumber(row.item_order),
    itemType: row.item_type,
    ...(row.token_count === null ? {} : { tokenCount: asNumber(row.token_count) }),
    ...(row.cache_key ? { cacheKey: row.cache_key } : {}),
    ...(row.cache_version === null ? {} : { cacheVersion: asNumber(row.cache_version) }),
    createdAt: toIso(row.created_at_ms),
    updatedAt: toIso(row.updated_at_ms),
  }

  if (row.item_type === "raw_message") return { ...base, itemType: "raw_message", messageRowID: row.message_row_id! }
  if (row.item_type === "summary") return { ...base, itemType: "summary", summaryID: row.summary_id! }
  if (row.item_type === "archive_stub")
    return { ...base, itemType: "archive_stub", summaryID: row.summary_id!, pointerID: row.pointer_id! }
  if (row.item_type === "large_file_marker") return { ...base, itemType: "large_file_marker", fileID: row.file_id! }
  const cuePayload = rowCuePayload(row)
  if (!cuePayload) throw invalidRequest("lcm_context_invalid_cue_payload")
  if (!row.cue_lifecycle_state || !row.cue_target_source_message_id || !row.cue_generation_id) {
    throw invalidRequest("lcm_context_invalid_cue_lifecycle")
  }
  return {
    ...base,
    itemType: "retrieval_cue",
    cueID: rowCueID(row),
    cuePayload,
    cueLifecycleState: row.cue_lifecycle_state,
    cueTargetSourceMessageID: row.cue_target_source_message_id,
    cueGenerationID: row.cue_generation_id,
    ...(row.cue_superseded_by_id ? { cueSupersededByID: row.cue_superseded_by_id } : {}),
    ...(row.cue_superseded_by_generation_id
      ? { cueSupersededByGenerationID: row.cue_superseded_by_generation_id }
      : {}),
  }
}

function assertObject(value: unknown, diagnosticCode: string): Record<string, unknown> {
  const parsed = jsonValue(value)
  if (!isObject(parsed)) throw invalidRequest(diagnosticCode)
  return parsed
}

function assertString(value: unknown, diagnosticCode: string) {
  if (typeof value !== "string") throw invalidRequest(diagnosticCode)
  return value
}

function assertRecord(value: unknown, diagnosticCode: string): Record<string, unknown> {
  if (!isObject(value)) throw invalidRequest(diagnosticCode)
  return value
}

function partID(row: SourcePartRow) {
  return row.source_part_id ?? row.part_row_id
}

function applyPartRenderFlags<T extends MessageV2.Part>(part: T, row: SourcePartRow): T {
  const output = { ...part } as T & { ignored?: boolean; synthetic?: boolean; compatibility?: boolean }
  if (row.ignored) output.ignored = true
  if (row.synthetic) output.synthetic = true
  if (row.compatibility) output.compatibility = true
  return output
}

function parsePart(
  schema: unknown,
  value: unknown,
  row: SourcePartRow,
  diagnosticCode: string,
): MessageV2.Part {
  try {
    return applyPartRenderFlags(Schema.decodeUnknownSync(schema as never)(value) as MessageV2.Part, row)
  } catch {
    throw invalidRequest(diagnosticCode)
  }
}

function parseMessageInfo(
  schema: unknown,
  value: unknown,
  diagnosticCode: string,
): MessageV2.Info {
  try {
    return Schema.decodeUnknownSync(schema as never)(value) as MessageV2.Info
  } catch {
    throw invalidRequest(diagnosticCode)
  }
}

function readTimeRange(input: {
  row: SourcePartRow
  renderMetadata: Record<string, unknown>
  requireEnd: boolean
  diagnosticCode: string
}) {
  const time = input.renderMetadata.time
  if (isObject(time) && typeof time.start === "number" && (!input.requireEnd || typeof time.end === "number")) {
    return {
      start: time.start,
      ...(typeof time.end === "number" ? { end: time.end } : {}),
      ...(typeof time.compacted === "number" ? { compacted: time.compacted } : {}),
    }
  }
  if (input.requireEnd && input.row.completed_at_ms !== null) {
    return {
      start: asNumber(input.row.created_at_ms),
      end: asNumber(input.row.completed_at_ms),
    }
  }
  if (!input.requireEnd) return undefined
  throw invalidRequest(input.diagnosticCode)
}

function validateFileSourceKind(source: unknown) {
  if (source === undefined || source === null) return
  if (!isObject(source) || typeof source.type !== "string") throw invalidRequest("lcm_raw_leaf_invalid_file_source")
  if (!(RAW_LEAF_FILE_SOURCE_KINDS as readonly string[]).includes(source.type)) {
    throw invalidRequest(`lcm_raw_leaf_unknown_file_source_${source.type}`)
  }
}

function largeFileMarkerPart(row: SourcePartRow, message: SourceMessageRow, markerText: string): MessageV2.TextPart {
  return parsePart(
    MessageV2.TextPart,
    {
      id: partID(row),
      sessionID: message.source_session_id,
      messageID: message.source_message_id,
      type: "text",
      text: markerText,
    },
    row,
    "lcm_raw_leaf_invalid_lcm_file_marker_part",
  ) as MessageV2.TextPart
}

function markerForLargeFile(row: SourcePartRow, markers: ReadonlyMap<LcmFileID, string>) {
  if (row.content_storage_kind !== "lcm_file" || !row.content_file_id) return undefined
  const marker = markers.get(row.content_file_id as LcmFileID)
  if (!marker) throw missingSource("lcm_raw_leaf_missing_lcm_file_marker", row.conversation_id)
  return marker
}

function reconstructSourcePart(
  row: SourcePartRow,
  message: SourceMessageRow,
  largeFileMarkers: ReadonlyMap<LcmFileID, string>,
): MessageV2.Part {
  if (!(RAW_LEAF_PART_KINDS as readonly string[]).includes(row.part_kind)) {
    throw invalidRequest(`lcm_raw_leaf_unknown_part_kind_${row.part_kind}`)
  }

  const id = partID(row)
  const sessionID = message.source_session_id
  const messageID = message.source_message_id
  const renderMetadata = assertObject(row.render_metadata_json, "lcm_raw_leaf_invalid_part_render_metadata")
  const providerMetadata = jsonValue(row.provider_metadata_json)
  const largeFileMarker = markerForLargeFile(row, largeFileMarkers)

  if (row.part_kind === "text") {
    if (largeFileMarker) return largeFileMarkerPart(row, message, largeFileMarker)
    if (row.text_content === null) throw invalidRequest("lcm_raw_leaf_missing_text_content")
    return parsePart(
      MessageV2.TextPart,
      {
        id,
        sessionID,
        messageID,
        type: "text",
        text: row.text_content,
        ignored: row.ignored || undefined,
        synthetic: row.synthetic || undefined,
        metadata: isObject(providerMetadata) && Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
        time: readTimeRange({
          row,
          renderMetadata,
          requireEnd: false,
          diagnosticCode: "lcm_raw_leaf_invalid_text_time",
        }),
      },
      row,
      "lcm_raw_leaf_invalid_text_part",
    )
  }

  if (row.part_kind === "reasoning") {
    if (largeFileMarker) {
      return parsePart(
        MessageV2.ReasoningPart,
        {
          id,
          sessionID,
          messageID,
          type: "reasoning",
          text: largeFileMarker,
          metadata:
            isObject(providerMetadata) && Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
          time: readTimeRange({
            row,
            renderMetadata,
            requireEnd: true,
            diagnosticCode: "lcm_raw_leaf_invalid_reasoning_time",
          }),
        },
        row,
        "lcm_raw_leaf_invalid_reasoning_part",
      )
    }
    if (row.reasoning_content === null) throw invalidRequest("lcm_raw_leaf_missing_reasoning_content")
    return parsePart(
      MessageV2.ReasoningPart,
      {
        id,
        sessionID,
        messageID,
        type: "reasoning",
        text: row.reasoning_content,
        metadata: isObject(providerMetadata) && Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
        time: readTimeRange({
          row,
          renderMetadata,
          requireEnd: true,
          diagnosticCode: "lcm_raw_leaf_invalid_reasoning_time",
        }),
      },
      row,
      "lcm_raw_leaf_invalid_reasoning_part",
    )
  }

  if (row.part_kind === "file") {
    if (largeFileMarker) return largeFileMarkerPart(row, message, largeFileMarker)
    if (row.file_url === null || row.media_mime === null) throw invalidRequest("lcm_raw_leaf_missing_file_metadata")
    validateFileSourceKind(renderMetadata.source)
    return parsePart(
      MessageV2.FilePart,
      {
        id,
        sessionID,
        messageID,
        type: "file",
        url: row.file_url,
        mime: row.media_mime,
        filename: row.media_name ?? undefined,
        source: renderMetadata.source,
      },
      row,
      "lcm_raw_leaf_invalid_file_part",
    )
  }

  if (row.part_kind === "tool") {
    if (!row.terminal_state || !(RAW_LEAF_TERMINAL_TOOL_STATES as readonly string[]).includes(row.terminal_state)) {
      throw invalidRequest(`lcm_raw_leaf_unknown_tool_state_${row.terminal_state ?? "missing"}`)
    }
    if (row.tool_call_id === null || row.tool_name === null || row.tool_input_json === null) {
      throw invalidRequest("lcm_raw_leaf_missing_tool_metadata")
    }
    const time = readTimeRange({
      row,
      renderMetadata,
      requireEnd: true,
      diagnosticCode: "lcm_raw_leaf_invalid_tool_time",
    })
    const base = {
      id,
      sessionID,
      messageID,
      type: "tool" as const,
      callID: row.tool_call_id,
      tool: row.tool_name,
      metadata: isObject(providerMetadata) && Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
    }
    if (row.terminal_state === "completed") {
      const output = largeFileMarker ?? row.tool_output_text
      if (output === null) throw invalidRequest("lcm_raw_leaf_missing_tool_output")
      return parsePart(
        MessageV2.ToolPart,
        {
          ...base,
          state: {
            status: "completed",
            input: assertRecord(jsonValue(row.tool_input_json), "lcm_raw_leaf_invalid_tool_input"),
            output,
            title: typeof renderMetadata.title === "string" ? renderMetadata.title : "",
            metadata: isObject(renderMetadata.stateMetadata) ? renderMetadata.stateMetadata : {},
            time,
            attachments: Array.isArray(renderMetadata.attachments) ? renderMetadata.attachments : undefined,
          },
        },
        row,
        "lcm_raw_leaf_invalid_completed_tool_part",
      )
    }

    const errorText = largeFileMarker ?? row.tool_error_text
    if (errorText === null) throw invalidRequest("lcm_raw_leaf_missing_tool_error")
    const stateMetadata = isObject(renderMetadata.stateMetadata) ? { ...renderMetadata.stateMetadata } : {}
    if (renderMetadata.interruptedOutputFromMetadata === true && (largeFileMarker || row.tool_output_text !== null)) {
      stateMetadata.interrupted = true
      stateMetadata.output = largeFileMarker ?? row.tool_output_text
    }
    return parsePart(
      MessageV2.ToolPart,
      {
        ...base,
        state: {
          status: "error",
          input: assertRecord(jsonValue(row.tool_input_json), "lcm_raw_leaf_invalid_tool_input"),
          error: errorText,
          metadata: Object.keys(stateMetadata).length > 0 ? stateMetadata : undefined,
          time,
        },
      },
      row,
      "lcm_raw_leaf_invalid_error_tool_part",
    )
  }

  const payload = assertObject(renderMetadata.payload, "lcm_raw_leaf_missing_structured_payload")
  if (payload.type !== row.part_kind) throw invalidRequest("lcm_raw_leaf_structured_payload_kind_mismatch")
  return parsePart(
    MessageV2.Part,
    {
      ...payload,
      id,
      sessionID,
      messageID,
    },
    row,
    "lcm_raw_leaf_invalid_structured_part",
  )
}

function reconstructSourceMessage(
  row: SourceMessageRow,
  parts: SourcePartRow[],
  largeFileMarkers: ReadonlyMap<LcmFileID, string>,
): MessageV2.WithParts {
  if (!(RAW_LEAF_MESSAGE_ROLES as readonly string[]).includes(row.role)) {
    throw invalidRequest(`lcm_raw_leaf_unknown_message_role_${row.role}`)
  }
  const metadata = assertObject(row.metadata_json, "lcm_raw_leaf_invalid_message_metadata")
  if (metadata.version !== 1) throw invalidRequest("lcm_raw_leaf_unknown_message_metadata_version")

  const base = {
    id: row.source_message_id,
    sessionID: row.source_session_id,
    time: {
      created: asNumber(row.created_at_ms),
      ...(row.completed_at_ms === null ? {} : { completed: asNumber(row.completed_at_ms) }),
    },
  }

  const info =
    row.role === "user"
      ? parseMessageInfo(
          MessageV2.User,
          {
            ...base,
            role: "user",
            agent: assertString(row.agent_name, "lcm_raw_leaf_missing_user_agent"),
            model: {
              providerID: assertString(row.provider_id, "lcm_raw_leaf_missing_user_provider"),
              modelID: assertString(row.model_id, "lcm_raw_leaf_missing_user_model"),
              variant: typeof metadata.modelVariant === "string" ? metadata.modelVariant : undefined,
            },
            format: metadata.format,
            summary: metadata.summary,
            system: metadata.system,
            tools: metadata.tools,
          },
          "lcm_raw_leaf_invalid_message_info",
        )
      : parseMessageInfo(
          MessageV2.Assistant,
          {
            ...base,
            role: "assistant",
            parentID: assertString(metadata.parentID, "lcm_raw_leaf_missing_assistant_parent"),
            mode:
              typeof metadata.mode === "string"
                ? metadata.mode
                : assertString(row.agent_name, "lcm_raw_leaf_missing_assistant_mode"),
            agent: assertString(row.agent_name, "lcm_raw_leaf_missing_assistant_agent"),
            providerID: assertString(row.provider_id, "lcm_raw_leaf_missing_assistant_provider"),
            modelID: assertString(row.model_id, "lcm_raw_leaf_missing_assistant_model"),
            path: metadata.path,
            summary: metadata.summary,
            structured: metadata.structured,
            error: metadata.error,
            cost: metadata.cost,
            tokens: metadata.tokens,
            variant: metadata.variant,
            finish: metadata.finish,
          },
          "lcm_raw_leaf_invalid_message_info",
        )

  return {
    info,
    parts: parts.map((part) => reconstructSourcePart(part, row, largeFileMarkers)),
  }
}

async function loadRawLeafMessageEntries(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
}): Promise<RawLeafMessageEntry[]> {
  const rawItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "raw_message" }> => item.itemType === "raw_message",
  )
  if (rawItems.length === 0) return []
  const messageRowIDs = rawItems.map((item) => item.messageRowID)
  const messages = (
    await input.db.query<SourceMessageRow>(
      `
        SELECT *
        FROM lcm_messages
        WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
      `,
      [input.conversationID, messageRowIDs],
    )
  ).rows
  const messageByID = new Map(messages.map((message) => [message.message_row_id, message] as const))
  const partRows = (
    await input.db.query<SourcePartRow>(
      `
        SELECT *
        FROM lcm_message_parts
        WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
        ORDER BY message_row_id, part_order, part_row_id
      `,
      [input.conversationID, messageRowIDs],
    )
  ).rows
  const partsByMessageID = new Map<string, SourcePartRow[]>()
  const largeFileIDs = new Set<LcmFileID>()
  for (const part of partRows) {
    const existing = partsByMessageID.get(part.message_row_id) ?? []
    existing.push(part)
    partsByMessageID.set(part.message_row_id, existing)
    if (part.content_storage_kind === "lcm_file" && part.content_file_id) {
      largeFileIDs.add(part.content_file_id as LcmFileID)
    }
  }
  const largeFileMarkers = await loadLargeFileMarkerTextByIDs(input.db, input.conversationID, [...largeFileIDs])
  const entries: RawLeafMessageEntry[] = []
  for (const item of rawItems) {
    const message = messageByID.get(item.messageRowID)
    if (!message) throw missingSource("lcm_raw_leaf_missing_message", input.conversationID)
    const parts = partsByMessageID.get(item.messageRowID) ?? []
    if (parts.length === 0) throw missingSource("lcm_raw_leaf_missing_parts", input.conversationID)
    entries.push({
      item,
      sourceRow: message,
      partRows: parts,
      message: reconstructSourceMessage(message, parts, largeFileMarkers),
    })
  }
  return entries
}

interface ThresholdSource {
  readonly conversation: ConversationRow
  readonly rows: ContextRow[]
  readonly contextItems: ContextItem[]
  readonly rawEntries: RawLeafMessageEntry[]
  readonly rawMessages: MessageV2.WithParts[]
  readonly summaryModelMessages: Map<ContextItemID, unknown>
  readonly markerModelMessages: Map<ContextItemID, unknown>
  readonly visibilityProvenance: LcmVisibilityProvenance
  readonly summaryMetadata: Map<SummaryID, SummaryMetadata>
  readonly fallbackText: Map<ContextItemID, string>
}

function tokenBudgetInput(input: LcmThresholdInput): LcmRawLeafThresholdInput {
  return input as LcmRawLeafThresholdInput
}

function thresholdTokenCounter(input: LcmThresholdInput) {
  return tokenBudgetInput(input).tokenCounter ?? createDeterministicFallbackTokenCounter()
}

async function loadSummaryMetadata(db: Queryable, conversationID: ConversationID, rows: readonly ContextRow[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.summary_id ? [row.summary_id] : [])))]
  const metadata = new Map<SummaryID, SummaryMetadata>()
  if (ids.length === 0) return metadata
  const summaries = (
    await db.query<{
      summary_id: SummaryID
      summary_type: "sprig" | "bindle" | "archive_stub"
      summary_level: number | string | bigint
      content_text: string
      prompt_version: string
      objective_status: LcmSummaryObjectiveStatus
      fallback_mode: LcmSummaryFallbackMode
      source_token_count: number | string | bigint
      summary_token_count: number | string | bigint
    }>(
      `
        SELECT summary_id, summary_type, summary_level, content_text, prompt_version,
               objective_status, fallback_mode, source_token_count, summary_token_count
        FROM lcm_summaries
        WHERE conversation_id = $1 AND summary_id = ANY($2::text[])
      `,
      [conversationID, ids],
    )
  ).rows
  const parentRows = (
    await db.query<{
      summary_id: SummaryID
      parent_summary_id: SummaryID
      parent_order: number | string | bigint
    }>(
      `
        SELECT summary_id, parent_summary_id, parent_order
        FROM lcm_summary_parents
        WHERE summary_id = ANY($1::text[])
        ORDER BY summary_id, parent_order, parent_summary_id
      `,
      [ids],
    )
  ).rows
  const coverageRows = (
    await db.query<{
      summary_id: SummaryID
      message_row_id: MessageRowID
      message_order: number | string | bigint
    }>(
      `
        SELECT sm.summary_id, sm.message_row_id, m.message_order
        FROM lcm_summary_messages sm
        JOIN lcm_messages m ON m.message_row_id = sm.message_row_id
        WHERE sm.summary_id = ANY($1::text[]) AND m.conversation_id = $2
        ORDER BY sm.summary_id, m.message_order, sm.message_row_id
      `,
      [ids, conversationID],
    )
  ).rows
  const parentIDsBySummary = new Map<SummaryID, SummaryID[]>()
  for (const parent of parentRows) {
    const existing = parentIDsBySummary.get(parent.summary_id) ?? []
    existing.push(parent.parent_summary_id)
    parentIDsBySummary.set(parent.summary_id, existing)
  }
  const coveredIDsBySummary = new Map<SummaryID, Set<MessageRowID>>()
  const coveredChronologyBySummary = new Map<SummaryID, number>()
  for (const coverage of coverageRows) {
    const covered = coveredIDsBySummary.get(coverage.summary_id) ?? new Set<MessageRowID>()
    covered.add(coverage.message_row_id)
    coveredIDsBySummary.set(coverage.summary_id, covered)
    coveredChronologyBySummary.set(
      coverage.summary_id,
      Math.max(coveredChronologyBySummary.get(coverage.summary_id) ?? 0, asNumber(coverage.message_order)),
    )
  }
  for (const summary of summaries) {
    metadata.set(summary.summary_id, {
      summaryType: summary.summary_type,
      summaryLevel: asNumber(summary.summary_level),
      text: summary.content_text,
      promptVersion: summary.prompt_version,
      objectiveStatus: summary.objective_status,
      fallbackMode: summary.fallback_mode,
      sourceTokenCount: asNumber(summary.source_token_count),
      summaryTokenCount: asNumber(summary.summary_token_count),
      parentSummaryIDs: parentIDsBySummary.get(summary.summary_id) ?? [],
      coveredMessageRowIDs: coveredIDsBySummary.get(summary.summary_id) ?? new Set<MessageRowID>(),
      coveredSourceChronology: coveredChronologyBySummary.get(summary.summary_id) ?? 0,
    })
  }
  return metadata
}

function contextOrder(row: ContextRow) {
  return asNumber(row.item_order)
}

function newestActiveSprigBoundary(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
}) {
  let selected:
    | {
        row: ContextRow
        order: number
        coveredSourceChronology: number
        stableID: string
      }
    | undefined
  for (const row of input.rows) {
    if (row.item_type !== "summary" || !row.summary_id) continue
    const summary = input.summaryMetadata.get(row.summary_id)
    if (summary?.summaryType !== "sprig") continue
    const candidate = {
      row,
      order: contextOrder(row),
      coveredSourceChronology: summary.coveredSourceChronology,
      stableID: `${row.summary_id}:${row.context_item_id}`,
    }
    if (
      !selected ||
      candidate.order > selected.order ||
      (candidate.order === selected.order &&
        (candidate.coveredSourceChronology > selected.coveredSourceChronology ||
          (candidate.coveredSourceChronology === selected.coveredSourceChronology &&
            candidate.stableID > selected.stableID)))
    ) {
      selected = candidate
    }
  }
  return selected
}

function activeSummaryCoveredMessages(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
}) {
  const covered = new Set<MessageRowID>()
  for (const row of input.rows) {
    if ((row.item_type !== "summary" && row.item_type !== "archive_stub") || !row.summary_id) continue
    const summary = input.summaryMetadata.get(row.summary_id)
    if (!summary) continue
    for (const messageRowID of summary.coveredMessageRowIDs) covered.add(messageRowID)
  }
  return covered
}

function selectSoftRawLaneRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
  tokenCountForRow?: (row: ContextRow) => number
}) {
  const rows = [...input.rows].sort((left, right) => contextOrder(left) - contextOrder(right))
  const boundary = newestActiveSprigBoundary({ rows, summaryMetadata: input.summaryMetadata })
  const boundaryOrder = boundary?.order ?? 0
  const coveredMessages = activeSummaryCoveredMessages({ rows, summaryMetadata: input.summaryMetadata })
  const rawRows = rows.filter(
    (row) =>
      row.item_type === "raw_message" &&
      row.message_row_id &&
      contextOrder(row) > boundaryOrder &&
      !coveredMessages.has(row.message_row_id),
  )
  const targetRow =
    input.targetMessageRowID === undefined
      ? undefined
      : rawRows.find((row) => row.message_row_id === input.targetMessageRowID)
  const targetOrder = targetRow ? contextOrder(targetRow) : Number.POSITIVE_INFINITY
  const tokenCountForRow = input.tokenCountForRow ?? ((row: ContextRow) => optionalNumber(row.token_count) ?? 0)
  const consumedMessageRowIDs = input.consumedMessageRowIDs ?? new Set<MessageRowID>()
  const mandatoryIDs = new Set<ContextItemID>()
  const unconsumedIDs = new Set<ContextItemID>()
  if (targetRow) mandatoryIDs.add(targetRow.context_item_id)
  if (targetOrder !== Number.POSITIVE_INFINITY) {
    for (const row of rawRows) {
      if (contextOrder(row) <= targetOrder) continue
      if (row.message_row_id && consumedMessageRowIDs.has(row.message_row_id)) continue
      mandatoryIDs.add(row.context_item_id)
      unconsumedIDs.add(row.context_item_id)
    }
  }
  const candidateRows = rawRows.filter((row) => !mandatoryIDs.has(row.context_item_id))
  const freshTailTokenBudget = Math.max(
    1,
    Math.floor(input.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens),
  )
  const freshTailIDs = new Set<ContextItemID>()
  let freshTailTokens = 0
  let freshTailCount = 0
  for (let index = candidateRows.length - 1; index >= 0; index--) {
    const row = candidateRows[index]!
    const tokenCount = Math.max(0, tokenCountForRow(row))
    if (freshTailCount > 0 && freshTailTokens + tokenCount > freshTailTokenBudget) break
    freshTailIDs.add(row.context_item_id)
    freshTailTokens += tokenCount
    freshTailCount++
  }
  const eligibleRows = candidateRows.filter((row) => !freshTailIDs.has(row.context_item_id))
  const freshTailRows = candidateRows.filter((row) => freshTailIDs.has(row.context_item_id))
  const unconsumedRows = rawRows.filter((row) => unconsumedIDs.has(row.context_item_id))
  const protectedRows = rawRows.filter(
    (row) => mandatoryIDs.has(row.context_item_id) || freshTailIDs.has(row.context_item_id),
  )
  return { eligibleRows, protectedRows, freshTailRows, unconsumedRows }
}

function selectSoftBacklogRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
  tokenCountForRow?: (row: ContextRow) => number
}) {
  return selectSoftRawLaneRows(input).eligibleRows
}

function computeSoftBacklogFromCounted(input: {
  counted: readonly ThresholdContextItemCount[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
}) {
  const tokenByContextID = new Map(input.counted.map((item) => [item.row.context_item_id, item.tokenCount] as const))
  const selected = selectSoftRawLaneRows({
    rows: input.counted.map((item) => item.row),
    summaryMetadata: input.summaryMetadata,
    strategy: input.strategy,
    targetMessageRowID: input.targetMessageRowID,
    freshTailTokens: input.freshTailTokens,
    consumedMessageRowIDs: input.consumedMessageRowIDs,
    tokenCountForRow: (row) => tokenByContextID.get(row.context_item_id) ?? 0,
  })
  const rows = selected.eligibleRows
  const rowTokenCount = (row: ContextRow) => tokenByContextID.get(row.context_item_id) ?? 0
  return {
    rows,
    tokens: rows.reduce((total, row) => total + rowTokenCount(row), 0),
    itemCount: rows.length,
    largestSourceTokens: rows.reduce((largest, row) => Math.max(largest, rowTokenCount(row)), 0),
    freshTailTokens: selected.freshTailRows.reduce((total, row) => total + rowTokenCount(row), 0),
    freshTailItemCount: selected.freshTailRows.length,
    unconsumedTokens: selected.unconsumedRows.reduce((total, row) => total + rowTokenCount(row), 0),
    unconsumedItemCount: selected.unconsumedRows.length,
    protectedTailTokens: selected.protectedRows.reduce(
      (total, row) => total + (tokenByContextID.get(row.context_item_id) ?? 0),
      0,
    ),
    protectedTailItemCount: selected.protectedRows.length,
  }
}

function computeSoftBacklogFromRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
}) {
  const selected = selectSoftRawLaneRows(input)
  const rows = selected.eligibleRows
  const rowTokenCount = (row: ContextRow) => optionalNumber(row.token_count) ?? 0
  return {
    rows,
    tokens: rows.reduce((total, row) => total + rowTokenCount(row), 0),
    itemCount: rows.length,
    largestSourceTokens: rows.reduce((largest, row) => Math.max(largest, rowTokenCount(row)), 0),
    freshTailTokens: selected.freshTailRows.reduce((total, row) => total + rowTokenCount(row), 0),
    freshTailItemCount: selected.freshTailRows.length,
    unconsumedTokens: selected.unconsumedRows.reduce((total, row) => total + rowTokenCount(row), 0),
    unconsumedItemCount: selected.unconsumedRows.length,
    protectedTailTokens: selected.protectedRows.reduce(
      (total, row) => total + (optionalNumber(row.token_count) ?? 0),
      0,
    ),
    protectedTailItemCount: selected.protectedRows.length,
  }
}

async function loadRawFallbackText(db: Queryable, conversationID: ConversationID, rows: readonly ContextRow[]) {
  const ids = rows.filter((row) => row.item_type === "raw_message").map((row) => row.message_row_id!)
  const text = new Map<MessageRowID, string>()
  if (ids.length === 0) return text
  const parts = (
    await db.query<{
      message_row_id: MessageRowID
      role: string
      part_order: number | string | bigint
      part_kind: string
      search_text: string
    }>(
      `
        SELECT p.message_row_id, m.role, p.part_order, p.part_kind, p.search_text
        FROM lcm_message_parts p
        JOIN lcm_messages m ON m.message_row_id = p.message_row_id
        WHERE p.conversation_id = $1 AND p.message_row_id = ANY($2::text[])
        ORDER BY m.message_order, p.part_order, p.part_row_id
      `,
      [conversationID, ids],
    )
  ).rows
  for (const part of parts) {
    const existing = text.get(part.message_row_id) ?? `${part.role}\n`
    text.set(part.message_row_id, `${existing}${part.part_kind}\n${part.search_text}\n`)
  }
  return text
}

async function loadSummaryWrapperMessages(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
}) {
  const summaryItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "summary" | "archive_stub" }> =>
      item.itemType === "summary" || item.itemType === "archive_stub",
  )
  const messages = new Map<ContextItemID, unknown>()
  if (summaryItems.length === 0) return messages

  const ids = [...new Set(summaryItems.map((item) => item.summaryID))]
  const summaries = (
    await input.db.query<{
      summary_id: SummaryID
      content_text: string
      objective_status: LcmSummaryObjectiveStatus
      fallback_mode: LcmSummaryFallbackMode
      source_token_count: number | string | bigint
      summary_token_count: number | string | bigint
    }>(
      `
        SELECT summary_id, content_text, objective_status, fallback_mode, source_token_count, summary_token_count
        FROM lcm_summaries
        WHERE conversation_id = $1 AND summary_id = ANY($2::text[])
      `,
      [input.conversationID, ids],
    )
  ).rows
  const summaryByID = new Map(summaries.map((summary) => [summary.summary_id, summary] as const))
  const parentRows = (
    await input.db.query<{
      summary_id: SummaryID
      parent_summary_id: SummaryID
    }>(
      `
        SELECT summary_id, parent_summary_id
        FROM lcm_summary_parents
        WHERE summary_id = ANY($1::text[])
        ORDER BY summary_id, parent_order, parent_summary_id
      `,
      [ids],
    )
  ).rows
  const parentIDsBySummary = new Map<SummaryID, SummaryID[]>()
  for (const parent of parentRows) {
    const existing = parentIDsBySummary.get(parent.summary_id) ?? []
    existing.push(parent.parent_summary_id)
    parentIDsBySummary.set(parent.summary_id, existing)
  }

  for (const item of summaryItems) {
    if (item.itemType === "archive_stub") {
      messages.set(item.contextItemID, {
        role: "user",
        content: renderArchiveStubWrapper({ summaryID: item.summaryID, pointerID: item.pointerID }),
      })
      continue
    }
    const summary = summaryByID.get(item.summaryID)
    if (!summary) throw missingSource("lcm_summary_wrapper_missing_summary", input.conversationID)
    messages.set(item.contextItemID, {
      role: "user",
      content: renderSummaryWrapper({
        summaryID: item.summaryID,
        contentText: summary.content_text,
        parentSummaryIDs: parentIDsBySummary.get(item.summaryID) ?? [],
        objectiveStatus: summary.objective_status,
        fallbackMode: summary.fallback_mode,
        sourceTokenCount: asNumber(summary.source_token_count),
        summaryTokenCount: asNumber(summary.summary_token_count),
      }),
    })
  }
  return messages
}

async function loadLargeFileMarkerTextByIDs(db: Queryable, conversationID: ConversationID, ids: readonly LcmFileID[]) {
  const text = new Map<LcmFileID, string>()
  if (ids.length === 0) return text
  const files = (
    await db.query<{
      file_id: LcmFileID
      source_kind: string
      preview_text: string | null
      exploration_summary_text: string | null
      exploration_status: string
      artifact_byte_count: number | string | bigint
      artifact_content_sha256: string | null
      path_size_bytes: number | string | bigint | null
      path_content_sha256: string | null
    }>(
      `
        SELECT file_id, source_kind, preview_text, exploration_summary_text, exploration_status,
               artifact_byte_count, artifact_content_sha256, path_size_bytes, path_content_sha256
        FROM lcm_large_files
        WHERE conversation_id = $1 AND file_id = ANY($2::text[])
      `,
      [conversationID, ids],
    )
  ).rows
  for (const file of files) {
    text.set(
      file.file_id,
      renderLargeFileMarker({
        fileID: file.file_id,
        sourceKind: file.source_kind,
        byteCount: asNumber(file.path_size_bytes ?? file.artifact_byte_count),
        sha256: file.path_content_sha256 ?? file.artifact_content_sha256 ?? "",
        explorationStatus: file.exploration_status,
        previewText: file.preview_text ?? "",
      }) + (file.exploration_summary_text ? `\n\n[Exploration Summary]\n${file.exploration_summary_text}` : ""),
    )
  }
  return text
}

async function loadLargeFileMarkerText(db: Queryable, conversationID: ConversationID, rows: readonly ContextRow[]) {
  return loadLargeFileMarkerTextByIDs(
    db,
    conversationID,
    rows.filter((row) => row.item_type === "large_file_marker").map((row) => row.file_id!),
  )
}

async function loadStandaloneLargeFileMarkerMessages(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
}) {
  const markerItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "large_file_marker" }> => item.itemType === "large_file_marker",
  )
  const messages = new Map<ContextItemID, unknown>()
  if (markerItems.length === 0) return messages
  const markerText = await loadLargeFileMarkerTextByIDs(
    input.db,
    input.conversationID,
    markerItems.map((item) => item.fileID),
  )
  for (const item of markerItems) {
    const content = markerText.get(item.fileID)
    if (!content) throw missingSource("lcm_large_file_marker_missing_file", input.conversationID)
    messages.set(item.contextItemID, {
      role: "user",
      content,
    })
  }
  return messages
}

async function loadVisibilityProvenance(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
  hiddenSourceMessageIDs: readonly string[]
}): Promise<LcmVisibilityProvenance> {
  const hiddenSourceIDs = new Set(input.hiddenSourceMessageIDs)
  const hiddenContextItemIDs = new Set<ContextItemID>()
  const missingContextItemIDs = new Set<ContextItemID>()
  if (hiddenSourceIDs.size === 0) {
    return { hiddenContextItemIDs, missingContextItemIDs }
  }

  const summaryItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "summary" | "archive_stub" }> =>
      item.itemType === "summary" || item.itemType === "archive_stub",
  )
  if (summaryItems.length > 0) {
    const summaryIDs = [...new Set(summaryItems.map((item) => item.summaryID))]
    const sourceRows = (
      await input.db.query<{
        summary_id: SummaryID
        source_message_id: string
      }>(
        `
          SELECT sm.summary_id, m.source_message_id
          FROM lcm_summary_messages sm
          JOIN lcm_messages m ON m.message_row_id = sm.message_row_id
          WHERE m.conversation_id = $1 AND sm.summary_id = ANY($2::text[])
        `,
        [input.conversationID, summaryIDs],
      )
    ).rows
    const sourceIDsBySummary = new Map<SummaryID, Set<string>>()
    for (const row of sourceRows) {
      const existing = sourceIDsBySummary.get(row.summary_id) ?? new Set<string>()
      existing.add(row.source_message_id)
      sourceIDsBySummary.set(row.summary_id, existing)
    }
    for (const item of summaryItems) {
      const sourceIDs = sourceIDsBySummary.get(item.summaryID)
      if (!sourceIDs || sourceIDs.size === 0) {
        missingContextItemIDs.add(item.contextItemID)
        continue
      }
      if ([...sourceIDs].some((id) => hiddenSourceIDs.has(id))) hiddenContextItemIDs.add(item.contextItemID)
    }
  }

  const cueItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "retrieval_cue" }> => item.itemType === "retrieval_cue",
  )
  for (const item of cueItems) {
    const messageRowIDs = [...item.cuePayload.messageRowIDs]
    const partRowIDs = [...item.cuePayload.partRowIDs]
    const sourceIDs = new Set<string>()
    if (messageRowIDs.length > 0) {
      const rows = (
        await input.db.query<{ source_message_id: string }>(
          `
            SELECT source_message_id
            FROM lcm_messages
            WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
          `,
          [input.conversationID, messageRowIDs],
        )
      ).rows
      for (const row of rows) sourceIDs.add(row.source_message_id)
      if (rows.length !== messageRowIDs.length) missingContextItemIDs.add(item.contextItemID)
    }
    if (partRowIDs.length > 0) {
      const rows = (
        await input.db.query<{ source_message_id: string }>(
          `
            SELECT m.source_message_id
            FROM lcm_message_parts p
            JOIN lcm_messages m ON m.message_row_id = p.message_row_id
            WHERE p.conversation_id = $1 AND p.part_row_id = ANY($2::text[])
          `,
          [input.conversationID, partRowIDs],
        )
      ).rows
      for (const row of rows) sourceIDs.add(row.source_message_id)
      if (rows.length !== partRowIDs.length) missingContextItemIDs.add(item.contextItemID)
    }
    if ([...sourceIDs].some((id) => hiddenSourceIDs.has(id))) hiddenContextItemIDs.add(item.contextItemID)
  }

  return { hiddenContextItemIDs, missingContextItemIDs }
}

function syntheticTextFromMessageMap(value: unknown, diagnosticCode: string) {
  if (!isObject(value) || value.role !== "user" || typeof value.content !== "string")
    throw invalidRequest(diagnosticCode)
  return value.content
}

function syntheticTextMessage(input: {
  readonly seed: string
  readonly sessionID: MessageV2.User["sessionID"]
  readonly agentName: string
  readonly providerID: ProviderID
  readonly modelID: ModelID
  readonly createdAtMs: number
  readonly text: string
}): MessageV2.WithParts {
  const messageID = lcmSyntheticMessageID(`${input.seed}:message`)
  const info: MessageV2.User & { readonly synthetic: true } = {
    id: messageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.createdAtMs },
    agent: input.agentName,
    model: {
      providerID: input.providerID,
      modelID: input.modelID,
    },
    synthetic: true,
  }
  const part: MessageV2.TextPart = {
    id: lcmSyntheticPartID(`${input.seed}:part`),
    sessionID: input.sessionID,
    messageID,
    type: "text",
    text: input.text,
    synthetic: true,
  }
  return {
    info,
    parts: [part],
  }
}

function isTargetRawEntry(input: { entry: RawLeafMessageEntry; target: LcmAssemblyInput["targetCurrentUser"] }) {
  if (input.target.messageRowID && input.entry.item.messageRowID === input.target.messageRowID) return true
  return (
    input.entry.sourceRow.source_session_id === input.target.sourceSessionID &&
    input.entry.sourceRow.source_message_id === input.target.sourceMessageID
  )
}

function rawEntryProvenance(entry: RawLeafMessageEntry) {
  return [
    `message:${entry.sourceRow.message_row_id}:version:${asNumber(entry.sourceRow.source_version)}`,
    `source:${entry.sourceRow.source_session_id}:${entry.sourceRow.source_message_id}`,
    ...entry.partRows.map((row) => `part:${stableHash(sourcePartProvenance(row))}`),
  ]
}

function rawRenderUnit(input: {
  readonly conversationID: ConversationID
  readonly entry: RawLeafMessageEntry
  readonly target?: LcmAssemblyInput["targetCurrentUser"]
  readonly placementSlot?: LcmAssemblyPlacementSlot
  readonly visibilityHash?: string
}): LcmRenderUnit {
  const sourceChronologicalOrder = asNumber(input.entry.sourceRow.message_order)
  const source: LcmRenderUnitSource = input.target
    ? {
        kind: "target_current_user",
        sourceSessionID: input.target.sourceSessionID,
        sourceMessageID: input.target.sourceMessageID,
        messageRowID: input.entry.item.messageRowID,
        promptOperationID: input.target.promptOperationID,
        visibilityBaseMessageID: input.target.visibilityBaseMessageID,
        sourceChronologicalOrder,
      }
    : {
        kind: "raw_message",
        contextItemID: input.entry.item.contextItemID,
        messageRowID: input.entry.item.messageRowID,
        sourceVersion: asNumber(input.entry.sourceRow.source_version),
      }
  const provenanceHandles = rawEntryProvenance(input.entry)
  const sourceHandle = renderUnitSourceHandle(source)
  return {
    renderUnitID: renderUnitID({
      conversationID: input.conversationID,
      source,
      sourceHandle,
      provenanceHandles,
    }),
    conversationID: input.conversationID,
    source,
    sourceKind: input.target ? "target_current_user" : "raw_message",
    sourceHandle,
    provenanceHandles,
    canonicalOrder: input.entry.item.itemOrder,
    effectiveOrder: 0,
    placementSlot: input.placementSlot ?? (input.target ? "current_user" : "history"),
    requiredVisibilityHash: input.visibilityHash,
    requiredForContinuation: input.target !== undefined,
    message: input.entry.message,
  }
}

function derivedRenderUnit(input: {
  readonly conversationID: ConversationID
  readonly item: Exclude<ContextItem, Extract<ContextItem, { itemType: "raw_message" }>>
  readonly text: string
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly targetCurrentUser: LcmAssemblyInput["targetCurrentUser"]
}): LcmRenderUnit {
  const source: LcmRenderUnitSource =
    input.item.itemType === "summary"
      ? { kind: "summary", contextItemID: input.item.contextItemID, summaryID: input.item.summaryID }
      : input.item.itemType === "archive_stub"
        ? {
            kind: "archive_stub",
            contextItemID: input.item.contextItemID,
            summaryID: input.item.summaryID,
            pointerID: input.item.pointerID,
          }
        : input.item.itemType === "large_file_marker"
          ? { kind: "large_file_marker", contextItemID: input.item.contextItemID, fileID: input.item.fileID }
          : {
              kind: "retrieval_cue",
              contextItemID: input.item.contextItemID,
              cueID: input.item.cueID,
              cueLifecycleState: input.item.cueLifecycleState,
              cueTargetSourceMessageID: input.item.cueTargetSourceMessageID,
              cueGenerationID: input.item.cueGenerationID,
              placementSlot: "before_current_user",
            }
  const sourceHandle = renderUnitSourceHandle(source)
  const provenanceHandles = [`${source.kind}:${sourceHandle}`]
  return {
    renderUnitID: renderUnitID({
      conversationID: input.conversationID,
      source,
      sourceHandle,
      provenanceHandles,
    }),
    conversationID: input.conversationID,
    source,
    sourceKind: input.item.itemType,
    sourceHandle,
    provenanceHandles,
    canonicalOrder: input.item.itemOrder,
    effectiveOrder: 0,
    placementSlot: input.item.itemType === "retrieval_cue" ? "before_current_user" : "history",
    requiredVisibilityHash: input.renderPreparation.messageVisibility?.hash,
    requiredForContinuation: false,
    message: syntheticTextMessage({
      seed: `${input.conversationID}:${input.item.contextItemID}:${input.item.itemType}`,
      sessionID: input.renderPreparation.sessionID,
      agentName: input.renderPreparation.agent.name,
      providerID: input.renderPreparation.model.providerID,
      modelID: input.renderPreparation.model.id,
      createdAtMs: Date.parse(input.item.createdAt) || 0,
      text: input.text,
    }),
  }
}

function renderUnitPlacementRank(slot: LcmAssemblyPlacementSlot) {
  if (slot === "history") return 0
  if (slot === "before_current_user") return 1
  if (slot === "current_user") return 2
  if (slot === "after_current_user") return 3
  return 4
}

function orderRenderUnits(units: readonly LcmRenderUnit[]) {
  return [...units]
    .sort((left, right) => {
      const slot = renderUnitPlacementRank(left.placementSlot) - renderUnitPlacementRank(right.placementSlot)
      if (slot !== 0) return slot
      if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
      const leftSourceOrder = left.source.kind === "target_current_user" ? left.source.sourceChronologicalOrder : 0
      const rightSourceOrder = right.source.kind === "target_current_user" ? right.source.sourceChronologicalOrder : 0
      if (leftSourceOrder !== rightSourceOrder) return leftSourceOrder - rightSourceOrder
      return left.renderUnitID.localeCompare(right.renderUnitID)
    })
    .map((unit, index) => ({ ...unit, effectiveOrder: index + 1 }))
}

function withRenderUnitOrigins(units: readonly LcmRenderUnit[]) {
  return units.map((unit) => ({
    ...unit,
    message: attachLcmRenderOriginToMessage(structuredClone(unit.message), {
      renderUnitID: unit.renderUnitID,
      sourceKind: unit.sourceKind,
      sourceHandle: unit.sourceHandle,
    }),
  }))
}

function buildRenderUnits(input: {
  readonly conversationID: ConversationID
  readonly contextItems: readonly ContextItem[]
  readonly rawEntries: readonly RawLeafMessageEntry[]
  readonly summaryModelMessages: ReadonlyMap<ContextItemID, unknown>
  readonly markerModelMessages: ReadonlyMap<ContextItemID, unknown>
  readonly visibilityProvenance: LcmVisibilityProvenance
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly targetCurrentUser: LcmAssemblyInput["targetCurrentUser"]
  readonly abortSignal?: AbortSignal
}) {
  throwIfOperationCanceled({
    abortSignal: input.abortSignal,
    operationID: input.targetCurrentUser.promptOperationID,
    diagnosticCode: "lcm_provider_assembly_canceled_before_render_units",
  })
  const rawByContextItemID = new Map(input.rawEntries.map((entry) => [entry.item.contextItemID, entry] as const))
  const hiddenSourceMessageIDs = new Set(input.renderPreparation.messageVisibility?.hiddenMessageIDs ?? [])
  let targetCurrentUser = input.targetCurrentUser
  let matchingTargets = input.rawEntries.filter((entry) => isTargetRawEntry({ entry, target: targetCurrentUser }))
  if (matchingTargets.length === 0 && input.renderPreparation.lastUser) {
    const lastUser = input.renderPreparation.lastUser
    matchingTargets = input.rawEntries.filter(
      (entry) =>
        entry.sourceRow.source_session_id === lastUser.sessionID && entry.sourceRow.source_message_id === lastUser.id,
    )
    if (matchingTargets.length === 1) {
      targetCurrentUser = {
        ...input.targetCurrentUser,
        sourceSessionID: lastUser.sessionID,
        sourceMessageID: lastUser.id,
        messageRowID: matchingTargets[0]!.item.messageRowID,
        visibilityBaseMessageID: input.targetCurrentUser.visibilityBaseMessageID || lastUser.id,
      }
    }
  }
  if (matchingTargets.length !== 1) {
    throw missingSource("lcm_provider_assembly_target_current_user_unproven", input.conversationID)
  }
  const targetEntry = matchingTargets[0]!
  if (targetEntry.message.info.role !== "user") {
    throw invalidRequest("lcm_provider_assembly_target_current_user_not_user")
  }

  const units: LcmRenderUnit[] = []
  for (const item of input.contextItems) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_provider_assembly_canceled_while_building_render_units",
    })
    if (
      item.itemType === "retrieval_cue" &&
      (item.cueLifecycleState !== "active" || item.cueTargetSourceMessageID !== targetCurrentUser.sourceMessageID)
    ) {
      continue
    }
    if (item.itemType === "raw_message") {
      const entry = rawByContextItemID.get(item.contextItemID)
      if (!entry) throw missingSource("lcm_provider_assembly_missing_raw_entry", input.conversationID)
      if (hiddenSourceMessageIDs.has(entry.sourceRow.source_message_id)) {
        if (entry === targetEntry)
          throw missingSource("lcm_provider_assembly_target_current_user_hidden", input.conversationID)
        continue
      }
      units.push(
        rawRenderUnit({
          conversationID: input.conversationID,
          entry,
          target: entry === targetEntry ? targetCurrentUser : undefined,
          placementSlot:
            entry !== targetEntry && entry.item.itemOrder > targetEntry.item.itemOrder ? "provider_tail" : undefined,
          visibilityHash: input.renderPreparation.messageVisibility?.hash,
        }),
      )
      continue
    }
    if (input.visibilityProvenance.missingContextItemIDs.has(item.contextItemID)) {
      throw missingSource("lcm_provider_assembly_derived_provenance_missing", input.conversationID)
    }
    if (input.visibilityProvenance.hiddenContextItemIDs.has(item.contextItemID)) {
      if (item.itemType === "retrieval_cue") {
        throw missingSource("lcm_provider_assembly_retrieval_cue_hidden_source", input.conversationID)
      }
      continue
    }

    const text =
      item.itemType === "summary" || item.itemType === "archive_stub"
        ? syntheticTextFromMessageMap(
            input.summaryModelMessages.get(item.contextItemID),
            "lcm_provider_assembly_missing_summary_text",
          )
        : item.itemType === "large_file_marker"
          ? syntheticTextFromMessageMap(
              input.markerModelMessages.get(item.contextItemID),
              "lcm_provider_assembly_missing_marker_text",
            )
          : renderRetrievalCueModelText(item.cuePayload, item.cueID)
    units.push(
      derivedRenderUnit({
        conversationID: input.conversationID,
        item,
        text,
        renderPreparation: input.renderPreparation,
        targetCurrentUser,
      }),
    )
  }

  const targetCount = units.filter((unit) => unit.source.kind === "target_current_user").length
  if (targetCount !== 1)
    throw missingSource("lcm_provider_assembly_target_current_user_not_rendered", input.conversationID)
  return orderRenderUnits(units)
}

function modelSupportsMediaInToolResults(model: LcmRawLeafRenderPreparationInput["model"]) {
  const npm = model.api.npm
  if (npm === "@ai-sdk/anthropic") return true
  if (npm === "@ai-sdk/openai") return true
  if (npm === "@ai-sdk/amazon-bedrock") return true
  if (npm === "@ai-sdk/google-vertex/anthropic") return true
  if (npm === "@ai-sdk/google") {
    const id = model.api.id.toLowerCase()
    return id.includes("gemini-3") && !id.includes("gemini-2")
  }
  return false
}

function unitProtectedReason(input: {
  readonly unit: LcmRenderUnit
  readonly messageCount: number
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}): LcmRenderedSpanProtectedReason | undefined {
  if (input.messageCount === 0) return undefined
  if (input.unit.message.info.role !== "assistant") return undefined
  const toolParts = input.unit.message.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool")
  if (toolParts.length === 0) return undefined
  const hasMediaAttachment = toolParts.some(
    (part) =>
      part.state.status === "completed" &&
      (part.state.attachments ?? []).some((attachment) => MessageV2.isMedia(attachment.mime)),
  )
  if (hasMediaAttachment && !modelSupportsMediaInToolResults(input.renderPreparation.model))
    return "synthetic_media_fallback"
  return "assistant_tool_results"
}

function renderedSpanForUnit(input: {
  readonly unit: LcmRenderUnit
  readonly startIndex: number
  readonly messageCount: number
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly providerTransformHash: string
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}): LcmRenderedSpan {
  const protectedReason = unitProtectedReason({
    unit: input.unit,
    messageCount: input.messageCount,
    renderPreparation: input.renderPreparation,
  })
  if (protectedReason) {
    const withoutHash = {
      renderUnitID: input.unit.renderUnitID,
      sourceKind: input.unit.sourceKind,
      sourceHandle: input.unit.sourceHandle,
      canonicalOrder: input.unit.canonicalOrder,
      effectiveOrder: input.unit.effectiveOrder,
      placementSlot: input.unit.placementSlot,
      startIndex: input.startIndex,
      messageCount: input.messageCount,
      providerFamily: input.providerFamily,
      transformStage: "rendered" as const,
      protected: true as const,
      protectedReason,
      protocolSpanID: protocolSpanID({
        providerFamily: input.providerFamily,
        protocolGroupKind: protectedReason,
        protocolGroupID: input.unit.protocolGroupID ?? input.unit.renderUnitID,
        contributingRenderUnitIDs: [input.unit.renderUnitID],
        startIndex: input.startIndex,
        messageCount: input.messageCount,
        transformStage: "rendered",
      }),
    }
    return {
      ...withoutHash,
      spanHash: renderedSpanHash(withoutHash, input.providerTransformHash),
    }
  }

  const withoutHash = {
    renderUnitID: input.unit.renderUnitID,
    sourceKind: input.unit.sourceKind,
    sourceHandle: input.unit.sourceHandle,
    canonicalOrder: input.unit.canonicalOrder,
    effectiveOrder: input.unit.effectiveOrder,
    placementSlot: input.unit.placementSlot,
    startIndex: input.startIndex,
    messageCount: input.messageCount,
    providerFamily: input.providerFamily,
    transformStage: "rendered" as const,
    protected: false as const,
  }
  return {
    ...withoutHash,
    spanHash: renderedSpanHash(withoutHash, input.providerTransformHash),
  }
}

function validateRenderedSpans(input: {
  readonly spans: readonly LcmRenderedSpan[]
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly modelMessageCount: number
  readonly providerTransformHash: string
}) {
  if (input.renderUnits.length !== input.spans.length) return "lcm_provider_assembly_span_count_mismatch"
  const unitIDs = new Set(input.renderUnits.map((unit) => unit.renderUnitID))
  const seen = new Set<string>()
  for (const span of input.spans) {
    if (!unitIDs.has(span.renderUnitID)) return "lcm_provider_assembly_span_unknown_unit"
    if (seen.has(span.renderUnitID)) return "lcm_provider_assembly_span_duplicate_unit"
    seen.add(span.renderUnitID)
    if (span.startIndex < 0 || span.messageCount < 0) return "lcm_provider_assembly_span_negative_range"
    if (span.startIndex + span.messageCount > input.modelMessageCount) return "lcm_provider_assembly_span_out_of_range"
    if (span.messageCount === 0 && span.protected) return "lcm_provider_assembly_zero_span_protected"
    if (span.protected) {
      if (!span.protectedReason || !span.protocolSpanID) return "lcm_provider_assembly_protected_metadata_missing"
    } else if ("protectedReason" in span || "protocolSpanID" in span) {
      return "lcm_provider_assembly_unprotected_metadata_present"
    }
    const { spanHash: _spanHash, ...withoutHash } = span
    if (span.spanHash !== renderedSpanHash(withoutHash, input.providerTransformHash)) {
      return "lcm_provider_assembly_span_hash_mismatch"
    }
  }

  const protocolGroups = new Map<string, LcmRenderedSpan[]>()
  for (const span of input.spans) {
    if (!span.protected) continue
    const group = protocolGroups.get(span.protocolSpanID) ?? []
    group.push(span)
    protocolGroups.set(span.protocolSpanID, group)
  }
  for (const group of protocolGroups.values()) {
    const sorted = [...group].sort((left, right) => left.startIndex - right.startIndex)
    let cursor = sorted[0]!.startIndex
    const end = Math.max(...sorted.map((span) => span.startIndex + span.messageCount))
    for (const span of sorted) {
      if (span.startIndex !== cursor) return "lcm_provider_assembly_protocol_span_gap"
      cursor = span.startIndex + span.messageCount
    }
    if (cursor !== end) return "lcm_provider_assembly_protocol_span_incomplete"
    for (const span of input.spans) {
      if (group.includes(span)) continue
      if (span.messageCount === 0) continue
      const spanEnd = span.startIndex + span.messageCount
      if (span.startIndex < end && spanEnd > sorted[0]!.startIndex) {
        return "lcm_provider_assembly_protocol_span_interleaved"
      }
    }
  }
  return undefined
}

function validateAssemblyPayload(input: {
  readonly payload: LcmPreparedProviderPayload
  readonly modelMessageCount: number
  readonly renderUnits: readonly LcmRenderUnit[]
}) {
  if (!Array.isArray(input.payload.modelMessages)) return "lcm_provider_assembly_model_messages_unbranded"
  if (input.modelMessageCount > 0 && input.payload.renderedSpans.length === 0) {
    return "lcm_provider_assembly_empty_spans"
  }
  if (input.payload.assemblyValidatorHash !== input.payload.renderInputManifest.assemblyValidatorHash) {
    return "lcm_provider_assembly_validator_hash_mismatch"
  }
  return validateRenderedSpans({
    spans: input.payload.renderedSpans,
    renderUnits: input.renderUnits,
    modelMessageCount: input.modelMessageCount,
    providerTransformHash: input.payload.renderInputManifest.providerTransformHash,
  })
}

export function validateLcmPreparedProviderPayloadForAssembly(input: {
  readonly payload: LcmPreparedProviderPayload
  readonly renderedMessageCount?: number
  readonly expectedRenderUnitIDs?: readonly string[]
}) {
  const modelMessageCount = input.renderedMessageCount ?? input.payload.modelMessages.length
  if (modelMessageCount > 0 && input.payload.renderedSpans.length === 0) {
    return invalidRequest("lcm_provider_assembly_empty_spans")
  }
  if (input.payload.assemblyValidatorHash !== input.payload.renderInputManifest.assemblyValidatorHash) {
    return invalidRequest("lcm_provider_assembly_validator_hash_mismatch")
  }
  if (input.expectedRenderUnitIDs) {
    const expected = new Set(input.expectedRenderUnitIDs)
    for (const span of input.payload.renderedSpans) {
      if (!expected.has(span.renderUnitID)) return invalidRequest("lcm_provider_assembly_span_unknown_unit")
    }
  }
  return undefined
}

function renderPrefixCounts(input: {
  readonly messages: readonly MessageV2.WithParts[]
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly stripMedia: boolean
  readonly expectedModelMessageCount?: number
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  return Effect.gen(function* () {
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_render_prefix_counts_canceled_before_fast_count",
    })
    const counts = [0]
    let total = 0
    for (const message of input.messages) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_render_prefix_counts_canceled_while_counting",
      })
      total += modelMessageCountForPreparedMessage({
        message,
        model: input.renderPreparation.model,
        stripMedia: input.stripMedia,
      })
      counts.push(total)
    }
    if (input.expectedModelMessageCount === undefined || total === input.expectedModelMessageCount) return counts

    const fallback = [0]
    for (let index = 1; index <= input.messages.length; index++) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_render_prefix_counts_canceled_while_fallback_counting",
      })
      const rendered = yield* MessageV2.toModelMessagesEffect(
        input.messages.slice(0, index),
        input.renderPreparation.model,
        {
          stripMedia: input.stripMedia,
        },
      )
      fallback.push(rendered.length)
    }
    return fallback
  })
}

function modelMessageCountForPreparedMessage(input: {
  readonly message: MessageV2.WithParts
  readonly model: LcmRawLeafRenderPreparationInput["model"]
  readonly stripMedia: boolean
}) {
  if (input.message.parts.length === 0) return 0
  if (input.message.info.role === "user") {
    return input.message.parts.some((part) => {
      if (part.type === "text") return !part.ignored
      if (part.type === "file") return part.mime !== "text/plain" && part.mime !== "application/x-directory"
      return part.type === "compaction" || part.type === "subtask"
    })
      ? 1
      : 0
  }

  const info = input.message.info
  if (
    info.error &&
    !(
      MessageV2.AbortedError.isInstance(info.error) &&
      input.message.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
    )
  ) {
    return 0
  }

  let hasAssistantModelPart = false
  let needsMediaFallback = false
  const supportsMediaInToolResults = modelSupportsMediaInToolResults(input.model)
  for (const part of input.message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      hasAssistantModelPart = true
      continue
    }
    if (part.type !== "tool") continue
    hasAssistantModelPart = true
    if (part.state.status !== "completed" || supportsMediaInToolResults || input.stripMedia) continue
    needsMediaFallback ||= (part.state.attachments ?? []).some((attachment) => MessageV2.isMedia(attachment.mime))
  }
  return hasAssistantModelPart ? 1 + (needsMediaFallback ? 1 : 0) : 0
}

function manifestWithAssemblyHashes(input: {
  readonly manifest: LcmRenderInputManifestV1
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly providerTransformHash: string
}) {
  const renderUnitProjection = input.renderUnits.map((unit) => ({
    renderUnitID: unit.renderUnitID,
    sourceKind: unit.sourceKind,
    sourceHandle: unit.sourceHandle,
    canonicalOrder: unit.canonicalOrder,
    effectiveOrder: unit.effectiveOrder,
    placementSlot: unit.placementSlot,
    requiredVisibilityHash: unit.requiredVisibilityHash,
    requiredForContinuation: unit.requiredForContinuation,
    provenanceHash: stableHash(unit.provenanceHandles),
  }))
  const protectedSpans = input.renderedSpans
    .filter((span) => span.protected)
    .map((span) => ({
      renderUnitID: span.renderUnitID,
      protocolSpanID: span.protocolSpanID,
      protectedReason: span.protectedReason,
      startIndex: span.startIndex,
      messageCount: span.messageCount,
      spanHash: span.spanHash,
    }))
  const assemblyValidatorHash = namespacedHash("lcm-assembly-validator-v1", {
    rendererVersion: input.manifest.rendererVersion,
    renderPreparationVersion: input.manifest.renderPreparationVersion,
    ruleVersion: "m35-render-unit-assembly-core",
  })
  return {
    ...input.manifest,
    sourceSelectionHash: namespacedHash("lcm-source-selection-v1", {
      renderUnits: renderUnitProjection,
      targetCurrentUser: input.renderUnits.find((unit) => unit.source.kind === "target_current_user")?.renderUnitID,
      protectedSpans,
      providerTransformHash: input.providerTransformHash,
      providerValidatorHash: input.manifest.providerValidatorHash,
    }),
    renderUnitOrderHash: namespacedHash(
      "lcm-render-unit-order-v1",
      input.renderUnits.map((unit) => unit.renderUnitID),
    ),
    effectivePlacementHash: namespacedHash(
      "lcm-effective-placement-v1",
      input.renderUnits.map((unit) => ({
        renderUnitID: unit.renderUnitID,
        effectiveOrder: unit.effectiveOrder,
        placementSlot: unit.placementSlot,
      })),
    ),
    protectedSpanHash: namespacedHash("lcm-protected-span-v1", protectedSpans),
    providerTransformHash: input.providerTransformHash,
    providerValidatorHash: input.manifest.providerValidatorHash || LCM_PROVIDER_VALIDATOR_PENDING_M39,
    assemblyValidatorHash,
  } satisfies LcmRenderInputManifestV1
}

async function loadThresholdSource(input: {
  db: Queryable
  conversationID: ConversationID
  artifactRoot?: string
  includeRawMessages?: boolean
  hiddenSourceMessageIDs?: readonly string[]
}): Promise<ThresholdSource> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_threshold_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_threshold_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: true,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_threshold_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const contextItems = rows.map(rowToItem)
  const rawEntries = input.includeRawMessages
    ? await loadRawLeafMessageEntries({
        db: input.db,
        conversationID: input.conversationID,
        contextItems,
      })
    : []
  const rawMessages = rawEntries.map((entry) => entry.message)
  const summaryModelMessages = await loadSummaryWrapperMessages({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
  })
  const markerModelMessages = await loadStandaloneLargeFileMarkerMessages({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
  })
  const visibilityProvenance = await loadVisibilityProvenance({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
    hiddenSourceMessageIDs: input.hiddenSourceMessageIDs ?? [],
  })
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const rawFallbackText = await loadRawFallbackText(input.db, input.conversationID, rows)
  const largeFileText = await loadLargeFileMarkerText(input.db, input.conversationID, rows)
  const fallbackText = new Map<ContextItemID, string>()
  for (const row of rows) {
    if (row.item_type === "raw_message")
      fallbackText.set(row.context_item_id, rawFallbackText.get(row.message_row_id!) ?? "")
    else if (row.item_type === "summary") {
      const summary = summaryMetadata.get(row.summary_id!)
      fallbackText.set(
        row.context_item_id,
        renderSummaryWrapper({
          summaryID: row.summary_id!,
          contentText: summary?.text ?? "",
          parentSummaryIDs: summary?.parentSummaryIDs,
          objectiveStatus: summary?.objectiveStatus,
          fallbackMode: summary?.fallbackMode,
          sourceTokenCount: summary?.sourceTokenCount,
          summaryTokenCount: summary?.summaryTokenCount,
        }),
      )
    } else if (row.item_type === "archive_stub") {
      fallbackText.set(
        row.context_item_id,
        renderArchiveStubWrapper({ summaryID: row.summary_id!, pointerID: row.pointer_id! }),
      )
    } else if (row.item_type === "large_file_marker") {
      fallbackText.set(row.context_item_id, largeFileText.get(row.file_id!) ?? `file:${row.file_id}`)
    } else {
      const cue = rowCuePayload(row)
      fallbackText.set(row.context_item_id, cue ? renderRetrievalCueModelText(cue, rowCueID(row)) : "")
    }
  }
  return {
    conversation,
    rows,
    contextItems,
    rawEntries,
    rawMessages,
    summaryModelMessages,
    markerModelMessages,
    visibilityProvenance,
    summaryMetadata,
    fallbackText,
  }
}

function selectLastUser(input: {
  readonly messages: readonly MessageV2.WithParts[]
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}) {
  const lastUserMessageID = input.renderPreparation.lastUserMessageID ?? input.renderPreparation.lastUser?.id
  const reconstructed =
    lastUserMessageID === undefined
      ? input.messages.findLast((message) => message.info.role === "user")?.info
      : input.messages.find((message) => message.info.role === "user" && message.info.id === lastUserMessageID)?.info
  if (!reconstructed || reconstructed.role !== "user") throw invalidRequest("lcm_raw_leaf_last_user_not_found")
  if (!input.renderPreparation.lastUser) return reconstructed
  if (
    input.renderPreparation.lastUser.id !== reconstructed.id ||
    input.renderPreparation.lastUser.sessionID !== reconstructed.sessionID
  ) {
    throw invalidRequest("lcm_raw_leaf_last_user_mismatch")
  }
  return {
    ...reconstructed,
    editorContext: input.renderPreparation.lastUser.editorContext,
  }
}

function cacheKeyForRow(input: {
  readonly row: ContextRow
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly providerID: string
  readonly modelID: string
  readonly text: string
  readonly contentKind: "message" | "summary" | "marker" | "cue"
  readonly promptVersion?: string
}) {
  const contentID =
    input.row.item_type === "raw_message"
      ? input.row.message_row_id!
      : input.row.item_type === "summary" || input.row.item_type === "archive_stub"
        ? input.row.summary_id!
        : input.row.item_type === "large_file_marker"
          ? input.row.file_id!
          : rowCueID(input.row)
  return createTokenCacheKey({
    mode: input.counter.mode,
    version: input.counter.version,
    providerID: input.providerID,
    modelID: input.modelID,
    contentKind: input.contentKind,
    contentID,
    contentSha256: stableHash(input.text),
    renderManifestHash: input.renderHash,
    promptVersion: input.promptVersion,
    wrapperVersion: `lcm-context-wrapper-v${LCM_TOKEN_BUDGET_CACHE_VERSION}`,
  })
}

function countContextItems(input: {
  readonly source: ThresholdSource
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly providerID: string
  readonly modelID: string
  readonly rawModelTexts: readonly string[]
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}): ThresholdContextItemCount[] {
  let rawIndex = 0
  const output: ThresholdContextItemCount[] = []
  for (const row of input.source.rows) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_threshold_canceled_while_counting_context",
    })
    const text =
      row.item_type === "raw_message"
        ? (input.rawModelTexts[rawIndex++] ?? input.source.fallbackText.get(row.context_item_id) ?? "")
        : (input.source.fallbackText.get(row.context_item_id) ?? "")
    const cacheKind =
      row.item_type === "raw_message"
        ? "message"
        : row.item_type === "summary" || row.item_type === "archive_stub"
          ? "summary"
          : row.item_type === "large_file_marker"
            ? "marker"
            : "cue"
    const cacheKey = cacheKeyForRow({
      row,
      counter: input.counter,
      renderHash: input.renderHash,
      providerID: input.providerID,
      modelID: input.modelID,
      text,
      contentKind: cacheKind,
      promptVersion:
        row.item_type === "summary" || row.item_type === "archive_stub"
          ? input.source.summaryMetadata.get(row.summary_id!)?.promptVersion
          : undefined,
    })
    const cached =
      row.cache_key === cacheKey && asNumber(row.cache_version) === LCM_TOKEN_BUDGET_CACHE_VERSION
        ? optionalNumber(row.token_count)
        : undefined
    const tokenCount = cached ?? input.counter.countText({ text, cacheKey })
    const summary = row.summary_id ? input.source.summaryMetadata.get(row.summary_id) : undefined
    output.push({
      row,
      tokenCount,
      cacheKey,
      lane: {
        itemType: row.item_type,
        tokenCount,
        summaryType: summary?.summaryType,
        summaryLevel: summary?.summaryLevel,
      },
    })
  }
  return output
}

function contextItemIDForRenderUnit(input: {
  readonly unit: LcmRenderUnit
  readonly rawRowByMessageID: ReadonlyMap<MessageRowID, ContextRow>
}) {
  if (
    input.unit.source.kind === "raw_message" ||
    input.unit.source.kind === "summary" ||
    input.unit.source.kind === "archive_stub" ||
    input.unit.source.kind === "large_file_marker" ||
    input.unit.source.kind === "retrieval_cue"
  ) {
    return input.unit.source.contextItemID
  }
  if (input.unit.source.kind === "target_current_user" && input.unit.source.messageRowID) {
    return input.rawRowByMessageID.get(input.unit.source.messageRowID)?.context_item_id
  }
  return undefined
}

function renderUnitSnapshotItems(input: {
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly rawRowByMessageID: ReadonlyMap<MessageRowID, ContextRow>
}) {
  const items = new Map<ContextItemID, ProviderSafeSnapshotItem>()
  for (const unit of input.renderUnits) {
    const contextItemID = contextItemIDForRenderUnit({ unit, rawRowByMessageID: input.rawRowByMessageID })
    if (!contextItemID) continue
    items.set(contextItemID, {
      contextItemID,
      renderUnitID: unit.renderUnitID,
      canonicalOrder: unit.canonicalOrder,
      effectiveOrder: unit.effectiveOrder,
      placementSlot: unit.placementSlot,
    })
  }
  return items
}

function renderUnitSnapshotItemsFromContextItems(input: {
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly contextItems: readonly ContextItem[]
}) {
  const rawContextItemByMessageID = new Map(
    input.contextItems
      .filter((item): item is Extract<ContextItem, { itemType: "raw_message" }> => item.itemType === "raw_message")
      .map((item) => [item.messageRowID, item.contextItemID] as const),
  )
  const items = new Map<ContextItemID, ProviderSafeSnapshotItem>()
  for (const unit of input.renderUnits) {
    const contextItemID =
      unit.source.kind === "target_current_user" && unit.source.messageRowID
        ? rawContextItemByMessageID.get(unit.source.messageRowID)
        : "contextItemID" in unit.source
          ? unit.source.contextItemID
          : undefined
    if (!contextItemID) continue
    items.set(contextItemID, {
      contextItemID,
      renderUnitID: unit.renderUnitID,
      canonicalOrder: unit.canonicalOrder,
      effectiveOrder: unit.effectiveOrder,
      placementSlot: unit.placementSlot,
    })
  }
  return items
}

function targetCurrentUserForThreshold(input: {
  readonly source: ThresholdSource
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly thresholdInput: LcmThresholdInput
}) {
  const lastUser = selectLastUser({ messages: input.source.rawMessages, renderPreparation: input.renderPreparation })
  const entry = input.source.rawEntries.find(
    (candidate) =>
      candidate.sourceRow.source_session_id === lastUser.sessionID &&
      candidate.sourceRow.source_message_id === lastUser.id,
  )
  if (!entry)
    throw missingSource("lcm_threshold_target_current_user_unproven", input.source.conversation.conversation_id)
  const provided = input.thresholdInput.targetCurrentUser
  if (
    provided &&
    (provided.sourceSessionID !== lastUser.sessionID ||
      provided.sourceMessageID !== lastUser.id ||
      (provided.messageRowID !== undefined && provided.messageRowID !== entry.item.messageRowID))
  ) {
    throw invalidRequest("lcm_threshold_target_current_user_mismatch")
  }
  const promptOperationID =
    provided?.promptOperationID ??
    (`op_lcm_threshold_${stableHash({
      conversationID: input.source.conversation.conversation_id,
      sourceSessionID: lastUser.sessionID,
      sourceMessageID: lastUser.id,
      messageRowID: entry.item.messageRowID,
      visibilityHash: input.renderPreparation.messageVisibility?.hash,
    }).slice(0, 24)}` as OperationID)
  return {
    lastUser,
    targetCurrentUser: {
      sourceSessionID: lastUser.sessionID,
      sourceMessageID: lastUser.id,
      messageRowID: entry.item.messageRowID,
      promptOperationID,
      visibilityBaseMessageID: provided?.visibilityBaseMessageID || lastUser.id,
    } satisfies LcmAssemblyInput["targetCurrentUser"],
  }
}

function targetMessageRowIDForSoftBacklog(input: { source: ThresholdSource; thresholdInput: LcmThresholdInput }) {
  if (input.thresholdInput.targetCurrentUser?.messageRowID) return input.thresholdInput.targetCurrentUser.messageRowID
  if (!hasRawLeafThresholdPreparation(input.thresholdInput) || !input.thresholdInput.renderPreparation) return undefined
  const renderPreparation = input.thresholdInput.renderPreparation
  const sourceMessageID = renderPreparation.lastUserMessageID ?? renderPreparation.lastUser?.id
  if (!sourceMessageID) return undefined
  return input.source.rawEntries.find((entry) => entry.sourceRow.source_message_id === sourceMessageID)?.item
    .messageRowID
}

function countContextItemsFromRenderUnits(input: {
  readonly source: ThresholdSource
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly modelMessages: readonly unknown[]
  readonly providerID: string
  readonly modelID: string
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  const rawRowByMessageID = new Map(
    input.source.rows
      .filter((row) => row.item_type === "raw_message" && row.message_row_id)
      .map((row) => [row.message_row_id!, row] as const),
  )
  const rowByContextItemID = new Map(input.source.rows.map((row) => [row.context_item_id, row] as const))
  const spanByRenderUnitID = new Map(input.renderedSpans.map((span) => [span.renderUnitID, span] as const))
  const output: ThresholdContextItemCount[] = []
  for (const unit of input.renderUnits) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_threshold_canceled_while_counting_render_units",
    })
    const contextItemID = contextItemIDForRenderUnit({ unit, rawRowByMessageID })
    if (!contextItemID) throw invalidRequest("lcm_threshold_render_unit_context_item_missing")
    const row = rowByContextItemID.get(contextItemID)
    if (!row) throw invalidRequest("lcm_threshold_render_unit_context_row_missing")
    const span = spanByRenderUnitID.get(unit.renderUnitID)
    if (!span) throw invalidRequest("lcm_threshold_render_unit_span_missing")
    const text =
      span.messageCount === 0
        ? ""
        : stableTokenText(
            normalizeModelMessagesForRawLeafParity(
              input.modelMessages.slice(span.startIndex, span.startIndex + span.messageCount),
            ),
          )
    const cacheKind =
      row.item_type === "raw_message"
        ? "message"
        : row.item_type === "summary" || row.item_type === "archive_stub"
          ? "summary"
          : row.item_type === "large_file_marker"
            ? "marker"
            : "cue"
    const cacheKey = cacheKeyForRow({
      row,
      counter: input.counter,
      renderHash: input.renderHash,
      providerID: input.providerID,
      modelID: input.modelID,
      text,
      contentKind: cacheKind,
      promptVersion:
        row.item_type === "summary" || row.item_type === "archive_stub"
          ? input.source.summaryMetadata.get(row.summary_id!)?.promptVersion
          : undefined,
    })
    const cached =
      row.cache_key === cacheKey && asNumber(row.cache_version) === LCM_TOKEN_BUDGET_CACHE_VERSION
        ? optionalNumber(row.token_count)
        : undefined
    const tokenCount = cached ?? input.counter.countText({ text, cacheKey })
    const summary = row.summary_id ? input.source.summaryMetadata.get(row.summary_id) : undefined
    output.push({
      row,
      tokenCount,
      cacheKey,
      lane: {
        itemType: row.item_type,
        tokenCount,
        summaryType: summary?.summaryType,
        summaryLevel: summary?.summaryLevel,
      },
    })
  }
  return output.sort((left, right) => asNumber(left.row.item_order) - asNumber(right.row.item_order))
}

function countAssemblyActiveTokens(input: {
  readonly modelMessages: readonly unknown[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  let total = 0
  for (const span of input.renderedSpans) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_provider_assembly_canceled_while_counting_active_tokens",
    })
    if (span.messageCount === 0) continue
    const text = stableTokenText(
      normalizeModelMessagesForRawLeafParity(
        input.modelMessages.slice(span.startIndex, span.startIndex + span.messageCount),
      ),
    )
    total += deterministicFallbackTokenCount(text)
  }
  return total
}

function countThresholdFromAssembly(input: {
  readonly source: ThresholdSource
  readonly thresholdInput: LcmThresholdInput
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly renderOptions: LcmAssemblyInput["renderOptions"]
  readonly counter: LcmTokenCounter
  readonly abortSignal?: AbortSignal
}) {
  return Effect.gen(function* () {
    const { lastUser, targetCurrentUser } = targetCurrentUserForThreshold({
      source: input.source,
      renderPreparation: input.renderPreparation,
      thresholdInput: input.thresholdInput,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_before_render_units",
    })
    const renderUnits = withRenderUnitOrigins(
      buildRenderUnits({
        conversationID: input.source.conversation.conversation_id,
        contextItems: input.source.contextItems,
        rawEntries: input.source.rawEntries,
        summaryModelMessages: input.source.summaryModelMessages,
        markerModelMessages: input.source.markerModelMessages,
        visibilityProvenance: input.source.visibilityProvenance,
        renderPreparation: input.renderPreparation,
        targetCurrentUser,
        abortSignal: input.abortSignal,
      }),
    )
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_render_units",
    })
    const prepared = yield* prepareKiloModelInput({
      ...input.renderPreparation,
      messages: renderUnits.map((unit) => unit.message),
      lastUser,
      lcmActive: true,
      stripMedia: input.renderOptions.stripMedia,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_render_preparation",
    })
    const prefixCounts = yield* renderPrefixCounts({
      messages: prepared.messages,
      renderPreparation: input.renderPreparation,
      stripMedia: input.renderOptions.stripMedia,
      expectedModelMessageCount: prepared.modelMessages.length,
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_prefix_counts",
    })
    const providerFamily = classifyLcmProviderFamily({
      providerID: input.renderPreparation.model.providerID,
      modelID: input.renderPreparation.model.id,
      apiNpm: input.renderPreparation.model.api.npm,
      apiID: input.renderPreparation.model.api.id,
      interleaved: input.renderPreparation.model.capabilities?.interleaved === true,
    })
    const renderedSpans = renderUnits.map((unit, index) =>
      renderedSpanForUnit({
        unit,
        startIndex: prefixCounts[index] ?? 0,
        messageCount: (prefixCounts[index + 1] ?? 0) - (prefixCounts[index] ?? 0),
        providerFamily,
        providerTransformHash: prepared.renderInputManifest.providerTransformHash,
        renderPreparation: input.renderPreparation,
      }),
    )
    const renderInputManifest = manifestWithAssemblyHashes({
      manifest: prepared.renderInputManifest,
      renderUnits,
      renderedSpans,
      providerTransformHash: prepared.renderInputManifest.providerTransformHash,
    })
    const aliasDiagnostic = validateRenderOptionAliases({
      renderOptions: input.renderOptions,
      manifest: renderInputManifest,
    })
    if (aliasDiagnostic) throw invalidRequest(aliasDiagnostic)
    const renderHash = renderManifestHash(renderInputManifest)
    const rawRowByMessageID = new Map(
      input.source.rows
        .filter((row) => row.item_type === "raw_message" && row.message_row_id)
        .map((row) => [row.message_row_id!, row] as const),
    )
    const activeTokens = countAssemblyActiveTokens({
      modelMessages: prepared.modelMessages,
      renderedSpans,
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
    })
    return {
      counted: countContextItemsFromRenderUnits({
        source: input.source,
        counter: input.counter,
        renderHash,
        renderUnits,
        renderedSpans,
        modelMessages: prepared.modelMessages,
        providerID: input.renderOptions.providerID,
        modelID: input.renderOptions.modelID,
        abortSignal: input.abortSignal,
        operationID: targetCurrentUser.promptOperationID,
      }),
      systemText: stableTokenText(prepared.system),
      toolText: stableTokenText(prepared.tools),
      renderHash,
      providerSafe: {
        renderInputManifest,
        items: renderUnitSnapshotItems({ renderUnits, rawRowByMessageID }),
      } satisfies ProviderSafeSnapshotEvidence,
      assemblyCache: {
        conversationID: input.source.conversation.conversation_id,
        lifecycleState: input.source.conversation.lifecycle_state as LcmLifecycleState,
        contextItems: input.source.contextItems,
        targetCurrentUserHash: stableHash(targetCurrentUser),
        renderOptionsHash: stableHash(input.renderOptions),
        renderUnits,
        prepared,
        renderedSpans,
        renderInputManifest,
        activeTokens,
        providerSafe: {
          renderInputManifest,
          items: renderUnitSnapshotItems({ renderUnits, rawRowByMessageID }),
        },
      } satisfies ThresholdAssemblyCache,
    }
  })
}

function overheadCacheKey(input: {
  readonly counter: LcmTokenCounter
  readonly providerID: string
  readonly modelID: string
  readonly renderHash: string
  readonly contentKind: "prompt" | "tool_schema"
  readonly text: string
}) {
  return createTokenCacheKey({
    mode: input.counter.mode,
    version: input.counter.version,
    providerID: input.providerID,
    modelID: input.modelID,
    contentKind: input.contentKind,
    contentSha256: stableHash(input.text),
    renderManifestHash: input.renderHash,
  })
}

async function persistThresholdCounts(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly counted: readonly ThresholdContextItemCount[]
  readonly decision: LcmThresholdDecision
  readonly counter: LcmTokenCounter
  readonly providerSafe?: ProviderSafeSnapshotEvidence
  readonly providerContextLimit: number
  readonly providerInputLimit?: number
  readonly providerOutputLimit?: number
  readonly providerTransformOverheadReserveTokens?: number
  readonly outputReserve: number
  readonly writeSnapshot?: boolean
}) {
  const now = Date.now()
  const changed = input.counted.filter(
    (item) =>
      optionalNumber(item.row.token_count) !== item.tokenCount ||
      item.row.cache_key !== item.cacheKey ||
      optionalNumber(item.row.cache_version) !== LCM_TOKEN_BUDGET_CACHE_VERSION,
  )
  if (changed.length > 0) {
    const values: string[] = []
    const params: unknown[] = []
    for (const item of changed) {
      const offset = params.length
      values.push(
        `($${offset + 1}::text, $${offset + 2}::integer, $${offset + 3}::text, ` +
          `$${offset + 4}::integer, $${offset + 5}::double precision)`,
      )
      params.push(item.row.context_item_id, item.tokenCount, item.cacheKey, LCM_TOKEN_BUDGET_CACHE_VERSION, now)
    }
    await input.db.query(
      `
        UPDATE lcm_context_items AS item
        SET token_count = counted.token_count,
            cache_key = counted.cache_key,
            cache_version = counted.cache_version,
            updated_at_ms = counted.updated_at_ms
        FROM (VALUES ${values.join(",")}) AS counted(
          context_item_id,
          token_count,
          cache_key,
          cache_version,
          updated_at_ms
        )
        WHERE item.context_item_id = counted.context_item_id
          AND (
            item.token_count IS DISTINCT FROM counted.token_count
            OR item.cache_key IS DISTINCT FROM counted.cache_key
            OR item.cache_version IS DISTINCT FROM counted.cache_version
          )
      `,
      params,
    )
  }
  if (input.writeSnapshot === false) return
  await writeContextSnapshot({
    db: input.db,
    conversationID: input.conversationID,
    strategy: input.decision.strategy,
    reason: "threshold",
    nowMs: now,
    threshold: {
      activeTokens: input.decision.activeTokens,
      hardLimit: input.decision.hardLimit,
      softThreshold: input.decision.softThreshold,
      freshTailTokens: input.decision.freshTailTokens,
      softBacklogTokens: input.decision.softBacklogTokens,
      softBacklogItemCount: input.decision.softBacklogItemCount,
      softBacklogLargestSourceTokens: input.decision.softBacklogLargestSourceTokens,
      freshTailRawTokens: input.decision.freshTailRawTokens,
      freshTailRawItemCount: input.decision.freshTailRawItemCount,
      unconsumedRawTokens: input.decision.unconsumedRawTokens,
      unconsumedRawItemCount: input.decision.unconsumedRawItemCount,
      protectedTailRawTokens: input.decision.protectedTailRawTokens,
      protectedTailRawItemCount: input.decision.protectedTailRawItemCount,
      rawLaneTokens: input.decision.rawLaneTokens,
      hardFillRatio: input.decision.hardFillRatio,
      rawLaneRatio: input.decision.rawLaneRatio,
      softBacklogRatio: input.decision.softBacklogRatio,
      softPressureReason: input.decision.softPressureReason,
      laneLatchDiagnostics: input.decision.laneLatchDiagnostics,
      lanes: input.decision.lanes,
      tokenCounterMode: input.counter.mode,
      tokenCounterVersion: input.counter.version,
      providerContextLimit: input.providerContextLimit,
      providerInputLimit: input.providerInputLimit,
      providerOutputLimit: input.providerOutputLimit,
      outputReserve: input.outputReserve,
      budgetStatus: input.decision.budgetStatus,
      providerTransformOverheadReserveTokens: input.providerTransformOverheadReserveTokens,
    },
    providerSafe: input.providerSafe,
  })
}

async function count(db: Queryable, sql: string, params: unknown[]) {
  const row = (await db.query<{ count: number | string | bigint }>(sql, params)).rows[0]
  return asNumber(row?.count)
}

async function loadConsumedRawMessageRowIDs(db: Queryable, conversationID: ConversationID) {
  const rows = (
    await db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_context_item_consumption
        WHERE conversation_id = $1
      `,
      [conversationID],
    )
  ).rows
  return new Set(rows.map((row) => row.message_row_id))
}

async function findConversation(db: Queryable, conversationID: ConversationID) {
  return (
    await db.query<ConversationRow>(
      `
        SELECT c.conversation_id,
               c.lifecycle_state,
               c.boundary_metadata_json,
               COALESCE(
                 (
                   SELECT snapshot.strategy
                   FROM lcm_context_snapshots snapshot
                   WHERE snapshot.conversation_id = c.conversation_id
                   ORDER BY snapshot.created_at_ms DESC, snapshot.snapshot_id DESC
                   LIMIT 1
                 ),
                 (
                   SELECT summary.strategy
                   FROM lcm_summaries summary
                   WHERE summary.conversation_id = c.conversation_id
                   ORDER BY summary.created_at_ms DESC, summary.summary_id DESC
                   LIMIT 1
                 ),
                 'upward'
               ) AS strategy
        FROM lcm_conversations c
        WHERE c.conversation_id = $1
      `,
      [conversationID],
    )
  ).rows[0]
}

async function findSourceMessageRowID(input: {
  db: Queryable
  conversationID: ConversationID
  sourceSessionID?: string
  sourceMessageID: string
}) {
  return (
    await input.db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_messages
        WHERE conversation_id = $1
          AND source_message_id = $2
          AND ($3::text IS NULL OR source_session_id = $3)
        LIMIT 1
      `,
      [input.conversationID, input.sourceMessageID, input.sourceSessionID ?? null],
    )
  ).rows[0]?.message_row_id
}

async function loadContextRows(
  db: Queryable,
  conversationID: ConversationID,
  options?: { readonly includeInactiveCues?: boolean },
) {
  return (
    await db.query<ContextRow>(
      `
        SELECT *
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND (
            $2::boolean
            OR item_type <> 'retrieval_cue'
            OR cue_lifecycle_state = 'active'
          )
        ORDER BY item_order, context_item_id
      `,
      [conversationID, options?.includeInactiveCues === true],
    )
  ).rows
}

function validateOrder(rows: readonly ContextRow[]) {
  const seen = new Set<number>()
  for (let index = 0; index < rows.length; index++) {
    const order = asNumber(rows[index]!.item_order)
    if (order !== index + 1 || seen.has(order)) return false
    seen.add(order)
  }
  return true
}

function isRetrievalCuePayload(value: unknown): value is LcmRetrievalCuePayload {
  if (!isObject(value)) return false
  return (
    !("cueID" in value) &&
    typeof value.query === "string" &&
    typeof value.cueText === "string" &&
    Array.isArray(value.summaryIDs) &&
    value.summaryIDs.every((item) => typeof item === "string") &&
    Array.isArray(value.fileIDs) &&
    value.fileIDs.every((item) => typeof item === "string") &&
    Array.isArray(value.messageRowIDs) &&
    value.messageRowIDs.every((item) => typeof item === "string") &&
    Array.isArray(value.partRowIDs) &&
    value.partRowIDs.every((item) => typeof item === "string") &&
    typeof value.tokenCount === "number" &&
    Number.isInteger(value.tokenCount) &&
    value.tokenCount >= 0 &&
    typeof value.generatedAt === "string"
  )
}

async function validateSummaryReference(db: Queryable, conversationID: ConversationID, summaryID: SummaryID) {
  const summaryRows = (
    await db.query<{ summary_id: SummaryID }>(
      "SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1 AND summary_id = $2",
      [conversationID, summaryID],
    )
  ).rows
  if (summaryRows.length !== 1) return false
  const provenanceCount = await count(
    db,
    `
      SELECT (
        (SELECT count(*) FROM lcm_summary_messages WHERE summary_id = $1) +
        (SELECT count(*) FROM lcm_summary_parents WHERE summary_id = $1)
      )::int AS count
    `,
    [summaryID],
  )
  return provenanceCount > 0
}

async function validateRawMessageReference(input: {
  db: Queryable
  conversationID: ConversationID
  messageRowID: MessageRowID
  artifactRoot?: string
}) {
  const messageCount = await count(
    input.db,
    "SELECT count(*)::int AS count FROM lcm_messages WHERE conversation_id = $1 AND message_row_id = $2",
    [input.conversationID, input.messageRowID],
  )
  if (messageCount !== 1) return false
  const partCount = await count(
    input.db,
    "SELECT count(*)::int AS count FROM lcm_message_parts WHERE conversation_id = $1 AND message_row_id = $2",
    [input.conversationID, input.messageRowID],
  )
  if (partCount <= 0) return false
  const lcmFileParts = (
    await input.db.query<{ content_file_id: LcmFileID }>(
      `
        SELECT content_file_id
        FROM lcm_message_parts
        WHERE conversation_id = $1
          AND message_row_id = $2
          AND content_storage_kind = 'lcm_file'
          AND content_file_id IS NOT NULL
      `,
      [input.conversationID, input.messageRowID],
    )
  ).rows
  for (const part of lcmFileParts) {
    const file = await validateFileReference({
      db: input.db,
      conversationID: input.conversationID,
      fileID: part.content_file_id,
      artifactRoot: input.artifactRoot,
    })
    if (!file.ok) return false
  }
  return true
}

async function validateFileReference(input: {
  db: Queryable
  conversationID: ConversationID
  fileID: LcmFileID
  artifactRoot?: string
}) {
  const row = (
    await input.db.query<FileRow>(
      `
        SELECT file_id, conversation_id, source_kind, boundary_metadata_json, artifact_storage_kind,
               artifact_path, artifact_byte_count, artifact_content_sha256
        FROM lcm_large_files
        WHERE conversation_id = $1 AND file_id = $2
      `,
      [input.conversationID, input.fileID],
    )
  ).rows[0]
  if (!row) return { ok: false, reason: "file_missing" }

  if (row.source_kind === "path" && !isCompleteBoundaryMetadataV1(jsonValue(row.boundary_metadata_json))) {
    return { ok: false, reason: "file_boundary_incomplete" }
  }

  if (row.artifact_storage_kind === "none") return { ok: true }
  if (!row.artifact_path || !row.artifact_content_sha256) return { ok: false, reason: "artifact_metadata_incomplete" }
  const pathValidation = validateArtifactPath(row.artifact_path)
  if (!pathValidation.ok) return { ok: false, reason: pathValidation.reason ?? "artifact_path_invalid" }
  if (!input.artifactRoot) return { ok: true }

  const artifact = await readAndValidateLcmArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath: row.artifact_path,
    byteCount: asNumber(row.artifact_byte_count),
    sha256: row.artifact_content_sha256,
  })
  return artifact.ok ? { ok: true } : { ok: false, reason: artifact.reason }
}

async function cueAllowedConversationIDs(db: Queryable, conversationID: ConversationID) {
  const rows = (
    await db.query<{ conversation_id: ConversationID }>(
      `
        WITH RECURSIVE lineage(conversation_id, parent_conversation_id) AS (
          SELECT conversation_id, parent_conversation_id
          FROM lcm_conversations
          WHERE conversation_id = $1
          UNION ALL
          SELECT parent.conversation_id, parent.parent_conversation_id
          FROM lcm_conversations parent
          JOIN lineage current ON current.parent_conversation_id = parent.conversation_id
        )
        SELECT conversation_id FROM lineage
      `,
      [conversationID],
    )
  ).rows
  return rows.map((row) => row.conversation_id)
}

async function validateCueReferences(db: Queryable, conversationID: ConversationID, payload: LcmRetrievalCuePayload) {
  const allowed = await cueAllowedConversationIDs(db, conversationID)
  if (allowed.length === 0) return false
  const allowedSql = allowed.map((_, index) => `$${index + 1}`).join(", ")
  for (const summaryID of payload.summaryIDs) {
    const summaryCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_summaries WHERE conversation_id IN (${allowedSql}) AND summary_id = $${allowed.length + 1}`,
      [...allowed, summaryID],
    )
    if (summaryCount !== 1) return false
  }
  for (const fileID of payload.fileIDs) {
    const fileCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_large_files WHERE conversation_id IN (${allowedSql}) AND file_id = $${allowed.length + 1}`,
      [...allowed, fileID],
    )
    if (fileCount !== 1) return false
  }
  for (const messageRowID of payload.messageRowIDs) {
    const messageCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_messages WHERE conversation_id IN (${allowedSql}) AND message_row_id = $${allowed.length + 1}`,
      [...allowed, messageRowID],
    )
    if (messageCount !== 1) return false
  }
  for (const partRowID of payload.partRowIDs) {
    const partCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_message_parts WHERE conversation_id IN (${allowedSql}) AND part_row_id = $${allowed.length + 1}`,
      [...allowed, partRowID],
    )
    if (partCount !== 1) return false
  }
  return true
}

function sortedUniqueStrings(values: Iterable<string>) {
  return [...new Set([...values].filter((value) => typeof value === "string" && value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function jsonStringArray(value: unknown) {
  const parsed = jsonValue(value)
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
}

function providerRequestSnapshotProtectionHash(input: {
  readonly snapshots: readonly Pick<ProviderRequestSnapshotRow, "request_snapshot_id" | "cue_ids_json">[]
  readonly protectedCueIDs: readonly string[]
}) {
  return stableHash({
    namespace: "lcm-request-snapshot-protection-v1",
    snapshots: input.snapshots.map((snapshot) => ({
      requestSnapshotID: snapshot.request_snapshot_id,
      cueIDs: sortedUniqueStrings(jsonStringArray(snapshot.cue_ids_json)),
    })),
    protectedCueIDs: sortedUniqueStrings(input.protectedCueIDs),
  })
}

async function expireStaleProviderRequestSnapshots(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly nowMs: number
}) {
  await input.db.query(
    `
      UPDATE lcm_provider_request_snapshots
      SET status = 'expired',
          terminal_at_ms = $2
      WHERE conversation_id = $1
        AND status = 'in_flight'
        AND expires_at_ms <= $2
    `,
    [input.conversationID, input.nowMs],
  )
}

async function loadInFlightProviderRequestSnapshots(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
}) {
  return (
    await input.db.query<ProviderRequestSnapshotRow>(
      `
        SELECT *
        FROM lcm_provider_request_snapshots
        WHERE conversation_id = $1
          AND status = 'in_flight'
        ORDER BY request_snapshot_id
      `,
      [input.conversationID],
    )
  ).rows
}

async function requestSnapshotProtectionForConversation(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly nowMs: number
}) {
  await expireStaleProviderRequestSnapshots(input)
  const snapshots = await loadInFlightProviderRequestSnapshots(input)
  const protectedCueIDs = sortedUniqueStrings(snapshots.flatMap((snapshot) => jsonStringArray(snapshot.cue_ids_json)))
  return {
    snapshots,
    protectedCueIDs,
    requestSnapshotProtectionHash: providerRequestSnapshotProtectionHash({ snapshots, protectedCueIDs }),
  }
}

function providerRequestSnapshotID() {
  return `reqsnap_${createOperationID().slice(3)}`
}

function cueGenerationID() {
  return `cuegen_${createOperationID().slice(3)}`
}

function cueRowID() {
  return `cue_${createOperationID().slice(3)}`
}

function selectedCueIDs(renderUnits: readonly LcmRenderUnit[]) {
  return sortedUniqueStrings(
    renderUnits.flatMap((unit) =>
      unit.source.kind === "retrieval_cue" && unit.source.cueLifecycleState === "active" ? [unit.source.cueID] : [],
    ),
  )
}

function selectedRenderUnitIDs(renderUnits: readonly LcmRenderUnit[]) {
  const seen = new Set<string>()
  const ordered = [...renderUnits].sort((left, right) => {
    if (left.effectiveOrder !== right.effectiveOrder) return left.effectiveOrder - right.effectiveOrder
    if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
    return left.renderUnitID.localeCompare(right.renderUnitID)
  })
  const output: string[] = []
  for (const unit of ordered) {
    if (seen.has(unit.renderUnitID)) continue
    seen.add(unit.renderUnitID)
    output.push(unit.renderUnitID)
  }
  return output
}

function providerRequestSnapshotItems(renderUnits: readonly LcmRenderUnit[]) {
  const seen = new Set<string>()
  const ordered = [...renderUnits].sort((left, right) => {
    if (left.effectiveOrder !== right.effectiveOrder) return left.effectiveOrder - right.effectiveOrder
    if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
    return left.renderUnitID.localeCompare(right.renderUnitID)
  })
  const output: Array<{
    renderUnitID: string
    contextItemID: ContextItemID
    itemType: ContextItemType
    messageRowID?: MessageRowID
    sourceKind: string
    itemOrder: number
  }> = []
  for (const unit of ordered) {
    if (seen.has(unit.renderUnitID) || !("contextItemID" in unit.source)) continue
    seen.add(unit.renderUnitID)
    output.push({
      renderUnitID: unit.renderUnitID,
      contextItemID: unit.source.contextItemID,
      itemType: unit.source.kind,
      ...(unit.source.kind === "raw_message" ? { messageRowID: unit.source.messageRowID } : {}),
      sourceKind: unit.sourceKind,
      itemOrder: output.length,
    })
  }
  return output
}

async function insertProviderRequestSnapshotItems(input: {
  readonly db: Queryable
  readonly requestSnapshotID: string
  readonly conversationID: ConversationID
  readonly renderUnits: readonly LcmRenderUnit[]
}) {
  const items = providerRequestSnapshotItems(input.renderUnits)
  if (items.length === 0) return
  const values: string[] = []
  const params: unknown[] = []
  for (const item of items) {
    const offset = params.length
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, ` +
        `$${offset + 6}, $${offset + 7}, $${offset + 8})`,
    )
    params.push(
      input.requestSnapshotID,
      input.conversationID,
      item.renderUnitID,
      item.contextItemID,
      item.itemType,
      item.messageRowID ?? null,
      item.sourceKind,
      item.itemOrder,
    )
  }
  await input.db.query(
    `
      INSERT INTO lcm_provider_request_snapshot_items (
        request_snapshot_id,
        conversation_id,
        render_unit_id,
        context_item_id,
        item_type,
        message_row_id,
        source_kind,
        item_order
      )
      VALUES ${values.join(",")}
      ON CONFLICT (request_snapshot_id, render_unit_id) DO NOTHING
    `,
    params,
  )
}

async function createProviderRequestSnapshot(input: {
  readonly db: Queryable
  readonly requestSnapshotID?: string
  readonly operationID: OperationID
  readonly conversationID: ConversationID
  readonly sourceSessionID: string
  readonly providerID: string
  readonly modelID: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly manifest: LcmRenderInputManifestV1
  readonly nowMs: number
}) {
  const requestSnapshotID = input.requestSnapshotID ?? providerRequestSnapshotID()
  await input.db.query(
    `
      INSERT INTO lcm_provider_request_snapshots (
        request_snapshot_id,
        operation_id,
        conversation_id,
        source_session_id,
        provider_id,
        model_id,
        status,
        cue_ids_json,
        render_unit_ids_json,
        source_selection_hash,
        request_snapshot_protection_hash,
        visibility_hash,
        protected_span_hash,
        provider_transform_hash,
        provider_validator_hash,
        created_at_ms,
        expires_at_ms,
        terminal_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 'in_flight',
        $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, NULL, $14, $15, NULL
      )
    `,
    [
      requestSnapshotID,
      input.operationID,
      input.conversationID,
      input.sourceSessionID,
      input.providerID,
      input.modelID,
      JSON.stringify(selectedCueIDs(input.renderUnits)),
      JSON.stringify(selectedRenderUnitIDs(input.renderUnits)),
      input.manifest.sourceSelectionHash,
      input.manifest.requestSnapshotProtectionHash,
      input.manifest.messageVisibilityHash,
      input.manifest.protectedSpanHash,
      input.manifest.providerTransformHash,
      input.nowMs,
      input.nowMs + LCM_PROVIDER_REQUEST_SNAPSHOT_TTL_MS,
    ],
  )
  await insertProviderRequestSnapshotItems({
    db: input.db,
    requestSnapshotID,
    conversationID: input.conversationID,
    renderUnits: input.renderUnits,
  })
  return requestSnapshotID
}

export async function finalizeProviderRequestSnapshotRow(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshotID: string
  readonly status: LcmProviderRequestSnapshotTerminalStatus
  readonly conversationID?: ConversationID
  readonly nowMs?: number
}) {
  const now = input.nowMs ?? Date.now()
  const result = await input.db.query<{ request_snapshot_id: string }>(
    `
      UPDATE lcm_provider_request_snapshots
      SET status = $2,
          terminal_at_ms = $3
      WHERE request_snapshot_id = $1
        AND status = 'in_flight'
        AND ($4::text IS NULL OR conversation_id = $4)
      RETURNING request_snapshot_id
    `,
    [input.requestSnapshotID, input.status, now, input.conversationID ?? null],
  )
  if (result.rows.length !== 1) {
    throw invalidRequest("lcm_provider_request_snapshot_terminalization_unavailable")
  }
  if (input.status !== "resolved") return
  await input.db.query(
    `
      INSERT INTO lcm_context_item_consumption (
        conversation_id,
        context_item_id,
        message_row_id,
        first_request_snapshot_id,
        first_operation_id,
        first_consumed_at_ms
      )
      SELECT item.conversation_id,
             item.context_item_id,
             item.message_row_id,
             snapshot.request_snapshot_id,
             snapshot.operation_id,
             $2
      FROM lcm_provider_request_snapshot_items item
      JOIN lcm_provider_request_snapshots snapshot
        ON snapshot.request_snapshot_id = item.request_snapshot_id
      WHERE item.request_snapshot_id = $1
        AND item.item_type = 'raw_message'
        AND item.context_item_id IS NOT NULL
        AND item.message_row_id IS NOT NULL
      ON CONFLICT (conversation_id, message_row_id) DO NOTHING
    `,
    [input.requestSnapshotID, now],
  )
}

export async function recordProviderRequestSnapshotFinalValidationRow(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshotID: string
  readonly providerValidatorHash: string
  readonly providerFamily?: LcmRenderedSpanProviderFamily
  readonly providerTransformOverheadTokenCount?: number
  readonly conversationID?: ConversationID
}) {
  const result = await input.db.query<ProviderRequestSnapshotRow>(
    `
      UPDATE lcm_provider_request_snapshots
      SET provider_validator_hash = $2
      WHERE request_snapshot_id = $1
        AND status = 'in_flight'
        AND ($3::text IS NULL OR conversation_id = $3)
      RETURNING *
    `,
    [input.requestSnapshotID, input.providerValidatorHash, input.conversationID ?? null],
  )
  if (result.rows.length !== 1) {
    throw invalidRequest("lcm_provider_request_snapshot_final_validation_unavailable")
  }
  if (input.providerFamily && input.providerTransformOverheadTokenCount !== undefined) {
    const requestSnapshot = result.rows[0]!
    const observedTokens = clampProviderTransformOverhead({
      providerContextLimit: Number.MAX_SAFE_INTEGER,
      tokens: input.providerTransformOverheadTokenCount,
    })
    await input.db.query(
      `
        INSERT INTO lcm_provider_transform_overheads (
          provider_id,
          model_id,
          provider_family,
          max_observed_tokens,
          last_observed_tokens,
          sample_count,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $4, 1, $5, $5)
        ON CONFLICT (provider_id, model_id, provider_family)
        DO UPDATE SET
          max_observed_tokens = GREATEST(lcm_provider_transform_overheads.max_observed_tokens, EXCLUDED.max_observed_tokens),
          last_observed_tokens = EXCLUDED.last_observed_tokens,
          sample_count = lcm_provider_transform_overheads.sample_count + 1,
          updated_at_ms = EXCLUDED.updated_at_ms
      `,
      [requestSnapshot.provider_id, requestSnapshot.model_id, input.providerFamily, observedTokens, Date.now()],
    )
  }
  await upgradeProviderSafeSnapshotFinalValidationEvidence({
    db: input.db,
    requestSnapshot: result.rows[0]!,
    providerValidatorHash: input.providerValidatorHash,
  })
}

function clearManifestItemCacheFields(value: unknown) {
  if (!isObject(value)) return value
  const { cacheKey: _cacheKey, cacheVersion: _cacheVersion, ...withoutCache } = value
  return withoutCache
}

function snapshotMatchesFinalValidationRequest(input: {
  readonly requestSnapshot: ProviderRequestSnapshotRow
  readonly manifest: Record<string, unknown>
  readonly providerSafe: Record<string, unknown>
}) {
  const pairs: Array<readonly [unknown, unknown]> = [
    [input.manifest.sourceSelectionHash, input.requestSnapshot.source_selection_hash],
    [input.manifest.requestSnapshotProtectionHash, input.requestSnapshot.request_snapshot_protection_hash],
    [input.manifest.visibilityHash, input.requestSnapshot.visibility_hash],
    [input.manifest.protectedSpanHash, input.requestSnapshot.protected_span_hash],
    [input.manifest.providerTransformHash, input.requestSnapshot.provider_transform_hash],
    [input.providerSafe.sourceSelectionHash, input.requestSnapshot.source_selection_hash],
    [input.providerSafe.requestSnapshotProtectionHash, input.requestSnapshot.request_snapshot_protection_hash],
    [input.providerSafe.visibilityHash, input.requestSnapshot.visibility_hash],
    [input.providerSafe.protectedSpanHash, input.requestSnapshot.protected_span_hash],
    [input.providerSafe.providerTransformHash, input.requestSnapshot.provider_transform_hash],
  ]
  return pairs.every(([left, right]) => left === right)
}

async function upgradeProviderSafeSnapshotFinalValidationEvidence(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshot: ProviderRequestSnapshotRow
  readonly providerValidatorHash: string
}) {
  if (input.providerValidatorHash === LCM_PROVIDER_VALIDATOR_PENDING_M39) return
  const snapshots = (
    await input.db.query<{ snapshot_id: string; restore_manifest_json: unknown; metrics_json: unknown }>(
      `
        SELECT snapshot_id, restore_manifest_json, metrics_json
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
          AND restore_manifest_json->>'schemaVersion' = $2
          AND restore_manifest_json->>'providerValidatorHash' = $3
          AND restore_manifest_json->>'sourceSelectionHash' = $4
          AND restore_manifest_json->>'requestSnapshotProtectionHash' = $5
          AND restore_manifest_json->>'visibilityHash' = $6
          AND restore_manifest_json->>'protectedSpanHash' = $7
          AND restore_manifest_json->>'providerTransformHash' = $8
        ORDER BY created_at_ms DESC, snapshot_id DESC
      `,
      [
        input.requestSnapshot.conversation_id,
        LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
        LCM_PROVIDER_VALIDATOR_PENDING_M39,
        input.requestSnapshot.source_selection_hash,
        input.requestSnapshot.request_snapshot_protection_hash,
        input.requestSnapshot.visibility_hash,
        input.requestSnapshot.protected_span_hash,
        input.requestSnapshot.provider_transform_hash,
      ],
    )
  ).rows

  let upgraded = false
  for (const snapshot of snapshots) {
    const manifest = jsonValue(snapshot.restore_manifest_json)
    const metrics = jsonValue(snapshot.metrics_json)
    if (!isObject(manifest) || !isObject(metrics)) continue
    const providerSafe = jsonValue(metrics.providerSafe)
    if (
      !isObject(providerSafe) ||
      providerSafe.schemaVersion !== "lcm-provider-safe-snapshot-identity-v1" ||
      providerSafe.providerValidatorHash !== LCM_PROVIDER_VALIDATOR_PENDING_M39 ||
      !snapshotMatchesFinalValidationRequest({
        requestSnapshot: input.requestSnapshot,
        manifest,
        providerSafe,
      })
    ) {
      continue
    }

    const updatedManifest = {
      ...manifest,
      providerValidatorHash: input.providerValidatorHash,
      items: Array.isArray(manifest.items)
        ? manifest.items.map((item) => clearManifestItemCacheFields(item))
        : manifest.items,
    }
    const updatedMetrics = {
      ...metrics,
      providerSafe: {
        ...providerSafe,
        providerValidatorHash: input.providerValidatorHash,
      },
    }
    const result = await input.db.query<{ snapshot_id: string }>(
      `
        UPDATE lcm_context_snapshots
        SET restore_manifest_json = $2::jsonb,
            metrics_json = $3::jsonb
        WHERE snapshot_id = $1
          AND restore_manifest_json->>'providerValidatorHash' = $4
        RETURNING snapshot_id
      `,
      [
        snapshot.snapshot_id,
        JSON.stringify(updatedManifest),
        JSON.stringify(updatedMetrics),
        LCM_PROVIDER_VALIDATOR_PENDING_M39,
      ],
    )
    if (result.rows.length > 0) upgraded = true
  }

  if (upgraded) {
    await input.db.query(
      `
        UPDATE lcm_context_items
        SET cache_key = NULL,
            cache_version = NULL,
            updated_at_ms = $2
        WHERE conversation_id = $1
          AND (cache_key IS NOT NULL OR cache_version IS NOT NULL)
      `,
      [input.requestSnapshot.conversation_id, Date.now()],
    )
  }
}

async function validateContextRows(input: {
  db: Queryable
  conversationID: ConversationID
  rows: ContextRow[]
  allowEmpty: boolean
  allowInactiveCues?: boolean
  artifactRoot?: string
}): Promise<ValidationResult> {
  if (input.rows.length === 0)
    return input.allowEmpty ? { ok: true, rows: [], items: [] } : { ok: false, reason: "empty" }
  if (!validateOrder(input.rows)) return { ok: false, reason: "order" }

  const rawMessageIDs = [
    ...new Set(input.rows.filter((row) => row.item_type === "raw_message").map((row) => row.message_row_id!)),
  ]
  const existingRawMessageIDs = new Set<MessageRowID>()
  const rawPartCounts = new Map<MessageRowID, number>()
  const rawFileParts = new Map<MessageRowID, LcmFileID[]>()
  if (rawMessageIDs.length > 0) {
    const messages = (
      await input.db.query<{ message_row_id: MessageRowID }>(
        `
          SELECT message_row_id
          FROM lcm_messages
          WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const message of messages) existingRawMessageIDs.add(message.message_row_id)

    const partCounts = (
      await input.db.query<{ message_row_id: MessageRowID; count: number | string | bigint }>(
        `
          SELECT message_row_id, count(*)::int AS count
          FROM lcm_message_parts
          WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
          GROUP BY message_row_id
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const partCount of partCounts) rawPartCounts.set(partCount.message_row_id, asNumber(partCount.count))

    const lcmFileParts = (
      await input.db.query<{ message_row_id: MessageRowID; content_file_id: LcmFileID }>(
        `
          SELECT message_row_id, content_file_id
          FROM lcm_message_parts
          WHERE conversation_id = $1
            AND message_row_id = ANY($2::text[])
            AND content_storage_kind = 'lcm_file'
            AND content_file_id IS NOT NULL
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const part of lcmFileParts) {
      const existing = rawFileParts.get(part.message_row_id) ?? []
      existing.push(part.content_file_id)
      rawFileParts.set(part.message_row_id, existing)
    }
  }

  const items: ContextItem[] = []
  for (const row of input.rows) {
    const reference = validateContextItemReference({
      itemType: row.item_type,
      messageRowID: row.message_row_id,
      summaryID: row.summary_id,
      pointerID: row.pointer_id,
      fileID: row.file_id,
      cueID: row.cue_id,
      cuePayload: row.cue_payload_json,
      cueLifecycleState: row.cue_lifecycle_state,
      cueTargetSourceMessageID: row.cue_target_source_message_id,
      cueGenerationID: row.cue_generation_id,
    })
    if (!reference.ok) return { ok: false, reason: reference.reason ?? "reference" }

    if (row.item_type === "raw_message") {
      if (!existingRawMessageIDs.has(row.message_row_id!) || (rawPartCounts.get(row.message_row_id!) ?? 0) <= 0) {
        return { ok: false, reason: "raw_message" }
      }
      for (const fileID of rawFileParts.get(row.message_row_id!) ?? []) {
        const file = await validateFileReference({
          db: input.db,
          conversationID: input.conversationID,
          fileID,
          artifactRoot: input.artifactRoot,
        })
        if (!file.ok) return { ok: false, reason: "raw_message" }
      }
    } else if (row.item_type === "summary") {
      if (!(await validateSummaryReference(input.db, input.conversationID, row.summary_id!))) {
        return { ok: false, reason: "summary" }
      }
    } else if (row.item_type === "archive_stub") {
      const pointerCount = await count(
        input.db,
        `
          SELECT count(*)::int AS count
          FROM lcm_summary_lineage_pointers
          WHERE conversation_id = $1 AND pointer_id = $2 AND summary_id = $3
        `,
        [input.conversationID, row.pointer_id, row.summary_id],
      )
      if (pointerCount !== 1 || !(await validateSummaryReference(input.db, input.conversationID, row.summary_id!))) {
        return { ok: false, reason: "archive_stub" }
      }
    } else if (row.item_type === "large_file_marker") {
      const file = await validateFileReference({
        db: input.db,
        conversationID: input.conversationID,
        fileID: row.file_id!,
        artifactRoot: input.artifactRoot,
      })
      if (!file.ok) return { ok: false, reason: file.reason ?? "file" }
    } else if (row.item_type === "retrieval_cue") {
      const payload = rowCuePayload(row)
      if (
        !row.cue_id ||
        !row.cue_lifecycle_state ||
        !row.cue_target_source_message_id ||
        !row.cue_generation_id ||
        (!input.allowInactiveCues && row.cue_lifecycle_state !== "active")
      ) {
        return { ok: false, reason: "cue_lifecycle" }
      }
      if (row.cue_superseded_by_id) {
        const successorCount = await count(
          input.db,
          `
            SELECT count(*)::int AS count
            FROM lcm_context_items
            WHERE conversation_id = $1
              AND cue_id = $2
          `,
          [input.conversationID, row.cue_superseded_by_id],
        )
        if (successorCount !== 1) return { ok: false, reason: "cue_successor" }
      }
      if (row.cue_superseded_by_generation_id) {
        const successorGenerationCount = await count(
          input.db,
          `
            SELECT count(*)::int AS count
            FROM lcm_context_items
            WHERE conversation_id = $1
              AND cue_generation_id = $2
          `,
          [input.conversationID, row.cue_superseded_by_generation_id],
        )
        if (successorGenerationCount < 1) return { ok: false, reason: "cue_successor_generation" }
      }
      if (!payload || !(await validateCueReferences(input.db, input.conversationID, payload))) {
        return { ok: false, reason: "cue" }
      }
    }

    items.push(rowToItem(row))
  }

  return { ok: true, rows: input.rows, items }
}

function contextItemCounts(rows: readonly ContextRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.item_type]++
      return counts
    },
    {
      raw_message: 0,
      summary: 0,
      archive_stub: 0,
      large_file_marker: 0,
      retrieval_cue: 0,
    } satisfies Record<ContextItemType, number>,
  )
}

function laneCountsFromItems(rows: readonly ContextRow[]) {
  const sumTokens = (itemType: ContextItemType) =>
    rows.reduce((total, row) => total + (row.item_type === itemType ? (optionalNumber(row.token_count) ?? 0) : 0), 0)
  return {
    raw_leaves: sumTokens("raw_message"),
    sprigs: sumTokens("summary"),
    bindles: 0,
    archive_stubs: sumTokens("archive_stub"),
    large_file_markers: sumTokens("large_file_marker"),
    retrieval_cues: sumTokens("retrieval_cue"),
  }
}

function tokenLaneCountsFromDecision(decision?: { lanes: LcmThresholdDecision["lanes"] }) {
  if (!decision) return undefined
  return {
    raw_leaves: decision.lanes.rawLeaves.tokens,
    sprigs: decision.lanes.sprigs.tokens,
    bindles: decision.lanes.bindles.tokens,
    archive_stubs: decision.lanes.archiveStubs.tokens,
    large_file_markers: decision.lanes.largeFileMarkers.tokens,
    retrieval_cues: decision.lanes.retrievalCues.tokens,
  }
}

function rowToManifestItem(row: ContextRow): LcmContextRestoreManifestItem {
  const base = {
    contextItemID: row.context_item_id,
    conversationID: row.conversation_id,
    itemOrder: asNumber(row.item_order),
    itemType: row.item_type,
    ...(row.token_count === null ? {} : { tokenCount: asNumber(row.token_count) }),
    ...(row.cache_key ? { cacheKey: row.cache_key } : {}),
    ...(row.cache_version === null ? {} : { cacheVersion: asNumber(row.cache_version) }),
    createdAtMs: asNumber(row.created_at_ms),
    updatedAtMs: asNumber(row.updated_at_ms),
  }
  if (row.item_type === "raw_message") return { ...base, itemType: "raw_message", messageRowID: row.message_row_id! }
  if (row.item_type === "summary") return { ...base, itemType: "summary", summaryID: row.summary_id! }
  if (row.item_type === "archive_stub")
    return { ...base, itemType: "archive_stub", summaryID: row.summary_id!, pointerID: row.pointer_id! }
  if (row.item_type === "large_file_marker") return { ...base, itemType: "large_file_marker", fileID: row.file_id! }
  const cuePayload = rowCuePayload(row)
  if (!cuePayload) throw invalidRequest("lcm_snapshot_cue_payload_invalid")
  if (!row.cue_lifecycle_state || !row.cue_target_source_message_id || !row.cue_generation_id) {
    throw invalidRequest("lcm_snapshot_cue_lifecycle_invalid")
  }
  return {
    ...base,
    itemType: "retrieval_cue",
    cueID: rowCueID(row),
    cuePayload,
    cueLifecycleState: row.cue_lifecycle_state,
    cueTargetSourceMessageID: row.cue_target_source_message_id,
    cueGenerationID: row.cue_generation_id,
    ...(row.cue_superseded_by_id ? { cueSupersededByID: row.cue_superseded_by_id } : {}),
    ...(row.cue_superseded_by_generation_id
      ? { cueSupersededByGenerationID: row.cue_superseded_by_generation_id }
      : {}),
  }
}

function rowToManifestItemV2(
  row: ContextRow,
  providerSafe: ProviderSafeSnapshotEvidence,
): LcmContextRestoreManifestItemV2 {
  const item = rowToManifestItem(row)
  const renderUnit = providerSafe.items.get(row.context_item_id)
  if (!renderUnit) throw invalidRequest("lcm_context_snapshot_v2_render_unit_missing")
  return {
    ...item,
    renderUnitID: renderUnit.renderUnitID,
    canonicalOrder: renderUnit.canonicalOrder,
    effectiveOrder: renderUnit.effectiveOrder,
    placementSlot: renderUnit.placementSlot,
  }
}

function fallbackProviderSafeSnapshotEvidence(rows: readonly ContextRow[]): ProviderSafeSnapshotEvidence {
  const fingerprint = rows.map((row) => ({
    contextItemID: row.context_item_id,
    itemOrder: row.item_order,
    itemType: row.item_type,
    messageRowID: row.message_row_id,
    summaryID: row.summary_id,
    pointerID: row.pointer_id,
    fileID: row.file_id,
    cueID: row.cue_id,
    cacheKey: row.cache_key,
    tokenCount: optionalNumber(row.token_count),
    updatedAtMs: asNumber(row.updated_at_ms),
  }))
  const hash = (name: string) => namespacedHash(`lcm-current-snapshot-${name}-v1`, fingerprint)
  return {
    renderInputManifest: {
      version: 1,
      rendererVersion: "lcm-current-snapshot-rebaseline-v1",
      renderPreparationVersion: "lcm-current-snapshot-rebaseline-v1",
      sourceSelectionHash: hash("source-selection"),
      requestSnapshotProtectionHash: hash("request-snapshot-protection"),
      renderUnitOrderHash: hash("render-unit-order"),
      effectivePlacementHash: hash("effective-placement"),
      protectedSpanHash: hash("protected-span"),
      providerTransformHash: hash("provider-transform"),
      providerValidatorHash: hash("provider-validator"),
      assemblyValidatorHash: hash("assembly-validator"),
      systemPromptVersion: "lcm-current-snapshot-rebaseline-v1",
      systemPromptHash: hash("system-prompt"),
      toolSchemaVersion: "lcm-current-snapshot-rebaseline-v1",
      toolSchemaHash: hash("tool-schema"),
      pluginTransformVersion: "lcm-current-snapshot-rebaseline-v1",
      pluginTransformHash: hash("plugin-transform"),
      dynamicPromptVersion: "lcm-current-snapshot-rebaseline-v1",
      dynamicPromptHash: hash("dynamic-prompt"),
      messageVisibilityVersion: "lcm-current-snapshot-rebaseline-v1",
      messageVisibilityHash: hash("message-visibility"),
      providerMediaCapability: "unknown",
      stripMedia: false,
      modelID: "lcm-current-snapshot",
      providerID: "lcm-internal",
      taskCapabilityClass: "root",
      clockPolicy: "runtime_per_preparation",
    },
    items: new Map(
      rows.map((row) => {
        const itemOrder = asNumber(row.item_order)
        return [
          row.context_item_id,
          {
            contextItemID: row.context_item_id,
            renderUnitID: namespacedHash("lcm-current-snapshot-render-unit-v1", {
              contextItemID: row.context_item_id,
              itemOrder,
              itemType: row.item_type,
            }),
            canonicalOrder: itemOrder,
            effectiveOrder: itemOrder,
            placementSlot: row.item_type === "retrieval_cue" ? "before_current_user" : "history",
          } satisfies ProviderSafeSnapshotItem,
        ]
      }),
    ),
  }
}

export async function writeContextSnapshot(input: {
  db: Queryable
  conversationID: ConversationID
  strategy?: LcmStrategy
  reason: string
  nowMs?: number
  threshold?: Pick<
    LcmThresholdDecision,
    | "activeTokens"
    | "hardLimit"
    | "softThreshold"
    | "freshTailTokens"
    | "softBacklogTokens"
    | "softBacklogItemCount"
    | "softBacklogLargestSourceTokens"
    | "freshTailRawTokens"
    | "freshTailRawItemCount"
    | "unconsumedRawTokens"
    | "unconsumedRawItemCount"
    | "protectedTailRawTokens"
    | "protectedTailRawItemCount"
    | "rawLaneTokens"
    | "rawLaneRatio"
    | "softBacklogRatio"
    | "hardFillRatio"
    | "softPressureReason"
    | "laneLatchDiagnostics"
    | "lanes"
  > & {
    tokenCounterMode?: LcmTokenCounterMode
    tokenCounterVersion?: string
    providerContextLimit?: number
    providerInputLimit?: number
    providerOutputLimit?: number
    outputReserve?: number
    budgetStatus?: LcmThresholdDecision["budgetStatus"]
    providerTransformOverheadReserveTokens?: number
  }
  providerSafe?: ProviderSafeSnapshotEvidence
}) {
  const rows = await loadContextRows(input.db, input.conversationID)
  const now = input.nowMs ?? Date.now()
  const snapshotID = await allocateSnapshotID(input.db)
  const activeTokens =
    input.threshold?.activeTokens ?? rows.reduce((total, row) => total + (optionalNumber(row.token_count) ?? 0), 0)
  const strategy = input.strategy ?? "upward"
  const hardLimit = input.threshold?.hardLimit ?? 0
  const softThreshold = input.threshold?.softThreshold ?? 0
  const freshTailTokens = input.threshold?.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens
  const tokenCounterMode = input.threshold?.tokenCounterMode ?? LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE
  const tokenCounterVersion = input.threshold?.tokenCounterVersion ?? LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const computedSoftBacklog =
    input.threshold?.softBacklogTokens === undefined || input.threshold?.softBacklogItemCount === undefined
      ? computeSoftBacklogFromRows({
          rows,
          summaryMetadata,
          strategy,
          freshTailTokens,
        })
      : undefined
  const softBacklogTokens = input.threshold?.softBacklogTokens ?? computedSoftBacklog?.tokens ?? 0
  const softBacklogItemCount = input.threshold?.softBacklogItemCount ?? computedSoftBacklog?.itemCount ?? 0
  const softBacklogLargestSourceTokens =
    input.threshold?.softBacklogLargestSourceTokens ?? computedSoftBacklog?.largestSourceTokens ?? 0
  const freshTailRawTokens = input.threshold?.freshTailRawTokens ?? computedSoftBacklog?.freshTailTokens ?? 0
  const freshTailRawItemCount = input.threshold?.freshTailRawItemCount ?? computedSoftBacklog?.freshTailItemCount ?? 0
  const unconsumedRawTokens = input.threshold?.unconsumedRawTokens ?? computedSoftBacklog?.unconsumedTokens ?? 0
  const unconsumedRawItemCount =
    input.threshold?.unconsumedRawItemCount ?? computedSoftBacklog?.unconsumedItemCount ?? 0
  const protectedTailRawTokens =
    input.threshold?.protectedTailRawTokens ?? computedSoftBacklog?.protectedTailTokens ?? 0
  const protectedTailRawItemCount =
    input.threshold?.protectedTailRawItemCount ?? computedSoftBacklog?.protectedTailItemCount ?? 0
  const rawLaneTokens = input.threshold?.rawLaneTokens ?? softBacklogTokens + protectedTailRawTokens
  const laneCounts = tokenLaneCountsFromDecision(input.threshold) ?? laneCountsFromItems(rows)
  const budgetStatus = input.threshold?.budgetStatus ?? (input.threshold ? "budgeted" : "unavailable")
  const providerSafe = input.providerSafe ?? fallbackProviderSafeSnapshotEvidence(rows)
  const providerSafeIdentity = providerSafeIdentityFromManifest(providerSafe.renderInputManifest)
  if (providerSafe.items.size !== rows.length) {
    throw invalidRequest("lcm_context_snapshot_v2_render_unit_count_mismatch")
  }
  const manifest: LcmContextRestoreManifest = {
    schemaVersion: LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
    snapshotID,
    conversationID: input.conversationID,
    createdAtMs: now,
    strategy,
    activeTokens,
    hardLimit,
    softThreshold,
    freshTailTokens,
    softBacklogTokens,
    softBacklogItemCount,
    contextItemCount: rows.length,
    tokenCounterMode,
    tokenCounterVersion,
    ...providerSafeIdentity,
    items: rows.map((row) => rowToManifestItemV2(row, providerSafe)),
  }
  const metrics = {
    schemaVersion: "lcm-context-metrics-v2",
    reason: input.reason,
    activeTokens,
    hardLimit,
    softThreshold,
    softBacklogTokens,
    softBacklogItemCount,
    softBacklogLargestSourceTokens,
    freshTailTokens,
    freshTailRawTokens,
    freshTailRawItemCount,
    unconsumedRawTokens,
    unconsumedRawItemCount,
    protectedTailRawTokens,
    protectedTailRawItemCount,
    rawLaneTokens,
    budgetStatus,
    hardFillRatio: input.threshold?.hardFillRatio,
    rawLaneRatio: input.threshold?.rawLaneRatio,
    softBacklogRatio: input.threshold?.softBacklogRatio,
    softPressureReason: input.threshold?.softPressureReason,
    laneLatchDiagnostics: input.threshold?.laneLatchDiagnostics,
    contextItemCounts: contextItemCounts(rows),
    laneTokens: laneCounts,
    tokenCounterMode,
    tokenCounterVersion,
    providerContextLimit: input.threshold?.providerContextLimit,
    providerInputLimit: input.threshold?.providerInputLimit,
    providerOutputLimit: input.threshold?.providerOutputLimit,
    outputReserve: input.threshold?.outputReserve,
    providerTransformOverheadReserveTokens: input.threshold?.providerTransformOverheadReserveTokens,
    providerSafe: {
      schemaVersion: "lcm-provider-safe-snapshot-identity-v1",
      ...providerSafeIdentity,
      providerTransformOverheadTokenCount: providerSafe.providerTransformOverheadTokenCount ?? 0,
    },
  }

  await input.db.query(
    `
      INSERT INTO lcm_context_snapshots (
        snapshot_id,
        conversation_id,
        created_at_ms,
        strategy,
        active_tokens,
        hard_limit,
        soft_threshold,
        soft_backlog_tokens,
        soft_backlog_item_count,
        context_item_count,
        token_counter_mode,
        token_counter_version,
        lane_counts_json,
        metrics_json,
        restore_manifest_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb)
    `,
    [
      snapshotID,
      input.conversationID,
      now,
      strategy,
      activeTokens,
      hardLimit,
      softThreshold,
      softBacklogTokens,
      softBacklogItemCount,
      rows.length,
      tokenCounterMode,
      tokenCounterVersion,
      JSON.stringify(laneCounts),
      JSON.stringify(metrics),
      JSON.stringify(manifest),
    ],
  )
  return manifest
}

export async function appendRawMessageContextItems(input: {
  db: Queryable
  conversationID: ConversationID
  messageRowIDs: MessageRowID[]
  strategy?: LcmStrategy
  nowMs?: number
}) {
  if (input.messageRowIDs.length === 0) return 0
  const existing = (
    await input.db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND item_type = 'raw_message'
          AND message_row_id = ANY($2::text[])
      `,
      [input.conversationID, input.messageRowIDs],
    )
  ).rows
  const existingIDs = new Set(existing.map((row) => row.message_row_id))
  const missing = input.messageRowIDs.filter((id) => !existingIDs.has(id))
  if (missing.length === 0) return 0

  let maxOrder = await count(
    input.db,
    "SELECT coalesce(max(item_order), 0)::int AS count FROM lcm_context_items WHERE conversation_id = $1",
    [input.conversationID],
  )
  const now = input.nowMs ?? Date.now()
  let inserted = 0
  for (const messageRowID of missing) {
    if (!(await validateRawMessageReference({ db: input.db, conversationID: input.conversationID, messageRowID }))) {
      throw missingSource("lcm_context_append_missing_source", input.conversationID)
    }
    maxOrder++
    await input.db.query(
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          message_row_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, 'raw_message', $4, $5, $5)
      `,
      [await allocateContextItemID(input.db), input.conversationID, maxOrder, messageRowID, now],
    )
    inserted++
  }

  await writeContextSnapshot({
    db: input.db,
    conversationID: input.conversationID,
    strategy: input.strategy,
    reason: "sync",
    nowMs: now,
  })
  return inserted
}

function manifestValue(value: unknown): unknown {
  return jsonValue(value)
}

function manifestItemTokenFieldsValid(item: Record<string, unknown>) {
  if (item.tokenCount !== undefined && (!Number.isInteger(item.tokenCount) || (item.tokenCount as number) < 0))
    return false
  if (item.cacheKey !== undefined && typeof item.cacheKey !== "string") return false
  if (item.cacheVersion !== undefined && !Number.isInteger(item.cacheVersion)) return false
  return true
}

function manifestItemToRow(item: LcmContextRestoreManifestItem, clearTokenCache: boolean): ContextRow {
  return {
    context_item_id: item.contextItemID,
    conversation_id: item.conversationID,
    item_order: item.itemOrder,
    item_type: item.itemType,
    message_row_id: item.itemType === "raw_message" ? item.messageRowID : null,
    summary_id: item.itemType === "summary" || item.itemType === "archive_stub" ? item.summaryID : null,
    pointer_id: item.itemType === "archive_stub" ? item.pointerID : null,
    file_id: item.itemType === "large_file_marker" ? item.fileID : null,
    cue_id: item.itemType === "retrieval_cue" ? item.cueID : null,
    cue_payload_json: item.itemType === "retrieval_cue" ? item.cuePayload : null,
    cue_lifecycle_state: item.itemType === "retrieval_cue" ? (item.cueLifecycleState ?? "active") : null,
    cue_superseded_by_id: item.itemType === "retrieval_cue" ? (item.cueSupersededByID ?? null) : null,
    cue_superseded_by_generation_id:
      item.itemType === "retrieval_cue" ? (item.cueSupersededByGenerationID ?? null) : null,
    cue_target_source_message_id:
      item.itemType === "retrieval_cue"
        ? (item.cueTargetSourceMessageID ?? `legacy_unknown_${item.contextItemID}`)
        : null,
    cue_generation_id:
      item.itemType === "retrieval_cue" ? (item.cueGenerationID ?? `cuegen_legacy_${item.contextItemID}`) : null,
    token_count: clearTokenCache ? null : (item.tokenCount ?? null),
    cache_key: clearTokenCache ? null : (item.cacheKey ?? null),
    cache_version: clearTokenCache ? null : (item.cacheVersion ?? null),
    created_at_ms: item.createdAtMs,
    updated_at_ms: item.updatedAtMs,
  }
}

function parseManifestItem(value: unknown, conversationID: ConversationID): LcmContextRestoreManifestItem | undefined {
  if (!isObject(value)) return undefined
  if (
    typeof value.contextItemID !== "string" ||
    value.conversationID !== conversationID ||
    typeof value.itemOrder !== "number" ||
    !Number.isInteger(value.itemOrder) ||
    value.itemOrder <= 0 ||
    typeof value.itemType !== "string" ||
    !Number.isInteger(value.createdAtMs) ||
    !Number.isInteger(value.updatedAtMs) ||
    !manifestItemTokenFieldsValid(value)
  ) {
    return undefined
  }
  const itemOrder = value.itemOrder as number
  const createdAtMs = value.createdAtMs as number
  const updatedAtMs = value.updatedAtMs as number
  const base = {
    contextItemID: value.contextItemID as ContextItemID,
    conversationID,
    itemOrder,
    itemType: value.itemType as ContextItemType,
    ...(value.tokenCount === undefined ? {} : { tokenCount: value.tokenCount as number }),
    ...(value.cacheKey === undefined ? {} : { cacheKey: value.cacheKey as string }),
    ...(value.cacheVersion === undefined ? {} : { cacheVersion: value.cacheVersion as number }),
    createdAtMs,
    updatedAtMs,
  }

  if (value.itemType === "raw_message" && typeof value.messageRowID === "string") {
    return { ...base, itemType: "raw_message", messageRowID: value.messageRowID as MessageRowID }
  }
  if (value.itemType === "summary" && typeof value.summaryID === "string") {
    return { ...base, itemType: "summary", summaryID: value.summaryID as SummaryID }
  }
  if (value.itemType === "archive_stub" && typeof value.summaryID === "string" && typeof value.pointerID === "string") {
    return { ...base, itemType: "archive_stub", summaryID: value.summaryID as SummaryID, pointerID: value.pointerID }
  }
  if (value.itemType === "large_file_marker" && typeof value.fileID === "string") {
    return { ...base, itemType: "large_file_marker", fileID: value.fileID as LcmFileID }
  }
  if (
    value.itemType === "retrieval_cue" &&
    typeof value.cueID === "string" &&
    isRetrievalCuePayload(value.cuePayload)
  ) {
    if (
      value.cueLifecycleState !== undefined &&
      !["active", "superseded", "tombstoned"].includes(String(value.cueLifecycleState))
    ) {
      return undefined
    }
    if (value.cueTargetSourceMessageID !== undefined && typeof value.cueTargetSourceMessageID !== "string")
      return undefined
    if (value.cueGenerationID !== undefined && typeof value.cueGenerationID !== "string") return undefined
    if (value.cueSupersededByID !== undefined && typeof value.cueSupersededByID !== "string") return undefined
    if (value.cueSupersededByGenerationID !== undefined && typeof value.cueSupersededByGenerationID !== "string") {
      return undefined
    }
    return {
      ...base,
      itemType: "retrieval_cue",
      cueID: value.cueID,
      cuePayload: value.cuePayload,
      ...(value.cueLifecycleState === undefined
        ? {}
        : { cueLifecycleState: value.cueLifecycleState as LcmRetrievalCueLifecycleState }),
      ...(value.cueTargetSourceMessageID === undefined
        ? {}
        : { cueTargetSourceMessageID: value.cueTargetSourceMessageID }),
      ...(value.cueGenerationID === undefined ? {} : { cueGenerationID: value.cueGenerationID }),
      ...(value.cueSupersededByID === undefined ? {} : { cueSupersededByID: value.cueSupersededByID }),
      ...(value.cueSupersededByGenerationID === undefined
        ? {}
        : { cueSupersededByGenerationID: value.cueSupersededByGenerationID }),
    }
  }
  return undefined
}

function parseManifestItemV2(
  value: unknown,
  conversationID: ConversationID,
): LcmContextRestoreManifestItemV2 | undefined {
  const item = parseManifestItem(value, conversationID)
  if (!item || !isObject(value)) return undefined
  const canonicalOrder = value.canonicalOrder
  const effectiveOrder = value.effectiveOrder
  const placementSlot = value.placementSlot
  if (
    typeof value.renderUnitID !== "string" ||
    value.renderUnitID.length === 0 ||
    typeof canonicalOrder !== "number" ||
    typeof effectiveOrder !== "number" ||
    !Number.isInteger(canonicalOrder) ||
    !Number.isInteger(effectiveOrder) ||
    canonicalOrder <= 0 ||
    effectiveOrder <= 0 ||
    !["history", "before_current_user", "current_user", "after_current_user", "provider_tail"].includes(
      String(placementSlot),
    )
  ) {
    return undefined
  }
  return {
    ...item,
    renderUnitID: value.renderUnitID,
    canonicalOrder,
    effectiveOrder,
    placementSlot: placementSlot as LcmAssemblyPlacementSlot,
  }
}

function parseProviderSafeMetrics(snapshot: SnapshotRow) {
  const metrics = jsonValue(snapshot.metrics_json)
  if (!isObject(metrics)) return undefined
  const providerSafe = jsonValue(metrics.providerSafe)
  if (!isObject(providerSafe) || providerSafe.schemaVersion !== "lcm-provider-safe-snapshot-identity-v1")
    return undefined
  const identity = {
    renderUnitOrderHash: providerSafe.renderUnitOrderHash,
    effectivePlacementHash: providerSafe.effectivePlacementHash,
    sourceSelectionHash: providerSafe.sourceSelectionHash,
    requestSnapshotProtectionHash: providerSafe.requestSnapshotProtectionHash,
    visibilityHash: providerSafe.visibilityHash,
    protectedSpanHash: providerSafe.protectedSpanHash,
    providerTransformHash: providerSafe.providerTransformHash,
    providerValidatorHash: providerSafe.providerValidatorHash,
    assemblyValidatorHash: providerSafe.assemblyValidatorHash,
  }
  return Object.values(identity).every((value) => typeof value === "string" && value.length > 0) ? identity : undefined
}

function providerSafeManifestMatchesMetrics(manifest: LcmContextRestoreManifestV2, snapshot: SnapshotRow) {
  const metrics = parseProviderSafeMetrics(snapshot)
  if (!metrics) return false
  const identity = {
    renderUnitOrderHash: manifest.renderUnitOrderHash,
    effectivePlacementHash: manifest.effectivePlacementHash,
    sourceSelectionHash: manifest.sourceSelectionHash,
    requestSnapshotProtectionHash: manifest.requestSnapshotProtectionHash,
    visibilityHash: manifest.visibilityHash,
    protectedSpanHash: manifest.protectedSpanHash,
    providerTransformHash: manifest.providerTransformHash,
    providerValidatorHash: manifest.providerValidatorHash,
    assemblyValidatorHash: manifest.assemblyValidatorHash,
  }
  return (Object.keys(identity) as (keyof typeof identity)[]).every((key) => identity[key] === metrics[key])
}

function parseAndValidateManifest(snapshot: SnapshotRow): LcmContextRestoreManifest | undefined {
  const manifest = manifestValue(snapshot.restore_manifest_json)
  if (!isObject(manifest)) return undefined
  const snapshotSoftBacklogTokens = optionalNumber(snapshot.soft_backlog_tokens)
  const snapshotSoftBacklogItemCount = optionalNumber(snapshot.soft_backlog_item_count)
  if (
    manifest.snapshotID !== snapshot.snapshot_id ||
    manifest.conversationID !== snapshot.conversation_id ||
    manifest.createdAtMs !== asNumber(snapshot.created_at_ms) ||
    manifest.strategy !== snapshot.strategy ||
    manifest.activeTokens !== asNumber(snapshot.active_tokens) ||
    manifest.hardLimit !== asNumber(snapshot.hard_limit) ||
    manifest.softThreshold !== asNumber(snapshot.soft_threshold) ||
    typeof manifest.freshTailTokens !== "number" ||
    !Number.isInteger(manifest.freshTailTokens) ||
    manifest.freshTailTokens <= 0 ||
    manifest.contextItemCount !== asNumber(snapshot.context_item_count) ||
    manifest.tokenCounterMode !== snapshot.token_counter_mode ||
    manifest.tokenCounterVersion !== snapshot.token_counter_version ||
    !Array.isArray(manifest.items) ||
    manifest.items.length !== asNumber(snapshot.context_item_count) ||
    manifest.schemaVersion !== LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION
  ) {
    return undefined
  }
  if (
    snapshotSoftBacklogTokens === undefined ||
    snapshotSoftBacklogItemCount === undefined ||
    manifest.softBacklogTokens !== snapshotSoftBacklogTokens ||
    manifest.softBacklogItemCount !== snapshotSoftBacklogItemCount
  ) {
    return undefined
  }

  const orders = new Set<number>()
  const ids = new Set<string>()
  const v2Items: LcmContextRestoreManifestItemV2[] = []
  for (const value of manifest.items) {
    const item = parseManifestItemV2(value, snapshot.conversation_id)
    if (!item) return undefined
    if (orders.has(item.itemOrder) || ids.has(item.contextItemID)) return undefined
    orders.add(item.itemOrder)
    ids.add(item.contextItemID)
    v2Items.push(item)
  }
  v2Items.sort((left, right) => left.itemOrder - right.itemOrder)
  for (let index = 0; index < v2Items.length; index++) {
    if (v2Items[index]!.itemOrder !== index + 1) return undefined
  }

  const base = {
    snapshotID: snapshot.snapshot_id,
    conversationID: snapshot.conversation_id,
    createdAtMs: asNumber(snapshot.created_at_ms),
    strategy: snapshot.strategy,
    activeTokens: asNumber(snapshot.active_tokens),
    hardLimit: asNumber(snapshot.hard_limit),
    softThreshold: asNumber(snapshot.soft_threshold),
    freshTailTokens: manifest.freshTailTokens,
    ...(snapshotSoftBacklogTokens === undefined ? {} : { softBacklogTokens: snapshotSoftBacklogTokens }),
    ...(snapshotSoftBacklogItemCount === undefined ? {} : { softBacklogItemCount: snapshotSoftBacklogItemCount }),
    contextItemCount: asNumber(snapshot.context_item_count),
    tokenCounterMode: snapshot.token_counter_mode,
    tokenCounterVersion: snapshot.token_counter_version,
  }

  const providerSafeFields = {
    renderUnitOrderHash: manifest.renderUnitOrderHash,
    effectivePlacementHash: manifest.effectivePlacementHash,
    sourceSelectionHash: manifest.sourceSelectionHash,
    requestSnapshotProtectionHash: manifest.requestSnapshotProtectionHash,
    visibilityHash: manifest.visibilityHash,
    protectedSpanHash: manifest.protectedSpanHash,
    providerTransformHash: manifest.providerTransformHash,
    providerValidatorHash: manifest.providerValidatorHash,
    assemblyValidatorHash: manifest.assemblyValidatorHash,
  }
  if (!Object.values(providerSafeFields).every((value) => typeof value === "string" && value.length > 0))
    return undefined
  const typedProviderSafeFields = providerSafeFields as {
    renderUnitOrderHash: string
    effectivePlacementHash: string
    sourceSelectionHash: string
    requestSnapshotProtectionHash: string
    visibilityHash: string
    protectedSpanHash: string
    providerTransformHash: string
    providerValidatorHash: string
    assemblyValidatorHash: string
  }
  const v2 = {
    ...base,
    schemaVersion: LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
    softBacklogTokens: snapshotSoftBacklogTokens!,
    softBacklogItemCount: snapshotSoftBacklogItemCount!,
    ...typedProviderSafeFields,
    items: v2Items,
  } satisfies LcmContextRestoreManifestV2
  if (!providerSafeManifestMatchesMetrics(v2, snapshot)) return undefined
  return v2
}

function restoreCanKeepTokenCache(manifest: LcmContextRestoreManifest) {
  if (manifest.schemaVersion !== LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION) return false
  const hasFinalProviderValidator = manifest.providerValidatorHash.startsWith(`${LCM_PROVIDER_VALIDATOR_NAMESPACE}:`)
  return (
    manifest.tokenCounterMode === LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE &&
    manifest.tokenCounterVersion === LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION &&
    hasFinalProviderValidator
  )
}

async function insertContextRow(db: Queryable, row: ContextRow) {
  await db.query(
    `
      INSERT INTO lcm_context_items (
        context_item_id,
        conversation_id,
        item_order,
        item_type,
        message_row_id,
        summary_id,
        pointer_id,
        file_id,
        cue_id,
        cue_payload_json,
        cue_lifecycle_state,
        cue_superseded_by_id,
        cue_superseded_by_generation_id,
        cue_target_source_message_id,
        cue_generation_id,
        token_count,
        cache_key,
        cache_version,
        created_at_ms,
        updated_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10::jsonb, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20
      )
    `,
    [
      row.context_item_id,
      row.conversation_id,
      asNumber(row.item_order),
      row.item_type,
      row.message_row_id,
      row.summary_id,
      row.pointer_id,
      row.file_id,
      row.cue_id ?? null,
      row.cue_payload_json === null ? null : JSON.stringify(row.cue_payload_json),
      row.cue_lifecycle_state ?? null,
      row.cue_superseded_by_id ?? null,
      row.cue_superseded_by_generation_id ?? null,
      row.cue_target_source_message_id ?? null,
      row.cue_generation_id ?? null,
      row.token_count,
      row.cache_key,
      row.cache_version,
      asNumber(row.created_at_ms),
      asNumber(row.updated_at_ms),
    ],
  )
}

async function restoreFromSnapshots(input: {
  db: Transactional
  conversationID: ConversationID
  strategy: LcmStrategy
  reason: string
  artifactRoot?: string
}) {
  const snapshots = (
    await input.db.query<SnapshotRow>(
      `
        SELECT *
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
        ORDER BY created_at_ms DESC, snapshot_id DESC
      `,
      [input.conversationID],
    )
  ).rows

  for (const snapshot of snapshots) {
    const manifest = parseAndValidateManifest(snapshot)
    if (!manifest) continue
    const clearTokenCache = !restoreCanKeepTokenCache(manifest)
    const rows = manifest.items.map((item) => manifestItemToRow(item, clearTokenCache))
    const validation = await validateContextRows({
      db: input.db,
      conversationID: input.conversationID,
      rows,
      allowEmpty: true,
      artifactRoot: input.artifactRoot,
    })
    if (!validation.ok) continue

    await input.db.transaction(async (tx) => {
      await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
      for (const row of rows) await insertContextRow(tx, row)
    })
    return { restored: true, count: rows.length }
  }

  return { restored: false, count: 0 }
}

async function existingOrderMap(db: Queryable, conversationID: ConversationID) {
  const rows = await loadContextRows(db, conversationID)
  const byKey = new Map<string, number>()
  for (const row of rows) {
    if (row.item_type === "raw_message" && row.message_row_id)
      byKey.set(`raw:${row.message_row_id}`, asNumber(row.item_order))
    if (row.item_type === "summary" && row.summary_id) byKey.set(`summary:${row.summary_id}`, asNumber(row.item_order))
    if (row.item_type === "archive_stub" && row.summary_id && row.pointer_id)
      byKey.set(`archive:${row.summary_id}:${row.pointer_id}`, asNumber(row.item_order))
    if (row.item_type === "large_file_marker" && row.file_id) byKey.set(`file:${row.file_id}`, asNumber(row.item_order))
  }
  return byKey
}

async function durableRebuild(input: {
  db: Transactional
  conversationID: ConversationID
  strategy: LcmStrategy
  reason: string
  artifactRoot?: string
}): Promise<LcmRecoveryResult> {
  const originalOrders = await existingOrderMap(input.db, input.conversationID)
  const candidates: ContextCandidate[] = []
  const coveredMessages = new Set<MessageRowID>()
  const archivedSummaryIDs = new Set<SummaryID>()

  const archiveRows = (
    await input.db.query<{ summary_id: SummaryID; pointer_id: string; created_at_ms: number | string | bigint }>(
      `
        SELECT pointer.summary_id, pointer.pointer_id, pointer.created_at_ms
        FROM lcm_summary_lineage_pointers pointer
        WHERE pointer.conversation_id = $1
          AND pointer.pointer_kind = 'archive_stub'
        ORDER BY pointer.created_at_ms, pointer.pointer_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const archive of archiveRows) {
    const pointerCount = await count(
      input.db,
      `
        SELECT count(*)::int AS count
        FROM lcm_summary_lineage_pointers
        WHERE conversation_id = $1
          AND pointer_id = $2
          AND summary_id = $3
          AND pointer_kind = 'archive_stub'
      `,
      [input.conversationID, archive.pointer_id, archive.summary_id],
    )
    if (pointerCount !== 1 || !(await validateSummaryReference(input.db, input.conversationID, archive.summary_id)))
      continue
    archivedSummaryIDs.add(archive.summary_id)
    candidates.push({
      itemType: "archive_stub",
      summaryID: archive.summary_id,
      pointerID: archive.pointer_id,
      originalOrder:
        originalOrders.get(`archive:${archive.summary_id}:${archive.pointer_id}`) ?? Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(archive.created_at_ms),
      stableID: `${archive.summary_id}:${archive.pointer_id}`,
    })
    const rows = (
      await input.db.query<{ message_row_id: MessageRowID }>(
        "SELECT message_row_id FROM lcm_summary_messages WHERE summary_id = $1",
        [archive.summary_id],
      )
    ).rows
    for (const row of rows) coveredMessages.add(row.message_row_id)
  }

  const summaries = (
    await input.db.query<{ summary_id: SummaryID; created_at_ms: number | string | bigint }>(
      `
        SELECT summary_id, created_at_ms
        FROM lcm_summaries
        WHERE conversation_id = $1
        ORDER BY created_at_ms, summary_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const summary of summaries) {
    if (archivedSummaryIDs.has(summary.summary_id)) continue
    if (!(await validateSummaryReference(input.db, input.conversationID, summary.summary_id))) continue
    candidates.push({
      itemType: "summary",
      summaryID: summary.summary_id,
      originalOrder: originalOrders.get(`summary:${summary.summary_id}`) ?? Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(summary.created_at_ms),
      stableID: summary.summary_id,
    })
    const rows = (
      await input.db.query<{ message_row_id: MessageRowID }>(
        "SELECT message_row_id FROM lcm_summary_messages WHERE summary_id = $1",
        [summary.summary_id],
      )
    ).rows
    for (const row of rows) coveredMessages.add(row.message_row_id)
  }

  const fileRows = (
    await input.db.query<{ file_id: LcmFileID; created_at_ms: number | string | bigint }>(
      `
        SELECT file.file_id, file.created_at_ms
        FROM lcm_large_files file
        WHERE file.conversation_id = $1
          AND file.source_kind IN ('path', 'inline', 'image')
          AND NOT EXISTS (
            SELECT 1
            FROM lcm_message_parts part
            WHERE part.conversation_id = file.conversation_id
              AND part.content_file_id = file.file_id
          )
        ORDER BY file.created_at_ms, file.file_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const file of fileRows) {
    const validation = await validateFileReference({
      db: input.db,
      conversationID: input.conversationID,
      fileID: file.file_id,
      artifactRoot: input.artifactRoot,
    })
    if (!validation.ok) {
      return {
        conversationID: input.conversationID,
        status: "failed",
        itemsRebuilt: 0,
        lifecycleState: "recovery_failed",
        safeError: staleFile(`lcm_context_rebuild_${validation.reason ?? "artifact_invalid"}`, file.file_id),
      }
    }
    candidates.push({
      itemType: "large_file_marker",
      fileID: file.file_id,
      originalOrder: originalOrders.get(`file:${file.file_id}`) ?? Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(file.created_at_ms),
      stableID: file.file_id,
    })
  }

  const messages = (
    await input.db.query<{
      message_row_id: MessageRowID
      message_order: number | string | bigint
      created_at_ms: number | string | bigint
    }>(
      `
        SELECT message_row_id, message_order, created_at_ms
        FROM lcm_messages
        WHERE conversation_id = $1
        ORDER BY message_order, message_row_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const message of messages) {
    if (coveredMessages.has(message.message_row_id)) continue
    if (
      !(await validateRawMessageReference({
        db: input.db,
        conversationID: input.conversationID,
        messageRowID: message.message_row_id,
        artifactRoot: input.artifactRoot,
      }))
    ) {
      return {
        conversationID: input.conversationID,
        status: "failed",
        itemsRebuilt: 0,
        lifecycleState: "recovery_failed",
        safeError: missingSource("lcm_context_rebuild_missing_message_part", input.conversationID),
      }
    }
    candidates.push({
      itemType: "raw_message",
      messageRowID: message.message_row_id,
      originalOrder: originalOrders.get(`raw:${message.message_row_id}`) ?? Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(message.created_at_ms),
      stableID: message.message_row_id,
    })
  }

  if (candidates.length === 0) {
    return {
      conversationID: input.conversationID,
      status: "failed",
      itemsRebuilt: 0,
      lifecycleState: "recovery_failed",
      safeError: missingSource("lcm_context_rebuild_no_provable_source", input.conversationID),
    }
  }

  candidates.sort((left, right) => {
    if (left.originalOrder !== right.originalOrder) return left.originalOrder - right.originalOrder
    const leftGroup =
      left.itemType === "summary"
        ? 1
        : left.itemType === "archive_stub"
          ? 2
          : left.itemType === "large_file_marker"
            ? 3
            : 4
    const rightGroup =
      right.itemType === "summary"
        ? 1
        : right.itemType === "archive_stub"
          ? 2
          : right.itemType === "large_file_marker"
            ? 3
            : 4
    return leftGroup - rightGroup || left.createdAtMs - right.createdAtMs || left.stableID.localeCompare(right.stableID)
  })

  await input.db.transaction(async (tx) => {
    const now = Date.now()
    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, candidate] of candidates.entries()) {
      const row: ContextRow = {
        context_item_id: await allocateContextItemID(tx),
        conversation_id: input.conversationID,
        item_order: index + 1,
        item_type: candidate.itemType,
        message_row_id: candidate.messageRowID ?? null,
        summary_id: candidate.summaryID ?? null,
        pointer_id: candidate.pointerID ?? null,
        file_id: candidate.fileID ?? null,
        cue_payload_json: candidate.cuePayload ?? null,
        token_count: null,
        cache_key: null,
        cache_version: null,
        created_at_ms: now,
        updated_at_ms: now,
      }
      await insertContextRow(tx, row)
    }
    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.strategy,
      reason: input.reason,
      nowMs: now,
    })
  })

  return {
    conversationID: input.conversationID,
    status: "rebuilt",
    itemsRebuilt: candidates.length,
    lifecycleState: "passive_synced",
  }
}

interface LeafSummarySelection {
  readonly conversation: ConversationRow
  readonly rows: ContextRow[]
  readonly sourceItems: LcmLeafSummarySourceItem[]
  readonly protectedTailCount: number
  readonly strategy: LcmStrategy
}

interface LeafSummarySkippedSelection {
  readonly skipped: true
  readonly fingerprint: string
  readonly candidateTokens: number
  readonly candidateItemCount: number
  readonly safeMessage?: string
}

function isLeafSummarySkippedSelection(
  selection: LeafSummarySelection | LeafSummarySkippedSelection | undefined,
): selection is LeafSummarySkippedSelection {
  return !!selection && "skipped" in selection && selection.skipped === true
}

function leafSummaryProtectedTailCount(input: { strategy: LcmStrategy; reason: LcmLeafCompactionInput["reason"] }) {
  if (input.reason === "soft_threshold") {
    return RUNTIME_DEFAULTS.performance.minProtectedTailLeaves
  }
  return RUNTIME_DEFAULTS.performance.minProtectedTailLeaves
}

async function resolveProtectedCurrentUserMessageRowID(input: {
  db: Queryable
  conversationID: ConversationID
  protectedCurrentUser?: LcmProtectedCurrentUserInput
}) {
  const protectedCurrentUser = input.protectedCurrentUser
  if (!protectedCurrentUser) return undefined
  const rows = (
    await input.db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_messages
        WHERE conversation_id = $1
          AND source_session_id = $2
          AND source_message_id = $3
          AND role = 'user'
          ${protectedCurrentUser.messageRowID ? "AND message_row_id = $4" : ""}
        ORDER BY message_order DESC
        LIMIT 1
      `,
      protectedCurrentUser.messageRowID
        ? [
            input.conversationID,
            protectedCurrentUser.sourceSessionID,
            protectedCurrentUser.sourceMessageID,
            protectedCurrentUser.messageRowID,
          ]
        : [input.conversationID, protectedCurrentUser.sourceSessionID, protectedCurrentUser.sourceMessageID],
    )
  ).rows
  return rows[0]?.message_row_id
}

function protectedCurrentUserSkipSelection(input: {
  conversationID: ConversationID
  protectedCurrentUser: LcmProtectedCurrentUserInput
  counter: LcmTokenCounter
}) {
  return {
    skipped: true,
    fingerprint: namespacedHash("lcm-soft-protected-current-user-unproven-v1", {
      conversationID: input.conversationID,
      protectedCurrentUser: input.protectedCurrentUser,
      tokenCounterMode: input.counter.mode,
      tokenCounterVersion: input.counter.version,
    }),
    candidateTokens: 0,
    candidateItemCount: 0,
    safeMessage:
      "Memory maintenance was skipped because the current user boundary is not available as a raw memory row.",
  } satisfies LeafSummarySkippedSelection
}

async function selectLeafSummarySource(input: {
  db: Queryable
  conversationID: ConversationID
  reason: LcmLeafCompactionInput["reason"]
  maintenanceInputBudget?: number
  maxSourceTokens?: number
  counter: LcmTokenCounter
  protectedMessageRowIDs?: readonly MessageRowID[]
  protectedCurrentUser?: LcmProtectedCurrentUserInput
  softThreshold?: number
  freshTailTokens?: number
  artifactRoot?: string
}): Promise<LeafSummarySelection | LeafSummarySkippedSelection | undefined> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_leaf_summary_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_leaf_summary_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_leaf_summary_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const strategy = conversation.strategy ?? "upward"
  const protectedTailCount = leafSummaryProtectedTailCount({ strategy, reason: input.reason })
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const defaultLeafBudget =
    strategy === "dolt" ? RUNTIME_DEFAULTS.dolt.leaves.target : RUNTIME_DEFAULTS.upward.leafChunkTokens
  const protectedCurrentUserMessageRowID = await resolveProtectedCurrentUserMessageRowID({
    db: input.db,
    conversationID: input.conversationID,
    protectedCurrentUser: input.protectedCurrentUser,
  })
  if (input.reason === "soft_threshold" && input.protectedCurrentUser) {
    const protectedCurrentUserActive =
      protectedCurrentUserMessageRowID !== undefined &&
      rows.some((row) => row.item_type === "raw_message" && row.message_row_id === protectedCurrentUserMessageRowID)
    if (!protectedCurrentUserActive) {
      return protectedCurrentUserSkipSelection({
        conversationID: input.conversationID,
        protectedCurrentUser: input.protectedCurrentUser,
        counter: input.counter,
      })
    }
  }
  const protectedMessageRowIDs = new Set(input.protectedMessageRowIDs ?? [])
  if (protectedCurrentUserMessageRowID) protectedMessageRowIDs.add(protectedCurrentUserMessageRowID)
  const isUnprotectedRawRow = (row: ContextRow) =>
    row.item_type === "raw_message" && row.message_row_id && !protectedMessageRowIDs.has(row.message_row_id)
  const rawRows = rows.filter(isUnprotectedRawRow)
  const consumedMessageRowIDs =
    input.reason === "soft_threshold"
      ? await loadConsumedRawMessageRowIDs(input.db, input.conversationID)
      : new Set<MessageRowID>()
  const eligibleRows =
    input.reason === "soft_threshold"
      ? selectSoftBacklogRows({
          rows,
          summaryMetadata,
          strategy,
          targetMessageRowID: protectedCurrentUserMessageRowID,
          freshTailTokens: input.freshTailTokens,
          consumedMessageRowIDs,
        }).filter(isUnprotectedRawRow)
      : rawRows.slice(0, Math.max(0, rawRows.length - protectedTailCount))
  if (eligibleRows.length < RUNTIME_DEFAULTS.performance.minMessagesToSummarize) {
    if (input.reason !== "soft_threshold") return undefined
    return {
      skipped: true,
      fingerprint: namespacedHash("lcm-soft-skip-fingerprint-v1", {
        conversationID: input.conversationID,
        strategy,
        candidateContextItemIDs: eligibleRows.map((row) => row.context_item_id),
        candidateUpdatedAtMs: eligibleRows.map((row) => asNumber(row.updated_at_ms)),
        maintenanceInputBudget: input.maintenanceInputBudget ?? input.maxSourceTokens ?? defaultLeafBudget,
        minMessagesToSummarize: RUNTIME_DEFAULTS.performance.minMessagesToSummarize,
        tokenCounterMode: input.counter.mode,
        tokenCounterVersion: input.counter.version,
      }),
      candidateTokens: 0,
      candidateItemCount: eligibleRows.length,
    }
  }

  const rawFallbackText = await loadRawFallbackText(input.db, input.conversationID, eligibleRows)
  const sourceItems: LcmLeafSummarySourceItem[] = []
  const targetTokens = input.maintenanceInputBudget ?? input.maxSourceTokens ?? defaultLeafBudget
  let tokenTotal = 0
  for (const row of eligibleRows) {
    const text = rawFallbackText.get(row.message_row_id!) ?? ""
    const tokenCount = optionalNumber(row.token_count) ?? input.counter.countText({ text })
    if (tokenCount <= 0) continue
    if (input.reason === "soft_threshold" && tokenTotal + tokenCount > targetTokens) break
    sourceItems.push({
      messageRowID: row.message_row_id!,
      text,
      tokenCount,
    })
    tokenTotal += tokenCount
    if (
      input.reason !== "soft_threshold" &&
      sourceItems.length >= RUNTIME_DEFAULTS.upward.leafMinFanout &&
      tokenTotal >= targetTokens
    )
      break
  }

  if (sourceItems.length < RUNTIME_DEFAULTS.performance.minMessagesToSummarize || tokenTotal <= 1) {
    if (input.reason !== "soft_threshold") return undefined
    return {
      skipped: true,
      fingerprint: namespacedHash("lcm-soft-skip-fingerprint-v1", {
        conversationID: input.conversationID,
        strategy,
        candidateContextItemIDs: eligibleRows.map((row) => row.context_item_id),
        candidateSource: eligibleRows.map((row) => ({
          messageRowID: row.message_row_id,
          cacheKey: row.cache_key,
          tokenCount: optionalNumber(row.token_count),
          updatedAtMs: asNumber(row.updated_at_ms),
        })),
        maintenanceInputBudget: targetTokens,
        minMessagesToSummarize: RUNTIME_DEFAULTS.performance.minMessagesToSummarize,
        tokenCounterMode: input.counter.mode,
        tokenCounterVersion: input.counter.version,
      }),
      candidateTokens: tokenTotal,
      candidateItemCount: sourceItems.length,
    }
  }
  return {
    conversation,
    rows,
    sourceItems,
    protectedTailCount,
    strategy,
  }
}

function usageModeForLeafSummary(input: LcmLeafCompactionInput): LcmUsageMode {
  return input.blocking ? "blocking" : "background"
}

async function insertLeafSummaryUsageRecord(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  evidence: LcmSummaryAttemptEvidence
  purpose?: "leaf_summary" | "condensation" | "hard_limit_maintenance"
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const usageRecordID = await allocateUsageRecordID(input.db)
  const usage = input.evidence.usage
  await input.db.query(
    `
      INSERT INTO lcm_usage_records (
        usage_record_id,
        conversation_id,
        source_session_id,
        job_id,
        purpose,
        mode,
        provider_id,
        model_id,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        cost_amount,
        cost_currency,
        cost_status,
        summary_target_tokens,
        summary_generation_max_output_tokens,
        maintenance_input_budget,
        summary_source_tokens,
        candidate_summary_tokens,
        accepted_summary_tokens,
        summary_objective_status,
        summary_fallback_mode,
        summary_reasoning_policy,
        summary_retry_attempt,
        created_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26
      )
    `,
    [
      usageRecordID,
      input.conversationID,
      input.sessionID,
      input.operationID,
      input.purpose ?? "leaf_summary",
      input.mode,
      usage?.providerID ?? input.providerID ?? null,
      usage?.modelID ?? input.modelID ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.cacheReadTokens ?? null,
      usage?.cacheWriteTokens ?? null,
      usage?.costAmount ?? null,
      usage?.costCurrency ?? null,
      usage?.costStatus ?? (input.evidence.providerBacked ? "unknown" : "not_applicable"),
      input.evidence.summaryTargetTokens,
      input.evidence.summaryGenerationMaxOutputTokens,
      input.evidence.maintenanceInputBudget,
      input.evidence.summarySourceTokens,
      input.evidence.candidateSummaryTokens ?? null,
      input.evidence.acceptedSummaryTokens ?? null,
      input.evidence.summaryObjectiveStatus,
      input.evidence.summaryFallbackMode,
      input.evidence.summaryReasoningPolicy,
      input.evidence.summaryRetryAttempt,
      input.nowMs,
    ],
  )
  return usageRecordID
}

async function insertMaintenanceUsageEvidence(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  purpose: "leaf_summary" | "condensation" | "hard_limit_maintenance"
  evidence: readonly LcmSummaryAttemptEvidence[]
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  let committedUsageRecordID: string | undefined
  for (const evidence of input.evidence) {
    const usageRecordID = await insertLeafSummaryUsageRecord({
      ...input,
      evidence,
    })
    if (
      evidence.summaryObjectiveStatus === "provider_accepted" ||
      evidence.summaryObjectiveStatus === "fallback_accepted"
    ) {
      committedUsageRecordID = usageRecordID
    }
  }
  return committedUsageRecordID
}

async function commitLeafSummary(input: {
  db: Transactional
  conversationID: ConversationID
  operationID: OperationID
  selection: LeafSummarySelection
  summary: Awaited<ReturnType<typeof runLeafSummaryGeneration>>
  blocking: boolean
  reason: LcmLeafCompactionInput["reason"]
  sessionID?: SessionID
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const selectedMessageIDs = new Set(input.selection.sourceItems.map((item) => item.messageRowID))
  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selectedRows = currentRows.filter(
      (row) => row.item_type === "raw_message" && selectedMessageIDs.has(row.message_row_id!),
    )
    if (selectedRows.length !== input.selection.sourceItems.length) {
      throw recoveryRequired("lcm_leaf_summary_context_changed", input.conversationID)
    }
    const selectedContextIDs = new Set(selectedRows.map((row) => row.context_item_id))
    const summaryID = await allocateSummaryID(tx)
    const summaryContextID = await allocateContextItemID(tx)
    const usageRecordID = input.sessionID
      ? await insertMaintenanceUsageEvidence({
          db: tx,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          mode: usageModeForLeafSummary({
            conversationID: input.conversationID,
            reason: input.reason,
            blocking: input.blocking,
          }),
          purpose: "leaf_summary",
          evidence: input.summary.usageEvidence,
          providerID: input.providerID,
          modelID: input.modelID,
          nowMs: input.nowMs,
        })
      : undefined

    await tx.query(
      `
        INSERT INTO lcm_summaries (
          summary_id,
          conversation_id,
          summary_type,
          content_text,
          source_token_count,
          summary_token_count,
          summary_level,
          prompt_version,
          strategy,
          provider_id,
          model_id,
          usage_record_id,
          objective_status,
          fallback_mode,
          created_at_ms
        )
        VALUES ($1, $2, 'sprig', $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        summaryID,
        input.conversationID,
        input.summary.contentText,
        input.summary.sourceTokenCount,
        input.summary.summaryTokenCount,
        LCM_LEAF_SUMMARY_PROMPT_VERSION,
        input.selection.strategy,
        input.summary.usage?.providerID ?? input.providerID ?? null,
        input.summary.usage?.modelID ?? input.modelID ?? null,
        usageRecordID ?? null,
        input.summary.objectiveStatus,
        input.summary.fallbackMode,
        input.nowMs,
      ],
    )

    for (const [index, item] of input.selection.sourceItems.entries()) {
      await tx.query(
        `
          INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order)
          VALUES ($1, $2, $3)
        `,
        [summaryID, item.messageRowID, index + 1],
      )
    }

    const summaryRow: ContextRow = {
      context_item_id: summaryContextID,
      conversation_id: input.conversationID,
      item_order: 0,
      item_type: "summary",
      message_row_id: null,
      summary_id: summaryID,
      pointer_id: null,
      file_id: null,
      cue_payload_json: null,
      token_count: input.summary.summaryTokenCount,
      cache_key: null,
      cache_version: null,
      created_at_ms: input.nowMs,
      updated_at_ms: input.nowMs,
    }

    const nextRows: ContextRow[] = []
    let insertedSummary = false
    for (const row of currentRows) {
      if (selectedContextIDs.has(row.context_item_id)) {
        if (!insertedSummary) {
          nextRows.push(summaryRow)
          insertedSummary = true
        }
        continue
      }
      nextRows.push(row)
    }
    if (!insertedSummary) nextRows.push(summaryRow)

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === summaryContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await tx.query(
      `
        UPDATE lcm_conversations
        SET updated_at_ms = $2
        WHERE conversation_id = $1
      `,
      [input.conversationID, input.nowMs],
    )

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.selection.strategy,
      reason: "leaf_summary",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(`lcm_leaf_summary_commit_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

    return {
      summaryID,
      contextItemsReplaced: selectedRows.length,
      afterContextItems: validation.items ?? [],
    }
  })
}

interface SummaryCondenseSelection {
  readonly conversation: ConversationRow
  readonly rows: ContextRow[]
  readonly selectedRows: ContextRow[]
  readonly sourceItems: LcmCondenseSummarySourceItem[]
  readonly strategy: LcmStrategy
  readonly targetLane: "sprigs" | "bindles"
}

function summaryLane(metadata: SummaryMetadata | undefined): "sprigs" | "bindles" | undefined {
  if (metadata?.summaryType === "sprig") return "sprigs"
  if (metadata?.summaryType === "bindle") return "bindles"
  return undefined
}

function condenseMinFanout(input: { strategy: LcmStrategy; targetLane: "sprigs" | "bindles"; hardPressure: boolean }) {
  if (input.strategy === "dolt") {
    if (input.targetLane === "sprigs") {
      return input.hardPressure ? RUNTIME_DEFAULTS.dolt.sprigs.hardMinFanout : RUNTIME_DEFAULTS.dolt.sprigs.minFanout
    }
    return input.hardPressure ? 2 : 2
  }
  return input.hardPressure
    ? RUNTIME_DEFAULTS.upward.condensedMinFanoutHard
    : RUNTIME_DEFAULTS.upward.condensedMinFanout
}

function condenseTargetTokens(input: { strategy: LcmStrategy; targetLane: "sprigs" | "bindles" }) {
  if (input.strategy === "dolt") {
    return input.targetLane === "sprigs" ? RUNTIME_DEFAULTS.dolt.sprigs.target : RUNTIME_DEFAULTS.dolt.bindles.target
  }
  return RUNTIME_DEFAULTS.upward.condensedTargetTokens
}

function sameOrderRows(left: ContextRow, right: ContextRow) {
  return asNumber(right.item_order) === asNumber(left.item_order) + 1
}

function candidateSourceItems(input: {
  rows: readonly ContextRow[]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  counter: LcmTokenCounter
  minFanout: number
  targetTokens: number
}) {
  const sourceItems: LcmCondenseSummarySourceItem[] = []
  const selectedRows: ContextRow[] = []
  let tokenTotal = 0
  for (const row of input.rows) {
    const summary = input.metadata.get(row.summary_id!)
    if (!summary) return undefined
    const text = renderSummaryWrapper({
      summaryID: row.summary_id!,
      contentText: summary.text,
      parentSummaryIDs: summary.parentSummaryIDs,
      objectiveStatus: summary.objectiveStatus,
      fallbackMode: summary.fallbackMode,
      sourceTokenCount: summary.sourceTokenCount,
      summaryTokenCount: summary.summaryTokenCount,
    })
    const tokenCount = optionalNumber(row.token_count) ?? input.counter.countText({ text })
    if (tokenCount <= 0) continue
    selectedRows.push(row)
    sourceItems.push({
      summaryID: row.summary_id!,
      text,
      tokenCount,
      summaryLevel: summary.summaryLevel,
    })
    tokenTotal += tokenCount
    if (selectedRows.length >= input.minFanout && tokenTotal >= input.targetTokens) break
  }
  if (selectedRows.length < input.minFanout || tokenTotal <= 1) return undefined
  return { selectedRows, sourceItems }
}

function contiguousSummaryRuns(input: {
  rows: readonly ContextRow[]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  targetLane: "sprigs" | "bindles"
}) {
  const runs: ContextRow[][] = []
  let current: ContextRow[] = []
  for (const row of input.rows) {
    const lane = row.item_type === "summary" ? summaryLane(input.metadata.get(row.summary_id!)) : undefined
    const canJoin =
      lane === input.targetLane && (current.length === 0 || sameOrderRows(current[current.length - 1]!, row))
    if (canJoin) {
      current.push(row)
      continue
    }
    if (current.length > 0) runs.push(current)
    current = lane === input.targetLane ? [row] : []
  }
  if (current.length > 0) runs.push(current)
  return runs
}

function selectFromRuns(input: {
  runs: readonly ContextRow[][]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  counter: LcmTokenCounter
  minFanout: number
  targetTokens: number
}) {
  for (const run of input.runs) {
    let start = 0
    while (start < run.length) {
      const startLevel = input.metadata.get(run[start]!.summary_id!)?.summaryLevel
      let end = start + 1
      while (end < run.length && input.metadata.get(run[end]!.summary_id!)?.summaryLevel === startLevel) end++
      const sameLevel = run.slice(start, end)
      const selected = candidateSourceItems({
        rows: sameLevel,
        metadata: input.metadata,
        counter: input.counter,
        minFanout: input.minFanout,
        targetTokens: input.targetTokens,
      })
      if (selected) return selected
      start = end
    }
  }
  for (const run of input.runs) {
    const selected = candidateSourceItems({
      rows: run,
      metadata: input.metadata,
      counter: input.counter,
      minFanout: input.minFanout,
      targetTokens: input.targetTokens,
    })
    if (selected) return selected
  }
  return undefined
}

async function selectSummaryCondenseSource(input: {
  db: Queryable
  conversationID: ConversationID
  targetLane: "sprigs" | "bindles"
  hardPressure: boolean
  counter: LcmTokenCounter
  artifactRoot?: string
}): Promise<SummaryCondenseSelection | undefined> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_summary_condense_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_summary_condense_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(
      `lcm_summary_condense_context_invalid_${validation.reason ?? "unknown"}`,
      input.conversationID,
    )

  const strategy = conversation.strategy ?? "upward"
  const metadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const minFanout = condenseMinFanout({ strategy, targetLane: input.targetLane, hardPressure: input.hardPressure })
  const targetTokens = condenseTargetTokens({ strategy, targetLane: input.targetLane })
  const selected = selectFromRuns({
    runs: contiguousSummaryRuns({ rows, metadata, targetLane: input.targetLane }),
    metadata,
    counter: input.counter,
    minFanout,
    targetTokens,
  })
  if (!selected) return undefined
  return {
    conversation,
    rows,
    selectedRows: selected.selectedRows,
    sourceItems: selected.sourceItems,
    strategy,
    targetLane: input.targetLane,
  }
}

function usagePurposeForSummary(promptVersion: SummaryCondensePromptVersion) {
  return promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION ? "hard_limit_maintenance" : "condensation"
}

async function insertSummaryMaintenanceUsageRecord(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  purpose: "condensation" | "hard_limit_maintenance"
  evidence: readonly LcmSummaryAttemptEvidence[]
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  return insertMaintenanceUsageEvidence({
    db: input.db,
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    mode: input.mode,
    purpose: input.purpose,
    evidence: input.evidence,
    providerID: input.providerID,
    modelID: input.modelID,
    nowMs: input.nowMs,
  })
}

async function commitSummaryCondensation(input: {
  db: Transactional
  conversationID: ConversationID
  operationID: OperationID
  selection: SummaryCondenseSelection
  summary: Awaited<ReturnType<typeof runCondenseSummaryGeneration>>
  blocking: boolean
  promptVersion: SummaryCondensePromptVersion
  sessionID?: SessionID
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const selectedSummaryIDs = input.selection.sourceItems.map((item) => item.summaryID)
  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selectedRows = currentRows.filter(
      (row) => row.item_type === "summary" && selectedSummaryIDs.includes(row.summary_id!),
    )
    if (
      selectedRows.length !== selectedSummaryIDs.length ||
      !selectedRows.every((row, index) => row.summary_id === selectedSummaryIDs[index]) ||
      !selectedRows.every((row, index) => index === 0 || sameOrderRows(selectedRows[index - 1]!, row))
    ) {
      throw recoveryRequired("lcm_summary_condense_context_changed", input.conversationID)
    }

    const selectedContextIDs = new Set(selectedRows.map((row) => row.context_item_id))
    const summaryID = await allocateSummaryID(tx)
    const summaryContextID = await allocateContextItemID(tx)
    const summaryLevel = 1 + Math.max(...input.selection.sourceItems.map((item) => item.summaryLevel))
    const usageRecordID = input.sessionID
      ? await insertSummaryMaintenanceUsageRecord({
          db: tx,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          mode: input.blocking ? "blocking" : "background",
          purpose: usagePurposeForSummary(input.promptVersion),
          evidence: input.summary.usageEvidence,
          providerID: input.providerID,
          modelID: input.modelID,
          nowMs: input.nowMs,
        })
      : undefined

    await tx.query(
      `
        INSERT INTO lcm_summaries (
          summary_id,
          conversation_id,
          summary_type,
          content_text,
          source_token_count,
          summary_token_count,
          summary_level,
          prompt_version,
          strategy,
          provider_id,
          model_id,
          usage_record_id,
          objective_status,
          fallback_mode,
          created_at_ms
        )
        VALUES ($1, $2, 'bindle', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        summaryID,
        input.conversationID,
        input.summary.contentText,
        input.summary.sourceTokenCount,
        input.summary.summaryTokenCount,
        summaryLevel,
        input.promptVersion,
        input.selection.strategy,
        input.summary.usage?.providerID ?? input.providerID ?? null,
        input.summary.usage?.modelID ?? input.modelID ?? null,
        usageRecordID ?? null,
        input.summary.objectiveStatus,
        input.summary.fallbackMode,
        input.nowMs,
      ],
    )

    for (const [index, item] of input.selection.sourceItems.entries()) {
      await tx.query(
        `
          INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
          VALUES ($1, $2, $3)
        `,
        [summaryID, item.summaryID, index + 1],
      )
    }

    const summaryRow: ContextRow = {
      context_item_id: summaryContextID,
      conversation_id: input.conversationID,
      item_order: 0,
      item_type: "summary",
      message_row_id: null,
      summary_id: summaryID,
      pointer_id: null,
      file_id: null,
      cue_payload_json: null,
      token_count: input.summary.summaryTokenCount,
      cache_key: null,
      cache_version: null,
      created_at_ms: input.nowMs,
      updated_at_ms: input.nowMs,
    }

    const nextRows: ContextRow[] = []
    let insertedSummary = false
    for (const row of currentRows) {
      if (selectedContextIDs.has(row.context_item_id)) {
        if (!insertedSummary) {
          nextRows.push(summaryRow)
          insertedSummary = true
        }
        continue
      }
      nextRows.push(row)
    }
    if (!insertedSummary) nextRows.push(summaryRow)

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === summaryContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await tx.query(
      `
        UPDATE lcm_conversations
        SET updated_at_ms = $2
        WHERE conversation_id = $1
      `,
      [input.conversationID, input.nowMs],
    )

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.selection.strategy,
      reason: input.promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION ? "hard_limit" : "condensation",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(
        `lcm_summary_condense_commit_invalid_${validation.reason ?? "unknown"}`,
        input.conversationID,
      )

    return {
      summaryID,
      contextItemsReplaced: selectedRows.length,
      afterContextItems: validation.items ?? [],
    }
  })
}

async function selectArchiveStubCandidate(input: {
  db: Queryable
  conversationID: ConversationID
  counter: LcmTokenCounter
  artifactRoot?: string
}) {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_archive_stub_conversation_not_found")
  if ((conversation.strategy ?? "upward") !== "dolt") return undefined
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_archive_stub_boundary_invalid", input.conversationID)
  }
  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_archive_stub_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const metadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const protectedStart = Math.max(0, rows.length - RUNTIME_DEFAULTS.performance.minProtectedTailLeaves)
  for (const [index, row] of rows.entries()) {
    if (index >= protectedStart) break
    if (row.item_type !== "summary" || !row.summary_id) continue
    const summary = metadata.get(row.summary_id)
    if (summary?.summaryType !== "bindle") continue
    const parentCount = await count(
      input.db,
      "SELECT count(*)::int AS count FROM lcm_summary_parents WHERE summary_id = $1",
      [row.summary_id],
    )
    if (parentCount <= 0) continue
    const existingStub = await count(
      input.db,
      `
        SELECT count(*)::int AS count
        FROM lcm_context_items
        WHERE conversation_id = $1 AND item_type = 'archive_stub' AND summary_id = $2
      `,
      [input.conversationID, row.summary_id],
    )
    if (existingStub > 0) continue
    const pointerID = await allocateSummaryLineagePointerID(input.db)
    const text = renderArchiveStubWrapper({ summaryID: row.summary_id, pointerID })
    const tokenCount = input.counter.countText({ text })
    return {
      conversation,
      rows,
      row,
      pointerID,
      tokenCount,
      rootSummaryID: row.summary_id,
      strategy: conversation.strategy ?? "dolt",
    }
  }
  return undefined
}

async function createArchiveStub(input: {
  db: Transactional
  conversationID: ConversationID
  counter: LcmTokenCounter
  nowMs: number
  artifactRoot?: string
}) {
  const candidate = await selectArchiveStubCandidate({
    db: input.db,
    conversationID: input.conversationID,
    counter: input.counter,
    artifactRoot: input.artifactRoot,
  })
  if (!candidate) return undefined

  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selected = currentRows.find((row) => row.context_item_id === candidate.row.context_item_id)
    if (!selected || selected.item_type !== "summary" || selected.summary_id !== candidate.row.summary_id) {
      throw recoveryRequired("lcm_archive_stub_context_changed", input.conversationID)
    }
    const archiveContextID = await allocateContextItemID(tx)
    await tx.query(
      `
        INSERT INTO lcm_summary_lineage_pointers (
          pointer_id,
          conversation_id,
          summary_id,
          root_summary_id,
          pointer_kind,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, 'archive_stub', $5)
      `,
      [candidate.pointerID, input.conversationID, selected.summary_id, candidate.rootSummaryID, input.nowMs],
    )

    const nextRows = currentRows.map((row): ContextRow => {
      if (row.context_item_id !== selected.context_item_id) return row
      return {
        context_item_id: archiveContextID,
        conversation_id: input.conversationID,
        item_order: row.item_order,
        item_type: "archive_stub",
        message_row_id: null,
        summary_id: selected.summary_id,
        pointer_id: candidate.pointerID,
        file_id: null,
        cue_payload_json: null,
        token_count: candidate.tokenCount,
        cache_key: null,
        cache_version: null,
        created_at_ms: input.nowMs,
        updated_at_ms: input.nowMs,
      }
    })

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === archiveContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: candidate.strategy,
      reason: "archive_stub",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(`lcm_archive_stub_commit_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

    return {
      beforeTokens: optionalNumber(selected.token_count) ?? candidate.tokenCount,
      afterTokens: candidate.tokenCount,
      summariesCreated: 0,
      contextItemsReplaced: 1,
    }
  })
}

async function markRecoveryFailed(db: Queryable, result: LcmRecoveryResult) {
  if (result.status !== "failed") return result
  await db.query(
    `
      UPDATE lcm_conversations
      SET lifecycle_state = 'recovery_failed',
          last_error_code = $2,
          last_safe_message = $3,
          updated_at_ms = $4
      WHERE conversation_id = $1
    `,
    [
      result.conversationID,
      result.safeError?.code ?? "recovery_failed",
      result.safeError?.safeMessage ?? null,
      Date.now(),
    ],
  )
  return result
}

function artifactRootFromDataDir(dataDir: string | undefined) {
  if (!dataDir) return undefined
  return resolveLcmDbLayout(dataDir).artifactsDir
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lcmDb = yield* LcmDb.Service

    const getCurrentContext = Effect.fn("LcmContext.getCurrentContext")(function* (input: {
      conversationID: string
      abortSignal?: AbortSignal
    }) {
      const status = yield* lcmDb.getStatus()
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(db as PGlite, conversationID)
          if (!conversation) throw invalidRequest("lcm_context_conversation_not_found")
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            throw recoveryRequired("lcm_context_boundary_invalid", conversationID)
          }
          const rows = await loadContextRows(db as PGlite, conversationID)
          const validation = await validateContextRows({
            db: db as PGlite,
            conversationID,
            rows,
            allowEmpty: true,
            artifactRoot: artifactRootFromDataDir(status.dataDir),
          })
          if (!validation.ok)
            throw recoveryRequired(`lcm_context_invalid_${validation.reason ?? "unknown"}`, conversationID)
          return validation.items ?? []
        },
      })
    })

    const replaceRetrievalCues = Effect.fn("LcmContext.replaceRetrievalCues")(function* (input: {
      conversationID: string
      targetCurrentUserSourceMessageID: string
      cuePayloads: readonly LcmRetrievalCuePayload[]
      abortSignal?: AbortSignal
      nowMs?: number
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite & Transactional
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(typedDb, conversationID)
          if (!conversation) throw invalidRequest("lcm_retrieval_cue_conversation_not_found")
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            throw recoveryRequired("lcm_retrieval_cue_boundary_invalid", conversationID)
          }
          const now = input.nowMs ?? Date.now()
          await typedDb.transaction(async (tx) => {
            const protection = await requestSnapshotProtectionForConversation({ db: tx, conversationID, nowMs: now })
            const protectedCueIDs = new Set(protection.protectedCueIDs)
            const currentRows = await loadContextRows(tx, conversationID, { includeInactiveCues: true })
            const nonCueRows = currentRows.filter((row) => row.item_type !== "retrieval_cue")
            const cueRows = currentRows.filter((row) => row.item_type === "retrieval_cue")
            const activeCueRows = cueRows.filter((row) => row.cue_lifecycle_state === "active")
            const sameTargetRetry =
              activeCueRows.length > 0 &&
              activeCueRows.every((row) => row.cue_target_source_message_id === input.targetCurrentUserSourceMessageID)
            const activeCueIDsToSupersede = new Set(
              activeCueRows
                .filter((row) =>
                  sameTargetRetry ? row.cue_target_source_message_id === input.targetCurrentUserSourceMessageID : true,
                )
                .map((row) => row.context_item_id),
            )
            const generationID = cueGenerationID()
            const newCueRows: ContextRow[] = []
            for (const cuePayload of input.cuePayloads) {
              if (!isRetrievalCuePayload(cuePayload)) throw invalidRequest("lcm_retrieval_cue_payload_invalid")
              newCueRows.push({
                context_item_id: await allocateContextItemID(tx),
                conversation_id: conversationID,
                item_order: 0,
                item_type: "retrieval_cue",
                message_row_id: null,
                summary_id: null,
                pointer_id: null,
                file_id: null,
                cue_id: cueRowID(),
                cue_payload_json: cuePayload,
                cue_lifecycle_state: "active",
                cue_superseded_by_id: null,
                cue_superseded_by_generation_id: null,
                cue_target_source_message_id: input.targetCurrentUserSourceMessageID,
                cue_generation_id: generationID,
                token_count: cuePayload.tokenCount,
                cache_key: null,
                cache_version: null,
                created_at_ms: now,
                updated_at_ms: now,
              })
            }
            let supersedeIndex = 0
            const oneToOneSuccessors = activeCueIDsToSupersede.size === newCueRows.length
            const supersededRows = cueRows.map((row): ContextRow => {
              if (!activeCueIDsToSupersede.has(row.context_item_id)) return row
              const directSuccessor = oneToOneSuccessors ? newCueRows[supersedeIndex] : undefined
              supersedeIndex++
              return {
                ...row,
                cue_lifecycle_state: "superseded",
                cue_superseded_by_id: directSuccessor?.cue_id ?? null,
                cue_superseded_by_generation_id: generationID,
                updated_at_ms: now,
              }
            })
            const retainedCueRows = supersededRows.flatMap((row): ContextRow[] => {
              const cueID = row.cue_id
              const protectedBySnapshot = cueID ? protectedCueIDs.has(cueID) : false
              const lifecycle = row.cue_lifecycle_state
              if (lifecycle === "active") return [row]
              if (protectedBySnapshot) return [row]
              return []
            })
            const nextRows = [...nonCueRows, ...newCueRows, ...retainedCueRows]
            await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])
            for (const [index, row] of nextRows.entries()) {
              await insertContextRow(tx, {
                ...row,
                item_order: index + 1,
                updated_at_ms: now,
              })
            }
            const validation = await validateContextRows({
              db: tx,
              conversationID,
              rows: await loadContextRows(tx, conversationID, { includeInactiveCues: true }),
              allowEmpty: true,
              allowInactiveCues: true,
            })
            if (!validation.ok)
              throw recoveryRequired(
                `lcm_retrieval_cue_context_invalid_${validation.reason ?? "unknown"}`,
                conversationID,
              )
          })
          return { insertedCues: input.cuePayloads.length }
        },
      })
    })

    const finalizeProviderRequestSnapshot = Effect.fn("LcmContext.finalizeProviderRequestSnapshot")(function* (input: {
      requestSnapshotID: string
      status: LcmProviderRequestSnapshotTerminalStatus
      conversationID?: ConversationID
      nowMs?: number
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        run: async (db) => {
          await finalizeProviderRequestSnapshotRow({ ...input, db: db as PGlite })
        },
      })
    })

    const recordProviderRequestSnapshotFinalValidation = Effect.fn(
      "LcmContext.recordProviderRequestSnapshotFinalValidation",
    )(function* (input: {
      requestSnapshotID: string
      providerValidatorHash: string
      providerFamily?: LcmRenderedSpanProviderFamily
      providerTransformOverheadTokenCount?: number
      conversationID?: ConversationID
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        run: async (db) => {
          await recordProviderRequestSnapshotFinalValidationRow({ ...input, db: db as PGlite })
        },
      })
    })

    const rebuildActiveContext = Effect.fn("LcmContext.rebuildActiveContext")(function* (input: {
      conversationID: string
      reason: string
      strategy?: LcmStrategy
      abortSignal?: AbortSignal
    }) {
      const status = yield* lcmDb.getStatus()
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(typedDb, conversationID)
          if (!conversation) throw invalidRequest("lcm_context_conversation_not_found")
          const strategy: LcmStrategy = input.strategy ?? conversation.strategy ?? "upward"
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            const result: LcmRecoveryResult = {
              conversationID,
              status: "failed",
              itemsRebuilt: 0,
              lifecycleState: "recovery_failed",
              safeError: missingSource("lcm_context_rebuild_boundary_invalid", conversationID),
            }
            return markRecoveryFailed(typedDb, result)
          }

          const artifactRoot = artifactRootFromDataDir(status.dataDir)
          const currentRows = await loadContextRows(typedDb, conversationID)
          const current = await validateContextRows({
            db: typedDb,
            conversationID,
            rows: currentRows,
            allowEmpty: false,
            artifactRoot,
          })
          if (current.ok) {
            await writeContextSnapshot({
              db: typedDb,
              conversationID,
              strategy,
              reason: input.reason,
            })
            return {
              conversationID,
              status: "healthy",
              itemsRebuilt: 0,
              lifecycleState: conversation.lifecycle_state as LcmRecoveryResult["lifecycleState"],
            } satisfies LcmRecoveryResult
          }

          const restored = await restoreFromSnapshots({
            db: typedDb,
            conversationID,
            strategy,
            reason: input.reason,
            artifactRoot,
          })
          if (restored.restored) {
            return {
              conversationID,
              status: "rebuilt",
              itemsRebuilt: restored.count,
              lifecycleState: conversation.lifecycle_state as LcmRecoveryResult["lifecycleState"],
            } satisfies LcmRecoveryResult
          }

          const rebuilt = await durableRebuild({
            db: typedDb,
            conversationID,
            strategy,
            reason: input.reason,
            artifactRoot,
          })
          return markRecoveryFailed(typedDb, rebuilt)
        },
      })
    })

    const isOverThreshold = Effect.fn("LcmContext.isOverThreshold")(function* (input: LcmThresholdRuntimeInput) {
      const counter = thresholdTokenCounter(input)
      const operationID = input.assemblyOperationID ?? input.targetCurrentUser?.promptOperationID
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_before_source_load",
      })
      const status = yield* lcmDb.getStatus()
      const conversationID = input.conversationID as ConversationID
      const providerFamilyRenderPreparation = hasRawLeafThresholdPreparation(input)
        ? input.renderPreparation
        : undefined
      const providerFamily = providerFamilyRenderPreparation
        ? classifyLcmProviderFamily({
            providerID: providerFamilyRenderPreparation.model.providerID,
            modelID: providerFamilyRenderPreparation.model.id,
            apiNpm: providerFamilyRenderPreparation.model.api.npm,
            apiID: providerFamilyRenderPreparation.model.api.id,
            interleaved: providerFamilyRenderPreparation.model.capabilities?.interleaved === true,
          })
        : classifyLcmProviderFamily({
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
          })
      const thresholdSource = yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "token_budget",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite
          const source = await loadThresholdSource({
            db: typedDb,
            conversationID,
            artifactRoot: artifactRootFromDataDir(status.dataDir),
            includeRawMessages: hasRawLeafThresholdPreparation(input) && !!input.renderPreparation,
            hiddenSourceMessageIDs: hasRawLeafThresholdPreparation(input)
              ? (input.renderPreparation?.messageVisibility?.hiddenMessageIDs ?? [])
              : [],
          })
          const providerTransformOverheadReserveTokens = await loadProviderTransformOverheadReserve({
            db: typedDb,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            providerFamily,
            providerContextLimit: input.providerContextLimit,
          })
          const consumedMessageRowIDs = await loadConsumedRawMessageRowIDs(typedDb, conversationID)
          return { source, providerTransformOverheadReserveTokens, consumedMessageRowIDs }
        },
      })
      const { source, providerTransformOverheadReserveTokens, consumedMessageRowIDs } = thresholdSource
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_after_source_load",
      })

      let renderHash = renderManifestHash(input.renderOptions.renderInputManifest ?? input.renderOptions)
      let systemText = tokenBudgetInput(input).systemPromptText ?? ""
      let toolText = tokenBudgetInput(input).toolSchemaText ?? ""
      let providerSafe: ProviderSafeSnapshotEvidence | undefined
      let assemblyCounted: ThresholdContextItemCount[] | undefined
      let assemblyCache: ThresholdAssemblyCache | undefined
      const scalarAliasManifest = input.renderOptions.renderInputManifest
      if (scalarAliasManifest) {
        const aliasDiagnostic = validateRenderOptionAliases({
          renderOptions: input.renderOptions,
          manifest: scalarAliasManifest,
        })
        if (aliasDiagnostic) return yield* Effect.fail(invalidRequest(aliasDiagnostic))
      }
      if (hasRawLeafThresholdPreparation(input) && input.renderPreparation && source.rawMessages.length > 0) {
        const renderPreparation = input.renderPreparation
        if (
          input.renderOptions.providerID !== renderPreparation.model.providerID ||
          input.renderOptions.modelID !== renderPreparation.model.id
        ) {
          return yield* Effect.fail(invalidRequest("lcm_threshold_model_mismatch"))
        }
        const countedAssembly = yield* countThresholdFromAssembly({
          source,
          thresholdInput: input,
          renderPreparation,
          renderOptions: input.renderOptions,
          counter,
          abortSignal: input.abortSignal,
        })
        renderHash = countedAssembly.renderHash
        systemText = countedAssembly.systemText
        toolText = countedAssembly.toolText
        providerSafe = countedAssembly.providerSafe
        assemblyCounted = countedAssembly.counted
        assemblyCache = countedAssembly.assemblyCache
      }
      const providerInputLimit = providerInputLimitWithTransformReserve({
        providerContextLimit: input.providerContextLimit,
        providerInputLimit: input.providerInputLimit,
        reserveTokens: providerTransformOverheadReserveTokens,
      })

      let counted: ThresholdContextItemCount[]
      let decision: LcmThresholdDecision
      try {
        const systemPromptTokens = counter.countText({
          text: systemText,
          cacheKey: overheadCacheKey({
            counter,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            renderHash,
            contentKind: "prompt",
            text: systemText,
          }),
        })
        const toolSchemaTokens = counter.countText({
          text: toolText,
          cacheKey: overheadCacheKey({
            counter,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            renderHash,
            contentKind: "tool_schema",
            text: toolText,
          }),
        })
        counted =
          assemblyCounted ??
          countContextItems({
            source,
            counter,
            renderHash,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            rawModelTexts: [],
            abortSignal: input.abortSignal,
            operationID,
          })
        const activeTokens = counted.reduce((total, item) => total + item.tokenCount, 0)
        const thresholdInput = tokenBudgetInput(input)
        const strategy = input.strategy ?? source.conversation.strategy ?? "upward"
        const budget = {
          providerContextLimit: input.providerContextLimit,
          providerInputLimit,
          providerOutputLimit: input.providerOutputLimit,
          explicitOutputReserve: thresholdInput.explicitOutputReserve,
          providerOutputReserve: thresholdInput.providerOutputReserve,
          activeTokens,
          systemPromptTokens,
          toolSchemaTokens,
        }
        const freshTailTokens = input.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens
        const softBacklog = computeSoftBacklogFromCounted({
          counted,
          summaryMetadata: source.summaryMetadata,
          strategy,
          targetMessageRowID: targetMessageRowIDForSoftBacklog({ source, thresholdInput: input }),
          freshTailTokens,
          consumedMessageRowIDs,
        })
        decision = computeThresholdDecision({
          conversationID,
          strategy,
          budgetStatus: input.budgetStatus,
          budget,
          laneItems: counted.map((item) => item.lane),
          freshTailTokens,
          softBacklogTokens: softBacklog.tokens,
          softBacklogItemCount: softBacklog.itemCount,
          softBacklogLargestSourceTokens: softBacklog.largestSourceTokens,
          freshTailRawTokens: softBacklog.freshTailTokens,
          freshTailRawItemCount: softBacklog.freshTailItemCount,
          unconsumedRawTokens: softBacklog.unconsumedTokens,
          unconsumedRawItemCount: softBacklog.unconsumedItemCount,
          protectedTailRawTokens: softBacklog.protectedTailTokens,
          protectedTailRawItemCount: softBacklog.protectedTailItemCount,
        })
      } catch (error) {
        const safeError = lcmSafeError(error)
        if (safeError) return yield* Effect.fail(safeError)
        return yield* Effect.fail(invalidRequest(tokenBudgetDiagnostic(error)))
      }

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_before_count_persist",
      })
      yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "token_budget",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) =>
          persistThresholdCounts({
            db: db as PGlite,
            conversationID,
            counted,
            decision,
            counter,
            providerContextLimit: input.providerContextLimit,
            providerInputLimit: decision.providerInputLimit,
            providerOutputLimit: input.providerOutputLimit,
            providerTransformOverheadReserveTokens,
            outputReserve: decision.outputReserve,
            providerSafe,
            writeSnapshot: input.recordSnapshot !== false,
          }),
      })
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_after_count_persist",
      })
      if (assemblyCache) thresholdAssemblyCache.set(decision, assemblyCache)
      return decision
    })

    const compactLeavesToSprig = Effect.fn("LcmContext.compactLeavesToSprig")(function* (
      input: LcmLeafCompactionRuntimeInput,
    ) {
      if (input.maintenanceInputBudget !== undefined && input.maxSourceTokens !== undefined) {
        return yield* Effect.fail(invalidRequest("lcm_leaf_summary_budget_alias_conflict"))
      }
      const internal = input
      const operationID = internal.operationID ?? createOperationID()
      const counter = internal.tokenCounter ?? createDeterministicFallbackTokenCounter()
      const conversationID = input.conversationID as ConversationID
      const status = yield* lcmDb.getStatus()
      const runMaintenance = <T>(run: (db: unknown) => Promise<T>) =>
        input.blocking
          ? lcmDb.executeForeground({
              operationID,
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run,
            })
          : lcmDb.execute({
              operationID,
              lane: "background",
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run,
            })

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_before_selection",
      })
      const selection = yield* runMaintenance((db) =>
        selectLeafSummarySource({
          db: db as PGlite,
          conversationID,
          reason: input.reason,
          maintenanceInputBudget: input.maintenanceInputBudget,
          maxSourceTokens: input.maxSourceTokens,
          counter,
          protectedMessageRowIDs: internal.protectedMessageRowIDs,
          protectedCurrentUser: internal.protectedCurrentUser,
          softThreshold: internal.softThreshold,
          freshTailTokens: internal.freshTailTokens,
          artifactRoot: artifactRootFromDataDir(status.dataDir),
        }),
      )
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_after_selection",
      })

      if (isLeafSummarySkippedSelection(selection)) {
        softSkipFingerprints.set(conversationID, selection.fingerprint)
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          beforeTokens: selection.candidateTokens,
          afterTokens: selection.candidateTokens,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "skipped",
          safeMessage: selection.safeMessage ?? "No eligible raw memory span fits the maintenance budget.",
        } satisfies LcmMaintenanceResult
      }

      if (!selection) {
        return {
          conversationID,
          operationID,
          workNeeded: false,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "no_op",
          safeMessage: "No eligible raw leaves are ready for lossless leaf summarization.",
        } satisfies LcmMaintenanceResult
      }

      const summaryTargetTokens = input.summaryTargetTokens ?? RUNTIME_DEFAULTS.performance.summaryTargetTokens
      const summaryGenerationMaxOutputTokens =
        input.summaryGenerationMaxOutputTokens ?? RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens
      const maintenanceInputBudget =
        input.maintenanceInputBudget ??
        input.maxSourceTokens ??
        selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
      const sourceTokenCount = selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
      if (
        input.reason === "soft_threshold" &&
        summaryGenerationMaxOutputTokens < summaryTinyTokenFloor(sourceTokenCount)
      ) {
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          beforeTokens: sourceTokenCount,
          afterTokens: sourceTokenCount,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "skipped",
          safeMessage: "The provider output cap is too small for a useful memory summary.",
        } satisfies LcmMaintenanceResult
      }

      const summaryResult = yield* Effect.tryPromise({
        try: () =>
          runLeafSummaryGeneration({
            operationID,
            conversationID,
            sourceItems: selection.sourceItems,
            counter,
            generator: internal.generator,
            maxAttempts: internal.maxAttempts,
            allowFallback: input.blocking && input.reason !== "soft_threshold",
            summaryTargetTokens,
            summaryGenerationMaxOutputTokens,
            maintenanceInputBudget,
            summaryReasoningPolicy: input.summaryReasoningPolicy ?? "provider_default",
            retrySummaryReasoningPolicy: internal.retrySummaryReasoningPolicy ?? "not_supported",
            allowAggressiveOversize: input.reason === "hard_limit",
            abortSignalID: input.abortSignalID,
            abortSignal: input.abortSignal,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (summary) => ({ ok: true as const, summary }),
        }),
      )
      if (!summaryResult.ok) {
        const error = summaryResult.error
        const safeError = lcmSafeError(error)
        if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
        if (isLcmProviderCapacityDeferredError(error) && !input.blocking) {
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: false,
            blocking: input.blocking,
            reason: input.reason,
            summariesCreated: 0,
            contextItemsReplaced: 0,
            status: "deferred",
            safeMessage: error.safeError.safeMessage,
            safeError: error.safeError,
          } satisfies LcmMaintenanceResult
        }
        if (isLcmSummaryObjectiveFailedError(error)) {
          if (internal.sessionID && error.usageEvidence.length > 0) {
            yield* runMaintenance((db) =>
              insertMaintenanceUsageEvidence({
                db: db as Queryable,
                sessionID: internal.sessionID!,
                conversationID,
                operationID,
                mode: usageModeForLeafSummary({
                  conversationID,
                  reason: input.reason,
                  blocking: input.blocking,
                }),
                purpose: "leaf_summary",
                evidence: error.usageEvidence,
                providerID: internal.providerID,
                modelID: internal.modelID,
                nowMs: internal.nowMs ?? Date.now(),
              }),
            )
          }
          if (input.reason === "soft_threshold") {
            return {
              conversationID,
              operationID,
              workNeeded: true,
              workPerformed: false,
              blocking: input.blocking,
              reason: input.reason,
              beforeTokens: sourceTokenCount,
              afterTokens: sourceTokenCount,
              summariesCreated: 0,
              contextItemsReplaced: 0,
              status: "deferred",
              safeMessage: "Memory summary output did not meet quality checks. Memory maintenance will retry later.",
            } satisfies LcmMaintenanceResult
          }
          const summarySafeError = invalidRequest(error.message)
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: false,
            blocking: input.blocking,
            reason: input.reason,
            beforeTokens: sourceTokenCount,
            afterTokens: sourceTokenCount,
            summariesCreated: 0,
            contextItemsReplaced: 0,
            status: "failed",
            safeMessage: summarySafeError.safeMessage,
            safeError: summarySafeError,
          } satisfies LcmMaintenanceResult
        }
        return yield* Effect.fail(invalidRequest("lcm_leaf_summary_generation_failed"))
      }
      const summary = summaryResult.summary

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_before_commit",
      })
      const committed = yield* runMaintenance((db) =>
        commitLeafSummary({
          db: db as PGlite & Transactional,
          conversationID,
          operationID,
          selection,
          summary,
          blocking: input.blocking,
          reason: input.reason,
          sessionID: internal.sessionID,
          providerID: internal.providerID,
          modelID: internal.modelID,
          nowMs: internal.nowMs ?? Date.now(),
        }),
      )
      softSkipFingerprints.delete(conversationID)

      return {
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: true,
        blocking: input.blocking,
        reason: input.reason,
        beforeTokens: summary.sourceTokenCount,
        afterTokens: summary.summaryTokenCount,
        summariesCreated: 1,
        contextItemsReplaced: committed.contextItemsReplaced,
        status: "completed",
      } satisfies LcmMaintenanceResult
    })

    const compactOneSummaryLane = Effect.fn("LcmContext.compactOneSummaryLane")(function* (input: {
      conversationID: ConversationID
      operationID: OperationID
      targetLane: "sprigs" | "bindles"
      hardPressure: boolean
      blocking: boolean
      promptVersion: SummaryCondensePromptVersion
      counter: LcmTokenCounter
      generator?: LcmSummaryCondenseGenerator
      maxAttempts?: number
      allowFallback?: boolean
      failOnGenerationFailure?: boolean
      summaryTargetTokens?: number
      summaryGenerationMaxOutputTokens?: number
      abortSignalID?: string
      abortSignal?: AbortSignal
      sessionID?: SessionID
      providerID?: string
      modelID?: string
      nowMs: number
      artifactRoot?: string
    }) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_before_selection",
      })
      const selection = yield* lcmDb.executeForeground({
        operationID: input.operationID,
        purpose: "maintenance",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) =>
          selectSummaryCondenseSource({
            db: db as PGlite,
            conversationID: input.conversationID,
            targetLane: input.targetLane,
            hardPressure: input.hardPressure,
            counter: input.counter,
            artifactRoot: input.artifactRoot,
          }),
      })
      if (!selection) return undefined
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_after_selection",
      })

      const summary = yield* Effect.tryPromise({
        try: () =>
          runCondenseSummaryGeneration({
            operationID: input.operationID,
            conversationID: input.conversationID,
            sourceItems: selection.sourceItems,
            counter: input.counter,
            promptVersion: input.promptVersion,
            generator: input.generator,
            maxAttempts: input.maxAttempts,
            allowFallback: input.allowFallback,
            summaryTargetTokens: input.summaryTargetTokens ?? RUNTIME_DEFAULTS.performance.summaryTargetTokens,
            summaryGenerationMaxOutputTokens:
              input.summaryGenerationMaxOutputTokens ?? RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens,
            maintenanceInputBudget: selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0),
            summaryReasoningPolicy: "provider_default",
            retrySummaryReasoningPolicy: "not_supported",
            allowAggressiveOversize: input.promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
            abortSignalID: input.abortSignalID,
            abortSignal: input.abortSignal,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const safeError = lcmSafeError(error)
            if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
            if (isLcmSummaryObjectiveFailedError(error)) {
              if (input.sessionID && error.usageEvidence.length > 0) {
                yield* lcmDb.executeForeground({
                  operationID: input.operationID,
                  purpose: "maintenance",
                  ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
                  run: async (db) =>
                    insertSummaryMaintenanceUsageRecord({
                      db: db as Queryable,
                      sessionID: input.sessionID!,
                      conversationID: input.conversationID,
                      operationID: input.operationID,
                      mode: input.blocking ? "blocking" : "background",
                      purpose: usagePurposeForSummary(input.promptVersion),
                      evidence: error.usageEvidence,
                      providerID: input.providerID,
                      modelID: input.modelID,
                      nowMs: input.nowMs,
                    }),
                })
              }
              if (input.failOnGenerationFailure) return yield* Effect.fail(invalidRequest(error.message))
              return undefined
            }
            if (input.failOnGenerationFailure) {
              return yield* Effect.fail(invalidRequest("lcm_summary_condense_generation_failed"))
            }
            return undefined
          }),
        ),
      )
      if (!summary) return undefined

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_before_commit",
      })
      const committed = yield* lcmDb.executeForeground({
        operationID: input.operationID,
        purpose: "maintenance",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) =>
          commitSummaryCondensation({
            db: db as PGlite & Transactional,
            conversationID: input.conversationID,
            operationID: input.operationID,
            selection,
            summary,
            blocking: input.blocking,
            promptVersion: input.promptVersion,
            sessionID: input.sessionID,
            providerID: input.providerID,
            modelID: input.modelID,
            nowMs: input.nowMs,
          }),
      })
      return {
        beforeTokens: summary.sourceTokenCount,
        afterTokens: summary.summaryTokenCount,
        summariesCreated: 1,
        contextItemsReplaced: committed.contextItemsReplaced,
      }
    })

    const compactUntilUnderHardLimit = Effect.fn("LcmContext.compactUntilUnderHardLimit")(function* (
      input: LcmHardLimitRuntimeInput,
    ) {
      const internal = input
      const operationID = internal.operationID ?? createOperationID()
      const conversationID = input.conversationID as ConversationID
      const counter = internal.tokenCounter ?? createDeterministicFallbackTokenCounter()
      const status = yield* lcmDb.getStatus()
      const artifactRoot = artifactRootFromDataDir(status.dataDir)
      const maxRounds = Math.max(1, internal.maxRounds ?? RUNTIME_DEFAULTS.thresholds.maxBlockingRounds)
      const elapsedNowMs = internal.elapsedNowMs ?? Date.now
      const startedAt = elapsedNowMs()
      const maxElapsedMs = internal.maxElapsedMs ?? 180_000
      const providerContextLimit = Math.max(
        1,
        internal.providerContextLimit ??
          input.threshold.hardLimit +
            input.threshold.outputReserve +
            input.threshold.systemPromptTokens +
            input.threshold.toolSchemaTokens,
      )
      const providerInputLimit = internal.providerInputLimit
      const providerOutputLimit = internal.providerOutputLimit
      const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
        providerContextLimit,
        providerOutputLimit,
      })
      const protectedMessageRowIDs = new Set<MessageRowID>()
      const protectedSourceMessageID =
        internal.renderPreparation?.lastUserMessageID ?? internal.renderPreparation?.lastUser?.id
      if (protectedSourceMessageID) {
        const protectedMessageRowID = yield* lcmDb.executeForeground({
          operationID,
          purpose: "maintenance",
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          run: async (db) =>
            findSourceMessageRowID({
              db: db as PGlite,
              conversationID,
              sourceSessionID: internal.renderPreparation?.sessionID ?? input.sessionID,
              sourceMessageID: protectedSourceMessageID,
            }),
        })
        if (protectedMessageRowID) protectedMessageRowIDs.add(protectedMessageRowID)
      }
      const thresholdInput = () =>
        ({
          conversationID,
          renderOptions: input.renderOptions,
          providerContextLimit,
          providerInputLimit,
          providerOutputLimit,
          budgetStatus: current.budgetStatus,
          renderPreparation: internal.renderPreparation,
          tokenCounter: counter,
          abortSignal: input.abortSignal,
        }) satisfies LcmRawLeafThresholdInput

      let current = input.threshold
      let summariesCreated = 0
      let contextItemsReplaced = 0
      let afterTokens = current.activeTokens
      let elapsedTimeout = false
      const reportProgress = (progress: LcmHardLimitProgress) =>
        internal.onProgress ? internal.onProgress(progress) : Effect.void

      if (!current.overHard) {
        return {
          conversationID,
          operationID,
          workNeeded: false,
          workPerformed: false,
          blocking: true,
          reason: "hard_limit",
          beforeTokens: current.activeTokens,
          afterTokens: current.activeTokens,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "healthy",
        } satisfies LcmMaintenanceResult
      }

      const recompute = Effect.fn("LcmContext.compactUntilUnderHardLimit.recompute")(function* () {
        current = yield* isOverThreshold(thresholdInput())
        afterTokens = current.activeTokens
        return current
      })

      const recordWork = (work: { summariesCreated: number; contextItemsReplaced: number }) => {
        summariesCreated += work.summariesCreated
        contextItemsReplaced += work.contextItemsReplaced
      }

      const targetLanes = () => {
        const lanes: ("sprigs" | "bindles")[] = []
        if (current.lanes.sprigs.overTarget || current.lanes.sprigs.nextAction === "condense_summaries")
          lanes.push("sprigs")
        if (
          current.lanes.bindles.overTarget ||
          current.lanes.bindles.nextAction === "condense_summaries" ||
          current.lanes.bindles.nextAction === "create_archive_stub"
        ) {
          lanes.push("bindles")
        }
        if (lanes.length === 0) lanes.push("sprigs", "bindles")
        return lanes
      }

      const shouldCompactRawLeaves = () =>
        current.lanes.rawLeaves.nextAction === "summarize_leaves" ||
        (current.overHard &&
          current.lanes.rawLeaves.tokens > 0 &&
          current.lanes.rawLeaves.eligibleItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize)

      const hardLimitLeafInputBudget = () => {
        if (current.lanes.rawLeaves.nextAction === "summarize_leaves") return current.lanes.rawLeaves.targetTokens
        const excessTokens = Math.max(0, current.activeTokens - current.hardLimit)
        return Math.max(
          RUNTIME_DEFAULTS.performance.summaryTargetTokens * 2,
          Math.min(
            current.lanes.rawLeaves.targetTokens,
            excessTokens + RUNTIME_DEFAULTS.performance.summaryTargetTokens * 2,
          ),
        )
      }

      const unresolvedDiagnosticCode = () => {
        const hasCompressibleLane =
          current.lanes.rawLeaves.eligibleItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize ||
          current.lanes.sprigs.eligibleItemCount > 0 ||
          current.lanes.bindles.eligibleItemCount > 0
        if (!hasCompressibleLane) return "lcm_hard_limit_unresolved_no_compressible_items"
        if (summariesCreated > 0 || contextItemsReplaced > 0) return "lcm_hard_limit_unresolved_after_maintenance"
        return "lcm_hard_limit_unresolved_m14"
      }

      const canceledMaintenanceResult = (safeError: LcmSafeError): LcmMaintenanceResult => ({
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
        blocking: true,
        reason: "hard_limit",
        beforeTokens: input.threshold.activeTokens,
        afterTokens,
        summariesCreated,
        contextItemsReplaced,
        status: "canceled",
        safeMessage: safeError.safeMessage,
        safeError,
      })

      const checkCanceled = (diagnosticCode: string) =>
        failIfOperationCanceled({
          abortSignal: input.abortSignal,
          operationID,
          diagnosticCode,
        })

      const runHardLimitMaintenance = Effect.gen(function* () {
        yield* checkCanceled("lcm_hard_limit_canceled_before_rounds")
        for (let round = 0; round < maxRounds && current.overHard; round++) {
          yield* checkCanceled("lcm_hard_limit_canceled_before_round")
          if (elapsedNowMs() - startedAt > maxElapsedMs) {
            elapsedTimeout = true
            break
          }
          let worked = false

          if (shouldCompactRawLeaves()) {
            yield* checkCanceled("lcm_hard_limit_canceled_before_leaf_summary")
            yield* reportProgress({ phase: "leaf_summary", round })
            yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_progress")
            const leaf = yield* compactLeavesToSprig({
              conversationID,
              reason: "hard_limit",
              blocking: true,
              maintenanceInputBudget: hardLimitLeafInputBudget(),
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              operationID,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              tokenCounter: counter,
              generator: internal.leafGenerator,
              protectedMessageRowIDs: [...protectedMessageRowIDs],
              maxAttempts: internal.maxAttempts,
              nowMs: internal.nowMs,
            } satisfies LcmLeafCompactionRuntimeInput)
            if (leaf.workPerformed) {
              recordWork(leaf)
              worked = true
              yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_summary")
              yield* recompute()
              yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_recompute")
              continue
            }
            yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_noop")
          }

          for (const lane of targetLanes()) {
            yield* checkCanceled(`lcm_hard_limit_canceled_before_${lane}_condensation`)
            yield* reportProgress({ phase: "condensation", round, lane })
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_progress`)
            const condensed = yield* compactOneSummaryLane({
              conversationID,
              operationID,
              targetLane: lane,
              hardPressure: true,
              blocking: true,
              promptVersion: LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
              counter,
              generator: internal.condenseGenerator,
              maxAttempts: internal.maxAttempts,
              allowFallback: false,
              failOnGenerationFailure: false,
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              nowMs: internal.nowMs ?? Date.now(),
              artifactRoot,
            })
            if (condensed) {
              recordWork(condensed)
              worked = true
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation`)
              yield* recompute()
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_recompute`)
              break
            }
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_noop`)
          }
          if (worked) continue

          if (current.strategy === "dolt" && current.lanes.bindles.overTarget) {
            yield* checkCanceled("lcm_hard_limit_canceled_before_archive_stub")
            yield* reportProgress({ phase: "archive_stub", round, lane: "bindles" })
            yield* checkCanceled("lcm_hard_limit_canceled_after_archive_progress")
            const archived = yield* lcmDb.executeForeground({
              operationID,
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run: async (db) =>
                createArchiveStub({
                  db: db as PGlite & Transactional,
                  conversationID,
                  counter,
                  nowMs: internal.nowMs ?? Date.now(),
                  artifactRoot,
                }),
            })
            if (archived) {
              recordWork(archived)
              worked = true
              yield* checkCanceled("lcm_hard_limit_canceled_after_archive_stub")
              yield* recompute()
              yield* checkCanceled("lcm_hard_limit_canceled_after_archive_recompute")
              continue
            }
            yield* checkCanceled("lcm_hard_limit_canceled_after_archive_noop")
          }

          for (const lane of targetLanes()) {
            yield* checkCanceled(`lcm_hard_limit_canceled_before_${lane}_aggressive_condensation`)
            yield* reportProgress({ phase: "aggressive_condensation", round, lane })
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_progress`)
            const aggressive = yield* compactOneSummaryLane({
              conversationID,
              operationID,
              targetLane: lane,
              hardPressure: true,
              blocking: true,
              promptVersion: LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
              counter,
              generator: internal.condenseGenerator,
              maxAttempts: internal.maxAttempts,
              allowFallback: true,
              failOnGenerationFailure: true,
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              nowMs: internal.nowMs ?? Date.now(),
              artifactRoot,
            })
            if (aggressive) {
              recordWork(aggressive)
              worked = true
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_condensation`)
              yield* recompute()
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_recompute`)
              break
            }
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_noop`)
          }

          if (!worked) break
        }

        yield* checkCanceled("lcm_hard_limit_canceled_before_result")
        if (!current.overHard) {
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
            blocking: true,
            reason: "hard_limit",
            beforeTokens: input.threshold.activeTokens,
            afterTokens,
            summariesCreated,
            contextItemsReplaced,
            status: "completed",
          } satisfies LcmMaintenanceResult
        }

        const safeError = elapsedTimeout
          ? operationTimeout({
              diagnosticCode: "lcm_hard_limit_maintenance_timeout",
              operationID,
            })
          : hardLimitUnresolved({
              diagnosticCode: unresolvedDiagnosticCode(),
              operationID,
              conversationID,
              beforeTokens: input.threshold.activeTokens,
              hardLimit: input.threshold.hardLimit,
            })
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
          blocking: true,
          reason: "hard_limit",
          beforeTokens: input.threshold.activeTokens,
          afterTokens,
          summariesCreated,
          contextItemsReplaced,
          status: "failed",
          safeMessage: safeError.safeMessage,
          safeError,
        } satisfies LcmMaintenanceResult
      })

      return yield* runHardLimitMaintenance.pipe(
        Effect.catch((error) => {
          const safeError = lcmSafeError(error)
          if (safeError?.code === "canceled") {
            return Effect.succeed(canceledMaintenanceResult(safeError))
          }
          return Effect.fail(error)
        }),
      )
    })

    return Service.of({
      runtimeDbBinding: "lcm_context_layer",
      getCurrentContext,
      rebuildActiveContext,
      replaceRetrievalCues,
      finalizeProviderRequestSnapshot,
      recordProviderRequestSnapshotFinalValidation,
      assembleModelMessages: (input) =>
        Effect.gen(function* () {
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_before_start",
          })
          if (!hasRawLeafRenderPreparation(input)) {
            return yield* Effect.fail(invalidRequest("lcm_raw_leaf_render_preparation_missing"))
          }
          const renderPreparation = input.renderPreparation
          if (
            input.renderOptions.providerID !== renderPreparation.model.providerID ||
            input.renderOptions.modelID !== renderPreparation.model.id
          ) {
            return yield* Effect.fail(invalidRequest("lcm_raw_leaf_model_mismatch"))
          }
          const assemblyThreshold = input.threshold
          const cached = assemblyThreshold ? thresholdAssemblyCache.get(assemblyThreshold) : undefined
          if (
            assemblyThreshold &&
            cached &&
            cached.conversationID === input.conversationID &&
            cached.targetCurrentUserHash === stableHash(input.targetCurrentUser) &&
            cached.renderOptionsHash === stableHash(input.renderOptions)
          ) {
            const requestSnapshotID = providerRequestSnapshotID()
            const validatedModelMessages = cached.prepared.modelMessages as LcmValidatedModelMessages
            const cachedRenderedSpans = [...cached.renderedSpans]
            const preparedProviderPayload = {
              operationID: input.targetCurrentUser.promptOperationID,
              conversationID: input.conversationID,
              providerRequestSnapshotID: requestSnapshotID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              systemPromptHash: cached.renderInputManifest.systemPromptHash,
              toolSchemaHash: cached.renderInputManifest.toolSchemaHash,
              ...(cached.prepared.toolChoice ? { toolChoiceHash: stableHash(cached.prepared.toolChoice) } : {}),
              modelMessages: validatedModelMessages,
              renderInputManifest: cached.renderInputManifest,
              renderedSpans: cachedRenderedSpans,
              assemblyValidatorHash: cached.renderInputManifest.assemblyValidatorHash,
              system: cached.prepared.system,
              tools: cached.prepared.tools,
              ...(cached.prepared.toolChoice ? { toolChoice: cached.prepared.toolChoice } : {}),
              format: cached.prepared.format,
            } satisfies LcmRuntimePreparedProviderPayload
            const validationDiagnostic = validateAssemblyPayload({
              payload: preparedProviderPayload,
              modelMessageCount: cached.prepared.modelMessages.length,
              renderUnits: cached.renderUnits,
            })
            if (validationDiagnostic) {
              return {
                conversationID: input.conversationID,
                lifecycleState: cached.lifecycleState,
                ok: false,
                contextItems: [...cached.contextItems],
                safeError: invalidRequest(validationDiagnostic),
              } satisfies LcmAssemblyResult
            }
            if (assemblyThreshold.activeTokens !== cached.activeTokens) {
              return {
                conversationID: input.conversationID,
                lifecycleState: cached.lifecycleState,
                ok: false,
                contextItems: [...cached.contextItems],
                safeError: invalidRequest("lcm_provider_assembly_threshold_active_tokens_mismatch"),
              } satisfies LcmAssemblyResult
            }
            yield* failIfOperationCanceled({
              abortSignal: input.abortSignal,
              operationID: input.targetCurrentUser.promptOperationID,
              diagnosticCode: "lcm_provider_assembly_canceled_before_cached_snapshot",
            })
            if (cached.providerSafe.items.size === cached.contextItems.length) {
              yield* lcmDb.executeForeground({
                operationID: input.targetCurrentUser.promptOperationID,
                purpose: "assembly",
                ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
                run: async (db) =>
                  writeContextSnapshot({
                    db: db as PGlite,
                    conversationID: input.conversationID,
                    strategy: assemblyThreshold.strategy,
                    reason: "assembly",
                    nowMs: Date.now(),
                    threshold: {
                      activeTokens: assemblyThreshold.activeTokens,
                      hardLimit: assemblyThreshold.hardLimit,
                      softThreshold: assemblyThreshold.softThreshold,
                      freshTailTokens: assemblyThreshold.freshTailTokens,
                      softBacklogTokens: assemblyThreshold.softBacklogTokens,
                      softBacklogItemCount: assemblyThreshold.softBacklogItemCount,
                      freshTailRawTokens: assemblyThreshold.freshTailRawTokens,
                      freshTailRawItemCount: assemblyThreshold.freshTailRawItemCount,
                      unconsumedRawTokens: assemblyThreshold.unconsumedRawTokens,
                      unconsumedRawItemCount: assemblyThreshold.unconsumedRawItemCount,
                      protectedTailRawTokens: assemblyThreshold.protectedTailRawTokens,
                      protectedTailRawItemCount: assemblyThreshold.protectedTailRawItemCount,
                      rawLaneTokens: assemblyThreshold.rawLaneTokens,
                      hardFillRatio: assemblyThreshold.hardFillRatio,
                      rawLaneRatio: assemblyThreshold.rawLaneRatio,
                      softBacklogRatio: assemblyThreshold.softBacklogRatio,
                      lanes: assemblyThreshold.lanes,
                      tokenCounterMode: assemblyThreshold.tokenCounterMode,
                      tokenCounterVersion: assemblyThreshold.tokenCounterVersion,
                      providerContextLimit: assemblyThreshold.providerContextLimit,
                      providerInputLimit: assemblyThreshold.providerInputLimit,
                      providerOutputLimit: assemblyThreshold.providerOutputLimit,
                      outputReserve: assemblyThreshold.outputReserve,
                    },
                    providerSafe: cached.providerSafe,
                  }),
              })
            }
            yield* failIfOperationCanceled({
              abortSignal: input.abortSignal,
              operationID: input.targetCurrentUser.promptOperationID,
              diagnosticCode: "lcm_provider_assembly_canceled_before_cached_request_snapshot",
            })
            yield* lcmDb.executeForeground({
              operationID: input.targetCurrentUser.promptOperationID,
              purpose: "assembly",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run: (db) =>
                createProviderRequestSnapshot({
                  db: db as PGlite,
                  requestSnapshotID,
                  operationID: input.targetCurrentUser.promptOperationID as OperationID,
                  conversationID: input.conversationID,
                  sourceSessionID: input.sessionID,
                  providerID: input.renderOptions.providerID,
                  modelID: input.renderOptions.modelID,
                  renderUnits: cached.renderUnits,
                  manifest: cached.renderInputManifest,
                  nowMs: Date.now(),
                }),
            })
            return {
              conversationID: input.conversationID,
              lifecycleState: cached.lifecycleState,
              ok: true,
              contextItems: [...cached.contextItems],
              modelMessages: validatedModelMessages,
              renderedSpans: cachedRenderedSpans,
              activeTokens: cached.activeTokens,
              preparedProviderPayload,
              providerRequestSnapshotID: requestSnapshotID,
              normalizedParityKey: rawLeafNormalizedParityKey({
                modelMessages: cached.prepared.modelMessages,
                renderInputManifest: cached.renderInputManifest,
              }),
            } satisfies LcmAssemblyResult
          }

          const contextItems = yield* getCurrentContext({
            conversationID: input.conversationID,
            abortSignal: input.abortSignal,
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_context_load",
          })
          const {
            rawEntries,
            lifecycleState,
            summaryModelMessages,
            markerModelMessages,
            requestSnapshotProtectionHash,
            visibilityProvenance,
          } = yield* lcmDb.executeForeground({
            operationID: createOperationID(),
            purpose: "assembly",
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            run: async (db) => {
              const conversationID = input.conversationID as ConversationID
              const conversation = await findConversation(db as PGlite, conversationID)
              if (!conversation) throw invalidRequest("lcm_raw_leaf_conversation_not_found")
              if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
                throw recoveryRequired("lcm_raw_leaf_boundary_invalid", conversationID)
              }
              const summaryMessages = await loadSummaryWrapperMessages({
                db: db as PGlite,
                conversationID,
                contextItems,
              })
              const markerMessages = await loadStandaloneLargeFileMarkerMessages({
                db: db as PGlite,
                conversationID,
                contextItems,
              })
              const protection = await requestSnapshotProtectionForConversation({
                db: db as PGlite,
                conversationID,
                nowMs: Date.now(),
              })
              const visibilityProvenance = await loadVisibilityProvenance({
                db: db as PGlite,
                conversationID,
                contextItems,
                hiddenSourceMessageIDs: renderPreparation.messageVisibility?.hiddenMessageIDs ?? [],
              })
              return {
                lifecycleState: conversation.lifecycle_state as LcmLifecycleState,
                rawEntries: await loadRawLeafMessageEntries({
                  db: db as PGlite,
                  conversationID,
                  contextItems,
                }),
                summaryModelMessages: summaryMessages,
                markerModelMessages: markerMessages,
                requestSnapshotProtectionHash: protection.requestSnapshotProtectionHash,
                visibilityProvenance,
              }
            },
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_source_load",
          })
          let renderUnits: LcmRenderUnit[]
          try {
            renderUnits = buildRenderUnits({
              conversationID: input.conversationID,
              contextItems,
              rawEntries,
              summaryModelMessages,
              markerModelMessages,
              visibilityProvenance,
              renderPreparation,
              targetCurrentUser: input.targetCurrentUser,
              abortSignal: input.abortSignal,
            })
            renderUnits = withRenderUnitOrigins(renderUnits)
          } catch (error) {
            const safeError = lcmSafeError(error)
            if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: safeError ?? invalidRequest("lcm_provider_assembly_render_unit_build_failed"),
            } satisfies LcmAssemblyResult
          }
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_render_units",
          })
          const targetUnit = renderUnits.find((unit) => unit.source.kind === "target_current_user")
          if (!targetUnit || targetUnit.message.info.role !== "user") {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: missingSource("lcm_provider_assembly_target_current_user_missing", input.conversationID),
            } satisfies LcmAssemblyResult
          }
          const lastUser =
            renderPreparation.lastUser &&
            renderPreparation.lastUser.id === targetUnit.message.info.id &&
            renderPreparation.lastUser.sessionID === targetUnit.message.info.sessionID
              ? {
                  ...targetUnit.message.info,
                  editorContext: renderPreparation.lastUser.editorContext,
                }
              : targetUnit.message.info
          const prepared = yield* prepareKiloModelInput({
            ...renderPreparation,
            messages: renderUnits.map((unit) => unit.message),
            lastUser,
            operationID: input.targetCurrentUser.promptOperationID,
            lcmActive: true,
            stripMedia: input.renderOptions.stripMedia,
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_render_preparation",
          })
          const prefixCounts = yield* renderPrefixCounts({
            messages: prepared.messages,
            renderPreparation,
            stripMedia: input.renderOptions.stripMedia,
            expectedModelMessageCount: prepared.modelMessages.length,
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_prefix_counts",
          })
          const unitByMessageID = new Map(renderUnits.map((unit) => [unit.message.info.id, unit] as const))
          const spansByUnitID = new Map<string, LcmRenderedSpan>()
          const providerFamily = classifyLcmProviderFamily({
            providerID: renderPreparation.model.providerID,
            modelID: renderPreparation.model.id,
            apiNpm: renderPreparation.model.api.npm,
            apiID: renderPreparation.model.api.id,
            interleaved: renderPreparation.model.capabilities?.interleaved === true,
          })
          for (const [messageIndex, message] of prepared.messages.entries()) {
            const unit = unitByMessageID.get(message.info.id)
            if (!unit) {
              if (message.parts.length === 0) continue
              return {
                conversationID: input.conversationID,
                lifecycleState,
                ok: false,
                contextItems,
                safeError: invalidRequest("lcm_provider_assembly_untracked_prepared_message"),
              } satisfies LcmAssemblyResult
            }
            spansByUnitID.set(
              unit.renderUnitID,
              renderedSpanForUnit({
                unit,
                startIndex: prefixCounts[messageIndex] ?? 0,
                messageCount: (prefixCounts[messageIndex + 1] ?? 0) - (prefixCounts[messageIndex] ?? 0),
                providerFamily,
                providerTransformHash: prepared.renderInputManifest.providerTransformHash,
                renderPreparation,
              }),
            )
          }
          const missingSpanUnit = renderUnits.find((unit) => !spansByUnitID.has(unit.renderUnitID))
          if (missingSpanUnit) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_missing_rendered_span"),
            } satisfies LcmAssemblyResult
          }
          const renderedSpans = renderUnits.map((unit) => spansByUnitID.get(unit.renderUnitID)!)
          const renderInputManifest = manifestWithAssemblyHashes({
            manifest: {
              ...prepared.renderInputManifest,
              requestSnapshotProtectionHash,
            },
            renderUnits,
            renderedSpans,
            providerTransformHash: prepared.renderInputManifest.providerTransformHash,
          })
          const aliasDiagnostic = validateRenderOptionAliases({
            renderOptions: input.renderOptions,
            manifest: renderInputManifest,
          })
          if (aliasDiagnostic) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest(aliasDiagnostic),
            } satisfies LcmAssemblyResult
          }
          const requestSnapshotID = providerRequestSnapshotID()
          const validatedModelMessages = prepared.modelMessages as LcmValidatedModelMessages
          const preparedProviderPayload = {
            operationID: input.targetCurrentUser.promptOperationID,
            conversationID: input.conversationID,
            providerRequestSnapshotID: requestSnapshotID,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            systemPromptHash: renderInputManifest.systemPromptHash,
            toolSchemaHash: renderInputManifest.toolSchemaHash,
            ...(prepared.toolChoice ? { toolChoiceHash: stableHash(prepared.toolChoice) } : {}),
            modelMessages: validatedModelMessages,
            renderInputManifest,
            renderedSpans,
            assemblyValidatorHash: renderInputManifest.assemblyValidatorHash,
            system: prepared.system,
            tools: prepared.tools,
            ...(prepared.toolChoice ? { toolChoice: prepared.toolChoice } : {}),
            format: prepared.format,
          } satisfies LcmRuntimePreparedProviderPayload
          const validationDiagnostic = validateAssemblyPayload({
            payload: preparedProviderPayload,
            modelMessageCount: prepared.modelMessages.length,
            renderUnits,
          })
          if (validationDiagnostic) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest(validationDiagnostic),
            } satisfies LcmAssemblyResult
          }
          const activeTokens = countAssemblyActiveTokens({
            modelMessages: prepared.modelMessages,
            renderedSpans,
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
          })
          if (assemblyThreshold && assemblyThreshold.activeTokens !== activeTokens) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_threshold_active_tokens_mismatch"),
            } satisfies LcmAssemblyResult
          }
          const providerSafe: ProviderSafeSnapshotEvidence = {
            renderInputManifest,
            items: renderUnitSnapshotItemsFromContextItems({ renderUnits, contextItems }),
          }
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_before_snapshot_write",
          })
          if (assemblyThreshold && providerSafe.items.size === contextItems.length) {
            yield* lcmDb.executeForeground({
              operationID: input.targetCurrentUser.promptOperationID,
              purpose: "assembly",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run: async (db) =>
                writeContextSnapshot({
                  db: db as PGlite,
                  conversationID: input.conversationID,
                  strategy: assemblyThreshold.strategy,
                  reason: "assembly",
                  nowMs: Date.now(),
                  threshold: {
                    activeTokens: assemblyThreshold.activeTokens,
                    hardLimit: assemblyThreshold.hardLimit,
                    softThreshold: assemblyThreshold.softThreshold,
                    freshTailTokens: assemblyThreshold.freshTailTokens,
                    softBacklogTokens: assemblyThreshold.softBacklogTokens,
                    softBacklogItemCount: assemblyThreshold.softBacklogItemCount,
                    freshTailRawTokens: assemblyThreshold.freshTailRawTokens,
                    freshTailRawItemCount: assemblyThreshold.freshTailRawItemCount,
                    unconsumedRawTokens: assemblyThreshold.unconsumedRawTokens,
                    unconsumedRawItemCount: assemblyThreshold.unconsumedRawItemCount,
                    protectedTailRawTokens: assemblyThreshold.protectedTailRawTokens,
                    protectedTailRawItemCount: assemblyThreshold.protectedTailRawItemCount,
                    rawLaneTokens: assemblyThreshold.rawLaneTokens,
                    hardFillRatio: assemblyThreshold.hardFillRatio,
                    rawLaneRatio: assemblyThreshold.rawLaneRatio,
                    softBacklogRatio: assemblyThreshold.softBacklogRatio,
                    lanes: assemblyThreshold.lanes,
                    tokenCounterMode: assemblyThreshold.tokenCounterMode,
                    tokenCounterVersion: assemblyThreshold.tokenCounterVersion,
                    providerContextLimit: assemblyThreshold.providerContextLimit,
                    providerInputLimit: assemblyThreshold.providerInputLimit,
                    providerOutputLimit: assemblyThreshold.providerOutputLimit,
                    outputReserve: assemblyThreshold.outputReserve,
                  },
                  providerSafe,
                }),
            })
          }
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_before_request_snapshot",
          })
          yield* lcmDb.executeForeground({
            operationID: input.targetCurrentUser.promptOperationID,
            purpose: "assembly",
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            run: (db) =>
              createProviderRequestSnapshot({
                db: db as PGlite,
                requestSnapshotID,
                operationID: input.targetCurrentUser.promptOperationID as OperationID,
                conversationID: input.conversationID,
                sourceSessionID: input.sessionID,
                providerID: input.renderOptions.providerID,
                modelID: input.renderOptions.modelID,
                renderUnits,
                manifest: renderInputManifest,
                nowMs: Date.now(),
              }),
          })
          return {
            conversationID: input.conversationID,
            lifecycleState,
            ok: true,
            contextItems,
            modelMessages: validatedModelMessages,
            renderedSpans,
            activeTokens,
            preparedProviderPayload,
            providerRequestSnapshotID: requestSnapshotID,
            normalizedParityKey: rawLeafNormalizedParityKey({
              modelMessages: prepared.modelMessages,
              renderInputManifest,
            }),
          } satisfies LcmAssemblyResult
        }),
      isOverThreshold,
      compactLeavesToSprig,
      compactUntilUnderHardLimit,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LcmDb.defaultLayer))

export * as LcmContext from "./context"
