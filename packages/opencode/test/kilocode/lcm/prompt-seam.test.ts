import { describe, expect, test } from "bun:test"
import path from "node:path"

const promptPath = path.resolve(import.meta.dir, "../../../src/session/prompt.ts")

describe("LCM prompt seam", () => {
  test("projects only after upstream request assembly and before provider execution", async () => {
    const source = await Bun.file(promptPath).text()
    const converted = source.indexOf("MessageV2.toModelMessagesEffect")
    const projected = source.indexOf("conversationMemory.project")
    const processed = source.indexOf("handle.process({", projected)

    expect(converted).toBeGreaterThan(0)
    expect(projected).toBeGreaterThan(converted)
    expect(processed).toBeGreaterThan(projected)
    expect(source.slice(processed, processed + 1_200)).toContain("messages: projectedMessages")
  })

  test("uses blocking LCM hard maintenance without a legacy compaction fallback", async () => {
    const source = await Bun.file(promptPath).text()
    const projected = source.indexOf("conversationMemory.project")
    const hardFailure = source.indexOf("lcm_hard_limit_unresolved", projected)
    const provider = source.indexOf("handle.process({", projected)
    const retry = source.indexOf("conversationMemory.maintain", provider)

    expect(projected).toBeGreaterThan(0)
    expect(hardFailure).toBeGreaterThan(projected)
    expect(provider).toBeGreaterThan(hardFailure)
    expect(retry).toBeGreaterThan(provider)
    expect(source).toContain('projection.type !== "projected"')
    expect(source.slice(projected, provider)).not.toContain("compaction.create")
    expect(source.slice(provider, retry + 500)).not.toContain("compaction.create")
  })
})
