// kilocode_change - new file
import { expect, test } from "bun:test"
import { formatLcmActivity, formatLcmStatus } from "../../../src/cli/cmd/lcm"
import type { LcmActivityPage, LcmMetricsSnapshot } from "../../../src/session/lcm/types"

test("LCM CLI status prints hard, raw, and backlog metrics", () => {
  const output = formatLcmStatus({
    conversationID: "conv_cli",
    lifecycleState: "lcm_active",
    strategy: "upward",
    activeTokens: 75_000,
    hardLimit: 115_000,
    softThreshold: 70_000,
    freshTailTokens: 20_000,
    softBacklogTokens: 14_000,
    softBacklogItemCount: 7,
    freshTailRawTokens: 20_000,
    freshTailRawItemCount: 2,
    unconsumedRawTokens: 34_000,
    unconsumedRawItemCount: 9,
    protectedTailRawTokens: 20_000,
    protectedTailRawItemCount: 2,
    rawLaneTokens: 42_000,
    hardFillRatio: 0.65,
    rawLaneRatio: 0.37,
    softBacklogRatio: 0.2,
    outputReserve: 15_728,
    tokenCounterMode: "deterministic_fallback",
    tokenCounterVersion: "counter-v1",
    laneTokens: {} as LcmMetricsSnapshot["laneTokens"],
    contextItemCounts: {} as LcmMetricsSnapshot["contextItemCounts"],
    deferredSoftMaintenanceQueued: false,
    deferredSoftMaintenanceQueuedCount: 0,
    memoryMaintenanceCostTotal: 0.5,
    retrievalCostTotal: 0.25,
    fileExplorationCostTotal: 0.1,
    mapCostTotal: 0.4,
    currency: "USD",
    storageBytes: 1024,
    storageWarningThresholdBytes: 2048,
    storageWarning: false,
    updatedAt: new Date(0).toISOString(),
  })

  expect(output).toContain("hard: 75000 / 115000 (65%)")
  expect(output).toContain("raw: 42000 (37%)")
  expect(output).toContain("backlog: 14000 tokens / 7 items (20%)")
  expect(output).toContain("outputReserve: 15728")
  expect(output).toContain("costs: maintenance 0.5, retrieval 0.25, exploration 0.1, maps 0.4 USD")
})

test("LCM CLI activity identifies paid retrieval requests", () => {
  const output = formatLcmActivity({
    conversationID: "conv_cli",
    summary: {
      requestCount: 1,
      inputTokens: 1200,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1400,
      costStatus: "unknown",
    },
    items: [
      {
        usageRecordID: "usage_cli",
        sessionID: "ses_cli",
        conversationID: "conv_cli",
        purpose: "retrieval_expand_query",
        mode: "explicit_retrieval",
        providerID: "zai-coding-plan",
        modelID: "glm-4.5",
        inputTokens: 1200,
        outputTokens: 200,
        totalTokens: 1400,
        costStatus: "unknown",
        createdAt: new Date(0).toISOString(),
      },
    ],
  } satisfies LcmActivityPage)

  expect(output).toContain("retrieval_expand_query | explicit_retrieval | 1400 tokens | zai-coding-plan/glm-4.5")
})
