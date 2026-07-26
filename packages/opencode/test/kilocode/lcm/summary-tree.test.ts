import { describe, expect, test } from "bun:test"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { rollForwardItems, SummaryTree } from "@/kilocode/session/lcm/summary-tree"
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
  test("rolls a valid frontier forward only for a strict source append", () => {
    const previous = Array.from({ length: 3 }, (_, ordinal) => makeSource(ordinal))
    const next = [...previous, makeSource(3)]
    const revision = {
      id: "rev_previous",
      sessionID: "ses_tree",
      lineageDigest: lineageDigest(previous),
      reason: "background" as const,
      items: [
        { kind: "summary" as const, id: "sum_0123456789abcdef01234567", ordinal: 0 },
        { kind: "source" as const, id: previous[2]!.id, ordinal: 2 },
      ],
      createdAt: 1,
    }

    expect(rollForwardItems({ revision, previousSources: previous, sources: next })).toEqual([
      ...revision.items,
      { kind: "source", id: next[3]!.id, ordinal: 3 },
    ])
    expect(
      rollForwardItems({
        revision,
        previousSources: previous,
        sources: [{ ...previous[0]!, digest: "rewritten" }, ...next.slice(1)],
      }),
    ).toBeUndefined()
  })

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

  test("rejects invented recovery handles and records model attempts", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: "Use invented source src_aaaaaaaaaaaaaaaaaaaaaaaa.",
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.001,
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "background",
    })

    expect(revision).toBeDefined()
    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).not.toContain("src_aaaaaaaaaaaaaaaaaaaaaaaa")
    expect((await store.metrics("ses_tree")).work.attempts).toBe(2)
    store.close()
  })
})
