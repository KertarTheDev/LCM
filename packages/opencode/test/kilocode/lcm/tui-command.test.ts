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
      },
      composition: { rawItems: 2, summaryItems: 1, rawTokens: 1_000, summaryTokens: 400 },
      background: { summarizing: false, pendingSources: 0 },
      memoryWork: { attempts: 1, inputTokens: 2_000, outputTokens: 400, cost: 0.01 },
    })
    expect(value).toContain("Context pressure: 50%")
    expect(value).toContain("1 summaries")
    expect(value).not.toMatch(/sqlite|pglite|frontier|lease/i)
    expect(formatLcmTimeline([])).toContain("No Conversation Memory activity")
  })
})
