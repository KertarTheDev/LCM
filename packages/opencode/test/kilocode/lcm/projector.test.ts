import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import {
  exactStructuralAnchorOccurrences,
  exactStructuralAnchors,
  isConversationMemoryMessage,
  pairedStructuralUnits,
  Projector,
} from "@/kilocode/session/lcm/projector"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource } from "@/kilocode/session/lcm/types"

function makeSource(ordinal: number): FinalSource {
  const content = sourceText(ordinal)
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

function sourceText(ordinal: number) {
  const marker =
    ordinal === 0
      ? "<source_data>\n[START OF EPISODE]\n"
      : ordinal === 5
        ? "[END OF EPISODE]\n"
        : ordinal === 9
          ? "[END OF ELIGIBLE RAW UNIT]\n"
          : ordinal === 10
            ? "[END OF PROTECTED RAW UNIT]\n"
            : ordinal === 11
              ? "[END OF CURRENT RAW UNIT]\n"
              : ""
  return `${marker}turn ${ordinal} ${"detail ".repeat(500)}`
}

function measure(messages: ModelMessage[]) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(messages)) / 4)
}

describe("LCM projector", () => {
  test("recognizes exact structural boundary lines without indexing ordinary bracketed logs", () => {
    const content = [
      "évidence",
      "<source_data>",
      "  [START OF EPISODE]  ",
      "--- END DOCUMENT ---",
      "not a boundary",
    ].join("\n")
    expect(exactStructuralAnchors(`[INFO]\n${content}`)).toEqual([
      "<source_data>",
      "[START OF EPISODE]",
      "--- END DOCUMENT ---",
    ])
    const opening = exactStructuralAnchorOccurrences(content).find((item) => item.marker === "[START OF EPISODE]")!
    expect(Buffer.from(content).subarray(opening.byteStart, opening.byteEnd).toString()).toBe("[START OF EPISODE]")
  })

  test("pairs explicit semantic boundaries into copy-ready chronological source ranges", () => {
    expect(
      pairedStructuralUnits({
        anchors: [
          { sourceID: "src_first", ordinal: 1, marker: "[START OF EPISODE]", byteStart: 10, byteEnd: 28 },
          { sourceID: "src_last", ordinal: 3, marker: "[END OF EPISODE]", byteStart: 90, byteEnd: 106 },
        ],
        total: 2,
        sources: [
          { sourceID: "src_first", ordinal: 1 },
          { sourceID: "src_middle", ordinal: 2 },
          { sourceID: "src_last", ordinal: 3 },
        ],
      }).units,
    ).toEqual([
      {
        opening: {
          sourceID: "src_first",
          ordinal: 1,
          marker: "[START OF EPISODE]",
          byteStart: 10,
          byteEnd: 28,
        },
        closing: {
          sourceID: "src_last",
          ordinal: 3,
          marker: "[END OF EPISODE]",
          byteStart: 90,
          byteEnd: 106,
        },
        sourceRanges: [
          { sourceID: "src_first", startOffset: 28 },
          { sourceID: "src_middle" },
          { sourceID: "src_last", endOffset: 90 },
        ],
      },
    ])
  })

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
    const revision = await new SummaryTree(store).maintain({
      sessionID: "ses_project",
      lineage,
      usableInputTokens: 4_000,
      maxEligibleOrdinal: 9,
      targetTokens: 1_600,
      mode: "hard",
    })
    const messages: ModelMessage[] = Array.from({ length: 12 }, (_, index) => ({
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
      recentTailTokens: 1_000,
      protectedMessages: messages.slice(10),
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, sourceText(source.ordinal)])),
      continuationID: "msg_current",
      reason: "soft",
      measure,
    })
    expect(result.type).toBe("projected")
    if (result.type !== "projected") throw new Error("expected projection")
    expect(isConversationMemoryMessage(result.messages[0]!)).toBe(true)
    const memory = result.messages[0]?.content
    expect(typeof memory).toBe("string")
    if (typeof memory !== "string") throw new Error("expected string memory projection")
    expect(memory).toContain("Summaries are lossy indexes, not complete")
    expect(memory).toContain("ask one focused lcm_query")
    expect(memory).toContain("hidden read-only child agent")
    expect(memory).toContain("host-verified exact source excerpts")
    expect(memory).toContain("first/last, count, or complete-list questions")
    expect(memory).toContain("never treat an omitted fact or boundary as evidence that it did not occur")
    expect(memory).toContain("a transport record, not a semantic unit")
    expect(memory).toContain("Pair ordered openings and closings")
    expect(memory).toContain("half-open")
    expect(memory).toContain("Do not reconstruct or page the raw sources in the main session")
    expect(memory).toContain("answer immediately")
    expect(memory).toContain("Deterministic structural anchors copied verbatim")
    expect(memory).toContain("Paired semantic-unit labels for focused recovery")
    expect(memory).not.toContain("sourceRanges=")
    for (const [ordinal, marker] of [
      [0, "[START OF EPISODE]"],
      [5, "[END OF EPISODE]"],
      [9, "[END OF ELIGIBLE RAW UNIT]"],
      [10, "[END OF PROTECTED RAW UNIT]"],
    ] as const) {
      const anchor = exactStructuralAnchorOccurrences(sourceText(ordinal)).find((item) => item.marker === marker)!
      expect(memory).toContain(
        `- ${sources[ordinal]!.id} (source ${ordinal}, bytes ${anchor.byteStart}-${anchor.byteEnd}): ${marker}`,
      )
    }
    expect(memory).not.toContain(`${sources[11]!.id} (source 11`)
    expect(result.messages.slice(1)).toEqual(messages.slice(10))
    expect(result.revision.id).toBe(revision!.id)
    const expectedSummaryTokens = (
      await Promise.all(
        result.revision.items
          .filter((item) => item.kind === "summary")
          .map((item) => store.getSummary("ses_project", item.id)),
      )
    ).reduce((tokens, summary) => tokens + (summary?.tokens ?? 0), 0)
    expect(result.summaryTokens).toBe(expectedSummaryTokens)
    expect(result.summaryTokens).toBeLessThan(measure([result.messages[0]!]) - measure([]))

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
      recentTailTokens: 1_000,
      protectedMessages: messages.slice(10),
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, sourceText(source.ordinal)])),
      continuationID: "msg_current",
      reason: "soft",
      measure,
    })
    expect(pinned.type === "projected" && pinned.revision.id).toBe(revision!.id)

    const hard = await projector.project({
      sessionID: "ses_project",
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 4_000,
      thresholdRatio: 0.6,
      recentTailTokens: 1_000,
      protectedMessages: messages.slice(10),
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, sourceText(source.ordinal)])),
      continuationID: "msg_current",
      reason: "hard",
      measure,
    })
    expect(hard.type === "projected" && hard.revision.id).toBe("rev_newer")

    const nextContinuation = await projector.project({
      sessionID: "ses_project",
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 4_000,
      thresholdRatio: 0.6,
      recentTailTokens: 1_000,
      protectedMessages: messages.slice(10),
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, sourceText(source.ordinal)])),
      continuationID: "msg_next",
      reason: "soft",
      measure,
    })
    expect(nextContinuation.type === "projected" && nextContinuation.revision.id).toBe("rev_newer")

    await store.commitRevision({
      ...revision!,
      id: "rev_after_clear",
      createdAt: revision!.createdAt + 2,
    })
    projector.clearSession("ses_project")
    const afterClear = await projector.project({
      sessionID: "ses_project",
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 4_000,
      thresholdRatio: 0.6,
      recentTailTokens: 1_000,
      protectedMessages: messages.slice(10),
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, sourceText(source.ordinal)])),
      continuationID: "msg_next",
      reason: "soft",
      measure,
    })
    expect(afterClear.type === "projected" && afterClear.revision.id).toBe("rev_after_clear")
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
      recentTailTokens: 2_000,
      protectedMessages: messages,
      maxEligibleOrdinal: -1,
      maxConsumedOrdinal: -1,
      sourceContent: new Map(),
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

  test("keeps the same stable summary cut when a model has more usable context", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = Array.from({ length: 40 }, (_, ordinal) => makeSource(ordinal))
    const lineage = {
      sessionID: "ses_adaptive",
      digest: lineageDigest(sources),
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    const scoped = sources.map((source) => ({ ...source, sessionID: lineage.sessionID }))
    await store.replaceSources({ sessionID: lineage.sessionID, lineage, sources: scoped })
    await new SummaryTree(store).maintain({
      sessionID: lineage.sessionID,
      lineage,
      usableInputTokens: 4_000,
      maxEligibleOrdinal: 35,
      targetTokens: 1_600,
      mode: "hard",
    })
    const messages: ModelMessage[] = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: sourceText(index),
    }))
    const sourceContent = new Map(scoped.map((source) => [source.id, sourceText(source.ordinal)]))
    const projector = new Projector(store)
    const narrow = await projector.project({
      sessionID: lineage.sessionID,
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 10_000,
      thresholdRatio: 0.6,
      recentTailTokens: 2_000,
      protectedMessages: messages.slice(36),
      maxEligibleOrdinal: 35,
      maxConsumedOrdinal: 35,
      sourceContent,
      reason: "soft",
      measure,
    })
    const wider = await projector.project({
      sessionID: lineage.sessionID,
      lineage,
      system: [],
      messages,
      tools: {},
      usableInputTokens: 20_000,
      thresholdRatio: 0.6,
      recentTailTokens: 2_000,
      protectedMessages: messages.slice(36),
      maxEligibleOrdinal: 35,
      maxConsumedOrdinal: 35,
      sourceContent,
      reason: "soft",
      measure,
    })

    expect(narrow.type).toBe("projected")
    expect(wider.type).toBe("projected")
    if (narrow.type !== "projected" || wider.type !== "projected") throw new Error("expected adaptive projections")
    expect(wider.messages[0]).toEqual(narrow.messages[0])
    expect(wider.pressureAfter).toBeLessThan(narrow.pressureAfter)
    store.close()
  })
})
