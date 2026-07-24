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

interface CapacityReservationWaiter {
  readonly sessionID: string
  readonly start: () => boolean
}

interface CapacityState {
  active: number
  foregroundWaiters: CapacityWaiter[]
  backgroundWaiters: CapacityWaiter[]
  reservationOwnerSessionID?: string
  reservationDepth: number
  reservationWaiters: CapacityReservationWaiter[]
  foregroundTurnPending: boolean
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
        reservationDepth: 0,
        reservationWaiters: [],
        foregroundTurnPending: false,
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
      !state.reservationOwnerSessionID &&
      state.reservationWaiters.length === 0 &&
      states.get(key) === state
    ) {
      states.delete(key)
    }
  }

  function keyFor(input: LcmProviderCapacityInput) {
    return lcmProviderCapacityLane(input).key
  }

  function shiftWaiter(waiters: CapacityWaiter[], sessionID?: string) {
    const index = sessionID
      ? waiters.findIndex((waiter) => waiter.sessionID === sessionID)
      : waiters.length > 0
        ? 0
        : -1
    return index >= 0 ? waiters.splice(index, 1)[0] : undefined
  }

  function wakeNext(key: string, state: CapacityState) {
    while (state.active < maxLocalConcurrent) {
      if (state.reservationOwnerSessionID) {
        const next =
          shiftWaiter(state.foregroundWaiters, state.reservationOwnerSessionID) ??
          shiftWaiter(state.backgroundWaiters, state.reservationOwnerSessionID)
        if (!next) return
        if (next.start()) return
        continue
      }

      if (state.foregroundTurnPending && state.active > 0) return
      if (state.active > 0 && state.reservationWaiters.length > 0) return

      if (state.active === 0 && state.foregroundTurnPending) {
        const foreground = shiftWaiter(state.foregroundWaiters)
        state.foregroundTurnPending = false
        if (foreground) {
          if (foreground.start()) return
          continue
        }
      }

      if (state.active === 0) {
        const reservation = state.reservationWaiters.shift()
        if (reservation) {
          if (reservation.start()) return
          continue
        }
      }

      const next = shiftWaiter(state.foregroundWaiters) ?? shiftWaiter(state.backgroundWaiters)
      if (!next) {
        deleteIfIdle(key, state)
        return
      }
      if (next.start()) return
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
    const ownWaiters = input.priority === "foreground" ? state.foregroundWaiters : state.backgroundWaiters
    const reservationOwner = state.reservationOwnerSessionID
    const reservationBlocks =
      (reservationOwner !== undefined && reservationOwner !== input.sessionID) ||
      (reservationOwner === undefined && state.reservationWaiters.length > 0)
    const handoffDrainBlocks = state.foregroundTurnPending && state.active > 0
    const ownWaiterCount = reservationOwner
      ? ownWaiters.filter((waiter) => waiter.sessionID === reservationOwner).length
      : ownWaiters.length
    const higherPriorityWaiting =
      input.priority === "background" &&
      (reservationOwner
        ? state.foregroundWaiters.some((waiter) => waiter.sessionID === reservationOwner)
        : state.foregroundWaiters.length > 0)
    if (
      state.active < maxLocalConcurrent &&
      ownWaiterCount === 0 &&
      !higherPriorityWaiting &&
      !reservationBlocks &&
      !handoffDrainBlocks
    ) {
      state.active++
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

  function releaseReservation(key: string, sessionID: string) {
    const state = states.get(key)
    if (!state || state.reservationOwnerSessionID !== sessionID) return
    if (state.reservationDepth > 1) {
      state.reservationDepth--
      return
    }
    state.reservationOwnerSessionID = undefined
    state.reservationDepth = 0
    state.foregroundTurnPending = true
    wakeNext(key, state)
  }

  function reservationLease(key: string, sessionID: string, signal?: AbortSignal) {
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal?.removeEventListener("abort", release)
      releaseReservation(key, sessionID)
    }
    signal?.addEventListener("abort", release, { once: true })
    if (signal?.aborted) release()
    return { release }
  }

  async function reserve(input: LcmProviderCapacityInput & { readonly sessionID: string }) {
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
    if (state.reservationOwnerSessionID === input.sessionID) {
      state.reservationDepth++
      return { capacityClass, ...reservationLease(key, input.sessionID, signal) }
    }
    if (!state.reservationOwnerSessionID && state.active === 0 && state.reservationWaiters.length === 0) {
      state.reservationOwnerSessionID = input.sessionID
      state.reservationDepth = 1
      return { capacityClass, ...reservationLease(key, input.sessionID, signal) }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let waiter: CapacityReservationWaiter
      const cleanup = () => signal?.removeEventListener("abort", onAbort)
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        const index = state.reservationWaiters.indexOf(waiter)
        if (index >= 0) state.reservationWaiters.splice(index, 1)
        wakeNext(key, state)
        reject(
          signal?.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError"),
        )
      }
      waiter = {
        sessionID: input.sessionID,
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
          state.reservationOwnerSessionID = input.sessionID
          state.reservationDepth = 1
          resolve()
          return true
        },
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      state.reservationWaiters.push(waiter)
      if (signal?.aborted) {
        onAbort()
        return
      }
      wakeNext(key, state)
    })
    return { capacityClass, ...reservationLease(key, input.sessionID, signal) }
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
        reservationQueued: 0,
        reserved: false,
      }
    const state = states.get(keyFor(input))
    return {
      capacityClass,
      active: state?.active ?? 0,
      foregroundQueued: state?.foregroundWaiters.length ?? 0,
      backgroundQueued: state?.backgroundWaiters.length ?? 0,
      reservationQueued: state?.reservationWaiters.length ?? 0,
      reserved: state?.reservationOwnerSessionID !== undefined,
    }
  }

  function stateCount() {
    return states.size
  }

  return { acquire, reserve, run, snapshot, stateCount }
}

export const defaultLcmProviderCapacityRegistry = createLcmProviderCapacityRegistry()

export function runWithLcmProviderCapacity<T>(input: LcmProviderCapacityInput, fn: () => Promise<T> | T): Promise<T> {
  return defaultLcmProviderCapacityRegistry.run(input, fn)
}

export function reserveLcmProviderCapacity(input: LcmProviderCapacityInput & { readonly sessionID: string }) {
  return defaultLcmProviderCapacityRegistry.reserve(input)
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
