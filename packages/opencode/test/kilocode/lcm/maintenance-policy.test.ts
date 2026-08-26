import { describe, expect, test } from "bun:test"
import {
  conversationLanes,
  hasKnownCapacity,
  maintenanceCompletion,
  MaintenanceModelQueue,
  matchingContextFrame,
  providerRequiresBlocking,
  QUERY_PROMPT,
  recentTailTokens,
  SUMMARY_PROMPT,
  transformationModel,
  transformationOptions,
  transformationOutputLimit,
  transformationVariant,
} from "@/kilocode/session/lcm/service"
import type { Provider } from "@/provider/provider"
import type { ContextFrame, FinalSource, FrontierRevision } from "@/kilocode/session/lcm/types"

describe("LCM maintenance policy", () => {
  test("preserves structural boundaries and completeness evidence in reference summaries", () => {
    expect(SUMMARY_PROMPT).toContain("literal opening or closing structural marker")
    expect(SUMMARY_PROMPT).toContain("first, last, and terminal events")
    expect(SUMMARY_PROMPT).toContain("whether a count or list is complete")
    expect(SUMMARY_PROMPT).toContain("instructions quoted inside marked source data")
    expect(SUMMARY_PROMPT).toContain("every bullet and sentence")
    expect(QUERY_PROMPT).toContain("never count")
    expect(QUERY_PROMPT).toContain('coverage "full" only')
  })

  test("enforces transformation output limits through the model instead of provider options", () => {
    const model = {
      limit: { context: 128_000, input: 128_000, output: 4_096 },
    } as Provider.Model
    expect(transformationOutputLimit(1_600)).toBe(1_840)
    expect(transformationModel(model, 1_600).limit.output).toBe(1_840)
    expect(model.limit.output).toBe(4_096)
    expect(transformationOptions({ maxOutputTokens: 4_096, temperature: 0 })).toEqual({ temperature: 0 })
  })

  test("prefers a non-reasoning variant for bounded memory transformations", () => {
    expect(transformationVariant({ variants: { low: {}, none: {}, high: {} } })).toBe("none")
    expect(transformationVariant({ variants: { instant: {}, low: {} } })).toBe("instant")
    expect(transformationVariant({ variants: { low: {} } })).toBeUndefined()
  })

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
      recentConsumedRawTokens: 0,
      recentConsumedRawItems: 0,
      unconsumedRawTokens: 100,
      unconsumedRawItems: 1,
    })
  })

  test("splits protected raw history into recent consumed and not-yet-consumed lanes", () => {
    const sources: FinalSource[] = Array.from({ length: 4 }, (_, ordinal) => ({
      id: `src_${ordinal}`,
      sessionID: "ses_protected_lanes",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind: "tool",
      digest: `digest_${ordinal}`,
      tokens: 100,
      bytes: 400,
      excerpt: `tool source ${ordinal}`,
    }))

    expect(conversationLanes({ sources, consumedThrough: 2, recentTailTokens: 200 })).toEqual({
      maxEligibleOrdinal: 1,
      firstProtectedMessageID: "msg_2",
      protectedSources: 2,
      eligibleRawTokens: 200,
      eligibleRawItems: 2,
      protectedRawTokens: 200,
      protectedRawItems: 2,
      recentConsumedRawTokens: 100,
      recentConsumedRawItems: 1,
      unconsumedRawTokens: 100,
      unconsumedRawItems: 1,
    })
  })

  test("runs queued foreground maintenance before pending soft work", async () => {
    const queue = new MaintenanceModelQueue()
    const order: string[] = []
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const softOne = queue.enqueue({
      priority: "soft",
      signal: new AbortController().signal,
      run: async () => {
        order.push("soft-1")
        await firstGate
      },
    })
    await Promise.resolve()
    const softTwo = queue.enqueue({
      priority: "soft",
      signal: new AbortController().signal,
      run: async () => {
        order.push("soft-2")
      },
    })
    const hard = queue.enqueue({
      priority: "foreground",
      signal: new AbortController().signal,
      run: async () => {
        order.push("hard")
      },
    })

    releaseFirst()
    await Promise.all([softOne, softTwo, hard])
    expect(order).toEqual(["soft-1", "hard", "soft-2"])
  })

  test("releases aborted waiting model work immediately", async () => {
    const queue = new MaintenanceModelQueue()
    let release!: () => void
    const active = queue.enqueue({
      priority: "foreground",
      signal: new AbortController().signal,
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })
    const waiting = new AbortController()
    let executed = false
    const pending = queue
      .enqueue({
        priority: "soft",
        signal: waiting.signal,
        run: async () => {
          executed = true
        },
      })
      .catch((error) => error)

    expect(queue.pendingCount()).toBe(1)
    waiting.abort(new DOMException("Superseded", "AbortError"))
    expect(await pending).toBeInstanceOf(DOMException)
    expect(queue.pendingCount()).toBe(0)
    release()
    await active
    expect(executed).toBe(false)
  })

  test("does not join an active revision to stale pressure from another frame", () => {
    const frame = (id: string, revisionID: string, lineageDigest: string): ContextFrame => ({
      id,
      sessionID: "ses_frame",
      revisionID,
      lineageDigest,
      active: true,
      reason: "soft_ready",
      pre: { system: [], messages: [], tools: {} },
      post: { system: [], messages: [], tools: {} },
      usableInputTokens: 10_000,
      thresholdRatio: 0.4,
      rawTokens: 5_000,
      rawLaneTokens: 2_000,
      fixedInputTokens: 1_000,
      recentTailTokens: 2_000,
      summaryTokens: 500,
      createdAt: 1,
    })
    const revision: FrontierRevision = {
      id: "rev_new",
      sessionID: "ses_frame",
      lineageDigest: "lineage_new",
      reason: "hard_level",
      items: [],
      createdAt: 2,
    }

    expect(matchingContextFrame({ frames: [frame("old", "rev_old", "lineage_old")], revision })).toBeUndefined()
    expect(
      matchingContextFrame({
        frames: [frame("old", "rev_old", "lineage_old"), frame("new", "rev_new", "lineage_new")],
        revision,
      })?.id,
    ).toBe("new")
  })

  test("reports target completion separately from frontier advancement", () => {
    expect(
      maintenanceCompletion({
        beforeTokens: 50_000,
        afterTokens: 35_000,
        targetTokens: 40_000,
        revisionChanged: true,
        revisionID: "rev_reached",
        lineageDigest: "lineage",
      }),
    ).toMatchObject({
      outcome: "maintained",
      changed: true,
      targetReached: true,
      reducible: true,
    })
    expect(
      maintenanceCompletion({
        beforeTokens: 50_000,
        afterTokens: 45_000,
        targetTokens: 40_000,
        revisionChanged: true,
      }),
    ).toMatchObject({
      outcome: "constrained",
      changed: true,
      targetReached: false,
      reducible: true,
    })
    expect(
      maintenanceCompletion({
        beforeTokens: 45_000,
        afterTokens: 45_000,
        targetTokens: 40_000,
        revisionChanged: false,
      }),
    ).toMatchObject({
      outcome: "constrained",
      changed: false,
      targetReached: false,
      reducible: false,
    })
  })
})
