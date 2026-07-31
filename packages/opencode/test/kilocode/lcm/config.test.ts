import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Schema } from "effect"
import { DEFAULT_ENABLED, enabled } from "@/kilocode/session/lcm/feature"

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
})
