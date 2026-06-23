import type { KiloClient, LcmCapabilities, LcmSafeError } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import { extractLcmSafeError, parseLcmSafeError } from "./lcm-safe-error"

type ConnectionState = "connecting" | "connected" | "disconnected" | "error"

export type LcmPrewarmInput = {
  client: KiloClient | null
  connectionState: ConnectionState
  sessionID: string
  directory: string
  workspace?: string
  reason: string
}

type LcmPrewarmTimers = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

type LcmPrewarmOptions = {
  retryDelaysMs?: readonly number[]
  readinessTimeoutMs?: number
  timers?: LcmPrewarmTimers
  logger?: Pick<Console, "warn">
}

export type LcmPrewarmReadiness =
  | {
      ok: true
    }
  | {
      ok: false
      retryable: boolean
      safeMessage: string
      safeError?: LcmSafeError
    }

const defaultRetryDelaysMs = [750, 2_000, 5_000] as const
const defaultReadinessTimeoutMs = 30_000
const defaultTimers: LcmPrewarmTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

function lcmPrewarmKey(input: Pick<LcmPrewarmInput, "sessionID" | "directory" | "workspace">): string {
  return [input.sessionID, input.directory, input.workspace ?? ""].join("\0")
}

function parseLcmPrewarmKey(key: string): { sessionID: string; directory: string; workspace?: string } {
  const [sessionID = "", directory = "", workspace = ""] = key.split("\0")
  return { sessionID, directory, ...(workspace ? { workspace } : {}) }
}

function readinessFailureMessage(error: unknown): string {
  const safeError = extractLcmSafeError(error)
  if (safeError) return safeError.safeMessage
  if (error instanceof Error || typeof error === "string") return getErrorMessage(error)
  return "Memory readiness check failed."
}

export class LcmPrewarmer {
  private readonly inFlight = new Set<string>()
  private readonly ready = new Set<string>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly attempts = new Map<string, number>()
  private readonly activeRequests = new Map<string, number>()
  private readonly inFlightRequests = new Map<string, Promise<LcmPrewarmReadiness>>()
  private readonly retryDelaysMs: readonly number[]
  private readonly readinessTimeoutMs: number
  private readonly timers: LcmPrewarmTimers
  private readonly logger: Pick<Console, "warn">
  private requestSequence = 0

  constructor(options: LcmPrewarmOptions = {}) {
    this.retryDelaysMs = options.retryDelaysMs ?? defaultRetryDelaysMs
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? defaultReadinessTimeoutMs
    this.timers = options.timers ?? defaultTimers
    this.logger = options.logger ?? console
  }

  reset(): void {
    this.inFlight.clear()
    this.ready.clear()
    this.attempts.clear()
    this.activeRequests.clear()
    this.inFlightRequests.clear()
    for (const timer of this.retryTimers.values()) {
      this.timers.clearTimeout(timer)
    }
    this.retryTimers.clear()
  }

  invalidate(input: { sessionID?: string; directory?: string; workspace?: string } = {}): void {
    for (const key of new Set([...this.inFlight, ...this.ready, ...this.retryTimers.keys(), ...this.attempts.keys()])) {
      const parsed = parseLcmPrewarmKey(key)
      if (input.sessionID && parsed.sessionID !== input.sessionID) continue
      if (input.directory && parsed.directory !== input.directory) continue
      if (input.workspace && parsed.workspace !== input.workspace) continue
      this.inFlight.delete(key)
      this.ready.delete(key)
      this.attempts.delete(key)
      this.activeRequests.delete(key)
      this.inFlightRequests.delete(key)
      const timer = this.retryTimers.get(key)
      if (timer) this.timers.clearTimeout(timer)
      this.retryTimers.delete(key)
    }
  }

  prewarm(input: LcmPrewarmInput): void {
    if (!input.client || input.connectionState !== "connected") return
    const key = lcmPrewarmKey(input)
    if (this.ready.has(key) || this.inFlight.has(key) || this.retryTimers.has(key)) return

    void this.checkReadiness(input, key, true)
  }

  async ensureReady(input: LcmPrewarmInput): Promise<LcmPrewarmReadiness> {
    if (!input.client || input.connectionState !== "connected") {
      return {
        ok: false,
        retryable: true,
        safeMessage: "Memory is waiting for the CLI backend connection.",
      }
    }
    const key = lcmPrewarmKey(input)
    if (this.ready.has(key)) return { ok: true }
    const timer = this.retryTimers.get(key)
    if (timer) this.timers.clearTimeout(timer)
    this.retryTimers.delete(key)
    return this.checkReadiness(input, key, true)
  }

  private checkReadiness(input: LcmPrewarmInput, key: string, retryFailures: boolean): Promise<LcmPrewarmReadiness> {
    const existing = this.inFlightRequests.get(key)
    if (existing) return existing
    this.inFlight.add(key)
    this.requestSequence += 1
    const requestSequence = this.requestSequence
    this.activeRequests.set(key, requestSequence)
    const request = this.withReadinessTimeout(
      input.client!.session.lcm.capabilities({
        sessionID: input.sessionID,
        directory: input.directory,
        ...(input.workspace ? { workspace: input.workspace } : {}),
      }),
    )
      .then((result) => {
        if (this.activeRequests.get(key) !== requestSequence) return this.notReady("Memory readiness changed.", true)
        if (result.error) {
          const safeError = extractLcmSafeError(result.error)
          const retryable = safeError?.retryable === true
          const retrying = retryFailures && retryable ? this.scheduleRetry(key, input) : false
          this.warnReadinessFailure(input, result.error, retrying)
          return this.notReady(safeError?.safeMessage ?? "Memory is not ready.", retryable, safeError)
        }
        if (result.data?.dbReady) {
          this.ready.add(key)
          this.attempts.delete(key)
          return { ok: true as const }
        }
        if (retryFailures && this.shouldRetryData(result.data)) {
          this.scheduleRetry(key, input)
        }
        const safeError = parseLcmSafeError(result.data?.safeError)
        return this.notReady(
          safeError?.safeMessage ?? "Memory storage is not ready.",
          safeError?.retryable === true,
          safeError,
        )
      })
      .catch((error: unknown) => {
        if (this.activeRequests.get(key) !== requestSequence) return this.notReady("Memory readiness changed.", true)
        const safeError = extractLcmSafeError(error)
        const retryable = safeError?.retryable ?? true
        const retrying = retryFailures && retryable ? this.scheduleRetry(key, input) : false
        this.warnReadinessFailure(input, error, retrying)
        return this.notReady(readinessFailureMessage(error), retryable, safeError)
      })
      .finally(() => {
        if (this.activeRequests.get(key) === requestSequence) {
          this.inFlight.delete(key)
          this.activeRequests.delete(key)
        }
        if (this.inFlightRequests.get(key) === request) this.inFlightRequests.delete(key)
      })
    this.inFlightRequests.set(key, request)
    return request
  }

  private withReadinessTimeout<T>(operation: Promise<T>): Promise<T> {
    if (!Number.isFinite(this.readinessTimeoutMs) || this.readinessTimeoutMs <= 0) return operation
    let timeout: ReturnType<typeof setTimeout> | undefined
    return new Promise<T>((resolve, reject) => {
      timeout = this.timers.setTimeout(() => {
        timeout = undefined
        reject(new Error("Memory readiness check timed out."))
      }, this.readinessTimeoutMs)
      operation.then(resolve, reject).finally(() => {
        if (timeout) this.timers.clearTimeout(timeout)
      })
    })
  }

  private warnReadinessFailure(input: LcmPrewarmInput, error: unknown, retrying: boolean): void {
    if (retrying) return
    this.logger.warn("[Kilo New] KiloProvider: LCM prewarm failed", {
      sessionID: input.sessionID,
      reason: input.reason,
      error: readinessFailureMessage(error),
      retrying,
    })
  }

  private notReady(safeMessage: string, retryable: boolean, safeError?: LcmSafeError): LcmPrewarmReadiness {
    return {
      ok: false,
      retryable,
      safeMessage,
      ...(safeError ? { safeError } : {}),
    }
  }

  private shouldRetryData(data: LcmCapabilities | undefined): boolean {
    return data?.dbReady === false && data.safeError?.retryable === true
  }

  private scheduleRetry(key: string, input: LcmPrewarmInput): boolean {
    const attempt = this.attempts.get(key) ?? 0
    const delayMs = this.retryDelaysMs[attempt]
    if (delayMs === undefined) {
      this.attempts.delete(key)
      return false
    }
    this.attempts.set(key, attempt + 1)
    const timer = this.timers.setTimeout(() => {
      this.retryTimers.delete(key)
      this.prewarm(input)
    }, delayMs)
    this.retryTimers.set(key, timer)
    return true
  }
}
