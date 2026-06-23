// Regressions for SessionPrompt recovery from stale persisted assistant rows.

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
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
import { LcmRuntime } from "../../src/session/lcm/runtime"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
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
    startAuth: () => Effect.die("unexpected MCP auth in prompt recovery tests"),
    authenticate: () => Effect.die("unexpected MCP auth in prompt recovery tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in prompt recovery tests"),
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
const run = SessionRunState.layer.pipe(Layer.provide(status))
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
    Reference.defaultLayer,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
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
    Layer.provide(Reference.defaultLayer),
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
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(LcmRuntime.defaultLayer),
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
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
          attachment: true,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          modalities: { input: ["text" as const, "image" as const, "pdf" as const], output: ["text" as const] },
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

const user = Effect.fn("prompt-recovery.user")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "code",
    model: ref,
    time: { created: Date.now() },
    tools: {},
  } satisfies MessageV2.User)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  } satisfies MessageV2.TextPart)
  return msg
})

const dangling = Effect.fn("prompt-recovery.dangling")(function* (sessionID: SessionID, parentID: MessageID) {
  const sessions = yield* Session.Service
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  } satisfies MessageV2.Assistant)
})

describe("SessionPrompt recovery", () => {
  it.live("recovers from a dangling assistant row before replying", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Prompt tail recovery" })
        const first = yield* user(chat.id, "Before the crash")
        const stale = yield* dangling(chat.id, first.id)

        yield* llm.text("recovered")

        const result = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "Continue after the dangling assistant" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.info.id).not.toBe(stale.id)
        expect(result.parts.some((part) => part.type === "text" && part.text === "recovered")).toBe(true)
        expect(yield* llm.calls).toBe(1)

        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const empty = msgs.filter(
          (msg) => msg.info.role === "assistant" && msg.parts.length === 0 && !msg.info.finish && !msg.info.error,
        )
        expect(empty).toHaveLength(0)
        expect(msgs.some((msg) => msg.info.id === stale.id)).toBe(false)
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("recovers from persisted provider finish errors before replying", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Provider finish error recovery" })
        const first = yield* user(chat.id, "before provider finish error")
        const stale = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: first.id,
          sessionID: chat.id,
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          time: { created: Date.now() },
          finish: "error",
        } satisfies MessageV2.Assistant)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: stale.id,
          sessionID: chat.id,
          type: "step-start",
        } satisfies MessageV2.StepStartPart)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: stale.id,
          sessionID: chat.id,
          type: "step-finish",
          reason: "error",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies MessageV2.StepFinishPart)
        yield* llm.text("recovered")

        const result = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "code",
          parts: [{ type: "text", text: "continue after provider finish error" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.info.id).not.toBe(stale.id)
        expect(result.parts.some((part) => part.type === "text" && part.text === "recovered")).toBe(true)
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        expect(msgs.some((msg) => msg.info.id === stale.id)).toBe(false)
      }),
      { git: true, config: providerCfg },
    ),
  )
})
