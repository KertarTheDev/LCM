// kilocode_change - new file
import { createLcmSafeError, type LcmDbStatus, type LcmSafeError, type OperationID } from "./types"
import { parseLcmSafeError } from "./safe-error-schema"

export function createDbLockedError(input?: { operationID?: OperationID; diagnosticCode?: string }) {
  return createLcmSafeError({
    code: "db_locked",
    templateKey: "lcm.db.unavailable",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable: true,
      action: "close_other_owner",
    },
    retryable: true,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_locked",
  })
}

export function createDbCorruptError(input?: { operationID?: OperationID; diagnosticCode?: string }) {
  return createLcmSafeError({
    code: "db_corrupt",
    templateKey: "lcm.db.unavailable",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable: false,
      action: "contact_support",
    },
    retryable: false,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_corrupt",
  })
}

export function createDbMigrationFailedError(input?: { operationID?: OperationID; diagnosticCode?: string }) {
  return createLcmSafeError({
    code: "db_migration_failed",
    templateKey: "lcm.db.unavailable",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable: false,
      action: "contact_support",
    },
    retryable: false,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_migration_failed",
  })
}

export function createDbUnavailableError(input?: {
  operationID?: OperationID
  diagnosticCode?: string
  retryable?: boolean
}) {
  const retryable = input?.retryable ?? false
  return createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable,
      action: retryable ? "retry" : "contact_support",
    },
    retryable,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_unavailable",
  })
}

export function createDbRequestTimeoutError(input?: { operationID?: OperationID; diagnosticCode?: string }) {
  return createLcmSafeError({
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_request_timeout",
  })
}

export function createDbRequestCanceledError(input?: { operationID?: OperationID; diagnosticCode?: string }) {
  return createLcmSafeError({
    code: "canceled",
    templateKey: "lcm.operation.canceled",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      retryable: false,
    },
    retryable: false,
    diagnosticCode: input?.diagnosticCode ?? "lcm_db_request_canceled",
  })
}

export function isLcmSafeError(error: unknown): error is LcmSafeError {
  return parseLcmSafeError(error) !== undefined
}

export function safeErrorForDbStatus(status: LcmDbStatus): LcmSafeError {
  if (status.safeError) return status.safeError
  if (status.status === "locked") return createDbLockedError()
  if (status.status === "corrupt") return createDbCorruptError()
  return createDbUnavailableError({ diagnosticCode: `lcm_db_${status.status}` })
}

function dbErrorText(error: unknown): string {
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null) return ""
  const record = error as {
    name?: unknown
    code?: unknown
    message?: unknown
    reason?: unknown
    cause?: unknown
  }
  return [record.name, record.code, record.message, record.reason, dbErrorText(record.cause)]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
}

export function coerceDbRequestError(error: unknown, input?: { operationID?: OperationID }): LcmSafeError {
  if (isLcmSafeError(error)) return error
  const text = dbErrorText(error).toLowerCase()
  if (text.includes("owner lock") || text.includes("owner.lock") || text.includes("lock conflict")) {
    return createDbLockedError({ operationID: input?.operationID, diagnosticCode: "lcm_db_request_owner_locked" })
  }
  if (
    text.includes("database is locked") ||
    text.includes("database locked") ||
    text.includes("database busy") ||
    text.includes("sqlite_busy") ||
    text.includes("busy")
  ) {
    return createDbUnavailableError({
      operationID: input?.operationID,
      diagnosticCode: "lcm_db_request_busy",
      retryable: true,
    })
  }
  if (text.includes("interrupt") || text.includes("interrupted") || text.includes("abort")) {
    return createDbUnavailableError({
      operationID: input?.operationID,
      diagnosticCode: "lcm_db_request_interrupted",
      retryable: true,
    })
  }
  if (text.includes("closed") || text.includes("closing") || text.includes("disposed") || text.includes("terminated")) {
    return createDbUnavailableError({
      operationID: input?.operationID,
      diagnosticCode: "lcm_db_request_closed",
      retryable: true,
    })
  }
  if (text.includes("corrupt") || text.includes("malformed")) {
    return createDbCorruptError({ operationID: input?.operationID, diagnosticCode: "lcm_db_request_corrupt" })
  }
  return createDbUnavailableError({ operationID: input?.operationID, diagnosticCode: "lcm_db_request_failed" })
}
