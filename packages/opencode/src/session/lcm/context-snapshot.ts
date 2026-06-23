// kilocode_change - new file
import type { ContextItemType, LcmLaneDecision, LcmMetricsSnapshot } from "./types"

export function emptyContextItemCounts(): Record<ContextItemType, number> {
  return {
    raw_message: 0,
    summary: 0,
    archive_stub: 0,
    large_file_marker: 0,
    retrieval_cue: 0,
  }
}

export function emptyLaneTokens(): Record<LcmLaneDecision["lane"], number> {
  return {
    raw_leaves: 0,
    sprigs: 0,
    bindles: 0,
    archive_stubs: 0,
    large_file_markers: 0,
    retrieval_cues: 0,
  }
}

export function passiveMetricsSnapshot(
  input: Pick<
    LcmMetricsSnapshot,
    | "conversationID"
    | "lifecycleState"
    | "strategy"
    | "storageBytes"
    | "storageWarningThresholdBytes"
    | "storageWarning"
    | "updatedAt"
  >,
): LcmMetricsSnapshot {
  return {
    ...input,
    activeTokens: 0,
    hardLimit: 0,
    softThreshold: 0,
    freshTailTokens: 0,
    softBacklogTokens: 0,
    softBacklogItemCount: 0,
    freshTailRawTokens: 0,
    freshTailRawItemCount: 0,
    unconsumedRawTokens: 0,
    unconsumedRawItemCount: 0,
    protectedTailRawTokens: 0,
    protectedTailRawItemCount: 0,
    rawLaneTokens: 0,
    hardFillRatio: 0,
    rawLaneRatio: 0,
    softBacklogRatio: 0,
    budgetStatus: "unavailable",
    tokenCounterMode: "deterministic_fallback",
    tokenCounterVersion: "lcm-deterministic-fallback-token-counter-v1",
    laneTokens: emptyLaneTokens(),
    contextItemCounts: emptyContextItemCounts(),
    deferredSoftMaintenanceQueued: false,
    deferredSoftMaintenanceQueuedCount: 0,
  }
}

export * as LcmContextSnapshot from "./context-snapshot"
