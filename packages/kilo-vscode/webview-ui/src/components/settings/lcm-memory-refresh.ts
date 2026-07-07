export const LCM_MEMORY_SETTINGS_REFRESH_DEBOUNCE_MS = 750

type TimerHandle = ReturnType<typeof setTimeout>

type RefreshTimers = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export function createLcmSettingsRefreshScheduler(
  refresh: () => void,
  input: { delayMs?: number; timers?: RefreshTimers } = {},
) {
  const delayMs = input.delayMs ?? LCM_MEMORY_SETTINGS_REFRESH_DEBOUNCE_MS
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
    requestNow() {
      clear()
      refresh()
    },
    schedule() {
      if (pending) return
      pending = timers.setTimeout(() => {
        pending = undefined
        refresh()
      }, delayMs)
    },
    dispose: clear,
  }
}
