interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
  matchCount: number
  rangesComplete: boolean
}

declare global {
  const KILO_LCM_REGEX_WORKER_PATH: string
}

type WorkerResponse = { type: "ready" } | { type: "result"; matches: Match[] } | { type: "error"; error: string }

interface RegexWorker {
  onerror: ((event: ErrorEvent) => unknown) | null
  onmessage: ((event: MessageEvent<WorkerResponse>) => unknown) | null
  postMessage(value: unknown): void
  terminate(): void
}

interface RegexRuntime {
  createWorker(target: string | URL): RegexWorker
  startupTimeoutMs: number
  executionTimeoutMs: number
}

export const REGEX_SEARCH_LIMITS = {
  patternCharacters: 512,
  recordCharacters: 1_000_000,
  scopeCharacters: 8_000_000,
  startupTimeoutMs: 10_000,
  timeoutMs: 2_000,
} as const

export function regexWorkerTarget(): string | URL {
  if (typeof KILO_LCM_REGEX_WORKER_PATH !== "undefined") return KILO_LCM_REGEX_WORKER_PATH
  return new URL("./regex-worker.ts", import.meta.url)
}

export function regexSearchIssue(input: { pattern: string; values: Array<{ text: string }> }) {
  if (input.pattern.length > REGEX_SEARCH_LIMITS.patternCharacters) return "pattern_too_long" as const
  if (input.values.some((value) => value.text.length > REGEX_SEARCH_LIMITS.recordCharacters))
    return "record_too_large" as const
  if (input.values.reduce((total, value) => total + value.text.length, 0) > REGEX_SEARCH_LIMITS.scopeCharacters)
    return "scope_too_large" as const
}

export async function regexSearch(
  input: {
    pattern: string
    caseSensitive: boolean
    values: Array<{ id: string; text: string }>
    recordLimit: number
    rangeOffset?: number
    rangeLimit: number
    signal?: AbortSignal
  },
  runtime: Partial<RegexRuntime> = {},
) {
  if (input.signal?.aborted) throw new Error("lcm_cancelled")
  const issue = regexSearchIssue(input)
  if (issue) throw new Error(`lcm_regex_${issue}`)
  return new Promise<Match[]>((resolve, reject) => {
    let worker: RegexWorker
    try {
      worker = (runtime.createWorker ?? ((target) => new Worker(target)))(regexWorkerTarget())
    } catch {
      reject(new Error("lcm_regex_worker_unavailable"))
      return
    }
    let executionTimer: ReturnType<typeof setTimeout> | undefined
    const startupTimer = setTimeout(() => {
      finish(() => reject(new Error("lcm_regex_worker_unavailable")))
    }, runtime.startupTimeoutMs ?? REGEX_SEARCH_LIMITS.startupTimeoutMs)
    let settled = false
    const cleanup = () => {
      clearTimeout(startupTimer)
      if (executionTimer) clearTimeout(executionTimer)
      input.signal?.removeEventListener("abort", cancelled)
      worker.terminate()
    }
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }
    const cancelled = () => {
      finish(() => reject(new Error("lcm_cancelled")))
    }
    input.signal?.addEventListener("abort", cancelled, { once: true })
    if (input.signal?.aborted) {
      cancelled()
      return
    }
    worker.onerror = () => {
      finish(() => reject(new Error("lcm_regex_worker_unavailable")))
    }
    worker.onmessage = (event) => {
      const response = event.data
      if (response.type === "ready") {
        clearTimeout(startupTimer)
        executionTimer = setTimeout(() => {
          finish(() => reject(new Error("lcm_regex_timeout")))
        }, runtime.executionTimeoutMs ?? REGEX_SEARCH_LIMITS.timeoutMs)
        try {
          worker.postMessage({
            pattern: input.pattern,
            flags: input.caseSensitive ? "gu" : "giu",
            values: input.values,
            recordLimit: input.recordLimit,
            rangeOffset: input.rangeOffset ?? 0,
            rangeLimit: input.rangeLimit,
          })
        } catch {
          finish(() => reject(new Error("lcm_regex_worker_unavailable")))
        }
        return
      }
      if (response.type === "error") {
        finish(() => reject(new Error(response.error)))
        return
      }
      finish(() => resolve(response.matches))
    }
  })
}
