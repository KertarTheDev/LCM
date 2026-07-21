// kilocode_change - new file
import fs from "node:fs/promises"
import path from "node:path"
import { emptyContextItemCounts, emptyLaneTokens } from "./context-snapshot"
import { resolveLcmControlDataRoot, resolveLcmDbLayout, resolveLcmFamiliesRoot } from "./db-layout"
import * as LcmConfig from "./config"
import type {
  ContextItemType,
  ConversationID,
  ISO8601,
  LcmBudgetStatus,
  LcmLaneDecision,
  LcmLaneKey,
  LcmLaneLatchDiagnostic,
  LcmLaneLatchEnteredReason,
  LcmLaneLatchExitReason,
  LcmLaneLatchPhase,
  LcmLifecycleState,
  LcmMaintenanceResult,
  LcmMetricsSnapshot,
  LcmSoftPressureReason,
  LcmStrategy,
  LcmUsagePurpose,
  LcmUsageRecord,
} from "./types"

export type LcmMetricsQueryable = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

type UsageCostRecord = Pick<LcmUsageRecord, "purpose" | "costAmount" | "costCurrency" | "costStatus">
type SnapshotBudgetRow = {
  strategy: LcmStrategy
  active_tokens: number | string | bigint
  hard_limit: number | string | bigint
  soft_threshold: number | string | bigint
  soft_backlog_tokens?: number | string | bigint
  soft_backlog_item_count?: number | string | bigint
  token_counter_mode?: LcmMetricsSnapshot["tokenCounterMode"]
  token_counter_version?: string
  lane_counts_json: unknown
  metrics_json: unknown
}
type DeferredSoftMaintenanceDebtRow = {
  queued_count: number | string | bigint
  max_attempt_count: number | string | bigint | null
  next_run_at_ms: number | string | bigint | null
}

type CostTotalFields = Pick<
  LcmMetricsSnapshot,
  "memoryMaintenanceCostTotal" | "retrievalCostTotal" | "fileExplorationCostTotal" | "mapCostTotal" | "currency"
>

const MEMORY_MAINTENANCE_PURPOSES = new Set<LcmUsagePurpose>(["leaf_summary", "condensation", "hard_limit_maintenance"])
export const LCM_AGGREGATE_STORAGE_BYTES_TTL_MS = 10_000

const COST_FIELD_BY_PURPOSE: Record<LcmUsagePurpose, keyof Omit<CostTotalFields, "currency">> = {
  leaf_summary: "memoryMaintenanceCostTotal",
  condensation: "memoryMaintenanceCostTotal",
  hard_limit_maintenance: "memoryMaintenanceCostTotal",
  retrieval_expand_query: "retrievalCostTotal",
  file_exploration: "fileExplorationCostTotal",
  llm_map: "mapCostTotal",
}

function budgetStatusFromMetrics(value: unknown): LcmBudgetStatus | undefined {
  return value === "budgeted" || value === "unavailable" || value === "provider_limit_fallback" ? value : undefined
}

function softPressureReasonFromMetrics(value: unknown): LcmSoftPressureReason | undefined {
  return value === "global_soft_threshold" || value === "below_soft_raw_backlog" || value === "lane_latch"
    ? value
    : undefined
}

function laneKeyFromMetrics(value: unknown): LcmLaneKey | undefined {
  return value === "raw_leaves" ||
    value === "sprigs" ||
    value === "bindles" ||
    value === "archive_stubs" ||
    value === "large_file_markers" ||
    value === "retrieval_cues"
    ? value
    : undefined
}

function latchPhaseFromMetrics(value: unknown): LcmLaneLatchPhase | undefined {
  return value === "entered" || value === "staying" || value === "exited" ? value : undefined
}

function latchEnteredReasonFromMetrics(value: unknown): LcmLaneLatchEnteredReason | undefined {
  const softReason = softPressureReasonFromMetrics(value)
  if (softReason) return softReason
  return value === "hard_limit" ? value : undefined
}

function latchExitReasonFromMetrics(value: unknown): LcmLaneLatchExitReason | undefined {
  return value === "at_or_below_target" ||
    value === "no_eligible_items" ||
    value === "strategy_changed" ||
    value === "maintenance_failed" ||
    value === "maintenance_canceled"
    ? value
    : undefined
}

function asNumber(value: unknown, fallback = 0): number {
  const next = typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : value
  return typeof next === "number" && Number.isFinite(next) ? next : fallback
}

function optionalNumber(value: unknown): number | undefined {
  const next = typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : value
  return typeof next === "number" && Number.isFinite(next) ? next : undefined
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function coerceLaneTokens(value: unknown): Record<LcmLaneDecision["lane"], number> {
  const lanes = emptyLaneTokens()
  const parsed = parseJsonRecord(value)
  if (!parsed) return lanes
  for (const key of Object.keys(lanes) as Array<LcmLaneDecision["lane"]>) {
    lanes[key] = asNumber(parsed[key])
  }
  return lanes
}

function coerceLaneLatchDiagnostics(value: unknown): LcmLaneLatchDiagnostic[] | undefined {
  if (!Array.isArray(value)) return undefined
  const diagnostics: LcmLaneLatchDiagnostic[] = []
  for (const item of value) {
    const parsed = parseJsonRecord(item)
    if (!parsed) continue
    const lane = laneKeyFromMetrics(parsed.lane)
    const phase = latchPhaseFromMetrics(parsed.phase)
    const enteredReason = latchEnteredReasonFromMetrics(parsed.enteredReason)
    const strategy = parsed.strategy === "upward" || parsed.strategy === "dolt" ? parsed.strategy : undefined
    const nextAction =
      parsed.nextAction === "summarize_leaves" ||
      parsed.nextAction === "condense_summaries" ||
      parsed.nextAction === "create_archive_stub"
        ? parsed.nextAction
        : undefined
    if (!lane || !phase || !enteredReason || !strategy || !nextAction) continue
    const conversationID =
      typeof parsed.conversationID === "string" && parsed.conversationID.startsWith("conv_")
        ? (parsed.conversationID as ConversationID)
        : undefined
    if (!conversationID) continue
    diagnostics.push({
      lane,
      conversationID,
      strategy,
      enteredReason,
      enteredPressure: asNumber(parsed.enteredPressure),
      targetTokens: asNumber(parsed.targetTokens),
      lastObservedPressure: asNumber(parsed.lastObservedPressure),
      updatedAtMs: asNumber(parsed.updatedAtMs),
      nextAction,
      phase,
      ...(latchExitReasonFromMetrics(parsed.exitReason) === undefined
        ? {}
        : { exitReason: latchExitReasonFromMetrics(parsed.exitReason) }),
    })
  }
  return diagnostics.length > 0 ? diagnostics : undefined
}

function coerceContextItemCounts(rows: Array<{ item_type: string; count: number | string | bigint }>) {
  const counts = emptyContextItemCounts()
  for (const row of rows) {
    const key = row.item_type as ContextItemType
    if (key in counts) counts[key] = asNumber(row.count)
  }
  return counts
}

async function storageBytesUnder(rootDir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      total += await storageBytesUnder(target)
      continue
    }
    const stat = await fs.lstat(target)
    total += stat.size
  }
  return total
}

export async function calculateLcmStorageBytes(dataDir: string): Promise<number> {
  const layout = resolveLcmDbLayout(dataDir)
  try {
    return await storageBytesUnder(layout.rootDir)
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") return 0
    throw error
  }
}

export async function calculateAggregateLcmStorageBytes(kiloDataDir: string): Promise<number> {
  let total = 0
  const familiesRoot = resolveLcmFamiliesRoot(kiloDataDir)
  const controlRoot = resolveLcmControlDataRoot(kiloDataDir)
  const familyEntries = await fs.readdir(familiesRoot, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") return []
    throw error
  })
  for (const entry of familyEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith("family_")) continue
    total += await calculateLcmStorageBytes(path.join(familiesRoot, entry.name))
  }
  total += await storageBytesUnder(controlRoot).catch((error) => {
    if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") return 0
    throw error
  })
  return total
}

export function createAggregateLcmStorageBytesSampler(input: {
  readonly resolveKiloDataDir: () => string
  readonly ttlMs?: number
  readonly now?: () => number
  readonly calculate?: (kiloDataDir: string) => Promise<number>
}) {
  const ttlMs = Math.max(0, input.ttlMs ?? LCM_AGGREGATE_STORAGE_BYTES_TTL_MS)
  const now = input.now ?? Date.now
  const calculate = input.calculate ?? calculateAggregateLcmStorageBytes
  let cache: { kiloDataDir: string; value: number; expiresAtMs: number } | undefined
  let inFlight: { kiloDataDir: string; promise: Promise<number> } | undefined

  return {
    read() {
      const kiloDataDir = input.resolveKiloDataDir()
      const nowMs = now()
      if (cache && cache.kiloDataDir === kiloDataDir && cache.expiresAtMs > nowMs) {
        return Promise.resolve(cache.value)
      }
      if (inFlight?.kiloDataDir === kiloDataDir) return inFlight.promise

      const promise = calculate(kiloDataDir).then((value) => {
        cache = { kiloDataDir, value, expiresAtMs: now() + ttlMs }
        return value
      })
      inFlight = { kiloDataDir, promise }
      return promise.finally(() => {
        if (inFlight?.promise === promise) inFlight = undefined
      })
    },
    invalidate() {
      cache = undefined
    },
  }
}

export function aggregateLcmUsageCosts(records: readonly UsageCostRecord[]): CostTotalFields {
  const totals: Required<Omit<CostTotalFields, "currency">> = {
    memoryMaintenanceCostTotal: 0,
    retrievalCostTotal: 0,
    fileExplorationCostTotal: 0,
    mapCostTotal: 0,
  }
  const currencies = new Set<string>()
  let included = false

  for (const record of records) {
    if (record.costStatus !== "provider_reported") continue
    if (record.costAmount === undefined || !Number.isFinite(record.costAmount) || record.costAmount <= 0) continue
    const currency = record.costCurrency?.trim()
    if (!currency) continue
    currencies.add(currency)
    included = true
    totals[COST_FIELD_BY_PURPOSE[record.purpose]] += record.costAmount
  }

  if (!included || currencies.size !== 1) return {}

  const output: CostTotalFields = { currency: [...currencies][0] }
  for (const [key, value] of Object.entries(totals) as Array<[keyof typeof totals, number]>) {
    if (value > 0) output[key] = value
  }
  return output
}

export async function readLcmMetricsSnapshot(input: {
  db: LcmMetricsQueryable
  conversationID: ConversationID
  strategy: LcmStrategy
  storageBytes: number
  storageWarningThresholdBytes: number
  lastMaintenance?: LcmMaintenanceResult
  updatedAt?: ISO8601
}): Promise<LcmMetricsSnapshot> {
  const [conversation, snapshot, budgetSnapshot, contextCounts, usage, deferredDebt] = await Promise.all([
    input.db.query<{ lifecycle_state: LcmLifecycleState }>(
      "SELECT lifecycle_state FROM lcm_conversations WHERE conversation_id = $1",
      [input.conversationID],
    ),
    input.db.query<SnapshotBudgetRow>(
      `
        SELECT strategy, active_tokens, hard_limit, soft_threshold, soft_backlog_tokens, soft_backlog_item_count, token_counter_mode, token_counter_version, lane_counts_json, metrics_json
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
        ORDER BY created_at_ms DESC, snapshot_id DESC
        LIMIT 1
      `,
      [input.conversationID],
    ),
    input.db.query<SnapshotBudgetRow>(
      `
        SELECT strategy, active_tokens, hard_limit, soft_threshold, soft_backlog_tokens, soft_backlog_item_count, token_counter_mode, token_counter_version, lane_counts_json, metrics_json
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
          AND hard_limit > 0
          AND soft_threshold > 0
        ORDER BY created_at_ms DESC, snapshot_id DESC
        LIMIT 1
      `,
      [input.conversationID],
    ),
    input.db.query<{ item_type: string; count: number | string | bigint }>(
      `
        SELECT item_type, count(*)::int AS count
        FROM lcm_context_items
        WHERE conversation_id = $1
        GROUP BY item_type
      `,
      [input.conversationID],
    ),
    input.db.query<{
      purpose: LcmUsagePurpose
      cost_amount: number | string | null
      cost_currency: string | null
      cost_status: LcmUsageRecord["costStatus"]
    }>(
      `
        SELECT purpose, cost_amount, cost_currency, cost_status
        FROM lcm_usage_records
        WHERE conversation_id = $1
      `,
      [input.conversationID],
    ),
    input.db.query<DeferredSoftMaintenanceDebtRow>(
      `
        SELECT
          count(*)::int AS queued_count,
          max(attempt_count)::int AS max_attempt_count,
          min(next_run_at_ms)::bigint AS next_run_at_ms
        FROM lcm_deferred_jobs
        WHERE conversation_id = $1
          AND job_kind = 'soft_maintenance'
          AND status = 'queued'
      `,
      [input.conversationID],
    ),
  ])

  const latest = snapshot.rows[0]
  const latestBudget = budgetSnapshot.rows[0]
  const latestMetrics = parseJsonRecord(latest?.metrics_json)
  const latestBudgetMetrics = parseJsonRecord(latestBudget?.metrics_json)
  const costs = aggregateLcmUsageCosts(
    usage.rows.map((row) => ({
      purpose: row.purpose,
      costAmount: row.cost_amount === null ? undefined : asNumber(row.cost_amount, Number.NaN),
      costCurrency: row.cost_currency ?? undefined,
      costStatus: row.cost_status,
    })),
  )
  const activeTokens = asNumber(latest?.active_tokens)
  const hardLimit = asNumber(latestBudget?.hard_limit ?? latest?.hard_limit)
  const softThreshold = asNumber(latestBudget?.soft_threshold ?? latest?.soft_threshold)
  const freshTailTokens = asNumber(latestMetrics?.freshTailTokens)
  const softBacklogTokens = asNumber(latest?.soft_backlog_tokens)
  const freshTailRawTokens = asNumber(latestMetrics?.freshTailRawTokens)
  const freshTailRawItemCount = asNumber(latestMetrics?.freshTailRawItemCount)
  const unconsumedRawTokens = asNumber(latestMetrics?.unconsumedRawTokens)
  const unconsumedRawItemCount = asNumber(latestMetrics?.unconsumedRawItemCount)
  const protectedTailRawTokens = asNumber(latestMetrics?.protectedTailRawTokens)
  const protectedTailRawItemCount = asNumber(latestMetrics?.protectedTailRawItemCount)
  const softBacklogLargestSourceTokens = optionalNumber(latestMetrics?.softBacklogLargestSourceTokens)
  const deferredDebtRow = deferredDebt.rows[0]
  const deferredSoftMaintenanceQueuedCount = Math.max(0, asNumber(deferredDebtRow?.queued_count))
  const deferredSoftMaintenanceAttemptCount = optionalNumber(deferredDebtRow?.max_attempt_count)
  const deferredSoftMaintenanceNextRunAtMs = optionalNumber(deferredDebtRow?.next_run_at_ms)
  const rawLaneTokens = asNumber(latestMetrics?.rawLaneTokens, softBacklogTokens + protectedTailRawTokens)
  const budgetStatus =
    budgetStatusFromMetrics(latestBudgetMetrics?.budgetStatus ?? latestMetrics?.budgetStatus) ??
    (hardLimit > 0 && softThreshold > 0 ? "budgeted" : "unavailable")
  const providerContextLimit = optionalNumber(latestBudgetMetrics?.providerContextLimit)
  const providerInputLimit = optionalNumber(latestBudgetMetrics?.providerInputLimit)
  const providerOutputLimit = optionalNumber(latestBudgetMetrics?.providerOutputLimit)
  const outputReserve = optionalNumber(latestBudgetMetrics?.outputReserve)
  const systemPromptTokens = optionalNumber(latestBudgetMetrics?.systemPromptTokens)
  const toolSchemaTokens = optionalNumber(latestBudgetMetrics?.toolSchemaTokens)
  const softPressureReason = softPressureReasonFromMetrics(latestMetrics?.softPressureReason)
  const laneLatchDiagnostics = coerceLaneLatchDiagnostics(latestMetrics?.laneLatchDiagnostics)

  return {
    conversationID: input.conversationID,
    lifecycleState: conversation.rows[0]?.lifecycle_state ?? "db_unavailable",
    strategy: latest?.strategy ?? input.strategy,
    activeTokens,
    hardLimit,
    softThreshold,
    freshTailTokens,
    softBacklogTokens,
    softBacklogItemCount: asNumber(latest?.soft_backlog_item_count),
    ...(softBacklogLargestSourceTokens === undefined ? {} : { softBacklogLargestSourceTokens }),
    freshTailRawTokens,
    freshTailRawItemCount,
    unconsumedRawTokens,
    unconsumedRawItemCount,
    protectedTailRawTokens,
    protectedTailRawItemCount,
    rawLaneTokens,
    hardFillRatio: hardLimit > 0 ? activeTokens / hardLimit : 0,
    rawLaneRatio: softThreshold > 0 ? rawLaneTokens / softThreshold : 0,
    softBacklogRatio: softThreshold > 0 ? softBacklogTokens / softThreshold : 0,
    budgetStatus,
    ...(softPressureReason === undefined ? {} : { softPressureReason }),
    ...(laneLatchDiagnostics === undefined ? {} : { laneLatchDiagnostics }),
    ...(providerContextLimit === undefined ? {} : { providerContextLimit }),
    ...(providerInputLimit === undefined ? {} : { providerInputLimit }),
    ...(providerOutputLimit === undefined ? {} : { providerOutputLimit }),
    ...(outputReserve === undefined ? {} : { outputReserve }),
    ...(systemPromptTokens === undefined ? {} : { systemPromptTokens }),
    ...(toolSchemaTokens === undefined ? {} : { toolSchemaTokens }),
    providerCapacityDeferred:
      input.lastMaintenance?.safeError?.code === "provider_capacity_deferred" ? true : undefined,
    providerEndpointKeyHash:
      input.lastMaintenance?.safeError?.code === "provider_capacity_deferred"
        ? (input.lastMaintenance.safeError.safeParams as { providerEndpointKeyHash?: string }).providerEndpointKeyHash
        : undefined,
    tokenCounterMode: latest?.token_counter_mode ?? latestBudget?.token_counter_mode ?? "deterministic_fallback",
    tokenCounterVersion:
      latest?.token_counter_version ??
      latestBudget?.token_counter_version ??
      "lcm-deterministic-fallback-token-counter-v1",
    laneTokens: coerceLaneTokens(latest?.lane_counts_json),
    contextItemCounts: coerceContextItemCounts(contextCounts.rows),
    deferredSoftMaintenanceQueued: deferredSoftMaintenanceQueuedCount > 0,
    deferredSoftMaintenanceQueuedCount,
    ...(deferredSoftMaintenanceAttemptCount === undefined ? {} : { deferredSoftMaintenanceAttemptCount }),
    ...(deferredSoftMaintenanceNextRunAtMs === undefined ? {} : { deferredSoftMaintenanceNextRunAtMs }),
    storageBytes: input.storageBytes,
    storageWarningThresholdBytes: input.storageWarningThresholdBytes,
    storageWarning: LcmConfig.storageWarning({
      storageBytes: input.storageBytes,
      warningThresholdBytes: input.storageWarningThresholdBytes,
    }),
    ...costs,
    ...(input.lastMaintenance
      ? {
          lastMaintenance: {
            operationID: input.lastMaintenance.operationID,
            status: input.lastMaintenance.status,
            reason: input.lastMaintenance.reason,
            blocking: input.lastMaintenance.blocking,
            ...(input.lastMaintenance.beforeTokens !== undefined
              ? { beforeTokens: input.lastMaintenance.beforeTokens }
              : {}),
            ...(input.lastMaintenance.afterTokens !== undefined
              ? { afterTokens: input.lastMaintenance.afterTokens }
              : {}),
          },
        }
      : {}),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

export function metricCostTotal(
  input: Pick<
    LcmMetricsSnapshot,
    "memoryMaintenanceCostTotal" | "retrievalCostTotal" | "fileExplorationCostTotal" | "mapCostTotal"
  >,
): number {
  return (
    (input.memoryMaintenanceCostTotal ?? 0) +
    (input.retrievalCostTotal ?? 0) +
    (input.fileExplorationCostTotal ?? 0) +
    (input.mapCostTotal ?? 0)
  )
}

export { MEMORY_MAINTENANCE_PURPOSES }

export * as LcmMetrics from "./metrics"
