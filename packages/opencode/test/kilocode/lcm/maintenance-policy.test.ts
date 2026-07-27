import { describe, expect, test } from "bun:test"
import {
  conversationLanes,
  hasKnownCapacity,
  providerRequiresBlocking,
  recentTailTokens,
} from "@/kilocode/session/lcm/service"
import type { FinalSource, FrontierRevision } from "@/kilocode/session/lcm/types"

describe("LCM maintenance policy", () => {
  test("requires a positive usable input capacity before maintenance", () => {
    expect(hasKnownCapacity(undefined)).toBe(false)
    expect(hasKnownCapacity(0)).toBe(false)
    expect(hasKnownCapacity(-1)).toBe(false)
    expect(hasKnownCapacity(1)).toBe(true)
  })

  test("defaults the recent exact tail to 15% with 2k through 20k clamps", () => {
    expect(recentTailTokens({ usableInputTokens: 8_000 })).toBe(2_000)
    expect(recentTailTokens({ usableInputTokens: 40_000 })).toBe(6_000)
    expect(recentTailTokens({ usableInputTokens: 200_000 })).toBe(20_000)
    expect(recentTailTokens({ usableInputTokens: 200_000, configured: 12_345 })).toBe(12_345)
    expect(recentTailTokens({ usableInputTokens: 8_000, configured: 0 })).toBe(0)
  })

  test("latches only provider errors that prove concurrent background work is unavailable", () => {
    for (const message of [
      "provider busy",
      "409 conflict",
      "single-flight request already active",
      "concurrency limit reached",
    ])
      expect(providerRequiresBlocking(new Error(message))).toBe(true)
    expect(providerRequiresBlocking(new Error("authentication failed"))).toBe(false)
    expect(providerRequiresBlocking(new Error("context window exceeded"))).toBe(false)
  })

  test("does not count sources already represented by stable summary roots as raw pressure", () => {
    const sources: FinalSource[] = Array.from({ length: 4 }, (_, ordinal) => ({
      id: `src_${ordinal}`,
      sessionID: "ses_lanes",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind: "user_text",
      digest: `digest_${ordinal}`,
      tokens: 100,
      bytes: 400,
      excerpt: `source ${ordinal}`,
    }))
    const revision: FrontierRevision = {
      id: "rev_lanes",
      sessionID: "ses_lanes",
      lineageDigest: "lineage",
      reason: "soft_leaf",
      items: [
        { kind: "summary", id: "sum_covered", ordinal: 0 },
        { kind: "source", id: "src_2", ordinal: 2 },
        { kind: "source", id: "src_3", ordinal: 3 },
      ],
      createdAt: 1,
    }

    expect(
      conversationLanes({
        sources,
        consumedThrough: 2,
        recentTailTokens: 100,
        revision,
      }),
    ).toEqual({
      maxEligibleOrdinal: 2,
      firstProtectedMessageID: "msg_3",
      protectedSources: 1,
      eligibleRawTokens: 100,
      eligibleRawItems: 1,
      protectedRawTokens: 100,
      protectedRawItems: 1,
    })
  })
})
