import { describe, expect, test } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { Schema } from "effect"
import * as Contract from "@/kilocode/session/lcm/contracts"
import { ConversationMemoryPaths } from "@/kilocode/server/httpapi/groups/conversation-memory"
import "@/kilocode/session/lcm/events"

describe("LCM public contracts", () => {
  test("keeps the session routes stable", () => {
    expect(ConversationMemoryPaths).toEqual({
      status: "/session/:sessionID/lcm/status",
      activity: "/session/:sessionID/lcm/activity",
      export: "/session/:sessionID/lcm/context/export",
    })
  })

  test("accepts the finite content-safe status DTO", () => {
    const status = Schema.decodeUnknownSync(Contract.Status)({
      sessionID: "ses_test",
      sequence: 2,
      mode: "summarized",
      health: "ok",
      capacity: {
        known: true,
        usableInputTokens: 8_000,
        rawInputTokens: 6_000,
        activeInputTokens: 3_000,
        freeTokens: 5_000,
        pressureRatio: 0.375,
        thresholdRatio: 0.4,
        softThresholdTokens: 3_200,
        rawLaneTokens: 2_000,
        rawLaneRatio: 0.25,
        fixedInputTokens: 4_000,
      },
      composition: {
        revisionID: "rev_test",
        rawTokens: 1_000,
        summaryTokens: 500,
        rawItems: 2,
        summaryItems: 1,
        eligibleRawTokens: 750,
        eligibleRawItems: 1,
        protectedRawTokens: 1_250,
        protectedRawItems: 1,
      },
      background: { summarizing: false, phase: "idle" },
      memoryWork: {
        attempts: 1,
        inputTokens: 2_000,
        outputTokens: 500,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.01,
      },
      lastInterventionAt: 1,
    })
    expect(status.capacity.pressureRatio).toBe(0.375)
    expect(() =>
      Schema.decodeUnknownSync(Contract.Status)({
        ...status,
        capacity: { ...status.capacity, pressureRatio: Number.POSITIVE_INFINITY },
      }),
    ).toThrow()
  })

  test("registers status and activity on the ordinary EventV2 stream", () => {
    expect(EventV2.registry.has("session.lcm.status")).toBe(true)
    expect(EventV2.registry.has("session.lcm.activity")).toBe(true)
  })
})
