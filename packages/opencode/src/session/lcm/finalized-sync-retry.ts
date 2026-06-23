// kilocode_change - new file
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Scope } from "effect"
import type { MessageID, SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { isLcmSafeError } from "./db-errors"
import { resolveLcmControlDataRoot } from "./db-layout"
import { resolveKiloDataDirForLcm } from "./family"
import { createLcmSafeError, type LcmSafeError, type LcmSyncResult } from "./types"

export type LcmFinalizedSyncReason = "post_turn" | "pre_turn_retry" | "background_retry" | "cleanup"

export interface LcmFinalizedSyncPending {
  readonly sessionID: SessionID
  readonly upToMessageID: MessageID
  readonly safeError: LcmSafeError
  readonly attempts: number
}

export interface LcmFinalizedSyncRetryController {
  sync(input: {
    sessionID: SessionID
    upToMessageID: MessageID
    reason?: LcmFinalizedSyncReason
    publishFailure?: boolean
    scheduleRetry?: boolean
  }): Effect.Effect<void>
  retryPendingBeforeTurn(sessionID: SessionID): Effect.Effect<void>
  getPending(sessionID: SessionID): LcmFinalizedSyncPending | undefined
}

export interface LcmFinalizedSyncPendingStore {
  load(sessionID: SessionID): Effect.Effect<LcmFinalizedSyncPending | undefined>
  save(pending: LcmFinalizedSyncPending): Effect.Effect<void>
  delete(sessionID: SessionID): Effect.Effect<void>
}

function pendingFilename(sessionID: SessionID) {
  const digest = createHash("sha256").update(`lcm-finalized-sync-pending-v1:${sessionID}`, "utf8").digest("base64url")
  return `${digest}.json`
}

function parsePending(value: unknown, sessionID: SessionID): LcmFinalizedSyncPending | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.sessionID !== sessionID) return undefined
  if (typeof record.upToMessageID !== "string") return undefined
  const attempts = record.attempts
  if (typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 1) return undefined
  if (!isLcmSafeError(record.safeError)) return undefined
  return {
    sessionID,
    upToMessageID: record.upToMessageID as MessageID,
    safeError: record.safeError,
    attempts,
  }
}

export function createLcmFinalizedSyncPendingStore(
  input: {
    readonly rootDir?: string
    readonly kiloDataDir?: string
  } = {},
): LcmFinalizedSyncPendingStore {
  const rootDir =
    input.rootDir ?? path.join(resolveLcmControlDataRoot(resolveKiloDataDirForLcm(input)), "finalized-sync-pending")
  const filePath = (sessionID: SessionID) => path.join(rootDir, pendingFilename(sessionID))
  return {
    load: (sessionID) =>
      Effect.tryPromise({
        try: async () => {
          const file = filePath(sessionID)
          const raw = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined
            throw error
          })
          if (raw === undefined) return undefined
          let json: unknown
          try {
            json = JSON.parse(raw)
          } catch {
            await fs.unlink(file).catch(() => undefined)
            return undefined
          }
          const parsed = parsePending(json, sessionID)
          if (!parsed) await fs.unlink(file).catch(() => undefined)
          return parsed
        },
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.succeed(undefined))),
    save: (pending) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(rootDir, { recursive: true })
          const file = filePath(pending.sessionID)
          const temp = `${file}.${process.pid}.${Date.now()}.tmp`
          await fs.writeFile(
            temp,
            JSON.stringify({
              version: 1,
              sessionID: pending.sessionID,
              upToMessageID: pending.upToMessageID,
              attempts: pending.attempts,
              safeError: pending.safeError,
            }),
            "utf8",
          )
          await fs.rename(temp, file)
        },
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.void)),
    delete: (sessionID) =>
      Effect.tryPromise({
        try: async () => {
          await fs.unlink(filePath(sessionID)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error
          })
        },
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.void)),
  }
}

export function createLcmFinalizedSyncRetryController(input: {
  syncFinalizedMessages: (request: {
    sessionID: SessionID
    upToMessageID?: MessageID
  }) => Effect.Effect<LcmSyncResult, unknown>
  publishError: (request: {
    sessionID: SessionID
    error: NonNullable<MessageV2.Assistant["error"]>
  }) => Effect.Effect<void>
  logWarn?: (message: string, fields: Record<string, unknown>) => void
  scope?: Scope.Scope
  retryDelay?: Parameters<typeof Effect.sleep>[0]
  pendingStore?: LcmFinalizedSyncPendingStore
}): LcmFinalizedSyncRetryController {
  const pending = new Map<string, LcmFinalizedSyncPending>()

  function syncSafeError(error: unknown): LcmSafeError {
    if (isLcmSafeError(error)) return error
    return createLcmSafeError({
      code: "recovery_failed",
      templateKey: "lcm.operation.timeout",
      safeParams: { retryable: true, action: "retry" },
      retryable: true,
      diagnosticCode: "lcm_prompt_finalized_sync_unknown_failure",
    })
  }

  function syncCoversPending(current: LcmFinalizedSyncPending, upToMessageID: MessageID) {
    return upToMessageID >= current.upToMessageID
  }

  const sync: LcmFinalizedSyncRetryController["sync"] = Effect.fn("LcmFinalizedSyncRetry.sync")(function* (request) {
    const reason = request.reason ?? "post_turn"
    const result = yield* input
      .syncFinalizedMessages({
        sessionID: request.sessionID,
        upToMessageID: request.upToMessageID,
      })
      .pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, safeError: syncSafeError(error) }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      )

    if (result.ok) {
      const current = pending.get(request.sessionID)
      if (current && syncCoversPending(current, request.upToMessageID)) {
        pending.delete(request.sessionID)
        if (input.pendingStore) yield* input.pendingStore.delete(request.sessionID).pipe(Effect.ignore)
      }
      return
    }

    const previous = pending.get(request.sessionID)
    const next: LcmFinalizedSyncPending = {
      sessionID: request.sessionID,
      upToMessageID: request.upToMessageID,
      safeError: result.safeError,
      attempts: (previous?.attempts ?? 0) + 1,
    }
    pending.set(request.sessionID, next)
    if (input.pendingStore) yield* input.pendingStore.save(next).pipe(Effect.ignore)
    input.logWarn?.("lcm finalized sync failed", {
      sessionID: request.sessionID,
      messageID: request.upToMessageID,
      reason,
      attempts: next.attempts,
      code: result.safeError.code,
      diagnosticCode: result.safeError.diagnosticCode,
    })

    const duplicate =
      previous?.upToMessageID === request.upToMessageID &&
      previous.safeError.code === result.safeError.code &&
      previous.safeError.diagnosticCode === result.safeError.diagnosticCode
    if (request.publishFailure !== false && !duplicate) {
      yield* input
        .publishError({
          sessionID: request.sessionID,
          error: MessageV2.fromLcmSafeError(result.safeError),
        })
        .pipe(Effect.ignore)
    }

    if (request.scheduleRetry !== false && input.scope && result.safeError.retryable) {
      yield* Effect.gen(function* () {
        yield* Effect.sleep(input.retryDelay ?? "2 seconds")
        const current = pending.get(request.sessionID)
        if (!current || current.upToMessageID !== request.upToMessageID || current.attempts !== next.attempts) return
        yield* sync({
          sessionID: request.sessionID,
          upToMessageID: request.upToMessageID,
          reason: "background_retry",
          publishFailure: false,
          scheduleRetry: false,
        })
      }).pipe(Effect.ignore, Effect.forkIn(input.scope))
    }
  })

  const retryPendingBeforeTurn: LcmFinalizedSyncRetryController["retryPendingBeforeTurn"] = Effect.fn(
    "LcmFinalizedSyncRetry.retryPendingBeforeTurn",
  )(function* (sessionID) {
    let current = pending.get(sessionID)
    if (!current && input.pendingStore) {
      current = yield* input.pendingStore.load(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (current) pending.set(sessionID, current)
    }
    if (!current) return
    yield* sync({
      sessionID,
      upToMessageID: current.upToMessageID,
      reason: "pre_turn_retry",
      publishFailure: false,
      scheduleRetry: false,
    })
  })

  return {
    sync,
    retryPendingBeforeTurn,
    getPending(sessionID) {
      return pending.get(sessionID)
    },
  }
}
