import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { ModelMessage } from "ai"
import { Effect, Option } from "effect"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { usable } from "@/session/overflow"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { ConversationMemory } from "./service"
import { DEFAULT_SOFT_THRESHOLD_RATIO } from "./types"

type Tools = Record<string, { description?: string; inputSchema?: unknown }>

interface OverflowRetry {
  readonly requestTokens: number
  readonly revisionID: string
  readonly lineageDigest: string
}

export interface TurnState {
  overflowRetry?: OverflowRetry
}

export interface PreparedRequest {
  readonly mode: "upstream" | "external"
  readonly messages: ModelMessage[]
  readonly requestTokens: number
  readonly usableInputTokens: number
  readonly thresholdRatio: number
  readonly recentTailTokens: number
  readonly error?: string
  readonly complete: (success: boolean) => Effect.Effect<void>
}

export function turnState(): TurnState {
  return {}
}

export function resetWhenDisabled(state: TurnState) {
  state.overflowRetry = undefined
}

/**
 * Adapts LCM's derived frontier to the fully transformed upstream request. The
 * shared prompt loop remains responsible for tools, provider calls, queueing,
 * settlement, and the ordinary compact result.
 */
export const prepare = Effect.fn("ConversationMemoryPromptHost.prepare")(function* (input: {
  enabled: boolean
  state: TurnState
  memory: ConversationMemory.Interface
  sessionID: string
  requestID: string
  transcript: SessionV1.WithParts[]
  sourceMessages: SessionV1.WithParts[]
  messages: ModelMessage[]
  finalStepMessages: ModelMessage[]
  system: string[]
  tools: Tools
  config: Config.Info
  model: Provider.Model
  outputTokenMax?: number
  convert: (messages: SessionV1.WithParts[]) => Effect.Effect<ModelMessage[]>
}) {
  if (!input.enabled) {
    resetWhenDisabled(input.state)
    return {
      mode: "upstream",
      messages: input.messages,
      requestTokens: 0,
      usableInputTokens: 0,
      thresholdRatio: 0,
      recentTailTokens: 0,
      complete: () => Effect.void,
    } satisfies PreparedRequest
  }

  let completed = false
  const complete = (success: boolean) => {
    if (completed) return Effect.void
    completed = true
    return input.memory.completeRequest({ sessionID: input.sessionID, requestID: input.requestID, success })
  }

  const measure = (messages: ModelMessage[]) =>
    KiloSessionOverflow.measure({
      messages: [{ role: "system" as const, content: input.system.join("\n") }, ...messages],
      tools: input.tools,
    }).normalized
  const usableInputTokens = usable({
    cfg: input.config,
    model: input.model,
    outputTokenMax: input.outputTokenMax,
  })
  const thresholdRatio =
    typeof input.config.conversation_memory?.soft_threshold_percent === "number"
      ? input.config.conversation_memory.soft_threshold_percent / 100
      : DEFAULT_SOFT_THRESHOLD_RATIO
  const recentTailTokens = ConversationMemory.recentTailTokens({
    usableInputTokens,
    configured: input.config.compaction?.preserve_recent_tokens,
  })
  const requestTokens = measure(input.messages)
  const fixedInputTokens = measure([])
  const indexed = yield* input.memory.index({
    sessionID: input.sessionID,
    transcript: input.transcript,
    recentTailTokens,
  })
  const rawLaneTokens = indexed
    ? indexed.eligibleRawTokens + indexed.protectedRawTokens
    : Math.max(0, requestTokens - fixedInputTokens)

  let protectedMessages = input.messages
  if (indexed && !indexed.firstProtectedMessageID) {
    protectedMessages = input.finalStepMessages
  } else if (indexed?.firstProtectedMessageID) {
    const protectedIndex = input.sourceMessages.findIndex(
      (message) => message.info.id === indexed.firstProtectedMessageID,
    )
    if (protectedIndex >= 0) {
      const converted = Option.getOrUndefined(
        yield* input.convert(input.sourceMessages.slice(protectedIndex)).pipe(Effect.option),
      )
      if (converted) {
        const expected = [...converted, ...input.finalStepMessages]
        const start = input.messages.length - expected.length
        if (start >= 0 && JSON.stringify(input.messages.slice(start)) === JSON.stringify(expected)) {
          protectedMessages = input.messages.slice(start)
        }
      }
    }
  }

  yield* input.memory.capture({
    sessionID: input.sessionID,
    requestID: input.requestID,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    rawTokens: requestTokens,
    rawLaneTokens,
    fixedInputTokens,
    recentTailTokens,
    usableInputTokens,
    thresholdRatio,
  })
  const projection = yield* input.memory.project({
    sessionID: input.sessionID,
    transcript: input.transcript,
    messages: input.messages,
    system: input.system,
    tools: input.tools,
    usableInputTokens,
    thresholdRatio,
    recentTailTokens,
    protectedMessages,
    requestID: input.requestID,
    continuationID: input.requestID,
    reason: input.state.overflowRetry ? "hard" : "soft",
    measure,
    model: input.model,
  })

  const base = {
    mode: "external" as const,
    messages: projection.messages,
    requestTokens: measure(projection.messages),
    usableInputTokens,
    thresholdRatio,
    recentTailTokens,
    complete,
  }
  if (usableInputTokens > 0 && requestTokens >= usableInputTokens && projection.type !== "projected") {
    yield* complete(false)
    return {
      ...base,
      error:
        "lcm_hard_limit_unresolved: Conversation Memory could not reduce the eligible history enough for this provider request.",
    } satisfies PreparedRequest
  }

  const retry = input.state.overflowRetry
  if (retry) {
    const retryTokens = measure(projection.messages)
    const verified =
      projection.type === "projected" &&
      projection.revision.id === retry.revisionID &&
      projection.revision.lineageDigest === retry.lineageDigest &&
      retryTokens < retry.requestTokens
    if (!verified) {
      yield* complete(false)
      return {
        ...base,
        error:
          "lcm_hard_limit_unresolved: Conversation Memory could not produce a verified smaller request after the provider rejected the original request.",
      } satisfies PreparedRequest
    }
  }
  return base satisfies PreparedRequest
})

export type OverflowRecovery = { readonly type: "retry" } | { readonly type: "error"; readonly message: string }

export const recoverOverflow = Effect.fn("ConversationMemoryPromptHost.recoverOverflow")(function* (input: {
  state: TurnState
  prepared: PreparedRequest
  memory: ConversationMemory.Interface
  sessionID: string
  model: Provider.Model
}) {
  yield* input.prepared.complete(false)
  if (input.state.overflowRetry) {
    return {
      type: "error",
      message:
        "lcm_hard_limit_unresolved: The provider rejected the verified smaller request after stricter Conversation Memory maintenance.",
    } satisfies OverflowRecovery
  }

  const maintenance = yield* input.memory.maintain({
    sessionID: input.sessionID,
    model: input.model,
    usableInputTokens: input.prepared.usableInputTokens,
    thresholdRatio: input.prepared.thresholdRatio,
    recentTailTokens: input.prepared.recentTailTokens,
    reason: "hard",
    strict: true,
  })
  if (
    maintenance.outcome === "capacity_unknown" ||
    maintenance.outcome === "unresolved" ||
    !maintenance.changed ||
    maintenance.afterTokens >= maintenance.beforeTokens ||
    !maintenance.revisionID ||
    !maintenance.lineageDigest
  ) {
    return {
      type: "error",
      message:
        maintenance.outcome === "capacity_unknown"
          ? "lcm_capacity_unknown: Conversation Memory cannot recover this request until the selected model has context and output token limits."
          : maintenance.outcome === "unresolved"
            ? "lcm_hard_limit_unresolved: Conversation Memory could not complete stricter maintenance after the provider rejected the request."
            : "lcm_hard_limit_unresolved: Conversation Memory found no smaller active frontier after the provider rejected the request.",
    } satisfies OverflowRecovery
  }

  input.state.overflowRetry = {
    requestTokens: input.prepared.requestTokens,
    revisionID: maintenance.revisionID,
    lineageDigest: maintenance.lineageDigest,
  }
  return { type: "retry" } satisfies OverflowRecovery
})
