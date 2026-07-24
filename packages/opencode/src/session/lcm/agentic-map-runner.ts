// kilocode_change - new file
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { Instance } from "@/kilocode/instance"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "./provider-ids"
import { canonicalJson } from "./validators"
import type { AgenticMapChildRunner } from "./map"

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

export const runAgenticMapChild: AgenticMapChildRunner = (input) =>
  Instance.provide({
    directory: input.parentDirectory,
    fn: async () => {
      const { AppRuntime } = await import("@/effect/app-runtime")
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const agents = yield* Agent.Service
          const prompts = yield* SessionPrompt.Service
          const { LcmRuntime } = yield* Effect.promise(() => import("./runtime"))
          const lcmRuntime = yield* LcmRuntime.Service
          const parentSession = yield* sessions.get(input.parentSessionID)
          const caller = yield* agents.get(input.submittingAgent)
          const title = `LCM map ${input.mapID} item ${input.itemIndex}`
          const existing = (yield* sessions.children(input.parentSessionID)).find((child) => child.title === title)
          const childPermission = [
            ...(parentSession.permission ?? []),
            ...(input.mode === "read_only"
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
              parentID: input.parentSessionID,
              title,
              permission: childPermission,
            }))
          if (existing) {
            yield* sessions.setPermission({ sessionID: childSession.id, permission: childPermission })
          }

          const childScope = yield* lcmRuntime.getOrCreateChildConversation({
            sessionID: childSession.id,
            parentSessionID: input.parentSessionID,
            capabilityClass: "map_child",
            source: "lcm_map",
            ...(input.sourceToolCallID ? { sourceToolCallID: input.sourceToolCallID } : {}),
            mapID: input.mapID,
            mapItemID: `item_${input.itemIndex}`,
          })
          const slot = yield* lcmRuntime.acquireChildSessionSlot({
            sessionID: childSession.id,
            rootConversationID: childScope.rootConversationID,
            projectID: childScope.projectID,
            ...(childScope.workspaceID ? { workspaceID: childScope.workspaceID } : {}),
            capabilityClass: "map_child",
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            onState: (phase) =>
              AppRuntime.runPromise(lcmRuntime.setMapChildProviderPhase({ sessionID: childSession.id, phase })),
          })

          const cancel = () => {
            void AppRuntime.runPromise(prompts.cancel(childSession.id)).catch(() => {})
          }
          input.abortSignal?.addEventListener("abort", cancel, { once: true })
          try {
            const boundary = agenticMapChildPromptBoundary(input.request)
            const parts = yield* prompts.resolvePromptParts(boundary.user)
            const result = yield* prompts.prompt({
              messageID: MessageID.ascending(),
              sessionID: childSession.id,
              model: {
                providerID: ProviderID.make(input.modelSelection.providerID),
                modelID: ModelID.make(input.modelSelection.modelID),
              },
              agent: caller.name,
              tools:
                input.mode === "read_only"
                  ? Object.fromEntries(READ_ONLY_DENIED_TOOLS.map((tool) => [tool, false]))
                  : undefined,
              parts,
              system: boundary.system,
              format: boundary.format,
            })
            return agenticMapChildOutput(result)
          } finally {
            input.abortSignal?.removeEventListener("abort", cancel)
            yield* slot.release
          }
        }),
      )
    },
  })
