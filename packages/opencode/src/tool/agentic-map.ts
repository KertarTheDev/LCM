// kilocode_change - new file
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { Session } from "../session/session"
import { LCM_MAP_TOOL_DESCRIPTIONS } from "../session/lcm/map"
import type { AgenticMapInput, LcmMapResult, LcmToolErrorResult } from "../session/lcm/types"
import { assertExternalDirectoryEffect } from "./external-directory"
import { lcmToolWrapperError } from "./lcm-tool-error"
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
  itemSchema: Schema.Unknown.annotate({
    description:
      "Draft 2020-12 JSON Schema object or boolean for each output item. A valid JSON-stringified schema is also accepted.",
  }),
  prompt: Schema.String.annotate({ description: "Instruction applied independently to each JSONL input item." }),
  mode: Schema.Literals(["read_only", "write_capable"]).annotate({ description: "Child-session capability mode." }),
  model: Schema.optional(modelSelection).annotate({ description: "Model selector. Defaults to the current model." }),
  workers: Schema.optional(PositiveInt).annotate({
    description: "Requested worker count. Defaults to 8, may not exceed 8, and may be lowered for provider capacity.",
  }),
  maxRetries: Schema.optional(NonNegativeInt).annotate({
    description:
      "Retries after the initial provider or response failure. Defaults to 2. Transient capacity waiting or deferral is automatic and does not consume this budget.",
  }),
})

type RuntimeAgenticMap = (
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: (input: { canonicalPath: string }) => Promise<"allowed" | "denied">
    providerID?: string
    modelID?: string
    submittingAgent: string
    parentDirectory: string
  } & AgenticMapInput,
) => Effect.Effect<LcmMapResult | LcmToolErrorResult>

export const AgenticMapTool = Tool.define(
  "agentic_map",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: LCM_MAP_TOOL_DESCRIPTIONS.agentic_map,
      parameters,
      execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
          const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
          if (!lcmRuntime) throw new Error("LCM runtime is unavailable")

          const parentSession = yield* sessions.get(ctx.sessionID)
          const model = ctx.extra?.model as { providerID?: string; id?: string; api?: { id?: string } } | undefined
          const runtimeMap = lcmRuntime.agenticMap as RuntimeAgenticMap

          const result = yield* runtimeMap({
            ...(params as AgenticMapInput),
            sessionID: ctx.sessionID,
            abortSignal: ctx.abort,
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
            ...(model?.providerID ? { providerID: model.providerID } : {}),
            ...(model?.id ? { modelID: model.id } : model?.api?.id ? { modelID: model.api.id } : {}),
            submittingAgent: ctx.agent,
            parentDirectory: parentSession.directory,
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
          return renderResult(result)
        }).pipe(
          Effect.catchCause(() => Effect.succeed(renderResult(lcmToolWrapperError("agentic_map_tool_wrapper_failed")))),
        ),
    }
  }),
)

function renderResult(result: LcmMapResult | LcmToolErrorResult) {
  return {
    title: "Agentic Map",
    metadata: {
      ok: result.ok,
      ...(result.ok
        ? {
            mapID: result.mapID,
            status: result.status,
            executionState: result.executionState,
            totalItems: result.totalItems,
            completedItems: result.completedItems,
            failedItems: result.failedItems,
            retriedItems: result.retriedItems,
            retryableItems: result.retryableItems,
            capacityDeferredItems: result.capacityDeferredItems,
            runningItems: result.runningItems,
            waitingCapacityItems: result.waitingCapacityItems,
            lastUpdatedAtMs: result.lastUpdatedAtMs,
            lastProgressAtMs: result.lastProgressAtMs,
            effectiveWorkers: result.effectiveWorkers,
            retryAfterMs: result.retryAfterMs,
          }
        : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
      truncated: false,
    },
    output: JSON.stringify(result, null, 2),
  }
}
