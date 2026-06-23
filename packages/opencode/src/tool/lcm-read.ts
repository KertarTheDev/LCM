// kilocode_change - new file
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmReadInput, LcmReadResult, LcmToolErrorResult } from "../session/lcm/types"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  fileID: Schema.String.annotate({ description: "Authorized LCM file handle to read" }),
  byteOffset: Schema.optional(NonNegativeInt).annotate({ description: "Zero-based byte offset. Defaults to 0." }),
  maxBytes: Schema.optional(PositiveInt).annotate({ description: "Maximum bytes to return." }),
})

export const LcmReadTool = Tool.define(
  "lcm_read",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_read,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const read = lcmRuntime.read as (
          input: {
            sessionID: string
            abortSignal?: AbortSignal
            checkPathPermission?: (input: { canonicalPath: string }) => Promise<"allowed" | "denied">
          } & LcmReadInput,
        ) => Effect.Effect<LcmReadResult | LcmToolErrorResult>
        const result = yield* read({
          ...(params as LcmReadInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
          checkPathPermission: (permissionInput) =>
            Effect.runPromise(
              Effect.gen(function* () {
                yield* assertExternalDirectoryEffect(ctx, permissionInput.canonicalPath, { kind: "file" })
                yield* ctx.ask({
                  permission: "read",
                  patterns: [permissionInput.canonicalPath],
                  always: ["*"],
                  metadata: {},
                })
                return "allowed" as const
              }).pipe(Effect.catchCause(() => Effect.succeed("denied" as const))),
            ),
        })
        return {
          title: "LCM Read",
          metadata: {
            ok: result.ok,
            ...(result.ok
              ? { bytesReturned: result.bytesReturned, hasMore: result.page.hasMore }
              : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
            truncated: result.ok ? result.page.hasMore : false,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
