import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { isConversationMemoryMessage, Projector } from "@/kilocode/session/lcm/projector"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource } from "@/kilocode/session/lcm/types"

function makeSource(ordinal: number): FinalSource {
  const content = `turn ${ordinal} ${"detail ".repeat(500)}`
  const digest = sha256(content)
  return {
    id: sourceID({
      sessionID: "ses_project",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      kind: "user_text",
      digest,
    }),
    sessionID: "ses_project",
    messageID: `msg_${ordinal}`,
    partID: `part_${ordinal}`,
    ordinal,
    kind: "user_text",
    digest,
    tokens: 500,
    bytes: Buffer.byteLength(content),
    excerpt: content.slice(0, 300),
  }
}

function measure(messages: ModelMessage[]) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(messages)) / 4)
}

describe("LCM projector", () => {
  test("replaces only the eligible prefix and pins a continuation revision", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = Array.from({ length: 12 }, (_, ordinal) => makeSource(ordinal))
    const digest = lineageDigest(sources)
    const lineage = {
      sessionID: "ses_project",
      digest,
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    await store.replaceSources({ sessionID: "ses_project", lineage, sources })
    const revision = await new SummaryTree(store).build({
      sessionID: "ses_project",
      lineage,
      usableInputTokens: 4_000,
      protectedSources: 2,
      reason: "background",
    })
    const messages: ModelMessage[] = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index} ${"raw ".repeat(500)}`,
    }))
    const projector = new Projector(store)
    const result = await projector.project({
      sessionID: "ses_project",
      lineage,
      system: ["unchanged system"],
      messages,
      tools: { read: { description: "unchanged" } },
      usableInputTokens: 4_000,
      thresholdRatio: 0.6,
      protectedTailTurns: 2,
      continuationID: "msg_current",
      reason: "soft",
      measure,
    })
    expect(result.type).toBe("projected")
    if (result.type !== "projected") throw new Error("expected projection")
    expect(isConversationMemoryMessage(result.messages[0]!)).toBe(true)
    expect(result.messages.slice(1)).toEqual(messages.slice(4))
    expect(result.revision.id).toBe(revision!.id)

    await store.commitRevision({
      ...revision!,
      id: "rev_newer",
      createdAt: revision!.createdAt + 1,
    })
    const pinned = await projector.project({
      sessionID: "ses_project",
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 4_000,
      thresholdRatio: 0.6,
      protectedTailTurns: 2,
      continuationID: "msg_current",
      reason: "soft",
      measure,
    })
    expect(pinned.type === "projected" && pinned.revision.id).toBe(revision!.id)
    store.close()
  })

  test("is a no-op below pressure and when all history is protected", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const projector = new Projector(store)
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }]
    const base = {
      sessionID: "ses_none",
      lineage: { sessionID: "ses_none", digest: "none", sourceCount: 0 },
      system: [],
      messages,
      tools: {},
      protectedTailTurns: 2,
      reason: "soft" as const,
      measure,
    }
    expect(
      (
        await projector.project({
          ...base,
          usableInputTokens: 4_000,
          thresholdRatio: 0.6,
        })
      ).type,
    ).toBe("unchanged")
    expect(
      (
        await projector.project({
          ...base,
          usableInputTokens: 1,
          thresholdRatio: 0.6,
        })
      ).type,
    ).toBe("unchanged")
    store.close()
  })
})
