import { Schema } from "effect"
import type { SourceKind } from "@/kilocode/session/lcm/types"
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

export const LcmSourceSpan = Schema.Struct({
  startSourceID: Schema.String.annotate({ description: "Inclusive first src_ handle in chronological order." }),
  endSourceID: Schema.String.annotate({ description: "Inclusive last src_ handle in chronological order." }),
  startOffset: Schema.optional(Schema.Number).annotate({
    description: "Inclusive UTF-8 byte offset in startSourceID; defaults to that source's start.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description: "Exclusive UTF-8 byte offset in endSourceID; defaults to that source's end.",
  }),
})

export const LcmSourceOrdinalSpan = Schema.Struct({
  startOrdinal: Schema.Number.annotate({ description: "Inclusive first source ordinal from the structural map." }),
  endOrdinal: Schema.Number.annotate({ description: "Inclusive last source ordinal from the structural map." }),
  startOffset: Schema.optional(Schema.Number).annotate({
    description: "Inclusive UTF-8 byte offset in startOrdinal; defaults to that source's start.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description: "Exclusive UTF-8 byte offset in endOrdinal; defaults to that source's end.",
  }),
})

export interface ResolvedSourceRange {
  sourceID: string
  sourceKind: SourceKind
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
      sourceKind: source.kind,
      ordinal: source.ordinal,
      startOffset: window.byteOffset,
      endOffset: window.endOffset,
      totalBytes: window.totalBytes,
      text: window.text,
    })
  }
  return resolved
}

export function resolveSourceSpan(
  view: Pick<MemoryView, "sources" | "content">,
  span: { startSourceID: string; endSourceID: string; startOffset?: number; endOffset?: number },
) {
  const start = requireSource(view, span.startSourceID).source
  const end = requireSource(view, span.endSourceID).source
  if (start.ordinal > end.ordinal)
    throw new LcmToolError("lcm_unavailable", "A source span must run forward in chronological order.")
  const sources = [...view.sources.values()]
    .filter((source) => source.ordinal >= start.ordinal && source.ordinal <= end.ordinal)
    .toSorted((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
  if (sources.length < 1 || sources.length > MAX_LCM_SOURCE_RANGES)
    throw new LcmToolError(
      "lcm_unavailable",
      `A source span must contain 1 through ${MAX_LCM_SOURCE_RANGES} current-lineage sources.`,
    )
  if (sources[0]?.id !== start.id || sources.at(-1)?.id !== end.id)
    throw new LcmToolError("lcm_stale_lineage", "The source span endpoints are no longer chronologically contiguous.")
  return resolveSourceRanges(
    view,
    sources.map((source, index) => ({
      sourceID: source.id,
      ...(index === 0 && span.startOffset !== undefined ? { startOffset: span.startOffset } : {}),
      ...(index === sources.length - 1 && span.endOffset !== undefined ? { endOffset: span.endOffset } : {}),
    })),
  )
}

export function resolveSourceOrdinalSpan(
  view: Pick<MemoryView, "sources" | "content">,
  span: { startOrdinal: number; endOrdinal: number; startOffset?: number; endOffset?: number },
) {
  if (
    !Number.isSafeInteger(span.startOrdinal) ||
    !Number.isSafeInteger(span.endOrdinal) ||
    span.startOrdinal < 0 ||
    span.endOrdinal < span.startOrdinal
  )
    throw new LcmToolError(
      "lcm_unavailable",
      "A source ordinal span requires non-negative integer endpoints in chronological order.",
    )
  const sources = [...view.sources.values()]
    .filter((source) => source.ordinal >= span.startOrdinal && source.ordinal <= span.endOrdinal)
    .toSorted((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
  if (
    sources.length < 1 ||
    sources.length > MAX_LCM_SOURCE_RANGES ||
    sources[0]?.ordinal !== span.startOrdinal ||
    sources.at(-1)?.ordinal !== span.endOrdinal
  )
    throw new LcmToolError(
      "lcm_unavailable",
      `A source ordinal span must resolve 1 through ${MAX_LCM_SOURCE_RANGES} current-lineage sources with both endpoints present.`,
    )
  return resolveSourceRanges(
    view,
    sources.map((source, index) => ({
      sourceID: source.id,
      ...(index === 0 && span.startOffset !== undefined ? { startOffset: span.startOffset } : {}),
      ...(index === sources.length - 1 && span.endOffset !== undefined ? { endOffset: span.endOffset } : {}),
    })),
  )
}
