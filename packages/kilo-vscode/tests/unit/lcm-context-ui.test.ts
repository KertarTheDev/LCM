import { describe, expect, it } from "bun:test"
import {
  busyStatusMessage,
  buildFamilyLabels,
  calcContextUsage,
  childID,
  computeStatus,
  isLcmMaintenanceHintExpired,
  lcmContextUsageFromMetrics,
  lcmMetricKeysFromEvent,
  lcmMaintenanceHintFromEvent,
} from "../../webview-ui/src/context/session-utils"
import type { LcmEventEnvelopeMessage, LcmMetricsSnapshotMessage, Part } from "../../webview-ui/src/types/messages"

const t = (key: string) => key

function metrics(overrides: Partial<LcmMetricsSnapshotMessage> = {}): LcmMetricsSnapshotMessage {
  return {
    conversationID: "conv_context_regression_ui",
    lifecycleState: "lcm_active",
    strategy: "upward",
    activeTokens: 42_000,
    hardLimit: 56_000,
    softThreshold: 24_000,
    freshTailTokens: 20_000,
    softBacklogTokens: 30_000,
    softBacklogItemCount: 12,
    freshTailRawTokens: 4000,
    freshTailRawItemCount: 4,
    unconsumedRawTokens: 0,
    unconsumedRawItemCount: 0,
    protectedTailRawTokens: 4000,
    protectedTailRawItemCount: 4,
    rawLaneTokens: 34_000,
    providerContextLimit: 100_000,
    providerInputLimit: 80_000,
    providerOutputLimit: 20_000,
    outputReserve: 20_000,
    systemPromptTokens: 1500,
    toolSchemaTokens: 2500,
    tokenCounterMode: "deterministic_fallback",
    tokenCounterVersion: "lcm-token-counter-deterministic-fallback-v1",
    laneTokens: {},
    contextItemCounts: {},
    storageBytes: 1024,
    storageWarningThresholdBytes: 2048,
    storageWarning: false,
    updatedAt: "2026-05-21T00:00:00.000Z",
    ...overrides,
  }
}

function maintenanceEvent(
  type: "lcm.maintenance.started" | "lcm.maintenance.ended" | "lcm.maintenance.failed",
  overrides: Partial<LcmEventEnvelopeMessage["payload"]> = {},
): LcmEventEnvelopeMessage {
  return {
    type,
    sessionID: "ses_context_ui",
    conversationID: "conv_context_regression_ui",
    operationID: "op_context_ui_soft",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: {
      phase: "leaf_summary",
      reason: "soft_threshold",
      status:
        type === "lcm.maintenance.started" ? "started" : type === "lcm.maintenance.failed" ? "failed" : "completed",
      blocking: false,
      beforeTokens: 52_000,
      afterTokens: type === "lcm.maintenance.ended" ? 32_000 : undefined,
      hardLimit: 64_000,
      softThreshold: 32_000,
      softBacklogTokens: 18_000,
      softBacklogItemCount: 6,
      ...overrides,
    },
  } as LcmEventEnvelopeMessage
}

function dbStatusEvent(overrides: Partial<LcmEventEnvelopeMessage["payload"]> = {}): LcmEventEnvelopeMessage {
  return {
    type: "lcm.db.status",
    sessionID: "ses_context_ui",
    conversationID: "conv_context_regression_ui",
    operationID: "op_context_ui_db",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: {
      status: "locked",
      dbReady: false,
      safeError: {
        code: "db_locked",
        templateKey: "lcm.db.unavailable",
        safeParams: { retryable: true, action: "close_other_owner" },
        safeMessage: "LCM memory is locked by another Kilo Code window.",
        action: "close_other_owner",
        retryable: true,
        diagnosticCode: "lcm_owner_lock_conflict",
      },
      ...overrides,
    },
  } as LcmEventEnvelopeMessage
}

describe("LCM context UI state", () => {
  it("reports context fill as activeTokens over hardLimit with provider output shown separately", () => {
    expect(lcmContextUsageFromMetrics(metrics())).toEqual({
      tokens: 42_000,
      percentage: 75,
      source: "lcm_active_budget",
      label: "Memory active budget",
      limit: 56_000,
      providerContextLimit: 100_000,
      providerOutputLimit: 20_000,
      outputReserve: 20_000,
      systemPromptTokens: 1500,
      toolSchemaTokens: 2500,
      tokenCounterMode: "deterministic_fallback",
      tokenCounterVersion: "lcm-token-counter-deterministic-fallback-v1",
      freshTailTokens: 20_000,
      softBacklogTokens: 30_000,
      softThreshold: 24_000,
      freshTailRawTokens: 4000,
      freshTailRawItemCount: 4,
      unconsumedRawTokens: 0,
      unconsumedRawItemCount: 0,
      protectedTailRawTokens: 4000,
      protectedTailRawItemCount: 4,
      rawLaneTokens: 34_000,
      hardFillRatio: 42_000 / 56_000,
      rawLaneRatio: 34_000 / 24_000,
      softBacklogRatio: 1.25,
      budgetStatus: undefined,
    })
  })

  it("keys metrics events by current session and all conversation identifiers", () => {
    const event = {
      type: "lcm.metrics.updated",
      sessionID: "ses_context_ui",
      conversationID: "conv_envelope",
      operationID: "op_context_ui_metrics",
      timestamp: "2026-05-22T00:00:00.000Z",
      payload: metrics({ conversationID: "conv_payload" }),
    } as LcmEventEnvelopeMessage

    expect(lcmMetricKeysFromEvent(event)).toEqual(["ses_context_ui", "conv_envelope", "conv_payload"])
  })

  it("keeps provider-token context usage labeled separately from memory active budget", () => {
    expect(calcContextUsage({ input: 7000, output: 1000 }, 10_000)).toEqual({
      tokens: 8000,
      percentage: 80,
      source: "provider_context",
      label: "Provider context",
      limit: 10_000,
    })
  })

  it("clears hard-limit busy wording when the backend returns idle", () => {
    expect(busyStatusMessage({ type: "busy", message: "Preparing memory for this response..." })).toBe(
      "Preparing memory for this response...",
    )
    expect(busyStatusMessage({ type: "busy" })).toBeUndefined()
    expect(busyStatusMessage({ type: "idle" })).toBeUndefined()
  })

  it("keeps explicit busy status ahead of assistant placeholder status", () => {
    const assistantPlaceholder: Part = { type: "text", id: "part_placeholder", text: "" }

    expect(computeStatus(assistantPlaceholder, t)).toBe("session.status.writingResponse")
    expect(busyStatusMessage({ type: "busy", message: "Preparing memory for this response..." })).toBe(
      "Preparing memory for this response...",
    )
  })

  it("derives child-session labels from typed task metadata", () => {
    const taskPart: Part = {
      id: "part_task",
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: { subagent_type: "reviewer" },
        output: "done",
        title: "Task complete",
        metadata: { sessionId: "ses_child" },
      },
    }

    expect(taskPart.type === "tool" ? childID(taskPart) : undefined).toBe("ses_child")
    expect(
      buildFamilyLabels(
        new Set(["ses_root", "ses_child"]),
        { ses_root: [{ id: "msg_assistant" }], ses_child: [] },
        { msg_assistant: [taskPart] },
      ),
    ).toEqual(new Map([["ses_child", "reviewer"]]))
  })

  it("derives a transient background-memory hint from nonblocking maintenance events", () => {
    const pending = lcmMaintenanceHintFromEvent(
      undefined,
      maintenanceEvent("lcm.maintenance.started", { status: "scheduled" }),
      1000,
    )
    expect(pending).toMatchObject({
      kind: "maintenance",
      state: "pending",
      label: "Memory pending",
      operationID: "op_context_ui_soft",
      blocking: false,
      softBacklogTokens: 18_000,
    })

    const running = lcmMaintenanceHintFromEvent(pending, maintenanceEvent("lcm.maintenance.started"), 1500)
    expect(running).toMatchObject({
      state: "running",
      label: "Summarizing memory",
      operationID: "op_context_ui_soft",
    })

    const completed = lcmMaintenanceHintFromEvent(running, maintenanceEvent("lcm.maintenance.ended"), 2000)
    expect(completed).toMatchObject({
      state: "completed",
      label: "Memory updated",
      afterTokens: 32_000,
    })
    expect(completed && isLcmMaintenanceHintExpired(completed, 5999)).toBe(false)
    expect(completed && isLcmMaintenanceHintExpired(completed, 6000)).toBe(true)
  })

  it("surfaces blocking hard-limit maintenance as visible memory progress", () => {
    const next = lcmMaintenanceHintFromEvent(
      undefined,
      maintenanceEvent("lcm.maintenance.started", {
        phase: "hard_limit",
        reason: "hard_limit",
        blocking: true,
        status: "started",
        safeLabel: "Preparing memory for this response...",
      }),
      1500,
    )
    expect(next).toMatchObject({
      kind: "maintenance",
      state: "running",
      label: "Preparing memory for this response...",
      blocking: true,
      reason: "hard_limit",
    })
  })

  it("keeps failed memory hints visible until a recovery event replaces them", () => {
    const failed = lcmMaintenanceHintFromEvent(
      undefined,
      maintenanceEvent("lcm.maintenance.failed", {
        safeError: {
          code: "provider_unavailable",
          templateKey: "lcm.provider.unavailable",
          safeParams: { retryable: true, action: "retry" },
          safeMessage: "Memory summary provider is temporarily unavailable.",
          action: "retry",
          retryable: true,
          diagnosticCode: "lcm_provider_unavailable",
        },
      }),
      1000,
    )
    expect(failed).toMatchObject({
      kind: "maintenance",
      state: "failed",
      label: "Memory provider unavailable",
      safeCode: "provider_unavailable",
      retryable: true,
    })
    expect(failed && isLcmMaintenanceHintExpired(failed, 86_401_000)).toBe(false)

    const recovered = lcmMaintenanceHintFromEvent(failed, maintenanceEvent("lcm.maintenance.ended"), 2000)
    expect(recovered).toMatchObject({
      state: "completed",
      label: "Memory updated",
    })
  })

  it("lets explicit queued-maintenance cancellation replace a retryable failure hint", () => {
    const failed = lcmMaintenanceHintFromEvent(
      undefined,
      maintenanceEvent("lcm.maintenance.failed", {
        safeError: {
          code: "provider_capacity_deferred",
          templateKey: "lcm.provider_capacity.deferred",
          safeParams: { retryable: true, action: "retry" },
          safeMessage: "Memory maintenance will retry when the provider is available.",
          action: "retry",
          retryable: true,
          diagnosticCode: "lcm_provider_busy",
        },
      }),
      1000,
    )
    const canceled = lcmMaintenanceHintFromEvent(
      failed,
      {
        ...maintenanceEvent("lcm.maintenance.ended", { status: "canceled" }),
        operationID: "op_context_ui_cancel",
      },
      2000,
    )

    expect(canceled).toMatchObject({
      state: "canceled",
      label: "Retry canceled",
      operationID: "op_context_ui_cancel",
    })
  })

  it("turns LCM DB lock events into actionable memory hints", () => {
    const locked = lcmMaintenanceHintFromEvent(undefined, dbStatusEvent(), 1000)
    expect(locked).toMatchObject({
      kind: "db",
      state: "failed",
      label: "Memory locked",
      safeCode: "db_locked",
      action: "close_other_owner",
      retryable: true,
    })
    expect(locked && isLcmMaintenanceHintExpired(locked, 86_401_000)).toBe(false)

    const ready = lcmMaintenanceHintFromEvent(locked, dbStatusEvent({ status: "ready", dbReady: true }), 2000)
    expect(ready).toBeUndefined()
  })

  it("surfaces missing and stale memory sources as recovery-needed inline hints", () => {
    for (const code of ["missing_source", "stale_source"] as const) {
      const failed = lcmMaintenanceHintFromEvent(
        undefined,
        maintenanceEvent("lcm.maintenance.failed", {
          safeError: {
            code,
            templateKey: "lcm.source.recovery_required",
            safeParams: { retryable: false, action: "start_new_thread" },
            safeMessage: "Memory source recovery is needed before this context can be used.",
            action: "start_new_thread",
            retryable: false,
            diagnosticCode: `lcm_${code}_ui`,
          },
        }),
        1000,
      )

      expect(failed).toMatchObject({
        kind: "maintenance",
        state: "failed",
        label: "Memory recovery needed",
        safeCode: code,
        action: "start_new_thread",
        retryable: false,
      })
    }
  })
})
