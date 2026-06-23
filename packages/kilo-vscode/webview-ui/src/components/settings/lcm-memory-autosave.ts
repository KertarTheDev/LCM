import type { LcmSafeError } from "@kilocode/sdk/v2/client"
import { LCM_MEMORY_SETTINGS_REFRESH_DEBOUNCE_MS } from "./lcm-memory-refresh"
import { parseStorageThresholdGiB } from "./lcm-memory-state"

export const LCM_MEMORY_SETTINGS_AUTOSAVE_DEBOUNCE_MS = LCM_MEMORY_SETTINGS_REFRESH_DEBOUNCE_MS
export const LCM_INVALID_FRESH_TAIL_DIAGNOSTIC_CODE = "lcm_webview_invalid_fresh_tail_tokens"
export const LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE = "lcm_webview_invalid_storage_threshold"

type TimerHandle = ReturnType<typeof setTimeout>

type AutosaveTimers = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export type LcmNumericSettingsPatch = {
  freshTailTokens?: number
  storageWarningThresholdBytes?: number
}

export type LcmNumericSettingsAutosaveInput = {
  freshTailDraft: string
  storageThresholdDraft: string
  currentFreshTailTokens?: number
  currentStorageWarningThresholdBytes?: number
}

export type LcmNumericSettingsAutosaveAction =
  | { kind: "idle" }
  | { kind: "invalid"; error: LcmSafeError }
  | { kind: "patch"; patch: LcmNumericSettingsPatch }

export function parseFreshTailTokens(input: string) {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const tokens = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return undefined
  return tokens
}

function invalidFreshTailError(): LcmSafeError {
  return {
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    safeMessage: "Fresh tail must be a positive token count.",
    retryable: false,
    diagnosticCode: LCM_INVALID_FRESH_TAIL_DIAGNOSTIC_CODE,
  }
}

function invalidStorageThresholdError(): LcmSafeError {
  return {
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    safeMessage: "Storage warning threshold must be a positive GiB value.",
    retryable: false,
    diagnosticCode: LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE,
  }
}

export function isLcmMemoryAutosaveValidationError(error: LcmSafeError | undefined) {
  return (
    error?.diagnosticCode === LCM_INVALID_FRESH_TAIL_DIAGNOSTIC_CODE ||
    error?.diagnosticCode === LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE
  )
}

export function lcmNumericSettingsAutosaveAction(
  input: LcmNumericSettingsAutosaveInput,
): LcmNumericSettingsAutosaveAction {
  const freshTailTokens = parseFreshTailTokens(input.freshTailDraft)
  if (freshTailTokens === undefined) return { kind: "invalid", error: invalidFreshTailError() }

  const storageWarningThresholdBytes = parseStorageThresholdGiB(input.storageThresholdDraft)
  if (storageWarningThresholdBytes === undefined) return { kind: "invalid", error: invalidStorageThresholdError() }

  const patch: LcmNumericSettingsPatch = {}
  if (
    typeof input.currentFreshTailTokens === "number" &&
    Number.isFinite(input.currentFreshTailTokens) &&
    freshTailTokens !== input.currentFreshTailTokens
  ) {
    patch.freshTailTokens = freshTailTokens
  }
  if (
    typeof input.currentStorageWarningThresholdBytes === "number" &&
    Number.isFinite(input.currentStorageWarningThresholdBytes) &&
    storageWarningThresholdBytes !== input.currentStorageWarningThresholdBytes
  ) {
    patch.storageWarningThresholdBytes = storageWarningThresholdBytes
  }

  return patch.freshTailTokens === undefined && patch.storageWarningThresholdBytes === undefined
    ? { kind: "idle" }
    : { kind: "patch", patch }
}

export function createLcmMemoryNumericSettingsAutosave(input: {
  save: (patch: LcmNumericSettingsPatch) => void
  invalid: (error: LcmSafeError) => void
  idle?: () => void
  delayMs?: number
  timers?: AutosaveTimers
}) {
  const delayMs = input.delayMs ?? LCM_MEMORY_SETTINGS_AUTOSAVE_DEBOUNCE_MS
  const timers = input.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: TimerHandle) => clearTimeout(handle),
  }
  let pending: TimerHandle | undefined

  const clear = () => {
    if (!pending) return
    timers.clearTimeout(pending)
    pending = undefined
  }

  return {
    schedule(settings: LcmNumericSettingsAutosaveInput) {
      clear()
      const action = lcmNumericSettingsAutosaveAction(settings)
      if (action.kind === "idle") {
        input.idle?.()
        return
      }
      pending = timers.setTimeout(() => {
        pending = undefined
        const next = lcmNumericSettingsAutosaveAction(settings)
        if (next.kind === "patch") input.save(next.patch)
        else if (next.kind === "invalid") input.invalid(next.error)
        else input.idle?.()
      }, delayMs)
    },
    clear,
    dispose: clear,
  }
}
