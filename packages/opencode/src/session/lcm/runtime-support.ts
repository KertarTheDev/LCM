// kilocode_change - new file
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { SessionStatus } from "../status"
import { mergeDeep } from "remeda"
import { renderLargeFileMarker } from "./artifacts"
import type { LcmHardLimitProgress, LcmRawLeafRenderPreparationInput } from "./context"
import {
  LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL,
  LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_PROMPT_PREPARATION_LABELS,
} from "./events"
import type { LcmFamilyTarget } from "./family"
import type { LcmLargeFileRow } from "./large-files"
import { resolveLcmModelLimits } from "./model-limits"
import { lcmPreflightRecoverableSafeError } from "./preflight-errors"
import {
  createLcmSafeError,
  type ConversationID,
  type LcmAdmittedPathBackedFile,
  type LcmExpandQueryResult,
  type LcmMaintenanceResult,
  type LcmPreflightInput,
  type LcmPreflightResult,
  type LcmSafeAction,
  type LcmSafeError,
  type LcmSoftMaintenanceAfterTurnInput,
  type LcmTargetCurrentUserInput,
  type LcmThresholdDecision,
  type MessageRowID,
  type OperationID,
} from "./types"

export function pending(diagnosticCode: string) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

export function invalidRequest(
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

export function operationTimeout(input: {
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

export function providerInvalidResponse(
  diagnosticCode: string,
  input?: {
    operationID?: OperationID
    conversationID?: ConversationID
    retryable?: boolean
  },
) {
  const retryable = input?.retryable ?? true
  return createLcmSafeError({
    code: "provider_invalid_response",
    templateKey: "lcm.provider.invalid_response",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.conversationID ? { conversationID: input.conversationID } : {}),
      retryable,
      ...(retryable ? { action: "retry" as const } : {}),
    },
    retryable,
    diagnosticCode,
  })
}

export const LCM_DEFERRED_MAINTENANCE_CLOSE_GRACE_MS = 5_000

export function legacyReadOnly(input: { operationID: OperationID; conversationID?: ConversationID }) {
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

export function recoveryMissing(input: {
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

export function hardLimitUnresolved(input: {
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

export function isSoftThresholdContextInvalid(error: LcmSafeError) {
  return (
    error.code === "recovery_required" && error.diagnosticCode?.startsWith("lcm_threshold_context_invalid_") === true
  )
}

export function softMaintenanceProtectedCurrentUserTarget(input: {
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

export function blockedPreflight(input: {
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

export function preflightFallbackLifecycleState(input: {
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

export function numberField(value: unknown): number | undefined {
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

export function isPromptPreparationStatus(status: SessionStatus.Info | undefined) {
  return (
    status?.type === "busy" &&
    status.message !== undefined &&
    (LCM_PROMPT_PREPARATION_LABELS as readonly string[]).includes(status.message)
  )
}

export function hardLimitProgressLabel(progress: LcmHardLimitProgress) {
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

export function hardLimitMaintenanceBlocksPreflight(result: LcmMaintenanceResult) {
  return result.status === "failed" || result.status === "canceled" || result.safeError !== undefined
}

export function providerUsageFromGeneration(input: { usage: unknown; providerID: string; modelID: string }) {
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

export function asNumber(value: number | string | bigint | null | undefined) {
  return Number(value ?? 0)
}

export type LcmGenerationMessage = {
  readonly role: "system" | "user"
  readonly content: string
}

export function lcmGenerationMessages(input: {
  readonly prompt: string
  readonly request?: { readonly messages: readonly LcmGenerationMessage[] }
}) {
  return input.request ? [...input.request.messages] : [{ role: "user" as const, content: input.prompt }]
}

export function mergeLcmProviderOptions(input: {
  readonly model: Provider.Model
  readonly sessionID: string
  readonly providerOptions?: Record<string, unknown>
}) {
  const base = ProviderTransform.options({
    model: input.model,
    sessionID: input.sessionID,
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
  })
  return mergeDeep(base, input.model.options ?? {}) as Record<string, unknown>
}

export function shouldOmitLcmMaxOutputTokens(model: Provider.Model) {
  return model.api.npm === "@ai-sdk/openai-compatible" && model.api.id.toLowerCase().includes("gpt-5")
}

export const LCM_REASONING_OUTPUT_RESERVE_TOKENS = 1024

export function lcmMaxOutputTokens(input: {
  readonly model: Provider.Model
  readonly maxOutputTokens?: number
  readonly reserveReasoningTokens?: boolean
}) {
  if (shouldOmitLcmMaxOutputTokens(input.model)) return undefined
  if (input.maxOutputTokens === undefined) return undefined
  const reserve =
    input.reserveReasoningTokens && input.model.capabilities.reasoning ? LCM_REASONING_OUTPUT_RESERVE_TOKENS : 0
  const requested = input.maxOutputTokens + reserve
  const limit = resolveLcmModelLimits(input.model).output ?? ProviderTransform.maxOutputTokens(input.model)
  return Math.max(1, Math.min(requested, limit))
}

export function stringField(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function lcmProviderDiagnostics(input: {
  readonly generation: unknown
  readonly text: string
}): NonNullable<LcmExpandQueryResult["providerDiagnostics"]> {
  const generation = objectField(input.generation)
  const usage = objectField(generation?.usage)
  const outputDetails = objectField(usage?.outputTokenDetails)
  const outputTokens = numberField(usage?.outputTokens ?? usage?.completionTokens)
  const reasoningTokens = numberField(usage?.reasoningTokens ?? outputDetails?.reasoningTokens)
  const finishReason = stringField(generation?.finishReason)
  return {
    ...(finishReason ? { finishReason } : {}),
    textByteCount: Buffer.byteLength(input.text, "utf8"),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    emptyText: input.text.trim().length === 0,
  }
}

export function thresholdEventFields(threshold: LcmThresholdDecision) {
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

export function metricNumber(value: number | string | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function admittedPathBackedFileFromRow(input: {
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
