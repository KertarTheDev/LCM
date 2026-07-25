import { describe, expect, test } from "bun:test"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource } from "@/kilocode/session/lcm/types"

function makeSource(ordinal: number, tokens = 800): FinalSource {
  const content = `source ${ordinal} ${"detail ".repeat(tokens)}`
  const digest = sha256(content)
  return {
    id: sourceID({
      sessionID: "ses_tree",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      kind: "user_text",
      digest,
    }),
    sessionID: "ses_tree",
    messageID: `msg_${ordinal}`,
    partID: `part_${ordinal}`,
    ordinal,
    kind: "user_text",
    digest,
    tokens,
    bytes: Buffer.byteLength(content),
    excerpt: content.slice(0, 300),
  }
}

describe("LCM summary tree", () => {
  test("builds a stable bounded frontier and preserves the raw tail", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = Array.from({ length: 20 }, (_, ordinal) => makeSource(ordinal))
    const digest = lineageDigest(sources)
    const lineage = {
      sessionID: "ses_tree",
      digest,
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const tree = new SummaryTree(store)
    const revision = await tree.build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 2,
      reason: "background",
    })
    expect(revision).toBeDefined()
    expect(revision!.items.filter((item) => item.kind === "summary").length).toBeLessThanOrEqual(8)
    expect(revision!.items.slice(-2).map((item) => item.id)).toEqual(sources.slice(-2).map((item) => item.id))

    const again = await tree.build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 2,
      reason: "background",
    })
    expect(again!.items.map((item) => item.id)).toEqual(revision!.items.map((item) => item.id))
    store.close()
  })

  test("does not commit an ineffective summary", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0, 1)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "background",
    })
    expect(revision).toBeUndefined()
    expect(await store.listSummaries("ses_tree")).toEqual([])
    store.close()
  })
})
