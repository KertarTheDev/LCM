import { describe, expect, test } from "bun:test"
import path from "node:path"

const promptPath = path.resolve(import.meta.dir, "../../../src/session/prompt.ts")
const hostPath = path.resolve(import.meta.dir, "../../../src/kilocode/session/lcm/prompt-host.ts")
const servicePath = path.resolve(import.meta.dir, "../../../src/kilocode/session/lcm/service.ts")

describe("LCM prompt seam", () => {
  test("projects only after upstream request assembly and before provider execution", async () => {
    const source = await Bun.file(promptPath).text()
    const converted = source.indexOf("MessageV2.toModelMessagesEffect")
    const finalStep = source.indexOf("content: MAX_STEPS_PROMPT", converted)
    const projected = source.indexOf("ConversationMemoryPromptHost.prepare")
    const processed = source.indexOf("handle.process({", projected)

    expect(converted).toBeGreaterThan(0)
    expect(finalStep).toBeGreaterThan(converted)
    expect(projected).toBeGreaterThan(converted)
    expect(processed).toBeGreaterThan(projected)
    expect(source.slice(processed, processed + 1_200)).toContain("messages: preparedRequest.messages")
    expect(source).not.toMatch(/\bMAX_STEPS\b/)
  })

  test("records successful consumption before a superseded queued handoff", async () => {
    const source = await Bun.file(promptPath).text()
    const completed = source.indexOf("yield* preparedRequest.complete(true)")
    const handoff = source.indexOf("KiloSessionPromptQueue.hasFollowup", completed)

    expect(completed).toBeGreaterThan(0)
    expect(handoff).toBeGreaterThan(completed)
    expect(source.slice(handoff, handoff + 300)).toContain('closeReasons.set(sessionID, "superseded")')
  })

  test("uses blocking LCM hard maintenance without a legacy compaction fallback", async () => {
    const source = await Bun.file(promptPath).text()
    const host = await Bun.file(hostPath).text()
    const projected = host.indexOf("input.memory.project")
    const hardFailure = host.indexOf("lcm_hard_limit_unresolved", projected)
    const retry = host.indexOf("input.memory.maintain", hardFailure)

    expect(projected).toBeGreaterThan(0)
    expect(hardFailure).toBeGreaterThan(projected)
    expect(retry).toBeGreaterThan(hardFailure)
    expect(host).toContain('projection.type !== "projected"')
    expect(host).not.toContain("compaction.create")
    expect(source).toContain('if (result === "compact")')
    expect(source).toContain("if (conversationMemoryEnabled)")
  })

  test("retains the upstream compact result and verifies the stricter external retry", async () => {
    const source = await Bun.file(promptPath).text()
    const host = await Bun.file(hostPath).text()
    expect(source).toContain('contextManagement: conversationMemoryEnabled ? "external" : "upstream"')
    expect(source).toContain('result === "compact"')
    expect(source).not.toContain('result === "provider_overflow"')
    expect(host).toContain('reason: input.state.overflowRetry ? "hard" : "soft"')
    expect(host).toContain("retryTokens < retry.requestTokens")
    expect(host).toContain("projection.revision.id === retry.revisionID")
  })

  test("keeps routine projection reuse out of activity timeline records", async () => {
    const source = await Bun.file(servicePath).text()
    expect(source).not.toContain("Conversation Memory represented earlier conversation with summaries.")
    expect(source).toContain("Conversation Memory prepared an earlier-history summary.")
    expect(source).toContain('reason: input.reason === "hard" || hard ? "hard_built" : "soft_ready"')
  })
})
