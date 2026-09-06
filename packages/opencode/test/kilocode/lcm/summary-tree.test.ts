import { describe, expect, test } from "bun:test"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { rollForwardItems, summaryGrounded, SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource } from "@/kilocode/session/lcm/types"

function makeSource(ordinal: number, tokens = 800): FinalSource {
  const content = `source ${ordinal} ${"detail ".repeat(tokens)}`
  const digest = sha256(content)
  return {
    id: sourceID({
      sessionID: "ses_tree",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      kind: "user_text",
      digest,
    }),
    sessionID: "ses_tree",
    messageID: `msg_${ordinal}`,
    partID: `part_${ordinal}`,
    ordinal,
    kind: "user_text",
    digest,
    tokens,
    bytes: Buffer.byteLength(content),
    excerpt: content.slice(0, 300),
  }
}

describe("LCM summary tree", () => {
  test("rolls a valid frontier forward only for a strict source append", () => {
    const previous = Array.from({ length: 3 }, (_, ordinal) => makeSource(ordinal))
    const next = [...previous, makeSource(3)]
    const revision = {
      id: "rev_previous",
      sessionID: "ses_tree",
      lineageDigest: lineageDigest(previous),
      reason: "soft_leaf" as const,
      items: [
        { kind: "summary" as const, id: "sum_0123456789abcdef01234567", ordinal: 0 },
        { kind: "source" as const, id: previous[2]!.id, ordinal: 2 },
      ],
      createdAt: 1,
    }

    expect(rollForwardItems({ revision, previousSources: previous, sources: next })).toEqual([
      ...revision.items,
      { kind: "source", id: next[3]!.id, ordinal: 3 },
    ])
    expect(
      rollForwardItems({
        revision,
        previousSources: previous,
        sources: [{ ...previous[0]!, digest: "rewritten" }, ...next.slice(1)],
      }),
    ).toBeUndefined()
  })

  test("advances one stable soft quantum at a time and preserves the raw tail", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = Array.from({ length: 20 }, (_, ordinal) => makeSource(ordinal))
    const digest = lineageDigest(sources)
    const lineage = {
      sessionID: "ses_tree",
      digest,
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const tree = new SummaryTree(store)
    const revision = await tree.build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 2,
      reason: "background",
    })
    expect(revision).toBeDefined()
    expect(revision!.items.filter((item) => item.kind === "summary").length).toBeLessThanOrEqual(8)
    expect(revision!.items.slice(-2).map((item) => item.id)).toEqual(sources.slice(-2).map((item) => item.id))

    const again = await tree.build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 2,
      reason: "background",
    })
    expect(again!.items[0]?.id).toBe(revision!.items[0]?.id)
    expect(again!.items.filter((item) => item.kind === "summary").length).toBe(
      revision!.items.filter((item) => item.kind === "summary").length + 1,
    )
    expect(again!.items.slice(-2).map((item) => item.id)).toEqual(sources.slice(-2).map((item) => item.id))
    store.close()
  })

  test("does not commit an ineffective summary", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0, 1)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "background",
    })
    expect(revision).toBeUndefined()
    expect(await store.listSummaries("ses_tree")).toEqual([])
    store.close()
  })

  test("rejects invented recovery handles and records model attempts", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: "Use invented source src_aaaaaaaaaaaaaaaaaaaaaaaa.",
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.001,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    expect(revision).toBeDefined()
    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).not.toContain("src_aaaaaaaaaaaaaaaaaaaaaaaa")
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_unknown_handle",
      "lcm_summary_unknown_handle",
    ])
    store.close()
  })

  test("rejects truncated recovery handles before appending an exact footer", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: "The detail is attributed to abbreviated source src_aaaaaaaa.",
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).not.toContain("src_aaaaaaaa")
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_unknown_handle",
      "lcm_summary_unknown_handle",
    ])
    store.close()
  })

  test("leaves the frontier unchanged after one rejected soft summary attempt", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const modes: string[] = []
    const revision = await new SummaryTree(store, {
      generate: async (request) => {
        modes.push(request.mode)
        return {
          text: "Use invented source src_aaaaaaaaaaaaaaaaaaaaaaaa.",
          mode: request.mode,
          attempt: {
            id: `attempt_${request.mode}`,
            nodeKey: "",
            sessionID: request.sessionID,
            mode: request.mode,
            inputTokens: 100,
            outputTokens: 10,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0.001,
            finish: "stop",
            durationMs: 1,
            createdAt: 1,
          },
        }
      },
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "background",
    })

    expect(revision).toBeUndefined()
    expect(modes).toEqual(["normal"])
    expect(await store.listSummaries("ses_tree")).toEqual([])
    expect((await store.metrics("ses_tree")).work.attempts).toBe(1)
    store.close()
  })

  test("accepts a substantive summary that cites exact source lineage", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: `${sources[0]!.id} preserves the binding implementation decision and its supporting detail.`,
        mode: request.mode,
        attempt: {
          id: "attempt_complete",
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.001,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "background",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("normal")
    expect(summary?.text).toContain(sources[0]!.id)
    store.close()
  })

  test("rejects length-truncated model summaries and records incomplete provenance", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: `${sources[0]!.id} preserves useful evidence but ends in an unfinished`,
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: request.targetTokens,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.001,
          finish: "length",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).not.toContain("unfinished")
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_incomplete",
      "lcm_summary_incomplete",
    ])
    store.close()
  })

  test("attaches deterministic exact recovery lineage when a substantive summary omits citations", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => {
        expect(request.allowedHandles).toEqual([sources[0]!.id])
        return {
          text: "The binding implementation decision and supporting detail are preserved here.",
          mode: request.mode,
          attempt: {
            id: "attempt_missing_citation",
            nodeKey: "",
            sessionID: request.sessionID,
            mode: request.mode,
            inputTokens: 100,
            outputTokens: 20,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            finish: "stop",
            durationMs: 1,
            createdAt: 1,
          },
        }
      },
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("normal")
    expect(summary?.text).toEndWith(`Recovery handles: ${sources[0]!.id}`)
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([undefined])
    store.close()
  })

  test("rejects protocol-only and content-free model output", async () => {
    for (const candidate of ["RECEIVED", undefined]) {
      const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
      const sources = [makeSource(0)]
      const digest = lineageDigest(sources)
      const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
      await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
      const revision = await new SummaryTree(store, {
        generate: async (request) => ({
          text: candidate ?? `${sources[0]!.id} noted`,
          mode: request.mode,
          attempt: {
            id: `attempt_${request.mode}`,
            nodeKey: "",
            sessionID: request.sessionID,
            mode: request.mode,
            inputTokens: 100,
            outputTokens: 4,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            finish: "stop",
            durationMs: 1,
            createdAt: 1,
          },
        }),
      }).build({
        sessionID: "ses_tree",
        lineage,
        usableInputTokens: 8_000,
        protectedSources: 0,
        reason: "hard_built",
      })

      const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
      expect(summary?.generationMode).toBe("deterministic")
      expect(summary?.text).toStartWith("Conversation memory index:")
      expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual(
        candidate
          ? ["lcm_summary_protocol_output", "lcm_summary_protocol_output"]
          : ["lcm_summary_content_free", "lcm_summary_content_free"],
      )
      store.close()
    }
  })

  test("uses a valid full-content extractive fallback after rejected foreground generations", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const fallbackText = `Extractive evidence retains the terminal verified result.\n\nRecovery handles: ${sources[0]!.id}`
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: "RECEIVED",
        fallbackText,
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 4,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).toBe(fallbackText)
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_protocol_output",
      "lcm_summary_protocol_output",
    ])
    store.close()
  })

  test("rejects embedded protocol scaffolding instead of preserving it as immutable memory", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text:
          request.mode === "normal"
            ? `I've updated unrelated project files. Durable source detail is retained. ${sources[0]!.id}`
            : `<result_answer>Embedded task answer</result_answer> ${sources[0]!.id}`,
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).not.toContain("result_answer")
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_protocol_scaffolding",
      "lcm_summary_protocol_scaffolding",
    ])
    store.close()
  })

  test("rejects summary-task commentary that would displace durable historical evidence", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const fallbackText = `Extractive evidence retains the durable source result.\n\nRecovery handles: ${sources[0]!.id}`
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text:
          request.mode === "normal"
            ? `The active instruction is to summarize the lcm-historical-data block. ${sources[0]!.id}`
            : `I'll summarize the historical conversation according to the system task. ${sources[0]!.id}`,
        fallbackText,
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).toBe(fallbackText)
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_protocol_scaffolding",
      "lcm_summary_protocol_scaffolding",
    ])
    store.close()
  })

  test("rejects model output that the product generator could not ground in its supplied children", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = [makeSource(0)]
    const digest = lineageDigest(sources)
    const lineage = { sessionID: "ses_tree", digest, sourceCount: 1, lastSourceID: sources[0]?.id }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async (request) => ({
        text: `Unrelated stylesheet modifications affect deployment assets. ${sources[0]!.id}`,
        grounded: false,
        mode: request.mode,
        attempt: {
          id: `attempt_${request.mode}`,
          nodeKey: "",
          sessionID: request.sessionID,
          mode: request.mode,
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          finish: "stop",
          durationMs: 1,
          createdAt: 1,
        },
      }),
    }).build({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      protectedSources: 0,
      reason: "hard_built",
    })

    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect((await store.listAttempts("ses_tree")).map((attempt) => attempt.errorCode)).toEqual([
      "lcm_summary_ungrounded",
      "lcm_summary_ungrounded",
    ])
    store.close()
  })

  test("checks distinctive lexical grounding without treating handles or task boilerplate as evidence", () => {
    const source = "Keyleth cast Prestidigitation after the party entered the chamber."
    expect(summaryGrounded(source, "Keyleth's final spell was Prestidigitation.")).toBe(true)
    expect(summaryGrounded(source, "I've updated the CSS and implemented changes to the project files.")).toBe(false)
  })

  test("deterministic fallback converges when source excerpts reference other memory", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const externalSource = "src_aaaaaaaaaaaaaaaaaaaaaaaa"
    const externalSummary = "sum_bbbbbbbbbbbbbbbbbbbbbbbb"
    const sources = [
      {
        ...makeSource(0),
        excerpt: `Tool output read ${externalSource}; related summary ${externalSummary}; binding evidence follows.`,
      },
      makeSource(1),
    ]
    const digest = lineageDigest(sources)
    const lineage = {
      sessionID: "ses_tree",
      digest,
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store, {
      generate: async () => undefined,
    }).maintain({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      maxEligibleOrdinal: 1,
      targetTokens: 3_200,
      mode: "hard",
    })

    expect(revision?.reason).toBe("hard_level")
    const summary = await store.getSummary("ses_tree", revision!.items[0]!.id)
    expect(summary?.generationMode).toBe("deterministic")
    expect(summary?.text).toContain(sources[0]!.id)
    expect(summary?.text).toContain(sources[1]!.id)
    expect(summary?.text).not.toContain(externalSource)
    expect(summary?.text).not.toContain(externalSummary)
    expect(summary?.tokens).toBeLessThan(sources.reduce((total, source) => total + source.tokens, 0))
    store.close()
  })

  test("hard maintenance strictly promotes a complete frontier toward the soft target", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const sources = Array.from({ length: 30 }, (_, ordinal) => makeSource(ordinal))
    const lineage = {
      sessionID: "ses_tree",
      digest: lineageDigest(sources),
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    await store.replaceSources({ sessionID: "ses_tree", lineage, sources })
    const revision = await new SummaryTree(store).maintain({
      sessionID: "ses_tree",
      lineage,
      usableInputTokens: 8_000,
      maxEligibleOrdinal: 27,
      targetTokens: 3_200,
      mode: "hard",
    })

    expect(revision?.reason).toBe("hard_level")
    expect(revision?.items.slice(-2).map((item) => item.id)).toEqual(sources.slice(-2).map((item) => item.id))
    expect(revision?.items.filter((item) => item.kind === "source").length).toBe(2)
    const frontierTokens = await Promise.all(
      revision!.items.map(async (item) =>
        item.kind === "source"
          ? ((await store.getSource("ses_tree", item.id))?.tokens ?? 0)
          : ((await store.getSummary("ses_tree", item.id))?.tokens ?? 0),
      ),
    )
    expect(frontierTokens.reduce((total, tokens) => total + tokens, 0)).toBeLessThanOrEqual(3_200)
    store.close()
  })
})
