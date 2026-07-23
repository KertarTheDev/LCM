import { describe, expect, it } from "bun:test"
import path from "node:path"
import type { LcmMetricsSnapshot } from "@kilocode/sdk/v2/client"
import { isNewerLcmMetrics, lcmPressureDisplay } from "../../webview-ui/src/components/chat/lcm-status"

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
      collapsed: "40,000 / 80,000",
      expanded: "Hard 50% · Raw 30% · Backlog 20%",
    })
  })

  it("rejects stale per-session metrics after reconnect hydration", () => {
    const current = { updatedAt: "2026-07-22T12:00:01.000Z" } as LcmMetricsSnapshot
    const stale = { updatedAt: "2026-07-22T12:00:00.000Z" } as LcmMetricsSnapshot
    const next = { updatedAt: "2026-07-22T12:00:02.000Z" } as LcmMetricsSnapshot

    expect(isNewerLcmMetrics(current, stale)).toBe(false)
    expect(isNewerLcmMetrics(current, next)).toBe(true)
  })
})
