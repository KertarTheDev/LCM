// kilocode_change - new file
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Effect, Schema } from "effect"
import { isLcmSafeError } from "./db-errors"
import {
  LCM_SAFE_ACTIONS,
  LCM_SAFE_ERROR_CODES,
  LCM_SAFE_MESSAGE_TEMPLATES,
  normalizeLcmSafeError,
  type ConversationID,
  type ISO8601,
  type LcmMaintenanceEventPayload,
  type LcmContextUpdatedEventPayload,
  type LcmDbStatus,
  type LcmDbStatusEventPayload,
  type LcmEventEnvelope,
  type LcmEventName,
  type LcmFileStatus,
  type LcmFileStatusEventPayload,
  type LcmMaintenanceResult,
  type LcmMetricsSnapshot,
  type LcmSafeError,
  type LcmSafeMessageTemplateKey,
  type LcmStrategy,
  type LcmLifecycleState,
  type OperationID,
  type SessionID,
} from "./types"

export const LCM_BLOCKING_MAINTENANCE_LABEL = "Preparing memory for this response..."
export const LCM_BLOCKING_LEAF_MAINTENANCE_LABEL = "Summarizing older memory..."
export const LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL = "Merging memory summaries..."
export const LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL = "Archiving older memory..."
export const LCM_PREFLIGHT_STORAGE_LABEL = "Opening memory..."
export const LCM_PREFLIGHT_SYNC_LABEL = "Syncing memory..."
export const LCM_PREFLIGHT_REBUILD_LABEL = "Rebuilding memory context..."
export const LCM_PREFLIGHT_RETRIEVAL_LABEL = "Finding relevant memory..."
export const LCM_PREFLIGHT_BUDGET_LABEL = "Checking memory size..."
export const LCM_PREFLIGHT_ASSEMBLY_LABEL = "Preparing memory for the model..."
export const LCM_PROMPT_PREPARATION_LABELS = [
  LCM_BLOCKING_MAINTENANCE_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL,
  LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL,
  LCM_PREFLIGHT_STORAGE_LABEL,
  LCM_PREFLIGHT_SYNC_LABEL,
  LCM_PREFLIGHT_REBUILD_LABEL,
  LCM_PREFLIGHT_RETRIEVAL_LABEL,
  LCM_PREFLIGHT_BUDGET_LABEL,
  LCM_PREFLIGHT_ASSEMBLY_LABEL,
] as const
export const LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL = "Memory maintenance scheduled."
export const LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL = "Summarizing memory in background..."

const LcmLifecycleStateSchema = Schema.Literals([
  "passive_synced",
  "lcm_active",
  "legacy_read_only",
  "recovery_required",
  "recovery_failed",
  "db_unavailable",
])
const LcmBudgetStatusSchema = Schema.Literals(["budgeted", "unavailable", "provider_limit_fallback"])
const LcmStrategySchema = Schema.Literals(["upward", "dolt"])
const LcmDbStatusCodeSchema = Schema.Literals([
  "uninitialized",
  "starting",
  "ready",
  "migrating",
  "locked",
  "corrupt",
  "unavailable",
  "closed",
])
const LcmMaintenanceReasonSchema = Schema.Literals(["manual", "soft_threshold", "hard_limit", "repair"])
const LcmMaintenanceStatusSchema = Schema.Literals([
  "healthy",
  "scheduled",
  "completed",
  "no_op",
  "deferred",
  "skipped",
  "failed",
  "canceled",
  "recovery_required",
])
const LcmMaintenanceEventStatusSchema = Schema.Literals([
  "started",
  "scheduled",
  "completed",
  "no_op",
  "deferred",
  "skipped",
  "canceled",
  "failed",
  "recovery_required",
])
const LcmSoftSweepStopReasonSchema = Schema.Literals([
  "completed",
  "iteration_cap",
  "elapsed_cap",
  "canceled",
  "provider_capacity",
  "backoff",
  "no_work",
  "failed",
])
const LcmSummaryBackoffPurposeSchema = Schema.Literals(["leaf_summary", "condensation", "hard_limit_maintenance"])
const LcmFileSourceKindSchema = Schema.Literals(["path", "inline", "image", "tool_output", "map_input", "map_output"])
const LcmFileStaleStateSchema = Schema.Literals([
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
const LcmFileExplorationStatusSchema = Schema.Literals([
  "not_started",
  "queued",
  "running",
  "completed",
  "sampled",
  "unavailable",
  "unsafe",
  "corrupt",
  "timeout",
  "over_limit",
  "canceled",
  "failed",
])
const LcmFileExplorerKindSchema = Schema.Literals(["none", "text", "html", "pdf", "image", "sqlite", "unknown"])
const LcmFileStatusReasonSchema = Schema.Literals([
  "none",
  "sampled",
  "unsupported_type",
  "missing_helper",
  "unsafe_active_content",
  "corrupt_input",
  "timeout",
  "over_limit",
  "canceled",
  "helper_failed",
  "stale_source",
  "permission_denied",
  "artifact_invalid",
])
const LcmSafeParamValueSchema = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
const LcmSafeErrorSchema = Schema.Struct({
  code: Schema.Literals(LCM_SAFE_ERROR_CODES),
  templateKey: Schema.Literals(
    Object.keys(LCM_SAFE_MESSAGE_TEMPLATES) as [LcmSafeMessageTemplateKey, ...LcmSafeMessageTemplateKey[]],
  ),
  safeParams: Schema.Record(Schema.String, LcmSafeParamValueSchema),
  safeMessage: Schema.String,
  action: Schema.optional(Schema.Literals(LCM_SAFE_ACTIONS)),
  retryable: Schema.Boolean,
  operationID: Schema.optional(Schema.String),
  conversationID: Schema.optional(Schema.String),
  summaryID: Schema.optional(Schema.String),
  fileID: Schema.optional(Schema.String),
  diagnosticCode: Schema.optional(Schema.String),
})

function lcmEventEnvelopeSchema<TPayload extends Schema.Top>(type: LcmEventName, payload: TPayload) {
  return Schema.Struct({
    type: Schema.Literal(type),
    sessionID: Schema.optional(Schema.String),
    conversationID: Schema.optional(Schema.String),
    operationID: Schema.optional(Schema.String),
    timestamp: Schema.String,
    payload,
  })
}

const LcmDbStatusEventPayloadSchema = Schema.Struct({
  status: LcmDbStatusCodeSchema,
  schemaVersion: Schema.optional(Schema.Number),
  lifecycleState: Schema.optional(LcmLifecycleStateSchema),
  dbReady: Schema.Boolean,
  safeError: Schema.optional(LcmSafeErrorSchema),
})
const LcmContextUpdatedEventPayloadSchema = Schema.Struct({
  lifecycleState: LcmLifecycleStateSchema,
  strategy: LcmStrategySchema,
  activeTokens: Schema.optional(Schema.Number),
  hardLimit: Schema.optional(Schema.Number),
  softThreshold: Schema.optional(Schema.Number),
  freshTailTokens: Schema.optional(Schema.Number),
  softBacklogTokens: Schema.optional(Schema.Number),
  softBacklogItemCount: Schema.optional(Schema.Number),
  freshTailRawTokens: Schema.optional(Schema.Number),
  freshTailRawItemCount: Schema.optional(Schema.Number),
  unconsumedRawTokens: Schema.optional(Schema.Number),
  unconsumedRawItemCount: Schema.optional(Schema.Number),
  protectedTailRawTokens: Schema.optional(Schema.Number),
  protectedTailRawItemCount: Schema.optional(Schema.Number),
  rawLaneTokens: Schema.optional(Schema.Number),
  hardFillRatio: Schema.optional(Schema.Number),
  rawLaneRatio: Schema.optional(Schema.Number),
  softBacklogRatio: Schema.optional(Schema.Number),
  softBacklogLargestSourceTokens: Schema.optional(Schema.Number),
  budgetStatus: Schema.optional(LcmBudgetStatusSchema),
  softPressureReason: Schema.optional(
    Schema.Literals(["global_soft_threshold", "below_soft_raw_backlog", "lane_latch"]),
  ),
  laneLatchDiagnostics: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  contextItemCounts: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  reason: Schema.Literals(["sync", "rebuild", "maintenance", "large_file_marker", "retrieval_cue", "recovery"]),
})
const LcmMaintenanceEventPayloadSchema = Schema.Struct({
  phase: Schema.Literals(["leaf_summary", "condensation", "hard_limit", "deterministic_fallback", "repair"]),
  reason: LcmMaintenanceReasonSchema,
  status: LcmMaintenanceEventStatusSchema,
  blocking: Schema.Boolean,
  beforeTokens: Schema.optional(Schema.Number),
  afterTokens: Schema.optional(Schema.Number),
  hardLimit: Schema.optional(Schema.Number),
  softThreshold: Schema.optional(Schema.Number),
  freshTailTokens: Schema.optional(Schema.Number),
  softBacklogTokens: Schema.optional(Schema.Number),
  softBacklogItemCount: Schema.optional(Schema.Number),
  freshTailRawTokens: Schema.optional(Schema.Number),
  freshTailRawItemCount: Schema.optional(Schema.Number),
  unconsumedRawTokens: Schema.optional(Schema.Number),
  unconsumedRawItemCount: Schema.optional(Schema.Number),
  protectedTailRawTokens: Schema.optional(Schema.Number),
  protectedTailRawItemCount: Schema.optional(Schema.Number),
  rawLaneTokens: Schema.optional(Schema.Number),
  rawLaneRatio: Schema.optional(Schema.Number),
  softBacklogRatio: Schema.optional(Schema.Number),
  softBacklogLargestSourceTokens: Schema.optional(Schema.Number),
  afterSoftBacklogTokens: Schema.optional(Schema.Number),
  afterSoftBacklogItemCount: Schema.optional(Schema.Number),
  providerCapacityDeferred: Schema.optional(Schema.Boolean),
  providerEndpointKeyHash: Schema.optional(Schema.String),
  softPressureReason: Schema.optional(
    Schema.Literals(["global_soft_threshold", "below_soft_raw_backlog", "lane_latch"]),
  ),
  laneLatchDiagnostics: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  tokenCounterMode: Schema.optional(Schema.Literals(["provider", "deterministic_fallback", "fake"])),
  tokenCounterVersion: Schema.optional(Schema.String),
  sweepPassesCompleted: Schema.optional(Schema.Number),
  sweepMaxPasses: Schema.optional(Schema.Number),
  sweepElapsedMs: Schema.optional(Schema.Number),
  sweepMaxElapsedMs: Schema.optional(Schema.Number),
  sweepStopReason: Schema.optional(LcmSoftSweepStopReasonSchema),
  summaryPromptVersion: Schema.optional(Schema.String),
  summaryBackoffPurpose: Schema.optional(LcmSummaryBackoffPurposeSchema),
  summaryBackoffFailureCount: Schema.optional(Schema.Number),
  summaryBackoffDelayMs: Schema.optional(Schema.Number),
  summaryBackoffRemainingMs: Schema.optional(Schema.Number),
  summariesCreated: Schema.optional(Schema.Number),
  contextItemsReplaced: Schema.optional(Schema.Number),
  safeLabel: Schema.optional(Schema.String),
  safeError: Schema.optional(LcmSafeErrorSchema),
})
const LcmFileStatusEventPayloadSchema = Schema.Struct({
  fileID: Schema.String,
  sourceKind: LcmFileSourceKindSchema,
  staleState: LcmFileStaleStateSchema,
  explorationStatus: LcmFileExplorationStatusSchema,
  explorerKind: LcmFileExplorerKindSchema,
  sampled: Schema.Boolean,
  sampleBytes: Schema.optional(Schema.Number),
  blockingUse: Schema.Boolean,
  safeReason: Schema.optional(LcmFileStatusReasonSchema),
  safeError: Schema.optional(LcmSafeErrorSchema),
})
const LcmMetricsSnapshotSchema = Schema.Struct({
  conversationID: Schema.String,
  lifecycleState: LcmLifecycleStateSchema,
  strategy: LcmStrategySchema,
  activeTokens: Schema.Number,
  hardLimit: Schema.Number,
  softThreshold: Schema.Number,
  freshTailTokens: Schema.Number,
  softBacklogTokens: Schema.Number,
  softBacklogItemCount: Schema.Number,
  freshTailRawTokens: Schema.Number,
  freshTailRawItemCount: Schema.Number,
  unconsumedRawTokens: Schema.Number,
  unconsumedRawItemCount: Schema.Number,
  protectedTailRawTokens: Schema.Number,
  protectedTailRawItemCount: Schema.Number,
  rawLaneTokens: Schema.Number,
  hardFillRatio: Schema.optional(Schema.Number),
  rawLaneRatio: Schema.optional(Schema.Number),
  softBacklogRatio: Schema.optional(Schema.Number),
  softBacklogLargestSourceTokens: Schema.optional(Schema.Number),
  budgetStatus: Schema.optional(LcmBudgetStatusSchema),
  softPressureReason: Schema.optional(
    Schema.Literals(["global_soft_threshold", "below_soft_raw_backlog", "lane_latch"]),
  ),
  laneLatchDiagnostics: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  providerContextLimit: Schema.optional(Schema.Number),
  providerInputLimit: Schema.optional(Schema.Number),
  providerOutputLimit: Schema.optional(Schema.Number),
  outputReserve: Schema.optional(Schema.Number),
  systemPromptTokens: Schema.optional(Schema.Number),
  toolSchemaTokens: Schema.optional(Schema.Number),
  providerCapacityDeferred: Schema.optional(Schema.Boolean),
  providerEndpointKeyHash: Schema.optional(Schema.String),
  tokenCounterMode: Schema.Literals(["provider", "deterministic_fallback", "fake"]),
  tokenCounterVersion: Schema.String,
  laneTokens: Schema.Record(Schema.String, Schema.Number),
  contextItemCounts: Schema.Record(Schema.String, Schema.Number),
  deferredSoftMaintenanceQueued: Schema.Boolean,
  deferredSoftMaintenanceQueuedCount: Schema.Number,
  deferredSoftMaintenanceAttemptCount: Schema.optional(Schema.Number),
  deferredSoftMaintenanceNextRunAtMs: Schema.optional(Schema.Number),
  storageBytes: Schema.Number,
  storageWarningThresholdBytes: Schema.Number,
  storageWarning: Schema.Boolean,
  memoryMaintenanceCostTotal: Schema.optional(Schema.Number),
  retrievalCostTotal: Schema.optional(Schema.Number),
  fileExplorationCostTotal: Schema.optional(Schema.Number),
  mapCostTotal: Schema.optional(Schema.Number),
  currency: Schema.optional(Schema.String),
  lastMaintenance: Schema.optional(
    Schema.Struct({
      operationID: Schema.String,
      status: LcmMaintenanceStatusSchema,
      reason: LcmMaintenanceReasonSchema,
      blocking: Schema.Boolean,
      beforeTokens: Schema.optional(Schema.Number),
      afterTokens: Schema.optional(Schema.Number),
    }),
  ),
  updatedAt: Schema.String,
})
const LcmDbStatusEventEnvelope = lcmEventEnvelopeSchema("lcm.db.status", LcmDbStatusEventPayloadSchema)
const LcmContextUpdatedEventEnvelope = lcmEventEnvelopeSchema(
  "lcm.context.updated",
  LcmContextUpdatedEventPayloadSchema,
)
const LcmMetricsUpdatedEventEnvelope = lcmEventEnvelopeSchema("lcm.metrics.updated", LcmMetricsSnapshotSchema)
const LcmFileStatusEventEnvelope = lcmEventEnvelopeSchema("lcm.file.status", LcmFileStatusEventPayloadSchema)
const LcmMaintenanceStartedEventEnvelope = lcmEventEnvelopeSchema(
  "lcm.maintenance.started",
  LcmMaintenanceEventPayloadSchema,
)
const LcmMaintenanceEndedEventEnvelope = lcmEventEnvelopeSchema(
  "lcm.maintenance.ended",
  LcmMaintenanceEventPayloadSchema,
)
const LcmMaintenanceFailedEventEnvelope = lcmEventEnvelopeSchema(
  "lcm.maintenance.failed",
  LcmMaintenanceEventPayloadSchema,
)

export const Event = {
  DbStatus: BusEvent.define("lcm.db.status", LcmDbStatusEventEnvelope),
  ContextUpdated: BusEvent.define("lcm.context.updated", LcmContextUpdatedEventEnvelope),
  MetricsUpdated: BusEvent.define("lcm.metrics.updated", LcmMetricsUpdatedEventEnvelope),
  FileStatus: BusEvent.define("lcm.file.status", LcmFileStatusEventEnvelope),
  MaintenanceStarted: BusEvent.define("lcm.maintenance.started", LcmMaintenanceStartedEventEnvelope),
  MaintenanceEnded: BusEvent.define("lcm.maintenance.ended", LcmMaintenanceEndedEventEnvelope),
  MaintenanceFailed: BusEvent.define("lcm.maintenance.failed", LcmMaintenanceFailedEventEnvelope),
} as const

const eventByName = {
  "lcm.db.status": Event.DbStatus,
  "lcm.context.updated": Event.ContextUpdated,
  "lcm.metrics.updated": Event.MetricsUpdated,
  "lcm.file.status": Event.FileStatus,
  "lcm.maintenance.started": Event.MaintenanceStarted,
  "lcm.maintenance.ended": Event.MaintenanceEnded,
  "lcm.maintenance.failed": Event.MaintenanceFailed,
} satisfies Record<LcmEventName, BusEvent.Definition>

function nowISO(): ISO8601 {
  return new Date().toISOString()
}

function normalizeForOutput<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => normalizeForOutput(item)) as T
  if (!value || typeof value !== "object") return value
  if (isLcmSafeError(value)) return normalizeLcmSafeError(value) as T

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    output[key] = normalizeForOutput(nested)
  }
  return output as T
}

export function createLcmEventEnvelope<TPayload>(input: {
  type: LcmEventName
  sessionID?: SessionID
  conversationID?: ConversationID
  operationID?: OperationID
  timestamp?: ISO8601
  payload: TPayload
}): LcmEventEnvelope<TPayload> {
  return {
    type: input.type,
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.conversationID ? { conversationID: input.conversationID } : {}),
    ...(input.operationID ? { operationID: input.operationID } : {}),
    timestamp: input.timestamp ?? nowISO(),
    payload: normalizeForOutput(input.payload),
  }
}

export function createLcmDbStatusEvent(input: {
  status: LcmDbStatus
  sessionID?: SessionID
  conversationID?: ConversationID
  operationID?: OperationID
  lifecycleState?: LcmLifecycleState
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmDbStatusEventPayload>({
    type: "lcm.db.status",
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    timestamp: input.timestamp,
    payload: {
      status: input.status.status,
      schemaVersion: input.status.schemaVersion,
      lifecycleState: input.lifecycleState,
      dbReady: input.status.status === "ready",
      safeError: input.status.safeError,
    },
  })
}

export function createLcmContextUpdatedEvent(input: {
  sessionID?: SessionID
  conversationID: ConversationID
  lifecycleState: LcmLifecycleState
  strategy: LcmStrategy
  reason: LcmContextUpdatedEventPayload["reason"]
  activeTokens?: number
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  hardFillRatio?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  softBacklogLargestSourceTokens?: number
  budgetStatus?: LcmContextUpdatedEventPayload["budgetStatus"]
  softPressureReason?: LcmContextUpdatedEventPayload["softPressureReason"]
  laneLatchDiagnostics?: LcmContextUpdatedEventPayload["laneLatchDiagnostics"]
  contextItemCounts?: LcmContextUpdatedEventPayload["contextItemCounts"]
  operationID?: OperationID
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmContextUpdatedEventPayload>({
    type: "lcm.context.updated",
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    timestamp: input.timestamp,
    payload: {
      lifecycleState: input.lifecycleState,
      strategy: input.strategy,
      reason: input.reason,
      activeTokens: input.activeTokens,
      hardLimit: input.hardLimit,
      softThreshold: input.softThreshold,
      freshTailTokens: input.freshTailTokens,
      softBacklogTokens: input.softBacklogTokens,
      softBacklogItemCount: input.softBacklogItemCount,
      freshTailRawTokens: input.freshTailRawTokens,
      freshTailRawItemCount: input.freshTailRawItemCount,
      unconsumedRawTokens: input.unconsumedRawTokens,
      unconsumedRawItemCount: input.unconsumedRawItemCount,
      protectedTailRawTokens: input.protectedTailRawTokens,
      protectedTailRawItemCount: input.protectedTailRawItemCount,
      rawLaneTokens: input.rawLaneTokens,
      hardFillRatio: input.hardFillRatio,
      rawLaneRatio: input.rawLaneRatio,
      softBacklogRatio: input.softBacklogRatio,
      softBacklogLargestSourceTokens: input.softBacklogLargestSourceTokens,
      budgetStatus: input.budgetStatus,
      softPressureReason: input.softPressureReason,
      laneLatchDiagnostics: input.laneLatchDiagnostics,
      contextItemCounts: input.contextItemCounts,
    },
  })
}

export function createLcmMetricsUpdatedEvent(input: {
  sessionID?: SessionID
  conversationID?: ConversationID
  operationID?: OperationID
  metrics: LcmMetricsSnapshot
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmMetricsSnapshot>({
    type: "lcm.metrics.updated",
    sessionID: input.sessionID,
    conversationID: input.conversationID ?? input.metrics.conversationID,
    operationID: input.operationID,
    timestamp: input.timestamp,
    payload: input.metrics,
  })
}

export function createLcmFileStatusEvent(input: {
  sessionID?: SessionID
  conversationID?: ConversationID
  operationID?: OperationID
  status: LcmFileStatus
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmFileStatusEventPayload>({
    type: "lcm.file.status",
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    timestamp: input.timestamp,
    payload: {
      fileID: input.status.fileID,
      sourceKind: input.status.sourceKind,
      staleState: input.status.staleState,
      explorationStatus: input.status.explorationStatus,
      explorerKind: input.status.explorerKind,
      sampled: input.status.sampled,
      sampleBytes: input.status.sampleBytes,
      blockingUse: input.status.blockingUse,
      safeReason: input.status.safeReason,
      safeError: input.status.safeError,
    },
  })
}

function maintenancePayloadFromResult(
  result: LcmMaintenanceResult,
  input?: {
    phase?: LcmMaintenanceEventPayload["phase"]
    hardLimit?: number
    softThreshold?: number
    freshTailTokens?: number
    softBacklogTokens?: number
    softBacklogItemCount?: number
    freshTailRawTokens?: number
    freshTailRawItemCount?: number
    unconsumedRawTokens?: number
    unconsumedRawItemCount?: number
    protectedTailRawTokens?: number
    protectedTailRawItemCount?: number
    rawLaneTokens?: number
    rawLaneRatio?: number
    softBacklogRatio?: number
    softBacklogLargestSourceTokens?: number
    softPressureReason?: LcmMaintenanceEventPayload["softPressureReason"]
    laneLatchDiagnostics?: LcmMaintenanceEventPayload["laneLatchDiagnostics"]
    safeError?: LcmSafeError
    safeLabel?: string
  },
): LcmMaintenanceEventPayload {
  const status: LcmMaintenanceEventPayload["status"] =
    result.status === "healthy" ? "no_op" : result.status === "failed" ? "failed" : result.status
  const safeError = input?.safeError ?? result.safeError
  return {
    phase:
      input?.phase ??
      (result.reason === "repair" ? "repair" : result.reason === "hard_limit" ? "hard_limit" : "leaf_summary"),
    reason: result.reason,
    status,
    blocking: result.blocking,
    beforeTokens: result.beforeTokens,
    afterTokens: result.afterTokens,
    hardLimit: input?.hardLimit,
    softThreshold: input?.softThreshold,
    freshTailTokens: input?.freshTailTokens,
    softBacklogTokens: input?.softBacklogTokens,
    softBacklogItemCount: input?.softBacklogItemCount,
    freshTailRawTokens: input?.freshTailRawTokens,
    freshTailRawItemCount: input?.freshTailRawItemCount,
    unconsumedRawTokens: input?.unconsumedRawTokens,
    unconsumedRawItemCount: input?.unconsumedRawItemCount,
    protectedTailRawTokens: input?.protectedTailRawTokens,
    protectedTailRawItemCount: input?.protectedTailRawItemCount,
    rawLaneTokens: input?.rawLaneTokens,
    rawLaneRatio: input?.rawLaneRatio,
    softBacklogRatio: input?.softBacklogRatio,
    softBacklogLargestSourceTokens: input?.softBacklogLargestSourceTokens,
    softPressureReason: input?.softPressureReason,
    laneLatchDiagnostics: input?.laneLatchDiagnostics,
    sweepPassesCompleted: result.sweepPassesCompleted,
    sweepMaxPasses: result.sweepMaxPasses,
    sweepElapsedMs: result.sweepElapsedMs,
    sweepMaxElapsedMs: result.sweepMaxElapsedMs,
    sweepStopReason: result.sweepStopReason,
    summaryPromptVersion: result.summaryPromptVersion,
    summaryBackoffPurpose: result.summaryBackoffPurpose,
    summaryBackoffFailureCount: result.summaryBackoffFailureCount,
    summaryBackoffDelayMs: result.summaryBackoffDelayMs,
    summaryBackoffRemainingMs: result.summaryBackoffRemainingMs,
    summariesCreated: result.summariesCreated,
    contextItemsReplaced: result.contextItemsReplaced,
    safeLabel: input?.safeLabel,
    providerCapacityDeferred: safeError?.code === "provider_capacity_deferred" ? true : undefined,
    providerEndpointKeyHash:
      safeError?.code === "provider_capacity_deferred"
        ? (safeError.safeParams as { providerEndpointKeyHash?: string }).providerEndpointKeyHash
        : undefined,
    safeError,
  }
}

export function createLcmMaintenanceStartedEvent(input: {
  sessionID?: SessionID
  conversationID: ConversationID
  operationID: OperationID
  phase: LcmMaintenanceEventPayload["phase"]
  reason: LcmMaintenanceResult["reason"]
  status?: Extract<LcmMaintenanceEventPayload["status"], "scheduled" | "started">
  blocking: boolean
  beforeTokens?: number
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  softBacklogLargestSourceTokens?: number
  softPressureReason?: LcmMaintenanceEventPayload["softPressureReason"]
  laneLatchDiagnostics?: LcmMaintenanceEventPayload["laneLatchDiagnostics"]
  sweepMaxPasses?: number
  sweepMaxElapsedMs?: number
  summaryPromptVersion?: LcmMaintenanceEventPayload["summaryPromptVersion"]
  summaryBackoffPurpose?: LcmMaintenanceEventPayload["summaryBackoffPurpose"]
  safeLabel?: string
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmMaintenanceEventPayload>({
    type: "lcm.maintenance.started",
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    timestamp: input.timestamp,
    payload: {
      phase: input.phase,
      reason: input.reason,
      status: input.status ?? "started",
      blocking: input.blocking,
      beforeTokens: input.beforeTokens,
      hardLimit: input.hardLimit,
      softThreshold: input.softThreshold,
      freshTailTokens: input.freshTailTokens,
      softBacklogTokens: input.softBacklogTokens,
      softBacklogItemCount: input.softBacklogItemCount,
      freshTailRawTokens: input.freshTailRawTokens,
      freshTailRawItemCount: input.freshTailRawItemCount,
      unconsumedRawTokens: input.unconsumedRawTokens,
      unconsumedRawItemCount: input.unconsumedRawItemCount,
      protectedTailRawTokens: input.protectedTailRawTokens,
      protectedTailRawItemCount: input.protectedTailRawItemCount,
      rawLaneTokens: input.rawLaneTokens,
      rawLaneRatio: input.rawLaneRatio,
      softBacklogRatio: input.softBacklogRatio,
      softBacklogLargestSourceTokens: input.softBacklogLargestSourceTokens,
      softPressureReason: input.softPressureReason,
      laneLatchDiagnostics: input.laneLatchDiagnostics,
      sweepMaxPasses: input.sweepMaxPasses,
      sweepMaxElapsedMs: input.sweepMaxElapsedMs,
      summaryPromptVersion: input.summaryPromptVersion,
      summaryBackoffPurpose: input.summaryBackoffPurpose,
      safeLabel: input.safeLabel,
    },
  })
}

export function createLcmMaintenanceEndedEvent(input: {
  sessionID?: SessionID
  result: LcmMaintenanceResult
  phase?: LcmMaintenanceEventPayload["phase"]
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  softBacklogLargestSourceTokens?: number
  softPressureReason?: LcmMaintenanceEventPayload["softPressureReason"]
  laneLatchDiagnostics?: LcmMaintenanceEventPayload["laneLatchDiagnostics"]
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmMaintenanceEventPayload>({
    type: "lcm.maintenance.ended",
    sessionID: input.sessionID,
    conversationID: input.result.conversationID,
    operationID: input.result.operationID,
    timestamp: input.timestamp,
    payload: maintenancePayloadFromResult(input.result, {
      phase: input.phase,
      hardLimit: input.hardLimit,
      softThreshold: input.softThreshold,
      freshTailTokens: input.freshTailTokens,
      softBacklogTokens: input.softBacklogTokens,
      softBacklogItemCount: input.softBacklogItemCount,
      freshTailRawTokens: input.freshTailRawTokens,
      freshTailRawItemCount: input.freshTailRawItemCount,
      unconsumedRawTokens: input.unconsumedRawTokens,
      unconsumedRawItemCount: input.unconsumedRawItemCount,
      protectedTailRawTokens: input.protectedTailRawTokens,
      protectedTailRawItemCount: input.protectedTailRawItemCount,
      rawLaneTokens: input.rawLaneTokens,
      rawLaneRatio: input.rawLaneRatio,
      softBacklogRatio: input.softBacklogRatio,
      softBacklogLargestSourceTokens: input.softBacklogLargestSourceTokens,
      softPressureReason: input.softPressureReason,
      laneLatchDiagnostics: input.laneLatchDiagnostics,
    }),
  })
}

export function createLcmMaintenanceFailedEvent(input: {
  sessionID?: SessionID
  result: LcmMaintenanceResult
  phase?: LcmMaintenanceEventPayload["phase"]
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  softBacklogLargestSourceTokens?: number
  softPressureReason?: LcmMaintenanceEventPayload["softPressureReason"]
  laneLatchDiagnostics?: LcmMaintenanceEventPayload["laneLatchDiagnostics"]
  safeError?: LcmSafeError
  timestamp?: ISO8601
}) {
  return createLcmEventEnvelope<LcmMaintenanceEventPayload>({
    type: "lcm.maintenance.failed",
    sessionID: input.sessionID,
    conversationID: input.result.conversationID,
    operationID: input.result.operationID,
    timestamp: input.timestamp,
    payload: maintenancePayloadFromResult(input.result, {
      phase: input.phase,
      hardLimit: input.hardLimit,
      softThreshold: input.softThreshold,
      freshTailTokens: input.freshTailTokens,
      softBacklogTokens: input.softBacklogTokens,
      softBacklogItemCount: input.softBacklogItemCount,
      freshTailRawTokens: input.freshTailRawTokens,
      freshTailRawItemCount: input.freshTailRawItemCount,
      unconsumedRawTokens: input.unconsumedRawTokens,
      unconsumedRawItemCount: input.unconsumedRawItemCount,
      protectedTailRawTokens: input.protectedTailRawTokens,
      protectedTailRawItemCount: input.protectedTailRawItemCount,
      rawLaneTokens: input.rawLaneTokens,
      rawLaneRatio: input.rawLaneRatio,
      softBacklogRatio: input.softBacklogRatio,
      softBacklogLargestSourceTokens: input.softBacklogLargestSourceTokens,
      softPressureReason: input.softPressureReason,
      laneLatchDiagnostics: input.laneLatchDiagnostics,
      safeError: input.safeError,
    }),
  })
}

export function publishLcmEvent<TPayload>(bus: Bus.Interface, envelope: LcmEventEnvelope<TPayload>) {
  return bus.publish(eventByName[envelope.type], envelope as never)
}

export function publishLcmEventEffect<TPayload>(envelope: LcmEventEnvelope<TPayload>) {
  return Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* publishLcmEvent(bus, envelope)
  })
}

export * as LcmEvents from "./events"
