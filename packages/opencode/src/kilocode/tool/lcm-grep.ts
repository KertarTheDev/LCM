import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch } from "@/kilocode/session/lcm/regex-search"
import { inertOutput, LcmToolError, loadMemory, requireSummary } from "./lcm-common"
import type { SummaryChild } from "@/kilocode/session/lcm/types"

const Parameters = Schema.Struct({
  pattern: Schema.String,
  mode: Schema.optional(Schema.Literals(["literal", "regex"])),
  caseSensitive: Schema.optional(Schema.Boolean),
  summaryID: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
})

function ranges(text: string, pattern: string, caseSensitive: boolean, limit: number) {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase()
  if (needle === "") return []
  const result: Array<{ start: number; end: number }> = []
  let offset = 0
  while (result.length < limit) {
    const found = haystack.indexOf(needle, offset)
    if (found === -1) break
    result.push({ start: found, end: found + pattern.length })
    offset = found + Math.max(1, pattern.length)
  }
  return result
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
        "Search finalized raw conversation sources and active Conversation Memory summaries in the current session.",
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
          const query = {
            pattern: params.pattern,
            mode: params.mode ?? "literal",
            caseSensitive: params.caseSensitive ?? false,
            summaryID: params.summaryID,
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
          const values = [
            ...[...view.sources.values()]
              .filter((source) => !allowed || allowed.has(source.id))
              .map((source) => ({
                id: source.id,
                kind: "source" as const,
                ordinal: source.ordinal,
                text: view.content.get(source.id)?.content ?? "",
              })),
            ...[...view.summaries.values()]
              .filter((summary) => !allowed || allowed.has(summary.id) || summary.id === params.summaryID)
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
                    rangeLimit: offset + limit + 1,
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
                    ranges: ranges(value.text, params.pattern, params.caseSensitive ?? false, offset + limit + 1),
                  }))
                  .filter((item) => item.ranges.length > 0)
          const selected = found.slice(offset, offset + limit)
          const byID = new Map(values.map((value) => [value.id, value]))
          const matches = selected.map((item) => {
            const value = byID.get(item.id)!
            const first = item.ranges[0]!
            const start = Math.max(0, first.start - 100)
            const end = Math.min(value.text.length, first.end + 180)
            return {
              id: value.id,
              kind: value.kind,
              ...(value.kind === "source" ? { sourceID: value.id } : { summaryID: value.id }),
              ordinal: value.ordinal,
              excerpt: value.text.slice(start, end),
              ranges: item.ranges,
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
            metadata: { matches: matches.length, truncated: result.searched.complete === false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
