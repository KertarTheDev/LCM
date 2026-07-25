import { describe, expect, test } from "bun:test"
import { lineageDigest, nodeKey, sha256, sourceID, summaryID } from "@/kilocode/session/lcm/ids"
import { sidecarPath, SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import type { FinalSource, SummaryChild, SummaryNode } from "@/kilocode/session/lcm/types"

function makeSource(ordinal: number): FinalSource {
  const content = `source ${ordinal}`
  const digest = sha256(content)
  return {
    id: sourceID({
      sessionID: "ses_test",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      kind: "user_text",
      digest,
    }),
    sessionID: "ses_test",
    messageID: `msg_${ordinal}`,
    partID: `part_${ordinal}`,
    ordinal,
    kind: "user_text",
    digest,
    tokens: 2,
    bytes: Buffer.byteLength(content),
    excerpt: content,
  }
}

describe("LCM SQLite store", () => {
  test("derives an adjacent sidecar path", () => {
    expect(sidecarPath("/data/kilo.db")).toBe("/data/kilo.lcm.db")
    expect(sidecarPath("/data/kilo-beta.db")).toBe("/data/kilo-beta.lcm.db")
    expect(sidecarPath("/data/custom")).toBe("/data/custom.lcm")
    expect(sidecarPath(":memory:")).toBe(":memory:")
  })

  test("commits source metadata, immutable summaries, and a lineage-bound frontier", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0), makeSource(1)]
    const digest = lineageDigest(sources)
    await store.replaceSources({
      sessionID: "ses_test",
      sources,
      lineage: { sessionID: "ses_test", digest, sourceCount: sources.length, lastSourceID: sources.at(-1)?.id },
    })

    expect(await store.listSources("ses_test")).toEqual(sources)
    const children: SummaryChild[] = sources.map((item, ordinal) => ({
      summaryID: "",
      kind: "source",
      id: item.id,
      ordinal,
    }))
    const key = nodeKey(children, digest, "test-policy")
    const text = "The user supplied two ordered test sources."
    const id = summaryID({ nodeKey: key, text })
    children.forEach((child) => (child.summaryID = id))
    const summary: SummaryNode = {
      id,
      nodeKey: key,
      sessionID: "ses_test",
      level: 0,
      text,
      digest: sha256(text),
      sourceDigest: digest,
      tokens: 8,
      bytes: Buffer.byteLength(text),
      firstOrdinal: 0,
      lastOrdinal: 1,
      generationMode: "deterministic",
      createdAt: 1,
    }
    await store.commitSummary({ summary, children })
    await store.commitRevision({
      id: "rev_test",
      sessionID: "ses_test",
      lineageDigest: digest,
      reason: "background",
      items: [{ kind: "summary", id, ordinal: 0 }],
      createdAt: 2,
    })

    expect(await store.getSummary("ses_test", id)).toEqual(summary)
    expect(await store.listChildren("ses_test", id)).toEqual(children)
    expect((await store.activeRevision("ses_test", digest))?.items).toEqual([{ kind: "summary", id, ordinal: 0 }])
    expect((await store.inspect("ses_test")).state).toBe("summarized")
    store.close()
  })

  test("rejects stale frontier activation atomically", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    await store.replaceSources({
      sessionID: "ses_test",
      sources,
      lineage: { sessionID: "ses_test", digest, sourceCount: 1, lastSourceID: sources[0]?.id },
    })
    await expect(
      store.commitRevision({
        id: "rev_stale",
        sessionID: "ses_test",
        lineageDigest: "stale",
        reason: "background",
        items: [{ kind: "source", id: sources[0]!.id, ordinal: 0 }],
        createdAt: 1,
      }),
    ).rejects.toThrow("lcm_stale_lineage")
    expect(await store.activeRevision("ses_test", "stale")).toBeUndefined()
    store.close()
  })

  test("coordinates expiring leases", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    expect(await store.acquireLease({ key: "summary", owner: "a", now: 10, expiresAt: 20 })).toBe(true)
    expect(await store.acquireLease({ key: "summary", owner: "b", now: 15, expiresAt: 25 })).toBe(false)
    expect(await store.acquireLease({ key: "summary", owner: "b", now: 21, expiresAt: 30 })).toBe(true)
    await store.releaseLease({ key: "summary", owner: "b" })
    expect(await store.acquireLease({ key: "summary", owner: "a", now: 22, expiresAt: 32 })).toBe(true)
    store.close()
  })
})
