import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch } from "@/kilocode/session/lcm/regex-search"
import { textChunk } from "@/kilocode/tool/lcm-read"

describe("LCM tool contracts", () => {
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
      limit: 10,
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
        limit: 10,
      }),
    ).rejects.toThrow("lcm_invalid_regex")
  })

  test("cancels regex work with the public cancellation code", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      regexSearch({
        pattern: "detail",
        caseSensitive: false,
        values: [{ id: "src_a", text: "detail" }],
        limit: 10,
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
        limit: 20,
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
