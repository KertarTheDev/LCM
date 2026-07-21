// kilocode_change - new file
import { test } from "bun:test"
import { mapSSEEventToWebviewMessage } from "../../../kilo-vscode/src/kilo-provider-utils"
import {
  createLcmMaintenanceFailedEvent,
  createLcmMaintenanceStartedEvent,
  createLcmContextUpdatedEvent,
  createLcmDbStatusEvent,
  createLcmFileStatusEvent,
  createLcmMetricsUpdatedEvent,
  LCM_BLOCKING_MAINTENANCE_LABEL,
} from "../../src/session/lcm/events"
import { createLcmSafeError, type ConversationID, type OperationID } from "../../src/session/lcm/types"
import { assertNoNonModelSentinelLeaks, LCM_NON_MODEL_LEAK_SENTINELS } from "./harness/non-model-leak"

const conversationID = "conv_m15_leak" as ConversationID
const operationID = "op_m15_leak" as OperationID

test("LCM non-model status/event payloads do not expose raw memory sentinels", () => {
  const safeError = createLcmSafeError({
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: {
      operationID,
      conversationID,
      beforeTokens: 20_000,
      hardLimit: 12_000,
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode: "m15_non_model_leak_fixture",
  })

  const payloads = [
    createLcmDbStatusEvent({
      status: {
        status: "locked",
        dataDir: "/tmp/lcm-safe-status",
        safeError: createLcmSafeError({
          code: "db_locked",
          templateKey: "lcm.db.unavailable",
          safeParams: { retryable: true, action: "close_other_owner" },
          retryable: true,
          diagnosticCode: "m15_locked_fixture",
        }),
      },
      lifecycleState: "db_unavailable",
      operationID,
    }),
    createLcmContextUpdatedEvent({
      conversationID,
      lifecycleState: "lcm_active",
      strategy: "upward",
      reason: "maintenance",
      activeTokens: 12_000,
      hardLimit: 11_000,
      softThreshold: 8_800,
      contextItemCounts: {
        raw_message: 2,
        summary: 1,
        archive_stub: 0,
        large_file_marker: 1,
        retrieval_cue: 0,
      },
      operationID,
    }),
    createLcmMaintenanceStartedEvent({
      conversationID,
      operationID,
      phase: "hard_limit",
      reason: "hard_limit",
      blocking: true,
      beforeTokens: 20_000,
      hardLimit: 12_000,
      safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
    }),
    createLcmMaintenanceFailedEvent({
      result: {
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: false,
        blocking: true,
        reason: "hard_limit",
        beforeTokens: 20_000,
        afterTokens: 20_000,
        summariesCreated: 0,
        contextItemsReplaced: 0,
        status: "failed",
        safeError,
      },
      phase: "hard_limit",
      hardLimit: 12_000,
    }),
    createLcmFileStatusEvent({
      conversationID,
      operationID,
      status: {
        fileID: "file_m15_leak",
        sourceKind: "path",
        staleState: "hash_mismatch",
        explorationStatus: "failed",
        explorerKind: "text",
        sampled: false,
        blockingUse: true,
        safeReason: "stale_source",
        safeError: createLcmSafeError({
          code: "stale_source",
          templateKey: "lcm.file.stale",
          safeParams: {
            fileID: "file_m15_leak",
            staleState: "hash_mismatch",
            action: "re_register_file",
          },
          retryable: false,
          diagnosticCode: "m15_file_stale_fixture",
        }),
      },
    }),
    createLcmMetricsUpdatedEvent({
      conversationID,
      operationID,
      metrics: {
        conversationID,
        lifecycleState: "lcm_active",
        strategy: "upward",
        activeTokens: 12_000,
        hardLimit: 11_000,
        softThreshold: 8_800,
        freshTailTokens: 20_000,
        softBacklogTokens: 1000,
        softBacklogItemCount: 2,
        freshTailRawTokens: 500,
        freshTailRawItemCount: 1,
        unconsumedRawTokens: 0,
        unconsumedRawItemCount: 0,
        protectedTailRawTokens: 500,
        protectedTailRawItemCount: 1,
        rawLaneTokens: 1500,
        tokenCounterMode: "fake",
        tokenCounterVersion: "lcm-fake-token-counter-v1",
        laneTokens: {
          raw_leaves: 1000,
          sprigs: 2000,
          bindles: 3000,
          archive_stubs: 400,
          large_file_markers: 600,
          retrieval_cues: 50,
        },
        contextItemCounts: {
          raw_message: 2,
          summary: 1,
          archive_stub: 0,
          large_file_marker: 1,
          retrieval_cue: 0,
        },
        deferredSoftMaintenanceQueued: false,
        deferredSoftMaintenanceQueuedCount: 0,
        storageBytes: 4096,
        storageWarningThresholdBytes: 10_737_418_240,
        storageWarning: false,
        memoryMaintenanceCostTotal: 0.5,
        retrievalCostTotal: 0.1,
        fileExplorationCostTotal: 0.2,
        mapCostTotal: 0.3,
        currency: "USD",
        lastMaintenance: {
          operationID,
          status: "failed",
          reason: "hard_limit",
          blocking: true,
          beforeTokens: 20_000,
          afterTokens: 20_000,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    }),
    mapSSEEventToWebviewMessage(
      {
        type: "lcm.metrics.updated",
        properties: createLcmMetricsUpdatedEvent({
          conversationID,
          operationID,
          metrics: {
            conversationID,
            lifecycleState: "lcm_active",
            strategy: "upward",
            activeTokens: 12_000,
            hardLimit: 11_000,
            softThreshold: 8_800,
            freshTailTokens: 20_000,
            softBacklogTokens: 1000,
            softBacklogItemCount: 2,
            freshTailRawTokens: 500,
            freshTailRawItemCount: 1,
            unconsumedRawTokens: 0,
            unconsumedRawItemCount: 0,
            protectedTailRawTokens: 500,
            protectedTailRawItemCount: 1,
            rawLaneTokens: 1500,
            tokenCounterMode: "fake",
            tokenCounterVersion: "lcm-fake-token-counter-v1",
            laneTokens: {
              raw_leaves: 1000,
              sprigs: 2000,
              bindles: 3000,
              archive_stubs: 400,
              large_file_markers: 600,
              retrieval_cues: 50,
            },
            contextItemCounts: {
              raw_message: 2,
              summary: 1,
              archive_stub: 0,
              large_file_marker: 1,
              retrieval_cue: 0,
            },
            deferredSoftMaintenanceQueued: false,
            deferredSoftMaintenanceQueuedCount: 0,
            storageBytes: 4096,
            storageWarningThresholdBytes: 10_737_418_240,
            storageWarning: false,
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        }),
      } as never,
      "session_m18_leak",
    ),
    mapSSEEventToWebviewMessage(
      {
        type: "session.status",
        properties: {
          sessionID: "session_m15_leak",
          status: { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL },
        },
      } as never,
      "session_m15_leak",
    ),
  ]

  for (const [index, payload] of payloads.entries()) {
    assertNoNonModelSentinelLeaks({
      label: `m15 non-model payload ${index}`,
      value: payload,
      sentinels: LCM_NON_MODEL_LEAK_SENTINELS,
    })
  }
})
