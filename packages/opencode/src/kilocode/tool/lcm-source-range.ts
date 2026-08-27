import { Schema } from "effect"
import { LcmToolError, requireSource, type MemoryView } from "./lcm-common"

export const MAX_LCM_SOURCE_RANGES = 32

export const LcmSourceRange = Schema.Struct({
  sourceID: Schema.String.annotate({ description: "Exact current-session src_ source handle." }),
  startOffset: Schema.optional(Schema.Number).annotate({
    description: "Inclusive UTF-8 byte offset; defaults to the source start.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description: "Exclusive UTF-8 byte offset; defaults to the source end.",
  }),
})

export interface ResolvedSourceRange {
  sourceID: string
  ordinal: number
  startOffset: number
  endOffset: number
  totalBytes: number
  text: string
}

export function utf8SearchWindow(text: string, startOffset = 0, endOffset?: number) {
  const buffer = Buffer.from(text)
  const end = endOffset ?? buffer.byteLength
  const valid = (offset: number) =>
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset <= buffer.byteLength &&
    (offset === buffer.byteLength || (buffer[offset]! & 0xc0) !== 0x80)
  if (!valid(startOffset) || !valid(end) || startOffset > end) throw new Error("lcm_invalid_search_range")
  return {
    text: buffer.subarray(startOffset, end).toString("utf8"),
    characterOffset: buffer.subarray(0, startOffset).toString("utf8").length,
    byteOffset: startOffset,
    endOffset: end,
    totalBytes: buffer.byteLength,
  }
}

export function resolveSourceRanges(
  view: Pick<MemoryView, "sources" | "content">,
  ranges: ReadonlyArray<{ sourceID: string; startOffset?: number; endOffset?: number }>,
) {
  if (ranges.length < 1 || ranges.length > MAX_LCM_SOURCE_RANGES)
    throw new LcmToolError(
      "lcm_unavailable",
      `Source range scope must contain 1 through ${MAX_LCM_SOURCE_RANGES} ranges.`,
    )
  const resolved: ResolvedSourceRange[] = []
  for (const range of ranges) {
    if (
      (range.startOffset !== undefined && (!Number.isSafeInteger(range.startOffset) || range.startOffset < 0)) ||
      (range.endOffset !== undefined && (!Number.isSafeInteger(range.endOffset) || range.endOffset < 0))
    )
      throw new LcmToolError("lcm_unavailable", "Source ranges require non-negative integer UTF-8 byte offsets.")
    const { source, content } = requireSource(view, range.sourceID)
    let window: ReturnType<typeof utf8SearchWindow>
    try {
      window = utf8SearchWindow(content.content, range.startOffset ?? 0, range.endOffset)
    } catch {
      throw new LcmToolError(
        "lcm_unavailable",
        "A source range is outside its source or is not aligned to UTF-8 byte boundaries.",
      )
    }
    if (window.byteOffset >= window.endOffset)
      throw new LcmToolError("lcm_unavailable", "Every source range must contain at least one UTF-8 byte.")
    const previous = resolved.at(-1)
    if (
      previous &&
      (source.ordinal < previous.ordinal ||
        (source.ordinal === previous.ordinal &&
          (source.id !== previous.sourceID || window.byteOffset < previous.endOffset)))
    )
      throw new LcmToolError(
        "lcm_unavailable",
        "Source ranges must be in chronological order and must not overlap within one source.",
      )
    resolved.push({
      sourceID: source.id,
      ordinal: source.ordinal,
      startOffset: window.byteOffset,
      endOffset: window.endOffset,
      totalBytes: window.totalBytes,
      text: window.text,
    })
  }
  return resolved
}
