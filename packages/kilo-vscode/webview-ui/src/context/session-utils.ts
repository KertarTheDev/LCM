import { reconcile } from "solid-js/store"
import type {
  LcmEventEnvelopeMessage,
  LcmMetricsSnapshotMessage,
  Message,
  Part,
  SessionStatusInfo,
  ToolPart,
} from "../types/messages"

export const SNAPSHOT_PROGRESS_TEXT = "Initializing snapshot..."

type SnapshotPart = {
  type?: string
  text?: string
  synthetic?: boolean
}

export function snapshotProgress(part: SnapshotPart | undefined): boolean {
  if (part?.type !== "text") return false
  if (!part.synthetic) return false
  return (part.text ?? "").includes("Initializing snapshot")
}

type ParentSession = { parentID?: string | null }

type RecentSession = ParentSession & { updatedAt: string }

export function isRootSession(session: ParentSession): boolean {
  return session.parentID === undefined || session.parentID === null
}

export function recentSessions<T extends RecentSession>(sessions: T[]): T[] {
  return [...sessions]
    .filter(isRootSession)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3)
}

/** Minimal message shape for cost breakdown helpers. */
type FiniteNumberInput = number | "NaN" | "Infinity" | "-Infinity" | undefined | null

function finiteNumber(value: FiniteNumberInput): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Minimal message shape for cost breakdown helpers. */
export type CostMessage = { id: string; role: string; cost?: FiniteNumberInput }

/** Minimal tool part shape for label extraction. */
type TaskPart = {
  type: string
  tool?: string
  metadata?: Record<string, unknown>
  state?: {
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
}

function metadataSessionID(metadata: Record<string, unknown> | undefined): string | undefined {
  const sessionId = metadata?.sessionId
  return typeof sessionId === "string" ? sessionId : undefined
}

function inputString(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === "string" ? value : undefined
}

export function childID(part: TaskPart): string | undefined {
  if (part.type !== "tool" || part.tool !== "task") return undefined
  return metadataSessionID(part.metadata) ?? metadataSessionID(part.state?.metadata)
}

function withMessage(part: ToolPart, msg: { id: string; sessionID?: string }): ToolPart {
  return {
    ...part,
    messageID: part.messageID ?? msg.id,
    sessionID: part.sessionID ?? msg.sessionID,
  }
}

export type ToolIndexMessage = Pick<Message, "id" | "sessionID" | "role" | "parts">

/**
 * Build the per-session compact tool index in assistant-message order.
 * Text/reasoning deltas should not touch this index, keeping streaming cheap.
 */
export function buildSessionToolParts(
  messages: ToolIndexMessage[],
  lookup?: (message: ToolIndexMessage) => Part[] | undefined,
): ToolPart[] {
  const tools: ToolPart[] = []
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const parts = lookup?.(msg) ?? msg.parts
    if (!parts) continue
    for (const part of parts) {
      if (part.type !== "tool") continue
      tools.push(withMessage(part, msg))
    }
  }
  return tools
}

export function reconcileSessionToolParts(tools: ToolPart[]) {
  return reconcile(tools, { key: "id" })
}

export function upsertSessionToolPart(
  current: ToolPart[],
  part: Part,
  msg: { id: string; sessionID?: string },
): ToolPart[] {
  if (part.type !== "tool") return current
  const next = withMessage(part, msg)
  const index = current.findIndex((item) => item.id === part.id)
  if (index < 0) return [...current, next]
  const tools = current.slice()
  tools[index] = next
  return tools
}

export function removeSessionToolPart(current: readonly ToolPart[], partID: string): ToolPart[] {
  return current.filter((part) => part.id !== partID)
}

export function removeSessionToolPartsForMessage(current: readonly ToolPart[], messageID: string): ToolPart[] {
  return current.filter((part) => part.messageID !== messageID)
}

/**
 * Derive a human-readable status string from the last streaming part.
 * Returns undefined for part types that don't map to a status.
 */
export function computeStatus(
  part: Part | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | undefined {
  if (!part) return undefined
  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") return t("ui.sessionTurn.status.thinking")
  if (part.type === "text") return snapshotProgress(part) ? SNAPSHOT_PROGRESS_TEXT : t("session.status.writingResponse")
  return undefined
}

export function busyStatusMessage(status: SessionStatusInfo): string | undefined {
  return status.type === "busy" && status.message ? status.message : undefined
}

export type LcmMaintenanceHintState = "pending" | "running" | "completed" | "failed" | "canceled"
export type LcmMaintenanceHintKind = "maintenance" | "db"

export interface LcmMaintenanceHint {
  kind: LcmMaintenanceHintKind
  state: LcmMaintenanceHintState
  label: string
  operationID?: string
  reason?: string
  phase?: string
  blocking: boolean
  updatedAtMs: number
  beforeTokens?: number
  afterTokens?: number
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
  safeMessage?: string
  safeCode?: string
  action?: string
  retryable?: boolean
  diagnosticCode?: string
}

const BACKGROUND_HINT_ACTIVE_TTL_MS = 120_000
const BACKGROUND_HINT_TERMINAL_TTL_MS = 4_000

function isTerminalMaintenanceHint(hint: LcmMaintenanceHint): boolean {
  return hint.state === "completed" || hint.state === "failed" || hint.state === "canceled"
}

export function lcmMaintenanceHintTtlMs(hint: LcmMaintenanceHint): number | undefined {
  if (hint.state === "failed") return undefined
  return isTerminalMaintenanceHint(hint) ? BACKGROUND_HINT_TERMINAL_TTL_MS : BACKGROUND_HINT_ACTIVE_TTL_MS
}

export function isLcmMaintenanceHintExpired(hint: LcmMaintenanceHint, nowMs = Date.now()): boolean {
  const ttlMs = lcmMaintenanceHintTtlMs(hint)
  return ttlMs !== undefined && nowMs - hint.updatedAtMs >= ttlMs
}

function maintenancePayload(event: LcmEventEnvelopeMessage) {
  if (
    event.type !== "lcm.maintenance.started" &&
    event.type !== "lcm.maintenance.ended" &&
    event.type !== "lcm.maintenance.failed"
  ) {
    return undefined
  }
  return event.payload
}

type LcmMaintenancePayload = NonNullable<ReturnType<typeof maintenancePayload>>

function safeErrorLabel(
  safeError: { code?: string; action?: string; retryable?: boolean } | undefined,
  fallback: string,
): string {
  switch (safeError?.code) {
    case "db_locked":
      return "Memory locked"
    case "db_corrupt":
    case "recovery_failed":
    case "recovery_required":
    case "missing_source":
    case "stale_source":
      return "Memory recovery needed"
    case "provider_capacity_deferred":
      return "Memory will retry"
    case "provider_unavailable":
      return "Memory provider unavailable"
    case "hard_limit_unresolved":
      return "Memory needs attention"
    case "timeout":
      return "Memory timed out"
    case "canceled":
      return "Memory canceled"
    case "db_unavailable":
    case "db_migration_failed":
      return "Memory unavailable"
    default:
      return fallback
  }
}

function activeMaintenanceLabel(payload: LcmMaintenancePayload): string {
  if (payload.safeLabel) return payload.safeLabel
  if (payload.blocking) return "Preparing memory"
  return payload.status === "scheduled" ? "Memory pending" : "Summarizing memory"
}

function maintenanceHintBase(payload: LcmMaintenancePayload, operationID: string, nowMs: number) {
  return {
    kind: "maintenance" as const,
    operationID,
    reason: payload.reason,
    phase: payload.phase,
    blocking: payload.blocking,
    updatedAtMs: nowMs,
    beforeTokens: finiteNumber(payload.beforeTokens),
    afterTokens: finiteNumber(payload.afterTokens),
    hardLimit: finiteNumber(payload.hardLimit),
    softThreshold: finiteNumber(payload.softThreshold),
    freshTailTokens: finiteNumber(payload.freshTailTokens),
    softBacklogTokens: finiteNumber(payload.softBacklogTokens),
    softBacklogItemCount: finiteNumber(payload.softBacklogItemCount),
    freshTailRawTokens: finiteNumber(payload.freshTailRawTokens),
    freshTailRawItemCount: finiteNumber(payload.freshTailRawItemCount),
    unconsumedRawTokens: finiteNumber(payload.unconsumedRawTokens),
    unconsumedRawItemCount: finiteNumber(payload.unconsumedRawItemCount),
    protectedTailRawTokens: finiteNumber(payload.protectedTailRawTokens),
    protectedTailRawItemCount: finiteNumber(payload.protectedTailRawItemCount),
    rawLaneTokens: finiteNumber(payload.rawLaneTokens),
    rawLaneRatio: finiteNumber(payload.rawLaneRatio),
    softBacklogRatio: finiteNumber(payload.softBacklogRatio),
    safeMessage: payload.safeError?.safeMessage,
    safeCode: payload.safeError?.code,
    action: payload.safeError?.action,
    retryable: payload.safeError?.retryable,
    diagnosticCode: payload.safeError?.diagnosticCode,
  }
}

function maintenanceHintFromEvent(
  current: LcmMaintenanceHint | undefined,
  event: LcmEventEnvelopeMessage,
  payload: LcmMaintenancePayload,
  nowMs: number,
): LcmMaintenanceHint | undefined {
  if (payload.reason !== "soft_threshold" && payload.reason !== "hard_limit") return current

  const operationID = event.operationID
  if (!operationID) return current
  if (current?.operationID && current.operationID !== operationID && !isTerminalMaintenanceHint(current)) return current

  const base = maintenanceHintBase(payload, operationID, nowMs)
  if (event.type === "lcm.maintenance.started") {
    const state = payload.status === "scheduled" ? "pending" : "running"
    return { ...base, state, label: activeMaintenanceLabel(payload) }
  }

  if (current?.operationID && current.operationID !== operationID && payload.status !== "canceled") return current
  if (event.type === "lcm.maintenance.failed") {
    if (payload.status === "canceled") {
      return { ...base, state: "canceled", label: "Memory canceled" }
    }
    const fallback = payload.blocking ? "Memory blocked" : "Memory summary failed"
    return { ...base, state: "failed", label: safeErrorLabel(payload.safeError, fallback) }
  }
  if (payload.status === "canceled") {
    return { ...base, state: "canceled", label: "Retry canceled" }
  }
  return { ...base, state: "completed", label: payload.blocking ? "Memory ready" : "Memory updated" }
}

function dbStatusHintFromEvent(
  current: LcmMaintenanceHint | undefined,
  event: LcmEventEnvelopeMessage,
  nowMs: number,
): LcmMaintenanceHint | undefined {
  if (event.type !== "lcm.db.status") return current
  const payload = event.payload
  if (payload.dbReady || payload.status === "ready") return current?.kind === "db" ? undefined : current
  if (payload.status !== "locked" && payload.status !== "corrupt" && payload.status !== "unavailable") return current

  const safeError = payload.safeError
  return {
    kind: "db",
    state: "failed",
    label: safeErrorLabel(safeError, "Memory unavailable"),
    operationID: event.operationID,
    blocking: false,
    updatedAtMs: nowMs,
    safeMessage: safeError?.safeMessage,
    safeCode: safeError?.code,
    action: safeError?.action,
    retryable: safeError?.retryable,
    diagnosticCode: safeError?.diagnosticCode,
  }
}

export function lcmMaintenanceHintFromEvent(
  current: LcmMaintenanceHint | undefined,
  event: LcmEventEnvelopeMessage,
  nowMs = Date.now(),
): LcmMaintenanceHint | undefined {
  const payload = maintenancePayload(event)
  if (!payload) return dbStatusHintFromEvent(current, event, nowMs)
  return maintenanceHintFromEvent(current, event, payload, nowMs)
}

export function lcmMetricKeysFromEvent(event: LcmEventEnvelopeMessage): string[] {
  if (event.type !== "lcm.metrics.updated") return []
  const keys = new Set<string>()
  for (const key of [event.sessionID, event.conversationID, event.payload.conversationID]) {
    if (key) keys.add(key)
  }
  return [...keys]
}

/**
 * Calculate total cost across all assistant messages.
 */
export function calcTotalCost(messages: Array<{ role: string; cost?: FiniteNumberInput }>): number {
  return messages.reduce((sum, m) => sum + (m.role === "assistant" ? (finiteNumber(m.cost) ?? 0) : 0), 0)
}

export function calcLcmMetricsCostTotal(metrics: LcmMetricsSnapshotMessage | undefined): number {
  if (!metrics) return 0
  return (
    (finiteNumber(metrics.memoryMaintenanceCostTotal) ?? 0) +
    (finiteNumber(metrics.retrievalCostTotal) ?? 0) +
    (finiteNumber(metrics.fileExplorationCostTotal) ?? 0) +
    (finiteNumber(metrics.mapCostTotal) ?? 0)
  )
}

export function lcmContextUsageFromMetrics(metrics: LcmMetricsSnapshotMessage | undefined):
  | {
      tokens: number
      percentage: number | null
      source: "lcm_active_budget"
      label: string
      limit?: number
      providerContextLimit?: number
      providerOutputLimit?: number
      outputReserve?: number
      systemPromptTokens?: number
      toolSchemaTokens?: number
      tokenCounterMode?: string
      tokenCounterVersion?: string
      freshTailTokens?: number
      softBacklogTokens?: number
      softThreshold?: number
      freshTailRawTokens?: number
      freshTailRawItemCount?: number
      unconsumedRawTokens?: number
      unconsumedRawItemCount?: number
      protectedTailRawTokens?: number
      protectedTailRawItemCount?: number
      rawLaneTokens?: number
      hardFillRatio?: number | null
      rawLaneRatio?: number | null
      softBacklogRatio?: number | null
      budgetStatus?: "budgeted" | "unavailable" | "provider_limit_fallback"
    }
  | undefined {
  if (!metrics) return undefined
  const activeTokens = finiteNumber(metrics.activeTokens)
  if (activeTokens === undefined || activeTokens <= 0) return undefined

  const hardLimit = finiteNumber(metrics.hardLimit) ?? 0
  const freshTailTokens = finiteNumber(metrics.freshTailTokens) ?? 0
  const softBacklogTokens = finiteNumber(metrics.softBacklogTokens) ?? 0
  const softThreshold = finiteNumber(metrics.softThreshold) ?? 0
  const freshTailRawTokens = finiteNumber(metrics.freshTailRawTokens) ?? 0
  const freshTailRawItemCount = finiteNumber(metrics.freshTailRawItemCount)
  const unconsumedRawTokens = finiteNumber(metrics.unconsumedRawTokens) ?? 0
  const unconsumedRawItemCount = finiteNumber(metrics.unconsumedRawItemCount)
  const protectedTailRawTokens = finiteNumber(metrics.protectedTailRawTokens) ?? 0
  const rawLaneTokens = finiteNumber(metrics.rawLaneTokens) ?? softBacklogTokens + protectedTailRawTokens
  const percentage = hardLimit > 0 ? Math.round((activeTokens / hardLimit) * 100) : null

  return {
    tokens: activeTokens,
    percentage,
    source: "lcm_active_budget",
    label: "Memory active budget",
    limit: hardLimit > 0 ? hardLimit : undefined,
    providerContextLimit: finiteNumber(metrics.providerContextLimit),
    providerOutputLimit: finiteNumber(metrics.providerOutputLimit),
    outputReserve: finiteNumber(metrics.outputReserve),
    systemPromptTokens: finiteNumber(metrics.systemPromptTokens),
    toolSchemaTokens: finiteNumber(metrics.toolSchemaTokens),
    tokenCounterMode: metrics.tokenCounterMode,
    tokenCounterVersion: metrics.tokenCounterVersion,
    freshTailTokens,
    softBacklogTokens,
    softThreshold,
    freshTailRawTokens,
    freshTailRawItemCount,
    unconsumedRawTokens,
    unconsumedRawItemCount,
    protectedTailRawTokens,
    protectedTailRawItemCount: finiteNumber(metrics.protectedTailRawItemCount),
    rawLaneTokens,
    hardFillRatio: hardLimit > 0 ? activeTokens / hardLimit : null,
    rawLaneRatio: softThreshold > 0 ? rawLaneTokens / softThreshold : null,
    softBacklogRatio: softThreshold > 0 ? softBacklogTokens / softThreshold : null,
    budgetStatus: metrics.budgetStatus,
  }
}

/**
 * Calculate context usage percentage given token counts and a context limit.
 */
export function calcContextUsage(
  tokens: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  },
  contextLimit: number | undefined,
): { tokens: number; percentage: number | null; source: "provider_context"; label: string; limit?: number } {
  const total =
    tokens.input + tokens.output + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  const percentage = contextLimit ? Math.round((total / contextLimit) * 100) : null
  return {
    tokens: total,
    percentage,
    source: "provider_context",
    label: "Provider context",
    limit: contextLimit,
  }
}

export type TokenUsageMessage = {
  role: string
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
}

export function calcTokenUsage(
  messages: TokenUsageMessage[],
): { input: number; output: number; cached: number } | undefined {
  const total = messages.reduce(
    (sum, m) => {
      if (m.role !== "assistant" || !m.tokens) return sum
      return {
        input: sum.input + m.tokens.input,
        output: sum.output + m.tokens.output,
        cached: sum.cached + (m.tokens.cache?.read ?? 0),
      }
    },
    { input: 0, output: 0, cached: 0 },
  )

  if (total.input > 0 || total.output > 0 || total.cached > 0) return total
  return undefined
}

/**
 * Build a map of session ID → **own cost** for each session in the family
 * that has non-zero own cost.
 *
 * The CLI backend already propagates each subagent's total up into its
 * parent assistant message when the subagent finishes (see
 * `packages/opencode/src/kilocode/session/cost-propagation.ts`), so a
 * session's `message.info.cost` sum is actually the whole sub-tree rooted
 * at that session, not its own LLM usage. Summing every session in the
 * family would double-count the propagated amounts.
 *
 * To present a breakdown whose entries sum to the root's propagated total
 * (== the family's true cost), we subtract each session's propagated
 * total from its parent's figure. The root's entry then holds its own
 * LLM cost, each subagent's entry holds its own LLM cost, and the sum
 * equals the root's `message.info.cost` — matching the backend's number.
 *
 * Pure function — no store dependency.
 */
export function buildFamilyCosts(
  family: Set<string>,
  messages: Record<string, Array<{ role: string; cost?: FiniteNumberInput }>>,
  sessions: Record<string, { parentID?: string | null } | undefined> = {},
  parents: Map<string, string> = new Map(),
  lcmMetrics: Record<string, LcmMetricsSnapshotMessage | undefined> = {},
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const sid of family) totals.set(sid, calcTotalCost(messages[sid] ?? []))

  const own = new Map<string, number>(totals)
  for (const sid of family) {
    const parent = sessions[sid]?.parentID ?? parents.get(sid)
    if (!parent || !own.has(parent)) continue
    own.set(parent, (own.get(parent) ?? 0) - (totals.get(sid) ?? 0))
  }

  const costs = new Map<string, number>()
  for (const [sid, cost] of own) {
    const total = cost + calcLcmMetricsCostTotal(lcmMetrics[sid])
    if (total > 0) costs.set(sid, total)
  }
  return costs
}

/**
 * Build child session ID -> parent session ID links from task tool metadata.
 * This fills the gap when child messages are synced before their SessionInfo.
 */
export function buildFamilyParents(
  family: Set<string>,
  messages: Record<string, CostMessage[]>,
  parts: Record<string, TaskPart[]>,
): Map<string, string> {
  return buildFamilyParentsFromTools(family, (sid) => {
    const msgs = messages[sid]
    if (!msgs) return []
    return msgs.flatMap((msg) => parts[msg.id] ?? [])
  })
}

export function buildFamilyParentsFromTools(
  family: Set<string>,
  tools: (sessionID: string) => readonly TaskPart[],
): Map<string, string> {
  const parents = new Map<string, string>()
  for (const sid of family) {
    for (const p of tools(sid)) {
      const child = childID(p)
      if (!child || !family.has(child) || parents.has(child)) continue
      parents.set(child, sid)
    }
  }
  return parents
}

const LABEL_CAP = 24

/**
 * Build a map of child session ID → label by scanning tool parts in the
 * family for task tool metadata. Pure function — no store dependency.
 */
export function buildFamilyLabels(
  family: Set<string>,
  messages: Record<string, Array<{ id: string }>>,
  parts: Record<string, Part[]>,
): Map<string, string> {
  return buildFamilyLabelsFromTools(family, (sid) => {
    const msgs = messages[sid]
    if (!msgs) return []
    return msgs.flatMap((msg) => parts[msg.id] ?? [])
  })
}

export function buildFamilyLabelsFromTools(
  family: Set<string>,
  tools: (sessionID: string) => readonly TaskPart[],
): Map<string, string> {
  const labels = new Map<string, string>()
  for (const sid of family) {
    for (const p of tools(sid)) {
      if (p.type !== "tool") continue
      const child = childID(p)
      if (!child || !family.has(child)) continue
      const raw =
        inputString(p.state?.input, "subagent_type") ?? inputString(p.state?.input, "description") ?? p.tool ?? "task"
      const desc = raw.length > LABEL_CAP ? raw.slice(0, LABEL_CAP - 2) + "…" : raw
      if (!labels.has(child)) labels.set(child, desc)
    }
  }
  return labels
}

/**
 * Combine costs and labels into the final breakdown array.
 * Pure function — no store dependency.
 */
export function buildCostBreakdown(
  root: string,
  costs: Map<string, number>,
  labels: Map<string, string>,
  rootLabel: string,
): Array<{ label: string; cost: number }> {
  const items: Array<{ label: string; cost: number }> = []
  for (const [sid, cost] of costs) {
    const label = sid === root ? rootLabel : (labels.get(sid) ?? sid.slice(0, 8))
    items.push({ label, cost })
  }
  return items
}

const VISIBLE_CHILDREN = 8

/**
 * Collapse a cost breakdown for display in the tooltip.
 * - The root entry (first item) always stays at the top.
 * - Child entries are shown in reverse order (most recent first).
 * - When there are more than VISIBLE_CHILDREN child entries, the
 *   oldest are aggregated into a single summary line.
 *
 * Pure function — no store dependency.
 */
export function collapseCostBreakdown(
  items: Array<{ label: string; cost: number }>,
  summaryLabel: (count: number) => string,
): Array<{ label: string; cost: number }> {
  const root = items[0]
  const children = items.slice(1)
  const reversed = [...children].reverse()

  if (reversed.length <= VISIBLE_CHILDREN) return [root, ...reversed]

  const visible = reversed.slice(0, VISIBLE_CHILDREN)
  const hidden = reversed.slice(VISIBLE_CHILDREN)
  const aggregated = hidden.reduce((sum, e) => sum + e.cost, 0)
  return [root, ...visible, { label: summaryLabel(hidden.length), cost: aggregated }]
}
