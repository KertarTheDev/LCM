// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { Effect } from "effect"
import { LcmDb } from "./db"
import { diagnoseOpenLcmDb } from "./db-diagnostics"
import { isLcmSafeError } from "./db-errors"
import { diagnoseLcmDb, rebuildLcmDb } from "./db-smoke"
import { resolveSessionFamilyTargetEffect } from "./family"
import { createOperationID } from "./id"
import { syncFinalizedMessages as syncFinalizedSourceMessages } from "./source-sync"
import {
  createLcmSafeError,
  type LcmDbDiagnoseReport,
  type LcmDbRebuildReport,
  type LcmDbStatus,
  type LcmSafeAction,
  type LcmSafeError,
  type OperationID,
} from "./types"

function invalidDbSupportRequest(
  diagnosticCode: string,
  input?: {
    operationID?: OperationID
    action?: LcmSafeAction
    retryable?: boolean
  },
) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.action ? { action: input.action } : {}),
    },
    retryable: input?.retryable ?? false,
    diagnosticCode,
  })
}

export const diagnoseRuntimeLcmDb = Effect.fn("LcmDbSupportActions.diagnoseRuntimeLcmDb")(function* (input: {
  lcmDb: LcmDb.Interface
  sessionID: string
}) {
  const operationID = createOperationID()
  const resolved = yield* resolveSessionFamilyTargetEffect({ sessionID: input.sessionID })
  const target = resolved.target
  const currentStatus = yield* input.lcmDb.getFamilyStatus?.(target) ??
    Effect.succeed<LcmDbStatus | undefined>(undefined)

  if (currentStatus?.status === "ready") {
    const scopedDb = LcmDb.scoped(input.lcmDb, target)
    return yield* scopedDb.executeForeground({
      operationID,
      purpose: "debug_support",
      run: (db) =>
        diagnoseOpenLcmDb({
          operationID,
          dataDir: target.familyRoot,
          schemaVersion: target.schemaVersion,
          db: db as PGlite,
        }),
    })
  }

  return yield* Effect.tryPromise({
    try: () => diagnoseLcmDb({ dataDir: target.familyRoot, schemaVersion: target.schemaVersion }),
    catch: (error) =>
      isLcmSafeError(error) ? error : invalidDbSupportRequest("lcm_db_diagnose_failed", { operationID }),
  })
})

export const rebuildRuntimeLcmDb = Effect.fn("LcmDbSupportActions.rebuildRuntimeLcmDb")(function* (input: {
  lcmDb: LcmDb.Interface
  sessionID: string
  dryRun: boolean
}) {
  const operationID = createOperationID()
  const resolved = yield* resolveSessionFamilyTargetEffect({ sessionID: input.sessionID })
  const target = resolved.target
  const currentStatus = yield* input.lcmDb.getFamilyStatus?.(target) ??
    Effect.succeed<LcmDbStatus | undefined>(undefined)

  const currentStatusCode = currentStatus?.status ?? "uninitialized"
  let repairStatus = currentStatusCode
  if (!input.dryRun && (repairStatus === "uninitialized" || repairStatus === "closed")) {
    const diagnosis = yield* Effect.tryPromise({
      try: () => diagnoseLcmDb({ dataDir: target.familyRoot, schemaVersion: target.schemaVersion }),
      catch: (error) =>
        isLcmSafeError(error)
          ? error
          : invalidDbSupportRequest("lcm_db_rebuild_preflight_diagnose_failed", { operationID }),
    })
    repairStatus = diagnosis.status
  }

  if (!input.dryRun && repairStatus !== "corrupt" && repairStatus !== "unavailable") {
    const diagnosticCode =
      repairStatus === "ready" ? "lcm_db_rebuild_refused_ready_family" : "lcm_db_rebuild_refused_non_repairable_status"
    return yield* Effect.fail(
      invalidDbSupportRequest(diagnosticCode, {
        operationID,
        action: repairStatus === "locked" ? "close_other_owner" : "contact_support",
        retryable: repairStatus === "starting" || repairStatus === "migrating",
      }),
    )
  }

  if (!input.dryRun && input.lcmDb.closeFamily) {
    yield* input.lcmDb
      .closeFamily(target)
      .pipe(
        Effect.catch((safeError) =>
          Effect.fail(isLcmSafeError(safeError) ? safeError : invalidDbSupportRequest("lcm_db_rebuild_close_failed")),
        ),
      )
  }

  const report = yield* Effect.tryPromise({
    try: () =>
      rebuildLcmDb({
        dataDir: target.familyRoot,
        schemaVersion: target.schemaVersion,
        dryRun: input.dryRun,
      }),
    catch: (error) =>
      isLcmSafeError(error) ? error : invalidDbSupportRequest("lcm_db_rebuild_failed", { operationID }),
  })

  if (input.dryRun || report.status !== "rebuilt") return report

  const sync = yield* syncFinalizedSourceMessages({ sessionID: input.sessionID }).pipe(
    Effect.provideService(LcmDb.Service, input.lcmDb),
    Effect.match({
      onFailure: (safeError) => ({ ok: false as const, safeError }),
      onSuccess: (sync) => ({ ok: true as const, sync }),
    }),
  )
  if (!sync.ok) {
    return {
      ...report,
      status: "partial" as const,
      failedConversations: Math.max(1, report.failedConversations),
      safeErrors: [...report.safeErrors, sync.safeError],
    }
  }
  return {
    ...report,
    rebuiltConversations: Math.max(report.rebuiltConversations, 1),
  }
})
