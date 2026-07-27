import { describe, expect, test } from "bun:test"
import path from "node:path"

async function source(relative: string) {
  return Bun.file(path.resolve(import.meta.dir, "../../../src", relative)).text()
}

describe("LCM upstream compatibility contract", () => {
  test("keeps upstream memory and notification tools registered beside the four recovery tools", async () => {
    const registry = await source("tool/registry.ts")
    for (const tool of ["LcmGrepTool", "LcmDescribeTool", "LcmExpandTool", "LcmReadTool"])
      expect(registry).toContain(tool)
    const kiloRegistry = await source("kilocode/tool/registry.ts")
    for (const tool of ["RecallTool", "NotifyUserTool"]) expect(kiloRegistry).toContain(tool)
  })

  test("keeps manual compaction affordances and redirects their shared adapters to LCM", async () => {
    const builtins = await source("kilocode/session/builtin-commands.ts")
    const palette = await source("kilocode/plugins/lcm-palette.tsx")
    const handler = await source("server/routes/instance/httpapi/handlers/session.ts")
    const remote = await source("kilo-sessions/remote-command.ts")

    expect(builtins).toContain('"compact"')
    expect(builtins).toContain('"summarize"')
    expect(palette).toContain('slashName: "lcm"')
    expect(palette).not.toMatch(/compact|summarize/)
    expect(handler).toContain("conversationMemory.maintain")
    expect(remote).toContain("service.maintain")
    expect(handler).not.toContain("compactSvc.create")
  })

  test("contains one projection seam plus successful-consumption and hard-retry checkpoints", async () => {
    const prompt = await source("session/prompt.ts")
    const service = await source("kilocode/session/lcm/service.ts")
    expect(prompt.match(/conversationMemory\.project/g)).toHaveLength(1)
    expect(prompt.match(/conversationMemory\.completeRequest/g)).toHaveLength(7)
    expect(prompt.match(/success: true/g)).toHaveLength(1)
    expect(prompt.match(/success: false/g)).toHaveLength(5)
    expect(prompt).toContain('success: !handle.message.error && result === "continue"')
    expect(prompt.match(/conversationMemory\.maintain/g)).toHaveLength(1)
    expect(prompt).toContain("lcm_hard_limit_unresolved")
    expect(service).toContain("onModelStart: markReady")
    expect(service).toContain("if (ready) yield* Effect.promise(() => ready)")
  })
})
