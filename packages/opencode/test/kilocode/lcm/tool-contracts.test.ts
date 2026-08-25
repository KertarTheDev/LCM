import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch } from "@/kilocode/session/lcm/regex-search"
import { priorTurnSourceCutoff } from "@/kilocode/tool/lcm-common"
import { grepRangeLimit, literalRanges, utf8Ranges } from "@/kilocode/tool/lcm-grep"
import { textChunk, validUtf8Offset } from "@/kilocode/tool/lcm-read"
import { parseQueryAnswer, queryParts } from "@/kilocode/tool/lcm-expand-query"

describe("LCM tool contracts", () => {
  test("keeps global grep as discovery and reserves wider occurrence pages for exact source scopes", () => {
    expect(grepRangeLimit(false)).toBe(3)
    expect(grepRangeLimit(true)).toBe(20)
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
  })

  test("binds opaque cursors to the complete query", () => {
    const query = { pattern: "needle", mode: "literal", limit: 20 }
    const cursor = encodeCursor(query, 12)
    expect(decodeCursor(query, cursor)).toBe(12)
    expect(() => decodeCursor({ ...query, pattern: "other" }, cursor)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor.slice(0, -1)}x`)).toThrow("lcm_invalid_cursor")
  })

  test("runs bounded regex search in a worker", async () => {
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
    await expect(
      regexSearch({
        pattern: "binding",
        caseSensitive: false,
        values: [{ id: "src_large", text: "x".repeat(1_000_001) }],
        recordLimit: 20,
        rangeLimit: 20,
      }),
    ).rejects.toThrow("lcm_invalid_regex")
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
})
