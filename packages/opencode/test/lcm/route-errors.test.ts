// kilocode_change - new file
import { expect, test } from "bun:test"
import { lcmRouteHttpStatus } from "../../src/session/lcm/route-errors"
import type { LcmSafeError, LcmSafeErrorCode } from "../../src/session/lcm/types"

const EXPECTED_STATUS_BY_CODE: Record<LcmSafeErrorCode, number> = {
  invalid_request: 400,
  over_limit: 400,
  unauthorized: 403,
  permission_denied: 403,
  legacy_read_only: 403,
  not_found: 404,
  db_locked: 409,
  recovery_required: 409,
  recovery_failed: 409,
  missing_source: 409,
  stale_source: 409,
  db_unavailable: 503,
  db_migration_failed: 503,
  db_corrupt: 503,
  settings_unavailable: 503,
  provider_unavailable: 503,
  hard_limit_unresolved: 503,
  provider_capacity_deferred: 503,
  timeout: 504,
  canceled: 504,
}

function safeError(code: LcmSafeErrorCode): LcmSafeError {
  return {
    code,
    templateKey: "lcm.request.invalid",
    safeParams: {},
    safeMessage: "test",
    retryable: false,
  }
}

test("LCM route HTTP status mapping matches the public safe-error contract", () => {
  for (const [code, status] of Object.entries(EXPECTED_STATUS_BY_CODE) as Array<[LcmSafeErrorCode, number]>) {
    expect(lcmRouteHttpStatus(safeError(code)), code).toBe(status)
  }
})
