import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Image } from "../../src/image/image"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session/session"
import { Instruction } from "../../src/session/instruction"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import type {
  ConversationID,
  LcmLaneDecision,
  LcmMaintenanceResult,
  LcmRenderInputManifestV1,
  LcmSoftMaintenanceAfterTurnInput,
  LcmSyncResult,
  LcmThresholdDecision,
  OperationID,
} from "../../src/session/lcm/types"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { ProviderTest } from "../fake/provider"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  agent: {
    build: {
      model: "test/test-model",
    },
  },
}

type TestState = {
  preflightCalls: number
  processResults: string[]
  queueCalls: LcmSoftMaintenanceAfterTurnInput[]
  lifecycleEvents: string[]
  queueObserved: ReturnType<typeof defer<void>>
  syncedAssistantCompletedAt: Map<string, number | null>
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function lane(input: { lane: LcmLaneDecision["lane"]; tokens?: number; itemCount?: number }): LcmLaneDecision {
  return {
    lane: input.lane,
    tokens: input.tokens ?? 0,
    itemCount: input.itemCount ?? 0,
    targetTokens: 80_000,
    overTarget: false,
    eligibleItemCount: input.itemCount ?? 0,
    nextAction: "none",
  }
}

function threshold(conversationID: ConversationID, overSoft: boolean): LcmThresholdDecision {
  return {
    conversationID,
    strategy: "upward",
    activeTokens: overSoft ? 42_000 : 12_000,
    hardLimit: 80_000,
    softThreshold: 24_000,
    freshTailTokens: 20_000,
    softBacklogTokens: overSoft ? 30_000 : 0,
    softBacklogItemCount: overSoft ? 3 : 0,
    freshTailRawTokens: 4_000,
    freshTailRawItemCount: 1,
    unconsumedRawTokens: 0,
    unconsumedRawItemCount: 0,
    protectedTailRawTokens: 4_000,
    protectedTailRawItemCount: 1,
    rawLaneTokens: overSoft ? 34_000 : 4_000,
    outputReserve: 8_000,
    systemPromptTokens: 1_000,
    toolSchemaTokens: 1_000,
    providerContextLimit: 100_000,
    providerOutputLimit: 10_000,
    hardFillRatio: overSoft ? 42_000 / 80_000 : 12_000 / 80_000,
    rawLaneRatio: overSoft ? 34_000 / 24_000 : 4_000 / 24_000,
    softBacklogRatio: overSoft ? 30_000 / 24_000 : 0,
    tokenCounterMode: "fake",
    tokenCounterVersion: "lcm-soft-maintenance-prompt-test",
    overSoft,
    overHard: false,
    lanes: {
      rawLeaves: lane({ lane: "raw_leaves", tokens: overSoft ? 34_000 : 4_000, itemCount: overSoft ? 4 : 1 }),
      sprigs: lane({ lane: "sprigs" }),
      bindles: lane({ lane: "bindles" }),
      archiveStubs: lane({ lane: "archive_stubs" }),
      largeFileMarkers: lane({ lane: "large_file_markers" }),
      retrievalCues: lane({ lane: "retrieval_cues" }),
    },
  }
}

function renderInputManifest(): LcmRenderInputManifestV1 {
  return {
    version: 1,
    rendererVersion: "test",
    renderPreparationVersion: "test",
    sourceSelectionHash: "source",
    requestSnapshotProtectionHash: "protection",
    renderUnitOrderHash: "order",
    effectivePlacementHash: "placement",
    protectedSpanHash: "protected",
    providerTransformHash: "transform",
    providerValidatorHash: "validator",
    assemblyValidatorHash: "assembly",
    systemPromptVersion: "test",
    systemPromptHash: "system",
    toolSchemaVersion: "test",
    toolSchemaHash: "tools",
    pluginTransformVersion: "test",
    pluginTransformHash: "plugin",
    dynamicPromptVersion: "test",
    dynamicPromptHash: "dynamic",
    messageVisibilityVersion: "test",
    messageVisibilityHash: "visibility",
    providerMediaCapability: "text_only",
    stripMedia: true,
    providerID: ref.providerID,
    modelID: ref.modelID,
    providerModelRevision: "2025-01-01",
    agentName: "build",
    taskCapabilityClass: "root",
    clockPolicy: "runtime_per_preparation",
  }
}

function syncResult(sessionID: string, conversationID: ConversationID): LcmSyncResult {
  return {
    sessionID,
    conversationID,
    insertedMessages: 0,
    insertedParts: 0,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: true,
    lifecycleState: "lcm_active",
  }
}

function maintenanceResult(conversationID: ConversationID): LcmMaintenanceResult {
  return {
    conversationID,
    operationID: "op_soft_prompt_test" as OperationID,
    workNeeded: true,
    workPerformed: false,
    blocking: false,
    reason: "soft_threshold",
    summariesCreated: 0,
    contextItemsReplaced: 0,
    status: "scheduled",
  }
}

function runtimeLayer(state: TestState) {
  const conversationID = "conv_soft_prompt_test" as ConversationID
  const service: Partial<LcmRuntime.Interface> = {
    getCapabilities: (input) =>
      Effect.succeed({
        sessionID: input.sessionID,
        conversationID,
        lifecycleState: "lcm_active",
        strategy: "upward",
        dbReady: true,
        lcmActive: true,
        canAssemble: true,
        canMaintain: true,
        canRetrieve: true,
      }),
    getOrCreateConversation: () => Effect.succeed(conversationID),
    getConversationScope: (input) =>
      Effect.succeed({
        sessionID: input.sessionID,
        conversationID,
        lifecycleState: "lcm_active" as const,
        capabilityClass: "root" as const,
        capabilityProven: true,
        directContentToolsAllowed: false,
        projectID: "project_soft_prompt_test",
        rootConversationID: conversationID,
        ancestorConversationIDs: [],
        allowedConversationIDs: [conversationID],
        boundaryMetadata: {
          version: 1,
          projectID: "project_soft_prompt_test",
          platformPathFlavor: "posix",
          caseSensitivity: "sensitive",
          sessionDirectoryOriginal: "/tmp/lcm-soft-prompt-test",
          sessionDirectoryCanonical: "/tmp/lcm-soft-prompt-test",
          allowedRootOriginals: ["/tmp/lcm-soft-prompt-test"],
          allowedRootCanonicals: ["/tmp/lcm-soft-prompt-test"],
          kiloPermissionContext: {
            source: "session",
          },
        },
        sourceCoverageCounts: {
          messages: 0,
          parts: 0,
          summaries: 0,
          contextItems: 0,
          largeFiles: 0,
          usageRecords: 0,
          mapRuns: 0,
          mapItems: 0,
        },
      }),
    syncFinalizedMessages: (input) =>
      Effect.gen(function* () {
        if (!input.upToMessageID) return syncResult(input.sessionID, conversationID)
        const message = yield* MessageV2.get({
          sessionID: SessionID.make(input.sessionID),
          messageID: MessageID.make(input.upToMessageID),
        }).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
        if (message?.info.role === "assistant") {
          const completedAt = message.info.time.completed ?? null
          const previous = state.syncedAssistantCompletedAt.get(message.info.id)
          if (previous !== undefined && previous !== completedAt) {
            return yield* Effect.die(new Error("lcm_source_drift_message_completed_at"))
          }
          state.syncedAssistantCompletedAt.set(message.info.id, completedAt)
        }
        return syncResult(input.sessionID, conversationID)
      }),
    preflightBeforeModel: (input) =>
      Effect.sync(() => {
        state.preflightCalls++
        const overSoft = state.preflightCalls === 1
        const manifest = input.renderOptions.renderInputManifest ?? renderInputManifest()
        return {
          sessionID: input.sessionID,
          conversationID,
          lifecycleState: "lcm_active" as const,
          canProceed: true as const,
          threshold: threshold(conversationID, overSoft),
          assembly: {
            conversationID,
            lifecycleState: "lcm_active" as const,
            ok: true as const,
            contextItems: [],
            modelMessages: [] as any,
            renderedSpans: [],
            activeTokens: overSoft ? 42_000 : 12_000,
            providerRequestSnapshotID: `snapshot-${state.preflightCalls}`,
            preparedProviderPayload: {
              operationID: `op_soft_prompt_preflight_${state.preflightCalls}` as OperationID,
              conversationID,
              providerRequestSnapshotID: `snapshot-${state.preflightCalls}`,
              providerID: ref.providerID,
              modelID: ref.modelID,
              systemPromptHash: manifest.systemPromptHash,
              toolSchemaHash: manifest.toolSchemaHash,
              modelMessages: [] as any,
              renderInputManifest: manifest,
              renderedSpans: [],
              assemblyValidatorHash: manifest.assemblyValidatorHash,
              system: [],
              tools: {},
              format: { type: "text" as const },
            },
          },
        }
      }),
    queueSoftMaintenanceAfterTurn: (input) =>
      Effect.promise(async () => {
        const queueIndex = state.queueCalls.length + 1
        state.queueCalls.push(input)
        state.lifecycleEvents.push(`maintenance-${queueIndex}-start`)
        state.queueObserved.resolve()
        await Bun.sleep(25)
        state.lifecycleEvents.push(`maintenance-${queueIndex}-end`)
        return maintenanceResult(conversationID)
      }),
    finalizeProviderRequestSnapshot: () => Effect.void,
    recordProviderRequestSnapshotFinalValidation: () => Effect.void,
    close: () => Effect.void,
  }
  return Layer.succeed(LcmRuntime.Service, LcmRuntime.Service.of(service as LcmRuntime.Interface))
}

function processorLayer(state: TestState) {
  return Layer.effect(
    SessionProcessor.Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      return SessionProcessor.Service.of({
        create: (input) =>
          Effect.succeed({
            get message() {
              return input.assistantMessage
            },
            updateToolCall: () => Effect.succeed(undefined),
            metadata: () => Effect.void,
            completeToolCall: () => Effect.void,
            process: () =>
              Effect.gen(function* () {
                const firstStep = state.processResults.length === 0
                state.lifecycleEvents.push(`process-${state.processResults.length + 1}`)
                input.assistantMessage.finish = firstStep ? "tool-calls" : "stop"
                yield* sessions.updateMessage(input.assistantMessage)
                if (input.lcmMaintenanceCheckpoint) {
                  yield* input.lcmMaintenanceCheckpoint({
                    kind: firstStep ? "tool_result" : "step_finish",
                    sessionID: input.sessionID,
                    assistantMessageID: input.assistantMessage.id,
                    ...(firstStep ? { toolCallID: "call_soft_prompt_test" } : {}),
                  })
                }
                input.assistantMessage.time.completed = Date.now()
                yield* sessions.updateMessage(input.assistantMessage)
                state.processResults.push(input.assistantMessage.finish)
                return firstStep ? "continue" : "stop"
              }),
          }),
      })
    }),
  )
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const plugin = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    trigger: (_name, _input, output) => Effect.succeed(output),
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  }),
)

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
    startAuth: () => Effect.die("unexpected MCP auth in LCM soft-maintenance prompt test"),
    authenticate: () => Effect.die("unexpected MCP auth in LCM soft-maintenance prompt test"),
    finishAuth: () => Effect.die("unexpected MCP auth in LCM soft-maintenance prompt test"),
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

const llm = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () => Stream.empty,
  }),
)

const registry = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    ids: () => Effect.succeed([]),
    all: () => Effect.succeed([]),
    named: () => Effect.die("unexpected named tool lookup in LCM soft-maintenance prompt test"),
    tools: () => Effect.succeed([]),
  } as unknown as ToolRegistry.Interface),
)

const truncate = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: () => Effect.void,
    write: () => Effect.succeed(""),
    output: (text) => Effect.succeed({ content: text, truncated: false }),
    limits: () => Effect.succeed({ maxLines: 2_000, maxBytes: 50 * 1024 }),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const runState = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeLayer(state: TestState) {
  const model = ProviderTest.model({ providerID: ref.providerID, id: ref.modelID })
  const provider = ProviderTest.fake({ model })
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Question.defaultLayer,
    plugin,
    Config.defaultLayer,
    Image.defaultLayer,
    Reference.defaultLayer,
    provider.layer,
    EventV2Bridge.defaultLayer,
    RuntimeFlags.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
    llm,
    BackgroundJob.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const processor = processorLayer(state).pipe(Layer.provideMerge(deps))
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(runtimeLayer(state)),
    Layer.provide(summary),
    Layer.provideMerge(runState),
    Layer.provideMerge(processor),
    Layer.provideMerge(registry),
    Layer.provideMerge(truncate),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provideMerge(deps),
  )
}

const state: TestState = {
  preflightCalls: 0,
  processResults: [],
  queueCalls: [],
  lifecycleEvents: [],
  queueObserved: defer<void>(),
  syncedAssistantCompletedAt: new Map(),
}

const it = testEffect(makeLayer(state))

it.live("queues soft maintenance checks after finalized model steps", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        state.preflightCalls = 0
        state.processResults = []
        state.queueCalls = []
        state.lifecycleEvents = []
        state.queueObserved = defer<void>()
        state.syncedAssistantCompletedAt = new Map()

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "LCM soft maintenance prompt scheduling" })

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: ref.providerID, modelID: ref.modelID },
          parts: [{ type: "text", text: "continue once, then stop" }],
        })

        expect(result.info.role).toBe("assistant")
        yield* Effect.promise(() =>
          Promise.race([
            state.queueObserved.promise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("soft maintenance was not queued after continued step")), 1_000),
            ),
          ]),
        )
        yield* Effect.promise(async () => {
          const deadline = Date.now() + 1_000
          while (state.queueCalls.length < 2 && Date.now() < deadline) {
            await Bun.sleep(10)
          }
        })

        expect(state.processResults).toEqual(["tool-calls", "stop"])
        expect(state.lifecycleEvents).toEqual([
          "process-1",
          "maintenance-1-start",
          "maintenance-1-end",
          "process-2",
          "maintenance-2-start",
          "maintenance-2-end",
        ])
        expect(state.preflightCalls).toBe(2)
        expect(state.queueCalls).toHaveLength(2)
        const messages = yield* sessions.messages({ sessionID: session.id })
        const users = messages.filter((message) => message.info.role === "user")
        expect(users).toHaveLength(1)
        const protectedCurrentUser = {
          sourceSessionID: session.id,
          sourceMessageID: users[0]!.info.id,
        }
        expect(state.queueCalls[0]).toMatchObject({
          sessionID: session.id,
          providerID: ref.providerID,
          modelID: ref.modelID,
          protectedCurrentUser,
          recordNoOpAttempt: false,
        })
        expect(state.queueCalls[1]).toMatchObject({
          sessionID: session.id,
          providerID: ref.providerID,
          modelID: ref.modelID,
          protectedCurrentUser,
          recordNoOpAttempt: false,
        })

        const assistants = messages.filter((message) => message.info.role === "assistant")
        expect(assistants.map((message) => message.info.role === "assistant" && message.info.finish)).toEqual([
          "tool-calls",
          "stop",
        ])
      }),
    { git: true, config: cfg },
  ),
)
