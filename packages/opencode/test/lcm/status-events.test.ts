// kilocode_change - new file
import { expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Effect } from "effect"
import { mapSSEEventToWebviewMessage } from "../../../kilo-vscode/src/kilo-provider-utils"
import {
  createLcmMaintenanceEndedEvent,
  createLcmMaintenanceFailedEvent,
  createLcmMaintenanceStartedEvent,
  createLcmDbStatusEvent,
  createLcmFileStatusEvent,
  createLcmMetricsUpdatedEvent,
  Event as LcmEvent,
  LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
  LCM_BLOCKING_MAINTENANCE_LABEL,
  publishLcmEvent,
} from "../../src/session/lcm/events"
import { parseLcmSafeError } from "../../src/session/lcm/safe-error-schema"
import {
  createLcmSafeError,
  LCM_SAFE_MESSAGE_TEMPLATES,
  normalizeLcmSafeError,
  type ConversationID,
  type LcmFileExplorationStatus,
  type LcmFileID,
  type LcmMaintenanceResult,
  type LcmSafeError,
  type OperationID,
} from "../../src/session/lcm/types"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const conversationID = "conv_m15_status" as ConversationID
const operationID = "op_m15_status" as OperationID

function maintenanceResult(input: Partial<LcmMaintenanceResult> = {}): LcmMaintenanceResult {
  return {
    conversationID,
    operationID,
    workNeeded: true,
    workPerformed: true,
    blocking: true,
    reason: "hard_limit",
    beforeTokens: 18_000,
    afterTokens: 9_000,
    summariesCreated: 2,
    contextItemsReplaced: 3,
    status: "completed",
    ...input,
  }
}

test("safe message templates are canonical and action mirrors safeParams", () => {
  const cases = [
    {
      code: "db_unavailable",
      templateKey: "lcm.db.unavailable",
      safeParams: { retryable: true, action: "close_other_owner" },
      retryable: true,
    },
    {
      code: "unauthorized",
      templateKey: "lcm.auth.denied",
      safeParams: { action: "start_new_thread" },
      retryable: false,
    },
    {
      code: "invalid_request",
      templateKey: "lcm.request.invalid",
      safeParams: { limit: 20, maxLimit: 10 },
      retryable: false,
    },
    {
      code: "timeout",
      templateKey: "lcm.operation.timeout",
      safeParams: { retryable: true, action: "retry" },
      retryable: true,
    },
    {
      code: "canceled",
      templateKey: "lcm.operation.canceled",
      safeParams: { retryable: false },
      retryable: false,
    },
    {
      code: "missing_source",
      templateKey: "lcm.recovery.missing_source",
      safeParams: { action: "repeat_input" },
      retryable: true,
    },
    {
      code: "stale_source",
      templateKey: "lcm.file.stale",
      safeParams: { action: "re_register_file" },
      retryable: false,
    },
    {
      code: "hard_limit_unresolved",
      templateKey: "lcm.hard_limit.unresolved",
      safeParams: { action: "start_new_thread", beforeTokens: 20_000, hardLimit: 12_000 },
      retryable: false,
    },
  ] as const

  for (const item of cases) {
    const error = createLcmSafeError({
      code: item.code,
      templateKey: item.templateKey,
      safeParams: item.safeParams,
      retryable: item.retryable,
      diagnosticCode: `m15_${item.code}`,
    })
    expect(error.safeMessage).toBe(LCM_SAFE_MESSAGE_TEMPLATES[item.templateKey])
    expect(error.action).toBe("action" in item.safeParams ? item.safeParams.action : undefined)
  }
})

test("safe error normalization repairs mismatched top-level action before output", () => {
  const mismatched = {
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: { retryable: true, action: "retry" },
    safeMessage: "raw stale message",
    action: "contact_support",
    retryable: true,
    diagnosticCode: "m15_mismatched_action",
  } satisfies LcmSafeError

  const normalized = normalizeLcmSafeError(mismatched)
  expect(normalized.safeMessage).toBe(LCM_SAFE_MESSAGE_TEMPLATES["lcm.operation.timeout"])
  expect(normalized.action).toBe("retry")
})

test("safe error parser validates schema and normalizes stale copy", () => {
  const parsed = parseLcmSafeError({
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: { retryable: true, action: "retry" },
    safeMessage: "raw stale message",
    action: "contact_support",
    retryable: true,
    diagnosticCode: "m15_parse_safe_error",
  })
  expect(parsed?.safeMessage).toBe(LCM_SAFE_MESSAGE_TEMPLATES["lcm.operation.timeout"])
  expect(parsed?.action).toBe("retry")
  expect(parseLcmSafeError({ code: "timeout", safeMessage: "missing required fields" })).toBeUndefined()
})

test("maintenance status events carry safe labels and normalized safe errors", () => {
  const safeError = {
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: {
      operationID,
      conversationID,
      beforeTokens: 20_000,
      hardLimit: 12_000,
      action: "start_new_thread",
    },
    safeMessage: "raw stale message",
    action: "contact_support",
    retryable: false,
    diagnosticCode: "m15_hard_limit_fixture",
  } satisfies LcmSafeError

  const started = createLcmMaintenanceStartedEvent({
    sessionID: "session_m15_status",
    conversationID,
    operationID,
    phase: "hard_limit",
    reason: "hard_limit",
    blocking: true,
    beforeTokens: 20_000,
    hardLimit: 12_000,
    safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
    timestamp: "2026-05-01T00:00:00.000Z",
  })
  expect(started).toMatchObject({
    type: "lcm.maintenance.started",
    sessionID: "session_m15_status",
    conversationID,
    operationID,
    payload: {
      phase: "hard_limit",
      reason: "hard_limit",
      status: "started",
      blocking: true,
      safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
    },
  })

  const ended = createLcmMaintenanceEndedEvent({
    sessionID: "session_m15_status",
    result: maintenanceResult(),
    phase: "hard_limit",
    hardLimit: 12_000,
    timestamp: "2026-05-01T00:00:01.000Z",
  })
  expect(ended.payload.safeError).toBeUndefined()
  expect(ended.payload.afterTokens).toBe(9_000)

  const failed = createLcmMaintenanceFailedEvent({
    sessionID: "session_m15_status",
    result: maintenanceResult({
      workPerformed: false,
      status: "failed",
      safeError,
      afterTokens: 20_000,
    }),
    phase: "hard_limit",
    hardLimit: 12_000,
    timestamp: "2026-05-01T00:00:02.000Z",
  })
  expect(failed.payload.safeError).toMatchObject({
    safeMessage: LCM_SAFE_MESSAGE_TEMPLATES["lcm.hard_limit.unresolved"],
    action: "start_new_thread",
  })

  const canceled = createLcmMaintenanceFailedEvent({
    sessionID: "session_m15_status",
    result: maintenanceResult({
      workPerformed: false,
      status: "canceled",
      safeError: createLcmSafeError({
        code: "canceled",
        templateKey: "lcm.operation.timeout",
        safeParams: { operationID, retryable: true, action: "retry" },
        retryable: true,
        diagnosticCode: "m15_abort_cancel_fixture",
      }),
    }),
    phase: "hard_limit",
    hardLimit: 12_000,
    timestamp: "2026-05-01T00:00:02.500Z",
  })
  expect(canceled.payload.safeError).toMatchObject({
    code: "canceled",
    action: "retry",
  })
})

test("background soft maintenance events carry pending state and soft pressure safely", () => {
  const scheduled = createLcmMaintenanceStartedEvent({
    sessionID: "session_m15_status",
    conversationID,
    operationID,
    phase: "leaf_summary",
    reason: "soft_threshold",
    status: "scheduled",
    blocking: false,
    beforeTokens: 18_000,
    hardLimit: 80_000,
    softThreshold: 40_000,
    softBacklogTokens: 24_000,
    softBacklogItemCount: 8,
    softBacklogLargestSourceTokens: 6000,
    softPressureReason: "below_soft_raw_backlog",
    sweepMaxPasses: 1,
    sweepMaxElapsedMs: 60_000,
    summaryPromptVersion: "summary-leaf-v2",
    summaryBackoffPurpose: "leaf_summary",
    laneLatchDiagnostics: [
      {
        phase: "entered",
        lane: "raw_leaves",
        conversationID,
        strategy: "upward",
        enteredReason: "below_soft_raw_backlog",
        enteredPressure: 24_000,
        targetTokens: 20_000,
        lastObservedPressure: 24_000,
        updatedAtMs: 1_779_000_000_000,
        nextAction: "summarize_leaves",
      },
    ],
    safeLabel: LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
    timestamp: "2026-05-01T00:00:00.250Z",
  })

  expect(scheduled).toMatchObject({
    type: "lcm.maintenance.started",
    sessionID: "session_m15_status",
    conversationID,
    operationID,
    payload: {
      phase: "leaf_summary",
      reason: "soft_threshold",
      status: "scheduled",
      blocking: false,
      beforeTokens: 18_000,
      hardLimit: 80_000,
      softThreshold: 40_000,
      softBacklogTokens: 24_000,
      softBacklogItemCount: 8,
      softBacklogLargestSourceTokens: 6000,
      softPressureReason: "below_soft_raw_backlog",
      sweepMaxPasses: 1,
      sweepMaxElapsedMs: 60_000,
      summaryPromptVersion: "summary-leaf-v2",
      summaryBackoffPurpose: "leaf_summary",
      laneLatchDiagnostics: [
        {
          lane: "raw_leaves",
          phase: "entered",
        },
      ],
      safeLabel: LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
    },
  })

  const forwarded = mapSSEEventToWebviewMessage(
    {
      type: "lcm.maintenance.started",
      properties: scheduled,
    } as never,
    "session_m15_status",
  )
  expect(forwarded).toMatchObject({
    type: "lcmEvent",
    event: {
      type: "lcm.maintenance.started",
      payload: {
        status: "scheduled",
        blocking: false,
        softBacklogTokens: 24_000,
        softPressureReason: "below_soft_raw_backlog",
        sweepMaxPasses: 1,
        summaryPromptVersion: "summary-leaf-v2",
        summaryBackoffPurpose: "leaf_summary",
      },
    },
  })
  expect(JSON.stringify(forwarded)).not.toContain("soft backlog source message")

  const deferred = createLcmMaintenanceEndedEvent({
    sessionID: "session_m15_status",
    result: maintenanceResult({
      reason: "soft_threshold",
      blocking: false,
      workPerformed: false,
      status: "deferred",
      beforeTokens: 18_000,
      afterTokens: 18_000,
      summariesCreated: 0,
      contextItemsReplaced: 0,
      sweepPassesCompleted: 0,
      sweepMaxPasses: 1,
      sweepElapsedMs: 250,
      sweepMaxElapsedMs: 60_000,
      sweepStopReason: "backoff",
      summaryPromptVersion: "summary-leaf-v2",
      summaryBackoffPurpose: "leaf_summary",
      summaryBackoffFailureCount: 2,
      summaryBackoffDelayMs: 4_000,
      summaryBackoffRemainingMs: 3_000,
    }),
    phase: "leaf_summary",
    timestamp: "2026-05-01T00:00:00.500Z",
  })
  expect(deferred.payload).toMatchObject({
    phase: "leaf_summary",
    reason: "soft_threshold",
    status: "deferred",
    sweepPassesCompleted: 0,
    sweepMaxPasses: 1,
    sweepElapsedMs: 250,
    sweepMaxElapsedMs: 60_000,
    sweepStopReason: "backoff",
    summaryPromptVersion: "summary-leaf-v2",
    summaryBackoffPurpose: "leaf_summary",
    summaryBackoffFailureCount: 2,
    summaryBackoffDelayMs: 4_000,
    summaryBackoffRemainingMs: 3_000,
  })
})

test("DB status envelopes expose only safe fields", () => {
  const locked = createLcmDbStatusEvent({
    status: {
      status: "locked",
      dataDir: "/tmp/lcm-safe-lock",
      schemaVersion: 15,
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
    timestamp: "2026-05-01T00:00:03.000Z",
  })
  expect(locked).toMatchObject({
    type: "lcm.db.status",
    operationID,
    payload: {
      status: "locked",
      schemaVersion: 15,
      lifecycleState: "db_unavailable",
      dbReady: false,
      safeError: {
        code: "db_locked",
        action: "close_other_owner",
      },
    },
  })
  expect("conversationID" in locked).toBe(false)

  const forwardedLocked = mapSSEEventToWebviewMessage(
    {
      type: "lcm.db.status",
      properties: locked,
    } as never,
    "session_m18_db_locked",
  )
  expect(forwardedLocked).toMatchObject({
    type: "lcmEvent",
    event: {
      type: "lcm.db.status",
      operationID,
      payload: {
        status: "locked",
        safeError: {
          code: "db_locked",
          action: "close_other_owner",
        },
      },
    },
  })
  expect(JSON.stringify(forwardedLocked)).not.toContain("conv_")

  const corrupt = createLcmDbStatusEvent({
    status: {
      status: "corrupt",
      dataDir: "/tmp/lcm-safe-corrupt",
      schemaVersion: 15,
      safeError: createLcmSafeError({
        code: "db_corrupt",
        templateKey: "lcm.db.unavailable",
        safeParams: { retryable: false, action: "contact_support" },
        retryable: false,
        diagnosticCode: "m15_corrupt_fixture",
      }),
    },
    lifecycleState: "db_unavailable",
    operationID,
    timestamp: "2026-05-01T00:00:04.000Z",
  })
  expect(corrupt.payload.safeError).toMatchObject({
    code: "db_corrupt",
    retryable: false,
    action: "contact_support",
  })
})

test("LCM event envelopes publish through the bus with exact event names", async () => {
  await using tmp = await tmpdir()
  const seen: unknown[] = []
  const envelope = createLcmMaintenanceStartedEvent({
    conversationID,
    operationID,
    phase: "hard_limit",
    reason: "hard_limit",
    blocking: true,
    safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
    timestamp: "2026-05-01T00:00:00.000Z",
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const unsubscribe = yield* bus.subscribeCallback(LcmEvent.MaintenanceStarted, (event) => seen.push(event))
          yield* publishLcmEvent(bus, envelope)
          yield* Effect.sleep("10 millis")
          unsubscribe()
        }).pipe(Effect.provide(Bus.layer)),
      ),
  })

  expect(seen).toMatchObject([{ type: "lcm.maintenance.started", properties: envelope }])
})

test("busy session status forwards the maintenance label to the VSCode webview", () => {
  const message = mapSSEEventToWebviewMessage(
    {
      type: "session.status",
      properties: {
        sessionID: "session_m15_status",
        status: { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL },
      },
    } as never,
    "session_m15_status",
  )

  expect(message).toEqual({
    type: "sessionStatus",
    sessionID: "session_m15_status",
    status: "busy",
    message: LCM_BLOCKING_MAINTENANCE_LABEL,
  })
})

test("LCM metrics events are content-safe and forwarded to the VSCode webview", () => {
  const metrics = createLcmMetricsUpdatedEvent({
    sessionID: "session_m18_metrics",
    conversationID,
    operationID,
    timestamp: "2026-05-01T00:00:06.000Z",
    metrics: {
      conversationID,
      lifecycleState: "lcm_active",
      strategy: "upward",
      activeTokens: 7200,
      hardLimit: 50_000,
      softThreshold: 30_000,
      freshTailTokens: 20_000,
      softBacklogTokens: 20_100,
      softBacklogItemCount: 4,
      freshTailRawTokens: 1000,
      freshTailRawItemCount: 2,
      unconsumedRawTokens: 0,
      unconsumedRawItemCount: 0,
      protectedTailRawTokens: 1000,
      protectedTailRawItemCount: 2,
      rawLaneTokens: 21_100,
      softBacklogLargestSourceTokens: 2500,
      softPressureReason: "lane_latch",
      laneLatchDiagnostics: [
        {
          phase: "staying",
          lane: "raw_leaves",
          conversationID,
          strategy: "upward",
          enteredReason: "below_soft_raw_backlog",
          enteredPressure: 20_500,
          targetTokens: 20_000,
          lastObservedPressure: 20_100,
          updatedAtMs: 1_779_000_000_000,
          nextAction: "summarize_leaves",
        },
      ],
      tokenCounterMode: "fake",
      tokenCounterVersion: "lcm-fake-token-counter-v1",
      laneTokens: {
        raw_leaves: 20_100,
        sprigs: 2000,
        bindles: 1000,
        archive_stubs: 500,
        large_file_markers: 600,
        retrieval_cues: 100,
      },
      contextItemCounts: {
        raw_message: 4,
        summary: 2,
        archive_stub: 0,
        large_file_marker: 1,
        retrieval_cue: 0,
      },
      deferredSoftMaintenanceQueued: true,
      deferredSoftMaintenanceQueuedCount: 1,
      deferredSoftMaintenanceAttemptCount: 2,
      deferredSoftMaintenanceNextRunAtMs: 1_779_000_030_000,
      storageBytes: 2048,
      storageWarningThresholdBytes: 1024,
      storageWarning: true,
      memoryMaintenanceCostTotal: 0.125,
      retrievalCostTotal: 0.025,
      currency: "USD",
      updatedAt: "2026-05-01T00:00:06.000Z",
    },
  })

  expect(metrics).toMatchObject({
    type: "lcm.metrics.updated",
    sessionID: "session_m18_metrics",
    conversationID,
    operationID,
    payload: {
      conversationID,
      activeTokens: 7200,
      memoryMaintenanceCostTotal: 0.125,
      retrievalCostTotal: 0.025,
      currency: "USD",
      softPressureReason: "lane_latch",
      deferredSoftMaintenanceQueued: true,
      deferredSoftMaintenanceAttemptCount: 2,
    },
  })

  const forwarded = mapSSEEventToWebviewMessage(
    {
      type: "lcm.metrics.updated",
      properties: metrics,
    } as never,
    "session_m18_metrics",
  )
  expect(forwarded).toMatchObject({
    type: "lcmEvent",
    event: {
      type: "lcm.metrics.updated",
      conversationID,
      payload: {
        activeTokens: 7200,
        memoryMaintenanceCostTotal: 0.125,
        softPressureReason: "lane_latch",
        deferredSoftMaintenanceQueued: true,
      },
    },
  })
})

test("LCM file status envelopes allowlist stale-source and explorer states", () => {
  const statuses = [
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
  ] satisfies LcmFileExplorationStatus[]

  for (const [index, explorationStatus] of statuses.entries()) {
    const fileID = `file_m18_status_${index}` as LcmFileID
    const event = createLcmFileStatusEvent({
      conversationID,
      operationID,
      timestamp: "2026-05-01T00:00:07.000Z",
      status: {
        fileID,
        sourceKind: "path",
        staleState:
          explorationStatus === "unavailable"
            ? "missing"
            : explorationStatus === "unsafe"
              ? "permission_denied"
              : "current",
        explorationStatus,
        explorerKind: explorationStatus === "not_started" ? "none" : "text",
        sampled: explorationStatus === "sampled",
        sampleBytes: explorationStatus === "sampled" ? 1024 : undefined,
        blockingUse: explorationStatus === "unavailable" || explorationStatus === "unsafe",
        safeReason:
          explorationStatus === "unavailable"
            ? "stale_source"
            : explorationStatus === "unsafe"
              ? "permission_denied"
              : "none",
        safeError:
          explorationStatus === "unavailable" || explorationStatus === "unsafe"
            ? createLcmSafeError({
                code: explorationStatus === "unavailable" ? "stale_source" : "permission_denied",
                templateKey: "lcm.file.stale",
                safeParams: {
                  fileID,
                  staleState: explorationStatus === "unavailable" ? "missing" : "permission_denied",
                  action: "re_register_file",
                },
                retryable: false,
                diagnosticCode: `m18_file_${explorationStatus}`,
              })
            : undefined,
      },
    })

    expect(event).toMatchObject({
      type: "lcm.file.status",
      conversationID,
      operationID,
      payload: {
        fileID,
        sourceKind: "path",
        explorationStatus,
        sampled: explorationStatus === "sampled",
        blockingUse: explorationStatus === "unavailable" || explorationStatus === "unsafe",
      },
    })
    expect(JSON.stringify(event)).not.toContain("/workspace/raw")
    expect(JSON.stringify(event)).not.toContain("LCM_HARNESS_RAW_FILE_SENTINEL")
  }
})
