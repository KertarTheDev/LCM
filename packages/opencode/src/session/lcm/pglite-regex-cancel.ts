// kilocode_change - new file
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

declare const KILO_LCM_PGLITE_REGEX_WORKER_PATH: string

export interface LcmPGliteRegexCancellationResult {
  readonly mechanism: "worker_terminate"
  readonly cancelled: boolean
  readonly workerReleased: boolean
  readonly durationMs: number
  readonly diagnosticCode?: string
}

function workerTarget(): string | URL {
  if (typeof KILO_LCM_PGLITE_REGEX_WORKER_PATH !== "undefined") return KILO_LCM_PGLITE_REGEX_WORKER_PATH

  const js = new URL("./pglite-regex.worker.js", import.meta.url)
  if (existsSync(fileURLToPath(js))) return js
  return new URL("./pglite-regex.worker.ts", import.meta.url)
}

async function terminate(worker: Worker) {
  worker.terminate()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export async function runPgliteRegexCancellationProbe(
  input: { startupTimeoutMs?: number; queryTimeoutMs?: number } = {},
): Promise<LcmPGliteRegexCancellationResult> {
  const startedAt = Date.now()
  const startupTimeoutMs = input.startupTimeoutMs ?? 15_000
  const queryTimeoutMs = input.queryTimeoutMs ?? 300
  const worker = new Worker(workerTarget())

  return new Promise<LcmPGliteRegexCancellationResult>((resolve) => {
    let settled = false
    let queryTimer: Timer | undefined
    const startupTimer = setTimeout(async () => {
      if (settled) return
      settled = true
      await terminate(worker).catch(() => undefined)
      resolve({
        mechanism: "worker_terminate",
        cancelled: false,
        workerReleased: false,
        durationMs: Date.now() - startedAt,
        diagnosticCode: "lcm_pglite_regex_worker_start_timeout",
      })
    }, startupTimeoutMs)

    const finish = async (result: Omit<LcmPGliteRegexCancellationResult, "durationMs" | "mechanism">) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      if (queryTimer) clearTimeout(queryTimer)
      await terminate(worker).catch(() => undefined)
      resolve({
        mechanism: "worker_terminate",
        durationMs: Date.now() - startedAt,
        ...result,
      })
    }

    worker.onmessage = (evt: MessageEvent<{ type: string }>) => {
      if (evt.data.type === "started") {
        clearTimeout(startupTimer)
        queryTimer = setTimeout(async () => {
          await terminate(worker).catch(() => undefined)
          await finish({
            cancelled: true,
            workerReleased: true,
          })
        }, queryTimeoutMs)
        return
      }

      if (evt.data.type === "completed") {
        void finish({
          cancelled: false,
          workerReleased: false,
          diagnosticCode: "lcm_pglite_regex_completed_before_timeout",
        })
        return
      }

      if (evt.data.type === "error") {
        void finish({
          cancelled: false,
          workerReleased: false,
          diagnosticCode: "lcm_pglite_regex_worker_error",
        })
      }
    }
    worker.onerror = () => {
      void finish({
        cancelled: false,
        workerReleased: false,
        diagnosticCode: "lcm_pglite_regex_worker_error",
      })
    }
    worker.postMessage({
      pattern: "^[0-9]+$",
    })
  })
}
