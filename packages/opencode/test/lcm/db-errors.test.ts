// kilocode_change - new file
import { expect, test } from "bun:test"
import { coerceDbRequestError } from "../../src/session/lcm/db-errors"
import type { OperationID } from "../../src/session/lcm/types"

const operationID = "op_db_errors" as OperationID

test("db request errors are classified into content-safe diagnostics", () => {
  const busy = coerceDbRequestError(new Error("PGlite database is busy: RAW_BUSY_SECRET"), { operationID })
  expect(busy).toMatchObject({
    code: "db_unavailable",
    retryable: true,
    diagnosticCode: "lcm_db_request_busy",
    safeParams: { operationID, retryable: true, action: "retry" },
  })

  const closed = coerceDbRequestError(
    Object.assign(new Error("PGlite worker closed: RAW_CLOSED_SECRET"), {
      code: "ERR_CLOSED",
    }),
  )
  expect(closed).toMatchObject({
    code: "db_unavailable",
    retryable: true,
    diagnosticCode: "lcm_db_request_closed",
  })

  const interrupted = coerceDbRequestError(new Error("query interrupted while closing: RAW_INTERRUPTED_SECRET"))
  expect(interrupted).toMatchObject({
    code: "db_unavailable",
    retryable: true,
    diagnosticCode: "lcm_db_request_interrupted",
  })

  const corrupt = coerceDbRequestError(new Error("database disk image is malformed: RAW_CORRUPT_SECRET"))
  expect(corrupt).toMatchObject({
    code: "db_corrupt",
    retryable: false,
    diagnosticCode: "lcm_db_request_corrupt",
  })

  const unknown = coerceDbRequestError(new Error("unexpected SQL failure: RAW_UNKNOWN_SECRET"))
  expect(unknown).toMatchObject({
    code: "db_unavailable",
    retryable: false,
    diagnosticCode: "lcm_db_request_failed",
  })

  expect(JSON.stringify({ busy, closed, interrupted, corrupt, unknown })).not.toContain("RAW_")
})
