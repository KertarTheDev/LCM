import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch } from "@/kilocode/session/lcm/regex-search"
import {
  inertOutput,
  LcmToolError,
  loadMemory,
  priorTurnSourceCutoff,
  requireSource,
  requireSummary,
} from "./lcm-common"
import type { SummaryChild } from "@/kilocode/session/lcm/types"

const MAX_RANGES_PER_RECORD = 20
const MAX_OCCURRENCES_PER_RECORD = 5

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "Literal text in literal mode, or a regular expression in regex mode; alternatives using | require regex mode.",
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
  occurrenceOffset: Schema.optional(Schema.Number).annotate({
    description: "Zero-based match offset for paging a source-scoped search in groups of 20.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum records to return (default 20, maximum 50).",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque nextCursor from the preceding identical search.",
  }),
})

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
    return {
      description:
        "Search exact finalized raw conversation text and active Conversation Memory summaries in the current session. Results include exact per-record match counts; use lcm_read to inspect source text beyond the returned ranges.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_grep",
            patterns: [params.mode ?? "literal"],
            always: ["*"],
            metadata: { mode: params.mode ?? "literal" },
          })
          const view = yield* loadMemory({ sessionID: ctx.sessionID, signal: ctx.abort, memory, database })
          const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)))
          if (
            params.occurrenceOffset !== undefined &&
            (!Number.isSafeInteger(params.occurrenceOffset) || params.occurrenceOffset < 0)
          )
            throw new LcmToolError("lcm_unavailable", "The occurrence offset must be a non-negative integer.")
          if (params.occurrenceOffset !== undefined && !params.sourceID)
            throw new LcmToolError("lcm_unavailable", "Occurrence paging requires a sourceID scope.")
          const occurrenceOffset = params.occurrenceOffset ?? 0
          const query = {
            pattern: params.pattern,
            mode: params.mode ?? "literal",
            caseSensitive: params.caseSensitive ?? false,
            summaryID: params.summaryID,
            sourceID: params.sourceID,
            occurrenceOffset,
            limit,
          }
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
          const historicalCutoff =
            params.sourceID || params.summaryID ? undefined : priorTurnSourceCutoff(view, ctx.messages)
          const values = [
            ...[...view.sources.values()]
              .filter(
                (source) => (!params.sourceID || source.id === params.sourceID) && (!allowed || allowed.has(source.id)),
              )
              .filter((source) => historicalCutoff === undefined || source.ordinal <= historicalCutoff)
              .map((source) => ({
                id: source.id,
                kind: "source" as const,
                sourceKind: source.kind,
                ordinal: source.ordinal,
                text: view.content.get(source.id)?.content ?? "",
              })),
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
              })),
          ].toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
          const found =
            (params.mode ?? "literal") === "regex"
              ? yield* Effect.tryPromise(() =>
                  regexSearch({
                    pattern: params.pattern,
                    caseSensitive: params.caseSensitive ?? false,
                    values,
                    recordLimit: offset + limit + 1,
                    rangeOffset: occurrenceOffset,
                    rangeLimit: MAX_RANGES_PER_RECORD,
                    signal: ctx.abort,
                  }),
                ).pipe(
                  Effect.catch((error) =>
                    Effect.fail(
                      new LcmToolError(
                        error instanceof Error && error.message === "lcm_cancelled"
                          ? "lcm_cancelled"
                          : "lcm_invalid_regex",
                        "The regular expression is invalid, too expensive, or was cancelled.",
                      ),
                    ),
                  ),
                )
              : values
                  .map((value) => ({
                    id: value.id,
                    ...literalRanges(
                      value.text,
                      params.pattern,
                      params.caseSensitive ?? false,
                      occurrenceOffset,
                      MAX_RANGES_PER_RECORD,
                    ),
                  }))
                  .filter((item) => item.ranges.length > 0)
          const selected = found.slice(offset, offset + limit)
          const byID = new Map(values.map((value) => [value.id, value]))
          const matches = selected.map((item) => {
            const value = byID.get(item.id)!
            const first = item.ranges[0]!
            const start = Math.max(0, first.start - 100)
            const end = Math.min(value.text.length, first.end + 180)
            const byteRanges = utf8Ranges(value.text, item.ranges)
            const occurrenceLimit = params.sourceID ? MAX_RANGES_PER_RECORD : MAX_OCCURRENCES_PER_RECORD
            const occurrences = item.ranges.slice(0, occurrenceLimit).map((range, index) => ({
              range,
              byteRange: byteRanges[index]!,
              excerpt: value.text.slice(Math.max(0, range.start - 100), Math.min(value.text.length, range.end + 180)),
            }))
            return {
              id: value.id,
              kind: value.kind,
              ...(value.kind === "source"
                ? { sourceID: value.id, sourceKind: value.sourceKind }
                : { summaryID: value.id }),
              ordinal: value.ordinal,
              excerpt: value.text.slice(start, end),
              ranges: item.ranges,
              byteRanges,
              matchCount: item.matchCount,
              rangesComplete: item.rangesComplete,
              occurrencePage: {
                offset: occurrenceOffset,
                returned: item.ranges.length,
                total: item.matchCount,
                complete: occurrenceOffset + item.ranges.length >= item.matchCount,
                ...(occurrenceOffset + item.ranges.length < item.matchCount
                  ? { nextOffset: occurrenceOffset + item.ranges.length }
                  : {}),
              },
              occurrences,
              occurrencesComplete: occurrenceOffset === 0 && occurrences.length === item.matchCount,
            }
          })
          const nextOffset = offset + selected.length
          const result = {
            matches,
            ...(nextOffset < found.length ? { nextCursor: encodeCursor(query, nextOffset) } : {}),
            searched: {
              sources: values.filter((value) => value.kind === "source").length,
              summaries: values.filter((value) => value.kind === "summary").length,
              complete: nextOffset >= found.length,
            },
          }
          return {
            title: `Conversation Memory search: ${params.pattern}`,
            output: inertOutput(result),
            metadata: {
              matches: matches.length,
              truncated:
                result.searched.complete === false ||
                matches.some((match) => !match.rangesComplete || !match.occurrencesComplete),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
