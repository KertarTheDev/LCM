// kilocode_change - new file
import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { getCapabilities } from "../../src/session/lcm/lifecycle"
import { LcmRetrieval } from "../../src/session/lcm/retrieval"
import { tmpdir } from "../fixture/fixture"
import { initializeRetrievalWorker, retrievalIDs, runRetrieval, seedRetrievalFixture } from "./retrieval-fixture"

test("lcm:retrieval-auth exposes retrieval only to supported active capability classes", async () => {
  await using tmp = await tmpdir({ git: true })
  const worker = await initializeRetrievalWorker(path.join(tmp.path, "lcm"))
  try {
    await seedRetrievalFixture(worker)
    const root = await runRetrieval(
      worker,
      getCapabilities({ sessionID: retrievalIDs.rootSession, strategy: "upward", dataDir: path.join(tmp.path, "lcm") }),
    )
    const task = await runRetrieval(
      worker,
      getCapabilities({ sessionID: retrievalIDs.taskSession, strategy: "upward", dataDir: path.join(tmp.path, "lcm") }),
    )
    const explore = await runRetrieval(
      worker,
      getCapabilities({
        sessionID: retrievalIDs.exploreSession,
        strategy: "upward",
        dataDir: path.join(tmp.path, "lcm"),
      }),
    )
    const map = await runRetrieval(
      worker,
      getCapabilities({ sessionID: retrievalIDs.mapSession, strategy: "upward", dataDir: path.join(tmp.path, "lcm") }),
    )

    expect(root.canRetrieve).toBe(true)
    expect(task.canRetrieve).toBe(true)
    expect(explore.canRetrieve).toBe(true)
    expect(map.canRetrieve).toBe(true)
  } finally {
    await worker.close()
  }
})

test("lcm:retrieval-auth allows current lineage and denies sibling, foreign, forged, and root-expand access", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedRetrievalFixture(worker)
    const allowed = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.taskSession,
        dataDir,
        pattern: "AlphaCode",
        mode: "literal",
      }),
    )
    expect(allowed.ok).toBe(true)
    if (allowed.ok) {
      expect(allowed.results.some((result) => result.summaryID === retrievalIDs.targetSummary)).toBe(true)
      expect(allowed.results.some((result) => result.partRowID === retrievalIDs.rootPart)).toBe(true)
    }

    const sibling = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.taskSession,
        dataDir,
        pattern: "SIBLING_SECRET",
        mode: "literal",
        summaryID: retrievalIDs.siblingSummary,
      }),
    )
    expect(sibling).toMatchObject({ ok: false, error: { code: "unauthorized" } })

    const foreign = await runRetrieval(
      worker,
      LcmRetrieval.describe({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        id: retrievalIDs.foreignSummary,
      }),
    )
    expect(foreign).toMatchObject({ ok: false, error: { code: "unauthorized" } })

    const forged = await runRetrieval(
      worker,
      LcmRetrieval.describe({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        id: "sum_m21_missing",
      }),
    )
    expect(forged).toMatchObject({ ok: false, error: { code: "not_found" } })

    const rootExpand = await runRetrieval(
      worker,
      LcmRetrieval.expand({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        summaryID: retrievalIDs.targetSummary,
      }),
    )
    expect(rootExpand).toMatchObject({ ok: false, error: { code: "unauthorized" } })

    const mapSearch = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.mapSession,
        dataDir,
        pattern: "AlphaCode",
        mode: "literal",
      }),
    )
    expect(mapSearch.ok).toBe(true)
    if (mapSearch.ok) {
      expect(mapSearch.results.some((result) => result.partRowID === retrievalIDs.rootPart)).toBe(true)
    }

    const mapExpand = await runRetrieval(
      worker,
      LcmRetrieval.expand({
        sessionID: retrievalIDs.mapSession,
        dataDir,
        summaryID: retrievalIDs.targetSummary,
      }),
    )
    expect(mapExpand.ok).toBe(true)
    if (mapExpand.ok) {
      expect(mapExpand.items.some((item) => item.summaryID === retrievalIDs.parentSummary)).toBe(true)
    }
  } finally {
    await Effect.runPromise(Effect.sync(() => worker.close()))
  }
})
