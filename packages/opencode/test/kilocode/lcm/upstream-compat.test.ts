import { describe, expect, test } from "bun:test"
import path from "node:path"

async function source(relative: string) {
  return Bun.file(path.resolve(import.meta.dir, "../../../src", relative)).text()
}

describe("LCM upstream compatibility contract", () => {
  test("isolates five recovery primitives behind one parent-facing query without replacing native code mode", async () => {
    const registry = await source("tool/registry.ts")
    expect(registry).not.toContain('import * as LcmToolRegistry from "@/kilocode/tool/lcm-registry"')
    expect(registry).toContain('import("./code-mode")')
    expect(registry).toContain("...(tool.execute ? [tool.execute] : [])")
    expect(registry).toContain("tool.id !== \"execute\" || codeModeDescription")
    const lcmRegistry = await source("kilocode/tool/lcm-registry.ts")
    for (const tool of [
      "LcmQueryTool",
      "LcmGrepTool",
      "LcmDescribeTool",
      "LcmExpandTool",
      "LcmExpandQueryTool",
      "LcmReadTool",
    ])
      expect(lcmRegistry).toContain(tool)
    expect(lcmRegistry).toContain("lcmToolAvailable")
    const kiloRegistry = await source("kilocode/tool/registry.ts")
    for (const tool of ["RecallTool", "NotifyUserTool"]) expect(kiloRegistry).toContain(tool)
    expect(kiloRegistry).toContain('import * as LcmToolRegistry from "./lcm-registry"')
    expect(kiloRegistry).toContain("...LcmToolRegistry.extra(tools.lcm ?? [], cfg)")
    expect(kiloRegistry).toContain('if (tool.id.startsWith("lcm_")) return LcmToolRegistry.available')
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
    expect(handler).toContain("ConversationMemoryManual.run")
    expect(handler).toContain('if (route === "upstream")')
    expect(remote).toContain('import("@/kilocode/session/lcm/manual")')
    expect(remote).toContain("return AppRuntime.runPromise(ConversationMemoryManual.run(input))")
    expect(remote).toContain('if (route === "upstream")')
  })

  test("contains one projection seam plus successful-consumption and hard-retry checkpoints", async () => {
    const prompt = await source("session/prompt.ts")
    const host = await source("kilocode/session/lcm/prompt-host.ts")
    expect(prompt.match(/ConversationMemoryPromptHost\.prepare/g)).toHaveLength(1)
    expect(prompt.match(/ConversationMemoryPromptHost\.recoverOverflow/g)).toHaveLength(1)
    expect(prompt.match(/preparedRequest\.complete/g)).toHaveLength(2)
    expect(prompt).toContain("yield* preparedRequest.complete(true)")
    expect(host.match(/input\.memory\.project/g)).toHaveLength(1)
    expect(host.match(/input\.memory\.completeRequest/g)).toHaveLength(1)
    expect(host.match(/input\.memory\.maintain/g)).toHaveLength(1)
    expect(host).toContain("lcm_hard_limit_unresolved")
  })
})
