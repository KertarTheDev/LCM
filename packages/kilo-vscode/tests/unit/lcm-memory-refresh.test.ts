import { describe, expect, it } from "bun:test"
import { createLcmSettingsRefreshScheduler } from "../../webview-ui/src/components/settings/lcm-memory-refresh"

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

describe("createLcmSettingsRefreshScheduler", () => {
  it("coalesces metrics-driven refreshes until the debounce timer fires", () => {
    const fake = createFakeTimers()
    let refreshes = 0
    const scheduler = createLcmSettingsRefreshScheduler(
      () => {
        refreshes += 1
      },
      { delayMs: 25, timers: fake.api },
    )

    scheduler.schedule()
    scheduler.schedule()

    expect(refreshes).toBe(0)
    expect(fake.timers).toHaveLength(1)
    expect(fake.timers[0]?.delayMs).toBe(25)

    fake.flush(0)
    expect(refreshes).toBe(1)

    scheduler.schedule()
    expect(fake.timers).toHaveLength(2)
  })

  it("clears pending metrics refreshes when an immediate request is needed", () => {
    const fake = createFakeTimers()
    let refreshes = 0
    const scheduler = createLcmSettingsRefreshScheduler(
      () => {
        refreshes += 1
      },
      { delayMs: 25, timers: fake.api },
    )

    scheduler.schedule()
    scheduler.requestNow()
    fake.flush(0)

    expect(refreshes).toBe(1)
    expect(fake.timers[0]?.cleared).toBe(true)
  })

  it("clears pending timers on dispose", () => {
    const fake = createFakeTimers()
    let refreshes = 0
    const scheduler = createLcmSettingsRefreshScheduler(
      () => {
        refreshes += 1
      },
      { timers: fake.api },
    )

    scheduler.schedule()
    scheduler.dispose()
    fake.flush(0)

    expect(refreshes).toBe(0)
    expect(fake.timers[0]?.cleared).toBe(true)
  })
})
