interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
}

const MAX_PATTERN_LENGTH = 512
const MAX_VALUE_LENGTH = 1_000_000
const MAX_TOTAL_LENGTH = 8_000_000

export async function regexSearch(input: {
  pattern: string
  caseSensitive: boolean
  values: Array<{ id: string; text: string }>
  limit: number
  signal?: AbortSignal
}) {
  if (input.signal?.aborted) throw new Error("lcm_cancelled")
  if (
    input.pattern.length > MAX_PATTERN_LENGTH ||
    input.values.some((value) => value.text.length > MAX_VALUE_LENGTH) ||
    input.values.reduce((total, value) => total + value.text.length, 0) > MAX_TOTAL_LENGTH
  )
    throw new Error("lcm_invalid_regex")
  return new Promise<Match[]>((resolve, reject) => {
    const worker = new Worker(new URL("./regex-worker.ts", import.meta.url))
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error("lcm_invalid_regex"))
    }, 250)
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
      limit: input.limit,
    })
  })
}
