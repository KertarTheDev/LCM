interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
}

export async function regexSearch(input: {
  pattern: string
  caseSensitive: boolean
  values: Array<{ id: string; text: string }>
  limit: number
  signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
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
