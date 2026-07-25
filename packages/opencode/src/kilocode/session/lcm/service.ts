import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import * as Log from "@opencode-ai/core/util/log"
import * as Database from "@/storage/db"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { EffectBridge } from "@/effect/bridge"
import { LLMResponse } from "@opencode-ai/llm"
import { extractFinalSources } from "./transcript-source"
import { lineageDigest, sortableID } from "./ids"
import { Projector } from "./projector"
import { SqliteConversationMemoryStore } from "./store"
import { SummaryTree } from "./summary-tree"
import type {
  ActivityRecord,
  ConversationMemoryStore,
  FinalSource,
  MemoryState,
  ProjectionResult,
  TranscriptLineage,
} from "./types"
import type { ModelMessage } from "ai"
import type { SummaryGenerator } from "./summary-tree"
import type { Provider as ProviderType } from "@/provider/provider"
import { normalizeModelInput } from "./context-frame"

const log = Log.create({ service: "lcm" })
const DEFAULT_PROTECTED_TURNS = 2
const SUMMARY_PROMPT = `Summarize the supplied earlier conversation for a coding agent that must continue the same session.

Preserve binding state over narrative:
- the user's current goal and changes to it;
- requirements, constraints, acceptance criteria, and preferences;
- decisions, rejected approaches, and the evidence behind them;
- exact paths, identifiers, versions, commands, decisive errors, and numeric limits;
- completed work, verification results, remaining work, and unresolved questions.

Do not invent facts. Keep the stable src_ and sum_ handles next to the facts they support so omitted detail can be
recovered with Conversation Memory tools. Return only the summary text.`

export interface HostProjectionInput {
  sessionID: string
  transcript: SessionV1.WithParts[]
  messages: ModelMessage[]
  system: string[]
  tools: Record<string, unknown>
  usableInputTokens: number
  thresholdRatio: number
  protectedTailTurns?: number
  requestID?: string
  continuationID?: string
  measure(messages: ModelMessage[]): number
  model: ProviderType.Model
  signal?: AbortSignal
}

export interface EnsureReadyInput {
  sessionID: string
  transcript: SessionV1.WithParts[]
  usableInputTokens: number
  model: ProviderType.Model
  protectedTailTurns?: number
  signal?: AbortSignal
}

interface Synced {
  store: ConversationMemoryStore
  lineage: TranscriptLineage
  sources: FinalSource[]
  content: Map<string, string>
  protectedSources: number
}

export interface Interface {
  readonly project: (input: HostProjectionInput) => Effect.Effect<ProjectionResult>
  readonly ensureReady: (input: EnsureReadyInput) => Effect.Effect<boolean>
  readonly inspect: (sessionID: string) => Effect.Effect<MemoryState>
  readonly activity: (sessionID: string, input?: { before?: number; limit?: number }) => Effect.Effect<ActivityRecord[]>
  readonly capture: (input: {
    sessionID: string
    requestID?: string
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, unknown>
    rawTokens: number
    usableInputTokens: number
  }) => Effect.Effect<void>
  readonly index: (input: {
    sessionID: string
    transcript: SessionV1.WithParts[]
    protectedTailTurns?: number
    signal?: AbortSignal
  }) => Effect.Effect<{ store: ConversationMemoryStore; lineage: TranscriptLineage } | undefined>
  readonly access: (
    sessionID: string,
  ) => Effect.Effect<{ store: ConversationMemoryStore; state: MemoryState } | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ConversationMemory") {}

function countProtectedSources(input: { transcript: SessionV1.WithParts[]; sources: FinalSource[]; turns: number }) {
  if (input.turns <= 0) return 0
  const sourceMessages = new Set(input.sources.map((source) => source.messageID))
  const users = input.transcript.filter(
    (message) => message.info.role === "user" && sourceMessages.has(message.info.id),
  )
  const cutoff = users.at(-input.turns)
  if (!cutoff) return input.sources.length
  const order = new Map<string, number>(input.transcript.map((message, index) => [message.info.id, index]))
  const cutoffIndex = order.get(cutoff.info.id) ?? Number.POSITIVE_INFINITY
  return input.sources.filter((source) => (order.get(source.messageID) ?? -1) >= cutoffIndex).length
}

export const layer: Layer.Layer<Service, never, Agent.Service | Provider.Service | LLM.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const bridge = yield* EffectBridge.make()
    let store: SqliteConversationMemoryStore | undefined
    let projector: Projector | undefined
    const background = new Map<string, Promise<void>>()

    const close = () => {
      store?.close()
      store = undefined
      projector = undefined
    }
    yield* Effect.addFinalizer(() => Effect.sync(close))

    const open = () => {
      if (store) return store
      store = SqliteConversationMemoryStore.open({ databasePath: Database.getPath() })
      projector = new Projector(store)
      return store
    }

    const sync = async (input: {
      sessionID: string
      transcript: SessionV1.WithParts[]
      protectedTailTurns: number
      signal?: AbortSignal
    }): Promise<Synced> => {
      if (input.signal?.aborted)
        throw input.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
      const extracted = extractFinalSources(input.sessionID, input.transcript)
      const sources = extracted.map((item) => item.metadata)
      const lineage: TranscriptLineage = {
        sessionID: input.sessionID,
        digest: lineageDigest(sources),
        sourceCount: sources.length,
        ...(sources.at(-1) ? { lastSourceID: sources.at(-1)!.id } : {}),
      }
      const target = open()
      const state = await target.inspect(input.sessionID)
      if (state.lineageDigest !== lineage.digest || state.sourceCount !== sources.length) {
        await target.replaceSources({ sessionID: input.sessionID, lineage, sources })
      }
      return {
        store: target,
        lineage,
        sources,
        content: new Map(extracted.map((item) => [item.metadata.id, item.content])),
        protectedSources: countProtectedSources({
          transcript: input.transcript,
          sources,
          turns: input.protectedTailTurns,
        }),
      }
    }

    const build = async (
      synced: Synced,
      input: {
        usableInputTokens: number
        reason: "background" | "hard_built"
        model: ProviderType.Model
        signal?: AbortSignal
      },
    ) => {
      if (input.usableInputTokens <= 0) return
      const generator: SummaryGenerator = {
        generate: (request) =>
          bridge.promise(
            Effect.gen(function* () {
              const configured = yield* agents.get("compaction")
              const agent: Agent.Info =
                configured ??
                ({
                  name: "compaction",
                  mode: "subagent",
                  hidden: true,
                  options: {},
                  permission: [],
                } satisfies Agent.Info)
              const model = agent.model
                ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
                : input.model
              const info = yield* provider.getProvider(model.providerID)
              const user: SessionV1.User = {
                id: MessageID.ascending(),
                sessionID: request.sessionID as SessionID,
                role: "user",
                time: { created: Date.now() },
                agent: agent.name,
                model: { providerID: model.providerID, modelID: model.id },
              }
              const body = request.children
                .map((child) =>
                  "text" in child
                    ? `${child.id}:\n${child.text}`
                    : `${child.id}:\n${synced.content.get(child.id) ?? child.excerpt}`,
                )
                .join("\n\n")
              const started = Date.now()
              const events = Array.from(
                yield* llm
                  .stream({
                    agent: {
                      ...agent,
                      prompt: SUMMARY_PROMPT,
                      options: { ...agent.options, maxOutputTokens: request.targetTokens },
                    },
                    user,
                    tools: {},
                    model,
                    messages: [
                      {
                        role: "user",
                        content: `Target at most ${request.targetTokens} tokens.\n\n${body}`,
                      },
                    ],
                    sessionID: `lcm-summary:${request.sessionID}`,
                    system: [],
                    retries: 1,
                  })
                  .pipe(Stream.runCollect),
              )
              const usage = LLMResponse.usage({ events })
              const billed = usage
                ? Session.getUsage({ model, usage, metadata: usage.providerMetadata, provider: info })
                : undefined
              const finish = events.findLast((event) => event.type === "finish")
              return {
                text: LLMResponse.text({ events }),
                mode: request.mode,
                attempt: {
                  id: sortableID("attempt"),
                  nodeKey: "",
                  sessionID: request.sessionID,
                  providerID: model.providerID,
                  modelID: model.id,
                  variant: agent.variant,
                  mode: request.mode,
                  inputTokens: billed?.tokens.input ?? 0,
                  outputTokens: billed?.tokens.output ?? 0,
                  reasoningTokens: billed?.tokens.reasoning ?? 0,
                  cacheReadTokens: billed?.tokens.cache.read ?? 0,
                  cacheWriteTokens: billed?.tokens.cache.write ?? 0,
                  cost: billed?.cost ?? 0,
                  finish: finish?.reason,
                  durationMs: Date.now() - started,
                  createdAt: started,
                },
              }
            }),
          ),
      }
      return new SummaryTree(synced.store, generator).build({
        sessionID: synced.lineage.sessionID,
        lineage: synced.lineage,
        usableInputTokens: input.usableInputTokens,
        protectedSources: synced.protectedSources,
        reason: input.reason,
        signal: input.signal,
      })
    }

    const schedule = (synced: Synced, usableInputTokens: number, model: ProviderType.Model) => {
      if (background.has(synced.lineage.sessionID)) return
      const job = build(synced, { usableInputTokens, reason: "background", model })
        .then(async (revision) => {
          if (!revision) return
          await synced.store.appendActivity({
            id: sortableID("activity"),
            sessionID: synced.lineage.sessionID,
            kind: "frontier_advanced",
            summaryIDs: revision.items.filter((item) => item.kind === "summary").map((item) => item.id),
            message: "Conversation Memory prepared an earlier-history summary.",
            createdAt: Date.now(),
          })
        })
        .catch((error) => {
          log.warn("background summary unavailable", {
            code: error instanceof Error ? error.name : "unknown",
          })
        })
        .finally(() => background.delete(synced.lineage.sessionID))
      background.set(synced.lineage.sessionID, job)
    }

    const projectUnsafe: (input: HostProjectionInput) => Effect.Effect<ProjectionResult> = Effect.fn(
      "ConversationMemory.projectUnsafe",
    )(function* (input) {
      const pressure = input.usableInputTokens > 0 ? input.measure(input.messages) / input.usableInputTokens : 0
      if (input.usableInputTokens <= 0 || pressure < input.thresholdRatio)
        return { type: "unchanged", messages: input.messages, pressure } satisfies ProjectionResult
      const protectedTailTurns = input.protectedTailTurns ?? DEFAULT_PROTECTED_TURNS
      const synced = yield* Effect.promise(() =>
        sync({
          sessionID: input.sessionID,
          transcript: input.transcript,
          protectedTailTurns,
          signal: input.signal,
        }),
      )
      const hard = pressure >= 1
      let revision = yield* Effect.promise(() => synced.store.activeRevision(input.sessionID, synced.lineage.digest))
      if (!revision && hard) {
        revision = yield* Effect.promise(() =>
          build(synced, {
            usableInputTokens: input.usableInputTokens,
            reason: "hard_built",
            model: input.model,
            signal: input.signal,
          }),
        )
      } else if (!revision) {
        schedule(synced, input.usableInputTokens, input.model)
        return { type: "unchanged", messages: input.messages, pressure } satisfies ProjectionResult
      }
      if (!revision) return { type: "unchanged", messages: input.messages, pressure } satisfies ProjectionResult
      const result = yield* Effect.promise(() =>
        projector!.project({
          sessionID: input.sessionID,
          lineage: synced.lineage,
          system: input.system,
          messages: input.messages,
          tools: input.tools,
          usableInputTokens: input.usableInputTokens,
          thresholdRatio: input.thresholdRatio,
          protectedTailTurns,
          requestID: input.requestID,
          continuationID: input.continuationID,
          reason: hard ? "hard" : "soft",
          measure: input.measure,
          signal: input.signal,
        }),
      )
      if (result.type !== "projected") return result
      yield* Effect.promise(async () => {
        const createdAt = Date.now()
        await Promise.allSettled([
          synced.store.appendActivity({
            id: sortableID("activity"),
            sessionID: input.sessionID,
            kind: "intervention",
            pressureBefore: result.pressureBefore,
            pressureAfter: result.pressureAfter,
            rawTokens: result.rawTokens,
            summaryTokens: result.summaryTokens,
            summaryIDs: result.revision.items.filter((item) => item.kind === "summary").map((item) => item.id),
            message: "Conversation Memory represented earlier conversation with summaries.",
            createdAt,
          }),
          synced.store.recordFrame({
            id: sortableID("frame"),
            sessionID: input.sessionID,
            requestID: input.requestID,
            revisionID: result.revision.id,
            lineageDigest: synced.lineage.digest,
            active: true,
            reason: hard ? (result.revision.reason === "hard_built" ? "hard_built" : "hard_ready") : "soft_ready",
            pre: normalizeModelInput({ system: input.system, messages: input.messages, tools: input.tools }),
            post: normalizeModelInput({ system: input.system, messages: result.messages, tools: input.tools }),
            pressureBefore: result.pressureBefore,
            pressureAfter: result.pressureAfter,
            rawTokens: result.rawTokens,
            summaryTokens: result.summaryTokens,
            createdAt,
          }),
        ])
      })
      return result
    })

    const project: Interface["project"] = (input) =>
      projectUnsafe(input).pipe(
        Effect.catchCause((cause) => {
          log.warn("projection unavailable; using upstream context", {
            code: Cause.hasInterruptsOnly(cause) ? "cancelled" : "unavailable",
          })
          const pressure = input.usableInputTokens > 0 ? input.measure(input.messages) / input.usableInputTokens : 0
          return Effect.succeed({
            type: "unavailable",
            messages: input.messages,
            pressure,
            code: Cause.hasInterruptsOnly(cause) ? "lcm_cancelled" : "lcm_unavailable",
          } satisfies ProjectionResult)
        }),
      )

    const ensureReadyUnsafe: (input: EnsureReadyInput) => Effect.Effect<boolean> = Effect.fn(
      "ConversationMemory.ensureReadyUnsafe",
    )(function* (input) {
      const protectedTailTurns = input.protectedTailTurns ?? DEFAULT_PROTECTED_TURNS
      const synced = yield* Effect.promise(() =>
        sync({
          sessionID: input.sessionID,
          transcript: input.transcript,
          protectedTailTurns,
          signal: input.signal,
        }),
      )
      const existing = yield* Effect.promise(() => synced.store.activeRevision(input.sessionID, synced.lineage.digest))
      if (existing) return true
      const revision = yield* Effect.promise(() =>
        build(synced, {
          usableInputTokens: input.usableInputTokens,
          reason: "hard_built",
          model: input.model,
          signal: input.signal,
        }),
      )
      return revision !== undefined
    })

    const ensureReady: Interface["ensureReady"] = (input) =>
      ensureReadyUnsafe(input).pipe(
        Effect.catchCause((cause) => {
          log.warn("hard preparation unavailable; using upstream compaction", {
            code: Cause.hasInterruptsOnly(cause) ? "cancelled" : "unavailable",
          })
          return Effect.succeed(false)
        }),
      )

    const inspect: Interface["inspect"] = (sessionID) =>
      Effect.try({
        try: () => open(),
        catch: () => undefined,
      }).pipe(
        Effect.flatMap((target) =>
          target
            ? Effect.promise(() => target.inspect(sessionID))
            : Effect.succeed({
                sessionID,
                sourceCount: 0,
                pendingSources: 0,
                state: "raw" as const,
                health: "degraded" as const,
                issue: {
                  code: "lcm_unavailable",
                  message: "Conversation Memory is temporarily unavailable; normal Kilo context behavior is active.",
                  since: Date.now(),
                  lastAt: Date.now(),
                },
              }),
        ),
        Effect.catch(() =>
          Effect.succeed({
            sessionID,
            sourceCount: 0,
            pendingSources: 0,
            state: "raw" as const,
            health: "degraded" as const,
          }),
        ),
      )

    const activity: Interface["activity"] = (sessionID, input) =>
      Effect.tryPromise(() => open().listActivity(sessionID, input)).pipe(Effect.catch(() => Effect.succeed([])))

    const capture: Interface["capture"] = (input) =>
      Effect.tryPromise(() => {
        const pressure = input.usableInputTokens > 0 ? input.rawTokens / input.usableInputTokens : 0
        const normalized = normalizeModelInput(input)
        return open().recordFrame({
          id: sortableID("frame"),
          sessionID: input.sessionID,
          requestID: input.requestID,
          lineageDigest: "",
          active: true,
          reason: "latest",
          pre: normalized,
          post: normalized,
          pressureBefore: pressure,
          pressureAfter: pressure,
          rawTokens: input.rawTokens,
          summaryTokens: 0,
          createdAt: Date.now(),
        })
      }).pipe(Effect.catch(() => Effect.void))

    const index: Interface["index"] = (input) =>
      Effect.tryPromise(() =>
        sync({
          sessionID: input.sessionID,
          transcript: input.transcript,
          protectedTailTurns: input.protectedTailTurns ?? DEFAULT_PROTECTED_TURNS,
          signal: input.signal,
        }),
      ).pipe(
        Effect.map((synced) => ({ store: synced.store, lineage: synced.lineage })),
        Effect.catch(() => Effect.succeed(undefined)),
      )

    const access: Interface["access"] = (sessionID) =>
      Effect.tryPromise(async () => {
        const target = open()
        return { store: target, state: await target.inspect(sessionID) }
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    return Service.of({ project, ensureReady, inspect, activity, capture, index, access })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  layer.pipe(Layer.provide(Agent.defaultLayer), Layer.provide(Provider.defaultLayer), Layer.provide(LLM.defaultLayer)),
)
export const node = LayerNode.make(layer, [Agent.node, Provider.node, LLM.node])

export * as ConversationMemory from "./service"
