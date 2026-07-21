// kilocode_change - new file; extracted from the LCM context service
import { Effect, Schema } from "effect"
import { renderLargeFileMarker } from "./artifacts"
import { namespacedHash, stableHash } from "./hash"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID } from "../schema"
import type { LcmPreparedRenderInput, PrepareKiloModelInput } from "./render-prep"
import {
  LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
  type LcmLeafSummaryGenerator,
  type LcmSummaryCondenseGenerator,
} from "./summary"
import { parseLcmSafeError } from "./safe-error-schema"
import {
  createLcmSafeError,
  type ContextItem,
  type ContextItemID,
  type ContextItemType,
  type ConversationID,
  type LcmAssemblyInput,
  type LcmFileID,
  type LcmLifecycleState,
  type LcmHardLimitInput,
  type LcmLeafCompactionInput,
  type LcmProtectedCurrentUserInput,
  type LcmRenderedSpan,
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
  type MessageRowID,
  type OperationID,
  type SessionID,
  type SummaryID,
} from "./types"
import {
  LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
  createDeterministicFallbackTokenCounter,
  type LcmLaneSourceItem,
  type LcmTokenCounter,
} from "./token-budget"

// Maintainer boundary: This module owns finalized-row reconstruction and the shared context data model. Keep supported part states aligned with source sync and prove renderer parity whenever reconstruction changes.
export const LCM_CONTEXT_RESTORE_MANIFEST_VERSION = "lcm-context-restore-manifest-v2"
export const LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION = LCM_CONTEXT_RESTORE_MANIFEST_VERSION
export const LCM_CONTEXT_SHELL_TOKEN_COUNTER_MODE = "fake" satisfies LcmTokenCounterMode
export const LCM_CONTEXT_SHELL_TOKEN_COUNTER_VERSION = "lcm-context-shell-fake-token-counter-v1"
export const LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE = "deterministic_fallback" satisfies LcmTokenCounterMode
export const LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION = LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION
export const LCM_PROVIDER_VALIDATOR_PENDING_M39 = "lcm-provider-validator-pending-m39-v1"
export const LCM_PROVIDER_REQUEST_SNAPSHOT_TTL_MS = 30 * 60 * 1000

export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface Transactional extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>
}

export interface ConversationRow {
  conversation_id: ConversationID
  source_session_id: string
  parent_conversation_id: ConversationID | null
  root_conversation_id: ConversationID
  project_id: string
  workspace_id: string | null
  session_directory: string
  worktree_path: string | null
  capability_class: string
  lifecycle_state: string
  strategy?: LcmStrategy | null
  boundary_metadata_json: unknown
}

export interface ContextRow {
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

export interface ProviderRequestSnapshotRow {
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

export interface SnapshotRow {
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

export interface FileRow {
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

export type SummaryCondensePromptVersion =
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

export type LcmContextRestoreManifestItem =
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

export type LcmContextRestoreManifestItemV2 = LcmContextRestoreManifestItem & {
  renderUnitID: string
  canonicalOrder: number
  effectiveOrder: number
  placementSlot: LcmAssemblyPlacementSlot
}

export interface LcmContextRestoreManifestV2 extends LcmContextRestoreManifestBase {
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

export type LcmContextRestoreManifest = LcmContextRestoreManifestV2

export interface ValidationResult {
  ok: boolean
  reason?: string
  rows?: ContextRow[]
  items?: ContextItem[]
}

export interface ContextCandidate {
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

export interface ThresholdContextItemCount {
  readonly row: ContextRow
  readonly tokenCount: number
  readonly cacheKey: string
  readonly lane: LcmLaneSourceItem
}

export interface ProviderSafeSnapshotItem {
  readonly contextItemID: ContextItemID
  readonly renderUnitID: string
  readonly canonicalOrder: number
  readonly effectiveOrder: number
  readonly placementSlot: LcmAssemblyPlacementSlot
}

export interface ProviderSafeSnapshotEvidence {
  readonly renderInputManifest: LcmRenderInputManifestV1
  readonly items: ReadonlyMap<ContextItemID, ProviderSafeSnapshotItem>
  readonly providerTransformOverheadTokenCount?: number
}

export interface ThresholdAssemblyCache {
  readonly conversationID: ConversationID
  readonly lifecycleState: LcmLifecycleState
  readonly conversationAuthorityHash: string
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly contextItems: readonly ContextItem[]
  readonly contextStateHash: string
  readonly modelVisibleSourceStateHash: string
  readonly consumedSourceHash: string
  readonly providerTransformOverheadReserveTokens: number
  readonly targetCurrentUserHash: string
  readonly renderOptionsHash: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly prepared: LcmPreparedRenderInput
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly renderInputManifest: LcmRenderInputManifestV1
  readonly activeTokens: number
  readonly providerSafe: ProviderSafeSnapshotEvidence
  readonly thresholdDecisionHash?: string
}

// The cached render is valid only for the exact decision object while active
// context remains unchanged between threshold counting and assembly.
export const thresholdAssemblyCache = new WeakMap<LcmThresholdDecision, ThresholdAssemblyCache>()

function thresholdDecisionImmutableHash(decision: LcmThresholdDecision) {
  const {
    lanes: _lanes,
    laneLatchDiagnostics: _laneLatchDiagnostics,
    overSoft: _overSoft,
    softPressureReason: _softPressureReason,
    ...immutable
  } = decision
  return stableHash(immutable)
}

// Threshold diagnostics may clone the public decision object. Preserve the
// private prepared-render binding explicitly or assembly would silently fall
// back to a weaker path for those otherwise equivalent decisions.
export function inheritThresholdAssemblyCache(source: LcmThresholdDecision, target: LcmThresholdDecision) {
  const cached = thresholdAssemblyCache.get(source)
  if (
    cached?.thresholdDecisionHash === stableHash(source) &&
    thresholdDecisionImmutableHash(source) === thresholdDecisionImmutableHash(target)
  ) {
    thresholdAssemblyCache.set(target, { ...cached, thresholdDecisionHash: stableHash(target) })
  }
  return target
}

export function conversationAuthorityHash(row: ConversationRow) {
  return namespacedHash("lcm-conversation-authority-v1", {
    conversationID: row.conversation_id,
    sourceSessionID: row.source_session_id,
    parentConversationID: row.parent_conversation_id,
    rootConversationID: row.root_conversation_id,
    projectID: row.project_id,
    workspaceID: row.workspace_id,
    sessionDirectory: row.session_directory,
    worktreePath: row.worktree_path,
    capabilityClass: row.capability_class,
    lifecycleState: row.lifecycle_state,
    strategy: row.strategy ?? null,
    boundaryMetadata: jsonValue(row.boundary_metadata_json),
  })
}

export function contextRowsSemanticHash(rows: readonly ContextRow[]) {
  return namespacedHash(
    "lcm-context-row-state-v1",
    rows.map((row) => ({
      contextItemID: row.context_item_id,
      itemOrder: asNumber(row.item_order),
      itemType: row.item_type,
      messageRowID: row.message_row_id,
      summaryID: row.summary_id,
      pointerID: row.pointer_id,
      fileID: row.file_id,
      cueID: row.cue_id ?? null,
      cuePayload: jsonValue(row.cue_payload_json),
      cueLifecycleState: row.cue_lifecycle_state ?? null,
      cueSupersededByID: row.cue_superseded_by_id ?? null,
      cueSupersededByGenerationID: row.cue_superseded_by_generation_id ?? null,
      cueTargetSourceMessageID: row.cue_target_source_message_id ?? null,
      cueGenerationID: row.cue_generation_id ?? null,
    })),
  )
}

export function modelVisibleSourceStateHash(input: {
  readonly rawMessages: readonly MessageV2.WithParts[]
  readonly markerModelMessages: ReadonlyMap<ContextItemID, unknown>
}) {
  return namespacedHash("lcm-model-visible-source-state-v1", {
    rawMessages: input.rawMessages,
    markerModelMessages: [...input.markerModelMessages.entries()],
  })
}

export interface SummaryMetadata {
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

export type LcmAssemblyPlacementSlot = LcmRenderedSpan["placementSlot"]

export type LcmRenderUnitSource =
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

export interface LcmRenderUnit {
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

export interface RawLeafMessageEntry {
  readonly item: Extract<ContextItem, { itemType: "raw_message" }>
  readonly sourceRow: SourceMessageRow
  readonly partRows: readonly SourcePartRow[]
  readonly message: MessageV2.WithParts
}

export interface LcmVisibilityProvenance {
  readonly hiddenContextItemIDs: ReadonlySet<ContextItemID>
  readonly missingContextItemIDs: ReadonlySet<ContextItemID>
}

export function invalidRequest(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

export function tokenBudgetDiagnostic(error: unknown) {
  return error instanceof Error && error.name === "LcmTokenBudgetError" ? error.message : "lcm_token_budget_failed"
}

export function recoveryRequired(diagnosticCode: string, conversationID: ConversationID): LcmSafeError {
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

export function missingSource(diagnosticCode: string, conversationID: ConversationID): LcmSafeError {
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

export function hardLimitUnresolved(input: {
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

export function staleFile(diagnosticCode: string, fileID: LcmFileID): LcmSafeError {
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

export function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isRetrievalCuePayload(value: unknown): value is LcmRetrievalCuePayload {
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

export function lcmSafeError(value: unknown): LcmSafeError | undefined {
  return parseLcmSafeError(value)
}

export function asNumber(value: number | string | bigint | null | undefined) {
  return Number(value ?? 0)
}

export function optionalNumber(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined) return undefined
  return Number(value)
}

export function hasRawLeafRenderPreparation(input: LcmAssemblyInput): input is LcmRawLeafAssemblyInput {
  return isObject((input as { renderPreparation?: unknown }).renderPreparation)
}

export function hasRawLeafThresholdPreparation(input: LcmThresholdInput): input is LcmRawLeafThresholdInput {
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

export function validateRenderOptionAliases(input: {
  readonly renderOptions: LcmAssemblyInput["renderOptions"]
  readonly manifest: LcmRenderInputManifestV1
}) {
  for (const field of RENDER_OPTION_HASH_ALIASES) {
    const alias = input.renderOptions[field]
    if (alias !== undefined && alias !== input.manifest[field]) return `lcm_render_options_alias_mismatch_${field}`
  }
  return validateProviderSafeManifestFields(input.manifest)
}

export function providerSafeIdentityFromManifest(manifest: LcmRenderInputManifestV1) {
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

export function lcmSyntheticMessageID(seed: string) {
  return MessageID.make(`msg_lcm_${stableHash(seed).slice(0, 32)}`)
}

export function lcmSyntheticPartID(seed: string) {
  return PartID.make(`prt_lcm_${stableHash(seed).slice(0, 32)}`)
}

export function renderUnitSourceHandle(source: LcmRenderUnitSource) {
  if (source.kind === "raw_message") return source.messageRowID
  if (source.kind === "summary") return source.summaryID
  if (source.kind === "archive_stub") return `${source.summaryID}:${source.pointerID}`
  if (source.kind === "large_file_marker") return source.fileID
  if (source.kind === "retrieval_cue") return source.cueID
  return source.messageRowID ?? `${source.sourceSessionID}:${source.sourceMessageID}`
}

export function renderUnitID(input: {
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

export function renderedSpanHash(span: Omit<LcmRenderedSpan, "spanHash">, providerTransformHash: string) {
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

export function protocolSpanID(input: {
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

export function sourcePartProvenance(row: SourcePartRow) {
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

export function rowCuePayload(row: Pick<ContextRow, "cue_payload_json">): LcmRetrievalCuePayload | undefined {
  const payload = jsonValue(row.cue_payload_json)
  return isRetrievalCuePayload(payload) ? payload : undefined
}

export function rowCueID(row: Pick<ContextRow, "context_item_id" | "cue_id">) {
  return row.cue_id ?? row.context_item_id
}

export function rowToItem(row: ContextRow): ContextItem {
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

function parsePart(schema: unknown, value: unknown, row: SourcePartRow, diagnosticCode: string): MessageV2.Part {
  try {
    return applyPartRenderFlags(Schema.decodeUnknownSync(schema as never)(value) as MessageV2.Part, row)
  } catch {
    throw invalidRequest(diagnosticCode)
  }
}

function parseMessageInfo(schema: unknown, value: unknown, diagnosticCode: string): MessageV2.Info {
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

export async function loadLargeFileMarkerTextByIDs(
  db: Queryable,
  conversationID: ConversationID,
  ids: readonly LcmFileID[],
) {
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

// Raw leaves reconstruct only finalized immutable source. Any new source part
// or artifact mode must stay aligned with source sync and raw-leaf parity tests.
export async function loadRawLeafMessageEntries(input: {
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

export interface ThresholdSource {
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

export function tokenBudgetInput(input: LcmThresholdInput): LcmRawLeafThresholdInput {
  return input as LcmRawLeafThresholdInput
}

export function thresholdTokenCounter(input: LcmThresholdInput) {
  return tokenBudgetInput(input).tokenCounter ?? createDeterministicFallbackTokenCounter()
}
