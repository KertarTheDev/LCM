import { describe, expect, it } from "bun:test"
import {
  LCM_INVALID_FRESH_TAIL_DIAGNOSTIC_CODE,
  LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE,
  createLcmMemoryNumericSettingsAutosave,
  isLcmMemoryAutosaveValidationError,
  lcmNumericSettingsAutosaveAction,
  parseFreshTailTokens,
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
  it("parses positive whole-token fresh tail values only", () => {
    expect(parseFreshTailTokens("20000")).toBe(20_000)
    expect(parseFreshTailTokens(" 1 ")).toBe(1)
    expect(parseFreshTailTokens("0")).toBeUndefined()
    expect(parseFreshTailTokens("20.5")).toBeUndefined()
    expect(parseFreshTailTokens("abc")).toBeUndefined()
  })

  it("builds a combined patch only for changed valid drafts", () => {
    expect(
      lcmNumericSettingsAutosaveAction({
        freshTailDraft: "21000",
        storageThresholdDraft: "1",
        currentFreshTailTokens: 20_000,
        currentStorageWarningThresholdBytes: 10737418240,
      }),
    ).toEqual({ kind: "patch", patch: { freshTailTokens: 21_000, storageWarningThresholdBytes: 1073741824 } })

    expect(
      lcmNumericSettingsAutosaveAction({
        freshTailDraft: "20000",
        storageThresholdDraft: "10",
        currentFreshTailTokens: 20_000,
        currentStorageWarningThresholdBytes: 10737418240,
      }),
    ).toEqual({ kind: "idle" })
  })

  it("returns content-safe validation errors without building a patch", () => {
    const invalidFreshTail = lcmNumericSettingsAutosaveAction({
      freshTailDraft: "0",
      storageThresholdDraft: "10",
      currentFreshTailTokens: 20_000,
      currentStorageWarningThresholdBytes: 10737418240,
    })
    expect(invalidFreshTail.kind).toBe("invalid")
    if (invalidFreshTail.kind === "invalid") {
      expect(invalidFreshTail.error.diagnosticCode).toBe(LCM_INVALID_FRESH_TAIL_DIAGNOSTIC_CODE)
      expect(isLcmMemoryAutosaveValidationError(invalidFreshTail.error)).toBe(true)
    }

    const invalidThreshold = lcmNumericSettingsAutosaveAction({
      freshTailDraft: "20000",
      storageThresholdDraft: "ten",
      currentFreshTailTokens: 20_000,
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
      freshTailDraft: "21000",
      storageThresholdDraft: "10",
      currentFreshTailTokens: 20_000,
      currentStorageWarningThresholdBytes: 10737418240,
    })
    autosave.schedule({
      freshTailDraft: "22000",
      storageThresholdDraft: "10",
      currentFreshTailTokens: 20_000,
      currentStorageWarningThresholdBytes: 10737418240,
    })

    expect(fake.timers).toHaveLength(2)
    expect(fake.timers[0]?.cleared).toBe(true)
    fake.flush(0)
    expect(patches).toEqual([])

    fake.flush(1)
    expect(patches).toEqual([{ freshTailTokens: 22_000 }])
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
      freshTailDraft: "20000",
      storageThresholdDraft: "",
      currentFreshTailTokens: 20_000,
      currentStorageWarningThresholdBytes: 10737418240,
    })

    expect(errors).toEqual([])
    fake.flush(0)
    expect(patches).toEqual([])
    expect(errors[0]?.diagnosticCode).toBe(LCM_INVALID_STORAGE_THRESHOLD_DIAGNOSTIC_CODE)
  })
})
