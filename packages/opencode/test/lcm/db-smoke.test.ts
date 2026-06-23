// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { resolveLcmDbLayout, resolveLcmFamilyRoot } from "../../src/session/lcm/db-layout"
import { LCM_DB_GATE_SCHEMA_VERSION, diagnoseLcmDb, rebuildLcmDb, runLcmDbSmoke } from "../../src/session/lcm/db-smoke"
import { deriveLcmFamilyID } from "../../src/session/lcm/family"
import { LCM_PGLITE_GATE_TEST_SCALE } from "../../src/session/lcm/pglite-gate"

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

function testFamilyRoot(tmpPath: string, rootSessionID: string) {
  const kiloDataDir = path.join(tmpPath, "kilo-data")
  return {
    kiloDataDir,
    familyRoot: resolveLcmFamilyRoot({ kiloDataDir, familyID: deriveLcmFamilyID(rootSessionID) }),
  }
}

async function withKiloDataDir<T>(kiloDataDir: string, fn: () => Promise<T>) {
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = kiloDataDir
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
}

test("lcm-db-smoke runs PGlite gate checks and keeps the report content-safe", async () => {
  await using tmp = await tmpdir()
  const { kiloDataDir, familyRoot: dataDir } = testFamilyRoot(tmp.path, "ses_m31_smoke_root")
  const layout = resolveLcmDbLayout(dataDir)

  const report = await withKiloDataDir(kiloDataDir, () =>
    runLcmDbSmoke({
      dataDir,
      runtimeMode: "source",
      scale: LCM_PGLITE_GATE_TEST_SCALE,
      regexStartupTimeoutMs: 20_000,
      regexQueryTimeoutMs: 100,
    }),
  )

  expect(report.status).toBe("passed")
  expect(report.dataDir).toBe(layout.rootDir)
  expect(report.runtimeMode).toBe("source")
  expect(report.safeErrors).toEqual([])
  expect(report.checks.some((check) => check.detailCode === "pg_trgm" && check.status === "passed")).toBe(true)
  expect(report.checks.some((check) => check.detailCode === "literal_search" && check.status === "passed")).toBe(true)
  expect(report.checks.some((check) => check.detailCode === "regex_cancellation" && check.status === "passed")).toBe(
    true,
  )
  expect(await exists(layout.pgliteDir)).toBe(true)
  expect(await exists(layout.artifactsDir)).toBe(true)
  expect(await exists(path.join(layout.rootDir, "pglite", "pglite"))).toBe(false)
  expect(JSON.stringify(report)).not.toContain("foo_bar_baz")
  expect(JSON.stringify(report)).not.toContain("TOOL_OUTPUT_SENTINEL")
})

test("lcm-db support commands diagnose and dry-run rebuild using the LCM root", async () => {
  await using tmp = await tmpdir()
  const { kiloDataDir, familyRoot: dataDir } = testFamilyRoot(tmp.path, "ses_m31_support_root")

  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir,
    runtimeMode: "source",
    schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
    smokeMode: true,
  })
  expect(status.status).toBe("ready")
  await worker.close()

  const diagnose = await withKiloDataDir(kiloDataDir, () => diagnoseLcmDb({ dataDir }))
  expect(diagnose.status).toBe("ready")
  expect(diagnose.quarantineRecommended).toBe(false)
  expect(diagnose.safeErrors).toEqual([])
  expect(diagnose.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Search extension available", status: "passed" }),
      expect.objectContaining({ name: "Retrieval search indexes available", status: "passed" }),
      expect.objectContaining({ name: "Deferred maintenance queue readable", status: "passed" }),
      expect.objectContaining({ name: "Large payload markers readable", status: "passed" }),
      expect.objectContaining({ name: "Path provenance records readable", status: "passed" }),
      expect.objectContaining({ name: "Map status rows readable", status: "passed" }),
      expect.objectContaining({ name: "Artifact cleanup queue readable", status: "passed" }),
    ]),
  )

  const rebuild = await withKiloDataDir(kiloDataDir, () => rebuildLcmDb({ dataDir, dryRun: true }))
  expect(rebuild.status).toBe("would_rebuild")
  expect(rebuild.dryRun).toBe(true)
  expect(rebuild.rebuiltConversations).toBe(0)
})
