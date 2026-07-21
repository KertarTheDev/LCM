// kilocode_change - new file
import { Effect } from "effect"
import { createLcmSafeError, type LcmSafeError, type OperationID } from "./types"

export function operationTimeout(input: { diagnosticCode: string; operationID?: OperationID }): LcmSafeError {
  return createLcmSafeError({
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: {
      operationID: input.operationID,
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode: input.diagnosticCode,
  })
}

export function operationCanceled(input: { diagnosticCode: string; operationID?: OperationID }): LcmSafeError {
  return createLcmSafeError({
    code: "canceled",
    templateKey: "lcm.operation.canceled",
    safeParams: {
      operationID: input.operationID,
      retryable: false,
    },
    retryable: false,
    diagnosticCode: input.diagnosticCode,
  })
}

export function throwIfOperationCanceled(input: {
  readonly abortSignal?: AbortSignal
  readonly diagnosticCode: string
  readonly operationID?: OperationID
}) {
  if (!input.abortSignal?.aborted) return
  throw operationCanceled({ diagnosticCode: input.diagnosticCode, operationID: input.operationID })
}

export function failIfOperationCanceled(input: {
  readonly abortSignal?: AbortSignal
  readonly diagnosticCode: string
  readonly operationID?: OperationID
}) {
  return input.abortSignal?.aborted
    ? Effect.fail(operationCanceled({ diagnosticCode: input.diagnosticCode, operationID: input.operationID }))
    : Effect.void
}

export function runWithOperationCancellation<T>(input: {
  readonly abortSignal?: AbortSignal
  readonly diagnosticCode: string
  readonly operationID?: OperationID
  readonly run: () => Promise<T> | T
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    return Promise.reject(operationCanceled({ diagnosticCode: input.diagnosticCode, operationID: input.operationID }))
  }

  const runPromise = Promise.resolve().then(input.run)
  if (!input.abortSignal) return runPromise
  const signal = input.abortSignal

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(operationCanceled({ diagnosticCode: input.diagnosticCode, operationID: input.operationID })))
    }

    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }

    runPromise.then(
      (value) => {
        finish(() => resolve(value))
      },
      (error) => {
        finish(() => reject(error))
      },
    )
  })
}
