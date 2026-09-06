import { describe, expect, test } from "bun:test"
import { lineageDigest, nodeKey, sha256, sourceID, summaryID } from "@/kilocode/session/lcm/ids"
import { sidecarPath, SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { LCM_SCHEMA_VERSION, type FinalSource, type SummaryChild, type SummaryNode } from "@/kilocode/session/lcm/types"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

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
    expect((await store.inspect("ses_test")).state).toBe("raw")
    await store.commitRevision({
      id: "rev_test",
      sessionID: "ses_test",
      lineageDigest: digest,
      reason: "soft_leaf",
      items: [{ kind: "summary", id, ordinal: 0 }],
      createdAt: 2,
    })

    expect(await store.getSummary("ses_test", id)).toEqual(summary)
    expect(await store.listChildren("ses_test", id)).toEqual(children)
    expect((await store.activeRevision("ses_test", digest))?.items).toEqual([{ kind: "summary", id, ordinal: 0 }])
    expect((await store.inspect("ses_test")).state).toBe("summarized")
    store.close()
  })

  test("repairs a preparing mode left by an older staged-summary writer", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-preparing-"))
    const target = path.join(root, "kilo.lcm.db")
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_test", digest, sourceCount: 1 }
    const first = SqliteConversationMemoryStore.open({
      databasePath: path.join(root, "kilo.db"),
      derivedPath: target,
    })
    await first.replaceSources({ sessionID: "ses_test", sources, lineage })
    first.close()

    const legacy = new Database(target)
    legacy.query("UPDATE lcm_session SET state = 'preparing' WHERE session_id = 'ses_test'").run()
    legacy.close()

    const reopened = SqliteConversationMemoryStore.open({
      databasePath: path.join(root, "kilo.db"),
      derivedPath: target,
    })
    await reopened.replaceSources({ sessionID: "ses_test", sources, lineage })
    expect((await reopened.inspect("ses_test")).state).toBe("raw")
    reopened.close()
    rmSync(root, { recursive: true })
  })

  test("persists a monotonic status sequence across reopen", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-sequence-"))
    const target = path.join(root, "kilo.lcm.db")
    const source = makeSource(0)
    const lineage = {
      sessionID: "ses_test",
      digest: lineageDigest([source]),
      sourceCount: 1,
      lastSourceID: source.id,
    }
    const first = SqliteConversationMemoryStore.open({ databasePath: path.join(root, "kilo.db"), derivedPath: target })
    expect((await first.inspect("ses_test")).sequence).toBe(0)
    await first.replaceSources({ sessionID: "ses_test", lineage, sources: [source] })
    const afterSources = (await first.inspect("ses_test")).sequence
    await first.bumpStatus("ses_test")
    expect((await first.inspect("ses_test")).sequence).toBe(afterSources + 1)
    first.close()

    const reopened = SqliteConversationMemoryStore.open({
      databasePath: path.join(root, "kilo.db"),
      derivedPath: target,
    })
    expect((await reopened.inspect("ses_test")).sequence).toBe(afterSources + 1)
    reopened.close()
    rmSync(root, { recursive: true })
  })

  test("stores source metadata without duplicating raw source bodies", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-schema-"))
    const target = path.join(root, "kilo.lcm.db")
    const store = SqliteConversationMemoryStore.open({ databasePath: path.join(root, "kilo.db"), derivedPath: target })
    const source = makeSource(0)
    await store.replaceSources({
      sessionID: "ses_test",
      sources: [source],
      lineage: { sessionID: "ses_test", digest: lineageDigest([source]), sourceCount: 1, lastSourceID: source.id },
    })
    const database = new Database(store.path)
    const columns = database
      .query<{ name: string }, []>("PRAGMA table_info(lcm_source)")
      .all()
      .map((column) => column.name)
    expect(columns).toEqual([
      "source_id",
      "session_id",
      "message_id",
      "part_id",
      "ordinal",
      "kind",
      "digest",
      "token_count",
      "byte_count",
      "excerpt",
      "media_type",
      "filename",
    ])
    database.close()
    store.close()
    rmSync(root, { recursive: true })
  })

  test("keeps the derived database and live SQLite sidecars private", async () => {
    if (process.platform === "win32") return
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-mode-"))
    const target = path.join(root, "kilo.lcm.db")
    const store = SqliteConversationMemoryStore.open({ databasePath: path.join(root, "kilo.db"), derivedPath: target })
    const source = makeSource(0)
    await store.replaceSources({
      sessionID: "ses_test",
      sources: [source],
      lineage: { sessionID: "ses_test", digest: lineageDigest([source]), sourceCount: 1, lastSourceID: source.id },
    })
    for (const file of [target, `${target}-wal`, `${target}-shm`].filter(existsSync)) {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    store.close()
    rmSync(root, { recursive: true })
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
        reason: "soft_leaf",
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

  test("retains inactive export evidence across a lineage rewrite", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0), makeSource(1)]
    const digest = lineageDigest(sources)
    await store.replaceSources({
      sessionID: "ses_test",
      sources,
      lineage: { sessionID: "ses_test", digest, sourceCount: sources.length },
    })
    const children: SummaryChild[] = sources.map((item, ordinal) => ({
      summaryID: "",
      kind: "source",
      id: item.id,
      ordinal,
    }))
    const key = nodeKey(children, digest, "history-test")
    const text = "Retained historical summary"
    const id = summaryID({ nodeKey: key, text })
    children.forEach((child) => (child.summaryID = id))
    await store.commitSummary({
      summary: {
        id,
        nodeKey: key,
        sessionID: "ses_test",
        level: 0,
        text,
        digest: sha256(text),
        sourceDigest: digest,
        tokens: 4,
        bytes: Buffer.byteLength(text),
        firstOrdinal: 0,
        lastOrdinal: 1,
        generationMode: "deterministic",
        createdAt: 1,
      },
      children,
    })
    await store.commitRevision({
      id: "rev_history",
      sessionID: "ses_test",
      lineageDigest: digest,
      reason: "soft_leaf",
      items: [{ kind: "summary", id, ordinal: 0 }],
      createdAt: 2,
    })
    await store.recordFrame({
      id: "frame_history",
      sessionID: "ses_test",
      revisionID: "rev_history",
      lineageDigest: digest,
      active: true,
      reason: "soft_ready",
      pre: { system: [], messages: [], tools: {} },
      post: { system: [], messages: [], tools: {} },
      usableInputTokens: 8_000,
      thresholdRatio: 0.6,
      rawTokens: 6_000,
      rawLaneTokens: 5_000,
      fixedInputTokens: 1_000,
      recentTailTokens: 2_000,
      summaryTokens: 4,
      createdAt: 3,
    })

    const rewritten = [{ ...makeSource(0), id: "src_rewritten", digest: sha256("rewritten") }]
    const nextDigest = lineageDigest(rewritten)
    await store.replaceSources({
      sessionID: "ses_test",
      sources: rewritten,
      lineage: { sessionID: "ses_test", digest: nextDigest, sourceCount: 1 },
    })

    expect(await store.getSummary("ses_test", id)).toBeDefined()
    expect(await store.getRevision("ses_test", "rev_history")).toBeDefined()
    expect((await store.listFrames("ses_test"))[0]?.active).toBe(false)
    expect(await store.activeRevision("ses_test", nextDigest)).toBeUndefined()
    store.close()
  })

  test("persists and clears a content-safe degraded issue", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    await store.replaceSources({
      sessionID: "ses_test",
      sources,
      lineage: { sessionID: "ses_test", digest, sourceCount: 1 },
    })
    await store.setIssue("ses_test", {
      code: "lcm_unavailable",
      message: "Normal Kilo context behavior is active.",
      since: 1,
      lastAt: 2,
    })
    expect(await store.inspect("ses_test")).toEqual(
      expect.objectContaining({
        health: "degraded",
        issue: expect.objectContaining({ code: "lcm_unavailable" }),
      }),
    )
    await store.setIssue("ses_test")
    const current = await store.inspect("ses_test")
    expect(current.health).toBe("ok")
    expect(current.issue).toBeUndefined()
    store.close()
  })

  test("quarantines an incompatible derived cache and starts from empty state", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-"))
    const target = path.join(root, "kilo.lcm.db")
    const old = new Database(target)
    old.exec("CREATE TABLE lcm_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    old.query("INSERT INTO lcm_meta(key, value) VALUES ('schema_version', ?)").run(String(LCM_SCHEMA_VERSION - 1))
    old.close()

    const store = SqliteConversationMemoryStore.open({ databasePath: path.join(root, "kilo.db"), derivedPath: target })
    expect((await store.inspect("ses_test")).sourceCount).toBe(0)
    expect(store.recovered).toBe(true)
    store.close()
    expect(readdirSync(root).some((name) => name.startsWith("kilo.lcm.db.incompatible-"))).toBe(true)
    rmSync(root, { recursive: true })
  })

  test("quarantines a corrupt derived cache and starts from empty state", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-store-corrupt-"))
    const target = path.join(root, "kilo.lcm.db")
    writeFileSync(target, "not a sqlite database")

    const store = SqliteConversationMemoryStore.open({ databasePath: path.join(root, "kilo.db"), derivedPath: target })
    expect(await store.inspect("ses_test")).toEqual({
      sessionID: "ses_test",
      sequence: 0,
      sourceCount: 0,
      consumedThrough: -1,
      state: "raw",
      health: "ok",
    })
    expect(store.recovered).toBe(true)
    store.close()
    expect(readdirSync(root).some((name) => name.startsWith("kilo.lcm.db.incompatible-"))).toBe(true)
    rmSync(root, { recursive: true })
  })

  test("deletes only the selected session and its derived records", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const source = makeSource(0)
    const other = { ...makeSource(1), id: "src_other", sessionID: "ses_other" }
    await store.replaceSources({
      sessionID: "ses_test",
      sources: [source],
      lineage: { sessionID: "ses_test", digest: lineageDigest([source]), sourceCount: 1 },
    })
    await store.replaceSources({
      sessionID: "ses_other",
      sources: [other],
      lineage: { sessionID: "ses_other", digest: lineageDigest([other]), sourceCount: 1 },
    })
    await store.appendActivity({
      id: "activity_test",
      sessionID: "ses_test",
      kind: "rebuild",
      message: "Derived state rebuilt.",
      createdAt: 1,
    })

    await store.deleteSession("ses_test")
    expect(await store.listSources("ses_test")).toEqual([])
    expect(await store.listActivity("ses_test")).toEqual([])
    expect((await store.inspect("ses_test")).sourceCount).toBe(0)
    expect(await store.listSources("ses_other")).toEqual([other])
    store.close()
  })

  test("advances consumption only for the exact lineage and resets it on rewrite", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0), makeSource(1), makeSource(2)]
    const digest = lineageDigest(sources)
    await store.replaceSources({
      sessionID: "ses_test",
      sources,
      lineage: { sessionID: "ses_test", digest, sourceCount: sources.length },
    })

    await store.markConsumed({ sessionID: "ses_test", lineageDigest: "stale", throughOrdinal: 2 })
    expect((await store.inspect("ses_test")).consumedThrough).toBe(-1)
    await store.markConsumed({ sessionID: "ses_test", lineageDigest: digest, throughOrdinal: 1 })
    expect((await store.inspect("ses_test")).consumedThrough).toBe(1)
    await store.markConsumed({ sessionID: "ses_test", lineageDigest: digest, throughOrdinal: 99 })
    expect((await store.inspect("ses_test")).consumedThrough).toBe(2)

    const appended = [...sources, makeSource(3)]
    await store.replaceSources({
      sessionID: "ses_test",
      sources: appended,
      lineage: { sessionID: "ses_test", digest: lineageDigest(appended), sourceCount: appended.length },
    })
    expect((await store.inspect("ses_test")).consumedThrough).toBe(2)

    const rewritten = [{ ...makeSource(0), digest: sha256("rewritten"), id: "src_rewritten" }]
    await store.replaceSources({
      sessionID: "ses_test",
      sources: rewritten,
      lineage: { sessionID: "ses_test", digest: lineageDigest(rewritten), sourceCount: 1 },
    })
    expect((await store.inspect("ses_test")).consumedThrough).toBe(-1)
    store.close()
  })
})
