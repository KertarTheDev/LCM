import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Cause, Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import * as Log from "@opencode-ai/core/util/log"
import * as StorageDatabase from "@/storage/db"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { MessageID, SessionID } from "@/session/schema"
import { EffectBridge } from "@/effect/bridge"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LLMResponse } from "@opencode-ai/llm"
import { extractFinalSources } from "./transcript-source"
import { lineageDigest, sortableID } from "./ids"
import { Projector } from "./projector"
import { SqliteConversationMemoryStore } from "./store"
import { rollForwardItems, SummaryTree } from "./summary-tree"
import type {
  ActivityRecord,
  ConversationMemoryStore,
  FinalSource,
  LcmStatus,
  MemoryState,
  ProjectionResult,
  TranscriptLineage,
} from "./types"
import type { ModelMessage } from "ai"
import type { SummaryGenerator } from "./summary-tree"
import type { Provider as ProviderType } from "@/provider/provider"
import { normalizeModelInput } from "./context-frame"
import { Event as LcmEvent } from "./events"

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
  readonly status: (sessionID: string) => Effect.Effect<LcmStatus>
  readonly capture: (input: {
    sessionID: string
    requestID?: string
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, unknown>
    rawTokens: number
    usableInputTokens: number
    thresholdRatio: number
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

export const layer: Layer.Layer<
  Service,
  never,
  Agent.Service | Provider.Service | LLM.Service | EventV2Bridge.Service | CoreDatabase.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* CoreDatabase.Service
    const bridge = yield* EffectBridge.make()
    let store: SqliteConversationMemoryStore | undefined
    let projector: Projector | undefined
    const background = new Map<string, Promise<void>>()
    const rebuildRecorded = new Set<string>()
    const shutdown = new AbortController()
    let modelQueue: Promise<void> = Promise.resolve()
    let readStatus: Interface["status"] | undefined

    const abortable = <T>(promise: Promise<T>, signal: AbortSignal) => {
      if (signal.aborted)
        return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
      return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
        signal.addEventListener("abort", aborted, { once: true })
        promise.then(
          (value) => {
            signal.removeEventListener("abort", aborted)
            resolve(value)
          },
          (error) => {
            signal.removeEventListener("abort", aborted)
            reject(error)
          },
        )
      })
    }

    const serialized = <T>(run: () => Promise<T>, signal: AbortSignal) => {
      const start = () => {
        if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
        return run()
      }
      const result = modelQueue.then(start, start)
      modelQueue = result.then(
        () => undefined,
        () => undefined,
      )
      return abortable(result, signal)
    }

    const close = () => {
      store?.close()
      store = undefined
      projector = undefined
    }
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        shutdown.abort(new DOMException("Conversation Memory is shutting down", "AbortError"))
        await Promise.allSettled(background.values())
        close()
      }),
    )

    const open = () => {
      if (store) return store
      store = SqliteConversationMemoryStore.open({ databasePath: StorageDatabase.getPath() })
      projector = new Projector(store)
      return store
    }

    yield* events.subscribe(SessionV1.Event.Deleted).pipe(
      Stream.runForEach((event) =>
        Effect.tryPromise(() => open().deleteSession(event.data.sessionID)).pipe(Effect.catch(() => Effect.void)),
      ),
      Effect.forkScoped,
    )

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
        const previousSources = state.lineageDigest ? await target.listSources(input.sessionID) : []
        const previousRevision = state.lineageDigest
          ? await target.activeRevision(input.sessionID, state.lineageDigest)
          : undefined
        const items = previousRevision
          ? rollForwardItems({ revision: previousRevision, previousSources, sources })
          : undefined
        await target.replaceSources({ sessionID: input.sessionID, lineage, sources })
        if (items) {
          await target.commitRevision({
            id: sortableID("rev"),
            sessionID: input.sessionID,
            lineageDigest: lineage.digest,
            reason: "append",
            items,
            createdAt: Date.now(),
          })
        }
      }
      if (target.recovered && !rebuildRecorded.has(input.sessionID)) {
        rebuildRecorded.add(input.sessionID)
        const activity = await target.appendActivity({
          id: sortableID("activity"),
          sessionID: input.sessionID,
          kind: "rebuild",
          message: "Conversation Memory rebuilt its derived cache from the retained Kilo conversation.",
          createdAt: Date.now(),
        })
        await bridge
          .promise(events.publish(LcmEvent.Activity, { sessionID: input.sessionID as SessionID, activity }))
          .catch(() => undefined)
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

    // Index terminal persisted state after the session becomes idle. This is
    // metadata-only work: paid summary generation still begins only when a
    // request reaches the effective pressure threshold.
    yield* events.subscribe(SessionStatus.Event.Idle).pipe(
      Stream.runForEach((event) =>
        MessageV2.stream(event.data.sessionID).pipe(
          Effect.provideService(CoreDatabase.Service, database),
          Effect.flatMap((transcript) =>
            Effect.promise(() =>
              sync({
                sessionID: event.data.sessionID,
                transcript,
                protectedTailTurns: DEFAULT_PROTECTED_TURNS,
              }),
            ),
          ),
          Effect.flatMap(() =>
            readStatus
              ? readStatus(event.data.sessionID).pipe(
                  Effect.flatMap((current) =>
                    events.publish(LcmEvent.Status, { sessionID: event.data.sessionID, status: current }),
                  ),
                )
              : Effect.void,
          ),
          Effect.catch(() =>
            Effect.sync(() =>
              log.warn("finalized conversation indexing unavailable", {
                code: "lcm_unavailable",
              }),
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    )

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
      const timeout = AbortSignal.timeout(input.reason === "background" ? 180_000 : 60_000)
      const signal = AbortSignal.any(
        [input.signal, timeout, shutdown.signal].filter((item): item is AbortSignal => item !== undefined),
      )
      const owner = sortableID("lease")
      const key = `summary:${synced.lineage.sessionID}`
      const acquired = await synced.store.acquireLease({
        key,
        owner,
        now: Date.now(),
        expiresAt: Date.now() + (input.reason === "background" ? 190_000 : 70_000),
      })
      if (!acquired) return synced.store.activeRevision(synced.lineage.sessionID, synced.lineage.digest)
      const generator: SummaryGenerator = {
        generate: (request) => {
          const started = Date.now()
          return serialized(
            () =>
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
                            content: [
                              `Target at most ${request.targetTokens} tokens.`,
                              request.mode === "aggressive"
                                ? "Compress more aggressively while retaining binding decisions, constraints, and recovery handles."
                                : "Prefer a concise but complete account of binding state.",
                              "",
                              body,
                            ].join("\n"),
                          },
                        ],
                        sessionID: `lcm-summary:${request.sessionID}`,
                        system: [],
                        retries: 1,
                      })
                      .pipe(
                        Stream.runCollect,
                        Effect.raceFirst(
                          Effect.callback<never, unknown>((resume) => {
                            const aborted = () =>
                              resume(
                                Effect.fail(
                                  signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
                                ),
                              )
                            if (signal.aborted) {
                              aborted()
                              return
                            }
                            signal.addEventListener("abort", aborted, { once: true })
                            return Effect.sync(() => signal.removeEventListener("abort", aborted))
                          }),
                        ),
                      ),
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
            signal,
          ).catch((error) => {
            if (signal.aborted) throw error
            return {
              text: "",
              mode: request.mode,
              attempt: {
                id: sortableID("attempt"),
                nodeKey: "",
                sessionID: request.sessionID,
                mode: request.mode,
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                cost: 0,
                errorCode: error instanceof Error ? error.name : "lcm_summary_unavailable",
                durationMs: Date.now() - started,
                createdAt: started,
              },
            }
          })
        },
      }
      try {
        const revision = await new SummaryTree(synced.store, generator).build({
          sessionID: synced.lineage.sessionID,
          lineage: synced.lineage,
          usableInputTokens: input.usableInputTokens,
          protectedSources: synced.protectedSources,
          reason: input.reason,
          signal,
        })
        if (revision) await synced.store.setIssue(synced.lineage.sessionID)
        return revision
      } finally {
        await synced.store.releaseLease({ key, owner })
      }
    }

    const recordFallback = async (sessionID: string, code: string) => {
      const target = open()
      const previous = await target.inspect(sessionID)
      if (!previous.lineageDigest) return
      const now = Date.now()
      const recent = previous.issue?.code === code && now - previous.issue.lastAt < 5_000
      await target.setIssue(sessionID, {
        code,
        message: "Conversation Memory is temporarily unavailable; normal Kilo context behavior is active.",
        since: previous.issue?.code === code ? previous.issue.since : now,
        lastAt: now,
      })
      if (recent) return
      return target.appendActivity({
        id: sortableID("activity"),
        sessionID,
        kind: "fallback",
        message: "Conversation Memory used normal Kilo context behavior for this request.",
        createdAt: now,
      })
    }

    const publishFallback = async (sessionID: string, code: string) => {
      const activity = await recordFallback(sessionID, code).catch(() => undefined)
      if (activity) {
        await bridge
          .promise(events.publish(LcmEvent.Activity, { sessionID: sessionID as SessionID, activity }))
          .catch(() => undefined)
      }
    }
    const schedule = (synced: Synced, usableInputTokens: number, model: ProviderType.Model) => {
      if (background.has(synced.lineage.sessionID)) return
      const job = build(synced, { usableInputTokens, reason: "background", model, signal: shutdown.signal })
        .then(async (revision) => {
          if (!revision) return
          const activity = await synced.store.appendActivity({
            id: sortableID("activity"),
            sessionID: synced.lineage.sessionID,
            kind: "frontier_advanced",
            summaryIDs: revision.items.filter((item) => item.kind === "summary").map((item) => item.id),
            message: "Conversation Memory prepared an earlier-history summary.",
            createdAt: Date.now(),
          })
          await bridge
            .promise(
              events.publish(LcmEvent.Activity, {
                sessionID: synced.lineage.sessionID as SessionID,
                activity,
              }),
            )
            .catch(() => undefined)
        })
        .catch(async (error) => {
          if (
            shutdown.signal.aborted ||
            error instanceof DOMException ||
            (error instanceof Error && error.message === "lcm_stale_lineage")
          )
            return
          log.warn("background summary unavailable", {
            code: error instanceof Error ? error.name : "unknown",
          })
          await publishFallback(synced.lineage.sessionID, "lcm_summary_unavailable")
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
      if (revision?.reason === "append") schedule(synced, input.usableInputTokens, input.model)
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
          sourceContent: synced.content,
          requestID: input.requestID,
          continuationID: input.continuationID,
          reason: hard ? "hard" : "soft",
          measure: input.measure,
          signal: input.signal,
        }),
      )
      if (result.type !== "projected") return result
      const activity = yield* Effect.promise(async () => {
        const createdAt = Date.now()
        const [written, frame] = await Promise.allSettled([
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
            usableInputTokens: input.usableInputTokens,
            thresholdRatio: input.thresholdRatio,
            rawTokens: result.rawTokens,
            summaryTokens: result.summaryTokens,
            createdAt,
          }),
        ])
        if (written.status === "rejected" || frame.status === "rejected") {
          log.warn("context audit capture unavailable", { code: "lcm_audit_gap" })
          const now = Date.now()
          await synced.store
            .setIssue(input.sessionID, {
              code: "lcm_audit_gap",
              message: "Conversation Memory continued, but the local context export may be incomplete.",
              since: now,
              lastAt: now,
            })
            .catch(() => undefined)
        } else {
          await synced.store.setIssue(input.sessionID).catch(() => undefined)
        }
        return written.status === "fulfilled" ? written.value : undefined
      })
      if (activity) {
        yield* events
          .publish(LcmEvent.Activity, { sessionID: input.sessionID as SessionID, activity })
          .pipe(Effect.catch(() => Effect.void))
      }
      yield* status(input.sessionID).pipe(
        Effect.flatMap((current) =>
          events.publish(LcmEvent.Status, { sessionID: input.sessionID as SessionID, status: current }),
        ),
        Effect.catch(() => Effect.void),
      )
      return result
    })

    const project: Interface["project"] = (input) =>
      projectUnsafe(input).pipe(
        Effect.catchCause((cause) => {
          const cancelled = Cause.hasInterruptsOnly(cause) || input.signal?.aborted
          log.warn("projection unavailable; using upstream context", {
            code: cancelled ? "cancelled" : "unavailable",
          })
          const pressure = input.usableInputTokens > 0 ? input.measure(input.messages) / input.usableInputTokens : 0
          return Effect.gen(function* () {
            if (!cancelled) {
              yield* Effect.promise(() => publishFallback(input.sessionID, "lcm_unavailable")).pipe(
                Effect.catch(() => Effect.void),
              )
              if (readStatus)
                yield* readStatus(input.sessionID).pipe(
                  Effect.flatMap((current) =>
                    events.publish(LcmEvent.Status, { sessionID: input.sessionID as SessionID, status: current }),
                  ),
                  Effect.catch(() => Effect.void),
                )
            }
            return {
              type: "unavailable",
              messages: input.messages,
              pressure,
              code: cancelled ? "lcm_cancelled" : "lcm_unavailable",
            } satisfies ProjectionResult
          })
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
          const cancelled = Cause.hasInterruptsOnly(cause) || input.signal?.aborted
          log.warn("hard preparation unavailable; using upstream compaction", {
            code: cancelled ? "cancelled" : "unavailable",
          })
          if (cancelled) return Effect.succeed(false)
          return Effect.promise(() => publishFallback(input.sessionID, "lcm_unavailable")).pipe(
            Effect.catch(() => Effect.void),
            Effect.as(false),
          )
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

    const emptyWork = {
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    }

    const status: Interface["status"] = (sessionID) =>
      Effect.tryPromise(async () => {
        const target = open()
        const [state, frames, metrics, activities] = await Promise.all([
          target.inspect(sessionID),
          target.listFrames(sessionID),
          target.metrics(sessionID),
          target.listActivity(sessionID, { limit: 100 }),
        ])
        const frame = frames.findLast((item) => item.active) ?? frames.at(-1)
        const revision = state.lineageDigest ? await target.activeRevision(sessionID, state.lineageDigest) : undefined
        let rawItems = revision?.items.filter((item) => item.kind === "source").length ?? state.sourceCount
        let summaryItems = revision?.items.filter((item) => item.kind === "summary").length ?? 0
        let rawTokens = 0
        let summaryTokens = 0
        if (revision) {
          for (const item of revision.items) {
            if (item.kind === "source") rawTokens += (await target.getSource(sessionID, item.id))?.tokens ?? 0
            else summaryTokens += (await target.getSummary(sessionID, item.id))?.tokens ?? 0
          }
        } else {
          const sources = await target.listSources(sessionID)
          rawTokens = sources.reduce((total, item) => total + item.tokens, 0)
          rawItems = sources.length
          summaryItems = 0
        }
        if (frame) summaryTokens = frame.summaryTokens || summaryTokens
        const usableInputTokens = frame?.usableInputTokens
        const activeInputTokens =
          frame && usableInputTokens !== undefined
            ? Math.round((frame.pressureAfter ?? frame.pressureBefore ?? 0) * usableInputTokens)
            : undefined
        const lastInterventionAt = activities.find((item) => item.kind === "intervention")?.createdAt
        return {
          sessionID,
          sequence: metrics.sequence,
          mode: state.state,
          health: state.health,
          capacity: {
            known: frame !== undefined,
            ...(frame
              ? {
                  usableInputTokens: frame.usableInputTokens,
                  rawInputTokens: frame.rawTokens,
                  activeInputTokens,
                  freeTokens:
                    activeInputTokens === undefined
                      ? undefined
                      : Math.max(0, frame.usableInputTokens - activeInputTokens),
                  pressureRatio: frame.pressureAfter ?? frame.pressureBefore,
                  thresholdRatio: frame.thresholdRatio,
                }
              : {}),
          },
          composition: {
            ...(revision ? { revisionID: revision.id } : {}),
            rawTokens,
            summaryTokens,
            rawItems,
            summaryItems,
          },
          background: {
            pendingSources: state.pendingSources,
            summarizing: background.has(sessionID),
          },
          memoryWork: metrics.work,
          ...(lastInterventionAt ? { lastInterventionAt } : {}),
          ...(state.issue ? { issue: state.issue } : {}),
        } satisfies LcmStatus
      }).pipe(
        Effect.catch(() =>
          Effect.succeed({
            sessionID,
            sequence: 0,
            mode: "raw" as const,
            health: "degraded" as const,
            capacity: { known: false },
            composition: { rawTokens: 0, summaryTokens: 0, rawItems: 0, summaryItems: 0 },
            background: { pendingSources: 0, summarizing: false },
            memoryWork: emptyWork,
            issue: {
              code: "lcm_unavailable",
              message: "Conversation Memory is temporarily unavailable; normal Kilo context behavior is active.",
              since: Date.now(),
              lastAt: Date.now(),
            },
          }),
        ),
      )
    readStatus = status

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
          usableInputTokens: input.usableInputTokens,
          thresholdRatio: input.thresholdRatio,
          rawTokens: input.rawTokens,
          summaryTokens: 0,
          createdAt: Date.now(),
        })
      }).pipe(
        Effect.flatMap(() => status(input.sessionID)),
        Effect.flatMap((current) =>
          events.publish(LcmEvent.Status, { sessionID: input.sessionID as SessionID, status: current }),
        ),
        Effect.asVoid,
        Effect.catch(() => Effect.void),
      )

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

    return Service.of({ project, ensureReady, inspect, activity, status, capture, index, access })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(CoreDatabase.defaultLayer),
  ),
)
export const node = LayerNode.make(layer, [Agent.node, Provider.node, LLM.node, EventV2Bridge.node, CoreDatabase.node])

export * as ConversationMemory from "./service"
