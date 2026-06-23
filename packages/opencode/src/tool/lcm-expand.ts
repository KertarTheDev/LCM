// kilocode_change - new file
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmExpandInput } from "../session/lcm/types"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  summaryID: Schema.String.annotate({ description: "Authorized summary handle to expand" }),
  limit: Schema.optional(PositiveInt).annotate({ description: "Maximum items to return on this page." }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque cursor returned by a previous lcm_expand call.",
  }),
})

export const LcmExpandTool = Tool.define(
  "lcm_expand",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_expand,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const result = yield* lcmRuntime.expand({
          ...(params as LcmExpandInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
        })
        return {
          title: "LCM Expand",
          metadata: {
            ok: result.ok,
            ...(result.ok ? { items: result.items.length, hasMore: result.page.hasMore } : { code: result.error.code }),
            truncated: result.ok ? result.page.hasMore : false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
