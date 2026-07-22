import { describe, expect, it } from "bun:test"
import path from "node:path"

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
    expect(source).toContain("memory.showMemory()")
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
})
