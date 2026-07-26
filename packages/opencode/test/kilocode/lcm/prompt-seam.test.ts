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

  test("gives memory one opportunity while preserving upstream compaction fallback", async () => {
    const source = await Bun.file(promptPath).text()
    const ready = source.indexOf("conversationMemory.ensureReady")
    const fallback = source.indexOf("compaction.create", ready)

    expect(ready).toBeGreaterThan(0)
    expect(fallback).toBeGreaterThan(ready)
    expect(source.slice(ready, fallback + 200)).toContain("if (lcmReady)")
    expect(source.slice(ready, fallback + 200)).toContain("else")
    expect(source).toContain('projection.type !== "projected"')
    expect(source).toContain("cfg.compaction?.auto !== false")
    const hardFallback = source.indexOf("if (forceUpstreamCompaction)")
    const removeProvisional = source.indexOf("sessions.removeMessage", hardFallback)
    const createCompaction = source.indexOf("compaction.create", hardFallback)
    const provider = source.indexOf("handle.process({", hardFallback)
    expect(hardFallback).toBeGreaterThan(ready)
    expect(removeProvisional).toBeGreaterThan(hardFallback)
    expect(createCompaction).toBeGreaterThan(removeProvisional)
    expect(provider).toBeGreaterThan(createCompaction)
  })
})
