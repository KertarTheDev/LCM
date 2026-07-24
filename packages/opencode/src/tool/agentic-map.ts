// kilocode_change - new file
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Option, Schema } from "effect"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { lcmProviderCapacityInputFromModel, lcmProviderCapacityLane } from "../session/lcm/provider-capacity"
import { ModelID, ProviderID } from "../session/lcm/provider-ids"
import { Session } from "../session/session"
import { MessageID } from "../session/schema"
import { LCM_MAP_TOOL_DESCRIPTIONS, type AgenticMapChildRunner } from "../session/lcm/map"
import type { AgenticMapInput, LcmMapResult, LcmToolErrorResult } from "../session/lcm/types"
import { canonicalJson } from "../session/lcm/validators"
import { assertExternalDirectoryEffect } from "./external-directory"
import { lcmToolWrapperError } from "./lcm-tool-error"
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

const READ_ONLY_DENIED_TOOLS = ["edit", "write", "apply_patch", "multiedit", "bash", "task", "todowrite"] as const

export const AGENTIC_MAP_OUTPUT_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      output: {
        description: "The final JSON value for this map item.",
      },
    },
    required: ["output"],
  },
  retryCount: 0,
} as const

export const AGENTIC_MAP_FINALIZER_SYSTEM_INSTRUCTION = [
  "This is an agentic map item. Use authorized tools as needed before finalizing.",
  'When the item is complete, call StructuredOutput exactly once with the final schema-conforming JSON value in the "output" property.',
  "Do not emit the final result as assistant prose unless the provider cannot submit the StructuredOutput call.",
].join("\n")

export function agenticMapChildPromptBoundary(request: { readonly system: string; readonly user: string }) {
  return {
    user: request.user,
    system: [request.system, AGENTIC_MAP_FINALIZER_SYSTEM_INSTRUCTION].join("\n\n"),
    format: AGENTIC_MAP_OUTPUT_FORMAT,
  }
}

export class AgenticMapChildOutputError extends Error {
  override readonly name = "AgenticMapChildOutputError"

  constructor(readonly diagnosticCode: string) {
    super(diagnosticCode)
  }
}

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

function visibleChildText(result: SessionV1.WithParts) {
  return result.parts.findLast(
    (item) => item.type === "text" && !item.ignored && !item.synthetic && item.text.trim().length > 0,
  )?.text
}

function structuredOutputError(error: unknown) {
  return SessionV1.StructuredOutputError.isInstance(error)
}

export function agenticMapChildOutput(result: SessionV1.WithParts) {
  if (result.info.role !== "assistant") {
    throw new AgenticMapChildOutputError("lcm_map_item_child_result_invalid")
  }

  if (result.info.finish === "length") {
    throw new AgenticMapChildOutputError("lcm_map_item_child_output_length")
  }
  if (result.info.error && !structuredOutputError(result.info.error)) throw result.info.error
  if (!result.info.finish || result.info.finish === "unknown" || result.info.finish === "error") {
    throw new AgenticMapChildOutputError("lcm_map_item_child_finish_unknown")
  }

  const fallback = result.info.finish === "stop" ? visibleChildText(result) : undefined
  if (result.info.structured !== undefined) {
    const structured = result.info.structured
    const validEnvelope =
      typeof structured === "object" &&
      structured !== null &&
      !Array.isArray(structured) &&
      Object.hasOwn(structured, "output") &&
      Object.keys(structured).every((key) => key === "output") &&
      (structured as { output?: unknown }).output !== undefined
    if (!validEnvelope) {
      if (fallback) return { text: fallback }
      throw new AgenticMapChildOutputError("lcm_map_item_output_wrapper_invalid")
    }
    return { text: canonicalJson((structured as { output: unknown }).output) }
  }

  if (fallback) return { text: fallback }
  throw new AgenticMapChildOutputError("lcm_map_item_structured_output_missing")
}

export const AgenticMapTool = Tool.define(
  "agentic_map",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service

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
                const childModel = yield* provider.getModel(
                  ProviderID.make(itemInput.modelSelection.providerID),
                  ModelID.make(itemInput.modelSelection.modelID),
                )
                const providerInfo = yield* provider
                  .getProvider(childModel.providerID)
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
                const capacityLane = lcmProviderCapacityLane(
                  lcmProviderCapacityInputFromModel({
                    model: childModel,
                    priority: "background",
                    ...(providerInfo ? { provider: providerInfo } : {}),
                  }),
                )
                const localProviderCapacityKey =
                  capacityLane.capacityClass === "remote_or_unknown" ? undefined : capacityLane.key
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
                  ...(localProviderCapacityKey ? { localProviderCapacityKey } : {}),
                })

                const cancel = () => ops.cancel(childSession.id)
                itemInput.abortSignal?.addEventListener("abort", cancel, { once: true })
                try {
                  const boundary = agenticMapChildPromptBoundary(itemInput.request)
                  const parts = yield* ops.resolvePromptParts(boundary.user)
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
                    system: boundary.system,
                    format: boundary.format,
                  })
                  return agenticMapChildOutput(result)
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
            lastUpdatedAtMs: result.lastUpdatedAtMs,
            effectiveWorkers: result.effectiveWorkers,
            retryAfterMs: result.retryAfterMs,
          }
        : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
      truncated: false,
    },
    output: JSON.stringify(result, null, 2),
  }
}
