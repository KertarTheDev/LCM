import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Schema } from "effect"
import { DEFAULT_ENABLED, enabled } from "@/kilocode/session/lcm/feature"
import { lcmRecoveryLimits } from "@/kilocode/session/lcm/recovery-contract"
import { DEFAULT_SOFT_THRESHOLD_RATIO } from "@/kilocode/session/lcm/types"

const decode = Schema.decodeUnknownSync(ConfigV1.Info)

describe("LCM configuration", () => {
  test("keeps the experimental feature enabled by default and accepts an explicit opt-out", () => {
    expect(DEFAULT_ENABLED).toBe(true)
    expect(enabled(decode({}))).toBe(true)
    expect(enabled(decode({ experimental: { conversation_memory: true } }))).toBe(true)
    expect(enabled(decode({ experimental: { conversation_memory: false } }))).toBe(false)
    expect(() => decode({ experimental: { conversation_memory: "false" } })).toThrow()
  })

  test("accepts a standard nullable percentage for the soft raw-lane threshold", () => {
    expect(DEFAULT_SOFT_THRESHOLD_RATIO).toBe(0.6)
    expect(
      decode({ conversation_memory: { soft_threshold_percent: 40 } }).conversation_memory?.soft_threshold_percent,
    ).toBe(40)
    expect(
      decode({ conversation_memory: { soft_threshold_percent: null } }).conversation_memory?.soft_threshold_percent,
    ).toBeNull()
    expect(decode({}).conversation_memory).toBeUndefined()
  })

  test("rejects percentages outside 1 through 100", () => {
    expect(() => decode({ conversation_memory: { soft_threshold_percent: 0 } })).toThrow()
    expect(() => decode({ conversation_memory: { soft_threshold_percent: 101 } })).toThrow()
  })

  test("accepts advanced isolated-recovery resource budgets and resolves defaults", () => {
    const defaults = lcmRecoveryLimits(decode({}))
    expect(defaults).toMatchObject({
      queryTurnLimit: 2,
      researchMaxSteps: 1,
      toolLimit: 2,
      semanticInferenceLimit: 1,
      repairMaxAttempts: 2,
      researchWallTimeMs: 540_000,
      finalizerWallTimeMs: 600_000,
      cleanupWallTimeMs: 60_000,
      activeWallTimeMs: 1_140_000,
      wallTimeMs: 1_200_000,
    })

    const configured = decode({
      conversation_memory: {
        recovery: {
          max_queries_per_turn: 4,
          max_research_steps: 6,
          max_tool_calls: 8,
          max_semantic_inferences: 4,
          max_repair_attempts: 0,
          research_timeout_seconds: 3_600,
          finalizer_timeout_seconds: 1_800,
          cleanup_timeout_seconds: 120,
        },
      },
    })
    expect(lcmRecoveryLimits(configured)).toMatchObject({
      queryTurnLimit: 4,
      researchMaxSteps: 6,
      toolLimit: 8,
      semanticInferenceLimit: 4,
      repairMaxAttempts: 0,
      researchWallTimeMs: 3_600_000,
      finalizerWallTimeMs: 1_800_000,
      cleanupWallTimeMs: 120_000,
      activeWallTimeMs: 5_400_000,
      wallTimeMs: 5_520_000,
    })
  })

  test("rejects invalid isolated-recovery resource budgets", () => {
    expect(() => decode({ conversation_memory: { recovery: { max_queries_per_turn: -1 } } })).toThrow()
    expect(() => decode({ conversation_memory: { recovery: { max_research_steps: 0 } } })).toThrow()
    expect(() => decode({ conversation_memory: { recovery: { research_timeout_seconds: 0 } } })).toThrow()
  })
})
