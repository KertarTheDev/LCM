// kilocode_change - new file
import { expect, test } from "bun:test"
import { lcmPreflightRecoverableSafeError } from "../../src/session/lcm/preflight-errors"
import { createLcmSafeError } from "../../src/session/lcm/types"

test("LCM preflight adds retry guidance to retryable local invalid-request failures", () => {
  const safeError = createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode: "lcm_preflight_model_not_found",
  })

  const recovered = lcmPreflightRecoverableSafeError(safeError)

  expect(recovered).toMatchObject({
    code: "invalid_request",
    retryable: true,
    action: "retry",
    safeParams: { action: "retry" },
  })
})

test("LCM preflight turns current-turn proof failures into repeat-input guidance", () => {
  const safeError = createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode: "lcm_memory_cue_current_turn_boundary_unproven",
  })

  const recovered = lcmPreflightRecoverableSafeError(safeError)

  expect(recovered).toMatchObject({
    retryable: false,
    action: "repeat_input",
    safeParams: { action: "repeat_input" },
  })
})

test("LCM preflight keeps DB lock recovery pointed at the other owner", () => {
  const safeError = createLcmSafeError({
    code: "db_locked",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: true },
    retryable: true,
    diagnosticCode: "lcm_preflight_locked_without_action",
  })

  const recovered = lcmPreflightRecoverableSafeError(safeError)

  expect(recovered).toMatchObject({
    retryable: true,
    action: "close_other_owner",
    safeParams: { retryable: true, action: "close_other_owner" },
  })
})

test("LCM preflight maps invalid source-sync shape failures to support guidance", () => {
  const safeError = createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode: "lcm_sync_invalid_message_v2_part",
  })

  const recovered = lcmPreflightRecoverableSafeError(safeError)

  expect(recovered).toMatchObject({
    retryable: false,
    action: "contact_support",
    safeParams: { action: "contact_support" },
  })
})

test("LCM preflight maps missing sync boundary failures to repeat-input guidance", () => {
  const safeError = createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode: "lcm_sync_upto_message_not_found",
  })

  const recovered = lcmPreflightRecoverableSafeError(safeError)

  expect(recovered).toMatchObject({
    retryable: false,
    action: "repeat_input",
    safeParams: { action: "repeat_input" },
  })
})

test("LCM preflight preserves explicit safe actions", () => {
  const safeError = createLcmSafeError({
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: { action: "start_new_thread" },
    retryable: false,
    diagnosticCode: "lcm_preflight_explicit_action",
  })

  expect(lcmPreflightRecoverableSafeError(safeError)).toBe(safeError)
})
