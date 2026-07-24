// kilocode_change - new file
import { createHash } from "node:crypto"
import { createLcmSafeError, type LcmConversationCapabilityClass, type LcmSafeError, type OperationID } from "./types"

export type LcmProviderCapacityClass = "remote_or_unknown" | "local_ollama" | "local_openai_compatible"
export type LcmProviderCapacityPriority = "foreground" | "background"
export type LcmProviderCapacityAdmission = "wait" | "defer"

export interface LcmProviderCapacityInput {
  readonly providerID: string
  readonly modelID: string
  readonly sessionID?: string
  readonly priority: LcmProviderCapacityPriority
  readonly admission?: LcmProviderCapacityAdmission
  readonly operationID?: OperationID
  readonly abortSignal?: AbortSignal
  readonly apiID?: string
  readonly apiNpm?: string
  readonly apiURL?: string
  readonly baseURL?: string
  readonly onWaitStart?: () => void | Promise<void>
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

interface CapacityWaiter {
  readonly sessionID?: string
  readonly start: () => boolean
}

interface CapacityState {
  active: number
  foregroundWaiters: CapacityWaiter[]
  backgroundWaiters: CapacityWaiter[]
  lastGranted?: LcmProviderCapacityPriority
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
  input: Omit<LcmProviderCapacityInput, "priority" | "admission" | "operationID">,
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

export function lcmProviderCapacityLane(
  input: Omit<LcmProviderCapacityInput, "priority" | "admission" | "operationID">,
) {
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
  readonly sessionID?: string
  readonly priority: LcmProviderCapacityPriority
  readonly admission?: LcmProviderCapacityAdmission
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
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    priority: input.priority,
    ...(input.admission ? { admission: input.admission } : {}),
    ...(input.operationID ? { operationID: input.operationID } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    apiID: model.api?.id,
    apiNpm: model.api?.npm,
    apiURL: model.api?.url,
    baseURL:
      input.providerBaseURL ??
      lcmProviderBaseURLFromOptions(input.providerOptions) ??
      lcmProviderBaseURLFromOptions(input.provider?.options) ??
      lcmProviderBaseURLFromOptions(model.options),
  }
}

export function lcmProviderCapacityPolicyForConversation(
  capabilityClass: LcmConversationCapabilityClass,
): Pick<LcmProviderCapacityInput, "priority" | "admission"> {
  return capabilityClass === "map_child"
    ? { priority: "background", admission: "wait" }
    : { priority: "foreground", admission: "wait" }
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

export function wrapReadableStreamWithRelease<T>(stream: ReadableStream<T>, release: () => void) {
  const reader = stream.getReader()
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    reader.releaseLock()
    release()
  }
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          releaseOnce()
          controller.close()
          return
        }
        controller.enqueue(next.value)
      } catch (error) {
        releaseOnce()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        releaseOnce()
      }
    },
  })
}

export function createLcmProviderCapacityRegistry(input?: { readonly maxLocalConcurrent?: number }) {
  const maxLocalConcurrent = Math.max(1, input?.maxLocalConcurrent ?? 1)
  const states = new Map<string, CapacityState>()

  function stateFor(key: string) {
    let state = states.get(key)
    if (!state) {
      state = {
        active: 0,
        foregroundWaiters: [],
        backgroundWaiters: [],
      }
      states.set(key, state)
    }
    return state
  }

  function deleteIfIdle(key: string, state: CapacityState) {
    if (
      state.active === 0 &&
      state.foregroundWaiters.length === 0 &&
      state.backgroundWaiters.length === 0 &&
      states.get(key) === state
    ) {
      states.delete(key)
    }
  }

  function keyFor(input: LcmProviderCapacityInput) {
    return lcmProviderCapacityLane(input).key
  }

  function shiftWaiter(waiters: CapacityWaiter[]) {
    return waiters.shift()
  }

  function wakeNext(key: string, state: CapacityState) {
    while (state.active < maxLocalConcurrent) {
      const hasForeground = state.foregroundWaiters.length > 0
      const hasBackground = state.backgroundWaiters.length > 0
      const nextPriority =
        hasForeground && hasBackground
          ? state.lastGranted === "foreground"
            ? "background"
            : "foreground"
          : hasForeground
            ? "foreground"
            : hasBackground
              ? "background"
              : undefined
      const next =
        nextPriority === "foreground"
          ? shiftWaiter(state.foregroundWaiters)
          : nextPriority === "background"
            ? shiftWaiter(state.backgroundWaiters)
            : undefined
      if (!next) {
        deleteIfIdle(key, state)
        return
      }
      if (next.start()) {
        state.lastGranted = nextPriority
        return
      }
    }
  }

  function release(key: string) {
    const state = states.get(key)
    if (!state) return
    state.active = Math.max(0, state.active - 1)
    wakeNext(key, state)
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

    const signal = input.abortSignal
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError")
    }

    const key = keyFor(input)
    const state = stateFor(key)
    const admission = input.admission ?? (input.priority === "background" ? "defer" : "wait")
    if (
      state.active < maxLocalConcurrent &&
      state.foregroundWaiters.length === 0 &&
      state.backgroundWaiters.length === 0
    ) {
      state.active++
      state.lastGranted = input.priority
      return { capacityClass, release: releaseOnce(key) }
    }

    if (admission === "defer") {
      deleteIfIdle(key, state)
      throw new LcmProviderCapacityDeferredError({
        capacityClass,
        safeError: providerCapacitySafeError({
          operationID: input.operationID,
          diagnosticCode: "lcm_provider_capacity_background_deferred",
          localProviderCapacityKey: key,
        }),
      })
    }

    void Promise.resolve(input.onWaitStart?.()).catch(() => {})
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let waiter: CapacityWaiter
      const waiters = input.priority === "foreground" ? state.foregroundWaiters : state.backgroundWaiters
      const cleanup = () => signal?.removeEventListener("abort", onAbort)
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        deleteIfIdle(key, state)
        reject(
          signal?.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError"),
        )
      }
      waiter = {
        ...(input.sessionID ? { sessionID: input.sessionID } : {}),
        start: () => {
          if (settled) return false
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
      waiters.push(waiter)
      if (signal?.aborted) {
        onAbort()
        return
      }
      wakeNext(key, state)
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
    if (capacityClass === "remote_or_unknown")
      return {
        capacityClass,
        active: 0,
        foregroundQueued: 0,
        backgroundQueued: 0,
      }
    const state = states.get(keyFor(input))
    return {
      capacityClass,
      active: state?.active ?? 0,
      foregroundQueued: state?.foregroundWaiters.length ?? 0,
      backgroundQueued: state?.backgroundWaiters.length ?? 0,
    }
  }

  function stateCount() {
    return states.size
  }

  return { acquire, run, snapshot, stateCount }
}

export const defaultLcmProviderCapacityRegistry = createLcmProviderCapacityRegistry()

export function runWithLcmProviderCapacity<T>(input: LcmProviderCapacityInput, fn: () => Promise<T> | T): Promise<T> {
  return defaultLcmProviderCapacityRegistry.run(input, fn)
}

export function acquireLcmProviderCapacity(input: LcmProviderCapacityInput) {
  return defaultLcmProviderCapacityRegistry.acquire(input)
}

export async function runWithLcmProviderCapacityStream<T>(
  input: LcmProviderCapacityInput,
  doStream: () => PromiseLike<{ stream: ReadableStream<T> }>,
  registry = defaultLcmProviderCapacityRegistry,
) {
  const lease = await registry.acquire(input)
  try {
    const result = await doStream()
    return {
      ...result,
      stream: wrapReadableStreamWithRelease(result.stream, lease.release),
    }
  } catch (error) {
    lease.release()
    throw error
  }
}
