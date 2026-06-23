// kilocode_change - new file
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmExpandQueryInput } from "../session/lcm/types"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Question to answer from authorized current-lineage LCM memory" }),
  summaryID: Schema.optional(Schema.String).annotate({
    description: "Optional authorized summary handle whose covered source should be searched first.",
  }),
  maxAnswerTokens: Schema.optional(PositiveInt).annotate({ description: "Maximum answer tokens. Defaults to 2000." }),
})

export const LcmExpandQueryTool = Tool.define(
  "lcm_expand_query",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_expand_query,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const model = ctx.extra?.model as { providerID?: string; id?: string; api?: { id?: string } } | undefined
        const result = yield* lcmRuntime.expandQuery({
          ...(params as LcmExpandQueryInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
          ...(model?.providerID ? { providerID: model.providerID } : {}),
          ...(model?.id ? { modelID: model.id } : model?.api?.id ? { modelID: model.api.id } : {}),
        })
        return {
          title: "LCM Expand Query",
          metadata: {
            ok: result.ok,
            ...(result.ok
              ? { citations: result.citations.length }
              : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
            truncated: result.ok ? result.truncated === true : false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
