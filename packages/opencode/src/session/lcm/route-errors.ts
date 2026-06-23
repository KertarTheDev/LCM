// kilocode_change - new file
import type { LcmRouteErrorResponse, LcmSafeError } from "./types"

export function lcmRouteErrorResponse(error: LcmSafeError): LcmRouteErrorResponse {
  return { ok: false, error }
}

export function lcmRouteHttpStatus(error: LcmSafeError) {
  switch (error.code) {
    case "invalid_request":
    case "over_limit":
      return 400
    case "unauthorized":
    case "permission_denied":
    case "legacy_read_only":
      return 403
    case "not_found":
      return 404
    case "db_locked":
    case "recovery_required":
    case "recovery_failed":
    case "missing_source":
    case "stale_source":
      return 409
    case "db_unavailable":
    case "db_migration_failed":
    case "db_corrupt":
    case "settings_unavailable":
    case "provider_unavailable":
    case "hard_limit_unresolved":
    case "provider_capacity_deferred":
      return 503
    case "timeout":
    case "canceled":
      return 504
  }
}
