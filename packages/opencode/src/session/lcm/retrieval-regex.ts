// kilocode_change - new file
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RUNTIME_DEFAULTS } from "./config"
import type { RetrievalRegexCandidate, RetrievalRegexMatch } from "./retrieval-regex.worker"

declare const KILO_LCM_RETRIEVAL_REGEX_WORKER_PATH: string

export interface RetrievalRegexResult {
  readonly matches: RetrievalRegexMatch[]
}

export class LcmRetrievalRegexError extends Error {
  constructor(
    readonly diagnosticCode: string,
    message = diagnosticCode,
  ) {
    super(message)
    this.name = "LcmRetrievalRegexError"
  }
}

function workerTarget(): string | URL {
  if (typeof KILO_LCM_RETRIEVAL_REGEX_WORKER_PATH !== "undefined") return KILO_LCM_RETRIEVAL_REGEX_WORKER_PATH

  const js = new URL("./retrieval-regex.worker.js", import.meta.url)
  if (existsSync(fileURLToPath(js))) return js
  return new URL("./retrieval-regex.worker.ts", import.meta.url)
}

async function terminate(worker: Worker) {
  worker.terminate()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export async function runRetrievalRegex(input: {
  readonly pattern: string
  readonly caseSensitive: boolean
  readonly candidates: RetrievalRegexCandidate[]
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}): Promise<RetrievalRegexResult> {
  const worker = new Worker(workerTarget())
  const timeoutMs = input.timeoutMs ?? RUNTIME_DEFAULTS.retrieval.regexStatementTimeoutMs

  return new Promise<RetrievalRegexResult>((resolve, reject) => {
    let settled = false
    const finish = async (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
      await terminate(worker).catch(() => undefined)
      fn()
    }
    const timer = setTimeout(() => {
      void finish(() => reject(new LcmRetrievalRegexError("lcm_retrieval_regex_timeout")))
    }, timeoutMs)
    const abort = () => {
      void finish(() => reject(new LcmRetrievalRegexError("lcm_retrieval_regex_canceled")))
    }

    if (input.signal?.aborted) {
      void abort()
      return
    }
    input.signal?.addEventListener("abort", abort, { once: true })

    worker.onmessage = (
      evt: MessageEvent<
        | { type: "completed"; matches: RetrievalRegexMatch[] }
        | { type: "error"; error?: { name?: string; message?: string } }
      >,
    ) => {
      const data = evt.data
      if (data.type === "completed") {
        void finish(() => resolve({ matches: data.matches }))
        return
      }
      const message = data.error?.message ?? "LCM retrieval regex failed"
      void finish(() => reject(new LcmRetrievalRegexError("lcm_retrieval_regex_invalid", message)))
    }
    worker.onerror = () => {
      void finish(() => reject(new LcmRetrievalRegexError("lcm_retrieval_regex_worker_error")))
    }
    worker.postMessage({
      pattern: input.pattern,
      caseSensitive: input.caseSensitive,
      candidates: input.candidates,
    })
  })
}
