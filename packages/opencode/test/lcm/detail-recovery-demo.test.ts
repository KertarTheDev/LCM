// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LcmRetrieval } from "../../src/session/lcm/retrieval"
import { initializeRetrievalWorker, retrievalIDs, runRetrieval, seedRetrievalFixture } from "./retrieval-fixture"

type DemoCheck = {
  checkID: string
  status: "passed" | "failed"
  notes?: string
  [key: string]: unknown
}

type DemoReport = {
  schemaVersion: "lcm-detail-recovery-demo-v1"
  generatedAt: string
  dataDir: string
  dataDirKept: boolean
  checks: DemoCheck[]
  result: "passed" | "failed"
}

function pass(checkID: string, details: Omit<DemoCheck, "checkID" | "status"> = {}): DemoCheck {
  return { checkID, status: "passed", ...details }
}

function fail(checkID: string, error: unknown, details: Omit<DemoCheck, "checkID" | "status"> = {}): DemoCheck {
  return {
    checkID,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    ...details,
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("LCM summarized-detail recovery demo writes explicit evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lcm-detail-recovery-demo-"))
  const dataDir = path.join(root, "lcm")
  const keepDataDir = process.env.LCM_DETAIL_RECOVERY_DEMO_KEEP_DATA_DIR === "1"
  const worker = await initializeRetrievalWorker(dataDir)
  const checks: DemoCheck[] = []

  try {
    await seedRetrievalFixture(worker)

    try {
      const closure = await runRetrieval(
        worker,
        LcmRetrieval.grep({
          sessionID: retrievalIDs.rootSession,
          dataDir,
          pattern: "multilingual",
          mode: "literal",
          summaryID: "sum_m21_target_alias",
        }),
      )
      assert(closure.ok, "summary closure grep failed")
      assert(
        closure.results.some((result) => result.summaryID === retrievalIDs.parentSummary),
        "parent summary detail was not recovered through target-summary closure",
      )
      checks.push(
        pass("summary-closure-recovers-parent-detail", {
          query: "multilingual",
          requestedSummaryID: "sum_m21_target_alias",
          recoveredSummaryID: retrievalIDs.parentSummary,
          resultCount: closure.results.length,
        }),
      )
    } catch (error) {
      checks.push(fail("summary-closure-recovers-parent-detail", error))
    }

    try {
      const expansion = await runRetrieval(
        worker,
        LcmRetrieval.expand({
          sessionID: retrievalIDs.taskSession,
          dataDir,
          summaryID: retrievalIDs.targetSummary,
        }),
      )
      assert(expansion.ok, "summary expansion failed")
      const kinds = new Set(expansion.items.map((item) => item.kind))
      assert(kinds.has("summary"), "expanded memory did not include a summary item")
      assert(
        expansion.items.some((item) => item.messageRowID === retrievalIDs.rootMessage),
        "expanded memory did not include the summarized source message",
      )
      assert(
        expansion.items.some((item) => item.fileID === retrievalIDs.file),
        "expanded memory did not include the summarized file handle",
      )
      checks.push(
        pass("child-expansion-recovers-summarized-source-items", {
          summaryID: retrievalIDs.targetSummary,
          childSessionID: retrievalIDs.taskSession,
          recoveredKinds: [...kinds].sort(),
          recoveredMessageRowID: retrievalIDs.rootMessage,
          recoveredFileID: retrievalIDs.file,
        }),
      )
    } catch (error) {
      checks.push(fail("child-expansion-recovers-summarized-source-items", error))
    }

    try {
      let excerptHandles: string[] = []
      const answer = await runRetrieval(
        worker,
        LcmRetrieval.expandQuery({
          sessionID: retrievalIDs.rootSession,
          dataDir,
          query: `${retrievalIDs.targetSummary} What did the target summary preserve?`,
          generator: async ({ excerpts }) => {
            excerptHandles = excerpts.map((excerpt) => excerpt.handle)
            return {
              text: `The recovered summarized detail is AlphaCode (${retrievalIDs.targetSummary}).`,
            }
          },
        }),
      )
      assert(answer.ok, "focused answer query failed")
      assert(answer.answer.includes("AlphaCode"), "focused answer did not preserve the expected detail")
      assert(
        answer.citations.some((citation) => citation.summaryID === retrievalIDs.targetSummary),
        "focused answer did not cite the summary that carried the detail",
      )
      checks.push(
        pass("focused-answer-recovers-detail-from-summary-citation", {
          querySummaryID: retrievalIDs.targetSummary,
          recoveredDetail: "AlphaCode",
          excerptHandles,
          citations: answer.citations,
        }),
      )
    } catch (error) {
      checks.push(fail("focused-answer-recovers-detail-from-summary-citation", error))
    }

    try {
      let excerptHandles: string[] = []
      const answer = await runRetrieval(
        worker,
        LcmRetrieval.expandQuery({
          sessionID: retrievalIDs.rootSession,
          dataDir,
          query: `${retrievalIDs.fallbackSummary} FALLBACK_NEEDLE`,
          generator: async ({ excerpts }) => {
            excerptHandles = excerpts.map((excerpt) => excerpt.handle)
            return {
              text: `The recovered fallback detail is backed by source (${retrievalIDs.fallbackPart}).`,
            }
          },
        }),
      )
      assert(answer.ok, "fallback focused answer query failed")
      assert(excerptHandles[0] === retrievalIDs.fallbackPart, "fallback source did not outrank degraded summary")
      assert(
        answer.citations.some((citation) => citation.partRowID === retrievalIDs.fallbackPart),
        "fallback answer did not cite the original source part",
      )
      checks.push(
        pass("degraded-summary-prefers-original-source-detail", {
          fallbackSummaryID: retrievalIDs.fallbackSummary,
          recoveredSourcePartID: retrievalIDs.fallbackPart,
          excerptHandles,
          citations: answer.citations,
        }),
      )
    } catch (error) {
      checks.push(fail("degraded-summary-prefers-original-source-detail", error))
    }
  } finally {
    await worker.close()
  }

  const report: DemoReport = {
    schemaVersion: "lcm-detail-recovery-demo-v1",
    generatedAt: new Date().toISOString(),
    dataDir,
    dataDirKept: keepDataDir,
    checks,
    result: checks.every((check) => check.status === "passed") ? "passed" : "failed",
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`
  expect(serialized).not.toContain("SIBLING_SECRET")
  expect(serialized).not.toContain("FOREIGN_SECRET")

  const out = process.env.LCM_DETAIL_RECOVERY_DEMO_OUT
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true })
    await fs.writeFile(out, serialized, "utf8")
  } else {
    console.log(serialized)
  }
  if (!keepDataDir) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)

  expect(report.result).toBe("passed")
})
