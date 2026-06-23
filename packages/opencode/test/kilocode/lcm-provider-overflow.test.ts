// Regressions for provider context overflow in the LCM prompt path.
// LCM-active sessions must retry through LCM preflight and fail closed without
// enqueueing legacy lossy compaction turns.

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Env } from "../../src/env"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { KiloSession } from "../../src/kilocode/session"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
import { Session } from "../../src/session/session"
import { Instruction } from "../../src/session/instruction"
import {
  LCM_BLOCKING_MAINTENANCE_LABEL,
  LCM_PREFLIGHT_ASSEMBLY_LABEL,
  LCM_PREFLIGHT_STORAGE_LABEL,
  LCM_PREFLIGHT_SYNC_LABEL,
} from "../../src/session/lcm/events"
import { lcmProviderOverflowRecoveryInputLimit } from "../../src/session/lcm/model-limits"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

// Pass-through plugin mock. Lets every plugin trigger proceed with its default output.
const plugin = Layer.mock(Plugin.Service)({
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in LCM provider-overflow tests"),
    authenticate: () => Effect.die("unexpected MCP auth in LCM provider-overflow tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in LCM provider-overflow tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const runState = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    BackgroundJob.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    plugin,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
    Reference.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(LcmRuntime.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(runState),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provideMerge(question),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        summary,
        deps,
        Config.defaultLayer,
        RuntimeFlags.layer(),
        BackgroundJob.defaultLayer,
        Bus.layer,
        infra,
        Storage.defaultLayer,
        Reference.defaultLayer,
      ),
    ),
  )
}

const it = testEffect(makeHttp())

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const overflowBody = { type: "error", error: { code: "context_length_exceeded" } }

describe("LCM provider overflow retry", () => {
  test("classifies provider overflow as LCM retry or fail-closed safe error", () => {
    const retry = SessionPrompt.resolveLcmProviderOverflowResult({
      lifecycleState: "lcm_active",
      retryAttempt: 0,
      conversationID: "conv_provider_overflow",
      threshold: { activeTokens: 120_000, hardLimit: 100_000 },
    })
    expect(retry).toMatchObject({
      action: "retry",
      nextAttempt: 1,
      providerOverflowRecovery: { attempt: 1 },
    })

    const exhausted = SessionPrompt.resolveLcmProviderOverflowResult({
      lifecycleState: "lcm_active",
      retryAttempt: 2,
      conversationID: "conv_provider_overflow",
      threshold: { activeTokens: 120_000, hardLimit: 100_000 },
    })
    expect(exhausted).toMatchObject({
      action: "fail",
      safeError: {
        code: "hard_limit_unresolved",
        diagnosticCode: "lcm_prompt_provider_overflow_after_lcm_retry_exhausted",
        retryable: false,
        safeParams: {
          conversationID: "conv_provider_overflow",
          beforeTokens: 120_000,
          hardLimit: 100_000,
          action: "start_new_thread",
        },
      },
    })

    const inactive = SessionPrompt.resolveLcmProviderOverflowResult({
      lifecycleState: "recovery_required",
      retryAttempt: 0,
    })
    expect(inactive).toMatchObject({
      action: "fail",
      safeError: {
        diagnosticCode: "lcm_prompt_provider_overflow_without_active_lcm_rejected",
      },
    })
  })

  test("tightens provider input limit on later LCM overflow recovery retries", () => {
    const modelLimits = { context: 100_000, input: 90_000, output: 10_000 }
    const first = lcmProviderOverflowRecoveryInputLimit({
      modelLimits,
      recovery: { attempt: 1 },
    })
    const second = lcmProviderOverflowRecoveryInputLimit({
      modelLimits,
      recovery: { attempt: 2 },
    })

    expect(typeof first).toBe("number")
    expect(typeof second).toBe("number")
    if (typeof first !== "number" || typeof second !== "number") return
    expect(first).toBeLessThan(modelLimits.input)
    expect(second).toBeLessThan(first)
    expect(second).toBeGreaterThan(0)
  })

  it.live(
    "fails closed without legacy compaction after the LCM overflow retries are exhausted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const chat = yield* sessions.create({
            title: "Compaction cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.error(400, overflowBody)
          yield* llm.error(400, overflowBody)
          yield* llm.error(400, overflowBody)

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id)
              Deferred.doneUnsafe(turnClose, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "please overflow" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(turnClose).pipe(Effect.timeout("2 seconds"))
          unsub()
          expect(yield* llm.calls).toBe(3)
          expect(reason).toBe("error")
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("error")
          expect(result.info.error).toMatchObject({
            name: "LcmMemoryError",
            data: {
              code: "hard_limit_unresolved",
              action: "start_new_thread",
              diagnosticCode: "lcm_prompt_provider_overflow_after_lcm_retry_exhausted",
            },
          })
          expect(
            Array.from(MessageV2.stream(chat.id)).some((msg) => msg.parts.some((p) => p.type === "compaction")),
          ).toBe(false)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "recovers when the LCM overflow retry fits without legacy compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const chat = yield* sessions.create({
            title: "Compaction under cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.error(400, overflowBody)
          yield* llm.text("final answer")

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const statusEvents: SessionStatus.Info[] = []
          const unsubStatus = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
            if (evt.properties.sessionID === chat.id) statusEvents.push(evt.properties.status)
          })
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id)
              Deferred.doneUnsafe(turnClose, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "overflow once" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(turnClose).pipe(Effect.timeout("2 seconds"))
          unsub()
          unsubStatus()

          expect(yield* llm.calls).toBe(2)
          expect(reason).toBe("completed")
          expect(
            statusEvents.some((event) => event.type === "busy" && event.message === LCM_BLOCKING_MAINTENANCE_LABEL),
          ).toBe(true)
          expect(
            statusEvents.some((event) => event.type === "busy" && event.message === LCM_PREFLIGHT_STORAGE_LABEL),
          ).toBe(true)
          expect(
            statusEvents.some((event) => event.type === "busy" && event.message === LCM_PREFLIGHT_SYNC_LABEL),
          ).toBe(true)
          expect(
            statusEvents.some((event) => event.type === "busy" && event.message === LCM_PREFLIGHT_ASSEMBLY_LABEL),
          ).toBe(true)
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("stop")
          expect(result.info.error).toBeUndefined()
          expect(result.parts.some((p) => p.type === "text" && p.text === "final answer")).toBe(true)
          expect(
            Array.from(MessageV2.stream(chat.id)).some((msg) => msg.parts.some((p) => p.type === "compaction")),
          ).toBe(false)
        }),
        { git: true, config: providerCfg },
      ),
    15_000,
  )

  it.live(
    "recovers when the second LCM overflow retry fits without legacy compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const chat = yield* sessions.create({
            title: "Compaction second retry under cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.error(400, overflowBody)
          yield* llm.error(400, overflowBody)
          yield* llm.text("final answer after second retry")

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id)
              Deferred.doneUnsafe(turnClose, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "overflow twice" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(turnClose).pipe(Effect.timeout("2 seconds"))
          unsub()

          expect(yield* llm.calls).toBe(3)
          expect(reason).toBe("completed")
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("stop")
          expect(result.info.error).toBeUndefined()
          expect(result.parts.some((p) => p.type === "text" && p.text === "final answer after second retry")).toBe(true)
          expect(
            Array.from(MessageV2.stream(chat.id)).some((msg) => msg.parts.some((p) => p.type === "compaction")),
          ).toBe(false)
        }),
        { git: true, config: providerCfg },
      ),
    20_000,
  )
})

function makeAssistantStub(sessionID: string): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: SessionID.make(sessionID),
    parentID: MessageID.ascending(),
    mode: "code",
    agent: "code",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
}

describe("KiloSessionPrompt.guardCompactionAttempt", () => {
  it.effect("returns { exhausted: false } and does not mutate state below the cap", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const msg = makeAssistantStub("ses_under")
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_under",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS - 1,
        closeReasons,
        message: msg,
      })
      expect(result.exhausted).toBe(false)
      expect(closeReasons.has("ses_under")).toBe(false)
      expect(msg.error).toBeUndefined()
      expect(msg.finish).toBeUndefined()
    }),
  )

  it.effect("sets close reason and attaches error once attempts reach the cap", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const msg = makeAssistantStub("ses_cap")
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_cap",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
        closeReasons,
        message: msg,
      })
      expect(result.exhausted).toBe(true)
      if (!result.exhausted) return
      expect(closeReasons.get("ses_cap")).toBe("error")
      expect(msg.error?.name).toBe("ContextOverflowError")
      if (msg.error?.name !== "ContextOverflowError") return
      expect(msg.error.data.message).toContain("Compaction exhausted")
      expect(msg.finish).toBe("error")
      expect(result.error.name).toBe("ContextOverflowError")
    }),
  )

  it.effect("works without a message and still sets the close reason", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_no_msg",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
        closeReasons,
      })
      expect(result.exhausted).toBe(true)
      expect(closeReasons.get("ses_no_msg")).toBe("error")
    }),
  )
})
