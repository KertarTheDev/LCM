import { describe, expect, test } from "bun:test"
import { LCM_USAGE, formatLcmStatus, formatLcmTimeline, parseLcmInput } from "@/kilocode/cli/cmd/tui/lcm-command"

describe("LCM TUI command", () => {
  test("recognizes only the documented slash forms", () => {
    expect(parseLcmInput("/lcm")).toBe("status")
    expect(parseLcmInput(" /LCM timeline ")).toBe("timeline")
    expect(parseLcmInput("/lcm export")).toBe("export")
    expect(parseLcmInput("/lcm repair")).toBe("invalid")
    expect(parseLcmInput("/lcms")).toBeUndefined()
    expect(LCM_USAGE).toBe("Usage: /lcm [status|timeline|export]")
  })

  test("formats the public status and empty timeline without internal storage terms", () => {
    const value = formatLcmStatus({
      mode: "summarized",
      health: "ok",
      capacity: {
        known: true,
        pressureRatio: 0.5,
        thresholdRatio: 0.6,
        activeInputTokens: 4_000,
        usableInputTokens: 8_000,
        rawLaneRatio: 0.4,
        fixedInputTokens: 800,
      },
      composition: {
        rawItems: 2,
        summaryItems: 1,
        rawTokens: 1_000,
        summaryTokens: 400,
        eligibleRawTokens: 700,
        eligibleRawItems: 1,
        protectedRawTokens: 500,
        protectedRawItems: 1,
        recentConsumedRawTokens: 200,
        recentConsumedRawItems: 1,
        unconsumedRawTokens: 300,
        unconsumedRawItems: 0,
      },
      background: { summarizing: false, phase: "idle" },
      memoryWork: { attempts: 1, inputTokens: 2_000, outputTokens: 400, cost: 0.01 },
    })
    expect(value).toContain("Context pressure: 50%")
    expect(value).toContain("1 summaries")
    expect(value).toContain("Raw conversation pressure: 40%")
    expect(value).toContain("Protected detail: recent consumed")
    expect(value).not.toMatch(/sqlite|pglite|frontier|lease/i)
    expect(formatLcmTimeline([])).toContain("No Conversation Memory activity")
  })
})
