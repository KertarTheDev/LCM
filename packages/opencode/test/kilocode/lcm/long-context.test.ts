import { describe, expect, test } from "bun:test"
import path from "node:path"
import { lineageDigest, sha256, sourceID } from "@/kilocode/session/lcm/ids"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { SummaryTree } from "@/kilocode/session/lcm/summary-tree"
import type { FinalSource } from "@/kilocode/session/lcm/types"

interface Fixture {
  sessionID: string
  usableInputTokens: number
  protectedSources: number
  entries: string[]
  bindings: Array<{ name: string; sourceOrdinal: number; exact: string }>
}

const fixturePath = path.resolve(import.meta.dir, "../../../../../specifications/fixtures/binding-state.json")

describe("LCM deterministic long-context continuity", () => {
  test("keeps binding facts reachable in at most grep plus read after multi-level condensation", async () => {
    const fixture = (await Bun.file(fixturePath).json()) as Fixture
    const bodies = new Map<string, string>()
    const sources: FinalSource[] = fixture.entries.map((entry, ordinal) => {
      const content = `${entry}\n${`Routine non-binding build output for source ${ordinal}. `.repeat(140)}`
      const digest = sha256(content)
      const id = sourceID({
        sessionID: fixture.sessionID,
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        kind: "user_text",
        digest,
      })
      bodies.set(id, content)
      return {
        id,
        sessionID: fixture.sessionID,
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest,
        tokens: 1_300,
        bytes: Buffer.byteLength(content),
        excerpt: content.slice(0, 300),
      }
    })
    const lineage = {
      sessionID: fixture.sessionID,
      digest: lineageDigest(sources),
      sourceCount: sources.length,
      lastSourceID: sources.at(-1)?.id,
    }
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    await store.replaceSources({ sessionID: fixture.sessionID, lineage, sources })
    const revision = await new SummaryTree(store).maintain({
      sessionID: fixture.sessionID,
      lineage,
      usableInputTokens: fixture.usableInputTokens,
      maxEligibleOrdinal: sources.length - fixture.protectedSources - 1,
      targetTokens: Math.floor(fixture.usableInputTokens * 0.4),
      mode: "hard",
    })

    expect(revision).toBeDefined()
    expect(revision!.items.length).toBeLessThanOrEqual(8 + fixture.protectedSources)
    expect(
      Math.max(...(await store.listSummaries(fixture.sessionID)).map((item) => item.level)),
    ).toBeGreaterThanOrEqual(1)

    const currentSources = await store.listSources(fixture.sessionID)
    for (const binding of fixture.bindings) {
      // lcm_grep searches exact retained raw-source text, then lcm_read returns
      // the digest-verified body: two recovery calls regardless of tree depth.
      const match = currentSources.find((item) => item.excerpt.includes(binding.exact))
      expect(match, binding.name).toBeDefined()
      expect(bodies.get(match!.id), binding.name).toContain(binding.exact)
      expect(match!.ordinal).toBe(binding.sourceOrdinal)
    }

    const knownSources = new Set(sources.map((item) => item.id))
    const knownSummaries = new Set((await store.listSummaries(fixture.sessionID)).map((item) => item.id))
    for (const summaryID of knownSummaries) {
      for (const child of await store.listChildren(fixture.sessionID, summaryID)) {
        expect(child.kind === "source" ? knownSources.has(child.id) : knownSummaries.has(child.id)).toBe(true)
      }
    }
    store.close()
  })
})
