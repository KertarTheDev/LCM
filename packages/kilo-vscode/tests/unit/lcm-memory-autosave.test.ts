import { describe, expect, it } from "bun:test"
import {
  LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE,
  createLcmMemoryNumericSettingsAutosave,
  isLcmMemoryAutosaveValidationError,
  lcmNumericSettingsAutosaveAction,
  type LcmNumericSettingsPatch,
} from "../../webview-ui/src/components/settings/lcm-memory-autosave"
import type { LcmSafeError } from "@kilocode/sdk/v2/client"

type TimerRecord = {
  callback: () => void
  cleared: boolean
  delayMs: number
}

function createFakeTimers() {
  const timers: TimerRecord[] = []
  return {
    timers,
    api: {
      setTimeout(callback: () => void, delayMs: number) {
        const record = { callback, cleared: false, delayMs }
        timers.push(record)
        return record as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout(handle: ReturnType<typeof setTimeout>) {
        const timer = handle as unknown as TimerRecord
        timer.cleared = true
      },
    },
    flush(index: number) {
      const timer = timers[index]
      if (timer && !timer.cleared) timer.callback()
    },
  }
}

describe("LCM Memory numeric settings autosave", () => {
  it("builds a patch only for a changed valid draft", () => {
    expect(
      lcmNumericSettingsAutosaveAction({
        storageThresholdDraft: "1",
        currentStorageWarningThresholdBytes: 10737418240,
      }),
    ).toEqual({ kind: "patch", patch: { storageWarningThresholdBytes: 1073741824 } })

    expect(
      lcmNumericSettingsAutosaveAction({
        storageThresholdDraft: "10",
        currentStorageWarningThresholdBytes: 10737418240,
      }),
    ).toEqual({ kind: "idle" })
  })

  it("returns content-safe validation errors without building a patch", () => {
    const invalidThreshold = lcmNumericSettingsAutosaveAction({
      storageThresholdDraft: "ten",
      currentStorageWarningThresholdBytes: 10737418240,
    })
    expect(invalidThreshold.kind).toBe("invalid")
    if (invalidThreshold.kind === "invalid") {
      expect(invalidThreshold.error.diagnosticCode).toBe(LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE)
      expect(isLcmMemoryAutosaveValidationError(invalidThreshold.error)).toBe(true)
    }
  })

  it("debounces and coalesces changed drafts before saving", () => {
    const fake = createFakeTimers()
    const patches: LcmNumericSettingsPatch[] = []
    const errors: LcmSafeError[] = []
    const autosave = createLcmMemoryNumericSettingsAutosave({
      save: (patch) => patches.push(patch),
      invalid: (error) => errors.push(error),
      delayMs: 25,
      timers: fake.api,
    })

    autosave.schedule({
      storageThresholdDraft: "9",
      currentStorageWarningThresholdBytes: 10737418240,
    })
    autosave.schedule({
      storageThresholdDraft: "8",
      currentStorageWarningThresholdBytes: 10737418240,
    })

    expect(fake.timers).toHaveLength(2)
    expect(fake.timers[0]?.cleared).toBe(true)
    fake.flush(0)
    expect(patches).toEqual([])

    fake.flush(1)
    expect(patches).toEqual([{ storageWarningThresholdBytes: 8 * 1024 ** 3 }])
    expect(errors).toEqual([])
  })

  it("delays invalid draft reporting until the debounce timer fires", () => {
    const fake = createFakeTimers()
    const patches: LcmNumericSettingsPatch[] = []
    const errors: LcmSafeError[] = []
    const autosave = createLcmMemoryNumericSettingsAutosave({
      save: (patch) => patches.push(patch),
      invalid: (error) => errors.push(error),
      delayMs: 25,
      timers: fake.api,
    })

    autosave.schedule({
      storageThresholdDraft: "",
      currentStorageWarningThresholdBytes: 10737418240,
    })

    expect(errors).toEqual([])
    fake.flush(0)
    expect(patches).toEqual([])
    expect(errors[0]?.diagnosticCode).toBe(LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE)
  })
})
