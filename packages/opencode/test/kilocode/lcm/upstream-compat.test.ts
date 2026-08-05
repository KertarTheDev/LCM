import { describe, expect, test } from "bun:test"
import path from "node:path"

async function source(relative: string) {
  return Bun.file(path.resolve(import.meta.dir, "../../../src", relative)).text()
}

describe("LCM upstream compatibility contract", () => {
  test("keeps upstream memory and notification tools registered beside the five recovery tools", async () => {
    const registry = await source("tool/registry.ts")
    for (const tool of ["LcmGrepTool", "LcmDescribeTool", "LcmExpandTool", "LcmExpandQueryTool", "LcmReadTool"])
      expect(registry).toContain(tool)
    const kiloRegistry = await source("kilocode/tool/registry.ts")
    for (const tool of ["RecallTool", "NotifyUserTool"]) expect(kiloRegistry).toContain(tool)
  })

  test("keeps manual compaction affordances and selects LCM or upstream compaction at shared adapters", async () => {
    const builtins = await source("kilocode/session/builtin-commands.ts")
    const palette = await source("kilocode/plugins/lcm-palette.tsx")
    const handler = await source("server/routes/instance/httpapi/handlers/session.ts")
    const remote = await source("kilo-sessions/remote-command.ts")

    expect(builtins).toContain('"compact"')
    expect(builtins).toContain('"summarize"')
    expect(palette).toContain('slashName: "lcm"')
    expect(palette).toContain("conversation_memory !== false")
    expect(palette).not.toMatch(/compact|summarize/)
    expect(handler).toContain("ConversationMemoryFeature.enabled")
    expect(handler).toContain("conversationMemory.maintain")
    expect(handler).toContain("compactSvc.create")
    expect(remote).toContain("ConversationMemoryFeature.enabled")
    expect(remote).toContain("service.maintain")
    expect(remote).toContain("SessionCompaction.Service")
  })

  test("contains one projection seam plus successful-consumption and hard-retry checkpoints", async () => {
    const prompt = await source("session/prompt.ts")
    const service = await source("kilocode/session/lcm/service.ts")
    expect(prompt.match(/conversationMemory\.project/g)).toHaveLength(1)
    expect(prompt.match(/conversationMemory\.completeRequest/g)).toHaveLength(1)
    expect(prompt.match(/completeMemory\(/g)).toHaveLength(9)
    expect(prompt).toContain('completeMemory(!handle.message.error && result === "continue")')
    expect(prompt.match(/conversationMemory\.maintain/g)).toHaveLength(1)
    expect(prompt).toContain("lcm_hard_limit_unresolved")
    expect(service).toContain("onModelStart: markReady")
    expect(service).toContain("if (ready) yield* Effect.promise(() => ready)")
  })
})
