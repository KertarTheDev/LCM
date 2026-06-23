// kilocode_change - new file
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_MAP_TOOL_DESCRIPTIONS } from "../session/lcm/map"
import type { LlmMapInput, LcmMapResult, LcmToolErrorResult } from "../session/lcm/types"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"

const modelSelection = Schema.Union([
  Schema.Literal("default"),
  Schema.Literal("small"),
  Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
  }),
])

const parameters = Schema.Struct({
  inputFileID: Schema.optional(Schema.String).annotate({ description: "Authorized LCM JSONL input file handle." }),
  inputPath: Schema.optional(Schema.String).annotate({
    description: "Path to a JSONL input file to register before mapping.",
  }),
  inputJsonl: Schema.optional(Schema.String).annotate({
    description: "Inline JSONL input to register before mapping.",
  }),
  itemSchema: Schema.Unknown.annotate({ description: "Draft 2020-12 JSON Schema for each output item." }),
  prompt: Schema.String.annotate({ description: "Instruction applied independently to each JSONL input item." }),
  model: Schema.optional(modelSelection).annotate({ description: "Model selector. Defaults to the current model." }),
  workers: Schema.optional(PositiveInt).annotate({
    description: "Worker count. Defaults to 16 and may not exceed 16.",
  }),
  maxRetries: Schema.optional(NonNegativeInt).annotate({
    description: "Retries after the initial attempt. Defaults to 2.",
  }),
})

type RuntimeMap = (
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: (input: { canonicalPath: string }) => Promise<"allowed" | "denied">
    providerID?: string
    modelID?: string
  } & LlmMapInput,
) => Effect.Effect<LcmMapResult | LcmToolErrorResult>

export const LlmMapTool = Tool.define(
  "llm_map",
  Effect.succeed({
    description: LCM_MAP_TOOL_DESCRIPTIONS.llm_map,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const runtimeMap = lcmRuntime.llmMap as RuntimeMap
        const model = ctx.extra?.model as { providerID?: string; id?: string; api?: { id?: string } } | undefined
        const result = yield* runtimeMap({
          ...(params as LlmMapInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
          ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          ...(model?.providerID ? { providerID: model.providerID } : {}),
          ...(model?.id ? { modelID: model.id } : model?.api?.id ? { modelID: model.api.id } : {}),
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
          title: "LLM Map",
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
