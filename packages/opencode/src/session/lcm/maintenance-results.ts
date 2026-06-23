// kilocode_change - new file
import type {
  ConversationID,
  LcmMaintenanceResult,
  LcmPromptVersion,
  LcmSafeError,
  LcmSummaryBackoffPurpose,
  LcmSoftSweepStopReason,
  OperationID,
} from "./types"

const LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_BASE_DELAY_MS = 2_000
const LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_DELAY_MS = 30_000
export const LCM_SOFT_SWEEP_DEFAULT_MAX_PASSES = 1
export const LCM_SOFT_SWEEP_DEFAULT_MAX_ELAPSED_MS = 60_000
export const LCM_SUMMARY_FAILURE_BACKOFF_MIN_FAILURES = 2
const LCM_SOFT_MAINTENANCE_RETRYABLE_SAFE_ERROR_CODES = new Set<LcmSafeError["code"]>([
  "provider_capacity_deferred",
  "provider_unavailable",
  "db_unavailable",
  "timeout",
])

export type LcmMaintenanceAttemptStatus = Exclude<LcmMaintenanceResult["status"], "healthy">
export type LcmSoftSweepStartDecision =
  | { canStart: true; elapsedMs: number }
  | { canStart: false; elapsedMs: number; stopReason: Extract<LcmSoftSweepStopReason, "iteration_cap" | "elapsed_cap"> }

export interface LcmSoftSweepBudget {
  readonly startedAtMs: number
  readonly maxPasses: number
  readonly maxElapsedMs: number
}

export interface LcmSummaryFailureBackoffRoute {
  readonly conversationID: ConversationID
  readonly purpose: LcmSummaryBackoffPurpose
  readonly promptVersion: LcmPromptVersion
  readonly providerID?: string
  readonly modelID?: string
}

export interface LcmSummaryFailureBackoffState extends LcmSummaryFailureBackoffRoute {
  readonly key: string
  readonly failureCount: number
  readonly nextAllowedAtMs: number
  readonly updatedAtMs: number
  readonly lastSafeErrorCode?: LcmSafeError["code"]
  readonly lastDiagnosticCode?: string
}

function floorFiniteNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

export function createLcmSoftSweepBudget(input?: {
  startedAtMs?: number
  maxPasses?: number
  maxElapsedMs?: number
}): LcmSoftSweepBudget {
  return {
    startedAtMs: floorFiniteNonNegative(input?.startedAtMs, Date.now()),
    maxPasses: floorFiniteNonNegative(input?.maxPasses, LCM_SOFT_SWEEP_DEFAULT_MAX_PASSES),
    maxElapsedMs: floorFiniteNonNegative(input?.maxElapsedMs, LCM_SOFT_SWEEP_DEFAULT_MAX_ELAPSED_MS),
  }
}

export function lcmSoftSweepElapsedMs(input: { budget: LcmSoftSweepBudget; nowMs: number }): number {
  return Math.max(0, Math.floor(input.nowMs - input.budget.startedAtMs))
}

export function lcmSoftSweepShouldStartPass(input: {
  budget: LcmSoftSweepBudget
  passesCompleted: number
  nowMs: number
}): LcmSoftSweepStartDecision {
  const passesCompleted = floorFiniteNonNegative(input.passesCompleted, 0)
  const elapsedMs = lcmSoftSweepElapsedMs({ budget: input.budget, nowMs: input.nowMs })
  if (passesCompleted >= input.budget.maxPasses) return { canStart: false, elapsedMs, stopReason: "iteration_cap" }
  if (elapsedMs >= input.budget.maxElapsedMs) return { canStart: false, elapsedMs, stopReason: "elapsed_cap" }
  return { canStart: true, elapsedMs }
}

export function lcmMaintenanceResultWithSoftSweepTelemetry(
  result: LcmMaintenanceResult,
  input: {
    budget: LcmSoftSweepBudget
    passesCompleted: number
    nowMs: number
    stopReason: LcmSoftSweepStopReason
  },
): LcmMaintenanceResult {
  return {
    ...result,
    sweepPassesCompleted: floorFiniteNonNegative(input.passesCompleted, 0),
    sweepMaxPasses: input.budget.maxPasses,
    sweepElapsedMs: lcmSoftSweepElapsedMs({ budget: input.budget, nowMs: input.nowMs }),
    sweepMaxElapsedMs: input.budget.maxElapsedMs,
    sweepStopReason: input.stopReason,
  }
}

export function lcmSoftSweepStopReasonForResult(result: LcmMaintenanceResult): LcmSoftSweepStopReason {
  if (result.sweepStopReason) return result.sweepStopReason
  if (result.status === "completed") return "completed"
  if (result.status === "no_op" || result.status === "healthy" || result.status === "skipped") return "no_work"
  if (result.status === "canceled" || result.safeError?.code === "canceled") return "canceled"
  if (result.safeError?.code === "provider_capacity_deferred") return "provider_capacity"
  if (result.status === "deferred") return "backoff"
  return "failed"
}

export function lcmSummaryFailureBackoffKey(route: LcmSummaryFailureBackoffRoute): string {
  return [
    route.conversationID,
    route.purpose,
    route.promptVersion,
    route.providerID ?? "provider:none",
    route.modelID ?? "model:none",
  ].join("|")
}

export function lcmRecordSummaryFailureBackoff(input: {
  route: LcmSummaryFailureBackoffRoute
  state?: LcmSummaryFailureBackoffState
  safeError?: LcmSafeError
  nowMs: number
}): LcmSummaryFailureBackoffState {
  const key = lcmSummaryFailureBackoffKey(input.route)
  const failureCount = (input.state?.key === key ? input.state.failureCount : 0) + 1
  const delayMs = lcmDeferredSoftMaintenanceRetryDelayMs(failureCount)
  return {
    ...input.route,
    key,
    failureCount,
    nextAllowedAtMs: input.nowMs + delayMs,
    updatedAtMs: input.nowMs,
    ...(input.safeError?.code ? { lastSafeErrorCode: input.safeError.code } : {}),
    ...(input.safeError?.diagnosticCode ? { lastDiagnosticCode: input.safeError.diagnosticCode } : {}),
  }
}

export function lcmSummaryFailureBackoffRemainingMs(input: {
  state?: LcmSummaryFailureBackoffState
  nowMs: number
}): number {
  if (!input.state || input.state.failureCount < LCM_SUMMARY_FAILURE_BACKOFF_MIN_FAILURES) return 0
  return Math.max(0, Math.floor(input.state.nextAllowedAtMs - input.nowMs))
}

export function lcmSummaryFailureBackoffTelemetry(input: {
  state: LcmSummaryFailureBackoffState
  nowMs: number
}): Pick<
  LcmMaintenanceResult,
  | "summaryPromptVersion"
  | "summaryBackoffPurpose"
  | "summaryBackoffFailureCount"
  | "summaryBackoffDelayMs"
  | "summaryBackoffRemainingMs"
> {
  return {
    summaryPromptVersion: input.state.promptVersion,
    summaryBackoffPurpose: input.state.purpose,
    summaryBackoffFailureCount: input.state.failureCount,
    summaryBackoffDelayMs: Math.max(0, Math.floor(input.state.nextAllowedAtMs - input.state.updatedAtMs)),
    summaryBackoffRemainingMs: lcmSummaryFailureBackoffRemainingMs(input),
  }
}

export function lcmDeferredSoftMaintenanceRetryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1))
  return Math.min(
    LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_DELAY_MS,
    LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, normalized - 1),
  )
}

export function lcmShouldRetrySoftMaintenance(result: LcmMaintenanceResult): boolean {
  if (result.status === "deferred") return true
  const safeError = result.safeError
  return !!safeError?.retryable && LCM_SOFT_MAINTENANCE_RETRYABLE_SAFE_ERROR_CODES.has(safeError.code)
}

export function emptyMaintenanceResult(input: {
  conversationID: ConversationID
  operationID: OperationID
  reason: LcmMaintenanceResult["reason"]
  blocking: boolean
  status: LcmMaintenanceResult["status"]
  workNeeded: boolean
  safeMessage?: string
  safeError?: LcmSafeError
  beforeTokens?: number
  afterTokens?: number
}): LcmMaintenanceResult {
  return {
    conversationID: input.conversationID,
    operationID: input.operationID,
    workNeeded: input.workNeeded,
    workPerformed: false,
    blocking: input.blocking,
    reason: input.reason,
    ...(input.beforeTokens !== undefined ? { beforeTokens: input.beforeTokens } : {}),
    ...(input.afterTokens !== undefined ? { afterTokens: input.afterTokens } : {}),
    summariesCreated: 0,
    contextItemsReplaced: 0,
    status: input.status,
    ...(input.safeMessage ? { safeMessage: input.safeMessage } : {}),
    ...(input.safeError ? { safeError: input.safeError } : {}),
  }
}

export function failedMaintenanceResult(input: {
  conversationID: ConversationID
  operationID: OperationID
  reason: LcmMaintenanceResult["reason"]
  blocking: boolean
  safeError: LcmSafeError
  status?: LcmMaintenanceResult["status"]
  workNeeded?: boolean
  beforeTokens?: number
  afterTokens?: number
}) {
  return emptyMaintenanceResult({
    conversationID: input.conversationID,
    operationID: input.operationID,
    reason: input.reason,
    blocking: input.blocking,
    status: input.status ?? "failed",
    workNeeded: input.workNeeded ?? true,
    safeMessage: input.safeError.safeMessage,
    safeError: input.safeError,
    ...(input.beforeTokens !== undefined ? { beforeTokens: input.beforeTokens } : {}),
    ...(input.afterTokens !== undefined ? { afterTokens: input.afterTokens } : {}),
  })
}

export function maintenanceAttemptUsageRecordID(operationID: OperationID) {
  return `usage_${operationID.slice(3)}`
}

export function maintenanceAttemptStatus(result: LcmMaintenanceResult): LcmMaintenanceAttemptStatus {
  return result.status === "healthy" ? "no_op" : result.status
}
