// kilocode_change - new file
import { createHash } from "node:crypto"
import { RUNTIME_DEFAULTS } from "./config"
import { canonicalJson } from "./validators"
import type {
  ContextItemType,
  ConversationID,
  LcmLaneDecision,
  LcmLaneKey,
  LcmLaneLatchDiagnostic,
  LcmLaneLatchEnteredReason,
  LcmLaneLatchExitReason,
  LcmLaneLatchState,
  LcmBudgetStatus,
  LcmSoftPressureReason,
  LcmStrategy,
  LcmThresholdDecision,
  LcmTokenCounterMode,
} from "./types"

export const LCM_TOKEN_BUDGET_CACHE_VERSION = 11
export const LCM_PROVIDER_TOKEN_COUNTER_VERSION = "lcm-provider-token-counter-v1"
export const LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION = "lcm-deterministic-fallback-token-counter-v1"
export const LCM_FAKE_TOKEN_COUNTER_VERSION = "lcm-fake-token-counter-v1"
export const LCM_DYNAMIC_OUTPUT_RESERVE_MIN_TOKENS = 4096
export const LCM_DYNAMIC_OUTPUT_RESERVE_MAX_TOKENS = 20_000
export const LCM_DYNAMIC_OUTPUT_RESERVE_CONTEXT_RATIO = 0.12

export class LcmTokenBudgetError extends Error {
  constructor(readonly diagnosticCode: string) {
    super(diagnosticCode)
    this.name = "LcmTokenBudgetError"
  }
}

export interface LcmTokenCounter {
  readonly mode: LcmTokenCounterMode
  readonly version: string
  readonly countText: (input: { text: string; cacheKey?: string }) => number
}

export interface TokenCacheKeyInput {
  readonly mode: LcmTokenCounterMode
  readonly version: string
  readonly providerID?: string
  readonly modelID?: string
  readonly contentKind: "message" | "summary" | "prompt" | "tool_schema" | "marker" | "cue"
  readonly contentID?: string
  readonly contentSha256?: string
  readonly renderManifestHash?: string
  readonly promptVersion?: string
  readonly wrapperVersion?: string
}

export interface LcmTokenBudgetInput {
  readonly providerContextLimit: number
  readonly providerInputLimit?: number
  readonly providerOutputLimit?: number
  readonly tokenCounterMode?: LcmTokenCounterMode
  readonly tokenCounterVersion?: string
  readonly explicitOutputReserve?: number
  readonly providerOutputReserve?: number
  readonly softRatio?: number
  readonly hardRatio?: number
  readonly activeTokens: number
  readonly systemPromptTokens: number
  readonly toolSchemaTokens: number
}

export interface LcmTokenBudgetResult {
  readonly activeTokens: number
  readonly hardLimit: number
  readonly softThreshold: number
  readonly outputReserve: number
  readonly systemPromptTokens: number
  readonly toolSchemaTokens: number
  readonly overHard: boolean
  readonly providerContextLimit: number
  readonly providerInputLimit?: number
  readonly providerOutputLimit?: number
  readonly hardFillRatio: number
  readonly tokenCounterMode: LcmTokenCounterMode
  readonly tokenCounterVersion: string
  readonly outputReserveSource: "explicit_config" | "provider_override" | "dynamic_default"
  readonly effectiveInputWindow: number
  readonly activeInputWindow: number
}

export interface LcmLaneSourceItem {
  readonly itemType: ContextItemType
  readonly tokenCount: number
  readonly summaryType?: "sprig" | "bindle" | "archive_stub"
  readonly summaryLevel?: number
}

export interface LcmLaneTokenTotals {
  readonly rawLeaves: { tokens: number; itemCount: number }
  readonly sprigs: { tokens: number; itemCount: number }
  readonly bindles: { tokens: number; itemCount: number }
  readonly archiveStubs: { tokens: number; itemCount: number }
  readonly largeFileMarkers: { tokens: number; itemCount: number }
  readonly retrievalCues: { tokens: number; itemCount: number }
}

export type LcmLaneLatchMap = ReadonlyMap<string, LcmLaneLatchState>

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function fail(diagnosticCode: string): never {
  throw new LcmTokenBudgetError(diagnosticCode)
}

function floorFinite(value: number, diagnosticCode: string) {
  if (!Number.isFinite(value)) fail(diagnosticCode)
  return Math.floor(value)
}

function nonNegativeInt(value: number, diagnosticCode: string) {
  return Math.max(0, floorFinite(value, diagnosticCode))
}

function optionalNonNegativeInt(value: number | undefined, diagnosticCode: string) {
  if (value === undefined) return undefined
  return nonNegativeInt(value, diagnosticCode)
}

function positiveLimit(value: number, diagnosticCode: string) {
  const floored = floorFinite(value, diagnosticCode)
  if (floored <= 0) fail(diagnosticCode)
  return floored
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function ratio(value: number, diagnosticCode: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) fail(diagnosticCode)
  return value
}

export function computeDynamicDefaultOutputReserve(providerContextLimit: number) {
  const contextLimit = positiveLimit(providerContextLimit, "lcm_token_budget_invalid_context_limit")
  return clamp(
    Math.max(
      LCM_DYNAMIC_OUTPUT_RESERVE_MIN_TOKENS,
      Math.floor(contextLimit * LCM_DYNAMIC_OUTPUT_RESERVE_CONTEXT_RATIO),
    ),
    LCM_DYNAMIC_OUTPUT_RESERVE_MIN_TOKENS,
    LCM_DYNAMIC_OUTPUT_RESERVE_MAX_TOKENS,
  )
}

export function deterministicFallbackTokenCount(text: string) {
  return Math.ceil(text.length / 4)
}

export function createDeterministicFallbackTokenCounter(): LcmTokenCounter {
  return {
    mode: "deterministic_fallback",
    version: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
    countText: ({ text }) => deterministicFallbackTokenCount(text),
  }
}

export function createFakeTokenCounter(counts: Record<string, number>): LcmTokenCounter {
  return {
    mode: "fake",
    version: LCM_FAKE_TOKEN_COUNTER_VERSION,
    countText: ({ text, cacheKey }) => {
      const key = cacheKey ?? text
      const count = counts[key]
      if (count === undefined) fail("lcm_fake_token_counter_missing_fixture")
      return nonNegativeInt(count, "lcm_fake_token_counter_invalid_count")
    },
  }
}

export function stableTokenText(value: unknown) {
  return typeof value === "string" ? value : canonicalJson(value)
}

export function renderManifestHash(value: unknown) {
  return sha256Hex(canonicalJson(value ?? null))
}

export function createTokenCacheKey(input: TokenCacheKeyInput) {
  return sha256Hex(
    canonicalJson({
      cacheVersion: LCM_TOKEN_BUDGET_CACHE_VERSION,
      ...input,
    }),
  )
}

export function computeTokenBudget(input: LcmTokenBudgetInput): LcmTokenBudgetResult {
  const providerContextLimit = positiveLimit(input.providerContextLimit, "lcm_token_budget_invalid_context_limit")
  const providerInputLimit = optionalNonNegativeInt(input.providerInputLimit, "lcm_token_budget_invalid_input_limit")
  const providerOutputLimit =
    optionalNonNegativeInt(input.providerOutputLimit, "lcm_token_budget_invalid_output_limit") ?? providerContextLimit
  const softRatio = ratio(
    input.softRatio ?? RUNTIME_DEFAULTS.thresholds.softRatio,
    "lcm_token_budget_invalid_soft_ratio",
  )
  const hardRatio = ratio(
    input.hardRatio ?? RUNTIME_DEFAULTS.thresholds.hardRatio,
    "lcm_token_budget_invalid_hard_ratio",
  )
  if (softRatio > hardRatio) fail("lcm_token_budget_soft_ratio_exceeds_hard_ratio")

  const requestedReserve =
    input.explicitOutputReserve !== undefined
      ? floorFinite(input.explicitOutputReserve, "lcm_token_budget_invalid_explicit_output_reserve")
      : input.providerOutputReserve !== undefined
        ? floorFinite(input.providerOutputReserve, "lcm_token_budget_invalid_provider_output_reserve")
        : computeDynamicDefaultOutputReserve(providerContextLimit)
  const outputReserveSource =
    input.explicitOutputReserve !== undefined
      ? "explicit_config"
      : input.providerOutputReserve !== undefined
        ? "provider_override"
        : "dynamic_default"
  const reserveCap = Math.min(providerOutputLimit, Math.floor(providerContextLimit * 0.25), providerContextLimit)
  const outputReserve = clamp(requestedReserve, 0, reserveCap)

  const systemPromptTokens = nonNegativeInt(input.systemPromptTokens, "lcm_token_budget_invalid_system_tokens")
  const toolSchemaTokens = nonNegativeInt(input.toolSchemaTokens, "lcm_token_budget_invalid_tool_tokens")
  const activeTokens = nonNegativeInt(input.activeTokens, "lcm_token_budget_invalid_active_tokens")
  const tokenCounterMode = input.tokenCounterMode ?? "deterministic_fallback"
  const tokenCounterVersion = input.tokenCounterVersion ?? LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION
  const overheadTokens = systemPromptTokens + toolSchemaTokens
  const contextAfterReserve = Math.max(0, providerContextLimit - outputReserve)
  const effectiveInputWindow = Math.min(providerInputLimit ?? providerContextLimit, contextAfterReserve)
  const activeInputWindow = Math.max(0, effectiveInputWindow - overheadTokens)
  const hardLimit = clamp(Math.floor(effectiveInputWindow * hardRatio) - overheadTokens, 0, activeInputWindow)
  const softThreshold = clamp(Math.floor(effectiveInputWindow * softRatio) - overheadTokens, 0, hardLimit)

  return {
    activeTokens,
    hardLimit,
    softThreshold,
    outputReserve,
    systemPromptTokens,
    toolSchemaTokens,
    overHard: activeTokens > hardLimit,
    providerContextLimit,
    ...(input.providerInputLimit === undefined ? {} : { providerInputLimit: providerInputLimit ?? 0 }),
    ...(input.providerOutputLimit === undefined ? {} : { providerOutputLimit }),
    hardFillRatio: hardLimit > 0 ? activeTokens / hardLimit : 0,
    tokenCounterMode,
    tokenCounterVersion,
    outputReserveSource,
    effectiveInputWindow,
    activeInputWindow,
  }
}

function emptyLaneTokenTotals(): LcmLaneTokenTotals {
  return {
    rawLeaves: { tokens: 0, itemCount: 0 },
    sprigs: { tokens: 0, itemCount: 0 },
    bindles: { tokens: 0, itemCount: 0 },
    archiveStubs: { tokens: 0, itemCount: 0 },
    largeFileMarkers: { tokens: 0, itemCount: 0 },
    retrievalCues: { tokens: 0, itemCount: 0 },
  }
}

function addLane(total: { tokens: number; itemCount: number }, item: LcmLaneSourceItem) {
  total.tokens += nonNegativeInt(item.tokenCount, "lcm_lane_invalid_token_count")
  total.itemCount++
}

export function summarizeLaneTokens(items: readonly LcmLaneSourceItem[]): LcmLaneTokenTotals {
  const totals = emptyLaneTokenTotals()
  for (const item of items) {
    if (item.itemType === "raw_message") {
      addLane(totals.rawLeaves, item)
      continue
    }
    if (item.itemType === "summary") {
      if (item.summaryType === "bindle" || (item.summaryLevel ?? 0) > 0) addLane(totals.bindles, item)
      else addLane(totals.sprigs, item)
      continue
    }
    if (item.itemType === "archive_stub") {
      addLane(totals.archiveStubs, item)
      continue
    }
    if (item.itemType === "large_file_marker") {
      addLane(totals.largeFileMarkers, item)
      continue
    }
    addLane(totals.retrievalCues, item)
  }
  return totals
}

function laneDecision(input: {
  lane: LcmLaneKey
  tokens: number
  itemCount: number
  targetTokens: number
  softTokens?: number
  hysteresisDelta?: number
  overTarget: boolean
  eligibleItemCount: number
  nextAction: LcmLaneDecision["nextAction"]
}): LcmLaneDecision {
  return {
    lane: input.lane,
    tokens: nonNegativeInt(input.tokens, "lcm_lane_invalid_tokens"),
    itemCount: nonNegativeInt(input.itemCount, "lcm_lane_invalid_item_count"),
    targetTokens: nonNegativeInt(input.targetTokens, "lcm_lane_invalid_target_tokens"),
    ...(input.softTokens === undefined
      ? {}
      : { softTokens: nonNegativeInt(input.softTokens, "lcm_lane_invalid_soft_tokens") }),
    ...(input.hysteresisDelta === undefined
      ? {}
      : { hysteresisDelta: nonNegativeInt(input.hysteresisDelta, "lcm_lane_invalid_hysteresis_delta") }),
    overTarget: input.overTarget,
    eligibleItemCount: nonNegativeInt(input.eligibleItemCount, "lcm_lane_invalid_eligible_count"),
    nextAction: input.nextAction,
  }
}

function rawLaneTarget(strategy: LcmStrategy) {
  return strategy === "dolt" ? RUNTIME_DEFAULTS.dolt.leaves.target : RUNTIME_DEFAULTS.upward.leafChunkTokens
}

function rawLaneAction(lane: LcmLaneDecision): LcmLaneLatchState["nextAction"] {
  return lane.lane === "raw_leaves"
    ? "summarize_leaves"
    : lane.lane === "sprigs"
      ? "condense_summaries"
      : lane.nextAction === "create_archive_stub"
        ? "create_archive_stub"
        : "condense_summaries"
}

function latchingLanes(lanes: LcmThresholdDecision["lanes"]) {
  return [lanes.rawLeaves, lanes.sprigs, lanes.bindles] as const
}

export function lcmLaneLatchKey(input: { conversationID: ConversationID; lane: LcmLaneKey }) {
  return `${input.conversationID}:${input.lane}`
}

function lanePressure(input: { decision: LcmThresholdDecision; lane: LcmLaneDecision }) {
  return input.lane.lane === "raw_leaves" ? input.decision.softBacklogTokens : input.lane.tokens
}

function laneEnteredReason(input: {
  decision: LcmThresholdDecision
  lane: LcmLaneDecision
}): LcmLaneLatchEnteredReason {
  if (input.decision.overHard) return "hard_limit"
  if (input.lane.lane === "raw_leaves") return input.decision.softPressureReason ?? "global_soft_threshold"
  return "global_soft_threshold"
}

function latchExitReason(input: {
  previous: LcmLaneLatchState
  decision: LcmThresholdDecision
  lane: LcmLaneDecision
  pressure: number
}): LcmLaneLatchExitReason | undefined {
  if (input.previous.strategy !== input.decision.strategy) return "strategy_changed"
  if (input.pressure <= input.previous.targetTokens) return "at_or_below_target"
  if (input.lane.eligibleItemCount <= 0) return "no_eligible_items"
  return undefined
}

function laneDecisionKey(lane: LcmLaneKey): keyof LcmThresholdDecision["lanes"] | undefined {
  if (lane === "raw_leaves") return "rawLeaves"
  if (lane === "sprigs") return "sprigs"
  if (lane === "bindles") return "bindles"
  if (lane === "archive_stubs") return "archiveStubs"
  if (lane === "large_file_markers") return "largeFileMarkers"
  if (lane === "retrieval_cues") return "retrievalCues"
  return undefined
}

function withLatchedLane(lanes: LcmThresholdDecision["lanes"], lane: LcmLaneDecision, latch: LcmLaneLatchDiagnostic) {
  const key = laneDecisionKey(lane.lane)
  if (!key) return lanes
  return {
    ...lanes,
    [key]: {
      ...lane,
      overTarget: latch.phase === "exited" ? lane.overTarget : true,
      nextAction: latch.phase === "exited" ? lane.nextAction : latch.nextAction,
      latch,
    },
  } satisfies LcmThresholdDecision["lanes"]
}

export function updateLcmLaneLatches(input: {
  readonly decision: LcmThresholdDecision
  readonly latches?: LcmLaneLatchMap
  readonly nowMs?: number
}): { readonly decision: LcmThresholdDecision; readonly latches: ReadonlyMap<string, LcmLaneLatchState> } {
  const nowMs = input.nowMs ?? Date.now()
  const nextLatches = new Map(input.latches ?? [])
  let lanes = input.decision.lanes
  const diagnostics: LcmLaneLatchDiagnostic[] = []

  for (const baseLane of latchingLanes(input.decision.lanes)) {
    const key = lcmLaneLatchKey({ conversationID: input.decision.conversationID, lane: baseLane.lane })
    const previous = nextLatches.get(key)
    const pressure = lanePressure({ decision: input.decision, lane: baseLane })
    const exitReason = previous
      ? latchExitReason({ previous, decision: input.decision, lane: baseLane, pressure })
      : undefined
    if (exitReason) {
      nextLatches.delete(key)
      const diagnostic = {
        ...previous!,
        phase: "exited",
        lastObservedPressure: pressure,
        updatedAtMs: nowMs,
        exitReason,
      } satisfies LcmLaneLatchDiagnostic
      diagnostics.push(diagnostic)
      lanes = withLatchedLane(lanes, baseLane, diagnostic)
      continue
    }

    if (previous) {
      const state = {
        ...previous,
        lastObservedPressure: pressure,
        updatedAtMs: nowMs,
      } satisfies LcmLaneLatchState
      nextLatches.set(key, state)
      const diagnostic = { ...state, phase: "staying" } satisfies LcmLaneLatchDiagnostic
      diagnostics.push(diagnostic)
      lanes = withLatchedLane(lanes, baseLane, diagnostic)
      continue
    }

    if (baseLane.nextAction === "none" || baseLane.eligibleItemCount <= 0 || pressure <= baseLane.targetTokens) {
      continue
    }

    const state = {
      lane: baseLane.lane,
      conversationID: input.decision.conversationID,
      strategy: input.decision.strategy,
      enteredReason: laneEnteredReason({ decision: input.decision, lane: baseLane }),
      enteredPressure: pressure,
      targetTokens: baseLane.targetTokens,
      lastObservedPressure: pressure,
      updatedAtMs: nowMs,
      nextAction: rawLaneAction(baseLane),
    } satisfies LcmLaneLatchState
    nextLatches.set(key, state)
    const diagnostic = { ...state, phase: "entered" } satisfies LcmLaneLatchDiagnostic
    diagnostics.push(diagnostic)
    lanes = withLatchedLane(lanes, baseLane, diagnostic)
  }

  const decision =
    diagnostics.length === 0
      ? input.decision
      : {
          ...input.decision,
          lanes,
          laneLatchDiagnostics: diagnostics,
          overSoft:
            input.decision.overSoft ||
            diagnostics.some(
              (diagnostic) =>
                diagnostic.lane === "raw_leaves" &&
                diagnostic.phase !== "exited" &&
                diagnostic.nextAction === "summarize_leaves",
            ),
          softPressureReason:
            input.decision.softPressureReason ??
            (diagnostics.some((diagnostic) => diagnostic.lane === "raw_leaves" && diagnostic.phase !== "exited")
              ? "lane_latch"
              : undefined),
        }
  return { decision, latches: nextLatches }
}

export function clearLcmLaneLatch(input: {
  readonly latches: Map<string, LcmLaneLatchState>
  readonly conversationID: ConversationID
  readonly lane: LcmLaneKey
}) {
  input.latches.delete(lcmLaneLatchKey({ conversationID: input.conversationID, lane: input.lane }))
}

function doltPressure(input: {
  tokens: number
  target: number
  soft: number
  hysteresisDelta: number
  overHard: boolean
}) {
  return input.overHard ? input.tokens > input.target : input.tokens > input.soft + input.hysteresisDelta
}

export function computeLaneDecisions(input: {
  readonly strategy: LcmStrategy
  readonly totals: LcmLaneTokenTotals
  readonly overHard: boolean
  readonly softThreshold?: number
  readonly rawLaneTokens?: number
  readonly softBacklogItemCount?: number
  readonly overSoft?: boolean
}): LcmThresholdDecision["lanes"] {
  const cfg = RUNTIME_DEFAULTS
  if (input.strategy === "dolt") {
    const rawEligible =
      !input.overHard && input.softBacklogItemCount !== undefined
        ? input.softBacklogItemCount
        : Math.max(0, input.totals.rawLeaves.itemCount - cfg.dolt.leaves.freshTailFloor)
    const rawOver = input.overHard
      ? doltPressure({
          ...cfg.dolt.leaves,
          tokens: input.totals.rawLeaves.tokens,
          overHard: input.overHard,
        })
      : input.rawLaneTokens !== undefined && input.softThreshold !== undefined
        ? input.overSoft
          ? input.rawLaneTokens > cfg.dolt.leaves.target
          : input.rawLaneTokens > input.softThreshold
        : doltPressure({
            ...cfg.dolt.leaves,
            tokens: input.totals.rawLeaves.tokens,
            overHard: input.overHard,
          })
    const sprigFanout = input.overHard ? cfg.dolt.sprigs.hardMinFanout : cfg.dolt.sprigs.minFanout
    const sprigEligible = input.totals.sprigs.itemCount >= sprigFanout ? input.totals.sprigs.itemCount : 0
    const sprigOver = doltPressure({ ...cfg.dolt.sprigs, tokens: input.totals.sprigs.tokens, overHard: input.overHard })
    const bindleOver = doltPressure({
      ...cfg.dolt.bindles,
      tokens: input.totals.bindles.tokens,
      overHard: input.overHard,
    })
    const bindleEligible = input.totals.bindles.itemCount > 0 ? input.totals.bindles.itemCount : 0
    return {
      rawLeaves: laneDecision({
        lane: "raw_leaves",
        ...input.totals.rawLeaves,
        targetTokens: cfg.dolt.leaves.target,
        softTokens: cfg.dolt.leaves.soft,
        hysteresisDelta: cfg.dolt.leaves.hysteresisDelta,
        overTarget: rawOver,
        eligibleItemCount: rawEligible,
        nextAction:
          (input.overHard ? rawOver : (input.overSoft ?? rawOver)) && rawEligible > 0 ? "summarize_leaves" : "none",
      }),
      sprigs: laneDecision({
        lane: "sprigs",
        ...input.totals.sprigs,
        targetTokens: cfg.dolt.sprigs.target,
        softTokens: cfg.dolt.sprigs.soft,
        hysteresisDelta: cfg.dolt.sprigs.hysteresisDelta,
        overTarget: sprigOver,
        eligibleItemCount: sprigEligible,
        nextAction: sprigOver && sprigEligible > 0 ? "condense_summaries" : "none",
      }),
      bindles: laneDecision({
        lane: "bindles",
        ...input.totals.bindles,
        targetTokens: cfg.dolt.bindles.target,
        softTokens: cfg.dolt.bindles.soft,
        hysteresisDelta: cfg.dolt.bindles.hysteresisDelta,
        overTarget: bindleOver,
        eligibleItemCount: bindleEligible,
        nextAction:
          bindleOver && bindleEligible > 0 && cfg.dolt.bindles.archiveStubEviction ? "create_archive_stub" : "none",
      }),
      archiveStubs: laneDecision({
        lane: "archive_stubs",
        ...input.totals.archiveStubs,
        targetTokens: 0,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      }),
      largeFileMarkers: laneDecision({
        lane: "large_file_markers",
        ...input.totals.largeFileMarkers,
        targetTokens: 0,
        overTarget: false,
        eligibleItemCount: input.totals.largeFileMarkers.itemCount,
        nextAction: "none",
      }),
      retrievalCues: laneDecision({
        lane: "retrieval_cues",
        ...input.totals.retrievalCues,
        targetTokens: cfg.retrieval.maxMemoryCueTotalTokens,
        overTarget: input.totals.retrievalCues.tokens > cfg.retrieval.maxMemoryCueTotalTokens,
        eligibleItemCount: input.totals.retrievalCues.itemCount,
        nextAction: "none",
      }),
    }
  }

  const rawProtectedTail = input.overHard ? cfg.performance.minProtectedTailLeaves : cfg.upward.freshTailCount
  const rawEligible =
    !input.overHard && input.softBacklogItemCount !== undefined
      ? input.softBacklogItemCount
      : Math.max(0, input.totals.rawLeaves.itemCount - rawProtectedTail)
  const rawOver = input.overHard
    ? input.totals.rawLeaves.tokens > cfg.upward.leafChunkTokens
    : input.rawLaneTokens !== undefined && input.softThreshold !== undefined
      ? input.overSoft
        ? input.rawLaneTokens > cfg.upward.leafChunkTokens
        : input.rawLaneTokens > input.softThreshold
      : input.totals.rawLeaves.tokens > cfg.upward.leafChunkTokens
  const summaryFanout = input.overHard ? cfg.upward.condensedMinFanoutHard : cfg.upward.condensedMinFanout
  const sprigEligible = input.totals.sprigs.itemCount >= summaryFanout ? input.totals.sprigs.itemCount : 0
  const bindleEligible = input.totals.bindles.itemCount >= summaryFanout ? input.totals.bindles.itemCount : 0
  const sprigOver = input.totals.sprigs.tokens > cfg.upward.condensedTargetTokens
  const bindleOver = input.totals.bindles.tokens > cfg.upward.condensedTargetTokens

  return {
    rawLeaves: laneDecision({
      lane: "raw_leaves",
      ...input.totals.rawLeaves,
      targetTokens: cfg.upward.leafChunkTokens,
      overTarget: rawOver,
      eligibleItemCount: rawEligible,
      nextAction:
        (input.overHard ? rawOver : (input.overSoft ?? rawOver)) && rawEligible > 0 ? "summarize_leaves" : "none",
    }),
    sprigs: laneDecision({
      lane: "sprigs",
      ...input.totals.sprigs,
      targetTokens: cfg.upward.condensedTargetTokens,
      overTarget: sprigOver,
      eligibleItemCount: sprigEligible,
      nextAction: sprigOver && sprigEligible > 0 ? "condense_summaries" : "none",
    }),
    bindles: laneDecision({
      lane: "bindles",
      ...input.totals.bindles,
      targetTokens: cfg.upward.condensedTargetTokens,
      overTarget: bindleOver,
      eligibleItemCount: bindleEligible,
      nextAction: bindleOver && bindleEligible > 0 ? "condense_summaries" : "none",
    }),
    archiveStubs: laneDecision({
      lane: "archive_stubs",
      ...input.totals.archiveStubs,
      targetTokens: 0,
      overTarget: false,
      eligibleItemCount: 0,
      nextAction: "none",
    }),
    largeFileMarkers: laneDecision({
      lane: "large_file_markers",
      ...input.totals.largeFileMarkers,
      targetTokens: 0,
      overTarget: false,
      eligibleItemCount: input.totals.largeFileMarkers.itemCount,
      nextAction: "none",
    }),
    retrievalCues: laneDecision({
      lane: "retrieval_cues",
      ...input.totals.retrievalCues,
      targetTokens: cfg.retrieval.maxMemoryCueTotalTokens,
      overTarget: input.totals.retrievalCues.tokens > cfg.retrieval.maxMemoryCueTotalTokens,
      eligibleItemCount: input.totals.retrievalCues.itemCount,
      nextAction: "none",
    }),
  }
}

export function computeMinUsefulSoftSourceTokens(strategy: LcmStrategy, softThreshold = 0) {
  const sourceTarget =
    strategy === "dolt" ? RUNTIME_DEFAULTS.dolt.leaves.target : RUNTIME_DEFAULTS.upward.leafChunkTokens
  const summaryTarget = RUNTIME_DEFAULTS.performance.summaryTargetTokens
  const adaptiveFloor = Math.max(Math.floor(summaryTarget * 0.5), Math.floor(Math.max(0, softThreshold) * 0.25))
  return Math.max(1, Math.min(sourceTarget, summaryTarget * 3, adaptiveFloor))
}

export function computeThresholdDecision(input: {
  readonly conversationID: ConversationID
  readonly strategy: LcmStrategy
  readonly budgetStatus?: LcmBudgetStatus
  readonly budget: LcmTokenBudgetInput
  readonly laneItems: readonly LcmLaneSourceItem[]
  readonly freshTailTokens?: number
  readonly softBacklogTokens?: number
  readonly softBacklogItemCount?: number
  readonly softBacklogLargestSourceTokens?: number
  readonly freshTailRawTokens?: number
  readonly freshTailRawItemCount?: number
  readonly unconsumedRawTokens?: number
  readonly unconsumedRawItemCount?: number
  readonly protectedTailRawTokens?: number
  readonly protectedTailRawItemCount?: number
}): LcmThresholdDecision {
  const budget = computeTokenBudget(input.budget)
  const laneTotals = summarizeLaneTokens(input.laneItems)
  const softBacklogTokens = nonNegativeInt(
    input.softBacklogTokens ?? laneTotals.rawLeaves.tokens,
    "lcm_threshold_invalid_soft_backlog_tokens",
  )
  const softBacklogItemCount = nonNegativeInt(
    input.softBacklogItemCount ?? laneTotals.rawLeaves.itemCount,
    "lcm_threshold_invalid_soft_backlog_item_count",
  )
  const protectedTailRawTokens = nonNegativeInt(
    input.protectedTailRawTokens ?? 0,
    "lcm_threshold_invalid_protected_tail_raw_tokens",
  )
  const protectedTailRawItemCount = nonNegativeInt(
    input.protectedTailRawItemCount ?? 0,
    "lcm_threshold_invalid_protected_tail_raw_item_count",
  )
  const softBacklogLargestSourceTokens = nonNegativeInt(
    input.softBacklogLargestSourceTokens ?? 0,
    "lcm_threshold_invalid_soft_backlog_largest_source_tokens",
  )
  const freshTailTokens = nonNegativeInt(
    input.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens,
    "lcm_threshold_invalid_fresh_tail_tokens",
  )
  const freshTailRawTokens = nonNegativeInt(
    input.freshTailRawTokens ?? 0,
    "lcm_threshold_invalid_fresh_tail_raw_tokens",
  )
  const freshTailRawItemCount = nonNegativeInt(
    input.freshTailRawItemCount ?? 0,
    "lcm_threshold_invalid_fresh_tail_raw_item_count",
  )
  const unconsumedRawTokens = nonNegativeInt(
    input.unconsumedRawTokens ?? 0,
    "lcm_threshold_invalid_unconsumed_raw_tokens",
  )
  const unconsumedRawItemCount = nonNegativeInt(
    input.unconsumedRawItemCount ?? 0,
    "lcm_threshold_invalid_unconsumed_raw_item_count",
  )
  const rawLaneTokens = softBacklogTokens + protectedTailRawTokens
  const minUsefulSoftSourceTokens = computeMinUsefulSoftSourceTokens(input.strategy, budget.softThreshold)
  const softBacklogHasEnoughItems = softBacklogItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize
  const softBacklogHasLargeSource =
    softBacklogItemCount > 0 &&
    softBacklogTokens >= Math.max(minUsefulSoftSourceTokens, RUNTIME_DEFAULTS.performance.summaryTargetTokens * 2)
  const softBacklogEligible =
    softBacklogTokens >= minUsefulSoftSourceTokens && (softBacklogHasEnoughItems || softBacklogHasLargeSource)
  const globalSoftPressure = budget.softThreshold > 0 && rawLaneTokens > budget.softThreshold && softBacklogEligible
  const belowSoftRawBacklogPressure =
    budget.softThreshold > 0 &&
    budget.activeTokens <= budget.softThreshold &&
    softBacklogItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize &&
    softBacklogTokens > rawLaneTarget(input.strategy)
  const softPressureReason: LcmSoftPressureReason | undefined = globalSoftPressure
    ? "global_soft_threshold"
    : belowSoftRawBacklogPressure
      ? "below_soft_raw_backlog"
      : undefined
  const overSoft = globalSoftPressure || belowSoftRawBacklogPressure
  return {
    conversationID: input.conversationID,
    strategy: input.strategy,
    activeTokens: budget.activeTokens,
    hardLimit: budget.hardLimit,
    softThreshold: budget.softThreshold,
    freshTailTokens,
    softBacklogTokens,
    softBacklogItemCount,
    softBacklogLargestSourceTokens,
    freshTailRawTokens,
    freshTailRawItemCount,
    unconsumedRawTokens,
    unconsumedRawItemCount,
    protectedTailRawTokens,
    protectedTailRawItemCount,
    rawLaneTokens,
    outputReserve: budget.outputReserve,
    systemPromptTokens: budget.systemPromptTokens,
    toolSchemaTokens: budget.toolSchemaTokens,
    providerContextLimit: budget.providerContextLimit,
    ...(budget.providerInputLimit === undefined ? {} : { providerInputLimit: budget.providerInputLimit }),
    ...(budget.providerOutputLimit === undefined ? {} : { providerOutputLimit: budget.providerOutputLimit }),
    hardFillRatio: budget.hardFillRatio,
    rawLaneRatio: budget.softThreshold > 0 ? rawLaneTokens / budget.softThreshold : 0,
    softBacklogRatio: budget.softThreshold > 0 ? softBacklogTokens / budget.softThreshold : 0,
    tokenCounterMode: budget.tokenCounterMode,
    tokenCounterVersion: budget.tokenCounterVersion,
    budgetStatus: input.budgetStatus,
    softPressureReason,
    overSoft,
    overHard: budget.overHard,
    lanes: computeLaneDecisions({
      strategy: input.strategy,
      totals: laneTotals,
      overHard: budget.overHard,
      softThreshold: budget.softThreshold,
      rawLaneTokens,
      softBacklogItemCount,
      overSoft,
    }),
  }
}

export * as LcmTokenBudget from "./token-budget"
