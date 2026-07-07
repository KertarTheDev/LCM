// kilocode_change - new file
import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import * as Instance from "../../src/kilocode/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import * as SessionModule from "../../src/session/session"
import { Instruction } from "../../src/session/instruction"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { LcmContext, type LcmRawLeafRenderPreparationInput } from "../../src/session/lcm/context"
import { resolveLcmDbLayout, resolveLcmFamilyRoot } from "../../src/session/lcm/db-layout"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionSummary } from "../../src/session/summary"
import { SystemPrompt } from "../../src/session/system"
import { LcmDb } from "../../src/session/lcm/db"
import {
  LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_BLOCKING_MAINTENANCE_LABEL,
  LCM_PREFLIGHT_BUDGET_LABEL,
  LCM_PREFLIGHT_REBUILD_LABEL,
  LCM_PREFLIGHT_RETRIEVAL_LABEL,
  LCM_PREFLIGHT_STORAGE_LABEL,
  LCM_PREFLIGHT_SYNC_LABEL,
} from "../../src/session/lcm/events"
import { deriveLcmFamilyID } from "../../src/session/lcm/family"
import { createLcmPGlite } from "../../src/session/lcm/pglite-assets"
import { LcmRuntime, lcmShouldRetrySoftMaintenance } from "../../src/session/lcm/runtime"
import { upsertDeferredSoftMaintenanceJob } from "../../src/session/lcm/deferred-jobs"
import { ProviderTest } from "../fake/provider"
import { createLcmSafeError } from "../../src/session/lcm/types"
import type {
  ConversationID,
  LcmLaneDecision,
  LcmMaintenanceResult,
  LcmThresholdDecision,
  LcmValidatedModelMessages,
  OperationID,
} from "../../src/session/lcm/types"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { tmpdir } from "../fixture/fixture"

function runSession<A, E>(effect: Effect.Effect<A, E, SessionModule.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionModule.defaultLayer)))
}

const Session = {
  ...SessionModule,
  create(input?: Parameters<SessionModule.Interface["create"]>[0]) {
    return runSession(SessionModule.Service.use((session) => session.create(input)))
  },
  updateMessage<T extends Parameters<SessionModule.Interface["updateMessage"]>[0]>(message: T) {
    return runSession(SessionModule.Service.use((session) => session.updateMessage(message)))
  },
  updatePart<T extends Parameters<SessionModule.Interface["updatePart"]>[0]>(part: T) {
    return runSession(SessionModule.Service.use((session) => session.updatePart(part)))
  },
}

function configLayer(config: Config.Info, localConfig: Config.Info = config) {
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed(config),
      getLocal: () => Effect.succeed(localConfig),
      getGlobal: () => Effect.succeed(config),
      getConsoleState: () =>
        Effect.succeed({
          consoleManagedProviders: [],
          switchableOrgCount: 0,
        }),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({ info: config, changed: false }),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
      warnings: () => Effect.succeed([]),
    }),
  )
}

function runtimeLayer(config: Config.Info, localConfig?: Config.Info) {
  return LcmRuntime.layer.pipe(Layer.provide(LcmDb.defaultLayer), Layer.provide(configLayer(config, localConfig)))
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

function testRenderPreparation(input: {
  session: SessionModule.Info
  lastUserMessageID: MessageID
}): LcmRawLeafRenderPreparationInput {
  const model = ProviderTest.model({ id: ModelID.make("test-model"), providerID: ProviderID.make("test") })
  const agent = {
    name: "code",
    mode: "primary",
    permission: [],
    options: {},
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
  } satisfies Agent.Info
  return {
    sessionID: input.session.id,
    session: input.session,
    agent,
    model,
    envCache: {},
    resolveSystem: () => Effect.succeed([]),
    resolveTools: () => Effect.succeed({}),
    lastUserMessageID: input.lastUserMessageID,
  } satisfies LcmRawLeafRenderPreparationInput
}

function threshold(conversationID: ConversationID): LcmThresholdDecision {
  return {
    conversationID,
    strategy: "upward",
    activeTokens: 12,
    hardLimit: 90_000,
    softThreshold: 70_000,
    freshTailTokens: 20_000,
    softBacklogTokens: 12,
    softBacklogItemCount: 1,
    freshTailRawTokens: 0,
    freshTailRawItemCount: 0,
    unconsumedRawTokens: 0,
    unconsumedRawItemCount: 0,
    protectedTailRawTokens: 0,
    protectedTailRawItemCount: 0,
    rawLaneTokens: 12,
    outputReserve: 10_000,
    systemPromptTokens: 2,
    toolSchemaTokens: 3,
    providerContextLimit: 100_000,
    providerOutputLimit: 20_000,
    hardFillRatio: 12 / 90_000,
    rawLaneRatio: 12 / 70_000,
    softBacklogRatio: 12 / 70_000,
    tokenCounterMode: "fake",
    tokenCounterVersion: "passive-runtime-test",
    overSoft: false,
    overHard: false,
    lanes: {
      rawLeaves: lane({ lane: "raw_leaves", tokens: 7, itemCount: 1 }),
      sprigs: lane({ lane: "sprigs" }),
      bindles: lane({ lane: "bindles" }),
      archiveStubs: lane({ lane: "archive_stubs" }),
      largeFileMarkers: lane({ lane: "large_file_markers" }),
      retrievalCues: lane({ lane: "retrieval_cues" }),
    },
  }
}

function operationID(suffix: string): OperationID {
  return `op_passive_runtime_${suffix}` as OperationID
}

function softMaintenanceResult(
  patch: Partial<LcmMaintenanceResult> & Pick<LcmMaintenanceResult, "status">,
): LcmMaintenanceResult {
  return {
    conversationID: "conv_passive_runtime_retry" as ConversationID,
    operationID: operationID("retry"),
    workNeeded: true,
    workPerformed: false,
    blocking: false,
    reason: "soft_threshold",
    summariesCreated: 0,
    contextItemsReplaced: 0,
    ...patch,
  }
}

async function withLcmDataDir<T>(fn: () => Promise<T>) {
  await using tmp = await tmpdir()
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    return await Instance.provide({
      directory: tmp.path,
      fn,
    })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
}

test("passive runtime capabilities expose no active LCM behavior before activation", async () => {
  await withLcmDataDir(async () => {
    const session = await Session.create({ title: "m17 passive" })
    const layer = runtimeLayer({})

    const capabilities = await Effect.runPromise(
      LcmRuntime.Service.use((svc) => svc.getCapabilities({ sessionID: session.id })).pipe(
        Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
        Effect.provide(layer),
      ),
    )

    expect(capabilities).toMatchObject({
      sessionID: session.id,
      lifecycleState: "passive_synced",
      strategy: "upward",
      dbReady: true,
      lcmActive: false,
      canAssemble: false,
      canMaintain: false,
      canRetrieve: false,
    })
    expect("safeError" in capabilities).toBe(false)
  })
})

test("soft maintenance retries only transient retryable failures", () => {
  expect(lcmShouldRetrySoftMaintenance(softMaintenanceResult({ status: "deferred" }))).toBe(true)

  const providerUnavailable = createLcmSafeError({
    code: "provider_unavailable",
    templateKey: "lcm.provider.unavailable",
    safeParams: { operationID: operationID("provider_retry"), retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "lcm_test_provider_unavailable",
  })
  expect(
    lcmShouldRetrySoftMaintenance(softMaintenanceResult({ status: "failed", safeError: providerUnavailable })),
  ).toBe(true)

  const lockedNeedsUserAction = createLcmSafeError({
    code: "db_locked",
    templateKey: "lcm.db.unavailable",
    safeParams: { operationID: operationID("locked"), retryable: true, action: "close_other_owner" },
    retryable: true,
    diagnosticCode: "lcm_test_db_locked",
  })
  expect(
    lcmShouldRetrySoftMaintenance(softMaintenanceResult({ status: "failed", safeError: lockedNeedsUserAction })),
  ).toBe(false)
})

test("passive settings state treats Kilo config as deployment defaults", async () => {
  await withLcmDataDir(async () => {
    const layer = runtimeLayer(
      {
        lcm: {
          strategy: "dolt",
          storage: {
            warningThresholdBytes: 1024,
          },
        },
      },
      {},
    )

    const state = await Effect.runPromise(
      LcmRuntime.Service.use((svc) =>
        svc.getSettingsState({ projectID: "project_test", workspaceID: "workspace_test" }),
      ).pipe(Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)), Effect.provide(layer)),
    )

    expect(state.strategy).toBe("dolt")
    expect(state.storageWarningThresholdBytes).toBe(1024)
    expect(state.storageBytes).toBe(0)
    expect(state.storageWarning).toBe(false)
    expect(state.effectiveScope).toEqual({
      kind: "default",
      projectID: "project_test",
      workspaceID: "workspace_test",
    })
    expect(state).not.toHaveProperty("lifecycleState")
  })
})

test("preflight proceed result includes conversation, threshold, and assembly", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
    lcm: {
      strategy: "dolt",
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({
    git: true,
    config,
  })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 preflight" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })

    const thresholdInputs: Array<{
      providerContextLimit: number
      providerInputLimit?: number
      providerOutputLimit?: number
    }> = []
    const thresholdTargetSourceIDs: string[] = []
    const assemblyTargetSourceIDs: string[] = []
    const rebuildInputs: Array<{ strategy?: string }> = []
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) => {
          rebuildInputs.push({ strategy: input.strategy })
          return Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 0,
            lifecycleState: "lcm_active",
          })
        },
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          const captured: (typeof thresholdInputs)[number] = {
            providerContextLimit: input.providerContextLimit,
            providerOutputLimit: input.providerOutputLimit,
          }
          if (input.providerInputLimit !== undefined) captured.providerInputLimit = input.providerInputLimit
          thresholdInputs.push(captured)
          thresholdTargetSourceIDs.push(input.targetCurrentUser?.sourceMessageID ?? "")
          return Effect.succeed(threshold(input.conversationID as ConversationID))
        },
        assembleModelMessages: (input) => {
          assemblyTargetSourceIDs.push(input.targetCurrentUser.sourceMessageID)
          const modelMessages = [{ role: "user", content: "hello" }] as unknown as LcmValidatedModelMessages
          return Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            lifecycleState: "lcm_active",
            ok: true,
            contextItems: [],
            modelMessages,
            renderedSpans: [],
            activeTokens: 12,
            preparedProviderPayload: {
              operationID: input.targetCurrentUser?.promptOperationID ?? "op_passive_runtime",
              conversationID: input.conversationID as ConversationID,
              providerRequestSnapshotID: "reqsnap_passive_runtime",
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              systemPromptHash: input.renderOptions.systemPromptHash ?? "system",
              toolSchemaHash: input.renderOptions.toolSchemaHash ?? "tools",
              modelMessages,
              renderInputManifest: input.renderOptions.renderInputManifest ?? {
                version: 1,
                rendererVersion: input.renderOptions.rendererVersion ?? "test-renderer",
                renderPreparationVersion: input.renderOptions.renderPreparationVersion ?? "test-render-prep",
                sourceSelectionHash: input.renderOptions.sourceSelectionHash ?? "test-source-selection",
                requestSnapshotProtectionHash:
                  input.renderOptions.requestSnapshotProtectionHash ?? "test-request-snapshot-protection",
                renderUnitOrderHash: input.renderOptions.renderUnitOrderHash ?? "test-render-unit-order",
                effectivePlacementHash: input.renderOptions.effectivePlacementHash ?? "test-effective-placement",
                protectedSpanHash: input.renderOptions.protectedSpanHash ?? "test-protected-span",
                providerTransformHash: input.renderOptions.providerTransformHash ?? "test-provider-transform",
                providerValidatorHash: input.renderOptions.providerValidatorHash ?? "test-provider-validator",
                assemblyValidatorHash: "test-assembly-validator",
                systemPromptVersion: input.renderOptions.systemPromptVersion ?? "test-system",
                systemPromptHash: input.renderOptions.systemPromptHash ?? "system",
                toolSchemaVersion: input.renderOptions.toolSchemaVersion ?? "test-tools",
                toolSchemaHash: input.renderOptions.toolSchemaHash ?? "tools",
                pluginTransformVersion: input.renderOptions.pluginTransformVersion ?? "test-plugin",
                pluginTransformHash: input.renderOptions.pluginTransformHash ?? "plugin",
                dynamicPromptVersion: input.renderOptions.dynamicPromptVersion ?? "test-dynamic",
                dynamicPromptHash: input.renderOptions.dynamicPromptHash ?? "dynamic",
                messageVisibilityVersion: input.renderOptions.messageVisibilityVersion ?? "test-visibility",
                messageVisibilityHash: input.renderOptions.messageVisibilityHash ?? "visibility",
                providerMediaCapability: input.renderOptions.providerMediaCapability,
                stripMedia: input.renderOptions.stripMedia,
                modelID: input.renderOptions.modelID,
                providerID: input.renderOptions.providerID,
                taskCapabilityClass: input.renderOptions.taskCapabilityClass ?? "root",
                clockPolicy: input.renderOptions.clockPolicy ?? "fixture_frozen",
              },
              renderedSpans: [],
              assemblyValidatorHash: "test-assembly-validator",
              system: [],
              tools: {},
              format: { type: "text" },
            },
            providerRequestSnapshotID: "reqsnap_passive_runtime",
          })
        },
        compactLeavesToSprig: () => Effect.die("unexpected soft maintenance"),
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance"),
      }),
    )
    const dbService = await Effect.runPromise(
      LcmDb.Service.use((db) => Effect.succeed(db)).pipe(Effect.provide(LcmDb.defaultLayer)),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Layer.succeed(LcmDb.Service, dbService)),
      Layer.provide(configLayer(config)),
    )
    const { result, recoveryResult } = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const baseInput = {
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only" as const,
                  stripMedia: false,
                  taskCapabilityClass: "root" as const,
                },
                renderPreparation: testRenderPreparation({
                  session: session.session,
                  lastUserMessageID: session.user.id,
                }),
                syncUpToMessageID: session.user.id,
              }
              const result = yield* svc.preflightBeforeModel({
                ...baseInput,
                reason: "prompt",
              })
              const recoveryResult = yield* svc.preflightBeforeModel({
                ...baseInput,
                reason: "retry",
                providerOverflowRecovery: { attempt: 1 },
              })
              return { result, recoveryResult }
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provideService(LcmDb.Service, dbService),
            Effect.provide(layer),
          ),
        ),
    })

    expect(result.canProceed).toBe(true)
    if (!result.canProceed) throw new Error(result.safeError.safeMessage)
    expect(result.conversationID.startsWith("conv_")).toBe(true)
    expect(result.threshold).toMatchObject({
      conversationID: result.conversationID,
      overHard: false,
      overSoft: false,
    })
    expect(thresholdInputs[0]).toEqual({ providerContextLimit: 100_000, providerOutputLimit: 20_000 })
    expect(thresholdInputs[1]).toEqual({
      providerContextLimit: 100_000,
      providerInputLimit: 90_000,
      providerOutputLimit: 20_000,
    })
    expect(thresholdTargetSourceIDs).toEqual([session.user.id, session.user.id])
    expect(assemblyTargetSourceIDs).toEqual([session.user.id, session.user.id])
    expect(rebuildInputs[0]).toEqual({ strategy: "dolt" })
    expect(result.assembly).toMatchObject({
      conversationID: result.conversationID,
      lifecycleState: "lcm_active",
      modelMessages: [{ role: "user", content: "hello" }],
    })
    expect(result.lifecycleState).toBe("lcm_active")
    expect(recoveryResult.canProceed).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("background soft maintenance records a durable terminal usage status", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 soft maintenance usage" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) =>
          Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 0,
            lifecycleState: "lcm_active",
          }),
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          const base = threshold(input.conversationID as ConversationID)
          return Effect.succeed({
            ...base,
            activeTokens: 80_000,
            rawLaneTokens: 80_000,
            softBacklogTokens: 18_000,
            softBacklogItemCount: 4,
            hardFillRatio: 80_000 / base.hardLimit,
            rawLaneRatio: 80_000 / base.softThreshold,
            softBacklogRatio: 18_000 / base.softThreshold,
            overSoft: true,
          })
        },
        assembleModelMessages: (input) => {
          const modelMessages = [{ role: "user", content: "hello" }] as unknown as LcmValidatedModelMessages
          return Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            lifecycleState: "lcm_active",
            ok: true,
            contextItems: [],
            modelMessages,
            renderedSpans: [],
            activeTokens: 80_000,
            preparedProviderPayload: {
              operationID: input.targetCurrentUser?.promptOperationID ?? "op_passive_runtime_soft",
              conversationID: input.conversationID as ConversationID,
              providerRequestSnapshotID: "reqsnap_passive_runtime_soft",
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              systemPromptHash: input.renderOptions.systemPromptHash ?? "system",
              toolSchemaHash: input.renderOptions.toolSchemaHash ?? "tools",
              modelMessages,
              renderInputManifest: input.renderOptions.renderInputManifest ?? {
                version: 1,
                rendererVersion: input.renderOptions.rendererVersion ?? "test-renderer",
                renderPreparationVersion: input.renderOptions.renderPreparationVersion ?? "test-render-prep",
                sourceSelectionHash: input.renderOptions.sourceSelectionHash ?? "test-source-selection",
                requestSnapshotProtectionHash:
                  input.renderOptions.requestSnapshotProtectionHash ?? "test-request-snapshot-protection",
                renderUnitOrderHash: input.renderOptions.renderUnitOrderHash ?? "test-render-unit-order",
                effectivePlacementHash: input.renderOptions.effectivePlacementHash ?? "test-effective-placement",
                protectedSpanHash: input.renderOptions.protectedSpanHash ?? "test-protected-span",
                providerTransformHash: input.renderOptions.providerTransformHash ?? "test-provider-transform",
                providerValidatorHash: input.renderOptions.providerValidatorHash ?? "test-provider-validator",
                assemblyValidatorHash: "test-assembly-validator",
                systemPromptVersion: input.renderOptions.systemPromptVersion ?? "test-system",
                systemPromptHash: input.renderOptions.systemPromptHash ?? "system",
                toolSchemaVersion: input.renderOptions.toolSchemaVersion ?? "test-tools",
                toolSchemaHash: input.renderOptions.toolSchemaHash ?? "tools",
                pluginTransformVersion: input.renderOptions.pluginTransformVersion ?? "test-plugin",
                pluginTransformHash: input.renderOptions.pluginTransformHash ?? "plugin",
                dynamicPromptVersion: input.renderOptions.dynamicPromptVersion ?? "test-dynamic",
                dynamicPromptHash: input.renderOptions.dynamicPromptHash ?? "dynamic",
                messageVisibilityVersion: input.renderOptions.messageVisibilityVersion ?? "test-visibility",
                messageVisibilityHash: input.renderOptions.messageVisibilityHash ?? "visibility",
                providerMediaCapability: input.renderOptions.providerMediaCapability,
                stripMedia: input.renderOptions.stripMedia,
                modelID: input.renderOptions.modelID,
                providerID: input.renderOptions.providerID,
                taskCapabilityClass: input.renderOptions.taskCapabilityClass ?? "root",
                clockPolicy: input.renderOptions.clockPolicy ?? "fixture_frozen",
              },
              renderedSpans: [],
              assemblyValidatorHash: "test-assembly-validator",
              system: [],
              tools: {},
              format: { type: "text" },
            },
            providerRequestSnapshotID: "reqsnap_passive_runtime_soft",
          })
        },
        compactLeavesToSprig: (input) =>
          Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            operationID: operationID("soft_skipped"),
            workNeeded: true,
            workPerformed: false,
            blocking: false,
            reason: "soft_threshold",
            beforeTokens: 12_345,
            afterTokens: 12_345,
            summariesCreated: 0,
            contextItemsReplaced: 0,
            status: "skipped",
            safeMessage: "No eligible raw memory span fits the maintenance budget.",
          }),
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance"),
      }),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const preflight = yield* svc.preflightBeforeModel({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                reason: "prompt",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
                renderPreparation: testRenderPreparation({
                  session: session.session,
                  lastUserMessageID: session.user.id,
                }),
                syncUpToMessageID: session.user.id,
              })
              if (!preflight.canProceed) throw new Error(preflight.safeError.safeMessage)
              const maintenance = yield* svc.queueSoftMaintenanceAfterTurn({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
              })
              return { conversationID: preflight.conversationID, maintenance }
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    const familyID = deriveLcmFamilyID(session.session.id)
    const familyRoot = resolveLcmFamilyRoot({ kiloDataDir: path.join(tmp.path, "kilo-data"), familyID })
    const db = await createLcmPGlite({ dataDir: resolveLcmDbLayout(familyRoot).pgliteDir })
    const usage = (
      await db.query<{
        job_id: string
        purpose: string
        mode: string
        maintenance_status: string
        maintenance_safe_message: string | null
        summary_source_tokens: number | null
      }>(
        `
          SELECT job_id, purpose, mode, maintenance_status, maintenance_safe_message, summary_source_tokens
          FROM lcm_usage_records
          WHERE conversation_id = $1
          ORDER BY created_at_ms
        `,
        [result.conversationID],
      )
    ).rows
    await db.close()

    expect(result.maintenance).toMatchObject({ status: "skipped", workNeeded: true })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      purpose: "leaf_summary",
      mode: "background",
      maintenance_status: "skipped",
      maintenance_safe_message: "No eligible raw memory span fits the maintenance budget.",
      summary_source_tokens: 12_345,
    })
    expect(usage[0]!.job_id.startsWith("op_")).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("after-turn soft maintenance check refreshes raw counters without durable no-op attempt", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 raw counter refresh" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello raw memory",
        })
        return { session, user }
      },
    })
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmContext.layer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const preflight = yield* svc.preflightBeforeModel({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                reason: "prompt",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
                renderPreparation: testRenderPreparation({
                  session: session.session,
                  lastUserMessageID: session.user.id,
                }),
                syncUpToMessageID: session.user.id,
              })
              if (!preflight.canProceed) throw new Error(preflight.safeError.safeMessage)
              const maintenance = yield* svc.queueSoftMaintenanceAfterTurn({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
                recordNoOpAttempt: false,
              })
              return { conversationID: preflight.conversationID, maintenance }
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    const familyID = deriveLcmFamilyID(session.session.id)
    const familyRoot = resolveLcmFamilyRoot({ kiloDataDir: path.join(tmp.path, "kilo-data"), familyID })
    const db = await createLcmPGlite({ dataDir: resolveLcmDbLayout(familyRoot).pgliteDir })
    const snapshots = (
      await db.query<{
        hard_limit: number
        soft_threshold: number
        raw_lane_tokens: string | number | null
        reason: string | null
      }>(
        `
          SELECT
            hard_limit,
            soft_threshold,
            metrics_json->>'rawLaneTokens' AS raw_lane_tokens,
            metrics_json->>'reason' AS reason
          FROM lcm_context_snapshots
          WHERE conversation_id = $1
          ORDER BY created_at_ms DESC, snapshot_id DESC
          LIMIT 1
        `,
        [result.conversationID],
      )
    ).rows
    const usage = (
      await db.query<{ count: number | string | bigint }>(
        `
          SELECT count(*)::int AS count
          FROM lcm_usage_records
          WHERE conversation_id = $1
        `,
        [result.conversationID],
      )
    ).rows
    await db.close()

    expect(result.maintenance).toMatchObject({ status: "no_op", workNeeded: false })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.reason).toBe("threshold")
    expect(Number(snapshots[0]!.raw_lane_tokens)).toBeGreaterThan(0)
    expect(Number(snapshots[0]!.hard_limit)).toBeGreaterThan(0)
    expect(Number(snapshots[0]!.soft_threshold)).toBeGreaterThan(0)
    expect(Number(usage[0]?.count ?? 0)).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("after-turn soft maintenance rebuilds once after stale threshold context order", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 stale soft threshold" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello stale threshold",
        })
        return { session, user }
      },
    })

    const realLayer = LcmRuntime.layer.pipe(
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmContext.layer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )
    const preflight = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.preflightBeforeModel({
              sessionID: session.session.id,
              providerID: "test",
              modelID: "test-model",
              reason: "prompt",
              renderOptions: {
                providerID: "test",
                modelID: "test-model",
                providerMediaCapability: "text_only",
                stripMedia: false,
                taskCapabilityClass: "root",
              },
              renderPreparation: testRenderPreparation({
                session: session.session,
                lastUserMessageID: session.user.id,
              }),
              syncUpToMessageID: session.user.id,
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(realLayer),
          ),
        ),
    })
    if (!preflight.canProceed) throw new Error(preflight.safeError.safeMessage)

    const staleThreshold = createLcmSafeError({
      code: "recovery_required",
      templateKey: "lcm.recovery.missing_source",
      safeParams: { operationID: operationID("stale_soft_threshold"), action: "retry" },
      retryable: true,
      diagnosticCode: "lcm_threshold_context_invalid_order",
    })
    let thresholdCalls = 0
    let rebuilds = 0
    let compactCalls = 0
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) => {
          rebuilds++
          return Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 3,
            lifecycleState: "lcm_active",
          })
        },
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          thresholdCalls++
          if (thresholdCalls === 1) return Effect.fail(staleThreshold)
          const base = threshold(input.conversationID as ConversationID)
          return Effect.succeed({
            ...base,
            activeTokens: 80_000,
            rawLaneTokens: 80_000,
            softBacklogTokens: 18_000,
            softBacklogItemCount: 4,
            hardFillRatio: 80_000 / base.hardLimit,
            rawLaneRatio: 80_000 / base.softThreshold,
            softBacklogRatio: 18_000 / base.softThreshold,
            overSoft: true,
          })
        },
        assembleModelMessages: () => Effect.die("unexpected assembly"),
        compactLeavesToSprig: (input) => {
          compactCalls++
          return Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            operationID: operationID("stale_soft_compacted"),
            workNeeded: true,
            workPerformed: true,
            blocking: true,
            reason: "soft_threshold",
            beforeTokens: 18_000,
            afterTokens: 2_000,
            summariesCreated: 1,
            contextItemsReplaced: 4,
            status: "completed",
          })
        },
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance"),
      }),
    )
    const queueLayer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const maintenance = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.queueSoftMaintenanceAfterTurn({
              sessionID: session.session.id,
              providerID: "test",
              modelID: "test-model",
              renderOptions: {
                providerID: "test",
                modelID: "test-model",
                providerMediaCapability: "text_only",
                stripMedia: false,
                taskCapabilityClass: "root",
              },
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(queueLayer),
          ),
        ),
    })

    expect(maintenance).toMatchObject({ status: "completed", workPerformed: true })
    expect(thresholdCalls).toBe(2)
    expect(rebuilds).toBe(1)
    expect(compactCalls).toBe(1)
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("deferred soft maintenance resumes after runtime restart", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 deferred soft maintenance" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })
    const familyID = deriveLcmFamilyID(session.session.id)
    const familyRoot = resolveLcmFamilyRoot({ kiloDataDir: path.join(tmp.path, "kilo-data"), familyID })
    const pgliteDir = resolveLcmDbLayout(familyRoot).pgliteDir
    const providerDeferred = createLcmSafeError({
      code: "provider_capacity_deferred",
      templateKey: "lcm.provider_capacity.deferred",
      safeParams: { operationID: operationID("provider_deferred"), retryable: true, action: "retry" },
      retryable: true,
      diagnosticCode: "lcm_test_deferred_soft_provider_busy",
    })
    const compactProtectedSourceMessageIDs: string[] = []

    const contextLayer = (input: { mode: "defer" | "complete"; onCompact?: () => void }) =>
      Layer.succeed(
        LcmContext.Service,
        LcmContext.Service.of({
          getCurrentContext: () => Effect.succeed([]),
          rebuildActiveContext: (rebuildInput) =>
            Effect.succeed({
              conversationID: rebuildInput.conversationID as ConversationID,
              status: "healthy",
              itemsRebuilt: 0,
              lifecycleState: "lcm_active",
            }),
          replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
          finalizeProviderRequestSnapshot: () => Effect.void,
          recordProviderRequestSnapshotFinalValidation: () => Effect.void,
          isOverThreshold: (thresholdInput) => {
            const base = threshold(thresholdInput.conversationID as ConversationID)
            return Effect.succeed({
              ...base,
              activeTokens: 80_000,
              rawLaneTokens: 80_000,
              softBacklogTokens: 18_000,
              softBacklogItemCount: 4,
              hardFillRatio: 80_000 / base.hardLimit,
              rawLaneRatio: 80_000 / base.softThreshold,
              softBacklogRatio: 18_000 / base.softThreshold,
              overSoft: true,
            })
          },
          assembleModelMessages: (assemblyInput) => {
            const modelMessages = [{ role: "user", content: "hello" }] as unknown as LcmValidatedModelMessages
            return Effect.succeed({
              conversationID: assemblyInput.conversationID as ConversationID,
              lifecycleState: "lcm_active",
              ok: true,
              contextItems: [],
              modelMessages,
              renderedSpans: [],
              activeTokens: 80_000,
              preparedProviderPayload: {
                operationID: assemblyInput.targetCurrentUser?.promptOperationID ?? "op_passive_runtime_deferred",
                conversationID: assemblyInput.conversationID as ConversationID,
                providerRequestSnapshotID: "reqsnap_passive_runtime_deferred",
                providerID: assemblyInput.renderOptions.providerID,
                modelID: assemblyInput.renderOptions.modelID,
                systemPromptHash: assemblyInput.renderOptions.systemPromptHash ?? "system",
                toolSchemaHash: assemblyInput.renderOptions.toolSchemaHash ?? "tools",
                modelMessages,
                renderInputManifest: assemblyInput.renderOptions.renderInputManifest ?? {
                  version: 1,
                  rendererVersion: assemblyInput.renderOptions.rendererVersion ?? "test-renderer",
                  renderPreparationVersion: assemblyInput.renderOptions.renderPreparationVersion ?? "test-render-prep",
                  sourceSelectionHash: assemblyInput.renderOptions.sourceSelectionHash ?? "test-source-selection",
                  requestSnapshotProtectionHash:
                    assemblyInput.renderOptions.requestSnapshotProtectionHash ?? "test-request-snapshot-protection",
                  renderUnitOrderHash: assemblyInput.renderOptions.renderUnitOrderHash ?? "test-render-unit-order",
                  effectivePlacementHash:
                    assemblyInput.renderOptions.effectivePlacementHash ?? "test-effective-placement",
                  protectedSpanHash: assemblyInput.renderOptions.protectedSpanHash ?? "test-protected-span",
                  providerTransformHash: assemblyInput.renderOptions.providerTransformHash ?? "test-provider-transform",
                  providerValidatorHash: assemblyInput.renderOptions.providerValidatorHash ?? "test-provider-validator",
                  assemblyValidatorHash: "test-assembly-validator",
                  systemPromptVersion: assemblyInput.renderOptions.systemPromptVersion ?? "test-system",
                  systemPromptHash: assemblyInput.renderOptions.systemPromptHash ?? "system",
                  toolSchemaVersion: assemblyInput.renderOptions.toolSchemaVersion ?? "test-tools",
                  toolSchemaHash: assemblyInput.renderOptions.toolSchemaHash ?? "tools",
                  pluginTransformVersion: assemblyInput.renderOptions.pluginTransformVersion ?? "test-plugin",
                  pluginTransformHash: assemblyInput.renderOptions.pluginTransformHash ?? "plugin",
                  dynamicPromptVersion: assemblyInput.renderOptions.dynamicPromptVersion ?? "test-dynamic",
                  dynamicPromptHash: assemblyInput.renderOptions.dynamicPromptHash ?? "dynamic",
                  messageVisibilityVersion: assemblyInput.renderOptions.messageVisibilityVersion ?? "test-visibility",
                  messageVisibilityHash: assemblyInput.renderOptions.messageVisibilityHash ?? "visibility",
                  providerMediaCapability: assemblyInput.renderOptions.providerMediaCapability,
                  stripMedia: assemblyInput.renderOptions.stripMedia,
                  modelID: assemblyInput.renderOptions.modelID,
                  providerID: assemblyInput.renderOptions.providerID,
                  taskCapabilityClass: assemblyInput.renderOptions.taskCapabilityClass ?? "root",
                  clockPolicy: assemblyInput.renderOptions.clockPolicy ?? "fixture_frozen",
                },
                renderedSpans: [],
                assemblyValidatorHash: "test-assembly-validator",
                system: [],
                tools: {},
                format: { type: "text" },
              },
              providerRequestSnapshotID: "reqsnap_passive_runtime_deferred",
            })
          },
          compactLeavesToSprig: (compactInput) => {
            input.onCompact?.()
            compactProtectedSourceMessageIDs.push(compactInput.protectedCurrentUser?.sourceMessageID ?? "")
            return Effect.succeed(
              input.mode === "defer"
                ? {
                    conversationID: compactInput.conversationID as ConversationID,
                    operationID: operationID("soft_deferred"),
                    workNeeded: true,
                    workPerformed: false,
                    blocking: false,
                    reason: "soft_threshold",
                    beforeTokens: 12_345,
                    afterTokens: 12_345,
                    summariesCreated: 0,
                    contextItemsReplaced: 0,
                    status: "failed",
                    safeMessage: providerDeferred.safeMessage,
                    safeError: providerDeferred,
                  }
                : {
                    conversationID: compactInput.conversationID as ConversationID,
                    operationID: operationID("soft_resumed"),
                    workNeeded: true,
                    workPerformed: true,
                    blocking: false,
                    reason: "soft_threshold",
                    beforeTokens: 12_345,
                    afterTokens: 2_345,
                    summariesCreated: 1,
                    contextItemsReplaced: 2,
                    status: "completed",
                    safeMessage: "Memory maintenance completed.",
                  },
            )
          },
          compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance"),
        }),
      )

    const firstLayer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer({ mode: "defer" })),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const firstResult = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const preflight = yield* svc.preflightBeforeModel({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                reason: "prompt",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
                renderPreparation: testRenderPreparation({
                  session: session.session,
                  lastUserMessageID: session.user.id,
                }),
                syncUpToMessageID: session.user.id,
              })
              if (!preflight.canProceed) throw new Error(preflight.safeError.safeMessage)
              const maintenance = yield* svc.queueSoftMaintenanceAfterTurn({
                sessionID: session.session.id,
                providerID: "test",
                modelID: "test-model",
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
                abortSignalID: "turn_abort_should_not_persist",
                protectedCurrentUser: {
                  sourceSessionID: session.session.id,
                  sourceMessageID: session.user.id,
                },
              })
              return { conversationID: preflight.conversationID, maintenance }
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(firstLayer),
          ),
        ),
    })

    expect(firstResult.maintenance).toMatchObject({
      status: "failed",
      safeError: { code: "provider_capacity_deferred" },
    })

    const db = await createLcmPGlite({ dataDir: pgliteDir })
    const queued = (
      await db.query<{
        status: string
        attempt_count: number
        payload_json: { input: { abortSignalID?: string; protectedCurrentUser?: { sourceMessageID?: string } } }
      }>(
        `
          SELECT status, attempt_count, payload_json
          FROM lcm_deferred_jobs
          WHERE conversation_id = $1
        `,
        [firstResult.conversationID],
      )
    ).rows
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ status: "queued", attempt_count: 1 })
    expect(queued[0]!.payload_json.input.abortSignalID).toBeUndefined()
    expect(queued[0]!.payload_json.input.protectedCurrentUser?.sourceMessageID).toBe(session.user.id)
    await db.query("UPDATE lcm_deferred_jobs SET next_run_at_ms = 0 WHERE conversation_id = $1", [
      firstResult.conversationID,
    ])
    await db.close()

    let resumedResolve: (() => void) | undefined
    const resumed = new Promise<void>((resolve) => {
      resumedResolve = resolve
    })
    const secondLayer = LcmRuntime.layer.pipe(
      Layer.provide(
        contextLayer({
          mode: "complete",
          onCompact: () => resumedResolve?.(),
        }),
      ),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const capabilities = yield* svc.getCapabilities({ sessionID: session.session.id })
              expect(capabilities.lifecycleState).toBe("lcm_active")
              yield* Effect.promise(() =>
                Promise.race([
                  resumed,
                  new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error("timed out waiting for resumed maintenance")), 10_000),
                  ),
                ]),
              )
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(secondLayer),
          ),
        ),
    })

    const reopened = await createLcmPGlite({ dataDir: pgliteDir })
    let completed: { status: string; attempt_count: number; completed_at_ms: number | null }[] = []
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      completed = (
        await reopened.query<{ status: string; attempt_count: number; completed_at_ms: number | null }>(
          `
            SELECT status, attempt_count, completed_at_ms
            FROM lcm_deferred_jobs
            WHERE conversation_id = $1
          `,
          [firstResult.conversationID],
        )
      ).rows
      if (completed[0]?.status === "completed") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await reopened.close()
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ status: "completed", attempt_count: 1 })
    expect(completed[0]!.completed_at_ms).not.toBeNull()
    expect(compactProtectedSourceMessageIDs).toEqual([session.user.id, session.user.id])
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("queued deferred soft maintenance can be canceled before retry", async () => {
  const config = {
    provider: {},
    agent: {},
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const created = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m18 cancel deferred soft maintenance" })
        const conversationID = await Effect.runPromise(
          LcmRuntime.Service.use((svc) => svc.getOrCreateConversation({ sessionID: session.id })).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(runtimeLayer(config)),
          ),
        )
        return { session, conversationID }
      },
    })
    const familyID = deriveLcmFamilyID(created.session.id)
    const familyRoot = resolveLcmFamilyRoot({ kiloDataDir: path.join(tmp.path, "kilo-data"), familyID })
    const pgliteDir = resolveLcmDbLayout(familyRoot).pgliteDir

    const db = await createLcmPGlite({ dataDir: pgliteDir })
    await db.query(
      `
        UPDATE lcm_conversations
        SET lifecycle_state = 'lcm_active'
        WHERE conversation_id = $1
      `,
      [created.conversationID],
    )
    await upsertDeferredSoftMaintenanceJob({
      db,
      conversationID: created.conversationID,
      retryInput: {
        sessionID: created.session.id,
        providerID: "test",
        modelID: "test-model",
        renderOptions: {
          providerID: "test",
          modelID: "test-model",
          providerMediaCapability: "text_only",
          stripMedia: false,
          taskCapabilityClass: "root",
        },
      },
      attemptCount: 1,
      nextRunAtMs: Date.now() + 60_000,
      safeMessage: "Memory maintenance will retry.",
    })
    await db.close()

    const canceled = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.cancelDeferredMaintenance({ sessionID: created.session.id, reason: "user" }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(runtimeLayer(config)),
          ),
        ),
    })

    expect(canceled).toMatchObject({
      status: "canceled",
      workNeeded: true,
      workPerformed: false,
      safeMessage: "Queued memory maintenance retry was canceled.",
    })

    const reopened = await createLcmPGlite({ dataDir: pgliteDir })
    const rows = (
      await reopened.query<{ status: string; completed_at_ms: number | null; last_diagnostic_code: string | null }>(
        `
          SELECT status, completed_at_ms, last_diagnostic_code
          FROM lcm_deferred_jobs
          WHERE conversation_id = $1
        `,
        [created.conversationID],
      )
    ).rows
    await reopened.close()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: "canceled",
      last_diagnostic_code: "lcm_deferred_soft_maintenance_user_canceled",
    })
    expect(rows[0]!.completed_at_ms).not.toBeNull()
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("blocked preflight clears runtime-owned preparation status", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 blocked preflight status" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })

    const statuses: Array<SessionStatus.Info> = []
    let currentStatus: SessionStatus.Info = { type: "idle" }
    const statusLayer = Layer.succeed(
      SessionStatus.Service,
      SessionStatus.Service.of({
        get: () => Effect.succeed(currentStatus),
        list: () => Effect.succeed(new Map()),
        set: (_sessionID, status) =>
          Effect.sync(() => {
            currentStatus = status
            statuses.push(status)
          }),
      }),
    )
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.die("unexpected context read"),
        rebuildActiveContext: () => Effect.die("unexpected rebuild"),
        replaceRetrievalCues: () => Effect.die("unexpected retrieval cue refresh"),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: () => Effect.die("unexpected threshold check"),
        assembleModelMessages: () => Effect.die("unexpected assembly"),
        compactLeavesToSprig: () => Effect.die("unexpected soft maintenance"),
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance"),
      }),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(statusLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.preflightBeforeModel({
              sessionID: session.session.id,
              providerID: "test",
              modelID: "test-model",
              reason: "prompt",
              renderOptions: {
                providerID: "test",
                modelID: "test-model",
                providerMediaCapability: "text_only",
                stripMedia: false,
                taskCapabilityClass: "root",
              },
              syncUpToMessageID: session.user.id,
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    expect(result.canProceed).toBe(false)
    if (result.canProceed) throw new Error("expected blocked preflight")
    expect(result.safeError.diagnosticCode).toBe("lcm_preflight_render_preparation_missing")
    expect(statuses).toEqual([
      { type: "busy", message: LCM_PREFLIGHT_STORAGE_LABEL },
      { type: "busy", message: LCM_PREFLIGHT_SYNC_LABEL },
      { type: "idle" },
    ])
    expect(currentStatus).toEqual({ type: "idle" })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("hard-limit preflight restores busy status when maintenance startup fails", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 hard limit status" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })

    const statuses: Array<SessionStatus.Info> = []
    let currentStatus: SessionStatus.Info = { type: "idle" }
    const statusLayer = Layer.succeed(
      SessionStatus.Service,
      SessionStatus.Service.of({
        get: () => Effect.succeed(currentStatus),
        list: () => Effect.succeed(new Map()),
        set: (_sessionID, status) =>
          Effect.sync(() => {
            currentStatus = status
            statuses.push(status)
          }),
      }),
    )
    const failingBusLayer = Layer.succeed(
      Bus.Service,
      Bus.Service.of({
        publish: () => Effect.die("lcm hard-limit start event failed"),
        subscribe: () => Effect.die("unexpected subscribe") as never,
        subscribeAll: () => Effect.die("unexpected subscribeAll") as never,
        subscribeCallback: () => Effect.die("unexpected subscribeCallback"),
        subscribeAllCallback: () => Effect.die("unexpected subscribeAllCallback"),
      }),
    )
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) =>
          Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 0,
            lifecycleState: "lcm_active",
          }),
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          const hard = threshold(input.conversationID as ConversationID)
          return Effect.succeed({
            ...hard,
            activeTokens: 120,
            hardLimit: 100,
            hardFillRatio: 1.2,
            overHard: true,
          })
        },
        assembleModelMessages: () => Effect.die("unexpected assembly after failed hard-limit startup"),
        compactLeavesToSprig: () => Effect.die("unexpected soft maintenance"),
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance after failed start event"),
      }),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(failingBusLayer),
      Layer.provide(statusLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const exit = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.preflightBeforeModel({
              sessionID: session.session.id,
              providerID: "test",
              modelID: "test-model",
              reason: "prompt",
              renderOptions: {
                providerID: "test",
                modelID: "test-model",
                providerMediaCapability: "text_only",
                stripMedia: false,
                taskCapabilityClass: "root",
              },
              renderPreparation: testRenderPreparation({
                session: session.session,
                lastUserMessageID: session.user.id,
              }),
              syncUpToMessageID: session.user.id,
            }),
          ).pipe(
            Effect.exit,
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    expect(exit._tag).toBe("Failure")
    expect(statuses).toEqual([
      { type: "busy", message: LCM_PREFLIGHT_STORAGE_LABEL },
      { type: "busy", message: LCM_PREFLIGHT_SYNC_LABEL },
      { type: "busy", message: LCM_PREFLIGHT_REBUILD_LABEL },
      { type: "busy", message: LCM_PREFLIGHT_RETRIEVAL_LABEL },
      { type: "busy", message: LCM_PREFLIGHT_BUDGET_LABEL },
      { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL },
      { type: "idle" },
    ])
    expect(currentStatus).toEqual({ type: "idle" })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("hard-limit preflight reports content-safe maintenance progress", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 hard limit progress" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })

    const statuses: Array<SessionStatus.Info> = []
    let currentStatus: SessionStatus.Info = { type: "idle" }
    const statusLayer = Layer.succeed(
      SessionStatus.Service,
      SessionStatus.Service.of({
        get: () => Effect.succeed(currentStatus),
        list: () => Effect.succeed(new Map()),
        set: (_sessionID, status) =>
          Effect.sync(() => {
            currentStatus = status
            statuses.push(status)
          }),
      }),
    )
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) =>
          Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 0,
            lifecycleState: "lcm_active",
          }),
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          const hard = threshold(input.conversationID as ConversationID)
          return Effect.succeed({
            ...hard,
            activeTokens: 120,
            hardLimit: 100,
            hardFillRatio: 1.2,
            overHard: true,
          })
        },
        assembleModelMessages: () => Effect.die("unexpected assembly after failed hard-limit maintenance"),
        compactLeavesToSprig: () => Effect.die("unexpected soft maintenance"),
        compactUntilUnderHardLimit: (input) =>
          Effect.gen(function* () {
            yield* input.onProgress?.({ phase: "leaf_summary", round: 0 }) ?? Effect.void
            yield* input.onProgress?.({ phase: "condensation", round: 0, lane: "sprigs" }) ?? Effect.void
            const safeError = createLcmSafeError({
              code: "hard_limit_unresolved",
              templateKey: "lcm.hard_limit.unresolved",
              safeParams: {
                conversationID: input.conversationID,
                beforeTokens: 120,
                hardLimit: 100,
                action: "start_new_thread",
              },
              retryable: false,
              diagnosticCode: "lcm_test_hard_limit_progress_failed",
            })
            return {
              conversationID: input.conversationID,
              operationID: operationID("hard_limit_progress"),
              workNeeded: true,
              workPerformed: false,
              blocking: true,
              reason: "hard_limit",
              beforeTokens: 120,
              afterTokens: 120,
              summariesCreated: 0,
              contextItemsReplaced: 0,
              status: "failed",
              safeMessage: safeError.safeMessage,
              safeError,
            } satisfies LcmMaintenanceResult
          }),
      }),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(Bus.defaultLayer),
      Layer.provide(statusLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            svc.preflightBeforeModel({
              sessionID: session.session.id,
              providerID: "test",
              modelID: "test-model",
              reason: "prompt",
              renderOptions: {
                providerID: "test",
                modelID: "test-model",
                providerMediaCapability: "text_only",
                stripMedia: false,
                taskCapabilityClass: "root",
              },
              renderPreparation: testRenderPreparation({
                session: session.session,
                lastUserMessageID: session.user.id,
              }),
              syncUpToMessageID: session.user.id,
            }),
          ).pipe(
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    expect(result.canProceed).toBe(false)
    expect(statuses).toContainEqual({ type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL })
    expect(statuses).toContainEqual({ type: "busy", message: LCM_BLOCKING_LEAF_MAINTENANCE_LABEL })
    expect(statuses).toContainEqual({ type: "busy", message: LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL })
    expect(currentStatus).toEqual({ type: "idle" })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("manual hard-limit maintenance restores busy status when startup fails", async () => {
  const config = {
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
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: "http://127.0.0.1:1/v1",
        },
      },
    },
    agent: {
      code: {
        model: "test/test-model",
      },
    },
  } satisfies Config.Info
  await using tmp = await tmpdir({ git: true, config })

  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "m17 manual hard limit status" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: 1777500000000 },
          agent: "code",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "hello",
        })
        return { session, user }
      },
    })

    const statuses: Array<SessionStatus.Info> = []
    let currentStatus: SessionStatus.Info = { type: "idle" }
    const statusLayer = Layer.succeed(
      SessionStatus.Service,
      SessionStatus.Service.of({
        get: () => Effect.succeed(currentStatus),
        list: () => Effect.succeed(new Map()),
        set: (_sessionID, status) =>
          Effect.sync(() => {
            currentStatus = status
            statuses.push(status)
          }),
      }),
    )
    const failingBusLayer = Layer.succeed(
      Bus.Service,
      Bus.Service.of({
        publish: () => Effect.die("lcm manual hard-limit start event failed"),
        subscribe: () => Effect.die("unexpected subscribe") as never,
        subscribeAll: () => Effect.die("unexpected subscribeAll") as never,
        subscribeCallback: () => Effect.die("unexpected subscribeCallback"),
        subscribeAllCallback: () => Effect.die("unexpected subscribeAllCallback"),
      }),
    )
    const contextLayer = Layer.succeed(
      LcmContext.Service,
      LcmContext.Service.of({
        getCurrentContext: () => Effect.succeed([]),
        rebuildActiveContext: (input) =>
          Effect.succeed({
            conversationID: input.conversationID as ConversationID,
            status: "healthy",
            itemsRebuilt: 0,
            lifecycleState: "lcm_active",
          }),
        replaceRetrievalCues: () => Effect.succeed({ insertedCues: 0 }),
        finalizeProviderRequestSnapshot: () => Effect.void,
        recordProviderRequestSnapshotFinalValidation: () => Effect.void,
        isOverThreshold: (input) => {
          const hard = threshold(input.conversationID as ConversationID)
          return Effect.succeed({
            ...hard,
            activeTokens: 120,
            hardLimit: 100,
            hardFillRatio: 1.2,
            overHard: true,
          })
        },
        assembleModelMessages: () => Effect.die("unexpected assembly during manual maintenance"),
        compactLeavesToSprig: () => Effect.die("unexpected soft maintenance"),
        compactUntilUnderHardLimit: () => Effect.die("unexpected hard maintenance after failed manual start event"),
      }),
    )
    const layer = LcmRuntime.layer.pipe(
      Layer.provide(contextLayer),
      Layer.provide(failingBusLayer),
      Layer.provide(statusLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LcmDb.defaultLayer),
      Layer.provide(configLayer(config)),
    )

    const exit = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              yield* svc.getOrCreateConversation({ sessionID: session.session.id })
              return yield* svc.runManualMaintenance({
                sessionID: session.session.id,
                reason: "manual",
                blocking: true,
                renderOptions: {
                  providerID: "test",
                  modelID: "test-model",
                  providerMediaCapability: "text_only",
                  stripMedia: false,
                  taskCapabilityClass: "root",
                },
              })
            }),
          ).pipe(
            Effect.exit,
            Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
            Effect.provide(layer),
          ),
        ),
    })

    expect(exit._tag).toBe("Failure")
    expect(statuses).toEqual([{ type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL }, { type: "idle" }])
    expect(currentStatus).toEqual({ type: "idle" })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})

test("normal prompt path returns assistant text without model-visible LCM markers", async () => {
  const llmInputs: LLM.StreamInput[] = []
  await using tmp = await tmpdir({
    git: true,
    config: {
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
              limit: { context: 100_000, output: 10_000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: {
            apiKey: "test-key",
            baseURL: "http://127.0.0.1:1/v1",
          },
        },
      },
      agent: {
        code: {
          model: "test/test-model",
        },
      },
    },
  })

  const previousLcmDataDir = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")
  try {
    const llmLayer = Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: () => Stream.empty,
      }),
    )
    const processorLayer = Layer.effect(
      SessionProcessor.Service,
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        return SessionProcessor.Service.of({
          create: (input) =>
            Effect.succeed({
              message: input.assistantMessage,
              updateToolCall: () => Effect.succeed(undefined),
              metadata: () => Effect.void,
              completeToolCall: () => Effect.void,
              process: (streamInput) =>
                Effect.gen(function* () {
                  llmInputs.push(streamInput)
                  const now = Date.now()
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text: "world",
                    time: { start: now, end: now },
                  })
                  input.assistantMessage.finish = "stop"
                  input.assistantMessage.time.completed = now
                  yield* sessions.updateMessage(input.assistantMessage)
                  return "stop" as const
                }),
            }),
        })
      }),
    )
    const promptBaseLayer = SessionPrompt.layer.pipe(
      Layer.provide(SessionRunState.defaultLayer),
      Layer.provide(SessionStatus.defaultLayer),
      Layer.provide(LcmRuntime.defaultLayer),
      Layer.provide(processorLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(RuntimeFlags.defaultLayer),
      Layer.provide(Command.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(MCP.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(ToolRegistry.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
    )
    const promptLayer = promptBaseLayer.pipe(
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(SessionSummary.defaultLayer),
      Layer.provide(
        Layer.mergeAll(
          Agent.defaultLayer,
          SystemPrompt.defaultLayer,
          llmLayer,
          Bus.layer,
          CrossSpawnSpawner.defaultLayer,
          BackgroundJob.defaultLayer,
          EventV2Bridge.defaultLayer,
        ),
      ),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          title: "Pinned",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const result = await Effect.runPromise(
          SessionPrompt.Service.use((promptSvc) =>
            promptSvc.prompt({
              sessionID: session.id,
              agent: "code",
              parts: [{ type: "text", text: "hello" }],
            }),
          ).pipe(Effect.provide(promptLayer)),
        )
        const capabilities = await LcmRuntime.getCapabilities({ sessionID: session.id })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((part) => part.type === "text" && part.text === "world")).toBe(true)
        expect(capabilities).toMatchObject({
          sessionID: session.id,
          lifecycleState: "lcm_active",
          lcmActive: true,
          canRetrieve: true,
        })
        await LcmRuntime.close()
      },
    })

    expect(llmInputs).toHaveLength(1)
    const messagesPayload = JSON.stringify(llmInputs[0]!.messages)
    expect(messagesPayload).not.toContain("lcm_file")
    expect(messagesPayload).not.toContain("large_file_marker")
    expect(messagesPayload).not.toContain("retrieval_cue")
    expect(messagesPayload).not.toContain("Memory storage")
    expect(messagesPayload).not.toContain("[Memory Cue:")
  } finally {
    if (previousLcmDataDir === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previousLcmDataDir
  }
})
