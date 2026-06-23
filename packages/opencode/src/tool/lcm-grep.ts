// kilocode_change - new file
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmGrepInput } from "../session/lcm/types"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "Pattern to search for in authorized current-lineage memory" }),
  mode: Schema.optional(Schema.Literals(["regex", "literal"])).annotate({
    description: "Search mode. Defaults to regex.",
  }),
  caseSensitive: Schema.optional(Schema.Boolean).annotate({
    description: "Whether matching is case-sensitive. Defaults to false.",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description: "Optional authorized summary handle to scope search.",
  }),
  limit: Schema.optional(PositiveInt).annotate({ description: "Maximum results to return on this page." }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque cursor returned by a previous lcm_grep call.",
  }),
})

export const LcmGrepTool = Tool.define(
  "lcm_grep",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_grep,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const result = yield* lcmRuntime.grep({
          ...(params as LcmGrepInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
        })
        return {
          title: "LCM Grep",
          metadata: {
            ok: result.ok,
            ...(result.ok
              ? { matches: result.results.length, hasMore: result.page.hasMore }
              : { code: result.error.code }),
            truncated: result.ok ? result.page.hasMore : false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
