// kilocode_change - new file
import { expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { LcmRetrieval } from "../../src/session/lcm/retrieval"
import { LcmRetrievalRegexError, runRetrievalRegex } from "../../src/session/lcm/retrieval-regex"
import { tmpdir } from "../fixture/fixture"
import {
  initializeRetrievalWorker,
  queryRetrieval,
  retrievalIDs,
  runRetrieval,
  seedRetrievalFixture,
} from "./retrieval-fixture"

test("lcm:regex-safety uses PGlite-compatible regex matching with deterministic snippets", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedRetrievalFixture(worker)
    const regex = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        pattern: "regex_token_[0-9]+",
      }),
    )
    expect(regex.ok).toBe(true)
    if (!regex.ok) throw new Error(regex.error.safeMessage)
    expect(regex.results.some((result) => result.partRowID === retrievalIDs.rootPart)).toBe(true)
    expect(regex.results.find((result) => result.partRowID === retrievalIDs.rootPart)?.snippet).toContain(
      "REGEX_TOKEN_42",
    )

    const invalid = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        pattern: "(",
      }),
    )
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid_request" } })
  } finally {
    await worker.close()
  }
})

test("lcm:regex-safety cancels isolated regex workers without poisoning the main LCM DB worker", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedRetrievalFixture(worker)
    const controller = new AbortController()
    controller.abort()
    await expect(
      runRetrievalRegex({
        pattern: "REGEX_TOKEN_[0-9]+",
        caseSensitive: false,
        candidates: [{ candidateID: "candidate_1", searchText: "REGEX_TOKEN_42" }],
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LcmRetrievalRegexError)

    const rows = await queryRetrieval<{ value: number }>(worker, "SELECT 1 AS value")
    expect(rows).toEqual([{ value: 1 }])

    const stillWorks = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: retrievalIDs.rootSession,
        dataDir,
        pattern: "AlphaCode",
        mode: "literal",
      }),
    )
    expect(stillWorks.ok).toBe(true)
  } finally {
    await Effect.runPromise(Effect.promise(() => worker.close()))
  }
})
