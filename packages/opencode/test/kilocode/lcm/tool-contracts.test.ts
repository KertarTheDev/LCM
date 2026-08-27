import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch, regexSearchIssue, regexWorkerTarget } from "@/kilocode/session/lcm/regex-search"
import {
  canonicalRecoveryToolInput,
  completedToolCallHistory,
  completedToolCallCount,
  currentTurnRecoveryCallCount,
  priorTurnSourceCutoff,
  recoveryCallGuidance,
  repeatedRecoveryResult,
  sourceChronology,
} from "@/kilocode/tool/lcm-common"
import {
  grepRangeLimit,
  grepCursorQuery,
  grepTotalsComplete,
  grepValueOrder,
  LcmGrepParameters,
  literalPatternAdvice,
  literalRanges,
  lastOccurrencePageOffset,
  lexicalSearchAdvice,
  occurrencePaginationAdvice,
  occurrenceTotals,
  regexErrorMessage,
  regexToolError,
  utf8Ranges,
  utf8SearchWindow,
} from "@/kilocode/tool/lcm-grep"
import { expandCursorQuery } from "@/kilocode/tool/lcm-expand"
import {
  readContinuation,
  readCursorQuery,
  resolveTextReadOffset,
  textChunk,
  validUtf8Offset,
} from "@/kilocode/tool/lcm-read"
import {
  completeQueryAnswer,
  extractiveQueryFallback,
  honestQueryCoverage,
  parseQueryAnswer,
  queryExcerpt,
  queryParts,
  resolveSourceRanges,
  selectQueryExcerpts,
} from "@/kilocode/tool/lcm-expand-query"
import type { FinalSource } from "@/kilocode/session/lcm/types"
import { Schema } from "effect"

describe("LCM tool contracts", () => {
  test("keeps global grep as discovery and reserves wider occurrence pages for exact source scopes", () => {
    expect(grepRangeLimit(false)).toBe(1)
    expect(grepRangeLimit(true)).toBe(20)
  })

  test("preserves caller order for multiple ranges within one source ordinal", () => {
    const values = Array.from({ length: 12 }, (_, sortIndex) => ({
      id: `range:${sortIndex}:src_a`,
      ordinal: 4,
      sortIndex,
    }))
    expect(values.toSorted(grepValueOrder).map((value) => value.sortIndex)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    )
  })

  test("makes regex intent and overlapping result totals explicit", () => {
    expect(literalPatternAdvice("alpha|beta", "literal")).toContain("Set mode to regex")
    expect(literalPatternAdvice("\\[START\\]", "literal")).toContain("search for [START]")
    expect(literalPatternAdvice("alpha|beta", "regex")).toBeUndefined()
    expect(occurrencePaginationAdvice(true, [21])).toContain("refine the pattern")
    expect(lastOccurrencePageOffset(21)).toBe(1)
    expect(lastOccurrencePageOffset(40)).toBe(20)
    expect(occurrencePaginationAdvice(true, [20])).toBeUndefined()
    expect(occurrencePaginationAdvice(false, [100])).toBeUndefined()
    expect(
      occurrenceTotals(
        [
          { id: "src_a", matchCount: 3 },
          { id: "sum_b", matchCount: 2 },
        ],
        new Map<string, "source" | "summary">([
          ["src_a", "source"],
          ["sum_b", "summary"],
        ]),
      ),
    ).toEqual({ sourceRecords: 1, summaryRecords: 1, sourceOccurrences: 3, summaryOccurrences: 2 })
    expect(grepTotalsComplete("literal", false)).toBe(true)
    expect(grepTotalsComplete("regex", false)).toBe(false)
    expect(grepTotalsComplete("regex", true)).toBe(true)
    expect(lexicalSearchAdvice(0)).toContain("paraphrases")
    expect(lexicalSearchAdvice(2)).toContain("not semantic conclusions")
  })

  test("bounds unscoped recovery before the current user turn", () => {
    const view = {
      sources: new Map([
        ["src_old_user", { messageID: "msg_old_user", ordinal: 0 }],
        ["src_old_assistant", { messageID: "msg_old_assistant", ordinal: 1 }],
        ["src_question", { messageID: "msg_question", ordinal: 2 }],
        ["src_current_reasoning", { messageID: "msg_current_assistant", ordinal: 3 }],
      ]),
    }
    const messages = [
      { info: { id: "msg_old_user", role: "user" } },
      { info: { id: "msg_old_assistant", role: "assistant" } },
      { info: { id: "msg_question", role: "user" } },
      { info: { id: "msg_current_assistant", role: "assistant" } },
    ]

    expect(priorTurnSourceCutoff(view, messages)).toBe(1)
    expect(priorTurnSourceCutoff(view, [])).toBeUndefined()
  })

  test("identifies semantically identical completed recovery calls and retains compact prior facts", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool",
            tool: "lcm_grep",
            state: {
              status: "completed",
              input: { pattern: "needle", sourceID: "src_a" },
              metadata: { lcmResult: { kind: "grep", matchedRecords: 2 } },
            },
          },
          {
            type: "tool",
            tool: "lcm_grep",
            state: { status: "running", input: { pattern: "needle", sourceID: "src_a" } },
          },
        ],
      },
    ]
    expect(
      completedToolCallHistory(messages, "lcm_grep", {
        sourceID: "src_a",
        pattern: "needle",
        mode: "literal",
        caseSensitive: false,
        startOffset: 0,
        occurrenceOffset: 0,
        limit: 20,
      }),
    ).toEqual({ count: 1, priorResult: { kind: "grep", matchedRecords: 2 } })
    expect(completedToolCallCount(messages, "lcm_grep", { sourceID: "src_a", pattern: "needle" })).toBe(1)
    expect(completedToolCallCount(messages, "lcm_grep", { sourceID: "src_b", pattern: "needle" })).toBe(0)
    expect(canonicalRecoveryToolInput("lcm_read", { sourceID: "src_a" })).toEqual({
      maxBytes: 8192,
      offset: 0,
      sourceID: "src_a",
    })
    expect(canonicalRecoveryToolInput("lcm_read", { sourceID: "src_a", cursor: "next" })).toEqual({
      cursor: "next",
      maxBytes: 8192,
      sourceID: "src_a",
    })
    expect(
      recoveryCallGuidance({
        tool: "lcm_grep",
        previousIdenticalCalls: 3,
        sourceScoped: true,
        completedRecoveryCalls: 5,
      }).instruction,
    ).toContain("do not resubmit it")
    expect(
      recoveryCallGuidance({
        tool: "lcm_grep",
        previousIdenticalCalls: 0,
        sourceScoped: true,
        completedRecoveryCalls: 5,
      }).instruction,
    ).toContain("one focused lcm_expand_query")
    expect(repeatedRecoveryResult({ tool: "lcm_grep", previousIdenticalCalls: 0, sourceScoped: true })).toBeUndefined()
    expect(repeatedRecoveryResult({ tool: "lcm_grep", previousIdenticalCalls: 1, sourceScoped: true })).toMatchObject({
      callGuidance: { previousIdenticalCalls: 1 },
      repeatedCall: { suppressed: true, noNewEvidence: true },
    })
    expect(
      repeatedRecoveryResult({
        tool: "lcm_grep",
        previousIdenticalCalls: 1,
        sourceScoped: true,
        priorResult: { matchedRecords: 2 },
      }),
    ).toMatchObject({ priorResult: { matchedRecords: 2 } })
  })

  test("counts exact recovery calls only after the current user turn", () => {
    const completed = (tool: string) => ({
      type: "tool",
      tool,
      state: { status: "completed", input: {} },
    })
    const messages = [
      { info: { role: "assistant" }, parts: [completed("lcm_grep")] },
      { info: { role: "user" }, parts: [] },
      { info: { role: "assistant" }, parts: [completed("lcm_read"), completed("lcm_expand_query")] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "lcm_grep", state: { status: "running", input: {} } }],
      },
      { info: { role: "assistant" }, parts: [completed("lcm_grep")] },
    ]
    expect(currentTurnRecoveryCallCount(messages)).toBe(2)
  })

  test("reports chronological transport neighbors while skipping pure receipt records", () => {
    const source = (id: string, ordinal: number, kind: FinalSource["kind"]): FinalSource => ({
      id,
      sessionID: "ses_tools",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind,
      digest: `digest_${ordinal}`,
      tokens: 1,
      bytes: 1,
      excerpt: id,
    })
    const first = source("src_first", 0, "user_text")
    const receipt = source("src_receipt", 1, "assistant_text")
    const next = source("src_next", 2, "user_text")
    const view = {
      sources: new Map([first, receipt, next].map((item) => [item.id, item])),
      content: new Map([
        [first.id, { content: "opening fragment" }],
        [receipt.id, { content: "RECEIVED" }],
        [next.id, { content: "continuation fragment" }],
      ]),
    }

    expect(sourceChronology(view, first.id)).toEqual({
      sourceOrdinal: 0,
      previousSource: null,
      nextSource: { sourceID: receipt.id, ordinal: 1, kind: "assistant_text" },
      previousNonReceiptSource: null,
      nextNonReceiptSource: { sourceID: next.id, ordinal: 2, kind: "user_text" },
    })
  })

  test("extracts stable handles and useful terms for bounded recovery queries", () => {
    expect(queryParts("What did src_alpha decide about the release branch and release tag?")).toEqual({
      handles: ["src_alpha"],
      terms: ["decide", "release", "branch", "tag"],
    })
  })

  test("accepts only structured query answers with selected citations", () => {
    const allowed = new Set(["src_alpha", "sum_beta"])
    expect(
      parseQueryAnswer(
        '```json\n{"answer":"Use the release branch.","citations":["src_alpha"],"coverage":"full"}\n```',
        allowed,
      ),
    ).toEqual({
      answer: "Use the release branch.",
      citations: ["src_alpha"],
      coverage: "full",
    })
    expect(
      parseQueryAnswer('{"answer":"Invented","citations":["src_other"],"coverage":"full"}', allowed),
    ).toBeUndefined()
    expect(
      completeQueryAnswer(
        '{"answer":"Use the release branch.","citations":["src_alpha"],"coverage":"full"}',
        "length",
        allowed,
      ),
    ).toBeUndefined()
    expect(honestQueryCoverage({ answer: "Candidate", citations: ["src_alpha"], coverage: "full" }, true)).toEqual({
      answer: "Candidate",
      citations: ["src_alpha"],
      coverage: "partial",
    })
    expect(honestQueryCoverage({ answer: "Complete", citations: ["src_alpha"], coverage: "full" }, false)).toEqual({
      answer: "Complete",
      citations: ["src_alpha"],
      coverage: "full",
    })
  })

  test("centers bounded recovery excerpts on early and late matches", () => {
    const text = `early needle ${"unrelated ".repeat(200)}middle needle ${"unrelated ".repeat(200)}late needle`
    const excerpt = queryExcerpt(text, ["needle"], 500)
    expect(excerpt).toContain("early needle")
    expect(excerpt).toContain("middle needle")
    expect(excerpt).toContain("late needle")
    expect(excerpt).toContain("omitted")
    expect(excerpt.length).toBeLessThanOrEqual(500)
  })

  test("retains a locally decisive multi-term region alongside chronological coverage", () => {
    const text = [
      `early action ${"background action ".repeat(80)}`,
      `middle action ${"background action ".repeat(80)}`,
      "rareentity performed decisive operation",
      `${"background action ".repeat(80)} late action`,
    ].join("\n")
    const excerpt = queryExcerpt(text, ["action", "rareentity", "performed", "operation"], 600)
    expect(excerpt).toContain("early action")
    expect(excerpt).toContain("rareentity performed decisive operation")
    expect(excerpt).toContain("late action")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("samples chronology when no query term matches a paraphrased region", () => {
    const text = `${"opening material ".repeat(100)}paraphrased decisive evidence${"closing material ".repeat(100)}`
    const excerpt = queryExcerpt(text, ["absentwording"], 600)
    expect(excerpt).toContain("opening material")
    expect(excerpt).toContain("paraphrased decisive evidence")
    expect(excerpt).toContain("closing material")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("falls back to a fair active-frontier sample when no record has lexical overlap", () => {
    const sources = Array.from(
      { length: 10 },
      (_, ordinal): FinalSource => ({
        id: `src_${String(ordinal).padStart(24, "0")}`,
        sessionID: "ses_semantic_fallback",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 10,
        bytes: 40,
        excerpt: `historical material ${ordinal}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(
        sources.map((source) => [source.id, { metadata: source, content: `historical material ${source.ordinal}` }]),
      ),
      revision: {
        id: "rev_semantic_fallback",
        sessionID: "ses_semantic_fallback",
        lineageDigest: "lineage_semantic_fallback",
        reason: "append" as const,
        items: sources.map((source) => ({
          kind: "source" as const,
          id: source.id,
          ordinal: source.ordinal,
        })),
        createdAt: 1,
      },
    }
    const retrieval = selectQueryExcerpts(view, "unmatched vocabulary question", undefined, 1_000)
    expect(retrieval.selected).toHaveLength(8)
    expect(retrieval.selected.map((item) => item.id)).toContain(sources[0]!.id)
    expect(retrieval.selected.map((item) => item.id)).toContain(sources[9]!.id)
    expect(retrieval.relevant).toBe(10)
    expect(retrieval.candidateLimitReached).toBe(true)
  })

  test("resolves ordered non-overlapping UTF-8 source ranges and retrieves only their bytes", () => {
    const makeSource = (id: string, ordinal: number, content: string): FinalSource => ({
      id,
      sessionID: "ses_ranges",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind: "user_text",
      digest: `digest_${ordinal}`,
      tokens: Math.ceil(Buffer.byteLength(content) / 4),
      bytes: Buffer.byteLength(content),
      excerpt: content,
    })
    const firstText = "outside before\n[START]\ninside first needle\n"
    const secondText = "inside second needle\n[END]\noutside after"
    const first = makeSource("src_0123456789abcdef01234567", 4, firstText)
    const second = makeSource("src_89abcdef0123456789abcdef", 6, secondText)
    const view = {
      sources: new Map([
        [first.id, first],
        [second.id, second],
      ]),
      summaries: new Map(),
      children: new Map(),
      content: new Map([
        [first.id, { metadata: first, content: firstText }],
        [second.id, { metadata: second, content: secondText }],
      ]),
    }
    const startOffset = Buffer.byteLength("outside before\n[START]\n")
    const endOffset = Buffer.byteLength("inside second needle\n")
    const ranges = resolveSourceRanges(view, [
      { sourceID: first.id, startOffset },
      { sourceID: second.id, endOffset },
    ])
    expect(ranges.map((range) => range.text)).toEqual(["inside first needle\n", "inside second needle\n"])
    const retrieval = selectQueryExcerpts(view, "find every needle", undefined, 1_000, undefined, ranges)
    expect(retrieval.selected.map((item) => item.text)).toEqual(["inside first needle\n", "inside second needle\n"])
    expect(retrieval.relevant).toBe(2)
    expect(retrieval.truncated).toBe(false)
    expect(() => resolveSourceRanges(view, [{ sourceID: second.id }, { sourceID: first.id }])).toThrow(
      "chronological order",
    )
    expect(
      Schema.decodeUnknownSync(LcmGrepParameters)({
        pattern: "needle",
        sourceRanges: [
          { sourceID: first.id, startOffset },
          { sourceID: second.id, endOffset },
        ],
      }).sourceRanges,
    ).toEqual([
      { sourceID: first.id, startOffset },
      { sourceID: second.id, endOffset },
    ])
    expect(
      occurrenceTotals(
        [
          { id: `range:0:${first.id}`, matchCount: 2 },
          { id: `range:1:${first.id}`, matchCount: 3 },
        ],
        new Map([
          [`range:0:${first.id}`, "source" as const],
          [`range:1:${first.id}`, "source" as const],
        ]),
        new Map([
          [`range:0:${first.id}`, first.id],
          [`range:1:${first.id}`, first.id],
        ]),
      ),
    ).toEqual({ sourceRecords: 1, summaryRecords: 0, sourceOccurrences: 5, summaryOccurrences: 0 })
  })

  test("keeps extractive query fallback fair across candidate records", () => {
    const fallback = extractiveQueryFallback(
      [
        { id: "src_first", text: `early needle ${"first ".repeat(300)}late needle` },
        { id: "src_second", text: `early needle ${"second ".repeat(300)}late needle` },
        { id: "src_third", text: `early needle ${"third ".repeat(300)}late needle` },
      ],
      ["needle"],
      900,
    )
    expect(fallback.citations).toEqual(["src_first", "src_second", "src_third"])
    expect(fallback.answer).toContain("[src_first]")
    expect(fallback.answer).toContain("[src_second]")
    expect(fallback.answer).toContain("[src_third]")
    expect(fallback.answer.length).toBeLessThanOrEqual(900)
  })

  test("binds opaque cursors to semantic queries while allowing page-size changes", () => {
    const query = grepCursorQuery({
      pattern: "needle",
      mode: "literal",
      caseSensitive: false,
      startOffset: 0,
      occurrenceOffset: 0,
    })
    const cursor = encodeCursor(query, 12)
    expect(decodeCursor(query, cursor)).toBe(12)
    expect(() => decodeCursor({ ...query, pattern: "other" }, cursor)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor({ ...query, startOffset: 10 }, cursor)).toThrow("lcm_invalid_cursor")
    const rangedQuery = grepCursorQuery({
      ...query,
      sourceRanges: [{ sourceID: "src_a", startOffset: 10, endOffset: 20 }],
    })
    const rangedCursor = encodeCursor(rangedQuery, 1)
    expect(decodeCursor(rangedQuery, rangedCursor)).toBe(1)
    expect(() =>
      decodeCursor(
        { ...rangedQuery, sourceRanges: [{ sourceID: "src_a", startOffset: 11, endOffset: 20 }] },
        rangedCursor,
      ),
    ).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor.slice(0, -1)}x`)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor}.extra`)).toThrow("lcm_invalid_cursor")
    const expansion = expandCursorQuery("sum_a")
    expect(decodeCursor(expansion, encodeCursor(expansion, 10))).toBe(10)
  })

  test("binds read cursors to immutable source identity rather than page size", () => {
    const query = readCursorQuery({ id: "src_a", digest: "digest_a" }, 12_000)
    const cursor = encodeCursor(query, 8_192)
    expect(decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_a" }, 12_000), cursor)).toBe(8_192)
    expect(() => decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_a" }, 13_000), cursor)).toThrow(
      "lcm_invalid_cursor",
    )
    expect(() => decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_b" }, 12_000), cursor)).toThrow(
      "lcm_invalid_cursor",
    )
  })

  test("runs bounded regex search in a worker", async () => {
    expect(String(regexWorkerTarget())).toEndWith("/regex-worker.ts")
    const matches = await regexSearch({
      pattern: "alpha|beta",
      caseSensitive: false,
      values: [
        { id: "src_a", text: "Alpha and BETA" },
        { id: "src_b", text: "gamma" },
      ],
      recordLimit: 10,
      rangeLimit: 10,
    })
    expect(matches).toEqual([
      {
        id: "src_a",
        ranges: [
          { start: 0, end: 5 },
          { start: 10, end: 14 },
        ],
        matchCount: 2,
        rangesComplete: true,
      },
    ])
    await expect(
      regexSearch({
        pattern: "(",
        caseSensitive: true,
        values: [{ id: "src_a", text: "text" }],
        recordLimit: 10,
        rangeLimit: 10,
      }),
    ).rejects.toThrow("lcm_invalid_regex")
  })

  test("distinguishes invalid, timed-out, and unavailable regex execution", async () => {
    expect(regexToolError(new Error("lcm_invalid_regex")).message).toContain("syntax is invalid")
    expect(regexToolError(new Error("lcm_regex_timeout")).message).toContain("Do not retry it unchanged")
    expect(regexToolError(new Error("lcm_regex_worker_unavailable")).code).toBe("lcm_unavailable")
    const wrapped = {
      message: "An error occurred in Effect.tryPromise",
      cause: new Error("lcm_regex_pattern_too_long"),
    }
    expect(regexErrorMessage(wrapped)).toBe("lcm_regex_pattern_too_long")
    expect(regexToolError(wrapped).message).toContain("exceeds 512 characters")
    await expect(
      regexSearch(
        {
          pattern: "alpha",
          caseSensitive: false,
          values: [{ id: "src_a", text: "alpha" }],
          recordLimit: 1,
          rangeLimit: 1,
        },
        {
          createWorker: () => {
            throw new Error("worker missing")
          },
        },
      ),
    ).rejects.toThrow("lcm_regex_worker_unavailable")
  })

  test("limits matching records independently from ranges within each record", async () => {
    const matches = await regexSearch({
      pattern: "hit",
      caseSensitive: true,
      values: [
        { id: "src_many", text: "hit hit hit hit" },
        { id: "src_next", text: "hit" },
        { id: "src_later", text: "hit" },
      ],
      recordLimit: 2,
      rangeLimit: 2,
    })
    expect(matches).toEqual([
      {
        id: "src_many",
        ranges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
        matchCount: 4,
        rangesComplete: false,
      },
      { id: "src_next", ranges: [{ start: 0, end: 3 }], matchCount: 1, rangesComplete: true },
    ])
  })

  test("pages exact regex occurrences without losing the total match count", async () => {
    const matches = await regexSearch({
      pattern: "hit",
      caseSensitive: true,
      values: [{ id: "src_many", text: "hit hit hit hit" }],
      recordLimit: 1,
      rangeOffset: 1,
      rangeLimit: 2,
    })
    expect(matches).toEqual([
      {
        id: "src_many",
        ranges: [
          { start: 4, end: 7 },
          { start: 8, end: 11 },
        ],
        matchCount: 4,
        rangesComplete: false,
      },
    ])
  })

  test("pages exact literal occurrences without losing the total match count", () => {
    expect(literalRanges("hit hit hit hit", "hit", true, 1, 2)).toEqual({
      ranges: [
        { start: 4, end: 7 },
        { start: 8, end: 11 },
      ],
      matchCount: 4,
      rangesComplete: false,
    })
  })

  test("advances zero-width regular expressions without hanging", async () => {
    const matches = await regexSearch({
      pattern: "(?=a)",
      caseSensitive: true,
      values: [{ id: "src_a", text: "aaa" }],
      recordLimit: 1,
      rangeLimit: 3,
    })
    expect(matches[0]?.ranges).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ])
    expect(matches[0]?.matchCount).toBe(3)
    expect(matches[0]?.rangesComplete).toBe(true)
  })

  test("cancels regex work with the public cancellation code", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      regexSearch({
        pattern: "detail",
        caseSensitive: false,
        values: [{ id: "src_a", text: "detail" }],
        recordLimit: 10,
        rangeLimit: 10,
        signal: controller.signal,
      }),
    ).rejects.toThrow("lcm_cancelled")
  })

  test("rejects oversized regex input instead of silently skipping sources", async () => {
    expect(regexSearchIssue({ pattern: "x".repeat(513), values: [{ text: "small" }] })).toBe("pattern_too_long")
    await expect(
      regexSearch({
        pattern: "binding",
        caseSensitive: false,
        values: [{ id: "src_large", text: "x".repeat(1_000_001) }],
        recordLimit: 20,
        rangeLimit: 20,
      }),
    ).rejects.toThrow("lcm_regex_record_too_large")
  })

  test("paginates text on valid UTF-8 byte boundaries", () => {
    const value = "abαβcd"
    const first = textChunk(value, 0, 3)
    expect(first.content).toBe("ab")
    expect(first.end).toBe(2)
    const second = textChunk(value, first.end, 4)
    expect(second.content).toBe("αβ")
    expect(second.end).toBe(6)
    expect(second.total).toBe(Buffer.byteLength(value))
    expect(readContinuation(first.end, first.total)).toMatchObject({ complete: false, nextOffset: first.end })
    expect(readContinuation(second.end, second.total)).toMatchObject({ complete: false, nextOffset: second.end })
    const third = textChunk(value, second.end, 4)
    expect(third.content).toBe("cd")
    expect(readContinuation(third.end, third.total)).toEqual({
      complete: true,
      nextOffset: null,
      advice: [
        "This read reached the end of this transport source, not necessarily the end of a document, episode, section, or other semantic unit. nextOffset and nextCursor are null; do not retry this source. If verified boundaries show the unit continues, follow chronology.nextNonReceiptSource at offset 0.",
      ],
    })
    const bounded = textChunk(value, 2, 32, 6)
    expect(bounded.content).toBe("αβ")
    expect(bounded.rangeEnd).toBe(6)
    expect(readContinuation(bounded.end, bounded.total, bounded.rangeEnd)).toEqual({
      complete: true,
      nextOffset: null,
      advice: [
        "This read reached the requested exclusive endOffset. nextOffset and nextCursor are null; do not read beyond that verified interval for the current semantic unit.",
      ],
    })
  })

  test("maps grep character ranges to seekable UTF-8 byte ranges", () => {
    expect(
      utf8Ranges("aé🙂z", [
        { start: 1, end: 2 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 7 },
    ])
    expect(textChunk("aé🙂z", 3, 4).content).toBe("🙂")
    expect(validUtf8Offset("aé🙂z", 3)).toBe(true)
    expect(validUtf8Offset("aé🙂z", 2)).toBe(false)
    expect(resolveTextReadOffset("aé", 99)).toEqual({ offset: 3, total: 3, adjusted: true })
    expect(resolveTextReadOffset("aé", 1)).toEqual({ offset: 1, total: 3, adjusted: false })
  })

  test("searches an exact half-open UTF-8 source interval", () => {
    const text = "é before\n[START]\ninside needle\n[END]\nafter needle"
    const start = Buffer.byteLength("é before\n[START]\n")
    const end = Buffer.byteLength("é before\n[START]\ninside needle\n")
    const window = utf8SearchWindow(text, start, end)
    expect(window.text).toBe("inside needle\n")
    expect(window.byteOffset).toBe(start)
    expect(window.endOffset).toBe(end)
    expect(literalRanges(window.text, "needle", true, 0, 20).matchCount).toBe(1)
    expect(() => utf8SearchWindow(text, 1, end)).toThrow("lcm_invalid_search_range")
  })
})
