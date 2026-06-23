import { describe, expect, it } from "bun:test"
import {
  LCM_FRESH_TAIL_DESCRIPTION,
  LCM_EXCLUDED_CONTROL_LABELS,
  dbBackedActionsDisabled,
  describeScope,
  formatBytes,
  formatLcmRelativeTime,
  formatStorageThresholdGiB,
  lcmMemoryActionButtons,
  lcmMemoryStatusItems,
  parseStorageThresholdGiB,
  storageWarningSettingsDescription,
  statusMessage,
} from "../../webview-ui/src/components/settings/lcm-memory-state"
import type { LcmSettingsState } from "@kilocode/sdk/v2/client"

describe("LCM/Memory settings state", () => {
  function settingsState(overrides: Partial<LcmSettingsState> = {}): LcmSettingsState {
    return {
      strategy: "upward",
      freshTailTokens: 20_000,
      storageWarningThresholdBytes: 10737418240,
      storageBytes: 5368709120,
      storageWarning: false,
      effectiveScope: { kind: "default", projectID: "project_a" },
      lifecycleState: "lcm_active",
      dbStatus: { status: "ready", dataDir: "/tmp/lcm", schemaVersion: 1 },
      ...overrides,
    }
  }

  it("formats storage, threshold inputs, and scope without exposing raw byte-only controls", () => {
    expect(formatBytes(10737418240)).toBe("10.0 GiB")
    expect(formatStorageThresholdGiB(10737418240)).toBe("10")
    expect(formatStorageThresholdGiB(1048576)).toBe("0.001")
    expect(parseStorageThresholdGiB("10")).toBe(10737418240)
    expect(parseStorageThresholdGiB("0.001")).toBe(1073742)
    expect(parseStorageThresholdGiB("0.5")).toBe(536870912)
    expect(parseStorageThresholdGiB("10abc")).toBeUndefined()
    expect(describeScope({ effectiveScope: { kind: "default", projectID: "project_a" } })).toBe("Deployment default")
    expect(
      describeScope({ effectiveScope: { kind: "workspace", projectID: "project_a", workspaceID: "workspace_a" } }),
    ).toBe("Workspace")
    expect(LCM_FRESH_TAIL_DESCRIPTION).toBe(
      "How many tokens from the most recent messages are kept unsummarised.",
    )
    expect(storageWarningSettingsDescription(settingsState())).toBe(
      [
        "Current storage: 5.00 GiB.",
        "Warn when memory storage reaches the number of GiB entered here; current threshold is 10.0 GiB.",
      ].join(" "),
    )
  })

  it("disables DB-backed actions for locked/corrupt fallback states", () => {
    expect(
      dbBackedActionsDisabled(
        settingsState({
          dbStatus: { status: "locked", dataDir: "/tmp/lcm" },
          safeError: {
            code: "db_locked",
            templateKey: "lcm.db.unavailable",
            safeParams: { retryable: false },
            safeMessage: "LCM memory is locked by another owner.",
            retryable: false,
          },
        }),
      ),
    ).toBe(true)
  })

  it("keeps status content-safe and excludes forbidden user controls", () => {
    const message = statusMessage({
      state: settingsState({ lifecycleState: undefined, dbStatus: undefined }),
    })
    expect(message).toBe("Memory settings are available. Runtime status is not reported here.")
    expect(LCM_EXCLUDED_CONTROL_LABELS).not.toContain("Cancel conversion")
    expect(LCM_EXCLUDED_CONTROL_LABELS).toContain("View raw memory")
  })

  it("summarizes actionable session memory details for the settings status area", () => {
    const items = lcmMemoryStatusItems({
      state: settingsState({ storageWarning: true }),
      nowMs: Date.parse("2026-05-25T12:05:00.000Z"),
      metrics: {
        conversationID: "conv_memory_state",
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
        hardFillRatio: 0.75,
        rawLaneRatio: 34_000 / 24_000,
        softBacklogRatio: 1.25,
        tokenCounterMode: "deterministic_fallback",
        tokenCounterVersion: "lcm-token-counter-deterministic-fallback-v1",
        laneTokens: {},
        contextItemCounts: {},
        storageBytes: 5368709120,
        storageWarningThresholdBytes: 10737418240,
        storageWarning: true,
        lastMaintenance: {
          operationID: "op_memory_state",
          status: "deferred",
          reason: "soft_threshold",
          blocking: false,
          beforeTokens: 52_000,
        },
        updatedAt: "2026-05-25T12:02:00.000Z",
      },
      contextUsage: {
        tokens: 42_000,
        percentage: 75,
        source: "lcm_active_budget",
        label: "Memory active budget",
        limit: 56_000,
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
        rawLaneRatio: 34_000 / 24_000,
        softBacklogRatio: 1.25,
        hardFillRatio: 0.75,
        budgetStatus: "provider_limit_fallback",
      },
    })

    expect(items).toContainEqual({ label: "Last sync", value: "3m ago", tone: "normal" })
    expect(items).toContainEqual({
      label: "Maintenance",
      value: "Will retry",
      tone: "warning",
      detail: "Active 42,000 / 56,000 tokens. Backlog 30,000 / 24,000 tokens in 12 items",
    })
    expect(items).toContainEqual({ label: "Active budget", value: "42,000 / 56,000 (75%)", tone: "normal" })
    expect(items).toContainEqual({
      label: "Raw lane",
      value: "34,000 / 24,000 (142%)",
      tone: "warning",
      detail: "Protected tail: 4,000",
    })
    expect(items).toContainEqual({ label: "Soft backlog", value: "30,000 / 24,000 (125%)", tone: "warning" })
    expect(items).toContainEqual({ label: "Storage", value: "5.00 GiB / 10.0 GiB", tone: "warning" })
    expect(items).toContainEqual({
      label: "Token counting",
      value: "Estimated",
      tone: "warning",
      detail: "lcm-token-counter-deterministic-fallback-v1",
    })
    expect(items).toContainEqual({
      label: "Model limits",
      value: "Estimated",
      tone: "warning",
      detail: "Using conservative fallback limits for this provider.",
    })
  })

  it("shows plain maintenance progress details while memory work is active", () => {
    const items = lcmMemoryStatusItems({
      state: settingsState(),
      maintenanceHint: {
        kind: "maintenance",
        state: "running",
        label: "Preparing memory",
        operationID: "op_memory_running",
        reason: "hard_limit",
        phase: "hard_limit",
        blocking: true,
        updatedAtMs: Date.parse("2026-05-25T12:00:00.000Z"),
        beforeTokens: 64_000,
        afterTokens: 52_000,
        hardLimit: 56_000,
        softThreshold: 24_000,
        softBacklogTokens: 30_000,
        softBacklogItemCount: 12,
        safeMessage: "Preparing memory for this response...",
      },
    })

    expect(items).toContainEqual({
      label: "Maintenance",
      value: "Preparing memory",
      tone: "warning",
      detail:
        "Preparing memory for this response... Reduced 64,000 -> 52,000 tokens. Backlog 30,000 / 24,000 tokens in 12 items",
    })
  })

  it("shows waiting checkpoint status when raw pressure is over threshold without active maintenance", () => {
    const items = lcmMemoryStatusItems({
      state: settingsState(),
      metrics: {
        conversationID: "conv_memory_checkpoint",
        lifecycleState: "lcm_active",
        strategy: "upward",
        activeTokens: 48_000,
        hardLimit: 80_000,
        softThreshold: 24_000,
        freshTailTokens: 20_000,
        softBacklogTokens: 28_000,
        softBacklogItemCount: 8,
        freshTailRawTokens: 6000,
        freshTailRawItemCount: 2,
        unconsumedRawTokens: 0,
        unconsumedRawItemCount: 0,
        protectedTailRawTokens: 6000,
        protectedTailRawItemCount: 2,
        rawLaneTokens: 34_000,
        rawLaneRatio: 34_000 / 24_000,
        softBacklogRatio: 28_000 / 24_000,
        tokenCounterMode: "fake",
        tokenCounterVersion: "lcm-memory-state-test",
        laneTokens: {},
        contextItemCounts: {},
        storageBytes: 5368709120,
        storageWarningThresholdBytes: 10737418240,
        storageWarning: false,
        updatedAt: "2026-05-25T12:02:00.000Z",
      },
    })

    expect(items).toContainEqual({
      label: "Maintenance",
      value: "Waiting for checkpoint",
      tone: "warning",
      detail:
        "Memory will summarize after the next finalized checkpoint. Active 48,000 / 80,000 tokens. Backlog 28,000 / 24,000 tokens in 8 items",
    })
  })

  it("surfaces retryable safe actions without exposing raw controls", () => {
    const items = lcmMemoryStatusItems({
      state: settingsState({
        safeError: {
          code: "db_locked",
          templateKey: "lcm.db.unavailable",
          safeParams: { retryable: true, action: "close_other_owner" },
          safeMessage: "LCM memory is locked by another owner.",
          retryable: true,
          action: "close_other_owner",
        },
      }),
    })

    expect(items).toContainEqual({
      label: "Next step",
      value: "Close other Kilo Code window",
      tone: "warning",
      detail: "LCM memory is locked by another owner.",
    })
    expect(
      lcmMemoryActionButtons({
        state: settingsState({
          safeError: {
            code: "db_locked",
            templateKey: "lcm.db.unavailable",
            safeParams: { retryable: true, action: "close_other_owner" },
            safeMessage: "LCM memory is locked by another owner.",
            retryable: true,
            action: "close_other_owner",
          },
        }),
      }),
    ).toEqual([
      {
        kind: "diagnose_db",
        label: "Run diagnostics",
        icon: "help",
        title: "LCM memory is locked by another owner.",
      },
      {
        kind: "refresh",
        label: "Check again",
        icon: "history",
        title: "LCM memory is locked by another owner.",
      },
      {
        kind: "export_prompts",
        label: "Export prompts",
        icon: "square-arrow-top-right",
        title: "Export prompts is available when memory database is ready. LCM memory is locked by another owner.",
        disabled: true,
      },
    ])
  })

  it("keeps prompt export visible and disables it until the DB is ready", () => {
    expect(lcmMemoryActionButtons({ state: settingsState() })).toContainEqual({
      kind: "export_prompts",
      label: "Export prompts",
      icon: "square-arrow-top-right",
      title: "Export reconstructed LCM model prompts and active context Markdown.",
    })
    expect(lcmMemoryActionButtons({ state: settingsState({ dbStatus: undefined }) })).toContainEqual({
      kind: "export_prompts",
      label: "Export prompts",
      icon: "square-arrow-top-right",
      title: "Export prompts is available when memory database is ready. Memory database status is not reported.",
      disabled: true,
    })
    expect(
      lcmMemoryActionButtons({ state: settingsState({ dbStatus: { status: "starting", dataDir: "/tmp/lcm" } }) }),
    ).toContainEqual({
      kind: "export_prompts",
      label: "Export prompts",
      icon: "square-arrow-top-right",
      title: "Export prompts is available when memory database is ready. starting",
      disabled: true,
    })
  })

  it("maps safe recovery actions to supported UI buttons only", () => {
    expect(
      lcmMemoryActionButtons({
        error: {
          code: "hard_limit_unresolved",
          templateKey: "lcm.hard_limit.unresolved",
          safeParams: { action: "start_new_thread" },
          safeMessage: "LCM could not reduce memory enough for the provider limit.",
          retryable: false,
          action: "start_new_thread",
        },
      }),
    ).toEqual([
      {
        kind: "new_task",
        label: "New task",
        icon: "new-session",
        title: "LCM could not reduce memory enough for the provider limit.",
      },
    ])
    expect(
      lcmMemoryActionButtons({
        error: {
          code: "db_corrupt",
          templateKey: "lcm.db.unavailable",
          safeParams: { retryable: false, action: "contact_support" },
          safeMessage: "LCM memory needs support.",
          retryable: false,
          action: "contact_support",
        },
      }),
    ).toEqual([
      {
        kind: "diagnose_db",
        label: "Run diagnostics",
        icon: "help",
        title: "LCM memory needs support.",
      },
      {
        kind: "support",
        label: "Open support",
        icon: "square-arrow-top-right",
        title: "LCM memory needs support.",
      },
    ])
  })

  it("offers a safe cancel action for queued retryable maintenance", () => {
    expect(
      lcmMemoryActionButtons({
        maintenanceHint: {
          kind: "maintenance",
          state: "failed",
          label: "Memory will retry",
          operationID: "op_memory_retry",
          reason: "soft_threshold",
          phase: "leaf_summary",
          blocking: false,
          updatedAtMs: Date.parse("2026-05-25T12:00:00.000Z"),
          safeMessage: "Memory maintenance will retry when the provider is available.",
          safeCode: "provider_capacity_deferred",
          action: "retry",
          retryable: true,
          diagnosticCode: "lcm_provider_busy",
        },
      }),
    ).toEqual([
      {
        kind: "cancel_maintenance",
        label: "Cancel retry",
        icon: "close",
        title: "Memory maintenance will retry when the provider is available.",
      },
    ])
  })

  it("formats recent memory sync times compactly", () => {
    const nowMs = Date.parse("2026-05-25T12:00:00.000Z")
    expect(formatLcmRelativeTime("2026-05-25T11:59:45.000Z", nowMs)).toBe("Just now")
    expect(formatLcmRelativeTime("2026-05-25T11:12:00.000Z", nowMs)).toBe("48m ago")
    expect(formatLcmRelativeTime("2026-05-24T06:00:00.000Z", nowMs)).toBe("1d ago")
    expect(formatLcmRelativeTime(undefined, nowMs)).toBe("Not reported")
  })
})
