import { describe, expect, test } from "bun:test"
import { routeLcmMessage, updateLcmActivity, updateLcmStatus } from "../../webview-ui/src/context/lcm-state"
import type { LcmActivity, LcmStatus } from "../../webview-ui/src/types/messages"

function status(sessionID: string, sequence: number): LcmStatus {
  return {
    sessionID,
    sequence,
    mode: "raw",
    health: "ok",
    capacity: { known: false },
    composition: {
      rawTokens: 0,
      summaryTokens: 0,
      rawItems: 0,
      summaryItems: 0,
      eligibleRawTokens: 0,
      eligibleRawItems: 0,
      protectedRawTokens: 0,
      protectedRawItems: 0,
    },
    background: { summarizing: false, phase: "idle" },
    memoryWork: {
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    },
  }
}

function activity(id: string, sequence: number): LcmActivity {
  return {
    id,
    sessionID: "ses_active",
    sequence,
    kind: "intervention",
    message: id,
    createdAt: sequence,
  }
}

describe("Conversation Memory webview state", () => {
  test("rejects stale status responses and another session's state", () => {
    const current = status("ses_active", 4)
    expect(
      updateLcmStatus({
        activeSessionID: "ses_active",
        messageSessionID: "ses_active",
        current,
        next: status("ses_active", 3),
      }),
    ).toBe(current)
    expect(
      updateLcmStatus({
        activeSessionID: "ses_active",
        messageSessionID: "ses_active",
        current,
        next: status("ses_active", 4),
      }),
    ).toBe(current)
    expect(
      updateLcmStatus({
        activeSessionID: "ses_active",
        messageSessionID: "ses_other",
        current,
        next: status("ses_other", 5),
      }),
    ).toBe(current)
  })

  test("deduplicates SSE and hydration activity in sequence order", () => {
    const first = activity("activity_1", 1)
    const second = activity("activity_2", 2)
    expect(
      updateLcmActivity({
        activeSessionID: "ses_active",
        messageSessionID: "ses_active",
        current: [second],
        next: [first, second],
      }),
    ).toEqual([first, second])
  })

  test("surfaces status-route failures only for the active session", () => {
    let error: string | undefined
    const route = (sessionID: string) =>
      routeLcmMessage({
        message: { type: "lcmStatusError", sessionID, message: "route failed" },
        activeSessionID: "ses_active",
        requestStatus: () => undefined,
        setStatus: () => undefined,
        setError: (message) => {
          error = message
        },
        setActivity: () => undefined,
      })
    route("ses_other")
    expect(error).toBeUndefined()
    route("ses_active")
    expect(error).toBe("route failed")
  })
})
