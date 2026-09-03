import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import {
  inertOutput,
  isolatedRecoveryPriorTurnCutoff,
  lcmMemorySessionID,
  loadMemory,
  requireIsolatedRecoverySource,
  requireIsolatedRecoverySummary,
  requireSource,
  requireSummary,
} from "./lcm-common"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Current-session src_ source or active sum_ summary handle." }),
})

export const LcmDescribeTool = Tool.define(
  "lcm_describe",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    return {
      description:
        "Inspect one current-session src_ source or sum_ summary without dumping its body. Use its provenance, exact ordinal range, active/frontier state, and parent/child metadata to decide whether to lcm_read a source or lcm_expand a summary.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_describe",
            patterns: [params.id],
            always: ["*"],
            metadata: { id: params.id },
          })
          const view = yield* loadMemory({
            sessionID: lcmMemorySessionID(ctx),
            signal: ctx.abort,
            memory,
            database,
          })
          if (params.id.startsWith("sum_")) {
            const summary = requireSummary(view, params.id)
            requireIsolatedRecoverySummary(ctx, view, summary)
            const frontier = view.revision?.items.some((item) => item.id === summary.id) ?? false
            const result = {
              id: summary.id,
              kind: "summary",
              active: true,
              frontier,
              excerpt: summary.text.slice(0, 500),
              tokens: summary.tokens,
              bytes: summary.bytes,
              sourceRange: { first: summary.firstOrdinal, last: summary.lastOrdinal },
              childCount: view.children.get(summary.id)?.length ?? 0,
              level: summary.level,
              generationMode: summary.generationMode,
              digest: summary.digest,
            }
            return { title: `Conversation Memory: ${summary.id}`, output: inertOutput(result), metadata: {} }
          }
          const { source } = requireSource(view, params.id)
          requireIsolatedRecoverySource(ctx, view, source)
          const isolatedCutoff = isolatedRecoveryPriorTurnCutoff(ctx, view)
          const parents = [...view.children.entries()]
            .filter(([, children]) => children.some((child) => child.kind === "source" && child.id === source.id))
            .filter(
              ([id]) =>
                isolatedCutoff === undefined || (view.summaries.get(id)?.lastOrdinal ?? Infinity) <= isolatedCutoff,
            )
            .map(([id]) => id)
          const result = {
            id: source.id,
            kind: "source",
            active: parents.length > 0 || (view.revision?.items.some((item) => item.id === source.id) ?? false),
            frontier: view.revision?.items.some((item) => item.id === source.id) ?? false,
            excerpt: source.excerpt,
            tokens: source.tokens,
            bytes: source.bytes,
            sourceRange: { first: source.ordinal, last: source.ordinal },
            sourceKind: source.kind,
            messageID: source.messageID,
            partID: source.partID,
            digest: source.digest,
            parentSummaries: parents,
            ...(source.mediaType ? { mediaType: source.mediaType } : {}),
          }
          return { title: `Conversation Memory: ${source.id}`, output: inertOutput(result), metadata: {} }
        }),
    }
  }),
)
