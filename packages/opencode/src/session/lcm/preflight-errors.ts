// kilocode_change - new file
import type { LcmSafeAction, LcmSafeError } from "./types"

const LCM_PREFLIGHT_INVALID_REQUEST_ACTIONS: Record<string, { action: LcmSafeAction; retryable: boolean }> = {
  lcm_memory_cue_current_turn_boundary_unproven: { action: "repeat_input", retryable: false },
  lcm_preflight_context_resolution_failed: { action: "retry", retryable: true },
  lcm_preflight_current_user_unproven: { action: "repeat_input", retryable: false },
  lcm_preflight_hard_limit_failed: { action: "retry", retryable: true },
  lcm_preflight_hard_limit_unresolved: { action: "start_new_thread", retryable: false },
  lcm_preflight_model_not_found: { action: "retry", retryable: true },
  lcm_preflight_post_assembly_failed: { action: "retry", retryable: true },
  lcm_preflight_render_preparation_missing: { action: "retry", retryable: true },
  lcm_preflight_runtime_services_missing: { action: "contact_support", retryable: false },
  lcm_preflight_unhandled_failure: { action: "retry", retryable: true },
  lcm_retrieval_unhandled_failure: { action: "retry", retryable: true },
  lcm_sync_mapping_failed: { action: "contact_support", retryable: false },
  lcm_sync_upto_message_not_found: { action: "repeat_input", retryable: false },
}

const LCM_PREFLIGHT_INVALID_REQUEST_PREFIX_ACTIONS: Array<{
  readonly prefix: string
  readonly action: LcmSafeAction
  readonly retryable: boolean
}> = [
  { prefix: "lcm_large_payload_", action: "contact_support", retryable: false },
  { prefix: "lcm_sync_invalid_", action: "contact_support", retryable: false },
  { prefix: "lcm_unknown_", action: "contact_support", retryable: false },
]

function lcmPreflightFallbackAction(error: LcmSafeError): { action: LcmSafeAction; retryable: boolean } | undefined {
  switch (error.code) {
    case "db_locked":
      return { action: "close_other_owner", retryable: true }
    case "db_unavailable":
      return { action: error.retryable ? "retry" : "contact_support", retryable: error.retryable }
    case "db_corrupt":
    case "db_migration_failed":
      return { action: "contact_support", retryable: false }
    case "settings_unavailable":
    case "provider_unavailable":
    case "provider_capacity_deferred":
    case "timeout":
      return { action: "retry", retryable: true }
    case "missing_source":
    case "stale_source":
    case "permission_denied":
      return { action: error.code === "missing_source" ? "repeat_input" : "re_register_file", retryable: false }
    case "recovery_required":
      return { action: error.retryable ? "retry" : "repeat_input", retryable: error.retryable }
    case "recovery_failed":
    case "legacy_read_only":
    case "hard_limit_unresolved":
      return { action: "start_new_thread", retryable: false }
    case "invalid_request": {
      if (!error.diagnosticCode) return undefined
      const exact = LCM_PREFLIGHT_INVALID_REQUEST_ACTIONS[error.diagnosticCode]
      if (exact) return exact
      const prefix = LCM_PREFLIGHT_INVALID_REQUEST_PREFIX_ACTIONS.find((entry) =>
        error.diagnosticCode?.startsWith(entry.prefix),
      )
      return prefix ? { action: prefix.action, retryable: prefix.retryable } : undefined
    }
  }
  if (error.retryable) return { action: "retry", retryable: true }
  return undefined
}

export function lcmPreflightRecoverableSafeError(error: LcmSafeError): LcmSafeError {
  if (error.action) return error
  const fallback = lcmPreflightFallbackAction(error)
  if (!fallback) return error
  const safeParams = {
    ...(error.safeParams as Record<string, unknown>),
    action: fallback.action,
  }
  if ("retryable" in safeParams) safeParams.retryable = fallback.retryable
  return {
    ...error,
    safeParams: safeParams as LcmSafeError["safeParams"],
    action: fallback.action,
    retryable: fallback.retryable,
  }
}
