import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { Projector } from "@/kilocode/session/lcm/projector"
import { maintainForRequest } from "@/kilocode/session/lcm/request-maintenance"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource, ProjectionInput } from "@/kilocode/session/lcm/types"

async function withFrontier(
  run: (fixture: {
    input: ProjectionInput
    projector: Projector
    frontierTokens: () => Promise<number>
    maintain: (targetTokens: number) => Promise<void>
    store: SqliteConversationMemoryStore
    sources: FinalSource[]
  }) => Promise<void>,
) {
  const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
  try {
    const sessionID = "ses_full_request"
    const content = Array.from({ length: 12 }, (_, ordinal) => `Record ${ordinal}: ${"retained detail ".repeat(400)}`)
    const sources: FinalSource[] = content.map((text, ordinal) => {
      const digest = sha256(text)
      return {
        id: sourceID({ sessionID, messageID: `msg_${ordinal}`, partID: `part_${ordinal}`, kind: "user_text", digest }),
        sessionID,
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        kind: "user_text",
        digest,
        ordinal,
        tokens: Math.ceil(text.length / 4),
        bytes: Buffer.byteLength(text),
        excerpt: text.slice(0, 300),
      }
    })
    const lineage = { sessionID, digest: lineageDigest(sources), sourceCount: sources.length }
    await store.replaceSources({ sessionID, lineage, sources })
    const tree = new SummaryTree(store)
    for (let maxEligibleOrdinal = 0; maxEligibleOrdinal < 10; maxEligibleOrdinal++) {
      await tree.maintain({
        sessionID,
        lineage,
        usableInputTokens: 32_000,
        maxEligibleOrdinal,
        targetTokens: 32_000,
        mode: "hard",
      })
    }
    const before = (await store.activeRevision(sessionID, lineage.digest))!
    expect(before.items.filter((item) => item.kind === "summary")).toHaveLength(10)
    const frontierTokens = async () => {
      const revision = (await store.activeRevision(sessionID, lineage.digest))!
      const counts = await Promise.all(
        revision.items.map(async (item) =>
          item.kind === "summary"
            ? (await store.getSummary(sessionID, item.id))!.tokens
            : (await store.getSource(sessionID, item.id))!.tokens,
        ),
      )
      return counts.reduce((sum, count) => sum + count, 0)
    }
    const system = ["Fixed upstream instructions. ".repeat(600)]
    const tools = { read: { description: "Read a file", inputSchema: { type: "object" } } }
    const measure = (messages: ModelMessage[]) =>
      KiloSessionOverflow.measure({
        messages: [{ role: "system", content: system.join("\n") }, ...messages],
        tools,
      }).normalized
    const messages: ModelMessage[] = content.map((text) => ({ role: "user", content: text }))
    const protectedMessages = messages.slice(-2)
    const projector = new Projector(store)
    const input: ProjectionInput = {
      sessionID,
      lineage,
      system,
      tools,
      messages,
      protectedMessages,
      usableInputTokens: 32_000,
      thresholdRatio: 0.6,
      recentTailTokens: 2_000,
      maxEligibleOrdinal: 9,
      maxConsumedOrdinal: 10,
      sourceContent: new Map(sources.map((source) => [source.id, content[source.ordinal]!])),
      continuationID: "request",
      reason: "hard",
      measure,
    }
    const candidate = await projector.assess(input)
    expect(candidate.type).toBe("projected")
    input.usableInputTokens = measure(candidate.messages) - 89
    const targetTokens = Math.floor(input.usableInputTokens * input.thresholdRatio)
    expect(await frontierTokens()).toBeLessThan(targetTokens)
    expect((await projector.project(input)).type).toBe("unchanged")
    await run({
      input,
      projector,
      frontierTokens,
      store,
      sources,
      maintain: async (targetTokens) => {
        await tree.maintain({
          sessionID,
          lineage,
          usableInputTokens: input.usableInputTokens,
          maxEligibleOrdinal: 9,
          targetTokens,
          mode: "hard",
        })
      },
    })
  } finally {
    store.close()
  }
}

for (const partial of [false, true]) {
  test(`hard maintenance fits the full request below the tree target${partial ? " across partial reductions" : ""}`, async () => {
    await withFrontier(async ({ input, projector, frontierTokens, maintain, store, sources }) => {
      if (partial) input.usableInputTokens -= 700
      const before = (await store.activeRevision(input.sessionID, input.lineage.digest))!
      let calls = 0
      const result = await maintainForRequest({
        initial: await projector.assess(input),
        usableInputTokens: input.usableInputTokens,
        targetTokens: Math.floor(input.usableInputTokens * input.thresholdRatio),
        measure: input.measure,
        frontierTokens,
        project: () => projector.assess(input),
        maintain: async (target) => {
          calls++
          await maintain(partial ? Math.max(target, (await frontierTokens()) - 1) : target)
        },
      })
      expect(input.measure(result.messages)).toBeLessThan(input.usableInputTokens)
      expect(result.type).toBe("projected")
      expect(calls).toBeGreaterThan(partial ? 1 : 0)
      expect(calls).toBeLessThanOrEqual(10)
      expect(result.messages.slice(1)).toEqual(input.protectedMessages)
      expect(result.messages.at(-1)).toBe(input.messages.at(-1))
      expect((await store.activeRevision(input.sessionID, input.lineage.digest))!.items.slice(-2)).toEqual(
        before.items.slice(-2),
      )
      expect(await store.listSources(input.sessionID)).toEqual(sources)
    })
  })
}

test("request maintenance stops after an unchanged frontier instead of retrying paid work", async () => {
  await withFrontier(async ({ input, projector, frontierTokens }) => {
    let calls = 0
    const result = await maintainForRequest({
      initial: await projector.assess(input),
      usableInputTokens: input.usableInputTokens,
      targetTokens: 0,
      measure: input.measure,
      frontierTokens,
      project: () => projector.assess(input),
      maintain: async () => {
        calls++
      },
    })
    expect(calls).toBe(1)
    expect(input.measure(result.messages)).toBeGreaterThanOrEqual(input.usableInputTokens)
    expect((await projector.project(input)).type).toBe("unchanged")
  })
})

test("irreducible request overhead remains unprojectable after bounded reductions", async () => {
  await withFrontier(async ({ input, projector, frontierTokens, maintain }) => {
    input.usableInputTokens = input.measure(input.protectedMessages) - 1
    let calls = 0
    const result = await maintainForRequest({
      initial: await projector.assess(input),
      usableInputTokens: input.usableInputTokens,
      targetTokens: 0,
      measure: input.measure,
      frontierTokens,
      project: () => projector.assess(input),
      maintain: async (target) => {
        calls++
        await maintain(target)
      },
    })
    expect(calls).toBeLessThanOrEqual(2)
    expect(input.measure(result.messages)).toBeGreaterThanOrEqual(input.usableInputTokens)
    expect((await projector.project(input)).type).toBe("unchanged")
  })
})

test("cancellation stops request maintenance before another projection or model cycle", async () => {
  await withFrontier(async ({ input, projector, frontierTokens, maintain }) => {
    const controller = new AbortController()
    const reason = new Error("cancelled while maintaining")
    let projections = 0
    let calls = 0
    await expect(
      maintainForRequest({
        initial: await projector.assess(input),
        usableInputTokens: input.usableInputTokens,
        targetTokens: 0,
        measure: input.measure,
        frontierTokens,
        project: async () => {
          projections++
          return projector.assess(input)
        },
        maintain: async (target) => {
          calls++
          await maintain(target)
          controller.abort(reason)
        },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(calls).toBe(1)
    expect(projections).toBe(0)
  })
})
