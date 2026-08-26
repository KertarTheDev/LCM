import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { REGEX_SEARCH_LIMITS, regexSearch } from "@/kilocode/session/lcm/regex-search"
import {
  completedToolCallHistory,
  inertOutput,
  LcmToolError,
  loadMemory,
  priorTurnSourceCutoff,
  recoveryCallGuidance,
  repeatedRecoveryResult,
  requireSource,
  requireSummary,
  sourceChronology,
} from "./lcm-common"
import type { SummaryChild } from "@/kilocode/session/lcm/types"

const MAX_RANGES_PER_RECORD = 20
const MAX_UNSCOPED_RANGES_PER_RECORD = 1

export function grepRangeLimit(sourceScoped: boolean) {
  return sourceScoped ? MAX_RANGES_PER_RECORD : MAX_UNSCOPED_RANGES_PER_RECORD
}

export function occurrencePaginationAdvice(sourceScoped: boolean, matchCounts: number[]) {
  if (!sourceScoped || !matchCounts.some((count) => count > MAX_RANGES_PER_RECORD)) return
  return "This source has more matches than one page. Copy occurrencePage.nextOffset for forward enumeration or occurrencePage.lastOffset to jump directly to the final page for a last-occurrence question. Otherwise refine the pattern or use sourceRanges with lcm_expand_query for focused semantic synthesis."
}

export function lastOccurrencePageOffset(matchCount: number) {
  return Math.max(0, matchCount - MAX_RANGES_PER_RECORD)
}

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "Exact unescaped text in literal mode, or a regular expression of at most 512 characters in regex mode; alternatives using | require regex mode.",
  }),
  mode: Schema.optional(Schema.Literals(["literal", "regex"])).annotate({
    description: "Search mode. Defaults to literal, where regex syntax such as | has no special meaning.",
  }),
  caseSensitive: Schema.optional(Schema.Boolean).annotate({
    description: "Whether matching is case-sensitive. Defaults to false.",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description: "Optional sum_ handle whose descendants bound the search.",
  }),
  sourceID: Schema.optional(Schema.String).annotate({
    description: "Optional src_ handle that restricts the search to one exact current-session source.",
  }),
  startOffset: Schema.optional(Schema.Number).annotate({
    description:
      "Optional inclusive UTF-8 byte offset within sourceID. Use structural-anchor end offsets to search only after an opening boundary.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description:
      "Optional exclusive UTF-8 byte offset within sourceID. Use structural-anchor start offsets to stop before a closing boundary.",
  }),
  occurrenceOffset: Schema.optional(Schema.Number).annotate({
    description: "Zero-based match offset for paging a source-scoped search in groups of 20.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum records to return (default 20, maximum 50).",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description:
      "Opaque nextCursor from the preceding search with the same pattern, mode, case, and scope. limit may change between pages.",
  }),
})

type LcmGrepMetadata = {
  matches: number
  repeatedInput: boolean
  duplicatePayloadSuppressed?: boolean
  truncated: boolean
  lcmResult?: Record<string, unknown>
}

export function literalRanges(
  text: string,
  pattern: string,
  caseSensitive: boolean,
  occurrenceOffset: number,
  limit: number,
) {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase()
  if (needle === "") return { ranges: [], matchCount: 0, rangesComplete: true }
  const result: Array<{ start: number; end: number }> = []
  let matchCount = 0
  let searchOffset = 0
  while (true) {
    const found = haystack.indexOf(needle, searchOffset)
    if (found === -1) break
    matchCount++
    if (matchCount > occurrenceOffset && result.length < limit)
      result.push({ start: found, end: found + pattern.length })
    searchOffset = found + Math.max(1, pattern.length)
  }
  return { ranges: result, matchCount, rangesComplete: occurrenceOffset === 0 && result.length === matchCount }
}

export function utf8Ranges(text: string, ranges: Array<{ start: number; end: number }>) {
  let characterOffset = 0
  let byteOffset = 0
  return ranges.map((range) => {
    byteOffset += Buffer.byteLength(text.slice(characterOffset, range.start))
    const start = byteOffset
    byteOffset += Buffer.byteLength(text.slice(range.start, range.end))
    characterOffset = range.end
    return { start, end: byteOffset }
  })
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

export function literalPatternAdvice(pattern: string, mode: "literal" | "regex") {
  if (mode !== "literal") return
  if (["[", "]", "(", ")", "{", "}", ".", "^", "$", "+", "*", "?", "|"].some((item) => pattern.includes(`\\${item}`)))
    return "Literal mode treats backslashes literally. Remove regex escaping when you mean punctuation; for example, search for [START] rather than \\[START\\]."
  if (/(?:^|[^\\])\||\\[dDsSwWbB]|\.\*|\(\?:|\[[^\]]+\]/u.test(pattern))
    return "This literal pattern looks like a regular expression. Set mode to regex for operators such as |, \\d, .*, groups, or character classes."
}

export function occurrenceTotals(
  matches: Array<{ id: string; matchCount: number }>,
  kinds: Map<string, "source" | "summary">,
) {
  return matches.reduce(
    (totals, match) => {
      const kind = kinds.get(match.id)
      if (kind === "source") {
        totals.sourceRecords++
        totals.sourceOccurrences += match.matchCount
      }
      if (kind === "summary") {
        totals.summaryRecords++
        totals.summaryOccurrences += match.matchCount
      }
      return totals
    },
    { sourceRecords: 0, summaryRecords: 0, sourceOccurrences: 0, summaryOccurrences: 0 },
  )
}

export function grepCursorQuery(input: {
  pattern: string
  mode: "literal" | "regex"
  caseSensitive: boolean
  summaryID?: string
  sourceID?: string
  startOffset: number
  endOffset?: number
  occurrenceOffset: number
}) {
  return input
}

export function grepTotalsComplete(mode: "literal" | "regex", pageComplete: boolean) {
  return mode === "literal" || pageComplete
}

export function regexErrorMessage(error: unknown) {
  const seen = new Set<unknown>()
  const visit = (value: unknown): string => {
    if (!value || typeof value !== "object" || seen.has(value)) return ""
    seen.add(value)
    const record = value as { message?: unknown; cause?: unknown }
    const nested = visit(record.cause)
    if (nested.startsWith("lcm_")) return nested
    return typeof record.message === "string" ? record.message : nested
  }
  return visit(error)
}

export function regexToolError(error: unknown) {
  const message = regexErrorMessage(error)
  if (message === "lcm_cancelled")
    return new LcmToolError("lcm_cancelled", "The Conversation Memory search was cancelled.")
  if (message === "lcm_regex_pattern_too_long")
    return new LcmToolError(
      "lcm_invalid_regex",
      `The regular expression exceeds ${REGEX_SEARCH_LIMITS.patternCharacters} characters. Do not retry it unchanged; split it into shorter focused searches.`,
    )
  if (message === "lcm_regex_record_too_large")
    return new LcmToolError(
      "lcm_invalid_regex",
      "A source is too large for regex search. Do not retry it unchanged; narrow to a smaller source byte interval or use literal mode.",
    )
  if (message === "lcm_regex_scope_too_large")
    return new LcmToolError(
      "lcm_invalid_regex",
      "The regex scope is too large. Do not retry it unchanged; narrow it with summaryID or sourceID, or use literal mode.",
    )
  if (message === "lcm_regex_worker_unavailable")
    return new LcmToolError(
      "lcm_unavailable",
      "The isolated regular-expression worker is unavailable in this runtime. Use literal mode instead; do not retry the unchanged regex call.",
    )
  if (message === "lcm_regex_timeout")
    return new LcmToolError(
      "lcm_invalid_regex",
      `The regular expression exceeded the ${REGEX_SEARCH_LIMITS.timeoutMs} ms execution limit. Do not retry it unchanged; narrow the source byte interval, simplify the pattern, or use literal mode.`,
    )
  return new LcmToolError(
    "lcm_invalid_regex",
    "The regular-expression syntax is invalid. Correct the pattern or use literal mode; do not retry it unchanged.",
  )
}

function descendants(summaryID: string, children: Map<string, SummaryChild[]>) {
  const ids = new Set<string>()
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (ids.has(child.id)) continue
      ids.add(child.id)
      if (child.kind === "summary") visit(child.id)
    }
  }
  visit(summaryID)
  return ids
}

export const LcmGrepTool = Tool.define(
  "lcm_grep",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    const definition: Tool.DefWithoutID<typeof Parameters, LcmGrepMetadata> = {
      description:
        "Discover earlier current-session evidence in exact finalized raw text and active summaries. Literal mode is the default: enter punctuation exactly without regex backslashes; set mode to regex for alternatives such as foo|bar and keep every regex within 512 characters. A src_ handle is one transport record, never proof of a complete document, episode, section, or other semantic unit. Unscoped results include one preview plus exact counts and may contain overlapping summaries and raw descendants, so do not add both occurrence totals. For exact or exhaustive per-unit work, identify candidate src_ handles, apply structural startOffset/endOffset bounds, continue across chronological sources when needed, and seek with lcm_read.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_grep",
            patterns: [params.mode ?? "literal"],
            always: ["*"],
            metadata: { mode: params.mode ?? "literal" },
          })
          const history = completedToolCallHistory(ctx.messages, "lcm_grep", params)
          const previousIdenticalCalls = history.count
          const view = yield* loadMemory({ sessionID: ctx.sessionID, signal: ctx.abort, memory, database })
          const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)))
          if (
            params.occurrenceOffset !== undefined &&
            (!Number.isSafeInteger(params.occurrenceOffset) || params.occurrenceOffset < 0)
          )
            throw new LcmToolError("lcm_unavailable", "The occurrence offset must be a non-negative integer.")
          if (params.occurrenceOffset !== undefined && !params.sourceID)
            throw new LcmToolError("lcm_unavailable", "Occurrence paging requires a sourceID scope.")
          if ((params.startOffset !== undefined || params.endOffset !== undefined) && !params.sourceID)
            throw new LcmToolError("lcm_unavailable", "Source byte intervals require a sourceID scope.")
          if (
            (params.startOffset !== undefined &&
              (!Number.isSafeInteger(params.startOffset) || params.startOffset < 0)) ||
            (params.endOffset !== undefined && (!Number.isSafeInteger(params.endOffset) || params.endOffset < 0)) ||
            (params.startOffset !== undefined &&
              params.endOffset !== undefined &&
              params.startOffset > params.endOffset)
          )
            throw new LcmToolError(
              "lcm_unavailable",
              "The source search interval must use non-negative UTF-8 byte offsets with startOffset no greater than endOffset.",
            )
          const occurrenceOffset = params.occurrenceOffset ?? 0
          const rangeLimit = grepRangeLimit(params.sourceID !== undefined)
          const query = grepCursorQuery({
            pattern: params.pattern,
            mode: params.mode ?? "literal",
            caseSensitive: params.caseSensitive ?? false,
            summaryID: params.summaryID,
            sourceID: params.sourceID,
            startOffset: params.startOffset ?? 0,
            endOffset: params.endOffset,
            occurrenceOffset,
          })
          if (params.pattern.length === 0)
            throw new LcmToolError("lcm_unavailable", "The search pattern must not be empty.")
          let offset: number
          try {
            offset = decodeCursor(query, params.cursor)
          } catch {
            throw new LcmToolError("lcm_invalid_cursor", "The cursor does not belong to this search.")
          }
          const allowed = params.summaryID
            ? descendants(requireSummary(view, params.summaryID).id, view.children)
            : undefined
          if (params.sourceID) requireSource(view, params.sourceID)
          const chronology = params.sourceID ? sourceChronology(view, params.sourceID) : undefined
          const historicalCutoff =
            params.sourceID || params.summaryID ? undefined : priorTurnSourceCutoff(view, ctx.messages)
          const values = [
            ...[...view.sources.values()]
              .filter(
                (source) => (!params.sourceID || source.id === params.sourceID) && (!allowed || allowed.has(source.id)),
              )
              .filter((source) => historicalCutoff === undefined || source.ordinal <= historicalCutoff)
              .map((source) => {
                const fullText = view.content.get(source.id)?.content ?? ""
                let window: ReturnType<typeof utf8SearchWindow>
                try {
                  window = utf8SearchWindow(fullText, params.sourceID ? (params.startOffset ?? 0) : 0, params.endOffset)
                } catch {
                  throw new LcmToolError(
                    "lcm_unavailable",
                    "The source search interval is outside the source or is not aligned to UTF-8 byte boundaries.",
                  )
                }
                return {
                  id: source.id,
                  kind: "source" as const,
                  sourceKind: source.kind,
                  ordinal: source.ordinal,
                  fullText,
                  ...window,
                }
              }),
            ...[...view.summaries.values()]
              .filter(
                (summary) =>
                  !params.sourceID && (!allowed || allowed.has(summary.id) || summary.id === params.summaryID),
              )
              .filter((summary) => historicalCutoff === undefined || summary.lastOrdinal <= historicalCutoff)
              .map((summary) => ({
                id: summary.id,
                kind: "summary" as const,
                ordinal: summary.firstOrdinal,
                text: summary.text,
                fullText: summary.text,
                characterOffset: 0,
                byteOffset: 0,
                endOffset: Buffer.byteLength(summary.text),
                totalBytes: Buffer.byteLength(summary.text),
              })),
          ].toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
          const repeated = repeatedRecoveryResult({
            tool: "lcm_grep",
            previousIdenticalCalls,
            sourceScoped: Boolean(params.sourceID),
            priorResult: history.priorResult,
          })
          if (repeated)
            return {
              title: `Repeated Conversation Memory search suppressed: ${params.pattern}`,
              output: inertOutput({
                ...repeated,
                ...(chronology ? { chronology } : {}),
                ...(params.sourceID ? { sourceID: params.sourceID } : {}),
              }),
              metadata: {
                matches: 0,
                repeatedInput: true,
                duplicatePayloadSuppressed: true,
                truncated: false,
              },
            }
          const found =
            (params.mode ?? "literal") === "regex"
              ? yield* Effect.tryPromise(() =>
                  regexSearch({
                    pattern: params.pattern,
                    caseSensitive: params.caseSensitive ?? false,
                    values,
                    recordLimit: offset + limit + 1,
                    rangeOffset: occurrenceOffset,
                    rangeLimit,
                    signal: ctx.abort,
                  }),
                ).pipe(Effect.catch((error) => Effect.fail(regexToolError(error))))
              : values
                  .map((value) => ({
                    id: value.id,
                    ...literalRanges(
                      value.text,
                      params.pattern,
                      params.caseSensitive ?? false,
                      occurrenceOffset,
                      rangeLimit,
                    ),
                  }))
                  .filter((item) => item.ranges.length > 0)
          const selected = found.slice(offset, offset + limit)
          const byID = new Map(values.map((value) => [value.id, value]))
          const matches = selected.map((item) => {
            const value = byID.get(item.id)!
            const ranges = item.ranges.map((range) => ({
              start: range.start + value.characterOffset,
              end: range.end + value.characterOffset,
            }))
            const byteRanges = utf8Ranges(value.text, item.ranges).map((range) => ({
              start: range.start + value.byteOffset,
              end: range.end + value.byteOffset,
            }))
            const occurrences = ranges.map((range, index) => ({
              range,
              byteRange: byteRanges[index]!,
              excerpt: value.fullText.slice(
                Math.max(0, range.start - 100),
                Math.min(value.fullText.length, range.end + 180),
              ),
            }))
            return {
              id: value.id,
              kind: value.kind,
              ...(value.kind === "source"
                ? { sourceID: value.id, sourceKind: value.sourceKind }
                : { summaryID: value.id }),
              ordinal: value.ordinal,
              ranges,
              byteRanges,
              matchCount: item.matchCount,
              rangesComplete: item.rangesComplete,
              occurrencePage: {
                offset: occurrenceOffset,
                returned: item.ranges.length,
                total: item.matchCount,
                complete: occurrenceOffset + item.ranges.length >= item.matchCount,
                ...(params.sourceID && item.matchCount > MAX_RANGES_PER_RECORD
                  ? { lastOffset: lastOccurrencePageOffset(item.matchCount) }
                  : {}),
                ...(params.sourceID && occurrenceOffset + item.ranges.length < item.matchCount
                  ? { nextOffset: occurrenceOffset + item.ranges.length }
                  : {}),
              },
              occurrences,
              occurrencesComplete: occurrenceOffset === 0 && occurrences.length === item.matchCount,
            }
          })
          const nextOffset = offset + selected.length
          const kinds = new Map(values.map((value) => [value.id, value.kind]))
          const complete = nextOffset >= found.length
          const totalsComplete = grepTotalsComplete(params.mode ?? "literal", complete)
          const callGuidance = recoveryCallGuidance({
            tool: "lcm_grep",
            previousIdenticalCalls,
            sourceScoped: Boolean(params.sourceID),
          })
          const advice = [
            literalPatternAdvice(params.pattern, params.mode ?? "literal"),
            occurrencePaginationAdvice(
              Boolean(params.sourceID),
              matches.map((match) => match.matchCount),
            ),
            params.sourceID && (params.startOffset !== undefined || params.endOffset !== undefined)
              ? "Matches and totals are limited to the requested half-open source byte interval [startOffset, endOffset)."
              : undefined,
            params.sourceID && params.startOffset === undefined && params.endOffset === undefined
              ? "WARNING: this search covers the entire transport source, which may include evidence before or after the intended document, episode, section, or other semantic unit. Do not use it for per-unit first/last/count conclusions until structural bounds are applied. If the unit opens near this source's end, ignore earlier bytes and continue in later chronological sources."
              : undefined,
            !params.sourceID && !params.summaryID && matches.some((match) => match.kind === "summary")
              ? "Summaries and raw descendants can overlap. For exact counts or lists, use summary matches only to find candidate source regions and verify raw src_ records."
              : undefined,
          ].filter((item): item is string => item !== undefined)
          const result = {
            callGuidance,
            ...(chronology ? { chronology } : {}),
            ...(params.sourceID
              ? {
                  scope: {
                    kind:
                      params.startOffset !== undefined || params.endOffset !== undefined
                        ? ("bounded_source_interval" as const)
                        : ("entire_transport_source" as const),
                    semanticUnitGuaranteed: false,
                  },
                }
              : {}),
            ...(advice.length > 0 ? { advice } : {}),
            matches,
            ...(nextOffset < found.length ? { nextCursor: encodeCursor(query, nextOffset) } : {}),
            totals: {
              returned: occurrenceTotals(selected, kinds),
              ...(totalsComplete ? { complete: occurrenceTotals(found, kinds) } : {}),
            },
            searched: {
              sources: values.filter((value) => value.kind === "source").length,
              summaries: values.filter((value) => value.kind === "summary").length,
              complete,
              ...(params.sourceID
                ? {
                    byteRange: {
                      start: values[0]?.byteOffset ?? 0,
                      end: values[0]?.endOffset ?? 0,
                    },
                  }
                : {}),
            },
          }
          return {
            title: `Conversation Memory search: ${params.pattern}`,
            output: inertOutput(result),
            metadata: {
              matches: matches.length,
              repeatedInput: previousIdenticalCalls > 0,
              truncated:
                result.searched.complete === false ||
                matches.some((match) => !match.rangesComplete || !match.occurrencesComplete),
              lcmResult: {
                kind: "grep",
                matchedRecords: matches.length,
                totals: result.totals,
                searched: result.searched,
                hasNextPage: result.nextCursor !== undefined,
              },
            },
          }
        }).pipe(Effect.orDie),
    }
    return definition
  }),
)
