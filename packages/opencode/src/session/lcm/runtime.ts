// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { makeRuntime } from "@/effect/run-service"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "@/provider/schema"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateText } from "ai"
import { Context, Effect, Layer, Option } from "effect"
import { SessionID as RuntimeSessionID } from "../schema"
import { SessionStatus } from "../status"
import * as LcmConfig from "./config"
import {
  finalizeProviderRequestSnapshotRow,
  LcmContext,
  recordProviderRequestSnapshotFinalValidationRow,
  type LcmHardLimitRuntimeInput,
  type LcmHardLimitProgress,
  type LcmLeafCompactionRuntimeInput,
  type LcmRawLeafAssemblyInput,
  type LcmRawLeafRenderPreparationInput,
  type LcmRawLeafThresholdInput,
} from "./context"
import { LcmDb } from "./db"
import { isLcmSafeError, safeErrorForDbStatus } from "./db-errors"
import { diagnoseRuntimeLcmDb, rebuildRuntimeLcmDb } from "./db-support-actions"
import {
  cancelQueuedDeferredSoftMaintenanceJob,
  finishDeferredSoftMaintenanceJob,
  readDeferredSoftMaintenanceJobs,
  upsertDeferredSoftMaintenanceJob,
  type LcmDeferredJobTerminalStatus,
  type LcmDeferredSoftMaintenanceJob,
} from "./deferred-jobs"
import {
  createLcmMaintenanceEndedEvent,
  createLcmMaintenanceFailedEvent,
  createLcmMaintenanceStartedEvent,
  createLcmContextUpdatedEvent,
  createLcmDbStatusEvent,
  createLcmFileStatusEvent,
  createLcmMetricsUpdatedEvent,
  LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
  LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
  LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL,
  LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_BLOCKING_MAINTENANCE_LABEL,
  LCM_PREFLIGHT_ASSEMBLY_LABEL,
  LCM_PREFLIGHT_BUDGET_LABEL,
  LCM_PREFLIGHT_REBUILD_LABEL,
  LCM_PREFLIGHT_RETRIEVAL_LABEL,
  LCM_PREFLIGHT_STORAGE_LABEL,
  LCM_PREFLIGHT_SYNC_LABEL,
  LCM_PROMPT_PREPARATION_LABELS,
  publishLcmEvent,
} from "./events"
import { createLcmFinalizedSyncPendingStore } from "./finalized-sync-retry"
import { createOperationID } from "./id"
import { resolveLcmDbLayout } from "./db-layout"
import { renderLargeFileMarker } from "./artifacts"
import {
  exploreLargeFileRow,
  updateLargeFileExplorationStatus,
  type LcmFileExplorationOutcome,
} from "./file-exploration"
import {
  addLargeFileMarkerContextItem,
  loadLargeFileRow,
  loadLargeFileStatus,
  registerPathBackedFile,
  type LcmLargeFileRow,
  type LcmPathPermissionCheck,
} from "./large-files"
import {
  calculateLcmStorageBytes,
  createAggregateLcmStorageBytesSampler,
  readLcmMetricsSnapshot,
  type LcmMetricsQueryable,
} from "./metrics"
import {
  resolveDebugFamilyTargetEffect,
  resolveKiloDataDirForLcm,
  resolveSessionFamilyTargetEffect,
  type LcmFamilyTarget,
} from "./family"
import {
  getCapabilities as getLifecycleCapabilities,
  getOrCreateChildConversation as getOrCreateLifecycleChildConversation,
  getConversationScope as getLifecycleConversationScope,
  type LcmChildConversationInput,
  type LcmChildConversationResult,
  type LcmConversationScope,
  getOrCreateConversation as getOrCreateLifecycleConversation,
  handleSessionDeleted as handleLifecycleSessionDeleted,
  recordUsage as recordLifecycleUsage,
  ensureLcmDbReady,
} from "./lifecycle"
import { getLcmProductionSchemaVersion } from "./migrations"
import { decideMaintenanceTrigger } from "./scheduler"
import {
  defaultLcmProviderCapacityRegistry,
  lcmProviderBaseURLFromOptions,
  lcmProviderCapacityInputFromModel,
  lcmProviderCapacitySafeFieldsFromKey,
  lcmProviderCapacityLane,
  runWithLcmProviderCapacity,
  type LcmProviderCapacityPriority,
} from "./provider-capacity"
import { LcmRetrieval } from "./retrieval"
import { LcmMap, resolveLcmMapWorkerCount, type AgenticMapChildRunner, type LcmMapModelSelection } from "./map"
import {
  createLcmSoftSweepBudget,
  emptyMaintenanceResult,
  failedMaintenanceResult,
  lcmDeferredSoftMaintenanceRetryDelayMs,
  lcmMaintenanceResultWithSoftSweepTelemetry,
  lcmRecordSummaryFailureBackoff,
  lcmShouldRetrySoftMaintenance,
  lcmSoftSweepShouldStartPass,
  lcmSoftSweepStopReasonForResult,
  lcmSummaryFailureBackoffKey,
  lcmSummaryFailureBackoffRemainingMs,
  lcmSummaryFailureBackoffTelemetry,
  maintenanceAttemptStatus,
  maintenanceAttemptUsageRecordID,
  type LcmMaintenanceAttemptStatus,
  type LcmSummaryFailureBackoffRoute,
  type LcmSummaryFailureBackoffState,
  type LcmSoftSweepBudget,
} from "./maintenance-results"
import { clearLcmLaneLatch, updateLcmLaneLatches } from "./token-budget"
import {
  computeMaintenanceInputBudget,
  computeSummaryGenerationMaxOutputTokens,
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
} from "./summary"
import { lcmPreflightRecoverableSafeError } from "./preflight-errors"
import { lcmProviderOverflowRecoveryInputLimit, resolveLcmModelLimits } from "./model-limits"
import {
  lcmSettingsConfigPatch,
  lcmSettingsStateFromConfig,
  lcmSettingsUnavailable,
  mergePublicLcmSettings,
  resolveLcmSettingsScope,
  validateLcmSettingsUpdate,
  type LcmSettingsResolvedScope,
} from "./settings-state"
import { exportLcmPrompts } from "./prompt-export"
import {
  createLcmSafeError,
  type AgenticMapInput,
  type ConversationID,
  type LcmAssemblyInput,
  type LcmAdmittedPathBackedFile,
  type LcmCapabilities,
  type LcmCancelDeferredMaintenanceInput,
  type LcmConversationCapabilityClass,
  type LcmContextUpdatedEventPayload,
  type LcmDescribeInput,
  type LcmDescribeResult,
  type LcmDbDiagnoseReport,
  type LcmDbRebuildReport,
  type LcmExpandQueryInput,
  type LcmExpandQueryResult,
  type LcmDbStatus,
  type LcmExpandInput,
  type LcmExpandResult,
  type LcmFileID,
  type LcmFileStatus,
  type LcmGrepInput,
  type LcmGrepResult,
  type LcmLaneLatchState,
  type LcmMapResult,
  type LcmMapCancelInput,
  type LcmMapStatusInput,
  type LcmMaintenanceResult,
  type LcmMetricsSnapshot,
  type LcmManualMaintenanceInput,
  type LcmTargetCurrentUserInput,
  type MessageRowID,
  type LcmPreflightInput,
  type LcmPreflightResult,
  type LcmPromptExportReport,
  type LcmReadInput,
  type LcmReadResult,
  type LcmRenderedSpanProviderFamily,
  type LcmSafeAction,
  type LcmSafeError,
  type LcmFileStaleState,
  type LcmSoftMaintenanceAfterTurnInput,
  type LcmSettingsState,
  type LcmStrategy,
  type LcmSyncResult,
  type LcmThresholdDecision,
  type LcmToolErrorResult,
  type LcmUpdateSettingsInput,
  type LcmUsageRecord,
  type LcmPathBackedAdmissionInput,
  type LlmMapInput,
  type OperationID,
} from "./types"
import { syncFinalizedMessages as syncFinalizedSourceMessages } from "./source-sync"

export {
  createLcmSoftSweepBudget,
  lcmDeferredSoftMaintenanceRetryDelayMs,
  lcmRecordSummaryFailureBackoff,
  lcmShouldRetrySoftMaintenance,
  lcmSoftSweepShouldStartPass,
  lcmSummaryFailureBackoffKey,
  lcmSummaryFailureBackoffRemainingMs,
  lcmSummaryFailureBackoffTelemetry,
} from "./maintenance-results"

const LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_ATTEMPTS = 3

// Maintainer boundary: LcmRuntime is the process-facing coordinator. Keep this
// file focused on lifecycle orchestration and delegate durable context mutation
// to LcmContext, storage ownership to LcmDb/lifecycle, and tool semantics to
// retrieval/map modules.
export interface Interface {
  readonly getCapabilities: (input: { sessionID: string }) => Effect.Effect<LcmCapabilities>
  readonly getOrCreateConversation: (input: {
    sessionID: string
    parentSessionID?: string
  }) => Effect.Effect<ConversationID, LcmSafeError>
  readonly getOrCreateChildConversation: (
    input: Omit<LcmChildConversationInput, "dataDir">,
  ) => Effect.Effect<LcmChildConversationResult, LcmSafeError>
  readonly acquireChildSessionSlot: (input: {
    sessionID: string
    rootConversationID: ConversationID
    projectID: string
    workspaceID?: string
    capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
    localProviderCapacityKey?: string
  }) => Effect.Effect<{ release: Effect.Effect<void>; rootActive: number; workspaceActive: number }, LcmSafeError>
  readonly syncFinalizedMessages: (input: {
    sessionID: string
    upToMessageID?: string
  }) => Effect.Effect<LcmSyncResult, LcmSafeError>
  readonly admitPathBackedFile: (
    input: LcmPathBackedAdmissionInput & { abortSignal?: AbortSignal },
  ) => Effect.Effect<LcmAdmittedPathBackedFile, LcmSafeError>
  readonly preflightBeforeModel: (input: LcmPreflightRuntimeInput) => Effect.Effect<LcmPreflightResult>
  readonly queueSoftMaintenanceAfterTurn: (
    input: LcmSoftMaintenanceAfterTurnInput,
  ) => Effect.Effect<LcmMaintenanceResult | undefined>
  readonly cancelDeferredMaintenance: (
    input: LcmCancelDeferredMaintenanceInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly diagnoseDb: (input: { sessionID: string }) => Effect.Effect<LcmDbDiagnoseReport, LcmSafeError>
  readonly rebuildDb: (input: { sessionID: string; dryRun: boolean }) => Effect.Effect<LcmDbRebuildReport, LcmSafeError>
  readonly exportPrompts: (input: {
    sessionID: string
    workspaceRoot: string
  }) => Effect.Effect<LcmPromptExportReport, LcmSafeError>
  readonly finalizeProviderRequestSnapshot: (input: {
    sessionID?: string
    conversationID?: ConversationID
    requestSnapshotID: string
    status: "resolved" | "canceled" | "expired"
    nowMs?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly recordProviderRequestSnapshotFinalValidation: (input: {
    sessionID?: string
    conversationID?: ConversationID
    requestSnapshotID: string
    providerValidatorHash: string
    providerFamily?: LcmRenderedSpanProviderFamily
    providerTransformOverheadTokenCount?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly runManualMaintenance: (input: LcmManualMaintenanceInput) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly getSettingsState: (input: {
    sessionID?: string
    projectID?: string
    workspaceID?: string
  }) => Effect.Effect<LcmSettingsState, LcmSafeError>
  readonly updateSettings: (input: LcmUpdateSettingsInput) => Effect.Effect<LcmSettingsState, LcmSafeError>
  readonly handleSessionDeleted: (input: { sessionID: string; recursive: boolean }) => Effect.Effect<void, LcmSafeError>
  readonly recordUsage: (input: unknown) => Effect.Effect<LcmUsageRecord, LcmSafeError>
  readonly getConversationScope: (input: { sessionID: string }) => Effect.Effect<LcmConversationScope, LcmSafeError>
  readonly grep: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmGrepInput,
  ) => Effect.Effect<LcmGrepResult | LcmToolErrorResult>
  readonly describe: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmDescribeInput,
  ) => Effect.Effect<LcmDescribeResult | LcmToolErrorResult>
  readonly expand: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmExpandInput,
  ) => Effect.Effect<LcmExpandResult | LcmToolErrorResult>
  readonly expandQuery: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      providerID?: string
      modelID?: string
    } & LcmExpandQueryInput,
  ) => Effect.Effect<LcmExpandQueryResult | LcmToolErrorResult>
  readonly read: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmReadInput,
  ) => Effect.Effect<LcmReadResult | LcmToolErrorResult>
  readonly exploreFile: (input: {
    sessionID: string
    fileID: LcmFileID
    abortSignal?: AbortSignal
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
  }) => Effect.Effect<LcmFileStatus | LcmToolErrorResult>
  readonly llmMap: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      sourceToolCallID?: string
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    } & LlmMapInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly agenticMap: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      sourceToolCallID?: string
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
      childRunner: AgenticMapChildRunner
    } & AgenticMapInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly mapStatus: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly mapCancel: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly close: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LcmRuntime") {}

function pending(diagnosticCode: string) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

function invalidRequest(
  diagnosticCode: string,
  input?: {
    operationID?: OperationID
    conversationID?: ConversationID
    action?: LcmSafeAction
    retryable?: boolean
  },
) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.action ? { action: input.action } : {}),
    },
    retryable: input?.retryable ?? false,
    ...(input?.conversationID ? { conversationID: input.conversationID } : {}),
    diagnosticCode,
  })
}

function operationTimeout(input: {
  diagnosticCode: string
  operationID: OperationID
  conversationID?: ConversationID
}) {
  return createLcmSafeError({
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: {
      operationID: input.operationID,
      retryable: true,
      action: "retry",
    },
    retryable: true,
    ...(input.conversationID ? { conversationID: input.conversationID } : {}),
    diagnosticCode: input.diagnosticCode,
  })
}

function localProviderBusy(diagnosticCode: string, input?: { localProviderCapacityKey?: string }) {
  return createLcmSafeError({
    code: "provider_capacity_deferred",
    templateKey: "lcm.provider_capacity.deferred",
    safeParams: {
      ...(input?.localProviderCapacityKey ? lcmProviderCapacitySafeFieldsFromKey(input.localProviderCapacityKey) : {}),
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode,
  })
}

const LCM_DEFERRED_MAINTENANCE_CLOSE_GRACE_MS = 5_000

function legacyReadOnly(input: { operationID: OperationID; conversationID?: ConversationID }) {
  return createLcmSafeError({
    code: "legacy_read_only",
    templateKey: "lcm.auth.denied",
    safeParams: {
      operationID: input.operationID,
      ...(input.conversationID ? { conversationID: input.conversationID } : {}),
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode: "lcm_maintenance_legacy_read_only",
  })
}

function recoveryMissing(input: {
  operationID: OperationID
  conversationID?: ConversationID
  code: "recovery_required" | "recovery_failed" | "missing_source"
  retryable: boolean
  action: "retry" | "repeat_input" | "start_new_thread"
  diagnosticCode: string
}) {
  return createLcmSafeError({
    code: input.code,
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      operationID: input.operationID,
      ...(input.conversationID ? { conversationID: input.conversationID } : {}),
      action: input.action,
    },
    retryable: input.retryable,
    diagnosticCode: input.diagnosticCode,
  })
}

function hardLimitUnresolved(input: {
  operationID: OperationID
  conversationID?: ConversationID
  beforeTokens?: number
  hardLimit?: number
  diagnosticCode: string
}) {
  return createLcmSafeError({
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: {
      operationID: input.operationID,
      ...(input.conversationID ? { conversationID: input.conversationID } : {}),
      ...(input.beforeTokens !== undefined ? { beforeTokens: input.beforeTokens } : {}),
      ...(input.hardLimit !== undefined ? { hardLimit: input.hardLimit } : {}),
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode: input.diagnosticCode,
  })
}

function isSoftThresholdContextInvalid(error: LcmSafeError) {
  return (
    error.code === "recovery_required" && error.diagnosticCode?.startsWith("lcm_threshold_context_invalid_") === true
  )
}

function softMaintenanceProtectedCurrentUserTarget(input: {
  protectedCurrentUser: NonNullable<LcmSoftMaintenanceAfterTurnInput["protectedCurrentUser"]>
  messageRowID: MessageRowID
  operationID: OperationID
}) {
  return {
    sourceSessionID: input.protectedCurrentUser.sourceSessionID,
    sourceMessageID: input.protectedCurrentUser.sourceMessageID,
    messageRowID: input.messageRowID,
    promptOperationID: input.operationID,
    visibilityBaseMessageID: input.protectedCurrentUser.sourceMessageID,
  } satisfies LcmTargetCurrentUserInput
}

export type LcmPreflightRuntimeInput = LcmPreflightInput & {
  readonly renderPreparation?: LcmRawLeafRenderPreparationInput
  readonly syncUpToMessageID?: string
  readonly providerOverflowRecovery?: {
    readonly attempt: number
  }
  readonly abortSignal?: AbortSignal
}

function blockedPreflight(input: {
  sessionID: string
  lifecycleState: LcmPreflightResult["lifecycleState"]
  safeError: LcmSafeError
  conversationID?: ConversationID
  threshold?: Extract<LcmPreflightResult, { canProceed: false }>["threshold"]
  assembly?: Extract<LcmPreflightResult, { canProceed: false }>["assembly"]
  maintenance?: LcmMaintenanceResult
}): LcmPreflightResult {
  const safeError = lcmPreflightRecoverableSafeError(input.safeError)
  return {
    sessionID: input.sessionID,
    ...(input.conversationID ? { conversationID: input.conversationID } : {}),
    lifecycleState: input.lifecycleState,
    ...(input.threshold ? { threshold: input.threshold } : {}),
    ...(input.assembly ? { assembly: input.assembly } : {}),
    ...(input.maintenance ? { maintenance: input.maintenance } : {}),
    canProceed: false,
    safeError,
  }
}

function preflightFallbackLifecycleState(input: {
  safeError: LcmSafeError
  observedLifecycleState?: LcmPreflightResult["lifecycleState"]
}): LcmPreflightResult["lifecycleState"] {
  switch (input.safeError.code) {
    case "db_unavailable":
    case "db_locked":
    case "db_migration_failed":
    case "db_corrupt":
      return "db_unavailable"
    case "legacy_read_only":
      return "legacy_read_only"
    case "recovery_required":
    case "missing_source":
    case "stale_source":
      return "recovery_required"
    case "recovery_failed":
      return "recovery_failed"
    default:
      return input.observedLifecycleState && input.observedLifecycleState !== "db_unavailable"
        ? input.observedLifecycleState
        : "passive_synced"
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function lcmMaintenanceWorkspaceKey(target: Pick<LcmFamilyTarget, "familyID" | "projectID" | "workspaceID">) {
  return target.workspaceID
    ? `workspace:${target.workspaceID}`
    : target.projectID
      ? `project:${target.projectID}`
      : `family:${target.familyID}`
}

export function lcmCountWorkspaceSoftMaintenance(inFlightWorkspaceKeys: Iterable<string>, workspaceKey: string) {
  let count = 0
  for (const key of inFlightWorkspaceKeys) {
    if (key === workspaceKey) count++
  }
  return count
}

function isPromptPreparationStatus(status: SessionStatus.Info | undefined) {
  return (
    status?.type === "busy" &&
    status.message !== undefined &&
    (LCM_PROMPT_PREPARATION_LABELS as readonly string[]).includes(status.message)
  )
}

function hardLimitProgressLabel(progress: LcmHardLimitProgress) {
  switch (progress.phase) {
    case "leaf_summary":
      return LCM_BLOCKING_LEAF_MAINTENANCE_LABEL
    case "condensation":
    case "aggressive_condensation":
      return LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL
    case "archive_stub":
      return LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL
  }
}

function providerUsageFromGeneration(input: { usage: unknown; providerID: string; modelID: string }) {
  if (!input.usage || typeof input.usage !== "object" || Array.isArray(input.usage)) {
    return {
      providerID: input.providerID,
      modelID: input.modelID,
      costStatus: "unknown" as const,
    }
  }
  const usage = input.usage as Record<string, unknown>
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    inputTokens: numberField(usage.inputTokens ?? usage.promptTokens),
    outputTokens: numberField(usage.outputTokens ?? usage.completionTokens),
    cacheReadTokens: numberField(usage.cachedInputTokens ?? usage.cacheReadInputTokens),
    cacheWriteTokens: numberField(usage.cacheCreationInputTokens ?? usage.cacheWriteInputTokens),
    costStatus: "unknown" as const,
  }
}

function asNumber(value: number | string | bigint | null | undefined) {
  return Number(value ?? 0)
}

type LcmGenerationMessage = {
  readonly role: "system" | "user"
  readonly content: string
}

function lcmGenerationMessages(input: {
  readonly prompt: string
  readonly request?: { readonly messages: readonly LcmGenerationMessage[] }
}) {
  return input.request ? [...input.request.messages] : [{ role: "user" as const, content: input.prompt }]
}

function thresholdEventFields(threshold: LcmThresholdDecision) {
  return {
    hardLimit: threshold.hardLimit,
    softThreshold: threshold.softThreshold,
    freshTailTokens: threshold.freshTailTokens,
    softBacklogTokens: threshold.softBacklogTokens,
    softBacklogItemCount: threshold.softBacklogItemCount,
    softBacklogLargestSourceTokens: threshold.softBacklogLargestSourceTokens,
    freshTailRawTokens: threshold.freshTailRawTokens,
    freshTailRawItemCount: threshold.freshTailRawItemCount,
    unconsumedRawTokens: threshold.unconsumedRawTokens,
    unconsumedRawItemCount: threshold.unconsumedRawItemCount,
    protectedTailRawTokens: threshold.protectedTailRawTokens,
    protectedTailRawItemCount: threshold.protectedTailRawItemCount,
    rawLaneTokens: threshold.rawLaneTokens,
    rawLaneRatio: threshold.rawLaneRatio,
    softBacklogRatio: threshold.softBacklogRatio,
    softPressureReason: threshold.softPressureReason,
    laneLatchDiagnostics: threshold.laneLatchDiagnostics,
  }
}

function metricNumber(value: number | string | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function admittedPathBackedFileFromRow(input: {
  row: LcmLargeFileRow
  conversationID: ConversationID
  contextItemID: LcmAdmittedPathBackedFile["contextItemID"]
}): LcmAdmittedPathBackedFile {
  const byteCount = metricNumber(input.row.path_size_bytes)
  const sha256 = input.row.path_content_sha256
  if (byteCount <= 0 || !sha256) {
    throw invalidRequest("lcm_path_admission_marker_metadata_missing", { conversationID: input.conversationID })
  }
  return {
    conversationID: input.conversationID,
    contextItemID: input.contextItemID,
    fileID: input.row.file_id,
    sourceKind: input.row.source_kind,
    byteCount,
    sha256,
    markerText: renderLargeFileMarker({
      fileID: input.row.file_id,
      sourceKind: input.row.source_kind,
      byteCount,
      sha256,
      explorationStatus: input.row.exploration_status,
      previewText: input.row.preview_text,
    }),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const lcmDb = yield* LcmDb.Service
    const lcmContext = Option.getOrUndefined(yield* Effect.serviceOption(LcmContext.Service))
    const provider = Option.getOrUndefined(yield* Effect.serviceOption(Provider.Service))
    const bus = Option.getOrUndefined(yield* Effect.serviceOption(Bus.Service))
    const sessionStatus = Option.getOrUndefined(yield* Effect.serviceOption(SessionStatus.Service))
    const mapScheduler = LcmMap.createLcmMapScheduler(lcmDb)
    const aggregateStorageBytes = createAggregateLcmStorageBytesSampler({
      resolveKiloDataDir: () => resolveKiloDataDirForLcm(),
    })
    const softMaintenanceInFlight = new Map<string, string>()
    const laneLatches = new Map<string, LcmLaneLatchState>()
    const softSummaryBackoffs = new Map<string, LcmSummaryFailureBackoffState>()
    const deferredSoftMaintenanceRetries = new Map<
      string,
      {
        input: LcmSoftMaintenanceAfterTurnInput
        attempts: number
        timer?: ReturnType<typeof setTimeout>
        running?: Promise<void>
      }
    >()

    const applyLaneLatches = (threshold: LcmThresholdDecision) => {
      const updated = updateLcmLaneLatches({ decision: threshold, latches: laneLatches })
      laneLatches.clear()
      for (const [key, value] of updated.latches) laneLatches.set(key, value)
      return updated.decision
    }

    const clearActiveLatchesFromThreshold = (threshold: LcmThresholdDecision) => {
      for (const diagnostic of threshold.laneLatchDiagnostics ?? []) {
        if (diagnostic.phase === "exited") continue
        clearLcmLaneLatch({ latches: laneLatches, conversationID: diagnostic.conversationID, lane: diagnostic.lane })
      }
    }
    const childSlots = new Map<
      string,
      {
        rootConversationID: ConversationID
        workspaceKey: string
        capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
        localProviderCapacityKey?: string
      }
    >()

    const getResolved = Effect.fn("LcmRuntime.getResolvedConfig")(function* () {
      const cfg = yield* config.get()
      return LcmConfig.resolve(cfg.lcm)
    })

    const storageBytes = (dataDir?: string) =>
      dataDir ? Effect.promise(() => calculateLcmStorageBytes(dataDir).catch(() => 0)) : Effect.succeed(0)
    const aggregateStorageBytesEffect = Effect.promise(() => aggregateStorageBytes.read().catch(() => 0))

    const initializeExplicitDebugDb = Effect.fn("LcmRuntime.initializeExplicitDebugDb")(function* () {
      const familyRoot = process.env.KILO_LCM_DATA_DIR
      if (!familyRoot) {
        return {
          status: "unavailable" as const,
          dataDir: "",
          schemaVersion: getLcmProductionSchemaVersion(),
          safeError: invalidRequest("lcm_family_session_required"),
        }
      }
      const target = yield* resolveDebugFamilyTargetEffect({ familyRoot }).pipe(
        Effect.match({
          onFailure: (safeError) => ({ ok: false as const, safeError }),
          onSuccess: (target) => ({ ok: true as const, target }),
        }),
      )
      if (!target.ok) {
        return {
          status: "unavailable" as const,
          dataDir: "",
          schemaVersion: getLcmProductionSchemaVersion(),
          safeError: target.safeError,
        }
      }
      return yield* LcmDb.initializeFamily(lcmDb, target.target)
    })

    const initializeDb = Effect.fn("LcmRuntime.initializeDb")(function* (input: { sessionID?: string } = {}) {
      if (!lcmDb.initializeFamily) {
        return yield* lcmDb.initialize({
          dataDir: process.env.KILO_LCM_DATA_DIR ?? "",
          runtimeMode: "source",
          schemaVersion: getLcmProductionSchemaVersion(),
        })
      }
      if (input.sessionID) {
        const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
          Effect.provideService(LcmDb.Service, lcmDb),
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (ready) => ({ ok: true as const, ready }),
          }),
        )
        if (!ready.ok) {
          return {
            status: "unavailable" as const,
            dataDir: "",
            schemaVersion: getLcmProductionSchemaVersion(),
            safeError: ready.safeError,
          }
        }
        return ready.ready.status
      }
      return yield* initializeExplicitDebugDb()
    })

    const resolveSessionFamilyDb = Effect.fn("LcmRuntime.resolveSessionFamilyDb")(function* (input: {
      sessionID: string
    }) {
      const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
        Effect.provideService(LcmDb.Service, lcmDb),
      )
      return {
        dataDir: ready.dataDir,
        target: ready.target,
        lcmDb: LcmDb.scoped(lcmDb, ready.target),
      }
    })

    const contextLayerForDb = (familyDb: LcmDb.Interface) =>
      LcmContext.layer.pipe(Layer.provide(Layer.succeed(LcmDb.Service, familyDb)))

    const resolveSessionContext = Effect.fn("LcmRuntime.resolveSessionContext")(function* (input: {
      sessionID: string
    }) {
      if (lcmContext && lcmContext.runtimeDbBinding !== "lcm_context_layer") return lcmContext
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      return yield* LcmContext.Service.use((context) => Effect.succeed(context)).pipe(
        Effect.provide(contextLayerForDb(ready.lcmDb)),
      )
    })

    const writeSoftMaintenanceAttempt = Effect.fn("LcmRuntime.writeSoftMaintenanceAttempt")(function* (input: {
      familyDb: LcmDb.Interface
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      providerID?: string
      modelID?: string
      status: LcmMaintenanceAttemptStatus
      safeError?: LcmSafeError
      safeMessage?: string
      summaryTargetTokens?: number
      summaryGenerationMaxOutputTokens?: number
      maintenanceInputBudget?: number
      summarySourceTokens?: number
    }) {
      yield* input.familyDb.execute({
        operationID: input.operationID,
        lane: "background",
        purpose: "maintenance",
        run: async (db) => {
          await (db as PGlite).query(
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
                cost_status,
                summary_target_tokens,
                summary_generation_max_output_tokens,
                maintenance_input_budget,
                summary_source_tokens,
                maintenance_status,
                maintenance_safe_code,
                maintenance_diagnostic_code,
                maintenance_safe_message,
                created_at_ms
              )
              VALUES (
                $1, $2, $3, $4, 'leaf_summary', 'background', $5, $6, 'not_applicable',
                $7, $8, $9, $10, $11, $12, $13, $14, $15
              )
              ON CONFLICT (usage_record_id) DO UPDATE SET
                provider_id = COALESCE(EXCLUDED.provider_id, lcm_usage_records.provider_id),
                model_id = COALESCE(EXCLUDED.model_id, lcm_usage_records.model_id),
                summary_target_tokens = COALESCE(
                  EXCLUDED.summary_target_tokens,
                  lcm_usage_records.summary_target_tokens
                ),
                summary_generation_max_output_tokens = COALESCE(
                  EXCLUDED.summary_generation_max_output_tokens,
                  lcm_usage_records.summary_generation_max_output_tokens
                ),
                maintenance_input_budget = COALESCE(
                  EXCLUDED.maintenance_input_budget,
                  lcm_usage_records.maintenance_input_budget
                ),
                summary_source_tokens = COALESCE(EXCLUDED.summary_source_tokens, lcm_usage_records.summary_source_tokens),
                maintenance_status = EXCLUDED.maintenance_status,
                maintenance_safe_code = EXCLUDED.maintenance_safe_code,
                maintenance_diagnostic_code = EXCLUDED.maintenance_diagnostic_code,
                maintenance_safe_message = EXCLUDED.maintenance_safe_message
            `,
            [
              maintenanceAttemptUsageRecordID(input.operationID),
              input.conversationID,
              input.sessionID,
              input.operationID,
              input.providerID ?? null,
              input.modelID ?? null,
              input.summaryTargetTokens ?? null,
              input.summaryGenerationMaxOutputTokens ?? null,
              input.maintenanceInputBudget ?? null,
              input.summarySourceTokens ?? null,
              input.status,
              input.safeError?.code ?? null,
              input.safeError?.diagnosticCode ?? null,
              input.safeMessage ?? input.safeError?.safeMessage ?? null,
              Date.now(),
            ],
          )
        },
      })
    })

    const readMetrics = Effect.fn("LcmRuntime.readMetrics")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID?: OperationID
      lastMaintenance?: LcmMaintenanceResult
      strategy?: LcmStrategy
      storageWarningThresholdBytes?: number
    }) {
      const cfg = yield* getResolved()
      const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
        Effect.provideService(LcmDb.Service, lcmDb),
      )
      const scopedDb = LcmDb.scoped(lcmDb, ready.target)
      const bytes = yield* storageBytes(ready.dataDir)
      return yield* scopedDb.executeForeground({
        operationID: input.operationID ?? createOperationID(),
        purpose: "debug_support",
        run: async (db) =>
          readLcmMetricsSnapshot({
            db: db as LcmMetricsQueryable,
            conversationID: input.conversationID,
            strategy: input.strategy ?? cfg.strategy,
            storageBytes: bytes,
            storageWarningThresholdBytes: input.storageWarningThresholdBytes ?? cfg.storage.warningThresholdBytes,
            lastMaintenance: input.lastMaintenance,
          }),
      })
    })

    const readSettings = Effect.fn("LcmRuntime.readSettings")(function* (input: {
      scope: LcmSettingsResolvedScope
      lifecycleState?: LcmSettingsState["lifecycleState"]
    }) {
      let safeError: LcmSafeError | undefined
      const effectiveConfig = yield* config.get().pipe(
        Effect.catch(() => {
          safeError = lcmSettingsUnavailable("lcm_settings_config_read_failed")
          return Effect.succeed({} as Config.Info)
        }),
      )
      const localConfig = yield* config.getLocal().pipe(
        Effect.catch(() => {
          safeError ??= lcmSettingsUnavailable("lcm_settings_local_config_read_failed")
          return Effect.succeed({} as Config.Info)
        }),
      )
      const storageBytes = yield* aggregateStorageBytesEffect
      return lcmSettingsStateFromConfig({
        scope: input.scope,
        effectiveConfig,
        localConfig,
        storageBytes,
        lifecycleState: input.lifecycleState,
        safeError,
      })
    })

    const effectiveSettings = Effect.fn("LcmRuntime.effectiveSettings")(function* (input: {
      sessionID?: string
      projectID?: string
      workspaceID?: string
    }) {
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })
      const state = yield* readSettings({
        scope,
      })
      return { scope, state }
    })

    const publishMetrics = Effect.fn("LcmRuntime.publishMetrics")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID?: OperationID
      reason: LcmContextUpdatedEventPayload["reason"]
      lastMaintenance?: LcmMaintenanceResult
    }) {
      if (!bus) return
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const metrics = yield* readMetrics({
        ...input,
        strategy: settings?.state.strategy,
        storageWarningThresholdBytes: settings?.state.storageWarningThresholdBytes,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!metrics) return
      yield* publishLcmEvent(
        bus,
        createLcmContextUpdatedEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          lifecycleState: metrics.lifecycleState,
          strategy: metrics.strategy,
          reason: input.reason,
          activeTokens: metrics.activeTokens,
          hardLimit: metrics.hardLimit,
          softThreshold: metrics.softThreshold,
          freshTailTokens: metrics.freshTailTokens,
          softBacklogTokens: metrics.softBacklogTokens,
          softBacklogItemCount: metrics.softBacklogItemCount,
          freshTailRawTokens: metrics.freshTailRawTokens,
          freshTailRawItemCount: metrics.freshTailRawItemCount,
          unconsumedRawTokens: metrics.unconsumedRawTokens,
          unconsumedRawItemCount: metrics.unconsumedRawItemCount,
          protectedTailRawTokens: metrics.protectedTailRawTokens,
          protectedTailRawItemCount: metrics.protectedTailRawItemCount,
          rawLaneTokens: metrics.rawLaneTokens,
          hardFillRatio: metrics.hardFillRatio,
          rawLaneRatio: metrics.rawLaneRatio,
          softBacklogRatio: metrics.softBacklogRatio,
          softBacklogLargestSourceTokens: metrics.softBacklogLargestSourceTokens,
          budgetStatus: metrics.budgetStatus,
          softPressureReason: metrics.softPressureReason,
          laneLatchDiagnostics: metrics.laneLatchDiagnostics,
          contextItemCounts: metrics.contextItemCounts,
        }),
      )
      yield* publishLcmEvent(
        bus,
        createLcmMetricsUpdatedEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          metrics,
        }),
      )
    })

    const publishDbStatus = Effect.fn("LcmRuntime.publishDbStatus")(function* (input: {
      capabilities: LcmCapabilities
      operationID?: OperationID
    }) {
      if (!bus || !input.capabilities.dbStatus) return
      if (input.capabilities.dbStatus.status === "ready" && !input.capabilities.safeError) return
      yield* publishLcmEvent(
        bus,
        createLcmDbStatusEvent({
          status: input.capabilities.dbStatus,
          sessionID: input.capabilities.sessionID,
          conversationID: input.capabilities.conversationID,
          lifecycleState: input.capabilities.lifecycleState,
          operationID: input.operationID,
        }),
      )
    })

    const publishDirectDbStatus = Effect.fn("LcmRuntime.publishDirectDbStatus")(function* (input: {
      status: LcmDbStatus
      sessionID: string
      conversationID?: ConversationID
      lifecycleState: LcmCapabilities["lifecycleState"]
      operationID?: OperationID
    }) {
      if (!bus || input.status.status === "ready") return
      yield* publishLcmEvent(
        bus,
        createLcmDbStatusEvent({
          status: input.status,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          lifecycleState: input.lifecycleState,
          operationID: input.operationID,
        }),
      )
    })

    const getCapabilities = Effect.fn("LcmRuntime.getCapabilities")(function* (input: { sessionID: string }) {
      const cfg = yield* getResolved()
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const capabilities = yield* getLifecycleCapabilities({
        sessionID: input.sessionID,
        strategy: settings?.state.strategy ?? cfg.strategy,
      }).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      yield* publishDbStatus({ capabilities })
      if (capabilities.lifecycleState === "lcm_active") {
        yield* resumeDeferredSoftMaintenanceRetries({ sessionID: input.sessionID }).pipe(Effect.ignore)
      }
      return capabilities
    })

    function settingsWithRuntimeState(state: LcmSettingsState, capabilities: LcmCapabilities | undefined) {
      if (!capabilities) return state
      const safeError = state.safeError ?? capabilities.safeError
      return {
        ...state,
        lifecycleState: capabilities.lifecycleState,
        dbStatus: capabilities.dbStatus,
        ...(safeError ? { safeError } : {}),
      }
    }

    const readSettingsWithRuntimeState = Effect.fn("LcmRuntime.readSettingsWithRuntimeState")(function* (
      scope: LcmSettingsResolvedScope,
    ) {
      const capabilities = scope.sessionID ? yield* getCapabilities({ sessionID: scope.sessionID }) : undefined
      const state = yield* readSettings({ scope, lifecycleState: capabilities?.lifecycleState })
      return settingsWithRuntimeState(state, capabilities)
    })

    const getOrCreateConversation = Effect.fn("LcmRuntime.getOrCreateConversation")(function* (input: {
      sessionID: string
      parentSessionID?: string
    }) {
      return yield* getOrCreateLifecycleConversation(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const getOrCreateChildConversation = Effect.fn("LcmRuntime.getOrCreateChildConversation")(function* (
      input: Omit<LcmChildConversationInput, "dataDir">,
    ) {
      return yield* getOrCreateLifecycleChildConversation(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const acquireChildSessionSlot = Effect.fn("LcmRuntime.acquireChildSessionSlot")(function* (input: {
      sessionID: string
      rootConversationID: ConversationID
      projectID: string
      workspaceID?: string
      capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
      localProviderCapacityKey?: string
    }) {
      const workspaceKey = input.workspaceID ? `workspace:${input.workspaceID}` : `project:${input.projectID}`
      const existing = childSlots.get(input.sessionID)
      if (existing) {
        const rootActive = Array.from(childSlots.values()).filter(
          (slot) => slot.rootConversationID === existing.rootConversationID,
        ).length
        const workspaceActive = Array.from(childSlots.values()).filter(
          (slot) => slot.workspaceKey === existing.workspaceKey,
        ).length
        return {
          rootActive,
          workspaceActive,
          release: Effect.sync(() => {}),
        }
      }

      const rootActive = Array.from(childSlots.values()).filter(
        (slot) => slot.rootConversationID === input.rootConversationID,
      ).length
      const workspaceActive = Array.from(childSlots.values()).filter(
        (slot) => slot.workspaceKey === workspaceKey,
      ).length
      if (rootActive >= LcmConfig.RUNTIME_DEFAULTS.scheduler.maxChildSessionsPerRoot) {
        return yield* Effect.fail(invalidRequest("lcm_child_slot_root_exhausted"))
      }
      if (workspaceActive >= LcmConfig.RUNTIME_DEFAULTS.scheduler.maxChildSessionsPerWorkspace) {
        return yield* Effect.fail(invalidRequest("lcm_child_slot_workspace_exhausted"))
      }
      if (input.localProviderCapacityKey) {
        const localProviderActive = Array.from(childSlots.values()).some(
          (slot) =>
            slot.rootConversationID === input.rootConversationID &&
            slot.localProviderCapacityKey === input.localProviderCapacityKey,
        )
        if (localProviderActive) {
          return yield* Effect.fail(
            localProviderBusy("lcm_child_slot_local_provider_busy", {
              localProviderCapacityKey: input.localProviderCapacityKey,
            }),
          )
        }
      }

      childSlots.set(input.sessionID, {
        rootConversationID: input.rootConversationID,
        workspaceKey,
        capabilityClass: input.capabilityClass,
        ...(input.localProviderCapacityKey ? { localProviderCapacityKey: input.localProviderCapacityKey } : {}),
      })
      return {
        rootActive: rootActive + 1,
        workspaceActive: workspaceActive + 1,
        release: Effect.sync(() => {
          const current = childSlots.get(input.sessionID)
          if (current?.rootConversationID === input.rootConversationID && current.workspaceKey === workspaceKey) {
            childSlots.delete(input.sessionID)
          }
        }),
      }
    })

    const handleSessionDeleted = Effect.fn("LcmRuntime.handleSessionDeleted")(function* (input: {
      sessionID: string
      recursive: boolean
    }) {
      yield* Effect.promise(() =>
        mapScheduler.cancelBySession({ sessionID: input.sessionID, operationID: createOperationID() }),
      ).pipe(Effect.catch(() => Effect.void))
      yield* createLcmFinalizedSyncPendingStore()
        .delete(input.sessionID as RuntimeSessionID)
        .pipe(Effect.ignore)
      childSlots.delete(input.sessionID)
      const result = yield* handleLifecycleSessionDeleted(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      aggregateStorageBytes.invalidate()
      return result
    })

    const writeUsageRecord = Effect.fn("LcmRuntime.recordUsage")(function* (input: unknown) {
      return yield* recordLifecycleUsage(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const getConversationScope = Effect.fn("LcmRuntime.getConversationScope")(function* (input: { sessionID: string }) {
      return yield* getLifecycleConversationScope(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const markConversationActive = Effect.fn("LcmRuntime.markConversationActive")(function* (input: {
      sessionID: string
      conversationID: ConversationID
    }) {
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      yield* family.lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "sync",
        run: async (db) => {
          await (db as { query: (sql: string, params?: unknown[]) => Promise<unknown> }).query(
            `
              UPDATE lcm_conversations
              SET lifecycle_state = 'lcm_active', updated_at_ms = $2, last_error_code = NULL, last_safe_message = NULL
              WHERE conversation_id = $1 AND lifecycle_state = 'passive_synced'
            `,
            [input.conversationID, Date.now()],
          )
        },
      })
    })

    const runProviderGeneration = async <T>(
      model: Provider.Model,
      priority: LcmProviderCapacityPriority,
      operationID: OperationID | undefined,
      run: () => Promise<T>,
      options?: { abortSignal?: AbortSignal },
    ) => {
      const providerInfo = provider
        ? await Effect.runPromise(
            provider.getProvider(model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined))),
          )
        : undefined
      const providerBaseURL = lcmProviderBaseURLFromOptions(providerInfo?.options)
      return runWithLcmProviderCapacity(
        lcmProviderCapacityInputFromModel({
          model,
          priority,
          ...(operationID ? { operationID } : {}),
          ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
          ...(providerBaseURL ? { providerBaseURL } : {}),
        }),
        run,
      )
    }

    const makeSummaryGenerator = (
      model: Provider.Model,
      renderOptions: LcmPreflightInput["renderOptions"],
      priority: LcmProviderCapacityPriority = "foreground",
      defaultMaxOutputTokens: number = LcmConfig.RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens,
    ) => {
      let languagePromise: Promise<LanguageModelV3> | undefined
      return async ({
        prompt,
        request,
        operationID,
        maxOutputTokens,
        abortSignal,
      }: {
        prompt: string
        request?: { readonly messages: readonly LcmGenerationMessage[] }
        operationID?: OperationID
        maxOutputTokens?: number
        abortSignal?: AbortSignal
      }) => {
        if (!provider) throw pending("lcm_preflight_provider_missing")
        const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
        const result = await runProviderGeneration(
          model,
          priority,
          operationID,
          () =>
            generateText({
              model: language,
              temperature: model.capabilities.temperature ? 0 : undefined,
              providerOptions: ProviderTransform.providerOptions(model, model.options),
              maxOutputTokens: maxOutputTokens ?? defaultMaxOutputTokens,
              maxRetries: 0,
              abortSignal,
              messages: lcmGenerationMessages({ prompt, request }),
            }),
          abortSignal ? { abortSignal } : undefined,
        )
        return {
          text: result.text,
          usage: providerUsageFromGeneration({
            usage: result.usage,
            providerID: renderOptions.providerID,
            modelID: renderOptions.modelID,
          }),
        }
      }
    }

    const resolveMapModel = Effect.fn("LcmRuntime.resolveMapModel")(function* (input: {
      selection?: LlmMapInput["model"]
      providerID?: string
      modelID?: string
      operationID: OperationID
      conversationID?: ConversationID
    }) {
      if (!provider) {
        return yield* Effect.fail(
          invalidRequest("lcm_map_provider_missing", {
            operationID: input.operationID,
            conversationID: input.conversationID,
          }),
        )
      }

      const modelFromCurrent = Effect.fn("LcmRuntime.resolveCurrentMapModel")(function* () {
        if (input.providerID && input.modelID) {
          return yield* provider.getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID)).pipe(
            Effect.catch(() =>
              Effect.fail(
                invalidRequest("lcm_map_current_model_not_found", {
                  operationID: input.operationID,
                  conversationID: input.conversationID,
                }),
              ),
            ),
          )
        }
        const defaults = yield* provider.defaultModel().pipe(
          Effect.catch(() =>
            Effect.fail(
              invalidRequest("lcm_map_default_model_not_found", {
                operationID: input.operationID,
                conversationID: input.conversationID,
              }),
            ),
          ),
        )
        return yield* provider.getModel(defaults.providerID, defaults.modelID).pipe(
          Effect.catch(() =>
            Effect.fail(
              invalidRequest("lcm_map_default_model_unavailable", {
                operationID: input.operationID,
                conversationID: input.conversationID,
              }),
            ),
          ),
        )
      })

      const selector = input.selection ?? "default"
      if (selector === "default") {
        const model = yield* modelFromCurrent()
        return {
          model,
          modelSelection: {
            selector: "default",
            providerID: model.providerID,
            modelID: model.id,
          } satisfies LcmMapModelSelection,
        }
      }

      if (selector === "small") {
        const base = input.providerID
          ? ProviderID.make(input.providerID)
          : (yield* provider.defaultModel().pipe(
              Effect.catch(() =>
                Effect.fail(
                  invalidRequest("lcm_map_small_base_model_not_found", {
                    operationID: input.operationID,
                    conversationID: input.conversationID,
                  }),
                ),
              ),
            )).providerID
        const model = yield* provider.getSmallModel(base).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!model) {
          return yield* Effect.fail(
            invalidRequest("lcm_map_small_model_not_found", {
              operationID: input.operationID,
              conversationID: input.conversationID,
            }),
          )
        }
        return {
          model,
          modelSelection: {
            selector: "small",
            providerID: model.providerID,
            modelID: model.id,
          } satisfies LcmMapModelSelection,
        }
      }

      const model = yield* provider.getModel(ProviderID.make(selector.providerID), ModelID.make(selector.modelID)).pipe(
        Effect.catch(() =>
          Effect.fail(
            invalidRequest("lcm_map_explicit_model_not_found", {
              operationID: input.operationID,
              conversationID: input.conversationID,
            }),
          ),
        ),
      )
      return {
        model,
        modelSelection: {
          selector: "explicit",
          providerID: model.providerID,
          modelID: model.id,
        } satisfies LcmMapModelSelection,
      }
    })

    const resolveRuntimeMapWorkers = async (input: {
      toolKind: "llm_map" | "agentic_map"
      mapInput: LlmMapInput
      resolved: {
        model: Provider.Model
        modelSelection: LcmMapModelSelection
      }
    }) => {
      const providerInfo = provider
        ? await Effect.runPromise(
            provider.getProvider(input.resolved.model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined))),
          )
        : undefined
      const capacityInput = lcmProviderCapacityInputFromModel({
        model: input.resolved.model,
        priority: "background",
        ...(providerInfo ? { provider: providerInfo } : {}),
      })
      const snapshot = defaultLcmProviderCapacityRegistry.snapshot(capacityInput)
      return resolveLcmMapWorkerCount({
        toolKind: input.toolKind,
        requestedWorkers: input.mapInput.workers,
        modelSelector: input.resolved.modelSelection.selector,
        providerCapacityClass: snapshot.capacityClass,
        providerActive: snapshot.active,
        providerForegroundQueued: snapshot.foregroundQueued,
      })
    }

    const getSettingsState = Effect.fn("LcmRuntime.getSettingsState")(function* (input: {
      sessionID?: string
      projectID?: string
      workspaceID?: string
    }) {
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })
      return yield* readSettingsWithRuntimeState(scope)
    })

    const updateSettings = Effect.fn("LcmRuntime.updateSettings")(function* (input: LcmUpdateSettingsInput) {
      yield* Effect.try({
        try: () => validateLcmSettingsUpdate(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_validation_failed")),
      })
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })

      if (
        input.strategy === undefined &&
        input.freshTailTokens === undefined &&
        input.storageWarningThresholdBytes === undefined
      ) {
        return yield* readSettingsWithRuntimeState(scope)
      }

      const effectiveBefore = yield* config.get().pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_read_before_write_failed"))),
        Effect.catchDefect(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_read_before_write_failed"))),
      )
      const localBefore = yield* config.getLocal().pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_local_config_read_before_write_failed"))),
        Effect.catchDefect(() =>
          Effect.fail(lcmSettingsUnavailable("lcm_settings_local_config_read_before_write_failed")),
        ),
      )
      yield* config.update(lcmSettingsConfigPatch(input)).pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_write_failed"))),
        Effect.catchDefect(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_write_failed"))),
      )
      const effectiveConfig = {
        ...effectiveBefore,
        lcm: mergePublicLcmSettings({ current: effectiveBefore.lcm, patch: input }),
      } satisfies Config.Info
      const localConfig = {
        ...localBefore,
        lcm: mergePublicLcmSettings({ current: localBefore.lcm, patch: input }),
      } satisfies Config.Info
      const storageBytes = yield* aggregateStorageBytesEffect

      const capabilities = scope.sessionID ? yield* getCapabilities({ sessionID: scope.sessionID }) : undefined
      const state = lcmSettingsStateFromConfig({
        scope,
        effectiveConfig,
        localConfig,
        storageBytes,
        lifecycleState: capabilities?.lifecycleState,
      })
      return settingsWithRuntimeState(state, capabilities)
    })

    const runManualMaintenance = Effect.fn("LcmRuntime.runManualMaintenance")(function* (
      input: LcmManualMaintenanceInput,
    ) {
      const operationID = createOperationID()
      const cfg = yield* getResolved()
      const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const strategy = settings?.state.strategy ?? cfg.strategy
      const freshTailTokens = settings?.state.freshTailTokens ?? cfg.freshTailTokens
      const conversationID = capabilities.conversationID

      if (capabilities.lifecycleState === "db_unavailable") {
        const safeError =
          capabilities.safeError ??
          createLcmSafeError({
            code: "db_unavailable",
            templateKey: "lcm.db.unavailable",
            safeParams: { operationID, retryable: false, action: "contact_support" },
            retryable: false,
            diagnosticCode: "lcm_maintenance_db_unavailable",
          })
        if (!conversationID) return yield* Effect.fail(safeError)
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError,
        })
      }

      if (!conversationID) {
        return yield* Effect.fail(invalidRequest("lcm_maintenance_conversation_missing", { operationID }))
      }

      switch (capabilities.lifecycleState) {
        case "legacy_read_only":
          return failedMaintenanceResult({
            conversationID,
            operationID,
            reason: input.reason,
            blocking: input.blocking,
            safeError: legacyReadOnly({ operationID, conversationID }),
          })
        case "recovery_required": {
          const safeError =
            capabilities.safeError ??
            recoveryMissing({
              operationID,
              conversationID,
              code: "recovery_required",
              retryable: true,
              action: "retry",
              diagnosticCode: "lcm_maintenance_recovery_required",
            })
          return failedMaintenanceResult({
            conversationID,
            operationID,
            reason: "repair",
            blocking: input.blocking,
            status: "recovery_required",
            safeError,
          })
        }
        case "recovery_failed":
          return failedMaintenanceResult({
            conversationID,
            operationID,
            reason: "repair",
            blocking: input.blocking,
            safeError: recoveryMissing({
              operationID,
              conversationID,
              code: "recovery_failed",
              retryable: false,
              action: "start_new_thread",
              diagnosticCode: "lcm_maintenance_recovery_failed",
            }),
          })
        case "passive_synced":
        case "lcm_active":
          break
      }

      if (!input.renderOptions) {
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError: invalidRequest("lcm_maintenance_render_options_missing", { operationID, conversationID }),
        })
      }
      const renderOptions = input.renderOptions

      if (!provider) {
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError: invalidRequest("lcm_maintenance_runtime_services_missing", { operationID, conversationID }),
        })
      }
      const contextResult = yield* resolveSessionContext({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            safeError: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_maintenance_context_resolution_failed", { operationID, conversationID }),
          }),
          onSuccess: (context) => ({ ok: true as const, context }),
        }),
      )
      if (!contextResult.ok) {
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError: contextResult.safeError,
        })
      }
      const sessionContext = contextResult.context

      const model = yield* provider
        .getModel(ProviderID.make(renderOptions.providerID), ModelID.make(renderOptions.modelID))
        .pipe(
          Effect.catch(() =>
            Effect.fail(invalidRequest("lcm_maintenance_model_not_found", { operationID, conversationID })),
          ),
        )
      const modelLimits = resolveLcmModelLimits(model)
      const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
        providerContextLimit: modelLimits.context,
        providerOutputLimit: modelLimits.output,
      })
      const makeLeafSummaryGenerator = (priority: LcmProviderCapacityPriority) => {
        let languagePromise: Promise<LanguageModelV3> | undefined
        return async ({
          prompt,
          request,
          operationID,
          maxOutputTokens,
        }: {
          prompt: string
          request?: { readonly messages: readonly LcmGenerationMessage[] }
          operationID?: OperationID
          maxOutputTokens?: number
        }) => {
          const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
          const result = await runProviderGeneration(model, priority, operationID, () =>
            generateText({
              model: language,
              temperature: model.capabilities.temperature ? 0 : undefined,
              providerOptions: ProviderTransform.providerOptions(model, model.options),
              maxOutputTokens: maxOutputTokens ?? summaryGenerationMaxOutputTokens,
              maxRetries: 0,
              messages: lcmGenerationMessages({ prompt, request }),
            }),
          )
          return {
            text: result.text,
            usage: providerUsageFromGeneration({
              usage: result.usage,
              providerID: renderOptions.providerID,
              modelID: renderOptions.modelID,
            }),
          }
        }
      }

      let threshold = yield* sessionContext
        .isOverThreshold({
          conversationID,
          renderOptions,
          strategy,
          providerContextLimit: modelLimits.context,
          providerInputLimit: modelLimits.input,
          providerOutputLimit: modelLimits.output,
          budgetStatus: modelLimits.budgetStatus,
          freshTailTokens,
        })
        .pipe(
          Effect.catch((error: unknown) => {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_maintenance_threshold_failed", { operationID, conversationID })
            return Effect.fail(safeError)
          }),
        )
      threshold = applyLaneLatches(threshold)

      const trigger = decideMaintenanceTrigger({ threshold, operationID })
      if (trigger.trigger === "hard_blocking") {
        const sessionID = input.sessionID as RuntimeSessionID
        const previousStatus = sessionStatus ? yield* sessionStatus.get(sessionID) : undefined
        const restoreStatus = isPromptPreparationStatus(previousStatus)
          ? ({ type: "idle" } as const)
          : (previousStatus ?? ({ type: "idle" } as const))

        const maintenance = yield* Effect.gen(function* () {
          if (sessionStatus) {
            yield* sessionStatus.set(sessionID, { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL })
          }
          if (bus) {
            yield* publishLcmEvent(
              bus,
              createLcmMaintenanceStartedEvent({
                sessionID: input.sessionID,
                conversationID,
                operationID,
                phase: "hard_limit",
                reason: "hard_limit",
                blocking: true,
                beforeTokens: threshold.activeTokens,
                ...thresholdEventFields(threshold),
                safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
              }),
            )
          }

          const generator = makeLeafSummaryGenerator("foreground")
          const maintenance = yield* sessionContext
            .compactUntilUnderHardLimit({
              sessionID: input.sessionID,
              conversationID,
              threshold,
              renderOptions,
              abortSignalID: input.abortSignalID,
              providerContextLimit: modelLimits.context,
              providerInputLimit: modelLimits.input,
              providerOutputLimit: modelLimits.output,
              operationID,
              leafGenerator: generator,
              condenseGenerator: generator,
              onProgress: (progress) =>
                sessionStatus
                  ? sessionStatus
                      .set(sessionID, { type: "busy", message: hardLimitProgressLabel(progress) })
                      .pipe(Effect.ignore)
                  : Effect.void,
            } satisfies LcmHardLimitRuntimeInput)
            .pipe(
              Effect.catch((error: unknown) => {
                const safeError = isLcmSafeError(error)
                  ? error
                  : invalidRequest("lcm_maintenance_hard_limit_failed", { operationID, conversationID })
                return Effect.succeed(
                  failedMaintenanceResult({
                    conversationID,
                    operationID,
                    reason: "hard_limit",
                    blocking: true,
                    safeError,
                    beforeTokens: threshold.activeTokens,
                    afterTokens: threshold.activeTokens,
                  }),
                )
              }),
            )
          if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
            clearActiveLatchesFromThreshold(threshold)
          }
          if (bus) {
            const event =
              maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError
                ? createLcmMaintenanceFailedEvent({
                    sessionID: input.sessionID,
                    result: maintenance,
                    phase: "hard_limit",
                    ...thresholdEventFields(threshold),
                  })
                : createLcmMaintenanceEndedEvent({
                    sessionID: input.sessionID,
                    result: maintenance,
                    phase: "hard_limit",
                    ...thresholdEventFields(threshold),
                  })
            yield* publishLcmEvent(bus, event)
          }
          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: "maintenance",
            lastMaintenance: maintenance,
          })
          return maintenance
        }).pipe(
          Effect.ensuring(
            sessionStatus && restoreStatus
              ? sessionStatus.set(sessionID, restoreStatus).pipe(Effect.ignore)
              : Effect.void,
          ),
        )
        return maintenance
      }

      if (trigger.trigger === "none") {
        return {
          ...trigger.result,
          reason: input.reason,
          blocking: input.blocking,
        }
      }

      if (trigger.trigger === "soft_background") {
        if (bus) {
          yield* publishLcmEvent(
            bus,
            createLcmMaintenanceStartedEvent({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              phase: "leaf_summary",
              reason: "soft_threshold",
              status: "scheduled",
              blocking: false,
              beforeTokens: threshold.activeTokens,
              ...thresholdEventFields(threshold),
              safeLabel: LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
            }),
          )
          yield* publishLcmEvent(
            bus,
            createLcmMaintenanceStartedEvent({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              phase: "leaf_summary",
              reason: "soft_threshold",
              blocking: false,
              beforeTokens: threshold.activeTokens,
              ...thresholdEventFields(threshold),
              safeLabel: LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
            }),
          )
        }
        const generator = makeLeafSummaryGenerator("background")
        const maintenanceInputBudget = computeMaintenanceInputBudget({
          providerContextLimit: modelLimits.context,
          providerInputLimit: modelLimits.input,
          summaryGenerationMaxOutputTokens,
        })
        const maintenance = yield* sessionContext
          .compactLeavesToSprig({
            conversationID,
            reason: "soft_threshold",
            blocking: false,
            maintenanceInputBudget,
            softThreshold: threshold.softThreshold,
            freshTailTokens,
            summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
            summaryGenerationMaxOutputTokens,
            abortSignalID: input.abortSignalID,
            operationID,
            sessionID: input.sessionID,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            generator,
          } satisfies LcmLeafCompactionRuntimeInput)
          .pipe(
            Effect.catch((error: unknown) => {
              const safeError = isLcmSafeError(error)
                ? error
                : invalidRequest("lcm_maintenance_leaf_summary_failed", { operationID, conversationID })
              return Effect.succeed(
                failedMaintenanceResult({
                  conversationID,
                  operationID,
                  reason: "soft_threshold",
                  blocking: false,
                  safeError,
                  beforeTokens: threshold.activeTokens,
                  afterTokens: threshold.activeTokens,
                }),
              )
            }),
          )
        if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
          clearActiveLatchesFromThreshold(threshold)
        }
        if (bus) {
          const event =
            maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError
              ? createLcmMaintenanceFailedEvent({
                  sessionID: input.sessionID,
                  result: maintenance,
                  phase: "leaf_summary",
                  ...thresholdEventFields(threshold),
                })
              : createLcmMaintenanceEndedEvent({
                  sessionID: input.sessionID,
                  result: maintenance,
                  phase: "leaf_summary",
                  ...thresholdEventFields(threshold),
                })
          yield* publishLcmEvent(bus, event)
        }
        yield* publishMetrics({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          reason: "maintenance",
          lastMaintenance: maintenance,
        })
        return maintenance
      }

      if (trigger.trigger === "soft_cap_deferred" && bus) {
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceStartedEvent({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            phase: "leaf_summary",
            reason: "soft_threshold",
            status: "scheduled",
            blocking: false,
            beforeTokens: threshold.activeTokens,
            ...thresholdEventFields(threshold),
            safeLabel: trigger.result.safeMessage ?? LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
          }),
        )
      }

      return trigger.result
    })

    function softSummaryBackoffRoute(
      input: LcmSoftMaintenanceAfterTurnInput,
      conversationID: ConversationID,
    ): LcmSummaryFailureBackoffRoute {
      return {
        conversationID,
        purpose: "leaf_summary",
        promptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
        providerID: input.providerID,
        modelID: input.modelID,
      }
    }

    function withSoftSweepResultTelemetry(input: {
      result: LcmMaintenanceResult
      sweepBudget: LcmSoftSweepBudget
      passesCompleted: number
      nowMs?: number
      stopReason?: LcmMaintenanceResult["sweepStopReason"]
    }) {
      return lcmMaintenanceResultWithSoftSweepTelemetry(input.result, {
        budget: input.sweepBudget,
        passesCompleted: input.passesCompleted,
        nowMs: input.nowMs ?? Date.now(),
        stopReason: input.stopReason ?? lcmSoftSweepStopReasonForResult(input.result),
      })
    }

    function updateSoftSummaryBackoffForOutcome(input: {
      retryInput: LcmSoftMaintenanceAfterTurnInput
      conversationID: ConversationID
      result: LcmMaintenanceResult
      nowMs?: number
    }) {
      const route = softSummaryBackoffRoute(input.retryInput, input.conversationID)
      const key = lcmSummaryFailureBackoffKey(route)
      const nowMs = input.nowMs ?? Date.now()
      const shouldCountFailure = !!input.result.safeError && lcmShouldRetrySoftMaintenance(input.result)
      if (!shouldCountFailure) {
        if (!lcmShouldRetrySoftMaintenance(input.result)) softSummaryBackoffs.delete(key)
        return input.result
      }

      const state = lcmRecordSummaryFailureBackoff({
        route,
        state: softSummaryBackoffs.get(key),
        safeError: input.result.safeError,
        nowMs,
      })
      softSummaryBackoffs.set(key, state)
      return {
        ...input.result,
        ...lcmSummaryFailureBackoffTelemetry({ state, nowMs }),
      } satisfies LcmMaintenanceResult
    }

    const queueSoftMaintenanceAfterTurn: Interface["queueSoftMaintenanceAfterTurn"] = Effect.fn(
      "LcmRuntime.queueSoftMaintenanceAfterTurn",
    )(function* (input: LcmSoftMaintenanceAfterTurnInput) {
      const operationID = createOperationID()
      const cfg = yield* getResolved()
      const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
      const conversationID = capabilities.conversationID
      if (!conversationID) return undefined
      const recordTerminalAttempt = (result: LcmMaintenanceResult) =>
        resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
          Effect.flatMap((ready) =>
            writeSoftMaintenanceAttempt({
              familyDb: ready.lcmDb,
              sessionID: input.sessionID,
              conversationID,
              operationID,
              providerID: input.providerID,
              modelID: input.modelID,
              status: maintenanceAttemptStatus(result),
              safeError: result.safeError,
              safeMessage: result.safeMessage,
              summarySourceTokens: result.beforeTokens,
            }),
          ),
          Effect.catch(() => Effect.void),
        )

      if (capabilities.lifecycleState !== "lcm_active") {
        const result = emptyMaintenanceResult({
          conversationID,
          operationID,
          reason: "soft_threshold",
          blocking: false,
          status: "skipped",
          workNeeded: false,
          safeMessage: "Memory maintenance was skipped because this session is not using active memory.",
        })
        yield* recordTerminalAttempt(result)
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }
      if (!provider) {
        const safeError = invalidRequest("lcm_soft_provider_unavailable", { operationID, conversationID })
        const result = failedMaintenanceResult({
          conversationID,
          operationID,
          reason: "soft_threshold",
          blocking: false,
          safeError,
        })
        yield* recordTerminalAttempt(result)
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }

      const key = conversationID
      const familyResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (safeError) => ({ ok: false as const, safeError }),
          onSuccess: (family) => ({ ok: true as const, family }),
        }),
      )
      if (!familyResult.ok) {
        const result = failedMaintenanceResult({
          conversationID,
          operationID,
          reason: "soft_threshold",
          blocking: false,
          safeError: familyResult.safeError,
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        yield* recordTerminalAttempt(result)
        return result
      }
      const family = familyResult.family
      const workspaceKey = lcmMaintenanceWorkspaceKey(family.target)
      if (softMaintenanceInFlight.has(key)) {
        const result = {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: false,
          reason: "soft_threshold",
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "deferred",
          safeMessage: "Memory maintenance is already queued for this conversation.",
        } satisfies LcmMaintenanceResult
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        if (input.recordNoOpAttempt !== false) yield* recordTerminalAttempt(result)
        return result
      }
      if (
        lcmCountWorkspaceSoftMaintenance(softMaintenanceInFlight.values(), workspaceKey) >=
        cfg.scheduler.maxBackgroundMaintenanceModelJobsPerWorkspace
      ) {
        const result = {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: false,
          reason: "soft_threshold",
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "deferred",
          safeMessage: "Memory maintenance is already queued.",
        } satisfies LcmMaintenanceResult
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        if (input.recordNoOpAttempt !== false) yield* recordTerminalAttempt(result)
        return result
      }

      softMaintenanceInFlight.set(key, workspaceKey)
      return yield* Effect.gen(function* () {
        const blockingSoftMaintenance = true
        const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        const sessionContext =
          lcmContext && lcmContext.runtimeDbBinding !== "lcm_context_layer"
            ? lcmContext
            : yield* LcmContext.Service.use((context) => Effect.succeed(context)).pipe(
                Effect.provide(contextLayerForDb(family.lcmDb)),
              )
        const strategy = settings?.state.strategy ?? cfg.strategy
        const freshTailTokens = input.freshTailTokens ?? settings?.state.freshTailTokens ?? cfg.freshTailTokens
        const model = yield* provider
          .getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID))
          .pipe(
            Effect.catch(() =>
              Effect.fail(invalidRequest("lcm_soft_model_not_found", { operationID, conversationID })),
            ),
          )
        const modelLimits = resolveLcmModelLimits(model)
        const protectedCurrentUser = input.protectedCurrentUser
        const protectedCurrentUserMessageRowID = protectedCurrentUser
          ? yield* family.lcmDb.executeForeground({
              operationID,
              purpose: "maintenance",
              run: async (db) => {
                const rows = (
                  await (db as PGlite).query<{ message_row_id: MessageRowID }>(
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
                          conversationID,
                          protectedCurrentUser.sourceSessionID,
                          protectedCurrentUser.sourceMessageID,
                          protectedCurrentUser.messageRowID,
                        ]
                      : [conversationID, protectedCurrentUser.sourceSessionID, protectedCurrentUser.sourceMessageID],
                  )
                ).rows
                return rows[0]?.message_row_id
              },
            })
          : undefined
        if (protectedCurrentUser && !protectedCurrentUserMessageRowID) {
          const result = emptyMaintenanceResult({
            conversationID,
            operationID,
            reason: "soft_threshold",
            blocking: blockingSoftMaintenance,
            status: "skipped",
            workNeeded: true,
            safeMessage:
              "Memory maintenance was skipped because the current user boundary is not available as a raw memory row.",
          })
          if (input.recordNoOpAttempt !== false) {
            yield* writeSoftMaintenanceAttempt({
              familyDb: family.lcmDb,
              sessionID: input.sessionID,
              conversationID,
              operationID,
              providerID: input.providerID,
              modelID: input.modelID,
              status: "skipped",
              safeMessage: result.safeMessage,
            })
          }
          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: "maintenance",
            lastMaintenance: result,
          })
          yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
          return result
        }
        const targetCurrentUser =
          protectedCurrentUser && protectedCurrentUserMessageRowID
            ? softMaintenanceProtectedCurrentUserTarget({
                protectedCurrentUser,
                messageRowID: protectedCurrentUserMessageRowID,
                operationID,
              })
            : undefined
        const thresholdInput = () => ({
          conversationID,
          renderOptions: input.renderOptions,
          strategy,
          providerContextLimit: modelLimits.context,
          providerInputLimit: modelLimits.input,
          providerOutputLimit: modelLimits.output,
          budgetStatus: modelLimits.budgetStatus,
          freshTailTokens,
          ...(targetCurrentUser ? { targetCurrentUser } : {}),
        })
        const readThreshold = () =>
          sessionContext.isOverThreshold(thresholdInput()).pipe(
            Effect.map((threshold) => ({ ok: true as const, threshold })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        let thresholdAttempt = yield* readThreshold()
        if (!thresholdAttempt.ok && isSoftThresholdContextInvalid(thresholdAttempt.safeError)) {
          const recovery = yield* sessionContext
            .rebuildActiveContext({
              conversationID,
              reason: "soft_maintenance_threshold",
              strategy,
            })
            .pipe(
              Effect.map((result) => ({ ok: true as const, result })),
              Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
            )
          if (!recovery.ok) return yield* Effect.fail(recovery.safeError)
          if (recovery.result.safeError) return yield* Effect.fail(recovery.result.safeError)
          thresholdAttempt = yield* readThreshold()
        }
        if (!thresholdAttempt.ok) return yield* Effect.fail(thresholdAttempt.safeError)
        let threshold = applyLaneLatches(thresholdAttempt.threshold)
        if (!threshold.overSoft || threshold.softBacklogItemCount <= 0 || threshold.softBacklogTokens <= 0) {
          const result = updateSoftSummaryBackoffForOutcome({
            retryInput: input,
            conversationID,
            result: emptyMaintenanceResult({
              conversationID,
              operationID,
              reason: "soft_threshold",
              blocking: blockingSoftMaintenance,
              status: "no_op",
              workNeeded: false,
              beforeTokens: threshold.activeTokens,
              afterTokens: threshold.activeTokens,
              safeMessage: "Memory maintenance was no longer needed when the background job ran.",
            }),
          })
          if (input.recordNoOpAttempt !== false) {
            yield* writeSoftMaintenanceAttempt({
              familyDb: family.lcmDb,
              sessionID: input.sessionID,
              conversationID,
              operationID,
              providerID: input.providerID,
              modelID: input.modelID,
              status: "no_op",
              safeMessage: result.safeMessage,
              summarySourceTokens: result.beforeTokens,
            })
          }
          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: "sync",
          })
          yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
          return result
        }

        const sweepBudget = createLcmSoftSweepBudget({
          maxPasses: cfg.performance.softSweepMaxPasses,
          maxElapsedMs: cfg.performance.softSweepMaxElapsedMs,
        })
        const backoffRoute = softSummaryBackoffRoute(input, conversationID)
        const backoffState = softSummaryBackoffs.get(lcmSummaryFailureBackoffKey(backoffRoute))
        const backoffRemainingMs = lcmSummaryFailureBackoffRemainingMs({
          state: backoffState,
          nowMs: Date.now(),
        })
        if (backoffState && backoffRemainingMs > 0) {
          const result = withSoftSweepResultTelemetry({
            result: {
              ...emptyMaintenanceResult({
                conversationID,
                operationID,
                reason: "soft_threshold",
                blocking: blockingSoftMaintenance,
                status: "deferred",
                workNeeded: true,
                beforeTokens: threshold.activeTokens,
                afterTokens: threshold.activeTokens,
                safeMessage: "Memory maintenance is cooling down after repeated summary failures.",
              }),
              ...lcmSummaryFailureBackoffTelemetry({ state: backoffState, nowMs: Date.now() }),
            },
            sweepBudget,
            passesCompleted: 0,
            stopReason: "backoff",
          })
          if (input.recordNoOpAttempt !== false) {
            yield* writeSoftMaintenanceAttempt({
              familyDb: family.lcmDb,
              sessionID: input.sessionID,
              conversationID,
              operationID,
              providerID: input.providerID,
              modelID: input.modelID,
              status: "deferred",
              safeMessage: result.safeMessage,
              summarySourceTokens: result.beforeTokens,
            })
          }
          if (bus) {
            yield* publishLcmEvent(
              bus,
              createLcmMaintenanceEndedEvent({
                sessionID: input.sessionID,
                result,
                phase: "leaf_summary",
                ...thresholdEventFields(threshold),
              }),
            )
          }
          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: "maintenance",
            lastMaintenance: result,
          })
          yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
          return result
        }

        const startDecision = lcmSoftSweepShouldStartPass({
          budget: sweepBudget,
          passesCompleted: 0,
          nowMs: Date.now(),
        })
        if (!startDecision.canStart) {
          const safeError =
            startDecision.stopReason === "elapsed_cap"
              ? operationTimeout({
                  diagnosticCode: "lcm_soft_maintenance_sweep_elapsed_cap",
                  operationID,
                  conversationID,
                })
              : undefined
          const result = withSoftSweepResultTelemetry({
            result: emptyMaintenanceResult({
              conversationID,
              operationID,
              reason: "soft_threshold",
              blocking: blockingSoftMaintenance,
              status: "deferred",
              workNeeded: true,
              beforeTokens: threshold.activeTokens,
              afterTokens: threshold.activeTokens,
              safeMessage:
                startDecision.stopReason === "elapsed_cap"
                  ? "Memory maintenance paused because the sweep time budget was exhausted."
                  : "Memory maintenance paused because the sweep pass budget was exhausted.",
              ...(safeError ? { safeError } : {}),
            }),
            sweepBudget,
            passesCompleted: 0,
            nowMs: Date.now(),
            stopReason: startDecision.stopReason,
          })
          if (input.recordNoOpAttempt !== false) {
            yield* writeSoftMaintenanceAttempt({
              familyDb: family.lcmDb,
              sessionID: input.sessionID,
              conversationID,
              operationID,
              providerID: input.providerID,
              modelID: input.modelID,
              status: "deferred",
              safeError: result.safeError,
              safeMessage: result.safeMessage,
              summarySourceTokens: result.beforeTokens,
            })
          }
          if (bus) {
            yield* publishLcmEvent(
              bus,
              createLcmMaintenanceEndedEvent({
                sessionID: input.sessionID,
                result,
                phase: "leaf_summary",
                ...thresholdEventFields(threshold),
              }),
            )
          }
          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: "maintenance",
            lastMaintenance: result,
          })
          yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
          return result
        }

        const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
          providerContextLimit: modelLimits.context,
          providerOutputLimit: modelLimits.output,
        })
        const maintenanceInputBudget = computeMaintenanceInputBudget({
          providerContextLimit: modelLimits.context,
          providerInputLimit: modelLimits.input,
          summaryGenerationMaxOutputTokens,
        })

        if (input.recordNoOpAttempt !== false) {
          yield* writeSoftMaintenanceAttempt({
            familyDb: family.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: "scheduled",
            safeMessage: blockingSoftMaintenance
              ? LCM_BLOCKING_LEAF_MAINTENANCE_LABEL
              : LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
            summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
            summaryGenerationMaxOutputTokens,
            maintenanceInputBudget,
            summarySourceTokens: threshold.activeTokens,
          })
        }

        if (bus) {
          yield* publishLcmEvent(
            bus,
            createLcmMaintenanceStartedEvent({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              phase: "leaf_summary",
              reason: "soft_threshold",
              status: "scheduled",
              blocking: blockingSoftMaintenance,
              beforeTokens: threshold.activeTokens,
              ...thresholdEventFields(threshold),
              sweepMaxPasses: sweepBudget.maxPasses,
              sweepMaxElapsedMs: sweepBudget.maxElapsedMs,
              summaryPromptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
              summaryBackoffPurpose: "leaf_summary",
              safeLabel: blockingSoftMaintenance
                ? LCM_BLOCKING_MAINTENANCE_LABEL
                : LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
            }),
          )
          yield* publishLcmEvent(
            bus,
            createLcmMaintenanceStartedEvent({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              phase: "leaf_summary",
              reason: "soft_threshold",
              blocking: blockingSoftMaintenance,
              beforeTokens: threshold.activeTokens,
              ...thresholdEventFields(threshold),
              sweepMaxPasses: sweepBudget.maxPasses,
              sweepMaxElapsedMs: sweepBudget.maxElapsedMs,
              summaryPromptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
              summaryBackoffPurpose: "leaf_summary",
              safeLabel: blockingSoftMaintenance
                ? LCM_BLOCKING_LEAF_MAINTENANCE_LABEL
                : LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
            }),
          )
        }

        const rawMaintenance = yield* sessionContext
          .compactLeavesToSprig({
            conversationID,
            reason: "soft_threshold",
            blocking: blockingSoftMaintenance,
            maintenanceInputBudget,
            softThreshold: threshold.softThreshold,
            freshTailTokens,
            summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
            summaryGenerationMaxOutputTokens,
            abortSignalID: input.abortSignalID,
            operationID,
            sessionID: input.sessionID,
            providerID: input.providerID,
            modelID: input.modelID,
            protectedCurrentUser: input.protectedCurrentUser,
            generator: makeSummaryGenerator(model, input.renderOptions, "foreground", summaryGenerationMaxOutputTokens),
          } satisfies LcmLeafCompactionRuntimeInput)
          .pipe(
            Effect.catch((error: unknown) => {
              const safeError = isLcmSafeError(error)
                ? error
                : invalidRequest("lcm_soft_leaf_summary_failed", { operationID, conversationID })
              return Effect.succeed(
                failedMaintenanceResult({
                  conversationID,
                  operationID,
                  reason: "soft_threshold",
                  blocking: blockingSoftMaintenance,
                  safeError,
                  beforeTokens: threshold.activeTokens,
                  afterTokens: threshold.activeTokens,
                }),
              )
            }),
          )
        const maintenance = updateSoftSummaryBackoffForOutcome({
          retryInput: input,
          conversationID,
          result: withSoftSweepResultTelemetry({
            result: rawMaintenance,
            sweepBudget,
            passesCompleted: 1,
          }),
        })
        yield* writeSoftMaintenanceAttempt({
          familyDb: family.lcmDb,
          sessionID: input.sessionID,
          conversationID,
          operationID,
          providerID: input.providerID,
          modelID: input.modelID,
          status: maintenanceAttemptStatus(maintenance),
          safeError: maintenance.safeError,
          safeMessage: maintenance.safeMessage,
          summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          maintenanceInputBudget,
          summarySourceTokens: maintenance.beforeTokens ?? threshold.activeTokens,
        })

        if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
          clearActiveLatchesFromThreshold(threshold)
        }

        if (bus) {
          const event =
            maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError
              ? createLcmMaintenanceFailedEvent({
                  sessionID: input.sessionID,
                  result: maintenance,
                  phase: "leaf_summary",
                  ...thresholdEventFields(threshold),
                })
              : createLcmMaintenanceEndedEvent({
                  sessionID: input.sessionID,
                  result: maintenance,
                  phase: "leaf_summary",
                  ...thresholdEventFields(threshold),
                })
          yield* publishLcmEvent(bus, event)
        }
        yield* publishMetrics({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          reason: "maintenance",
          lastMaintenance: maintenance,
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, maintenance)
        return maintenance
      }).pipe(
        Effect.catch((error: unknown) =>
          Effect.gen(function* () {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_soft_maintenance_failed", { operationID, conversationID })
            const result = failedMaintenanceResult({
              conversationID,
              operationID,
              reason: "soft_threshold",
              blocking: true,
              safeError,
            })
            yield* recordTerminalAttempt(result)
            if (bus) {
              yield* publishLcmEvent(
                bus,
                createLcmMaintenanceFailedEvent({
                  sessionID: input.sessionID,
                  result,
                  phase: "leaf_summary",
                  safeError,
                }),
              )
            }
            yield* publishMetrics({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              reason: "maintenance",
              lastMaintenance: result,
            })
            yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
            return result
          }),
        ),
        Effect.ensuring(Effect.sync(() => softMaintenanceInFlight.delete(key))),
      )
    })

    function shouldRetrySoftMaintenance(result: LcmMaintenanceResult): boolean {
      return lcmShouldRetrySoftMaintenance(result)
    }

    function deferredJobTerminalStatus(result: LcmMaintenanceResult): LcmDeferredJobTerminalStatus {
      if (result.status === "canceled") return "canceled"
      if (result.status === "failed" || result.status === "recovery_required") return "failed"
      return "completed"
    }

    function clearDeferredSoftMaintenanceRetry(conversationID: ConversationID, result?: LcmMaintenanceResult) {
      return Effect.gen(function* () {
        const deferred = deferredSoftMaintenanceRetries.get(conversationID)
        yield* Effect.sync(() => {
          if (deferred?.timer) clearTimeout(deferred.timer)
          deferredSoftMaintenanceRetries.delete(conversationID)
        })
        if (!result) return
        const input = deferred?.input
        if (!input) return
        yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
          Effect.flatMap((ready) =>
            ready.lcmDb.execute({
              operationID: createOperationID(),
              lane: "background",
              purpose: "maintenance",
              run: async (db) =>
                finishDeferredSoftMaintenanceJob({
                  db: db as PGlite,
                  conversationID,
                  status: deferredJobTerminalStatus(result),
                  safeError: result.safeError,
                  safeMessage: result.safeMessage,
                }),
            }),
          ),
          Effect.catch(() => Effect.void),
        )
      })
    }

    function scheduleDeferredSoftMaintenanceTimer(input: {
      retryInput: LcmSoftMaintenanceAfterTurnInput
      conversationID: ConversationID
      attempts: number
      delayMs: number
    }) {
      return Effect.sync(() => {
        const existing = deferredSoftMaintenanceRetries.get(input.conversationID)
        if (existing?.timer) return

        const timer = setTimeout(() => {
          const scheduled = deferredSoftMaintenanceRetries.get(input.conversationID)
          if (!scheduled || scheduled.timer !== timer) return
          deferredSoftMaintenanceRetries.set(input.conversationID, { ...scheduled, timer: undefined })
          const running = Effect.runPromise(queueSoftMaintenanceAfterTurn(scheduled.input))
            .then((result) => {
              if (!result || !shouldRetrySoftMaintenance(result)) {
                const current = deferredSoftMaintenanceRetries.get(input.conversationID)
                if (current?.running === running) deferredSoftMaintenanceRetries.delete(input.conversationID)
              }
            })
            .catch(() => {
              const current = deferredSoftMaintenanceRetries.get(input.conversationID)
              if (current?.running === running) deferredSoftMaintenanceRetries.delete(input.conversationID)
            })
          deferredSoftMaintenanceRetries.set(input.conversationID, { ...scheduled, timer: undefined, running })
        }, input.delayMs)
        ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
        deferredSoftMaintenanceRetries.set(input.conversationID, {
          input: input.retryInput,
          attempts: input.attempts,
          timer,
        })
      })
    }

    function scheduleDeferredSoftMaintenanceRetry(
      input: LcmSoftMaintenanceAfterTurnInput,
      conversationID: ConversationID,
      result: LcmMaintenanceResult,
    ) {
      return Effect.gen(function* () {
        const existing = deferredSoftMaintenanceRetries.get(conversationID)
        if (existing?.timer) return

        const attempts = (existing?.attempts ?? 0) + 1
        if (attempts > LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_ATTEMPTS) {
          yield* clearDeferredSoftMaintenanceRetry(conversationID, {
            ...result,
            status: result.status === "deferred" ? "failed" : result.status,
            safeMessage: result.safeMessage ?? "Memory maintenance retry limit reached.",
          })
          return
        }

        const retryInput = { ...input, renderOptions: { ...input.renderOptions } }
        const delayMs = Math.max(
          lcmDeferredSoftMaintenanceRetryDelayMs(attempts),
          result.summaryBackoffRemainingMs ?? 0,
        )
        const nextRunAtMs = Date.now() + delayMs
        yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
          Effect.flatMap((ready) =>
            ready.lcmDb.execute({
              operationID: createOperationID(),
              lane: "background",
              purpose: "maintenance",
              run: async (db) =>
                upsertDeferredSoftMaintenanceJob({
                  db: db as PGlite,
                  conversationID,
                  retryInput,
                  attemptCount: attempts,
                  nextRunAtMs,
                  safeError: result.safeError,
                  safeMessage: result.safeMessage,
                }),
            }),
          ),
          Effect.catch(() => Effect.void),
        )
        yield* scheduleDeferredSoftMaintenanceTimer({
          retryInput,
          conversationID,
          attempts,
          delayMs,
        })
      })
    }

    const resumeDeferredSoftMaintenanceRetries = Effect.fn("LcmRuntime.resumeDeferredSoftMaintenanceRetries")(
      function* (input: { sessionID: string }) {
        const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
        const jobs = yield* ready.lcmDb.execute({
          operationID: createOperationID(),
          lane: "background",
          purpose: "maintenance",
          run: async (db) =>
            readDeferredSoftMaintenanceJobs({
              db: db as PGlite,
              sessionID: input.sessionID,
            }),
        })
        for (const job of jobs) {
          yield* schedulePersistedDeferredSoftMaintenanceRetry(job)
        }
      },
    )

    function schedulePersistedDeferredSoftMaintenanceRetry(job: LcmDeferredSoftMaintenanceJob) {
      if (deferredSoftMaintenanceRetries.has(job.conversationID)) return Effect.void
      const retryInput = {
        sessionID: job.sessionID,
        providerID: job.providerID,
        modelID: job.modelID,
        renderOptions: { ...job.renderOptions },
        ...(job.protectedCurrentUser ? { protectedCurrentUser: job.protectedCurrentUser } : {}),
      } satisfies LcmSoftMaintenanceAfterTurnInput
      return scheduleDeferredSoftMaintenanceTimer({
        retryInput,
        conversationID: job.conversationID,
        attempts: job.attemptCount,
        delayMs: Math.max(0, job.nextRunAtMs - Date.now()),
      })
    }

    function handleSoftMaintenanceRetryOutcome(
      input: LcmSoftMaintenanceAfterTurnInput,
      conversationID: ConversationID,
      result: LcmMaintenanceResult,
    ) {
      return shouldRetrySoftMaintenance(result)
        ? scheduleDeferredSoftMaintenanceRetry(input, conversationID, result)
        : clearDeferredSoftMaintenanceRetry(conversationID, result)
    }

    const cancelDeferredMaintenance: Interface["cancelDeferredMaintenance"] = Effect.fn(
      "LcmRuntime.cancelDeferredMaintenance",
    )(function* (input: LcmCancelDeferredMaintenanceInput) {
      const operationID = createOperationID()
      const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
      const conversationID = capabilities.conversationID
      if (!conversationID) {
        return yield* Effect.fail(invalidRequest("lcm_cancel_deferred_conversation_missing", { operationID }))
      }

      const scheduled = deferredSoftMaintenanceRetries.get(conversationID)
      if (scheduled && !scheduled.timer) {
        return emptyMaintenanceResult({
          conversationID,
          operationID,
          reason: "soft_threshold",
          blocking: false,
          status: "no_op",
          workNeeded: false,
          safeMessage: "Memory maintenance is already running and will finish in background.",
        })
      }

      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const safeMessage = "Queued memory maintenance retry was canceled."
      const canceledInMemory = yield* Effect.sync(() => {
        const current = deferredSoftMaintenanceRetries.get(conversationID)
        if (!current?.timer) return false
        clearTimeout(current.timer)
        deferredSoftMaintenanceRetries.delete(conversationID)
        return true
      })
      const canceledPersisted = yield* family.lcmDb.execute({
        operationID,
        lane: "background",
        purpose: "maintenance",
        run: async (db) =>
          cancelQueuedDeferredSoftMaintenanceJob({
            db: db as PGlite,
            conversationID,
            safeMessage,
          }),
      })

      const canceled = canceledInMemory || canceledPersisted
      const result = emptyMaintenanceResult({
        conversationID,
        operationID,
        reason: "soft_threshold",
        blocking: false,
        status: canceled ? "canceled" : "no_op",
        workNeeded: canceled,
        safeMessage: canceled ? safeMessage : "No queued memory maintenance retry was found.",
      })

      yield* writeSoftMaintenanceAttempt({
        familyDb: family.lcmDb,
        sessionID: input.sessionID,
        conversationID,
        operationID,
        status: maintenanceAttemptStatus(result),
        safeMessage: result.safeMessage,
      }).pipe(Effect.catch(() => Effect.void))

      if (canceled && bus) {
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceEndedEvent({
            sessionID: input.sessionID,
            result,
            phase: "leaf_summary",
          }),
        )
      }
      yield* publishMetrics({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        reason: "maintenance",
        lastMaintenance: result,
      })

      return result
    })

    const diagnoseDb: Interface["diagnoseDb"] = Effect.fn("LcmRuntime.diagnoseDb")(function* (input) {
      return yield* diagnoseRuntimeLcmDb({ lcmDb, sessionID: input.sessionID })
    })

    const rebuildDb: Interface["rebuildDb"] = Effect.fn("LcmRuntime.rebuildDb")(function* (input) {
      return yield* rebuildRuntimeLcmDb({ lcmDb, sessionID: input.sessionID, dryRun: input.dryRun })
    })

    const exportPrompts: Interface["exportPrompts"] = Effect.fn("LcmRuntime.exportPrompts")(function* (input) {
      const scope = yield* getConversationScope({ sessionID: input.sessionID })
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const operationID = createOperationID()
      return yield* ready.lcmDb.executeForeground({
        operationID,
        purpose: "debug_support",
        run: (db) =>
          exportLcmPrompts({
            db: db as PGlite,
            sessionID: input.sessionID,
            conversationID: scope.conversationID,
            dataDir: ready.dataDir,
            workspaceRoot: input.workspaceRoot,
            operationID,
          }),
      })
    })

    const preflightBeforeModel: Interface["preflightBeforeModel"] = (input) => {
      const operationID = createOperationID()
      const runtimeSessionID = input.sessionID as RuntimeSessionID
      const setPreflightStatus = (message: string) =>
        sessionStatus ? sessionStatus.set(runtimeSessionID, { type: "busy", message }).pipe(Effect.ignore) : Effect.void
      const clearPreflightStatus = sessionStatus
        ? Effect.gen(function* () {
            const current = yield* sessionStatus.get(runtimeSessionID)
            if (isPromptPreparationStatus(current)) {
              yield* sessionStatus.set(runtimeSessionID, { type: "idle" })
            }
          }).pipe(Effect.ignore)
        : Effect.void
      return Effect.gen(function* () {
        const internal = input as LcmPreflightRuntimeInput
        const unavailable = (diagnosticCode: string) =>
          createLcmSafeError({
            code: "db_unavailable",
            templateKey: "lcm.db.unavailable",
            safeParams: { operationID, retryable: false, action: "contact_support" },
            retryable: false,
            diagnosticCode,
          })

        yield* setPreflightStatus(LCM_PREFLIGHT_STORAGE_LABEL)
        const dbStatus = yield* initializeDb({ sessionID: input.sessionID })
        if (dbStatus.status !== "ready") {
          yield* publishDirectDbStatus({
            status: dbStatus,
            sessionID: input.sessionID,
            lifecycleState: "db_unavailable",
            operationID,
          })
          return blockedPreflight({
            sessionID: input.sessionID,
            lifecycleState: "db_unavailable",
            safeError: dbStatus.safeError ?? safeErrorForDbStatus(dbStatus),
          })
        }

        const settings = yield* effectiveSettings({ sessionID: input.sessionID })
        const initialCapabilities = yield* getCapabilities({ sessionID: input.sessionID })
        if (initialCapabilities.lifecycleState === "db_unavailable") {
          const safeError = initialCapabilities.safeError ?? unavailable("lcm_preflight_db_unavailable")
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: "db_unavailable",
            safeError,
          })
        }

        if (!provider) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: invalidRequest("lcm_preflight_runtime_services_missing", {
              operationID,
              conversationID: initialCapabilities.conversationID,
              action: "contact_support",
            }),
          })
        }
        const contextResult = yield* resolveSessionContext({ sessionID: input.sessionID }).pipe(
          Effect.match({
            onFailure: (error) => ({
              ok: false as const,
              safeError: isLcmSafeError(error)
                ? error
                : invalidRequest("lcm_preflight_context_resolution_failed", {
                    operationID,
                    conversationID: initialCapabilities.conversationID,
                    action: "retry",
                    retryable: true,
                  }),
            }),
            onSuccess: (context) => ({ ok: true as const, context }),
          }),
        )
        if (!contextResult.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: contextResult.safeError,
          })
        }
        const sessionContext = contextResult.context

        yield* setPreflightStatus(LCM_PREFLIGHT_SYNC_LABEL)
        const synced = yield* syncFinalizedSourceMessages({
          sessionID: input.sessionID,
          upToMessageID:
            internal.syncUpToMessageID ??
            internal.renderPreparation?.lastUserMessageID ??
            internal.renderPreparation?.lastUser?.id,
          strategy: settings.state.strategy,
          abortSignal: internal.abortSignal,
        }).pipe(
          Effect.provideService(LcmDb.Service, lcmDb),
          Effect.map((result) => ({ ok: true as const, result })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!synced.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: synced.safeError,
          })
        }

        const conversationID = synced.result.conversationID
        const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
        if (capabilities.lifecycleState === "legacy_read_only") {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: "legacy_read_only",
            safeError: legacyReadOnly({ operationID, conversationID }),
          })
        }
        if (capabilities.lifecycleState === "db_unavailable") {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: capabilities.conversationID,
            lifecycleState: "db_unavailable",
            safeError: capabilities.safeError ?? unavailable("lcm_preflight_db_unavailable_after_sync"),
          })
        }
        if (synced.result.safeError) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: synced.result.safeError,
          })
        }
        if (!internal.renderPreparation) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: invalidRequest("lcm_preflight_render_preparation_missing", {
              operationID,
              conversationID,
              action: "retry",
              retryable: true,
            }),
          })
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_REBUILD_LABEL)
        const recovery = yield* sessionContext
          .rebuildActiveContext({
            conversationID,
            reason: "preflight",
            strategy: settings.state.strategy,
            abortSignal: internal.abortSignal,
          })
          .pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        if (!recovery.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: recovery.safeError,
          })
        }
        if (recovery.result.safeError) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: recovery.result.lifecycleState,
            safeError: recovery.result.safeError,
          })
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_RETRIEVAL_LABEL)
        const cuePayloadsResult =
          capabilities.lifecycleState === "lcm_active"
            ? yield* LcmRetrieval.memoryCues({
                sessionID: input.sessionID,
                dataDir: dbStatus.dataDir,
                currentSourceMessageID:
                  internal.renderPreparation.lastUserMessageID ?? internal.renderPreparation.lastUser?.id,
                abortSignal: internal.abortSignal,
              }).pipe(
                Effect.provideService(LcmDb.Service, lcmDb),
                Effect.map((cuePayloads) => ({ ok: true as const, cuePayloads })),
                Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
              )
            : { ok: true as const, cuePayloads: [] }
        if (!cuePayloadsResult.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: cuePayloadsResult.safeError,
          })
        }
        const targetCurrentUserSourceMessageID =
          internal.renderPreparation.lastUserMessageID ?? internal.renderPreparation.lastUser?.id
        if (!targetCurrentUserSourceMessageID) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: recoveryMissing({
              operationID,
              conversationID,
              code: "missing_source",
              retryable: false,
              action: "repeat_input",
              diagnosticCode: "lcm_preflight_current_user_unproven",
            }),
          })
        }
        const cueRefresh = yield* sessionContext
          .replaceRetrievalCues({
            conversationID,
            targetCurrentUserSourceMessageID,
            cuePayloads: cuePayloadsResult.cuePayloads,
            abortSignal: internal.abortSignal,
          })
          .pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        if (!cueRefresh.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: cueRefresh.safeError,
          })
        }

        const model = yield* provider.getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID)).pipe(
          Effect.catch(() =>
            Effect.fail(
              invalidRequest("lcm_preflight_model_not_found", {
                operationID,
                conversationID,
                action: "retry",
                retryable: true,
              }),
            ),
          ),
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (model) => ({ ok: true as const, model }),
          }),
        )
        if (!model.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: model.safeError,
          })
        }
        const modelLimits = resolveLcmModelLimits(model.model)
        const providerInputLimit = lcmProviderOverflowRecoveryInputLimit({
          modelLimits,
          recovery: internal.providerOverflowRecovery,
        })

        const targetCurrentUser = {
          sourceSessionID: input.sessionID,
          sourceMessageID: targetCurrentUserSourceMessageID,
          promptOperationID: operationID,
          visibilityBaseMessageID: targetCurrentUserSourceMessageID,
        } satisfies LcmAssemblyInput["targetCurrentUser"]

        const thresholdInput = () =>
          ({
            conversationID,
            renderOptions: input.renderOptions,
            strategy: settings.state.strategy,
            providerContextLimit: modelLimits.context,
            providerInputLimit,
            providerOutputLimit: modelLimits.output,
            budgetStatus: modelLimits.budgetStatus,
            freshTailTokens: settings.state.freshTailTokens,
            renderPreparation: internal.renderPreparation,
            recordSnapshot: false,
            targetCurrentUser,
            abortSignal: internal.abortSignal,
          }) satisfies LcmRawLeafThresholdInput

        yield* setPreflightStatus(LCM_PREFLIGHT_BUDGET_LABEL)
        let threshold = yield* sessionContext.isOverThreshold(thresholdInput()).pipe(
          Effect.map((threshold) => ({ ok: true as const, threshold })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!threshold.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: threshold.safeError,
          })
        }
        threshold = { ok: true as const, threshold: applyLaneLatches(threshold.threshold) }

        let maintenance: LcmMaintenanceResult | undefined
        const currentThreshold = threshold.threshold
        if (currentThreshold.overHard) {
          const sessionID = runtimeSessionID
          const previousStatus = sessionStatus ? yield* sessionStatus.get(sessionID) : undefined
          const restoreStatus = isPromptPreparationStatus(previousStatus)
            ? ({ type: "idle" } as const)
            : (previousStatus ?? ({ type: "idle" } as const))

          maintenance = yield* Effect.gen(function* () {
            if (sessionStatus) {
              yield* sessionStatus.set(sessionID, { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL })
            }
            if (bus) {
              yield* publishLcmEvent(
                bus,
                createLcmMaintenanceStartedEvent({
                  sessionID: input.sessionID,
                  conversationID,
                  operationID,
                  phase: "hard_limit",
                  reason: "hard_limit",
                  blocking: true,
                  beforeTokens: currentThreshold.activeTokens,
                  hardLimit: currentThreshold.hardLimit,
                  safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
                }),
              )
            }

            const generator = makeSummaryGenerator(model.model, input.renderOptions)
            const result = yield* sessionContext
              .compactUntilUnderHardLimit({
                sessionID: input.sessionID,
                conversationID,
                threshold: currentThreshold,
                renderOptions: input.renderOptions,
                abortSignalID: input.abortSignalID,
                abortSignal: internal.abortSignal,
                providerContextLimit: modelLimits.context,
                providerInputLimit,
                providerOutputLimit: modelLimits.output,
                renderPreparation: internal.renderPreparation,
                operationID,
                leafGenerator: generator,
                condenseGenerator: generator,
                onProgress: (progress) =>
                  sessionStatus
                    ? sessionStatus
                        .set(sessionID, { type: "busy", message: hardLimitProgressLabel(progress) })
                        .pipe(Effect.ignore)
                    : Effect.void,
              } satisfies LcmHardLimitRuntimeInput)
              .pipe(
                Effect.catch((error: unknown) => {
                  const safeError = isLcmSafeError(error)
                    ? error
                    : invalidRequest("lcm_preflight_hard_limit_failed", {
                        operationID,
                        conversationID,
                        action: "retry",
                        retryable: true,
                      })
                  return Effect.succeed(
                    failedMaintenanceResult({
                      conversationID,
                      operationID,
                      reason: "hard_limit",
                      blocking: true,
                      safeError,
                      beforeTokens: currentThreshold.activeTokens,
                      afterTokens: currentThreshold.activeTokens,
                    }),
                  )
                }),
              )
            if (bus) {
              const event =
                result.status === "failed" || result.status === "canceled" || result.safeError
                  ? createLcmMaintenanceFailedEvent({
                      sessionID: input.sessionID,
                      result,
                      phase: "hard_limit",
                      hardLimit: currentThreshold.hardLimit,
                    })
                  : createLcmMaintenanceEndedEvent({
                      sessionID: input.sessionID,
                      result,
                      phase: "hard_limit",
                      hardLimit: currentThreshold.hardLimit,
                    })
              yield* publishLcmEvent(bus, event)
            }
            return result
          }).pipe(
            Effect.ensuring(
              sessionStatus && restoreStatus
                ? sessionStatus.set(sessionID, restoreStatus).pipe(Effect.ignore)
                : Effect.void,
            ),
          )
          if (maintenance.status === "failed" || maintenance.safeError) {
            yield* publishMetrics({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              reason: "maintenance",
              lastMaintenance: maintenance,
            })
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID,
              lifecycleState: capabilities.lifecycleState,
              threshold: currentThreshold,
              maintenance,
              safeError:
                maintenance.safeError ??
                hardLimitUnresolved({
                  operationID,
                  conversationID,
                  beforeTokens: currentThreshold.activeTokens,
                  hardLimit: currentThreshold.hardLimit,
                  diagnosticCode: "lcm_preflight_hard_limit_unresolved",
                }),
            })
          }

          threshold = yield* sessionContext.isOverThreshold(thresholdInput()).pipe(
            Effect.map((threshold) => ({ ok: true as const, threshold })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
          if (!threshold.ok) {
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID,
              lifecycleState: capabilities.lifecycleState,
              maintenance,
              safeError: threshold.safeError,
            })
          }
          threshold = { ok: true as const, threshold: applyLaneLatches(threshold.threshold) }
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_ASSEMBLY_LABEL)
        const assemblyInput = {
          sessionID: input.sessionID,
          conversationID,
          targetCurrentUser,
          renderOptions: input.renderOptions,
          renderPreparation: internal.renderPreparation,
          threshold: threshold.threshold,
          abortSignal: internal.abortSignal,
        } satisfies LcmRawLeafAssemblyInput
        const assembly = yield* sessionContext.assembleModelMessages(assemblyInput).pipe(
          Effect.map((assembly) => ({ ok: true as const, assembly })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!assembly.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            threshold: threshold.threshold,
            maintenance,
            safeError: assembly.safeError,
          })
        }
        if (!assembly.assembly.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            threshold: threshold.threshold,
            maintenance,
            safeError: assembly.assembly.safeError,
          })
        }

        const assembled = assembly.assembly
        return yield* Effect.gen(function* () {
          if (capabilities.lifecycleState === "passive_synced") {
            yield* markConversationActive({ sessionID: input.sessionID, conversationID })
          }

          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: maintenance ? "maintenance" : "sync",
            ...(maintenance ? { lastMaintenance: maintenance } : {}),
          })

          return {
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: "lcm_active",
            threshold: threshold.threshold,
            assembly: assembled,
            ...(maintenance ? { maintenance } : {}),
            canProceed: true,
          } satisfies LcmPreflightResult
        }).pipe(
          Effect.catch((error) => {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_preflight_post_assembly_failed", {
                  operationID,
                  conversationID,
                  action: "retry",
                  retryable: true,
                })
            return Effect.gen(function* () {
              const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
              yield* ready.lcmDb.executeForeground({
                operationID: createOperationID(),
                purpose: "assembly",
                run: (db) =>
                  finalizeProviderRequestSnapshotRow({
                    db: db as PGlite,
                    requestSnapshotID: assembled.providerRequestSnapshotID,
                    conversationID,
                    status: "canceled",
                  }),
              })
            }).pipe(
              Effect.catch(() => Effect.void),
              Effect.as(
                blockedPreflight({
                  sessionID: input.sessionID,
                  conversationID,
                  lifecycleState: capabilities.lifecycleState,
                  threshold: threshold.threshold,
                  maintenance,
                  safeError,
                }),
              ),
            )
          }),
        )
      }).pipe(
        Effect.catch((error) => {
          const safeError = isLcmSafeError(error)
            ? error
            : invalidRequest("lcm_preflight_unhandled_failure", {
                operationID,
                action: "retry",
                retryable: true,
              })
          return Effect.gen(function* () {
            const observedCapabilities = yield* getCapabilities({ sessionID: input.sessionID }).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID: observedCapabilities?.conversationID ?? safeError.conversationID,
              lifecycleState: preflightFallbackLifecycleState({
                safeError,
                observedLifecycleState: observedCapabilities?.lifecycleState,
              }),
              safeError,
            })
          })
        }),
        Effect.tap((result) => (result.canProceed ? Effect.void : clearPreflightStatus)),
        Effect.onInterrupt(() => clearPreflightStatus),
      )
    }

    const expandQuery = Effect.fn("LcmRuntime.expandQuery")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        providerID?: string
        modelID?: string
      } & LcmExpandQueryInput,
    ) {
      const rootScope = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const operationID = createOperationID()
      let retrievalSessionID = input.sessionID
      let releaseChildSlot: Effect.Effect<void> | undefined
      const providerID = input.providerID
      const modelID = input.modelID
      const model =
        provider && providerID && modelID
          ? yield* provider
              .getModel(ProviderID.make(providerID), ModelID.make(modelID))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      const providerInfo =
        provider && model
          ? yield* provider.getProvider(model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      const localProviderCapacityKey = model
        ? (() => {
            const lane = lcmProviderCapacityLane(
              lcmProviderCapacityInputFromModel({
                model,
                priority: "foreground",
                ...(providerInfo ? { provider: providerInfo } : {}),
              }),
            )
            return lane.capacityClass === "remote_or_unknown" ? undefined : lane.key
          })()
        : undefined
      if (rootScope?.capabilityClass === "root") {
        const childSessionID = `${input.sessionID}:lcm_expand_query:${operationID}`
        const slot = yield* acquireChildSessionSlot({
          sessionID: childSessionID,
          rootConversationID: rootScope.rootConversationID,
          projectID: rootScope.projectID,
          ...(rootScope.workspaceID ? { workspaceID: rootScope.workspaceID } : {}),
          capabilityClass: "explore_child",
          ...(localProviderCapacityKey ? { localProviderCapacityKey } : {}),
        }).pipe(
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (slot) => ({ ok: true as const, slot }),
          }),
        )
        if (!slot.ok) return { ok: false, error: slot.safeError } satisfies LcmToolErrorResult
        releaseChildSlot = slot.slot.release
        const child = yield* getOrCreateChildConversation({
          sessionID: childSessionID,
          parentSessionID: input.sessionID,
          capabilityClass: "explore_child",
          source: "lcm_explore",
          operationID,
        }).pipe(
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (child) => ({ ok: true as const, child }),
          }),
        )
        if (!child.ok) {
          yield* releaseChildSlot
          return { ok: false, error: child.safeError } satisfies LcmToolErrorResult
        }
        retrievalSessionID = child.child.sessionID
      }
      let usage: LcmRetrieval.LcmExpandQueryUsage | undefined
      let languagePromise: Promise<LanguageModelV3> | undefined
      const runExpandQuery = LcmRetrieval.expandQuery({
        ...input,
        sessionID: retrievalSessionID,
        generator:
          provider && model && providerID && modelID
            ? async ({ prompt, request, maxAnswerTokens }) => {
                const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
                const generated = await runProviderGeneration(
                  model,
                  "foreground",
                  operationID,
                  () =>
                    generateText({
                      model: language,
                      temperature: model.capabilities.temperature ? 0 : undefined,
                      providerOptions: ProviderTransform.providerOptions(model, model.options),
                      maxOutputTokens: maxAnswerTokens,
                      maxRetries: 0,
                      messages: lcmGenerationMessages({ prompt, request }),
                    }),
                  { abortSignal: input.abortSignal },
                )
                usage = providerUsageFromGeneration({
                  usage: generated.usage,
                  providerID,
                  modelID,
                })
                return { text: generated.text, usage }
              }
            : undefined,
      }).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      const result = yield* releaseChildSlot ? runExpandQuery.pipe(Effect.ensuring(releaseChildSlot)) : runExpandQuery
      if (result.ok && usage) {
        const scope =
          rootScope ??
          (yield* getConversationScope({ sessionID: input.sessionID }).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          ))
        if (scope) {
          yield* writeUsageRecord({
            sessionID: input.sessionID,
            conversationID: scope.conversationID,
            purpose: "retrieval_expand_query",
            mode: "explicit_retrieval",
            ...usage,
          }).pipe(Effect.catch(() => Effect.void))
        }
      }
      if (!result.ok) return result
      const publicResult = result as LcmExpandQueryResult & { usage?: unknown }
      return {
        ok: true,
        answer: publicResult.answer,
        citations: publicResult.citations,
        ...(publicResult.coverage ? { coverage: publicResult.coverage } : {}),
        ...(publicResult.truncated !== undefined ? { truncated: publicResult.truncated } : {}),
      } satisfies LcmExpandQueryResult
    })

    const fileStaleStates = new Set<LcmFileStaleState>([
      "current",
      "missing",
      "moved",
      "size_mismatch",
      "mtime_mismatch",
      "hash_mismatch",
      "symlink_retargeted",
      "permission_denied",
      "outside_boundary",
      "artifact_missing",
      "artifact_size_mismatch",
      "artifact_hash_mismatch",
      "unknown",
    ])

    const publishReadFileStatus = Effect.fn("LcmRuntime.publishReadFileStatus")(function* (input: {
      sessionID: string
      result: LcmReadResult | LcmToolErrorResult
    }) {
      if (!bus || input.result.ok || input.result.error.templateKey !== "lcm.file.stale") return
      const safeParams = input.result.error.safeParams as { fileID?: string; staleState?: string }
      if (!safeParams.fileID?.startsWith("file_")) return
      const staleState = fileStaleStates.has(safeParams.staleState as LcmFileStaleState)
        ? (safeParams.staleState as LcmFileStaleState)
        : "unknown"
      const status = yield* lcmDb
        .executeForeground({
          operationID: createOperationID(),
          purpose: "large_file",
          run: (db) =>
            loadLargeFileStatus(db as PGlite, safeParams.fileID as LcmFileID, {
              staleState,
              blockingUse: true,
              safeError: input.result.ok ? undefined : input.result.error,
            }),
        })
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!status) return
      yield* publishLcmEvent(
        bus,
        createLcmFileStatusEvent({
          sessionID: input.sessionID,
          conversationID: status.safeError?.conversationID,
          status,
        }),
      ).pipe(Effect.catch(() => Effect.void))
    })

    const admitPathBackedFile = Effect.fn("LcmRuntime.admitPathBackedFile")(function* (
      input: LcmPathBackedAdmissionInput & { abortSignal?: AbortSignal },
    ) {
      const operationID = createOperationID()
      const conversationID = yield* getOrCreateConversation({ sessionID: input.sessionID })
      const scope = yield* getConversationScope({ sessionID: input.sessionID })
      if (scope.conversationID !== conversationID) {
        return yield* Effect.fail(invalidRequest("lcm_path_admission_scope_mismatch", { operationID, conversationID }))
      }
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const admitted = yield* family.lcmDb.executeForeground({
        operationID,
        purpose: "large_file",
        abortSignal: input.abortSignal,
        run: async (db) => {
          const row = await registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: input.originalPath,
            boundaryMetadata: scope.boundaryMetadata,
            mimeType: input.mimeType,
            abortSignal: input.abortSignal,
          })
          const contextItemID = await addLargeFileMarkerContextItem({
            db: db as PGlite,
            conversationID,
            fileID: row.file_id,
          })
          return admittedPathBackedFileFromRow({ row, conversationID, contextItemID })
        },
      })
      yield* publishMetrics({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        reason: "large_file_marker",
      }).pipe(Effect.catch(() => Effect.void))
      yield* publishExplorationStatus({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        status: yield* family.lcmDb.executeForeground({
          operationID,
          purpose: "large_file",
          run: (db) => loadLargeFileStatus(db as PGlite, admitted.fileID, { blockingUse: true }),
        }),
      }).pipe(Effect.catch(() => Effect.void))
      return admitted
    })

    const publishExplorationStatus = Effect.fn("LcmRuntime.publishExplorationStatus")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      status?: LcmFileStatus
    }) {
      if (!bus || !input.status) return
      yield* publishLcmEvent(
        bus,
        createLcmFileStatusEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          status: input.status,
        }),
      ).pipe(Effect.catch(() => Effect.void))
    })

    const writeExplorationStatus = Effect.fn("LcmRuntime.writeExplorationStatus")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      fileID: LcmFileID
      status: LcmFileStatus["explorationStatus"]
      explorerKind: LcmFileStatus["explorerKind"]
      safeReason?: LcmFileStatus["safeReason"]
      sampled?: boolean
      sampleBytes?: number
      summaryText?: string | null
      promptVersion?: "file-exploration-summary-v2" | null
      usageRecordID?: string | null
      lcmDbService?: typeof lcmDb
    }) {
      const dbService = input.lcmDbService ?? lcmDb
      const status = yield* dbService.executeForeground({
        operationID: input.operationID,
        purpose: "large_file",
        run: (db) =>
          updateLargeFileExplorationStatus({
            db: db as PGlite,
            fileID: input.fileID,
            status: input.status,
            explorerKind: input.explorerKind,
            safeReason: input.safeReason,
            sampled: input.sampled,
            sampleBytes: input.sampleBytes,
            summaryText: input.summaryText,
            promptVersion: input.promptVersion,
            usageRecordID: input.usageRecordID,
          }),
      })
      yield* publishExplorationStatus({
        sessionID: input.sessionID,
        conversationID: input.conversationID,
        operationID: input.operationID,
        status,
      })
      return status
    })

    const unauthorizedFile = (input: {
      operationID: OperationID
      conversationID?: ConversationID
      fileID: LcmFileID
    }) =>
      createLcmSafeError({
        code: "unauthorized",
        templateKey: "lcm.auth.denied",
        safeParams: {
          operationID: input.operationID,
          ...(input.conversationID ? { conversationID: input.conversationID } : {}),
          fileID: input.fileID,
        },
        retryable: false,
        diagnosticCode: "lcm_file_exploration_unauthorized",
      })

    const exploreFileInner = Effect.fn("LcmRuntime.exploreFile")(function* (input: {
      sessionID: string
      fileID: LcmFileID
      abortSignal?: AbortSignal
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    }) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_file_exploration_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scope = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.catch((error) => Effect.fail(error)),
      )
      const row = yield* familyDb.executeForeground({
        operationID,
        purpose: "large_file",
        abortSignal: input.abortSignal,
        run: (db) => loadLargeFileRow(db as PGlite, input.fileID),
      })
      if (!row) {
        return {
          ok: false,
          error: createLcmSafeError({
            code: "not_found",
            templateKey: "lcm.auth.denied",
            safeParams: { operationID, conversationID: scope.conversationID, fileID: input.fileID },
            retryable: false,
            diagnosticCode: "lcm_file_exploration_not_found",
          }),
        } satisfies LcmToolErrorResult
      }
      if (!scope.allowedConversationIDs.includes(row.conversation_id)) {
        return {
          ok: false,
          error: unauthorizedFile({ operationID, conversationID: scope.conversationID, fileID: input.fileID }),
        } satisfies LcmToolErrorResult
      }

      yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: "queued",
        explorerKind: "none",
        lcmDbService: familyDb,
      })
      yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: "running",
        explorerKind: "none",
        lcmDbService: familyDb,
      })

      const cfg = yield* getResolved()
      const providerID = input.providerID
      const modelID = input.modelID
      const model =
        provider && providerID && modelID
          ? yield* provider
              .getModel(ProviderID.make(providerID), ModelID.make(modelID))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      let languagePromise: Promise<LanguageModelV3> | undefined
      const outcome: LcmFileExplorationOutcome = yield* Effect.tryPromise({
        try: () =>
          exploreLargeFileRow({
            row,
            artifactRoot: resolveLcmDbLayout(dbResult.db.dataDir).artifactsDir,
            operationID,
            abortSignal: input.abortSignal,
            permissionCheck: input.checkPathPermission,
            limits: {
              sampleBytes: cfg.largePayloads.explorationSampleBytes,
              maxFullLoadBytes: cfg.largePayloads.explorationMaxFullLoadBytes,
              maxOutputTokens: cfg.largePayloads.explorationMaxOutputTokens,
            },
            generator:
              provider && model && providerID && modelID
                ? async ({ prompt, request, abortSignal }) => {
                    const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
                    const generated = await runProviderGeneration(
                      model,
                      "background",
                      operationID,
                      () =>
                        generateText({
                          model: language,
                          temperature: model.capabilities.temperature ? 0 : undefined,
                          providerOptions: ProviderTransform.providerOptions(model, model.options),
                          maxOutputTokens: cfg.largePayloads.explorationMaxOutputTokens,
                          maxRetries: 0,
                          messages: lcmGenerationMessages({ prompt, request }),
                        }),
                      { abortSignal: abortSignal ?? input.abortSignal },
                    )
                    return {
                      text: generated.text,
                      usage: providerUsageFromGeneration({
                        usage: generated.usage,
                        providerID,
                        modelID,
                      }),
                    }
                  }
                : undefined,
          }),
        catch: () =>
          createLcmSafeError({
            code: "invalid_request",
            templateKey: "lcm.request.invalid",
            safeParams: { operationID },
            retryable: false,
            diagnosticCode: "lcm_file_exploration_failed",
          }),
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            fileID: input.fileID,
            conversationID: row.conversation_id,
            explorationStatus: error.code === "canceled" ? "canceled" : "failed",
            explorerKind: "unknown",
            safeReason: error.code === "canceled" ? "canceled" : "helper_failed",
            sampled: false,
            sampleBytes: 0,
          } as LcmFileExplorationOutcome),
        ),
      )

      let usageRecordID: string | undefined
      if (outcome.promptVersion) {
        const usage = yield* writeUsageRecord({
          sessionID: input.sessionID,
          conversationID: scope.conversationID,
          jobID: operationID,
          purpose: "file_exploration",
          mode: "explicit_exploration",
          providerID: outcome.usage?.providerID ?? providerID,
          modelID: outcome.usage?.modelID ?? modelID,
          inputTokens: outcome.usage?.inputTokens,
          outputTokens: outcome.usage?.outputTokens,
          cacheReadTokens: outcome.usage?.cacheReadTokens,
          cacheWriteTokens: outcome.usage?.cacheWriteTokens,
          costAmount: outcome.usage?.costAmount,
          costCurrency: outcome.usage?.costCurrency,
          costStatus: outcome.usage?.costStatus ?? "unknown",
        }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        usageRecordID = usage?.usageRecordID
      }

      const finalStatus = yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: outcome.explorationStatus,
        explorerKind: outcome.explorerKind,
        safeReason: outcome.safeReason,
        sampled: outcome.sampled,
        sampleBytes: outcome.sampleBytes,
        summaryText: outcome.summaryText ?? null,
        promptVersion: outcome.promptVersion ?? null,
        usageRecordID: usageRecordID ?? null,
        lcmDbService: familyDb,
      })
      return (
        finalStatus ??
        ({
          ok: false,
          error: unauthorizedFile({ operationID, conversationID: scope.conversationID, fileID: input.fileID }),
        } satisfies LcmToolErrorResult)
      )
    })

    const exploreFile = (input: {
      sessionID: string
      fileID: LcmFileID
      abortSignal?: AbortSignal
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    }) =>
      exploreFileInner(input).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : createLcmSafeError({
                  code: "invalid_request",
                  templateKey: "lcm.request.invalid",
                  safeParams: {},
                  retryable: false,
                  diagnosticCode: "lcm_file_exploration_unhandled",
                }),
          } satisfies LcmToolErrorResult),
        ),
      )

    const llmMap = Effect.fn("LcmRuntime.llmMap")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        sourceToolCallID?: string
        checkPathPermission?: LcmPathPermissionCheck
        providerID?: string
        modelID?: string
      } & LlmMapInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      const resolvedEffect = resolveMapModel({
        selection: input.model,
        providerID: input.providerID,
        modelID: input.modelID,
        operationID,
        conversationID: scope.conversationID,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_model_resolution_failed", { operationID }),
          }),
          onSuccess: (resolved) => ({ ok: true as const, resolved }),
        }),
      )
      const resolvedResult = yield* resolvedEffect
      if (!resolvedResult.ok) return { ok: false, error: resolvedResult.error } satisfies LcmToolErrorResult
      const resolved = resolvedResult.resolved
      const workers = yield* Effect.promise(() =>
        resolveRuntimeMapWorkers({
          toolKind: "llm_map",
          mapInput: input,
          resolved,
        }),
      )
      const modelLimits = resolveLcmModelLimits(resolved.model)

      let languagePromise: Promise<LanguageModelV3> | undefined
      const mapEffect = LcmMap.llmMap({
        ...input,
        workers,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
        modelSelection: resolved.modelSelection,
        generator: async ({ prompt, request }) => {
          const language = await (languagePromise ??= Effect.runPromise(provider!.getLanguage(resolved.model)))
          const generated = await runProviderGeneration(
            resolved.model,
            "background",
            operationID,
            () =>
              generateText({
                model: language,
                temperature: resolved.model.capabilities.temperature ? 0 : undefined,
                providerOptions: ProviderTransform.providerOptions(resolved.model, resolved.model.options),
                maxOutputTokens: Math.min(
                  modelLimits.output ?? ProviderTransform.maxOutputTokens(resolved.model),
                  4096,
                ),
                maxRetries: 0,
                abortSignal: input.abortSignal,
                messages: lcmGenerationMessages({ prompt, request }),
              }),
            { abortSignal: input.abortSignal },
          )
          return {
            text: generated.text,
            usage: providerUsageFromGeneration({
              usage: generated.usage,
              providerID: resolved.modelSelection.providerID,
              modelID: resolved.modelSelection.modelID,
            }),
          }
        },
        permissionCheck: input.checkPathPermission,
        recordUsage: async (usageInput) => {
          await Effect.runPromise(
            writeUsageRecord({
              sessionID: usageInput.sessionID,
              conversationID: usageInput.conversationID,
              jobID: usageInput.jobID,
              purpose: "llm_map",
              mode: "map_item",
              providerID: usageInput.usage.providerID,
              modelID: usageInput.usage.modelID,
              inputTokens: usageInput.usage.inputTokens,
              outputTokens: usageInput.usage.outputTokens,
              cacheReadTokens: usageInput.usage.cacheReadTokens,
              cacheWriteTokens: usageInput.usage.cacheWriteTokens,
              costAmount: usageInput.usage.costAmount,
              costCurrency: usageInput.usage.costCurrency,
              costStatus: usageInput.usage.costStatus,
            }).pipe(Effect.catch(() => Effect.void)),
          )
        },
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
      const result = yield* mapEffect
      return result
    })

    const agenticMap = Effect.fn("LcmRuntime.agenticMap")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        sourceToolCallID?: string
        checkPathPermission?: LcmPathPermissionCheck
        providerID?: string
        modelID?: string
        childRunner: AgenticMapChildRunner
      } & AgenticMapInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_agentic_map_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      const resolvedResult = yield* resolveMapModel({
        selection: input.model,
        providerID: input.providerID,
        modelID: input.modelID,
        operationID,
        conversationID: scope.conversationID,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_model_resolution_failed", { operationID }),
          }),
          onSuccess: (resolved) => ({ ok: true as const, resolved }),
        }),
      )
      if (!resolvedResult.ok) return { ok: false, error: resolvedResult.error } satisfies LcmToolErrorResult
      const workers = yield* Effect.promise(() =>
        resolveRuntimeMapWorkers({
          toolKind: "agentic_map",
          mapInput: input,
          resolved: resolvedResult.resolved,
        }),
      )

      return yield* LcmMap.agenticMap({
        ...input,
        workers,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
        modelSelection: resolvedResult.resolved.modelSelection,
        permissionCheck: input.checkPathPermission,
        childRunner: input.childRunner,
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const mapStatus = Effect.fn("LcmRuntime.mapStatus")(function* (
      input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_status_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_status_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      return yield* LcmMap.mapStatus({
        mapID: input.mapID,
        sessionID: input.sessionID,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_status_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const mapCancel = Effect.fn("LcmRuntime.mapCancel")(function* (
      input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_cancel_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_cancel_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      return yield* LcmMap.mapCancel({
        mapID: input.mapID,
        sessionID: input.sessionID,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_cancel_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const closeRuntime = Effect.fn("LcmRuntime.close")(function* () {
      const running = yield* Effect.sync(() => {
        const running: Promise<void>[] = []
        for (const deferred of deferredSoftMaintenanceRetries.values()) {
          if (deferred.timer) clearTimeout(deferred.timer)
          else if (deferred.running) running.push(deferred.running)
        }
        softSummaryBackoffs.clear()
        return running
      })
      if (running.length) {
        yield* Effect.promise(() =>
          Promise.race([
            Promise.allSettled(running),
            new Promise<void>((resolve) => setTimeout(resolve, LCM_DEFERRED_MAINTENANCE_CLOSE_GRACE_MS)),
          ]),
        ).pipe(Effect.catch(() => Effect.void))
      }
      yield* Effect.sync(() => deferredSoftMaintenanceRetries.clear())
      yield* Effect.promise(() => mapScheduler.shutdown({ operationID: createOperationID() })).pipe(
        Effect.catch(() => Effect.void),
      )
      childSlots.clear()
      yield* lcmDb.close()
    })

    yield* Effect.addFinalizer(() => closeRuntime().pipe(Effect.ignore))

    return Service.of({
      getCapabilities,
      getOrCreateConversation,
      getOrCreateChildConversation,
      acquireChildSessionSlot,
      syncFinalizedMessages: (input) =>
        Effect.gen(function* () {
          const settings = yield* effectiveSettings({ sessionID: input.sessionID })
          return yield* syncFinalizedSourceMessages({ ...input, strategy: settings.state.strategy }).pipe(
            Effect.provideService(LcmDb.Service, lcmDb),
          )
        }),
      admitPathBackedFile,
      preflightBeforeModel,
      queueSoftMaintenanceAfterTurn,
      cancelDeferredMaintenance,
      diagnoseDb,
      rebuildDb,
      exportPrompts,
      finalizeProviderRequestSnapshot: (input) =>
        Effect.gen(function* () {
          if (input.sessionID) {
            const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
            return yield* ready.lcmDb.executeForeground({
              operationID: createOperationID(),
              purpose: "assembly",
              run: (db) =>
                finalizeProviderRequestSnapshotRow({
                  db: db as PGlite,
                  requestSnapshotID: input.requestSnapshotID,
                  status: input.status,
                  conversationID: input.conversationID,
                  nowMs: input.nowMs,
                }),
            })
          }
          if (!lcmContext) {
            return yield* Effect.fail(invalidRequest("lcm_provider_request_snapshot_context_missing"))
          }
          return yield* lcmContext.finalizeProviderRequestSnapshot(input)
        }),
      recordProviderRequestSnapshotFinalValidation: (input) =>
        Effect.gen(function* () {
          if (input.sessionID) {
            const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
            return yield* ready.lcmDb.executeForeground({
              operationID: createOperationID(),
              purpose: "assembly",
              run: (db) =>
                recordProviderRequestSnapshotFinalValidationRow({
                  db: db as PGlite,
                  requestSnapshotID: input.requestSnapshotID,
                  providerValidatorHash: input.providerValidatorHash,
                  providerFamily: input.providerFamily,
                  providerTransformOverheadTokenCount: input.providerTransformOverheadTokenCount,
                  conversationID: input.conversationID,
                }),
            })
          }
          if (!lcmContext) {
            return yield* Effect.fail(invalidRequest("lcm_provider_request_snapshot_context_missing"))
          }
          return yield* lcmContext.recordProviderRequestSnapshotFinalValidation(input)
        }),
      runManualMaintenance,
      getSettingsState,
      updateSettings,
      handleSessionDeleted,
      recordUsage: writeUsageRecord,
      getConversationScope,
      grep: (input) => LcmRetrieval.grep(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      describe: (input) => LcmRetrieval.describe(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      expand: (input) => LcmRetrieval.expand(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      expandQuery,
      read: (input) =>
        Effect.gen(function* () {
          const result = yield* LcmRetrieval.read(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
          yield* publishReadFileStatus({ sessionID: input.sessionID, result })
          return result
        }),
      exploreFile,
      llmMap,
      agenticMap,
      mapStatus,
      mapCancel,
      close: () => closeRuntime(),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Provider.defaultLayer),
  Layer.provide(LcmContext.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(LcmDb.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Bus.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export function getCapabilities(input: { sessionID: string }) {
  return runPromise((svc) => svc.getCapabilities(input))
}

export function getSettingsState(input: { sessionID?: string; projectID?: string; workspaceID?: string }) {
  return runPromise((svc) => svc.getSettingsState(input))
}

export function updateSettings(input: LcmUpdateSettingsInput) {
  return runPromise((svc) => svc.updateSettings(input))
}

export function getOrCreateConversation(input: { sessionID: string; parentSessionID?: string }) {
  return runPromise((svc) => svc.getOrCreateConversation(input))
}

export function getOrCreateChildConversation(input: Omit<LcmChildConversationInput, "dataDir">) {
  return runPromise((svc) => svc.getOrCreateChildConversation(input))
}

export function syncFinalizedMessages(input: { sessionID: string; upToMessageID?: string }) {
  return runPromise((svc) => svc.syncFinalizedMessages(input))
}

export function handleSessionDeleted(input: { sessionID: string; recursive: boolean }) {
  return runPromise((svc) => svc.handleSessionDeleted(input))
}

export function runManualMaintenance(input: LcmManualMaintenanceInput) {
  return runPromise((svc) => svc.runManualMaintenance(input))
}

export function queueSoftMaintenanceAfterTurn(input: LcmSoftMaintenanceAfterTurnInput) {
  return runPromise((svc) => svc.queueSoftMaintenanceAfterTurn(input))
}

export function cancelDeferredMaintenance(input: LcmCancelDeferredMaintenanceInput) {
  return runPromise((svc) => svc.cancelDeferredMaintenance(input))
}

export function diagnoseDb(input: { sessionID: string }) {
  return runPromise((svc) => svc.diagnoseDb(input))
}

export function rebuildDb(input: { sessionID: string; dryRun: boolean }) {
  return runPromise((svc) => svc.rebuildDb(input))
}

export function exportPrompts(input: { sessionID: string; workspaceRoot: string }) {
  return runPromise((svc) => svc.exportPrompts(input))
}

export function writeUsageRecord(input: unknown) {
  return runPromise((svc) => svc.recordUsage(input))
}

export function grep(input: { sessionID: string; abortSignal?: AbortSignal } & LcmGrepInput) {
  return runPromise((svc) => svc.grep(input))
}

export function describe(input: { sessionID: string; abortSignal?: AbortSignal } & LcmDescribeInput) {
  return runPromise((svc) => svc.describe(input))
}

export function expand(input: { sessionID: string; abortSignal?: AbortSignal } & LcmExpandInput) {
  return runPromise((svc) => svc.expand(input))
}

export function exploreFile(input: {
  sessionID: string
  fileID: LcmFileID
  abortSignal?: AbortSignal
  checkPathPermission?: LcmPathPermissionCheck
  providerID?: string
  modelID?: string
}) {
  return runPromise((svc) => svc.exploreFile(input))
}

export function llmMap(
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
  } & LlmMapInput,
) {
  return runPromise((svc) => svc.llmMap(input))
}

export function agenticMap(
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
    childRunner: AgenticMapChildRunner
  } & AgenticMapInput,
) {
  return runPromise((svc) => svc.agenticMap(input))
}

export function mapStatus(input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput) {
  return runPromise((svc) => svc.mapStatus(input))
}

export function mapCancel(input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput) {
  return runPromise((svc) => svc.mapCancel(input))
}

export function close() {
  return runPromise((svc) => svc.close())
}

export * as LcmRuntime from "./runtime"
