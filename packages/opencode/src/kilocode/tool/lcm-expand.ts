import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import {
  inertOutput,
  lcmMemorySessionID,
  LcmToolError,
  loadMemory,
  requireIsolatedRecoverySummary,
  requireSummary,
} from "./lcm-common"

const Parameters = Schema.Struct({
  summaryID: Schema.String.annotate({ description: "Active current-session sum_ summary handle." }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum children to return (default 10, maximum 50).",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque nextCursor from the preceding expansion of this summary. limit may change between pages.",
  }),
})

export function expandCursorQuery(summaryID: string) {
  return { summaryID }
}

export const LcmExpandTool = Tool.define(
  "lcm_expand",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    return {
      description:
        "List one ordered tree level beneath an active current-session sum_ summary. Recurse with lcm_expand for child summaries or use lcm_read on child src_ sources; immediate children are not implicit grandchildren.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_expand",
            patterns: [params.summaryID],
            always: ["*"],
            metadata: { summaryID: params.summaryID },
          })
          const view = yield* loadMemory({
            sessionID: lcmMemorySessionID(ctx),
            signal: ctx.abort,
            memory,
            database,
          })
          const parent = requireSummary(view, params.summaryID)
          requireIsolatedRecoverySummary(ctx, view, parent)
          const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 10)))
          const query = expandCursorQuery(params.summaryID)
          let offset: number
          try {
            offset = decodeCursor(query, params.cursor)
          } catch {
            throw new LcmToolError("lcm_invalid_cursor", "The cursor does not belong to this expansion.")
          }
          const all = view.children.get(params.summaryID) ?? []
          const selected = all.slice(offset, offset + limit)
          const children = selected.map((child) => {
            if (child.kind === "source") {
              const source = view.sources.get(child.id)
              if (!source) throw new LcmToolError("lcm_stale_lineage", "A summary source is no longer current.")
              return {
                id: source.id,
                kind: "source" as const,
                sourceKind: source.kind,
                ordinal: source.ordinal,
                excerpt: source.excerpt,
                tokens: source.tokens,
                sourceRange: { first: source.ordinal, last: source.ordinal },
              }
            }
            const summary = view.summaries.get(child.id)
            if (!summary) throw new LcmToolError("lcm_stale_lineage", "A child summary is no longer current.")
            return {
              id: summary.id,
              kind: "summary" as const,
              ordinal: summary.firstOrdinal,
              excerpt: summary.text.slice(0, 320),
              tokens: summary.tokens,
              sourceRange: { first: summary.firstOrdinal, last: summary.lastOrdinal },
            }
          })
          const nextOffset = offset + selected.length
          const result = {
            summaryID: params.summaryID,
            children,
            ...(nextOffset < all.length ? { nextCursor: encodeCursor(query, nextOffset) } : {}),
          }
          return {
            title: `Expand Conversation Memory: ${params.summaryID}`,
            output: inertOutput(result),
            metadata: { children: children.length, truncated: nextOffset < all.length },
          }
        }),
    }
  }),
)
