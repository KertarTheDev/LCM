// kilocode_change - new file
import path from "node:path"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  Provider.defaultLayer,
  ToolRegistry.defaultLayer,
  RuntimeFlags.layer(),
  LcmRuntime.defaultLayer,
)

const it = testEffect(layer)

const seed = Effect.fn("TaskToolLcmTest.seed")(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "LCM task parent" })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

const promptOps: TaskPromptOps = {
  cancel: () => Effect.void,
  resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
  prompt: (input) => Effect.succeed(reply(input, "lcm done")),
}

describe("tool.task LCM integration", () => {
  it.live("recovers from unavailable provider model lookup before child slot acquisition", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const previous = process.env.KILO_LCM_TEST_DATA_DIR
        process.env.KILO_LCM_TEST_DATA_DIR = path.join(dir, "kilo-data")
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
            else process.env.KILO_LCM_TEST_DATA_DIR = previous
          }),
        )

        const runtime = yield* LcmRuntime.Service
        const { chat, assistant } = yield* seed()
        yield* runtime.getOrCreateConversation({ sessionID: chat.id })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const childCapabilities = yield* runtime.getCapabilities({ sessionID: result.metadata.sessionId })
        expect(result.output).toContain("lcm done")
        expect(childCapabilities.lifecycleState).toBe("lcm_active")
        expect(childCapabilities.dbReady).toBe(true)
        expect(childCapabilities.canRetrieve).toBe(true)
      }),
    ),
  )
})
