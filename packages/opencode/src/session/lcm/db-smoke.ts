// kilocode_change - new file
import fs from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { createLcmDbWorker } from "./db-worker"
import { resolveLcmDbLayout } from "./db-layout"
import { lcmDbContentDiagnosticChecks } from "./db-diagnostics"
import { resolveDebugFamilyTarget } from "./family"
import {
  coerceDbRequestError,
  createDbCorruptError,
  createDbUnavailableError,
  isLcmSafeError,
  safeErrorForDbStatus,
} from "./db-errors"
import { getLcmPGliteAssetReport } from "./pglite-assets"
import { getLcmProductionSchemaVersion } from "./migrations"
import { LCM_PGLITE_GATE_RELEASE_SCALE, runPgliteGateProbe, type LcmPGliteGateScale } from "./pglite-gate"
import { runPgliteRegexCancellationProbe } from "./pglite-regex-cancel"
import type {
  LcmDbDiagnoseReport,
  LcmDbDiagnosticCheck,
  LcmDbRebuildReport,
  LcmDbSmokeReport,
  LcmDbSmokeRuntimeMode,
  LcmDbStatusCode,
  LcmSafeError,
  OperationID,
} from "./types"

export const LCM_DB_GATE_SCHEMA_VERSION = getLcmProductionSchemaVersion()

type SmokeDetailCode = NonNullable<LcmDbSmokeReport["checks"][number]["detailCode"]>

export interface RunLcmDbSmokeInput {
  readonly dataDir: string
  readonly runtimeMode: LcmDbSmokeRuntimeMode
  readonly schemaVersion?: number
  readonly scale?: Partial<LcmPGliteGateScale>
  readonly regexStartupTimeoutMs?: number
  readonly regexQueryTimeoutMs?: number
}

export interface RunLcmDbSupportInput {
  readonly dataDir: string
  readonly schemaVersion?: number
}

function operationID(prefix: string): OperationID {
  return `op_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` as OperationID
}

function statExists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

function smokeError(input: { operationID: OperationID; diagnosticCode: string; safeError?: unknown }) {
  if (isLcmSafeError(input.safeError)) return input.safeError
  return createDbUnavailableError({
    operationID: input.operationID,
    diagnosticCode: input.diagnosticCode,
  })
}

function checkStatus(checks: LcmDbDiagnosticCheck[]) {
  return checks.some((check) => check.status === "failed") ? ("failed" as const) : ("passed" as const)
}

async function withCheck(
  input: {
    checks: LcmDbSmokeReport["checks"]
    safeErrors: LcmSafeError[]
    operationID: OperationID
    name: string
    detailCode: SmokeDetailCode
  },
  run: () => Promise<boolean>,
) {
  try {
    if (await run()) {
      input.checks.push({ name: input.name, status: "passed", detailCode: input.detailCode })
      return true
    }
    const safe = smokeError({
      operationID: input.operationID,
      diagnosticCode: `lcm_db_smoke_${input.detailCode}_failed`,
    })
    input.safeErrors.push(safe)
    input.checks.push({ name: input.name, status: "failed", code: safe.code, detailCode: input.detailCode })
    return false
  } catch (error) {
    const safe = smokeError({
      operationID: input.operationID,
      diagnosticCode: `lcm_db_smoke_${input.detailCode}_failed`,
      safeError: error,
    })
    input.safeErrors.push(safe)
    input.checks.push({ name: input.name, status: "failed", code: safe.code, detailCode: input.detailCode })
    return false
  }
}

export async function runLcmDbSmoke(input: RunLcmDbSmokeInput): Promise<LcmDbSmokeReport> {
  const operation = operationID("lcm_db_smoke")
  const schemaVersion = input.schemaVersion ?? LCM_DB_GATE_SCHEMA_VERSION
  const target = await resolveDebugFamilyTarget({
    familyRoot: input.dataDir,
    runtimeMode: input.runtimeMode,
    schemaVersion,
  })
  const layout = resolveLcmDbLayout(target.familyRoot)
  const checks: LcmDbSmokeReport["checks"] = []
  const safeErrors: LcmSafeError[] = []
  const worker = createLcmDbWorker()
  const markerUsageID = `usage_${operation}`
  const markerProjectID = `project_${operation}`

  const checkInput = {
    checks,
    safeErrors,
    operationID: operation,
  }

  const startupReady = await withCheck(
    {
      ...checkInput,
      name: "PGlite startup",
      detailCode: "pglite_startup",
    },
    async () => {
      const status = await worker.initialize({
        dataDir: layout.rootDir,
        runtimeMode: target.runtimeMode,
        schemaVersion,
        smokeMode: true,
      })
      if (status.status !== "ready") throw status.safeError ?? safeErrorForDbStatus(status)
      return true
    },
  )

  if (!startupReady) {
    await worker.close().catch(() => undefined)
    return {
      operationID: operation,
      dataDir: layout.rootDir,
      runtimeMode: input.runtimeMode,
      status: "failed",
      schemaVersion,
      checks,
      safeErrors,
    }
  }

  await withCheck(
    {
      ...checkInput,
      name: "LCM root layout and owner lock",
      detailCode: "owner_lock",
    },
    async () =>
      (await statExists(layout.pgliteDir)) &&
      (await statExists(layout.artifactsDir)) &&
      (await statExists(layout.ownerLockPath)),
  )

  await withCheck(
    {
      ...checkInput,
      name: "Fresh create and smoke write",
      detailCode: "fresh_create",
    },
    async () => {
      await worker.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) => {
          await (db as PGlite).query(
            `
              INSERT INTO lcm_usage_records (
                usage_record_id,
                source_session_id,
                purpose,
                mode,
                cost_status,
                created_at_ms
              )
              VALUES ($1, $2, 'leaf_summary', 'background', 'not_applicable', $3)
              ON CONFLICT (usage_record_id) DO UPDATE SET
                created_at_ms = excluded.created_at_ms
            `,
            [markerUsageID, markerProjectID, Date.now()],
          )
        },
      })
      return true
    },
  )

  await withCheck(
    {
      ...checkInput,
      name: "Embedded PGlite asset loading",
      detailCode: "asset_loading",
    },
    async () => (await getLcmPGliteAssetReport()).assets.every((asset) => asset.exists),
  )

  await withCheck(
    {
      ...checkInput,
      name: "pg_trgm extension",
      detailCode: "pg_trgm",
    },
    async () =>
      await worker.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) => {
          await (db as PGlite).exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
          const rows = (
            await (db as PGlite).query<{ extname: string }>(
              "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
            )
          ).rows
          return rows[0]?.extname === "pg_trgm"
        },
      }),
  )

  let gateProbe: Awaited<ReturnType<typeof runPgliteGateProbe>> | undefined

  await withCheck(
    {
      ...checkInput,
      name: "Literal search and index probe",
      detailCode: "literal_search",
    },
    async () => {
      gateProbe = await worker.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) =>
          runPgliteGateProbe(db as PGlite, {
            scale: {
              ...LCM_PGLITE_GATE_RELEASE_SCALE,
              ...input.scale,
            },
          }),
      })
      return (
        gateProbe.requiredIndexesPresent &&
        gateProbe.literalSearchPassed &&
        gateProbe.regexSearchPassed &&
        gateProbe.summarySearchPassed &&
        gateProbe.largeFileLookupPassed &&
        gateProbe.archiveLookupPassed &&
        gateProbe.trigramPlanUsesIndex
      )
    },
  )

  await withCheck(
    {
      ...checkInput,
      name: "Map claim and lease recovery probe",
      detailCode: "map_claim",
    },
    async () => Boolean(gateProbe?.mapClaimPassed && gateProbe.mapLeaseRecoveryPassed),
  )

  await withCheck(
    {
      ...checkInput,
      name: "Regex cancellation releases worker",
      detailCode: "regex_cancellation",
    },
    async () => {
      const cancel = await runPgliteRegexCancellationProbe({
        startupTimeoutMs: input.regexStartupTimeoutMs,
        queryTimeoutMs: input.regexQueryTimeoutMs,
      })
      if (!cancel.cancelled || !cancel.workerReleased) return false
      return await worker.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) => {
          const rows = (await (db as PGlite).query<{ ok: number }>("SELECT 1 AS ok")).rows
          return rows[0]?.ok === 1
        },
      })
    },
  )

  checks.push({
    name: "Packaged runtime mode",
    status: input.runtimeMode === "source" ? "skipped" : "passed",
    detailCode: "packaged_runtime",
  })

  await worker.close().catch((error) => {
    const safe = coerceDbRequestError(error)
    safeErrors.push(safe)
    checks.push({ name: "Close source worker", status: "failed", code: safe.code })
  })

  const reopened = createLcmDbWorker()
  await withCheck(
    {
      ...checkInput,
      name: "Reopen persistent smoke state",
      detailCode: "reopen",
    },
    async () => {
      const status = await reopened.initialize({
        dataDir: layout.rootDir,
        runtimeMode: target.runtimeMode,
        schemaVersion,
        smokeMode: true,
      })
      if (status.status !== "ready") throw status.safeError ?? safeErrorForDbStatus(status)
      const rows = await reopened.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) =>
          (
            await (db as PGlite).query<{ purpose: string }>(
              "SELECT purpose FROM lcm_usage_records WHERE usage_record_id = $1 AND source_session_id = $2",
              [markerUsageID, markerProjectID],
            )
          ).rows,
      })
      await reopened.executeForeground({
        operationID: operation,
        purpose: "smoke",
        run: async (db) => {
          await (db as PGlite).query("DELETE FROM lcm_usage_records WHERE usage_record_id = $1", [markerUsageID])
        },
      })
      return rows[0]?.purpose === "leaf_summary"
    },
  )
  await reopened.close().catch(() => undefined)

  return {
    operationID: operation,
    dataDir: layout.rootDir,
    runtimeMode: target.runtimeMode,
    status: checkStatus(checks),
    schemaVersion,
    checks,
    safeErrors,
  }
}

export async function diagnoseLcmDb(input: RunLcmDbSupportInput): Promise<LcmDbDiagnoseReport> {
  const operation = operationID("lcm_db_diagnose")
  const schemaVersion = input.schemaVersion ?? LCM_DB_GATE_SCHEMA_VERSION
  const target = await resolveDebugFamilyTarget({ familyRoot: input.dataDir, schemaVersion })
  const layout = resolveLcmDbLayout(target.familyRoot)
  const checks: LcmDbDiagnosticCheck[] = []
  const safeErrors: LcmSafeError[] = []

  const rootExists = await statExists(layout.rootDir)
  checks.push({ name: "LCM root exists", status: rootExists ? "passed" : "skipped" })
  checks.push({ name: "PGlite child directory", status: (await statExists(layout.pgliteDir)) ? "passed" : "skipped" })
  checks.push({
    name: "Artifacts child directory",
    status: (await statExists(layout.artifactsDir)) ? "passed" : "skipped",
  })
  checks.push({ name: "Owner lock present", status: (await statExists(layout.ownerLockPath)) ? "passed" : "skipped" })

  const worker = createLcmDbWorker()
  let status: LcmDbStatusCode = "uninitialized"
  try {
    const initialized = await worker.initialize({
      dataDir: layout.rootDir,
      runtimeMode: "source",
      schemaVersion,
      smokeMode: true,
    })
    status = initialized.status
    if (initialized.safeError) safeErrors.push(initialized.safeError)
    checks.push({
      name: "Open DB for diagnosis",
      status: initialized.status === "ready" ? "passed" : "failed",
      ...(initialized.safeError ? { code: initialized.safeError.code } : {}),
    })
    if (initialized.status === "ready") {
      const rows = await worker.executeForeground({
        operationID: operation,
        purpose: "debug_support",
        run: async (db) =>
          (
            await (db as PGlite).query<{ exists: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lcm_migrations') AS exists",
            )
          ).rows,
      })
      checks.push({
        name: "Production migration registry readable",
        status: rows[0]?.exists ? "passed" : "failed",
      })
      if (rows[0]?.exists) {
        const content = await worker.executeForeground({
          operationID: operation,
          purpose: "debug_support",
          run: async (db) => lcmDbContentDiagnosticChecks({ operationID: operation, db: db as PGlite }),
        })
        checks.push(...content.checks)
        safeErrors.push(...content.safeErrors)
        if (content.safeErrors.length > 0) {
          status = content.safeErrors.some(
            (error) => error.code === "db_corrupt" || error.code === "db_migration_failed",
          )
            ? "corrupt"
            : "unavailable"
        }
      } else {
        safeErrors.push(
          createDbCorruptError({
            operationID: operation,
            diagnosticCode: "lcm_db_diagnose_migration_registry_missing",
          }),
        )
        status = "corrupt"
      }
    }
  } catch (error) {
    const safe = smokeError({
      operationID: operation,
      diagnosticCode: "lcm_db_diagnose_failed",
      safeError: error,
    })
    safeErrors.push(safe)
    status = safe.code === "db_corrupt" ? "corrupt" : "unavailable"
    checks.push({ name: "Open DB for diagnosis", status: "failed", code: safe.code })
  } finally {
    await worker.close().catch(() => undefined)
  }

  return {
    operationID: operation,
    dataDir: layout.rootDir,
    status,
    schemaVersion,
    checks,
    safeErrors,
    quarantineRecommended: status === "corrupt",
  }
}

export async function rebuildLcmDb(input: RunLcmDbSupportInput & { dryRun: boolean }): Promise<LcmDbRebuildReport> {
  const operation = operationID("lcm_db_rebuild")
  const schemaVersion = input.schemaVersion ?? LCM_DB_GATE_SCHEMA_VERSION
  const target = await resolveDebugFamilyTarget({ familyRoot: input.dataDir, schemaVersion })
  const layout = resolveLcmDbLayout(target.familyRoot)
  const safeErrors: LcmSafeError[] = []
  const diagnose = await diagnoseLcmDb({ dataDir: layout.rootDir, schemaVersion })
  safeErrors.push(...diagnose.safeErrors)

  if (input.dryRun) {
    return {
      operationID: operation,
      dataDir: layout.rootDir,
      dryRun: true,
      status: "would_rebuild",
      rebuiltConversations: 0,
      readOnlyConversations: 0,
      skippedConversations: 0,
      failedConversations: 0,
      safeErrors,
    }
  }

  if (diagnose.status === "locked") {
    return {
      operationID: operation,
      dataDir: layout.rootDir,
      dryRun: false,
      status: "failed",
      rebuiltConversations: 0,
      readOnlyConversations: 0,
      skippedConversations: 0,
      failedConversations: 0,
      safeErrors:
        safeErrors.length > 0
          ? safeErrors
          : [
              createDbUnavailableError({
                operationID: operation,
                diagnosticCode: "lcm_db_rebuild_locked",
                retryable: true,
              }),
            ],
    }
  }

  const quarantine = `${layout.pgliteDir}.quarantine.${operation}`
  if (await statExists(layout.pgliteDir)) {
    await fs.rename(layout.pgliteDir, quarantine)
  } else {
    await fs.mkdir(path.dirname(quarantine), { recursive: true })
  }

  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir: layout.rootDir,
    runtimeMode: "source",
    schemaVersion,
    smokeMode: true,
  })
  await worker.close().catch(() => undefined)

  if (status.status !== "ready") {
    if (status.safeError) safeErrors.push(status.safeError)
    return {
      operationID: operation,
      dataDir: layout.rootDir,
      dryRun: false,
      status: "failed",
      quarantinedDataDir: quarantine,
      rebuiltConversations: 0,
      readOnlyConversations: 0,
      skippedConversations: 0,
      failedConversations: 0,
      safeErrors,
    }
  }

  return {
    operationID: operation,
    dataDir: layout.rootDir,
    dryRun: false,
    status: "rebuilt",
    quarantinedDataDir: quarantine,
    rebuiltConversations: 0,
    readOnlyConversations: 0,
    skippedConversations: 0,
    failedConversations: 0,
    safeErrors,
  }
}
