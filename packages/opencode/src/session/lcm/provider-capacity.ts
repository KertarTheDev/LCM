// kilocode_change - new file
import { createHash } from "node:crypto"
import { createLcmSafeError, type LcmSafeError, type OperationID } from "./types"

export type LcmProviderCapacityClass = "remote_or_unknown" | "local_ollama" | "local_openai_compatible"
export type LcmProviderCapacityPriority = "foreground" | "background"

export interface LcmProviderCapacityInput {
  readonly providerID: string
  readonly modelID: string
  readonly priority: LcmProviderCapacityPriority
  readonly operationID?: OperationID
  readonly abortSignal?: AbortSignal
  readonly apiID?: string
  readonly apiNpm?: string
  readonly apiURL?: string
  readonly baseURL?: string
}

export interface LcmProviderCapacityModelLike {
  readonly id: string
  readonly providerID: string
  readonly api?: {
    readonly id?: string
    readonly npm?: string
    readonly url?: string
  }
  readonly options?: Record<string, unknown>
}

export interface LcmProviderCapacityProviderLike {
  readonly options?: Record<string, unknown>
}

interface ForegroundWaiter {
  readonly start: () => boolean
}

interface CapacityState {
  active: number
  foregroundWaiters: ForegroundWaiter[]
}

export class LcmProviderCapacityDeferredError extends Error {
  readonly safeError: LcmSafeError
  readonly capacityClass: LcmProviderCapacityClass

  constructor(input: { safeError: LcmSafeError; capacityClass: LcmProviderCapacityClass }) {
    super(input.safeError.diagnosticCode ?? "lcm_provider_capacity_deferred")
    this.name = "LcmProviderCapacityDeferredError"
    this.safeError = input.safeError
    this.capacityClass = input.capacityClass
  }
}

function lower(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function stringOption(options: Record<string, unknown> | undefined, key: string) {
  const value = options?.[key]
  return typeof value === "string" ? value : undefined
}

export function lcmProviderBaseURLFromOptions(options: Record<string, unknown> | undefined) {
  return (
    stringOption(options, "baseURL") ??
    stringOption(options, "baseUrl") ??
    stringOption(options, "apiBaseURL") ??
    stringOption(options, "apiBaseUrl")
  )
}

export function lcmProviderCapacityEndpointFromURL(value: string | undefined) {
  if (!value) return ""
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true
  if (host.endsWith(".local")) return true
  if (host.startsWith("10.")) return true
  if (host.startsWith("192.168.")) return true
  const private172 = /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (private172) return true
  return false
}

function isLocalURL(value: string | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    return isLocalHostname(url.hostname)
  } catch {
    const lowered = value.toLowerCase()
    return lowered.includes("localhost") || lowered.includes("127.0.0.1") || lowered.includes("ollama")
  }
}

function isOllamaDefaultPort(value: string | undefined) {
  if (!value) return false
  try {
    return new URL(value).port === "11434"
  } catch {
    return value.includes(":11434")
  }
}

export function lcmProviderCapacityKeyHash(key: string) {
  return createHash("sha256").update(`lcm-provider-endpoint-key-v1\n${key}`).digest("hex")
}

export function lcmProviderCapacitySafeFieldsFromKey(key: string) {
  const [capacityClass] = key.split("|", 1)
  const validCapacityClass =
    capacityClass === "local_ollama" || capacityClass === "local_openai_compatible" ? capacityClass : undefined
  return {
    providerEndpointKeyHash: lcmProviderCapacityKeyHash(key),
    ...(validCapacityClass ? { capacityClass: validCapacityClass } : {}),
  } satisfies {
    providerEndpointKeyHash: string
    capacityClass?: Exclude<LcmProviderCapacityClass, "remote_or_unknown">
  }
}

function providerCapacitySafeError(input: {
  readonly operationID?: OperationID
  readonly diagnosticCode: string
  readonly localProviderCapacityKey?: string
}) {
  return createLcmSafeError({
    code: "provider_capacity_deferred",
    templateKey: "lcm.provider_capacity.deferred",
    safeParams: {
      ...(input.operationID ? { operationID: input.operationID } : {}),
      ...(input.localProviderCapacityKey ? lcmProviderCapacitySafeFieldsFromKey(input.localProviderCapacityKey) : {}),
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode: input.diagnosticCode,
  })
}

export function classifyLcmProviderCapacity(
  input: Omit<LcmProviderCapacityInput, "priority" | "operationID">,
): LcmProviderCapacityClass {
  const providerID = lower(input.providerID)
  const modelID = lower(input.modelID)
  const apiID = lower(input.apiID)
  const apiNpm = lower(input.apiNpm)
  const apiURL = lower(input.apiURL)
  const baseURL = lower(input.baseURL)
  const anyEndpoint = input.baseURL ?? input.apiURL
  const openAICompatible =
    apiNpm.includes("openai") ||
    apiID.includes("openai-compatible") ||
    providerID.includes("openai") ||
    providerID.includes("compatible")

  if (
    providerID.includes("ollama") ||
    modelID.includes("ollama") ||
    apiID.includes("ollama") ||
    apiURL.includes("ollama") ||
    baseURL.includes("ollama") ||
    isOllamaDefaultPort(anyEndpoint)
  ) {
    return "local_ollama"
  }

  if (openAICompatible && isLocalURL(anyEndpoint)) return "local_openai_compatible"
  return "remote_or_unknown"
}

export function lcmProviderCapacityLane(input: Omit<LcmProviderCapacityInput, "priority" | "operationID">) {
  const capacityClass = classifyLcmProviderCapacity(input)
  const endpoint =
    lcmProviderCapacityEndpointFromURL(input.baseURL) ||
    lcmProviderCapacityEndpointFromURL(input.apiURL) ||
    "unknown-endpoint"
  return {
    capacityClass,
    endpoint,
    key: `${capacityClass}|${endpoint}`,
  }
}

export function lcmProviderCapacityInputFromModel(input: {
  readonly model: LcmProviderCapacityModelLike
  readonly priority: LcmProviderCapacityPriority
  readonly operationID?: OperationID
  readonly providerBaseURL?: string
  readonly provider?: LcmProviderCapacityProviderLike
  readonly providerOptions?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
}): LcmProviderCapacityInput {
  const model = input.model
  return {
    providerID: model.providerID,
    modelID: model.id,
    priority: input.priority,
    ...(input.operationID ? { operationID: input.operationID } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    apiID: model.api?.id,
    apiNpm: model.api?.npm,
    apiURL: model.api?.url,
    baseURL:
      input.providerBaseURL ??
      lcmProviderBaseURLFromOptions(input.providerOptions ?? input.provider?.options) ??
      lcmProviderBaseURLFromOptions(model.options),
  }
}

export function isLcmProviderCapacityDeferredError(value: unknown): value is LcmProviderCapacityDeferredError {
  return value instanceof LcmProviderCapacityDeferredError
}

export function wrapAsyncIterableWithRelease<T, TStream extends AsyncIterable<T>>(
  iterable: TStream,
  release: () => void,
): TStream {
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    release()
  }
  const asyncIterator = async function* () {
    try {
      yield* iterable
    } finally {
      releaseOnce()
    }
  }
  return new Proxy(iterable as TStream & object, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return asyncIterator
      if (property === "cancel") {
        const cancel = Reflect.get(target, property, target)
        if (typeof cancel !== "function") return cancel
        return async (...args: unknown[]) => {
          try {
            return await cancel.apply(target, args)
          } finally {
            releaseOnce()
          }
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as TStream
}

export function createLcmProviderCapacityRegistry(input?: { readonly maxLocalConcurrent?: number }) {
  const maxLocalConcurrent = Math.max(1, input?.maxLocalConcurrent ?? 1)
  const states = new Map<string, CapacityState>()

  function stateFor(key: string) {
    let state = states.get(key)
    if (!state) {
      state = { active: 0, foregroundWaiters: [] }
      states.set(key, state)
    }
    return state
  }

  function keyFor(input: LcmProviderCapacityInput) {
    return lcmProviderCapacityLane(input).key
  }

  function wakeNext(state: CapacityState) {
    while (state.active < maxLocalConcurrent) {
      const next = state.foregroundWaiters.shift()
      if (!next) return
      if (next.start()) return
    }
  }

  function release(key: string) {
    const state = stateFor(key)
    state.active = Math.max(0, state.active - 1)
    wakeNext(state)
  }

  function releaseOnce(key: string) {
    let released = false
    return () => {
      if (released) return
      released = true
      release(key)
    }
  }

  async function acquire(input: LcmProviderCapacityInput) {
    const capacityClass = classifyLcmProviderCapacity(input)
    if (capacityClass === "remote_or_unknown") {
      return { capacityClass, release: () => {} }
    }

    const key = keyFor(input)
    const state = stateFor(key)
    if (input.priority === "background") {
      if (state.active > 0 || state.foregroundWaiters.length > 0) {
        throw new LcmProviderCapacityDeferredError({
          capacityClass,
          safeError: providerCapacitySafeError({
            operationID: input.operationID,
            diagnosticCode: "lcm_provider_capacity_background_deferred",
            localProviderCapacityKey: key,
          }),
        })
      }
      state.active++
      return { capacityClass, release: releaseOnce(key) }
    }

    if (state.active < maxLocalConcurrent) {
      state.active++
      return { capacityClass, release: releaseOnce(key) }
    }

    const signal = input.abortSignal
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError")
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let waiter: ForegroundWaiter
      const cleanup = () => signal?.removeEventListener("abort", onAbort)
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        const index = state.foregroundWaiters.indexOf(waiter)
        if (index >= 0) state.foregroundWaiters.splice(index, 1)
        reject(
          signal?.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError"),
        )
      }
      waiter = {
        start: () => {
          if (settled) {
            settled = true
            cleanup()
            return false
          }
          if (signal?.aborted) {
            settled = true
            cleanup()
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("The request was aborted.", "AbortError"),
            )
            return false
          }
          settled = true
          cleanup()
          state.active++
          resolve()
          return true
        },
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      state.foregroundWaiters.push(waiter)
      if (signal?.aborted) {
        onAbort()
        return
      }
      if (state.active < maxLocalConcurrent) {
        const index = state.foregroundWaiters.indexOf(waiter)
        if (index >= 0) state.foregroundWaiters.splice(index, 1)
        if (!waiter.start()) {
          reject(
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("The request was aborted.", "AbortError"),
          )
        }
      }
    })
    return { capacityClass, release: releaseOnce(key) }
  }

  async function run<T>(input: LcmProviderCapacityInput, fn: () => Promise<T> | T): Promise<T> {
    const lease = await acquire(input)
    try {
      return await fn()
    } finally {
      lease.release()
    }
  }

  function snapshot(input: LcmProviderCapacityInput) {
    const capacityClass = classifyLcmProviderCapacity(input)
    if (capacityClass === "remote_or_unknown") return { capacityClass, active: 0, foregroundQueued: 0 }
    const state = stateFor(keyFor(input))
    return {
      capacityClass,
      active: state.active,
      foregroundQueued: state.foregroundWaiters.length,
    }
  }

  return { acquire, run, snapshot }
}

export const defaultLcmProviderCapacityRegistry = createLcmProviderCapacityRegistry()

export function runWithLcmProviderCapacity<T>(input: LcmProviderCapacityInput, fn: () => Promise<T> | T): Promise<T> {
  return defaultLcmProviderCapacityRegistry.run(input, fn)
}
