import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch } from "@/kilocode/session/lcm/regex-search"
import { textChunk } from "@/kilocode/tool/lcm-read"
import { parseQueryAnswer, queryParts } from "@/kilocode/tool/lcm-expand-query"

describe("LCM tool contracts", () => {
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
      },
      { id: "src_next", ranges: [{ start: 0, end: 3 }] },
    ])
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
})
