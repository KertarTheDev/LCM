interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
  matchCount: number
  rangesComplete: boolean
}

export const REGEX_SEARCH_LIMITS = {
  patternCharacters: 512,
  recordCharacters: 1_000_000,
  scopeCharacters: 8_000_000,
  timeoutMs: 2_000,
} as const

export function regexSearchIssue(input: { pattern: string; values: Array<{ text: string }> }) {
  if (input.pattern.length > REGEX_SEARCH_LIMITS.patternCharacters) return "pattern_too_long" as const
  if (input.values.some((value) => value.text.length > REGEX_SEARCH_LIMITS.recordCharacters))
    return "record_too_large" as const
  if (input.values.reduce((total, value) => total + value.text.length, 0) > REGEX_SEARCH_LIMITS.scopeCharacters)
    return "scope_too_large" as const
}

export async function regexSearch(input: {
  pattern: string
  caseSensitive: boolean
  values: Array<{ id: string; text: string }>
  recordLimit: number
  rangeOffset?: number
  rangeLimit: number
  signal?: AbortSignal
}) {
  if (input.signal?.aborted) throw new Error("lcm_cancelled")
  const issue = regexSearchIssue(input)
  if (issue) throw new Error(`lcm_regex_${issue}`)
  return new Promise<Match[]>((resolve, reject) => {
    const worker = new Worker(new URL("./regex-worker.ts", import.meta.url))
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("lcm_invalid_regex"))
    }, REGEX_SEARCH_LIMITS.timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", cancelled)
      worker.terminate()
    }
    const cancelled = () => {
      cleanup()
      reject(new Error("lcm_cancelled"))
    }
    input.signal?.addEventListener("abort", cancelled, { once: true })
    if (input.signal?.aborted) {
      cancelled()
      return
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error("lcm_invalid_regex"))
    }
    worker.onmessage = (event: MessageEvent<{ matches?: Match[]; error?: string }>) => {
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.matches ?? [])
    }
    worker.postMessage({
      pattern: input.pattern,
      flags: input.caseSensitive ? "gu" : "giu",
      values: input.values,
      recordLimit: input.recordLimit,
      rangeOffset: input.rangeOffset ?? 0,
      rangeLimit: input.rangeLimit,
    })
  })
}
