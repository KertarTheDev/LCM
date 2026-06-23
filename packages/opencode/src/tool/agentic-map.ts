// kilocode_change - new file
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { Agent } from "../agent/agent"
import { ModelID, ProviderID } from "../provider/schema"
import { Session } from "../session/session"
import { MessageID } from "../session/schema"
import { LCM_MAP_TOOL_DESCRIPTIONS, type AgenticMapChildRunner } from "../session/lcm/map"
import type { AgenticMapInput, LcmMapResult, LcmToolErrorResult } from "../session/lcm/types"
import { assertExternalDirectoryEffect } from "./external-directory"
import type { TaskPromptOps } from "./task"
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
  mode: Schema.Literals(["read_only", "write_capable"]).annotate({ description: "Child-session capability mode." }),
  model: Schema.optional(modelSelection).annotate({ description: "Model selector. Defaults to the current model." }),
  workers: Schema.optional(PositiveInt).annotate({ description: "Worker count. Defaults to 8 and may not exceed 8." }),
  maxRetries: Schema.optional(NonNegativeInt).annotate({
    description: "Retries after the initial attempt. Defaults to 2.",
  }),
})

const READ_ONLY_DENIED_TOOLS = ["edit", "write", "apply_patch", "multiedit", "bash", "task", "todowrite"] as const

type RuntimeAgenticMap = (
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: (input: { canonicalPath: string }) => Promise<"allowed" | "denied">
    providerID?: string
    modelID?: string
    childRunner: AgenticMapChildRunner
  } & AgenticMapInput,
) => Effect.Effect<LcmMapResult | LcmToolErrorResult>

export const AgenticMapTool = Tool.define(
  "agentic_map",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service

    return {
      description: LCM_MAP_TOOL_DESCRIPTIONS.agentic_map,
      parameters,
      execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
          const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
          if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) throw new Error("agentic_map requires promptOps in ctx.extra")

          const parentSession = yield* sessions.get(ctx.sessionID)
          const caller = yield* agents.get(ctx.agent)
          const model = ctx.extra?.model as { providerID?: string; id?: string; api?: { id?: string } } | undefined
          const runtimeMap = lcmRuntime.agenticMap as RuntimeAgenticMap

          const childRunner: AgenticMapChildRunner = (itemInput) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const title = `LCM map ${itemInput.mapID} item ${itemInput.itemIndex}`
                const existing = (yield* sessions.children(ctx.sessionID)).find((child) => child.title === title)
                const childPermission = [
                  ...(parentSession.permission ?? []),
                  ...(itemInput.mode === "read_only"
                    ? READ_ONLY_DENIED_TOOLS.map((permission) => ({
                        permission,
                        pattern: "*",
                        action: "deny" as const,
                      }))
                    : []),
                ]
                const childSession =
                  existing ??
                  (yield* sessions.create({
                    parentID: ctx.sessionID,
                    title,
                    permission: childPermission,
                  }))
                if (existing) {
                  yield* sessions.setPermission({ sessionID: childSession.id, permission: childPermission })
                }

                const childScope = yield* lcmRuntime.getOrCreateChildConversation({
                  sessionID: childSession.id,
                  parentSessionID: ctx.sessionID,
                  capabilityClass: "map_child",
                  source: "lcm_map",
                  ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
                  mapID: itemInput.mapID,
                  mapItemID: `item_${itemInput.itemIndex}`,
                })

                const slot = yield* lcmRuntime.acquireChildSessionSlot({
                  sessionID: childSession.id,
                  rootConversationID: childScope.rootConversationID,
                  projectID: childScope.projectID,
                  ...(childScope.workspaceID ? { workspaceID: childScope.workspaceID } : {}),
                  capabilityClass: "map_child",
                })

                const cancel = () => ops.cancel(childSession.id)
                itemInput.abortSignal?.addEventListener("abort", cancel, { once: true })
                try {
                  const parts = yield* ops.resolvePromptParts(itemInput.prompt)
                  const result = yield* ops.prompt({
                    messageID: MessageID.ascending(),
                    sessionID: childSession.id,
                    model: {
                      providerID: ProviderID.make(itemInput.modelSelection.providerID),
                      modelID: ModelID.make(itemInput.modelSelection.modelID),
                    },
                    agent: caller.name,
                    tools:
                      itemInput.mode === "read_only"
                        ? Object.fromEntries(READ_ONLY_DENIED_TOOLS.map((tool) => [tool, false]))
                        : undefined,
                    parts,
                  })
                  return {
                    text: result.parts.findLast((item) => item.type === "text")?.text ?? "",
                  }
                } finally {
                  itemInput.abortSignal?.removeEventListener("abort", cancel)
                  yield* slot.release
                }
              }),
            )

          const result = yield* runtimeMap({
            ...(params as AgenticMapInput),
            sessionID: ctx.sessionID,
            abortSignal: ctx.abort,
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
            ...(model?.providerID ? { providerID: model.providerID } : {}),
            ...(model?.id ? { modelID: model.id } : model?.api?.id ? { modelID: model.api.id } : {}),
            childRunner,
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
            title: "Agentic Map",
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
    }
  }),
)
