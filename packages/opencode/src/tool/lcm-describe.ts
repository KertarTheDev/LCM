// kilocode_change - new file
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmDescribeInput } from "../session/lcm/types"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Authorized summary or file handle to describe" }),
})

export const LcmDescribeTool = Tool.define(
  "lcm_describe",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_describe,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const result = yield* lcmRuntime.describe({
          ...(params as LcmDescribeInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
        })
        return {
          title: "LCM Describe",
          metadata: {
            ok: result.ok,
            ...(result.ok ? { kind: result.kind } : { code: result.error.code }),
            truncated: false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
