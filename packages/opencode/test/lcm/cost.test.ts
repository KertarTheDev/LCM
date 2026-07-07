// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import {
  aggregateLcmUsageCosts,
  calculateAggregateLcmStorageBytes,
  calculateLcmStorageBytes,
  createAggregateLcmStorageBytesSampler,
  readLcmMetricsSnapshot,
} from "../../src/session/lcm/metrics"
import { deriveLcmFamilyID } from "../../src/session/lcm/family"
import { resolveLcmControlDataRoot, resolveLcmControlRoot, resolveLcmFamilyRoot } from "../../src/session/lcm/db-layout"
import type { ConversationID, LcmUsageRecord, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

function usage(
  purpose: LcmUsageRecord["purpose"],
  costAmount: number | undefined,
  costCurrency: string | undefined,
  costStatus: LcmUsageRecord["costStatus"] = "provider_reported",
): Pick<LcmUsageRecord, "purpose" | "costAmount" | "costCurrency" | "costStatus"> {
  return { purpose, costAmount, costCurrency, costStatus }
}

test("LCM usage cost aggregation groups provider-reported costs by safe category", () => {
  const costs = aggregateLcmUsageCosts([
    usage("leaf_summary", 0.1, "USD"),
    usage("condensation", 0.2, "USD"),
    usage("hard_limit_maintenance", 0.3, "USD"),
    usage("retrieval_expand_query", 0.04, "USD"),
    usage("file_exploration", 0.05, "USD"),
    usage("llm_map", 0.06, "USD"),
    usage("retrieval_expand_query", undefined, undefined, "unknown"),
    usage("file_exploration", undefined, undefined, "not_applicable"),
  ])

  expect(costs.currency).toBe("USD")
  expect(costs.memoryMaintenanceCostTotal).toBeCloseTo(0.6)
  expect(costs.retrievalCostTotal).toBeCloseTo(0.04)
  expect(costs.fileExplorationCostTotal).toBeCloseTo(0.05)
  expect(costs.mapCostTotal).toBeCloseTo(0.06)
})

test("LCM usage cost aggregation omits totals for mixed or missing provider currencies", () => {
  expect(
    aggregateLcmUsageCosts([usage("leaf_summary", 0.1, "USD"), usage("retrieval_expand_query", 0.2, "EUR")]),
  ).toEqual({})

  expect(aggregateLcmUsageCosts([usage("leaf_summary", 0.1, undefined)])).toEqual({})
  expect(aggregateLcmUsageCosts([usage("leaf_summary", undefined, undefined, "unknown")])).toEqual({})
})

test("LCM storage accounting counts only the LCM root tree", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const pgliteDir = path.join(dataDir, "pglite")
  const artifactsDir = path.join(dataDir, "artifacts", "nested")
  await fs.mkdir(pgliteDir, { recursive: true })
  await fs.mkdir(artifactsDir, { recursive: true })
  await fs.writeFile(path.join(pgliteDir, "pglite.data"), "12345")
  await fs.writeFile(path.join(artifactsDir, "file.bin"), "abcdef")
  await fs.writeFile(path.join(tmp.path, "path-backed-source.txt"), "not counted")

  expect(await calculateLcmStorageBytes(dataDir)).toBe(11)
  expect(await calculateLcmStorageBytes(path.join(tmp.path, "missing-lcm"))).toBe(0)
})

test("aggregate LCM storage accounting includes families and control metadata but ignores old global leftovers", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const familyA = resolveLcmFamilyRoot({ kiloDataDir, familyID: deriveLcmFamilyID("storage-root-a") })
  const familyB = resolveLcmFamilyRoot({ kiloDataDir, familyID: deriveLcmFamilyID("storage-root-b") })
  await fs.mkdir(path.join(familyA, "pglite"), { recursive: true })
  await fs.mkdir(path.join(familyA, "artifacts", "sha256", "aa"), { recursive: true })
  await fs.mkdir(path.join(familyB, "artifacts", "sha256", "bb"), { recursive: true })
  await fs.mkdir(path.join(resolveLcmControlDataRoot(kiloDataDir), "support"), { recursive: true })
  await fs.writeFile(path.join(familyA, "pglite", "pglite.data"), "12345")
  await fs.writeFile(path.join(familyA, "artifacts", "sha256", "aa", "a.bin"), "abc")
  await fs.writeFile(path.join(familyB, "artifacts", "sha256", "bb", "b.bin"), "defg")
  await fs.writeFile(path.join(resolveLcmControlDataRoot(kiloDataDir), "support", "safe.json"), "{}")
  await fs.mkdir(path.join(resolveLcmControlRoot(kiloDataDir), "pglite"), { recursive: true })
  await fs.mkdir(path.join(resolveLcmControlRoot(kiloDataDir), "artifacts"), { recursive: true })
  await fs.writeFile(path.join(resolveLcmControlRoot(kiloDataDir), "pglite", "old-global.data"), "not-counted")
  await fs.writeFile(path.join(resolveLcmControlRoot(kiloDataDir), "artifacts", "old-global.bin"), "not-counted")

  expect(await calculateAggregateLcmStorageBytes(kiloDataDir)).toBe(14)
})

test("aggregate LCM storage sampler coalesces scans behind a TTL", async () => {
  let now = 1_000
  let currentDataDir = "/tmp/kilo-a"
  const calls: string[] = []
  let completeScan: ((value: number) => void) | undefined
  const finishScan = (value: number) => {
    if (!completeScan) throw new Error("missing storage scan resolver")
    completeScan(value)
  }
  const sampler = createAggregateLcmStorageBytesSampler({
    ttlMs: 250,
    now: () => now,
    resolveKiloDataDir: () => currentDataDir,
    calculate: (kiloDataDir) => {
      calls.push(kiloDataDir)
      return new Promise<number>((resolve) => {
        completeScan = resolve
      })
    },
  })

  const first = sampler.read()
  const second = sampler.read()
  expect(calls).toEqual(["/tmp/kilo-a"])
  finishScan(42)
  await expect(first).resolves.toBe(42)
  await expect(second).resolves.toBe(42)

  expect(await sampler.read()).toBe(42)
  expect(calls).toEqual(["/tmp/kilo-a"])

  now += 251
  completeScan = undefined
  const expired = sampler.read()
  expect(calls).toEqual(["/tmp/kilo-a", "/tmp/kilo-a"])
  finishScan(84)
  await expect(expired).resolves.toBe(84)

  currentDataDir = "/tmp/kilo-b"
  completeScan = undefined
  const newRoot = sampler.read()
  expect(calls).toEqual(["/tmp/kilo-a", "/tmp/kilo-a", "/tmp/kilo-b"])
  finishScan(7)
  await expect(newRoot).resolves.toBe(7)

  sampler.invalidate()
  completeScan = undefined
  const invalidated = sampler.read()
  expect(calls).toEqual(["/tmp/kilo-a", "/tmp/kilo-a", "/tmp/kilo-b", "/tmp/kilo-b"])
  finishScan(8)
  await expect(invalidated).resolves.toBe(8)
})

test("LCM metrics snapshots combine context, storage, maintenance, and costs without content fields", async () => {
  const conversationID = "conv_m18_metrics" as ConversationID
  const db = {
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM lcm_conversations")) {
        return { rows: [{ lifecycle_state: "lcm_active" }] as T[] }
      }
      if (sql.includes("FROM lcm_context_snapshots")) {
        return {
          rows: [
            {
              strategy: "upward",
              active_tokens: 7200,
              hard_limit: 12000,
              soft_threshold: 9000,
              lane_counts_json: {
                raw_leaves: 3000,
                sprigs: 2000,
                bindles: 1000,
                archive_stubs: 500,
                large_file_markers: 600,
                retrieval_cues: 100,
              },
              metrics_json: {},
            },
          ] as T[],
        }
      }
      if (sql.includes("FROM lcm_context_items")) {
        return {
          rows: [
            { item_type: "raw_message", count: 4 },
            { item_type: "summary", count: 2 },
            { item_type: "large_file_marker", count: 1 },
          ] as T[],
        }
      }
      if (sql.includes("FROM lcm_usage_records")) {
        return {
          rows: [
            {
              purpose: "leaf_summary",
              cost_amount: "0.125",
              cost_currency: "USD",
              cost_status: "provider_reported",
            },
            {
              purpose: "retrieval_expand_query",
              cost_amount: null,
              cost_currency: null,
              cost_status: "unknown",
            },
          ] as T[],
        }
      }
      if (sql.includes("FROM lcm_deferred_jobs")) {
        return {
          rows: [
            {
              queued_count: 1,
              max_attempt_count: 3,
              next_run_at_ms: 1_779_000_010_000,
            },
          ] as T[],
        }
      }
      return { rows: [] }
    },
  }

  const metrics = await readLcmMetricsSnapshot({
    db,
    conversationID,
    strategy: "dolt",
    storageBytes: 2048,
    storageWarningThresholdBytes: 1024,
    updatedAt: "2026-05-01T00:00:00.000Z",
    lastMaintenance: {
      conversationID,
      operationID: "op_m18_metrics" as OperationID,
      workNeeded: true,
      workPerformed: true,
      blocking: true,
      reason: "hard_limit",
      beforeTokens: 15_000,
      afterTokens: 7_200,
      summariesCreated: 1,
      contextItemsReplaced: 2,
      status: "completed",
    },
  })

  expect(metrics).toMatchObject({
    conversationID,
    lifecycleState: "lcm_active",
    strategy: "upward",
    activeTokens: 7200,
    hardLimit: 12000,
    softThreshold: 9000,
    laneTokens: { raw_leaves: 3000, retrieval_cues: 100 },
    contextItemCounts: { raw_message: 4, summary: 2, large_file_marker: 1 },
    deferredSoftMaintenanceQueued: true,
    deferredSoftMaintenanceQueuedCount: 1,
    deferredSoftMaintenanceAttemptCount: 3,
    deferredSoftMaintenanceNextRunAtMs: 1_779_000_010_000,
    storageBytes: 2048,
    storageWarning: true,
    memoryMaintenanceCostTotal: 0.125,
    currency: "USD",
    lastMaintenance: {
      operationID: "op_m18_metrics",
      status: "completed",
      reason: "hard_limit",
      beforeTokens: 15_000,
      afterTokens: 7_200,
    },
  })
  expect(JSON.stringify(metrics)).not.toContain("prompt")
  expect(JSON.stringify(metrics)).not.toContain("summaryText")
  expect(JSON.stringify(metrics)).not.toContain("fileContent")
})
