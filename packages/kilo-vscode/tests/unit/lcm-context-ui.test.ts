import { describe, expect, it } from "bun:test"
import path from "node:path"
import type { LcmActivityPage, LcmMetricsSnapshot } from "@kilocode/sdk/v2/client"
import { isNewerLcmMetrics, lcmPressureDisplay } from "../../webview-ui/src/components/chat/lcm-status"
import { lcmBars } from "../../webview-ui/src/components/chat/lcm-timeline"

const root = path.resolve(import.meta.dir, "../..")

describe("LCM context settings UI", () => {
  it("keeps conversation context separate from upstream project memory", async () => {
    const source = await Bun.file(path.join(root, "webview-ui/src/components/settings/ContextTab.tsx")).text()
    const lcm = source.indexOf("<LcmContextSettings />")
    const projectMemory = source.indexOf('language.t("settings.context.memory.title")')

    expect(lcm).toBeGreaterThan(-1)
    expect(projectMemory).toBeGreaterThan(lcm)
    expect(source).toContain("useMemory()")
    expect(source).toContain("memory.enable()")
    expect(source).toContain("memory.inspect()")
  })

  it("presents only the supported conversation-context settings", async () => {
    const source = await Bun.file(path.join(root, "webview-ui/src/components/settings/LcmContextSettings.tsx")).text()

    expect(source).toContain("LCM conversation context")
    expect(source).toContain('strategy?: "upward" | "dolt"')
    expect(source).toContain("storageWarningThresholdBytes?: number")
    expect(source).not.toContain("lcm.enabled")
    expect(source).not.toContain("prewarm")
  })

  it("shows session pressure, paid activity, support actions, and prompt export", async () => {
    const source = await Bun.file(path.join(root, "webview-ui/src/components/settings/LcmContextSettings.tsx")).text()

    expect(source).toContain("Hard / raw / backlog")
    expect(source).toContain("LCM token activity")
    expect(source).toContain("Diagnose")
    expect(source).toContain("Preview lock recovery")
    expect(source).toContain("Preview rebuild")
    expect(source).toContain("Cancel maintenance")
    expect(source).toContain("Export compaction prompts")
    expect(source).toContain("setPending(activeRequests.size > 0)")
    expect(source).toContain("activeRequests.clear()")
  })

  it("computes the main-view hard, raw, and backlog pressure from the correct budgets", () => {
    const metrics = {
      activeTokens: 40_000,
      hardLimit: 80_000,
      rawLaneTokens: 15_000,
      softThreshold: 50_000,
      softBacklogTokens: 10_000,
      updatedAt: "2026-07-22T12:00:00.000Z",
    } as LcmMetricsSnapshot

    expect(lcmPressureDisplay(metrics, "en-US")).toEqual({
      active: 40_000,
      hard: 80_000,
      raw: 15_000,
      soft: 50_000,
      backlog: 10_000,
      hardPercent: 50,
      rawPercent: 30,
      backlogPercent: 20,
      hardLabel: "40,000 / 80,000",
    })
  })

  it("keeps pressure details below the timeline in the upstream token-usage disclosure", async () => {
    const header = await Bun.file(path.join(root, "webview-ui/src/components/chat/TaskHeader.tsx")).text()
    const usage = await Bun.file(path.join(root, "webview-ui/src/components/chat/TaskUsage.tsx")).text()

    expect(header).not.toContain('data-slot="task-header-lcm-status"')
    expect(header).toContain("lcmMetrics={lcmMetrics()}")
    expect(usage).toContain('data-slot="task-header-lcm-details"')
    expect(usage).toContain("Conversation memory")
  })

  it("renders only provider-backed LCM activity with upstream bar geometry and complete details", () => {
    const activity = {
      conversationID: "conv_timeline",
      items: [
        {
          usageRecordID: "usage_map",
          sessionID: "ses_timeline",
          conversationID: "conv_timeline",
          purpose: "llm_map",
          mode: "map_item",
          providerID: "ollama",
          modelID: "qwen3.6:27b",
          inputTokens: 12,
          outputTokens: 3,
          totalTokens: 15,
          costStatus: "unknown",
          createdAt: "2026-07-23T12:00:02.000Z",
        },
        {
          usageRecordID: "usage_unknown",
          sessionID: "ses_timeline",
          conversationID: "conv_timeline",
          purpose: "leaf_summary",
          mode: "background",
          providerID: "ollama",
          modelID: "qwen3.6:27b",
          totalTokens: 0,
          costStatus: "unknown",
          createdAt: "2026-07-23T12:00:01.000Z",
        },
        {
          usageRecordID: "usage_status",
          sessionID: "ses_timeline",
          conversationID: "conv_timeline",
          purpose: "leaf_summary",
          mode: "background",
          providerID: "ollama",
          modelID: "qwen3.6:27b",
          totalTokens: 0,
          maintenanceStatus: "completed",
          costStatus: "not_applicable",
          createdAt: "2026-07-23T12:00:00.000Z",
        },
      ],
      summary: {
        requestCount: 2,
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        costStatus: "unknown",
      },
    } satisfies LcmActivityPage

    const bars = lcmBars(activity)
    expect(bars.map((bar) => bar.key)).toEqual(["usage_unknown", "usage_map"])
    expect(bars.every((bar) => bar.width === 12)).toBe(true)
    expect(bars[0]!.tip).toContain("LCM · Leaf summary · ollama/qwen3.6:27b · Token usage unavailable · Cost unknown")
    expect(bars[0]!.tip).not.toContain("0 tokens")
    expect(bars[1]!.tip).toContain("LCM · LLM map · ollama/qwen3.6:27b · In 12 · Out 3 · Cost unknown")
  })

  it("rejects stale per-session metrics after reconnect hydration", () => {
    const current = { updatedAt: "2026-07-22T12:00:01.000Z" } as LcmMetricsSnapshot
    const stale = { updatedAt: "2026-07-22T12:00:00.000Z" } as LcmMetricsSnapshot
    const next = { updatedAt: "2026-07-22T12:00:02.000Z" } as LcmMetricsSnapshot

    expect(isNewerLcmMetrics(current, stale)).toBe(false)
    expect(isNewerLcmMetrics(current, next)).toBe(true)
  })
})
