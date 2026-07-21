// kilocode_change - new file
import fs from "node:fs/promises"
import type { PGlite } from "@electric-sql/pglite"
import { coerceDbRequestError, createDbCorruptError } from "./db-errors"
import { resolveLcmDbLayout } from "./db-layout"
import type { LcmDbDiagnoseReport, LcmDbDiagnosticCheck, LcmDbStatus, LcmSafeError, OperationID } from "./types"

async function pathExists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

export async function lcmDbLayoutDiagnosticChecks(dataDir: string): Promise<LcmDbDiagnosticCheck[]> {
  const layout = resolveLcmDbLayout(dataDir)
  const rootExists = await pathExists(layout.rootDir)
  return [
    { name: "LCM root exists", status: rootExists ? "passed" : "skipped" },
    { name: "PGlite child directory", status: (await pathExists(layout.pgliteDir)) ? "passed" : "skipped" },
    { name: "Artifacts child directory", status: (await pathExists(layout.artifactsDir)) ? "passed" : "skipped" },
    { name: "Owner lock present", status: (await pathExists(layout.ownerLockPath)) ? "passed" : "skipped" },
  ]
}

function statusFromSafeErrors(safeErrors: readonly LcmSafeError[]): LcmDbStatus["status"] {
  if (safeErrors.length === 0) return "ready"
  return safeErrors.some((error) => error.code === "db_corrupt" || error.code === "db_migration_failed")
    ? "corrupt"
    : "unavailable"
}

function pushFailedCheck(input: {
  checks: LcmDbDiagnosticCheck[]
  safeErrors: LcmSafeError[]
  name: string
  safeError: LcmSafeError
}) {
  input.safeErrors.push(input.safeError)
  input.checks.push({ name: input.name, status: "failed", code: input.safeError.code })
}

async function readableCheck(input: {
  checks: LcmDbDiagnosticCheck[]
  safeErrors: LcmSafeError[]
  operationID: OperationID
  name: string
  run: () => Promise<void>
}) {
  try {
    await input.run()
    input.checks.push({ name: input.name, status: "passed" })
  } catch (error) {
    pushFailedCheck({
      checks: input.checks,
      safeErrors: input.safeErrors,
      name: input.name,
      safeError: coerceDbRequestError(error, { operationID: input.operationID }),
    })
  }
}

async function invariantCheck(input: {
  checks: LcmDbDiagnosticCheck[]
  safeErrors: LcmSafeError[]
  operationID: OperationID
  name: string
  diagnosticCode: string
  run: () => Promise<boolean>
}) {
  await readableCheck({
    checks: input.checks,
    safeErrors: input.safeErrors,
    operationID: input.operationID,
    name: input.name,
    run: async () => {
      if (await input.run()) return
      throw createDbCorruptError({
        operationID: input.operationID,
        diagnosticCode: input.diagnosticCode,
      })
    },
  })
}

export async function lcmDbContentDiagnosticChecks(input: {
  operationID: OperationID
  db: PGlite
}): Promise<{ checks: LcmDbDiagnosticCheck[]; safeErrors: LcmSafeError[] }> {
  const checks: LcmDbDiagnosticCheck[] = []
  const safeErrors: LcmSafeError[] = []

  await invariantCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Search extension available",
    diagnosticCode: "lcm_db_diagnose_pg_trgm_missing",
    run: async () => {
      const rows = (
        await input.db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS exists",
        )
      ).rows
      return rows[0]?.exists === true
    },
  })
  await invariantCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Retrieval search indexes available",
    diagnosticCode: "lcm_db_diagnose_retrieval_indexes_missing",
    run: async () => {
      const rows = (
        await input.db.query<{ index_count: number | string | bigint }>(
          `
            SELECT count(*)::int AS index_count
            FROM pg_indexes
            WHERE indexname IN ('lcm_message_parts_search_text_trgm_gin', 'lcm_summaries_content_text_trgm_gin')
          `,
        )
      ).rows
      return Number(rows[0]?.index_count ?? 0) === 2
    },
  })
  await readableCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Deferred maintenance queue readable",
    run: () =>
      input.db
        .query("SELECT count(*)::int FROM lcm_deferred_jobs WHERE job_kind = 'soft_maintenance'")
        .then(() => undefined),
  })
  await readableCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Large payload markers readable",
    run: () => input.db.query("SELECT count(*)::int FROM lcm_large_files").then(() => undefined),
  })
  await readableCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Path provenance records readable",
    run: () =>
      input.db.query("SELECT count(*)::int FROM lcm_large_files WHERE source_kind = 'path'").then(() => undefined),
  })
  await readableCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Map status rows readable",
    run: () =>
      input.db
        .query("SELECT count(*)::int FROM lcm_map_runs LEFT JOIN lcm_map_items USING (map_id)")
        .then(() => undefined),
  })
  await readableCheck({
    checks,
    safeErrors,
    operationID: input.operationID,
    name: "Artifact cleanup queue readable",
    run: () => input.db.query("SELECT count(*)::int FROM lcm_artifact_cleanup_queue").then(() => undefined),
  })

  return { checks, safeErrors }
}

export async function diagnoseOpenLcmDb(input: {
  operationID: OperationID
  dataDir: string
  schemaVersion?: number
  db: PGlite
}): Promise<LcmDbDiagnoseReport> {
  const checks = await lcmDbLayoutDiagnosticChecks(input.dataDir)
  const safeErrors: LcmSafeError[] = []

  checks.push({ name: "Open DB for diagnosis", status: "passed" })

  try {
    const rows = (
      await input.db.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lcm_migrations') AS exists",
      )
    ).rows
    if (rows[0]?.exists) {
      checks.push({ name: "Production migration registry readable", status: "passed" })
    } else {
      const safe = createDbCorruptError({
        operationID: input.operationID,
        diagnosticCode: "lcm_db_diagnose_migration_registry_missing",
      })
      safeErrors.push(safe)
      checks.push({ name: "Production migration registry readable", status: "failed", code: safe.code })
    }
  } catch (error) {
    const safe = coerceDbRequestError(error, { operationID: input.operationID })
    safeErrors.push(safe)
    checks.push({ name: "Production migration registry readable", status: "failed", code: safe.code })
  }
  if (safeErrors.length === 0) {
    const content = await lcmDbContentDiagnosticChecks({ operationID: input.operationID, db: input.db })
    checks.push(...content.checks)
    safeErrors.push(...content.safeErrors)
  }

  const status = statusFromSafeErrors(safeErrors)
  return {
    operationID: input.operationID,
    dataDir: input.dataDir,
    status,
    schemaVersion: input.schemaVersion,
    checks,
    safeErrors,
    quarantineRecommended: status === "corrupt",
  }
}
