import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch, regexSearchIssue, regexWorkerTarget } from "@/kilocode/session/lcm/regex-search"
import { priorTurnSourceCutoff } from "@/kilocode/tool/lcm-common"
import {
  grepRangeLimit,
  grepCursorQuery,
  grepTotalsComplete,
  literalPatternAdvice,
  literalRanges,
  occurrenceTotals,
  regexToolError,
  utf8Ranges,
  utf8SearchWindow,
} from "@/kilocode/tool/lcm-grep"
import { expandCursorQuery } from "@/kilocode/tool/lcm-expand"
import { readCursorQuery, textChunk, validUtf8Offset } from "@/kilocode/tool/lcm-read"
import {
  completeQueryAnswer,
  extractiveQueryFallback,
  parseQueryAnswer,
  queryExcerpt,
  queryParts,
} from "@/kilocode/tool/lcm-expand-query"

describe("LCM tool contracts", () => {
  test("keeps global grep as discovery and reserves wider occurrence pages for exact source scopes", () => {
    expect(grepRangeLimit(false)).toBe(1)
    expect(grepRangeLimit(true)).toBe(20)
  })

  test("makes regex intent and overlapping result totals explicit", () => {
    expect(literalPatternAdvice("alpha|beta", "literal")).toContain("Set mode to regex")
    expect(literalPatternAdvice("alpha|beta", "regex")).toBeUndefined()
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
  })

  test("centers bounded recovery excerpts on early and late matches", () => {
    const text = `early needle ${"unrelated ".repeat(600)}late needle`
    const excerpt = queryExcerpt(text, ["needle"], 500)
    expect(excerpt).toContain("early needle")
    expect(excerpt).toContain("late needle")
    expect(excerpt).toContain("omitted")
    expect(excerpt.length).toBeLessThanOrEqual(500)
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
    expect(() => decodeCursor(query, `${cursor.slice(0, -1)}x`)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor}.extra`)).toThrow("lcm_invalid_cursor")
    const expansion = expandCursorQuery("sum_a")
    expect(decodeCursor(expansion, encodeCursor(expansion, 10))).toBe(10)
  })

  test("binds read cursors to immutable source identity rather than page size", () => {
    const query = readCursorQuery({ id: "src_a", digest: "digest_a" })
    const cursor = encodeCursor(query, 8_192)
    expect(decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_a" }), cursor)).toBe(8_192)
    expect(() => decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_b" }), cursor)).toThrow(
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
