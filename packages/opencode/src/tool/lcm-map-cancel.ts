// kilocode_change - new file
import { Effect, Option, Schema } from "effect"
import { LCM_MAP_TOOL_DESCRIPTIONS } from "../session/lcm/map"
import type { LcmMapCancelInput } from "../session/lcm/types"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  mapID: Schema.String.annotate({ description: "Authorized LCM map run handle." }),
})

export const LcmMapCancelTool = Tool.define(
  "lcm_map_cancel",
  Effect.succeed({
    description: LCM_MAP_TOOL_DESCRIPTIONS.lcm_map_cancel,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const result = yield* lcmRuntime.mapCancel({
          ...(params as LcmMapCancelInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
        })
        return {
          title: "LCM Map Cancel",
          metadata: {
            ok: result.ok,
            ...(result.ok
              ? {
                  mapID: result.mapID,
                  status: result.status,
                  totalItems: result.totalItems,
                  completedItems: result.completedItems,
                  failedItems: result.failedItems,
                }
              : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
            truncated: false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
