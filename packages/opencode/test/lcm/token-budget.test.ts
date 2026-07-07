// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import path from "node:path"
import type { Provider } from "../../src/provider/provider"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import {
  LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION,
  Service as LcmContextService,
  layer as lcmContextLayer,
  type LcmRawLeafThresholdInput,
} from "../../src/session/lcm/context"
import {
  LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
  computeLaneDecisions,
  computeThresholdDecision,
  computeTokenBudget,
  createDeterministicFallbackTokenCounter,
  createFakeTokenCounter,
  createTokenCacheKey,
  deterministicFallbackTokenCount,
  clearLcmLaneLatch,
  updateLcmLaneLatches,
  renderManifestHash,
  type LcmTokenCounter,
} from "../../src/session/lcm/token-budget"
import { resolveLcmModelLimits } from "../../src/session/lcm/model-limits"
import type { ConversationID, LcmDbRequest, LcmSafeError, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"
import { LCM_RECOVERY_FIXTURE_IDS, seedRecoveryConversationFixture } from "./harness"

function operationID(suffix: string): OperationID {
  return `op_m11_${suffix}` as OperationID
}

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">): Omit<LcmDbRequest<T>, "lane"> {
  return {
    operationID: operationID("test"),
    purpose: "debug_support",
    run: input.run,
  }
}

async function initialize(dataDir: string) {
  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir,
    runtimeMode: "source",
    schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
    smokeMode: true,
  })
  expect(status.status).toBe("ready")
  return worker
}

function contextLayer(worker: ReturnType<typeof createLcmDbWorker>) {
  const dbLayer = Layer.succeed(
    LcmDb.Service,
    LcmDb.Service.of({
      getStatus: () => Effect.sync(() => worker.getStatus()),
      initialize: (input) => Effect.promise(() => worker.initialize(input)),
      execute: (input) =>
        Effect.tryPromise({
          try: () => worker.execute(input),
          catch: (error) => error as LcmSafeError,
        }),
      executeForeground: (input) =>
        Effect.tryPromise({
          try: () => worker.executeForeground(input),
          catch: (error) => error as LcmSafeError,
        }),
      close: () => Effect.promise(() => worker.close()),
    }),
  )
  return lcmContextLayer.pipe(Layer.provide(dbLayer))
}

function runContext<A, E>(
  worker: ReturnType<typeof createLcmDbWorker>,
  effect: Effect.Effect<A, E, LcmContextService>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(contextLayer(worker))))
}

function renderOptions(input: { modelID?: string; manifestSeed?: string } = {}) {
  const modelID = input.modelID ?? "model-m11"
  const providerID = "provider-m11"
  return {
    providerMediaCapability: "unknown" as const,
    stripMedia: false,
    modelID,
    providerID,
    renderInputManifest: {
      version: 1 as const,
      rendererVersion: "renderer-m11",
      renderPreparationVersion: "prep-m11",
      sourceSelectionHash: `source-${input.manifestSeed ?? "a"}`,
      requestSnapshotProtectionHash: `snapshot-protection-${input.manifestSeed ?? "a"}`,
      renderUnitOrderHash: `render-unit-order-${input.manifestSeed ?? "a"}`,
      effectivePlacementHash: `effective-placement-${input.manifestSeed ?? "a"}`,
      protectedSpanHash: `protected-span-${input.manifestSeed ?? "a"}`,
      providerTransformHash: `provider-transform-${input.manifestSeed ?? "a"}`,
      providerValidatorHash: `provider-validator-${input.manifestSeed ?? "a"}`,
      assemblyValidatorHash: `assembly-validator-${input.manifestSeed ?? "a"}`,
      systemPromptVersion: "system-v1",
      systemPromptHash: `system-${input.manifestSeed ?? "a"}`,
      toolSchemaVersion: "tools-v1",
      toolSchemaHash: `tools-${input.manifestSeed ?? "a"}`,
      pluginTransformVersion: "plugin-v1",
      pluginTransformHash: `plugin-${input.manifestSeed ?? "a"}`,
      dynamicPromptVersion: "dynamic-v1",
      dynamicPromptHash: `dynamic-${input.manifestSeed ?? "a"}`,
      messageVisibilityVersion: "visibility-v1",
      messageVisibilityHash: `visibility-${input.manifestSeed ?? "a"}`,
      providerMediaCapability: "unknown" as const,
      stripMedia: false,
      modelID,
      providerID,
      taskCapabilityClass: "root" as const,
      clockPolicy: "fixture_frozen" as const,
    },
  }
}

function modelWithLimits(input: {
  npm: string
  family: string
  releaseDate: string
  limit: { context: number; input?: number; output: number }
}): Provider.Model {
  return {
    api: { npm: input.npm },
    family: input.family,
    release_date: input.releaseDate,
    limit: input.limit,
  } as unknown as Provider.Model
}

test("lcm:token-budget formula applies output reserve, overhead subtraction, rounding, and clamping", () => {
  const budget = computeTokenBudget({
    providerContextLimit: 1000,
    providerInputLimit: 900,
    providerOutputLimit: 300,
    activeTokens: 500,
    systemPromptTokens: 50,
    toolSchemaTokens: 25,
  })
  expect(budget).toMatchObject({
    providerContextLimit: 1000,
    providerInputLimit: 900,
    providerOutputLimit: 300,
    outputReserve: 250,
    effectiveInputWindow: 750,
    hardLimit: 675,
    softThreshold: 375,
    tokenCounterMode: "deterministic_fallback",
    tokenCounterVersion: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
    overHard: false,
    outputReserveSource: "dynamic_default",
  })
  expect(budget.hardFillRatio).toBeCloseTo(500 / 675)

  const decision = computeThresholdDecision({
    conversationID: "conv_m11_threshold_fields" as ConversationID,
    strategy: "upward",
    budget: {
      providerContextLimit: 1000,
      providerInputLimit: 900,
      providerOutputLimit: 300,
      activeTokens: 500,
      systemPromptTokens: 50,
      toolSchemaTokens: 25,
      tokenCounterMode: "provider",
      tokenCounterVersion: "provider-counter-v1",
    },
    laneItems: [],
  })
  expect(decision).toMatchObject({
    providerContextLimit: 1000,
    providerInputLimit: 900,
    providerOutputLimit: 300,
    tokenCounterMode: "provider",
    tokenCounterVersion: "provider-counter-v1",
  })
  expect(decision.hardFillRatio).toBeCloseTo(500 / 675)
  expect(decision.softBacklogTokens).toBe(0)
  expect(decision.protectedTailRawTokens).toBe(0)
  expect(decision.rawLaneTokens).toBe(0)
  expect(decision.rawLaneRatio).toBe(0)
  expect(decision.softBacklogRatio).toBe(0)
  expect(decision.overSoft).toBe(false)

  const rawPressure = computeThresholdDecision({
    conversationID: "conv_m11_threshold_raw_pressure" as ConversationID,
    strategy: "upward",
    budget: {
      providerContextLimit: 1000,
      providerInputLimit: 900,
      providerOutputLimit: 300,
      activeTokens: 500,
      systemPromptTokens: 50,
      toolSchemaTokens: 25,
    },
    laneItems: [
      { itemType: "raw_message" as const, tokenCount: 7000 },
      { itemType: "raw_message" as const, tokenCount: 7000 },
      { itemType: "raw_message" as const, tokenCount: 6001 },
    ],
    softBacklogTokens: 7000,
    softBacklogItemCount: 3,
    protectedTailRawTokens: 1000,
    protectedTailRawItemCount: 2,
  })
  expect(rawPressure.rawLaneTokens).toBe(8000)
  expect(rawPressure.rawLaneRatio).toBeCloseTo(8000 / 375)
  expect(rawPressure.softBacklogRatio).toBeCloseTo(7000 / 375)
  expect(rawPressure.overSoft).toBe(true)

  const hugeSingleLeafPressure = computeThresholdDecision({
    conversationID: "conv_m11_threshold_huge_single_leaf" as ConversationID,
    strategy: "upward",
    budget: {
      providerContextLimit: 1000,
      providerInputLimit: 900,
      providerOutputLimit: 300,
      activeTokens: 500,
      systemPromptTokens: 50,
      toolSchemaTokens: 25,
    },
    laneItems: [],
    softBacklogTokens: 5000,
    softBacklogItemCount: 1,
    protectedTailRawTokens: 1000,
    protectedTailRawItemCount: 2,
  })
  expect(hugeSingleLeafPressure.overSoft).toBe(true)
  expect(hugeSingleLeafPressure.softPressureReason).toBe("global_soft_threshold")

  expect(
    computeTokenBudget({
      ...budget,
      activeTokens: 1,
      systemPromptTokens: 0,
      toolSchemaTokens: 0,
      explicitOutputReserve: -1,
    }).outputReserve,
  ).toBe(0)
  expect(
    computeTokenBudget({
      providerContextLimit: 1000,
      providerOutputLimit: 500,
      providerOutputReserve: 120,
      activeTokens: 1,
      systemPromptTokens: 0,
      toolSchemaTokens: 0,
    }).outputReserve,
  ).toBe(120)
  expect(() =>
    computeTokenBudget({
      providerContextLimit: 1000,
      activeTokens: 1,
      systemPromptTokens: 0,
      toolSchemaTokens: 0,
      softRatio: 1,
      hardRatio: 0.5,
    }),
  ).toThrow("lcm_token_budget_soft_ratio_exceeds_hard_ratio")
})

test("lcm:token-budget below-soft raw backlog can request bounded leaf maintenance", () => {
  const base = {
    conversationID: "conv_m11_below_soft_backlog" as ConversationID,
    strategy: "upward" as const,
    budget: {
      providerContextLimit: 1_000_000,
      providerOutputLimit: 16_000,
      activeTokens: 42_000,
      systemPromptTokens: 1000,
      toolSchemaTokens: 1000,
    },
    laneItems: [],
    protectedTailRawTokens: 2000,
    protectedTailRawItemCount: 2,
  }

  const decision = computeThresholdDecision({
    ...base,
    softBacklogTokens: 20_001,
    softBacklogItemCount: 3,
    softBacklogLargestSourceTokens: 12_000,
  })
  expect(decision.activeTokens).toBeLessThan(decision.softThreshold)
  expect(decision.rawLaneTokens).toBeLessThan(decision.softThreshold)
  expect(decision.overSoft).toBe(true)
  expect(decision.softPressureReason).toBe("below_soft_raw_backlog")
  expect(decision.softBacklogLargestSourceTokens).toBe(12_000)
  expect(decision.lanes.rawLeaves).toMatchObject({
    overTarget: true,
    eligibleItemCount: 3,
    nextAction: "summarize_leaves",
  })

  const tiny = computeThresholdDecision({
    ...base,
    softBacklogTokens: 19_999,
    softBacklogItemCount: 3,
    softBacklogLargestSourceTokens: 10_000,
  })
  expect(tiny.overSoft).toBe(false)
  expect(tiny.softPressureReason).toBeUndefined()

  const tooFewMessages = computeThresholdDecision({
    ...base,
    softBacklogTokens: 50_000,
    softBacklogItemCount: 2,
    softBacklogLargestSourceTokens: 30_000,
  })
  expect(tooFewMessages.overSoft).toBe(false)
  expect(tooFewMessages.lanes.rawLeaves.nextAction).toBe("none")
})

test("lcm:token-budget lane latches enter, stay above target, exit at target, and reset on strategy switch", () => {
  const first = updateLcmLaneLatches({
    nowMs: 100,
    decision: computeThresholdDecision({
      conversationID: "conv_m11_latch" as ConversationID,
      strategy: "dolt",
      budget: {
        providerContextLimit: 1_000_000,
        providerOutputLimit: 16_000,
        activeTokens: 60_000,
        systemPromptTokens: 1000,
        toolSchemaTokens: 1000,
      },
      laneItems: [
        { itemType: "summary", tokenCount: 3250, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 3250, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 3250, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 3250, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 1000, summaryType: "bindle", summaryLevel: 1 },
      ],
      softBacklogTokens: 0,
      softBacklogItemCount: 0,
    }),
  })
  expect(first.decision.lanes.sprigs.latch).toMatchObject({
    phase: "entered",
    lane: "sprigs",
    enteredReason: "global_soft_threshold",
    enteredPressure: 13_000,
    targetTokens: 10_000,
    nextAction: "condense_summaries",
  })

  const stayed = updateLcmLaneLatches({
    nowMs: 200,
    latches: first.latches,
    decision: computeThresholdDecision({
      conversationID: "conv_m11_latch" as ConversationID,
      strategy: "dolt",
      budget: {
        providerContextLimit: 1_000_000,
        providerOutputLimit: 16_000,
        activeTokens: 58_000,
        systemPromptTokens: 1000,
        toolSchemaTokens: 1000,
      },
      laneItems: [
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 1000, summaryType: "bindle", summaryLevel: 1 },
      ],
      softBacklogTokens: 0,
      softBacklogItemCount: 0,
    }),
  })
  expect(stayed.decision.lanes.sprigs.latch).toMatchObject({
    phase: "staying",
    lastObservedPressure: 11_000,
    targetTokens: 10_000,
  })
  expect(stayed.decision.lanes.sprigs.nextAction).toBe("condense_summaries")

  const exited = updateLcmLaneLatches({
    nowMs: 300,
    latches: stayed.latches,
    decision: computeThresholdDecision({
      conversationID: "conv_m11_latch" as ConversationID,
      strategy: "dolt",
      budget: {
        providerContextLimit: 1_000_000,
        providerOutputLimit: 16_000,
        activeTokens: 52_000,
        systemPromptTokens: 1000,
        toolSchemaTokens: 1000,
      },
      laneItems: [
        { itemType: "summary", tokenCount: 2500, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2500, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2500, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2500, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 1000, summaryType: "bindle", summaryLevel: 1 },
      ],
      softBacklogTokens: 0,
      softBacklogItemCount: 0,
    }),
  })
  expect(exited.decision.lanes.sprigs.latch).toMatchObject({
    phase: "exited",
    exitReason: "at_or_below_target",
  })
  expect(exited.latches.size).toBe(0)

  const switched = updateLcmLaneLatches({
    nowMs: 400,
    latches: first.latches,
    decision: computeThresholdDecision({
      conversationID: "conv_m11_latch" as ConversationID,
      strategy: "upward",
      budget: {
        providerContextLimit: 1_000_000,
        providerOutputLimit: 16_000,
        activeTokens: 58_000,
        systemPromptTokens: 1000,
        toolSchemaTokens: 1000,
      },
      laneItems: [
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
        { itemType: "summary", tokenCount: 2750, summaryType: "sprig", summaryLevel: 0 },
      ],
      softBacklogTokens: 0,
      softBacklogItemCount: 0,
    }),
  })
  expect(switched.decision.lanes.sprigs.latch).toMatchObject({
    phase: "exited",
    exitReason: "strategy_changed",
  })
})

test("lcm:token-budget lane latches can be cleared after terminal maintenance failure or cancellation", () => {
  const entered = updateLcmLaneLatches({
    nowMs: 100,
    decision: computeThresholdDecision({
      conversationID: "conv_m11_latch_clear" as ConversationID,
      strategy: "upward",
      budget: {
        providerContextLimit: 1_000_000,
        providerOutputLimit: 16_000,
        activeTokens: 30_000,
        systemPromptTokens: 1000,
        toolSchemaTokens: 1000,
      },
      laneItems: [],
      softBacklogTokens: 22_000,
      softBacklogItemCount: 3,
    }),
  })
  const latches = new Map(entered.latches)
  expect(latches.size).toBe(1)

  clearLcmLaneLatch({
    latches,
    conversationID: "conv_m11_latch_clear" as ConversationID,
    lane: "raw_leaves",
  })
  expect(latches.size).toBe(0)
})

test("lcm:token-budget default output reserve scales with resolved context size", () => {
  const reserveFor = (providerContextLimit: number) =>
    computeTokenBudget({
      providerContextLimit,
      providerOutputLimit: providerContextLimit,
      activeTokens: 1,
      systemPromptTokens: 0,
      toolSchemaTokens: 0,
    }).outputReserve

  expect(reserveFor(32_000)).toBe(4096)
  expect(reserveFor(64_000)).toBe(7680)
  expect(reserveFor(100_000)).toBe(12_000)
  expect(reserveFor(128_000)).toBe(15_360)
  expect(reserveFor(200_000)).toBe(20_000)
})

test("token-counter-mode-v1 counters and cache keys preserve mode/version invalidation", () => {
  expect(deterministicFallbackTokenCount("abcd")).toBe(1)
  expect(deterministicFallbackTokenCount("abcde")).toBe(2)
  const fallback = createDeterministicFallbackTokenCounter()
  expect(fallback.mode).toBe("deterministic_fallback")
  expect(fallback.version).toBe(LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION)

  const providerKey = createTokenCacheKey({
    mode: "provider",
    version: "provider-counter-test",
    providerID: "provider",
    modelID: "model",
    contentKind: "message",
    contentID: "msg_1",
    contentSha256: "a".repeat(64),
  })
  const fallbackKey = createTokenCacheKey({
    mode: "deterministic_fallback",
    version: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
    providerID: "provider",
    modelID: "model",
    contentKind: "message",
    contentID: "msg_1",
    contentSha256: "a".repeat(64),
  })
  expect(providerKey).toMatch(/^[0-9a-f]{64}$/)
  expect(providerKey).not.toBe(fallbackKey)
  expect(createFakeTokenCounter({ [providerKey]: 42 }).countText({ text: "ignored", cacheKey: providerKey })).toBe(42)
})

test("lcm:token-budget lane decisions cover upward and dolt pressure rules", () => {
  const upward = computeLaneDecisions({
    strategy: "upward",
    overHard: true,
    totals: {
      rawLeaves: { tokens: 25_000, itemCount: 5 },
      sprigs: { tokens: 2201, itemCount: 2 },
      bindles: { tokens: 100, itemCount: 1 },
      archiveStubs: { tokens: 0, itemCount: 0 },
      largeFileMarkers: { tokens: 90, itemCount: 1 },
      retrievalCues: { tokens: 1300, itemCount: 3 },
    },
  })
  expect(upward.rawLeaves).toMatchObject({ overTarget: true, eligibleItemCount: 3, nextAction: "summarize_leaves" })
  expect(upward.sprigs).toMatchObject({ overTarget: true, eligibleItemCount: 2, nextAction: "condense_summaries" })
  expect(upward.retrievalCues).toMatchObject({ overTarget: true, targetTokens: 1200 })

  const doltTotals = {
    rawLeaves: { tokens: 55_000, itemCount: 10 },
    sprigs: { tokens: 12_000, itemCount: 4 },
    bindles: { tokens: 12_000, itemCount: 1 },
    archiveStubs: { tokens: 0, itemCount: 0 },
    largeFileMarkers: { tokens: 0, itemCount: 0 },
    retrievalCues: { tokens: 0, itemCount: 0 },
  }
  const belowHysteresis = computeLaneDecisions({
    strategy: "dolt",
    overHard: false,
    totals: doltTotals,
  })
  expect(belowHysteresis.rawLeaves.overTarget).toBe(false)
  const hardPressure = computeLaneDecisions({
    strategy: "dolt",
    overHard: true,
    totals: { ...doltTotals, rawLeaves: { tokens: 50_001, itemCount: 10 } },
  })
  expect(hardPressure.rawLeaves).toMatchObject({ overTarget: true, eligibleItemCount: 6 })
})

test("provider-model-selection-v1 fails closed when provider context limit is missing", () => {
  expect(() =>
    computeThresholdDecision({
      conversationID: "conv_m11_missing_limit" as ConversationID,
      strategy: "upward",
      budget: {
        providerContextLimit: 0,
        activeTokens: 1,
        systemPromptTokens: 0,
        toolSchemaTokens: 0,
      },
      laneItems: [],
    }),
  ).toThrow("lcm_token_budget_invalid_context_limit")
})

test("provider-model-selection-v1 normalizes invalid model limits through conservative fallbacks", () => {
  const anthropic = resolveLcmModelLimits(
    modelWithLimits({
      npm: "@ai-sdk/anthropic",
      family: "claude",
      releaseDate: "2026-01-01",
      limit: { context: 0, input: -1, output: 0 },
    }),
  )
  expect(anthropic).toEqual({
    context: 200_000,
    output: 8_192,
    budgetStatus: "provider_limit_fallback",
  })

  const clamped = resolveLcmModelLimits(
    modelWithLimits({
      npm: "@ai-sdk/openai",
      family: "gpt",
      releaseDate: "2026-01-01",
      limit: { context: 4_000, input: 9_000, output: 20_000 },
    }),
  )
  expect(clamped).toEqual({
    context: 4_000,
    input: 4_000,
    output: 4_000,
    budgetStatus: "provider_limit_fallback",
  })
})

test("provider-model-selection-v1 marks fallback budgets in threshold decisions", () => {
  const decision = computeThresholdDecision({
    conversationID: "conv_m11_fallback_budget" as ConversationID,
    strategy: "upward",
    budgetStatus: "provider_limit_fallback",
    budget: {
      providerContextLimit: 64_000,
      providerOutputLimit: 8_192,
      activeTokens: 12_000,
      systemPromptTokens: 500,
      toolSchemaTokens: 500,
    },
    laneItems: [],
  })
  expect(decision.budgetStatus).toBe("provider_limit_fallback")
})

test("LcmContext.isOverThreshold persists threshold snapshots and invalidates cache keys", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(
      request({
        run: async (db) => seedRecoveryConversationFixture(db as PGlite),
      }),
    )

    const firstInput = {
      conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
      renderOptions: renderOptions({ manifestSeed: "a" }),
      providerContextLimit: 40,
      providerOutputLimit: 5,
      systemPromptText: "abcd",
      toolSchemaText: "abcd",
    } satisfies LcmRawLeafThresholdInput
    const first = await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(firstInput)),
    )
    expect(first.outputReserve).toBe(5)
    expect(first.systemPromptTokens).toBe(1)
    expect(first.toolSchemaTokens).toBe(1)
    expect(first.activeTokens).toBeGreaterThan(0)

    const cached = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{
              cache_key: string
              token_count: number
              snapshot_mode: string
              snapshot_version: string
              hard_limit: number
              soft_threshold: number
              soft_backlog_tokens: number
              soft_backlog_item_count: number
            }>(
              `
                SELECT
                  ci.cache_key,
                  ci.token_count,
                  s.token_counter_mode AS snapshot_mode,
                  s.token_counter_version AS snapshot_version,
                  s.hard_limit,
                  s.soft_threshold,
                  s.soft_backlog_tokens,
                  s.soft_backlog_item_count
                FROM lcm_context_items ci
                CROSS JOIN LATERAL (
                  SELECT token_counter_mode, token_counter_version, hard_limit, soft_threshold, soft_backlog_tokens, soft_backlog_item_count
                  FROM lcm_context_snapshots
                  WHERE conversation_id = ci.conversation_id
                  ORDER BY created_at_ms DESC, snapshot_id DESC
                  LIMIT 1
                ) s
                WHERE ci.conversation_id = $1
                ORDER BY ci.item_order
                LIMIT 1
              `,
              [LCM_RECOVERY_FIXTURE_IDS.conversationID],
            )
          ).rows[0],
      }),
    )
    expect(cached.token_count).toBeGreaterThan(0)
    expect(cached.snapshot_mode).toBe("deterministic_fallback")
    expect(cached.snapshot_version).toBe(LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION)
    expect(cached.hard_limit).toBe(first.hardLimit)
    expect(cached.soft_threshold).toBe(first.softThreshold)
    expect(cached.soft_backlog_tokens).toBe(first.softBacklogTokens)
    expect(cached.soft_backlog_item_count).toBe(first.softBacklogItemCount)

    const secondInput = {
      conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
      renderOptions: renderOptions({ modelID: "model-m11-b", manifestSeed: "b" }),
      providerContextLimit: 40,
      providerOutputLimit: 5,
      systemPromptText: "abcd",
      toolSchemaText: "abcd",
    } satisfies LcmRawLeafThresholdInput
    await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(secondInput)),
    )
    const invalidated = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{ cache_key: string }>(
              "SELECT cache_key FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order LIMIT 1",
              [LCM_RECOVERY_FIXTURE_IDS.conversationID],
            )
          ).rows[0],
      }),
    )
    expect(invalidated.cache_key).not.toBe(cached.cache_key)
  } finally {
    await worker.close()
  }
})

test("LcmContext.isOverThreshold applies persisted provider-transform overhead reserve", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(
      request({
        run: async (db) => {
          const typedDb = db as PGlite
          await seedRecoveryConversationFixture(typedDb)
          await typedDb.query(
            `
              INSERT INTO lcm_provider_transform_overheads (
                provider_id,
                model_id,
                provider_family,
                max_observed_tokens,
                last_observed_tokens,
                sample_count,
                created_at_ms,
                updated_at_ms
              )
              VALUES ('provider-m11', 'model-m11', 'generic', 120, 120, 1, 1777500000000, 1777500000000)
            `,
          )
        },
      }),
    )

    const decision = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.isOverThreshold({
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          renderOptions: renderOptions(),
          providerContextLimit: 1_000,
          providerOutputLimit: 100,
        } satisfies LcmRawLeafThresholdInput),
      ),
    )
    expect(decision.providerInputLimit).toBe(900)

    const metrics = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{ metrics_json: { providerTransformOverheadReserveTokens?: number } }>(
              `
                SELECT metrics_json
                FROM lcm_context_snapshots
                WHERE conversation_id = $1
                ORDER BY created_at_ms DESC, snapshot_id DESC
                LIMIT 1
              `,
              [LCM_RECOVERY_FIXTURE_IDS.conversationID],
            )
          ).rows[0]?.metrics_json,
      }),
    )
    expect(metrics.providerTransformOverheadReserveTokens).toBe(100)
  } finally {
    await worker.close()
  }
})

test("token-counter-mode-v1 provider-mode snapshot metadata is preserved when injected by fixture", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const providerCounter: LcmTokenCounter = {
    mode: "provider",
    version: "lcm-provider-token-counter-v1-fixture",
    countText: ({ text }) => Math.max(1, Math.ceil(text.length / 10)),
  }
  try {
    await worker.executeForeground(request({ run: async (db) => seedRecoveryConversationFixture(db as PGlite) }))
    const input = {
      conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
      renderOptions: renderOptions(),
      providerContextLimit: 100,
      providerOutputLimit: 10,
      tokenCounter: providerCounter,
    } satisfies LcmRawLeafThresholdInput
    await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(input)),
    )
    const snapshot = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{ token_counter_mode: string; token_counter_version: string }>(
              `
                SELECT token_counter_mode, token_counter_version
                FROM lcm_context_snapshots
                WHERE conversation_id = $1
                ORDER BY created_at_ms DESC, snapshot_id DESC
                LIMIT 1
              `,
              [LCM_RECOVERY_FIXTURE_IDS.conversationID],
            )
          ).rows[0],
      }),
    )
    expect(snapshot).toEqual({
      token_counter_mode: "provider",
      token_counter_version: "lcm-provider-token-counter-v1-fixture",
    })
  } finally {
    await worker.close()
  }
})

test("render manifest hash participates in token-cache identity", () => {
  expect(renderManifestHash(renderOptions({ manifestSeed: "a" }).renderInputManifest)).not.toBe(
    renderManifestHash(renderOptions({ manifestSeed: "b" }).renderInputManifest),
  )
})
