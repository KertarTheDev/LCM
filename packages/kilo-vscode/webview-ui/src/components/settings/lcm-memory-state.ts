import type { LcmDbStatus, LcmSafeError, LcmSettingsState } from "@kilocode/sdk/v2/client"
import type { LcmMaintenanceHint } from "../../context/session-utils"
import type { ContextUsage, LcmMetricsSnapshotMessage } from "../../types/messages"

export const LCM_EXCLUDED_CONTROL_LABELS = [
  "Disable LCM",
  "Enable LCM",
  "Reset memory",
  "Delete LCM memory",
  "Export raw memory",
  "View raw memory",
]

export type FiniteNumberInput = number | "NaN" | "Infinity" | "-Infinity" | undefined | null

export function finiteNumber(value: FiniteNumberInput): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function formatBytes(bytes: FiniteNumberInput) {
  const value = Math.max(0, finiteNumber(bytes) ?? 0)
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let size = value
  let unit = units[0]!
  for (let i = 0; i < units.length - 1 && size >= 1024; i++) {
    size = size / 1024
    unit = units[i + 1]!
  }
  const precision = unit === "B" ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(precision)} ${unit}`
}

const GIB_BYTES = 1024 ** 3

export function formatStorageThresholdGiB(bytes: FiniteNumberInput) {
  const value = finiteNumber(bytes)
  if (value === undefined || value <= 0) return ""
  const gib = value / GIB_BYTES
  return gib.toFixed(gib >= 1 ? 2 : 3).replace(/\.?0+$/, "")
}

export const LCM_FRESH_TAIL_DESCRIPTION = "How many tokens from the most recent messages are kept unsummarised."

export function storageWarningSettingsDescription(
  state: Pick<LcmSettingsState, "storageBytes" | "storageWarningThresholdBytes"> | undefined,
) {
  const threshold = formatBytes(state?.storageWarningThresholdBytes)
  return [
    `Current storage: ${formatBytes(state?.storageBytes)}.`,
    `Warn when memory storage reaches the number of GiB entered here; current threshold is ${threshold}.`,
  ].join(" ")
}

export function parseStorageThresholdGiB(input: string) {
  const trimmed = input.trim()
  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) return undefined
  const gib = Number.parseFloat(trimmed)
  if (!Number.isFinite(gib) || gib <= 0) return undefined
  return Math.max(1, Math.round(gib * GIB_BYTES))
}

export function describeScope(state: Pick<LcmSettingsState, "effectiveScope"> | undefined) {
  const scope = state?.effectiveScope
  if (!scope) return "Unknown"
  if (scope.kind === "workspace") return "Workspace"
  if (scope.kind === "project") return "Project"
  return "Deployment default"
}

export function dbBackedActionsDisabled(state: LcmSettingsState | undefined) {
  if (!state) return true
  if (
    state.safeError &&
    ["db_locked", "db_unavailable", "db_corrupt", "db_migration_failed"].includes(state.safeError.code)
  ) {
    return true
  }
  return state.dbStatus?.status !== "ready"
}

function lifecycleLabel(state: LcmSettingsState["lifecycleState"] | undefined) {
  switch (state) {
    case "lcm_active":
      return "Memory is active."
    case "passive_synced":
      return "Memory is synced."
    case "legacy_read_only":
      return "Memory is read-only for this legacy session."
    case "recovery_required":
      return "Memory recovery is required."
    case "recovery_failed":
      return "Memory recovery failed."
    case "db_unavailable":
      return "Memory database is unavailable."
    default:
      return undefined
  }
}

export function statusMessage(input: { state?: LcmSettingsState; error?: LcmSafeError }) {
  if (input.error) return input.error.safeMessage
  if (input.state?.safeError) return input.state.safeError.safeMessage
  if (input.state?.storageWarning) return "Memory storage is above the configured warning threshold."
  const dbStatus = input.state?.dbStatus?.status
  if (dbStatus && dbStatus !== "ready") return `Memory database is ${dbStatusLabel(input.state?.dbStatus)}.`
  const lifecycle = lifecycleLabel(input.state?.lifecycleState)
  if (lifecycle) return lifecycle
  if (!input.state?.dbStatus && !input.state?.lifecycleState) {
    return "Memory settings are available. Runtime status is not reported here."
  }
  return "Memory is available."
}

export function dbStatusLabel(status: LcmDbStatus | undefined) {
  if (!status) return "Not reported"
  return status.status.replaceAll("_", " ")
}

export type LcmMemoryStatusTone = "normal" | "warning" | "error" | "muted"

export interface LcmMemoryStatusItem {
  label: string
  value: string
  tone: LcmMemoryStatusTone
  detail?: string
}

export type LcmMemoryActionKind =
  | "refresh"
  | "new_task"
  | "support"
  | "cancel_maintenance"
  | "diagnose_db"
  | "export_prompts"

export interface LcmMemoryActionButton {
  kind: LcmMemoryActionKind
  label: string
  icon: "history" | "new-session" | "square-arrow-top-right" | "close" | "help"
  title?: string
  disabled?: boolean
}

function formatInteger(value: FiniteNumberInput) {
  const number = finiteNumber(value)
  if (number === undefined) return "0"
  return Math.max(0, Math.round(number)).toLocaleString("en-US")
}

function formatPercent(value: FiniteNumberInput) {
  const number = finiteNumber(value)
  if (number === undefined) return undefined
  return `${Math.round(number * 100)}%`
}

function maintenancePressureOverThreshold(
  input:
    | {
        rawLaneRatio?: FiniteNumberInput
        softBacklogRatio?: FiniteNumberInput
        rawLaneTokens?: FiniteNumberInput
        softBacklogTokens?: FiniteNumberInput
        softThreshold?: FiniteNumberInput
      }
    | undefined,
) {
  if (!input) return false
  const rawLaneRatio = pressureRatio(input.rawLaneTokens, input.softThreshold, input.rawLaneRatio)
  const softBacklogRatio = pressureRatio(input.softBacklogTokens, input.softThreshold, input.softBacklogRatio)
  return rawLaneRatio !== undefined && rawLaneRatio >= 1
    ? true
    : softBacklogRatio !== undefined && softBacklogRatio >= 1
}

function maintenanceWaitingForCheckpoint(metrics: LcmMetricsSnapshotMessage | undefined) {
  const last = metrics?.lastMaintenance
  return (
    maintenancePressureOverThreshold(metrics) &&
    (!last ||
      last.status === "healthy" ||
      last.status === "completed" ||
      last.status === "no_op" ||
      last.status === "skipped")
  )
}

export function formatLcmRelativeTime(iso: string | undefined, nowMs = Date.now()) {
  if (!iso) return "Not reported"
  const timestampMs = Date.parse(iso)
  if (!Number.isFinite(timestampMs)) return "Not reported"
  const diffMs = Math.max(0, nowMs - timestampMs)
  if (diffMs < 60_000) return "Just now"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestampMs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatBudget(usage: ContextUsage | undefined) {
  if (!usage || usage.source !== "lcm_active_budget") return "Not reported"
  const limit = usage.limit ? ` / ${formatInteger(usage.limit)}` : ""
  const percentage = typeof usage.percentage === "number" ? ` (${usage.percentage}%)` : ""
  return `${formatInteger(usage.tokens)}${limit}${percentage}`
}

function storageTone(
  state: LcmSettingsState | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
): LcmMemoryStatusTone {
  return state?.storageWarning || metrics?.storageWarning ? "warning" : "normal"
}

function maintenanceTone(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
): LcmMemoryStatusTone {
  if (hint?.state === "failed") return "error"
  if (hint?.state === "pending" || hint?.state === "running") return "warning"
  if (hint?.state === "canceled") return "normal"
  const lastStatus = metrics?.lastMaintenance?.status
  if (lastStatus === "failed" || lastStatus === "recovery_required") return "error"
  if (lastStatus === "scheduled" || lastStatus === "deferred") return "warning"
  if (maintenancePressureOverThreshold(metrics)) return "warning"
  return metrics?.lastMaintenance ? "normal" : "muted"
}

function maintenanceLabel(hint: LcmMaintenanceHint | undefined, metrics: LcmMetricsSnapshotMessage | undefined) {
  if (hint) return hint.label
  const last = metrics?.lastMaintenance
  if (maintenanceWaitingForCheckpoint(metrics)) {
    return "Waiting for checkpoint"
  }
  if (!last) return "No recent maintenance"
  switch (last.status) {
    case "healthy":
      return "Healthy"
    case "completed":
      return "Completed"
    case "scheduled":
      return "Scheduled"
    case "deferred":
      return "Will retry"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
    case "recovery_required":
      return "Recovery required"
    case "no_op":
      return "No update needed"
    case "skipped":
      return "Skipped"
    default:
      return last.status
  }
}

function formatTokenProgress(input: { before?: number; after?: number }) {
  if (input.before === undefined || input.after === undefined || input.before === input.after) return undefined
  return `Reduced ${formatInteger(input.before)} -> ${formatInteger(input.after)} tokens`
}

function formatActiveBudgetProgress(input: { active?: number; hardLimit?: number }) {
  if (input.active === undefined || input.hardLimit === undefined) return undefined
  return `Active ${formatInteger(input.active)} / ${formatInteger(input.hardLimit)} tokens`
}

function formatSoftBacklogProgress(input: { tokens?: number; threshold?: number; itemCount?: number }) {
  if (input.tokens === undefined || input.tokens <= 0 || input.threshold === undefined) return undefined
  const items =
    input.itemCount !== undefined && input.itemCount > 0
      ? ` in ${formatInteger(input.itemCount)} ${input.itemCount === 1 ? "item" : "items"}`
      : ""
  return `Backlog ${formatInteger(input.tokens)} / ${formatInteger(input.threshold)} tokens${items}`
}

function hasMaintenanceDetailSource(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
) {
  return hint !== undefined || metrics?.lastMaintenance !== undefined || maintenancePressureOverThreshold(metrics)
}

function maintenanceTokenProgress(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
) {
  return formatTokenProgress({
    before: finiteNumber(hint?.beforeTokens ?? metrics?.lastMaintenance?.beforeTokens),
    after: finiteNumber(hint?.afterTokens ?? metrics?.lastMaintenance?.afterTokens),
  })
}

function maintenanceActiveProgress(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
) {
  return formatActiveBudgetProgress({
    active: finiteNumber(hint?.beforeTokens ?? metrics?.activeTokens),
    hardLimit: finiteNumber(hint?.hardLimit ?? metrics?.hardLimit),
  })
}

function maintenanceBacklogProgress(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
) {
  return formatSoftBacklogProgress({
    tokens: finiteNumber(hint?.softBacklogTokens ?? metrics?.softBacklogTokens),
    threshold: finiteNumber(hint?.softThreshold ?? metrics?.softThreshold),
    itemCount: finiteNumber(hint?.softBacklogItemCount ?? metrics?.softBacklogItemCount),
  })
}

function joinMaintenanceDetail(safeMessage: string | undefined, progress: readonly string[]) {
  const progressText = progress.join(". ")
  if (safeMessage && progressText) return `${safeMessage} ${progressText}`
  return safeMessage ?? (progressText || undefined)
}

function maintenanceDetail(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
): string | undefined {
  if (!hasMaintenanceDetailSource(hint, metrics)) return undefined
  const primaryProgress = maintenanceTokenProgress(hint, metrics) ?? maintenanceActiveProgress(hint, metrics)
  const progress = [primaryProgress, maintenanceBacklogProgress(hint, metrics)].filter((part): part is string =>
    Boolean(part),
  )
  const safeMessage =
    hint?.safeMessage ??
    (maintenanceWaitingForCheckpoint(metrics)
      ? "Memory will summarize after the next finalized checkpoint."
      : undefined)
  return joinMaintenanceDetail(safeMessage, progress)
}

function tokenCounterItem(usage: ContextUsage | undefined): LcmMemoryStatusItem | undefined {
  if (!usage?.tokenCounterMode) return undefined
  if (usage.tokenCounterMode === "deterministic_fallback" || usage.budgetStatus === "unavailable") {
    return {
      label: "Token counting",
      value: "Estimated",
      tone: "warning",
      detail: usage.tokenCounterVersion,
    }
  }
  return {
    label: "Token counting",
    value: usage.tokenCounterMode === "provider" ? "Provider" : usage.tokenCounterMode,
    tone: "normal",
    detail: usage.tokenCounterVersion,
  }
}

function modelLimitItem(usage: ContextUsage | undefined): LcmMemoryStatusItem | undefined {
  if (usage?.budgetStatus !== "provider_limit_fallback") return undefined
  return {
    label: "Model limits",
    value: "Estimated",
    tone: "warning",
    detail: "Using conservative fallback limits for this provider.",
  }
}

type SafeActionStatus = {
  action?: LcmSafeError["action"]
  retryable?: boolean
  safeMessage?: string
  diagnosticCode?: string
  safeCode?: string
}

const CANCELABLE_MAINTENANCE_SAFE_CODES = new Set([
  "provider_capacity_deferred",
  "provider_unavailable",
  "db_unavailable",
  "timeout",
])

function safeActionStatus(input: {
  error?: LcmSafeError
  state?: LcmSettingsState
  maintenanceHint?: LcmMaintenanceHint
}): SafeActionStatus | undefined {
  if (input.error) return input.error
  if (input.state?.safeError) return input.state.safeError
  const hint = input.maintenanceHint
  if (!hint || (!hint.action && hint.retryable === undefined && !hint.safeMessage)) return undefined
  return {
    action: hint.action as LcmSafeError["action"] | undefined,
    retryable: hint.retryable ?? false,
    safeMessage: hint.safeMessage,
    safeCode: hint.safeCode,
    diagnosticCode: hint.diagnosticCode,
  }
}

function safeActionLabel(action: LcmSafeError["action"] | undefined, retryable: boolean | undefined) {
  switch (action) {
    case "retry":
      return retryable ? "Will retry" : "Retry"
    case "repeat_input":
      return "Repeat input"
    case "start_new_thread":
      return "Start new thread"
    case "re_register_file":
      return "Re-add file"
    case "delete_session":
      return "Delete session"
    case "close_other_owner":
      return "Close other Kilo Code window"
    case "contact_support":
      return "Contact support"
    default:
      return retryable ? "Will retry" : "Check memory status"
  }
}

function lastSyncItem(metrics: LcmMetricsSnapshotMessage | undefined, nowMs: number | undefined): LcmMemoryStatusItem {
  return {
    label: "Last sync",
    value: formatLcmRelativeTime(metrics?.updatedAt, nowMs),
    tone: metrics?.updatedAt ? "normal" : "muted",
  }
}

function maintenanceItem(
  hint: LcmMaintenanceHint | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
): LcmMemoryStatusItem {
  return {
    label: "Maintenance",
    value: maintenanceLabel(hint, metrics),
    tone: maintenanceTone(hint, metrics),
    detail: maintenanceDetail(hint, metrics),
  }
}

function activeBudgetItem(usage: ContextUsage | undefined): LcmMemoryStatusItem {
  const hardFill =
    finiteNumber(usage?.hardFillRatio) ??
    (usage?.percentage !== null && usage?.percentage !== undefined ? usage.percentage / 100 : undefined)
  return {
    label: "Active budget",
    value: formatBudget(usage),
    tone:
      hardFill !== undefined && hardFill >= 0.9
        ? "warning"
        : usage?.source === "lcm_active_budget"
          ? "normal"
          : "muted",
  }
}

function softBacklogItem(usage: ContextUsage | undefined): LcmMemoryStatusItem {
  const softBacklogTokens = finiteNumber(usage?.softBacklogTokens)
  const softThreshold = finiteNumber(usage?.softThreshold)
  const softBacklogRatio = finiteNumber(usage?.softBacklogRatio)
  const backlogPercent = formatPercent(softBacklogRatio)
  const value =
    softBacklogTokens !== undefined
      ? `${formatInteger(softBacklogTokens)}${softThreshold ? ` / ${formatInteger(softThreshold)}` : ""}${
          backlogPercent ? ` (${backlogPercent})` : ""
        }`
      : "Not reported"
  return {
    label: "Soft backlog",
    value,
    tone: softBacklogRatio !== undefined && softBacklogRatio >= 1 ? "warning" : "normal",
  }
}

function rawLaneTokensFromUsage(usage: ContextUsage | undefined) {
  if (!usage) return undefined
  const rawLaneTokens = finiteNumber(usage.rawLaneTokens)
  if (rawLaneTokens !== undefined) return rawLaneTokens
  const softBacklogTokens = finiteNumber(usage.softBacklogTokens)
  const protectedTailRawTokens = finiteNumber(usage.protectedTailRawTokens)
  if (softBacklogTokens === undefined && protectedTailRawTokens === undefined) return undefined
  return (softBacklogTokens ?? 0) + (protectedTailRawTokens ?? 0)
}

function pressureRatio(tokens: FiniteNumberInput, threshold: FiniteNumberInput, ratio: FiniteNumberInput) {
  const finiteRatio = finiteNumber(ratio)
  const finiteTokens = finiteNumber(tokens)
  const finiteThreshold = finiteNumber(threshold)
  return finiteRatio ?? (finiteTokens !== undefined && finiteThreshold ? finiteTokens / finiteThreshold : undefined)
}

function formatThresholdPressure(tokens: FiniteNumberInput, threshold: FiniteNumberInput, ratio: FiniteNumberInput) {
  const finiteTokens = finiteNumber(tokens)
  const finiteThreshold = finiteNumber(threshold)
  if (finiteTokens === undefined) return "Not reported"
  const limit = finiteThreshold ? ` / ${formatInteger(finiteThreshold)}` : ""
  const percent = formatPercent(ratio)
  return `${formatInteger(finiteTokens)}${limit}${percent ? ` (${percent})` : ""}`
}

function rawLaneItem(usage: ContextUsage | undefined): LcmMemoryStatusItem {
  const rawLaneTokens = rawLaneTokensFromUsage(usage)
  const rawLaneRatio = pressureRatio(rawLaneTokens, usage?.softThreshold, usage?.rawLaneRatio)
  const protectedTailRawTokens = finiteNumber(usage?.protectedTailRawTokens)
  const protectedTail =
    protectedTailRawTokens !== undefined ? `Protected tail: ${formatInteger(protectedTailRawTokens)}` : undefined
  return {
    label: "Raw lane",
    value: formatThresholdPressure(rawLaneTokens, usage?.softThreshold, rawLaneRatio),
    tone: typeof rawLaneRatio === "number" && rawLaneRatio >= 1 ? "warning" : "normal",
    detail: protectedTail,
  }
}

function storageItem(
  state: LcmSettingsState | undefined,
  metrics: LcmMetricsSnapshotMessage | undefined,
): LcmMemoryStatusItem {
  const storageBytes = finiteNumber(state?.storageBytes ?? metrics?.storageBytes)
  const storageThresholdBytes = finiteNumber(
    state?.storageWarningThresholdBytes ?? metrics?.storageWarningThresholdBytes,
  )
  const value =
    storageBytes === undefined && storageThresholdBytes === undefined
      ? "Not reported"
      : `${formatBytes(storageBytes)} / ${formatBytes(storageThresholdBytes)}`
  return {
    label: "Storage",
    value,
    tone: storageTone(state, metrics),
  }
}

function nextStepItem(safeAction: SafeActionStatus | undefined): LcmMemoryStatusItem | undefined {
  if (!safeAction) return undefined
  return {
    label: "Next step",
    value: safeActionLabel(safeAction.action, safeAction.retryable),
    tone: safeAction.retryable ? "warning" : "error",
    detail: safeAction.safeMessage ?? safeAction.diagnosticCode,
  }
}

function shouldOfferDbDiagnostics(input: {
  state?: LcmSettingsState
  error?: LcmSafeError
  maintenanceHint?: LcmMaintenanceHint
}) {
  const safeCode = input.error?.code ?? input.state?.safeError?.code ?? input.maintenanceHint?.safeCode
  if (
    safeCode &&
    [
      "db_locked",
      "db_unavailable",
      "db_corrupt",
      "db_migration_failed",
      "recovery_required",
      "recovery_failed",
    ].includes(safeCode)
  ) {
    return true
  }
  return input.state?.dbStatus?.status !== undefined && input.state.dbStatus.status !== "ready"
}

function dbDiagnoseAction(title: string | undefined): LcmMemoryActionButton {
  return { kind: "diagnose_db", label: "Run diagnostics", icon: "help", title }
}

function promptExportActions(state: LcmSettingsState | undefined): LcmMemoryActionButton[] {
  if (!state) return []
  if (dbBackedActionsDisabled(state)) {
    const status =
      state.safeError?.safeMessage ??
      (state.dbStatus ? dbStatusLabel(state.dbStatus) : "Memory database status is not reported.")
    return [
      {
        kind: "export_prompts",
        label: "Export prompts",
        icon: "square-arrow-top-right",
        title: `Export prompts is available when memory database is ready. ${status}`,
        disabled: true,
      },
    ]
  }
  return [
    {
      kind: "export_prompts",
      label: "Export prompts",
      icon: "square-arrow-top-right",
      title: "Export reconstructed LCM model prompts and active context Markdown.",
    },
  ]
}

function safeActionButtons(
  safeAction: SafeActionStatus | undefined,
  diagnostics: LcmMemoryActionButton[],
  title: string | undefined,
): LcmMemoryActionButton[] {
  if (!safeAction) return diagnostics
  switch (safeAction.action) {
    case "retry":
      return [...diagnostics, { kind: "refresh", label: "Retry now", icon: "history", title }]
    case "close_other_owner":
      return [...diagnostics, { kind: "refresh", label: "Check again", icon: "history", title }]
    case "repeat_input":
    case "start_new_thread":
      return [{ kind: "new_task", label: "New task", icon: "new-session", title }]
    case "contact_support":
      return [...diagnostics, { kind: "support", label: "Open support", icon: "square-arrow-top-right", title }]
    default:
      return safeAction.retryable
        ? [...diagnostics, { kind: "refresh", label: "Check again", icon: "history", title }]
        : diagnostics
  }
}

export function lcmMemoryActionButtons(input: {
  state?: LcmSettingsState
  error?: LcmSafeError
  metrics?: LcmMetricsSnapshotMessage
  maintenanceHint?: LcmMaintenanceHint
}): LcmMemoryActionButton[] {
  const safeAction = safeActionStatus(input)
  const cancelableMaintenance =
    input.metrics?.lastMaintenance?.status === "deferred" ||
    (input.maintenanceHint?.kind === "maintenance" &&
      input.maintenanceHint.retryable === true &&
      typeof input.maintenanceHint.safeCode === "string" &&
      CANCELABLE_MAINTENANCE_SAFE_CODES.has(input.maintenanceHint.safeCode))
  if (cancelableMaintenance) {
    return [
      {
        kind: "cancel_maintenance",
        label: "Cancel retry",
        icon: "close",
        title: safeAction?.safeMessage ?? "Cancel the queued background memory maintenance retry.",
      },
      ...promptExportActions(input.state),
    ]
  }
  const title = safeAction?.safeMessage ?? safeAction?.diagnosticCode
  const diagnostics = shouldOfferDbDiagnostics(input) ? [dbDiagnoseAction(title)] : []
  return [...safeActionButtons(safeAction, diagnostics, title), ...promptExportActions(input.state)]
}

export function lcmMemoryStatusItems(input: {
  state?: LcmSettingsState
  error?: LcmSafeError
  metrics?: LcmMetricsSnapshotMessage
  contextUsage?: ContextUsage
  maintenanceHint?: LcmMaintenanceHint
  nowMs?: number
}): LcmMemoryStatusItem[] {
  const state = input.state
  const metrics = input.metrics
  const usage = input.contextUsage
  const items: LcmMemoryStatusItem[] = [
    lastSyncItem(metrics, input.nowMs),
    maintenanceItem(input.maintenanceHint, metrics),
    activeBudgetItem(usage),
    rawLaneItem(usage),
    softBacklogItem(usage),
    storageItem(state, metrics),
  ]

  const tokenCounter = tokenCounterItem(usage)
  if (tokenCounter) items.push(tokenCounter)

  const modelLimits = modelLimitItem(usage)
  if (modelLimits) items.push(modelLimits)

  const actionItem = nextStepItem(safeActionStatus(input))
  if (actionItem) items.push(actionItem)

  return items
}
