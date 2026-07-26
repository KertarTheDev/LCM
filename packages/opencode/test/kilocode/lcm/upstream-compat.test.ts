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

  test("keeps manual compaction commands and LCM command discovery independent", async () => {
    const builtins = await source("kilocode/session/builtin-commands.ts")
    const palette = await source("kilocode/plugins/lcm-palette.tsx")

    expect(builtins).toContain('"compact"')
    expect(builtins).toContain('"summarize"')
    expect(palette).toContain('slashName: "lcm"')
    expect(palette).not.toMatch(/compact|summarize/)
  })

  test("contains exactly two small annotated seams in the shared prompt owner", async () => {
    const prompt = await source("session/prompt.ts")
    expect(prompt.match(/conversationMemory\.ensureReady/g)).toHaveLength(1)
    expect(prompt.match(/conversationMemory\.project/g)).toHaveLength(1)
    expect(prompt).toContain("preserve exact upstream fallback when LCM cannot prepare")
  })
})
