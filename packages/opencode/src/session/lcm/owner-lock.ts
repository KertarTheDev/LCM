// kilocode_change - new file
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDbLockedError, createDbUnavailableError } from "./db-errors"
import type { LcmDbInitializeInput, LcmSafeError, OperationID } from "./types"
import type { LcmDbLayout } from "./db-layout"
import { createLcmOwnerID, createOperationID } from "./id"

export const LCM_OWNER_LOCK_VERSION = 1
export const LCM_OWNER_LOCK_HEARTBEAT_MS = 5_000
export const LCM_OWNER_LOCK_STALE_MS = 20_000
export const LCM_OWNER_LOCK_DEAD_PID_GRACE_MS = 2_000
export const LCM_OWNER_LOCK_LIVE_PID_STALE_VETO_MS = 45_000

export interface LcmOwnerLockMetadata {
  readonly version: 1
  readonly ownerID: string
  readonly pid?: number
  readonly hostname: string
  readonly runtimeMode: LcmDbInitializeInput["runtimeMode"]
  readonly startedAt: string
  readonly heartbeatAt: string
  readonly schemaVersion: number
  readonly dataDir: string
}

export interface LcmOwnerLockOptions {
  readonly heartbeatIntervalMs?: number
  readonly staleMs?: number
  readonly deadPidGraceMs?: number
  readonly livePidStaleVetoMs?: number
  readonly now?: () => number
  readonly hostname?: string
  readonly pid?: number
  readonly createOwnerID?: () => string
  readonly createOperationID?: () => OperationID
  readonly beforeHeartbeatWrite?: (input: {
    readonly ownerID: string
    readonly current: LcmOwnerLockMetadata
    readonly next: LcmOwnerLockMetadata
  }) => Promise<void> | void
  readonly onLost?: (safeError: LcmSafeError) => void
}

export interface LcmOwnerLockHandle {
  readonly ownerID: string
  readonly operationID: OperationID
  readonly startedAt: string
  readonly metadata: LcmOwnerLockMetadata
  heartbeatNow(): Promise<void>
  verifyNow(): Promise<void>
  getLostError(): LcmSafeError | undefined
  close(): Promise<void>
}

type AcquireOwnerLockResult =
  | { readonly ok: true; readonly handle: LcmOwnerLockHandle }
  | { readonly ok: false; readonly status: "locked" | "unavailable"; readonly safeError: LcmSafeError }

interface LockRead {
  readonly raw: string
  readonly metadata: LcmOwnerLockMetadata
}

function iso(now: number) {
  return new Date(now).toISOString()
}

function safeFilenameSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_")
}

async function pathExists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

function parseLock(raw: string): LockRead | undefined {
  const parsed = JSON.parse(raw) as Partial<LcmOwnerLockMetadata>
  if (
    parsed.version !== LCM_OWNER_LOCK_VERSION ||
    typeof parsed.ownerID !== "string" ||
    typeof parsed.hostname !== "string" ||
    typeof parsed.runtimeMode !== "string" ||
    typeof parsed.startedAt !== "string" ||
    typeof parsed.heartbeatAt !== "string" ||
    typeof parsed.schemaVersion !== "number" ||
    typeof parsed.dataDir !== "string"
  ) {
    return undefined
  }
  return { raw, metadata: parsed as LcmOwnerLockMetadata }
}

async function readLock(lockPath: string): Promise<LockRead | undefined> {
  return parseLock(await fs.readFile(lockPath, "utf8"))
}

function processIsLive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code
      if (code === "ESRCH") return false
      if (code === "EPERM") return true
    }
    return true
  }
}

interface LockFreshness {
  readonly stale: boolean
  readonly diagnosticCode: string
}

function classifyLockFreshness(
  metadata: LcmOwnerLockMetadata,
  input: {
    now: number
    staleMs: number
    deadPidGraceMs: number
    livePidStaleVetoMs: number
    hostname: string
  },
): LockFreshness {
  const heartbeatMs = Date.parse(metadata.heartbeatAt)
  if (!Number.isFinite(heartbeatMs)) return { stale: false, diagnosticCode: "lcm_owner_lock_invalid_heartbeat" }

  const ageMs = Math.max(0, input.now - heartbeatMs)
  const sameHost = metadata.hostname === input.hostname
  const hasPid = metadata.pid !== undefined
  const sameHostPidLive = sameHost && hasPid ? processIsLive(metadata.pid as number) : undefined

  if (sameHostPidLive === false && ageMs >= input.deadPidGraceMs) {
    return { stale: true, diagnosticCode: "lcm_owner_lock_dead_pid_takeover" }
  }

  if (ageMs < input.staleMs) {
    return {
      stale: false,
      diagnosticCode: sameHostPidLive === false ? "lcm_owner_lock_dead_pid_grace" : "lcm_owner_lock_conflict",
    }
  }

  if (sameHostPidLive === true && ageMs < input.livePidStaleVetoMs) {
    return { stale: false, diagnosticCode: "lcm_owner_lock_live_pid_stale_veto" }
  }

  return {
    stale: true,
    diagnosticCode:
      sameHostPidLive === true ? "lcm_owner_lock_live_pid_veto_cap_takeover" : "lcm_owner_lock_stale_takeover",
  }
}

function conflictDiagnosticCode(input: { existing?: LockRead; hostname: string; pid?: number }) {
  if (
    input.existing?.metadata.hostname === input.hostname &&
    input.pid !== undefined &&
    input.existing.metadata.pid === input.pid
  ) {
    return "lcm_owner_lock_same_process_conflict"
  }
  return "lcm_owner_lock_conflict"
}

function lockedDiagnosticCode(input: {
  existing?: LockRead
  hostname: string
  pid?: number
  freshness?: LockFreshness
}) {
  const fallback = conflictDiagnosticCode(input)
  if (!input.freshness || input.freshness.diagnosticCode === "lcm_owner_lock_conflict") return fallback
  return input.freshness.diagnosticCode
}

async function writeLockExclusive(lockPath: string, metadata: LcmOwnerLockMetadata) {
  const handle = await fs.open(lockPath, "wx")
  try {
    await handle.writeFile(JSON.stringify(metadata, null, 2) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeLockReplace(lockPath: string, metadata: LcmOwnerLockMetadata) {
  const tmpPath = path.join(
    path.dirname(lockPath),
    `.owner.lock.${safeFilenameSegment(metadata.ownerID)}.${Date.now()}.tmp`,
  )
  const handle = await fs.open(tmpPath, "wx")
  try {
    await handle.writeFile(JSON.stringify(metadata, null, 2) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmpPath, lockPath)
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function refreshLockInPlaceIfOwner(
  lockPath: string,
  ownerID: string,
  next: LcmOwnerLockMetadata,
  beforeWrite?: LcmOwnerLockOptions["beforeHeartbeatWrite"],
) {
  const handle = await fs.open(lockPath, "r+")
  try {
    const current = parseLock(await handle.readFile("utf8"))
    if (current?.metadata.ownerID !== ownerID) return false
    await beforeWrite?.({ ownerID, current: current.metadata, next })
    const serialized = JSON.stringify(next, null, 2) + "\n"
    const bytes = Buffer.from(serialized, "utf8")
    await handle.write(bytes, 0, bytes.length, 0)
    await handle.truncate(bytes.length)
    await handle.sync()
    return true
  } finally {
    await handle.close()
  }
}

async function tryCreateLock(lockPath: string, metadata: LcmOwnerLockMetadata) {
  try {
    await writeLockExclusive(lockPath, metadata)
    return "created" as const
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EEXIST"
    ) {
      return "exists" as const
    }
    throw error
  }
}

function lockMetadata(input: {
  ownerID: string
  runtimeMode: LcmDbInitializeInput["runtimeMode"]
  schemaVersion: number
  dataDir: string
  hostname: string
  pid?: number
  now: number
}): LcmOwnerLockMetadata {
  const timestamp = iso(input.now)
  return {
    version: LCM_OWNER_LOCK_VERSION,
    ownerID: input.ownerID,
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    hostname: input.hostname,
    runtimeMode: input.runtimeMode,
    startedAt: timestamp,
    heartbeatAt: timestamp,
    schemaVersion: input.schemaVersion,
    dataDir: input.dataDir,
  }
}

async function verifyOwner(lockPath: string, ownerID: string) {
  const current = await readLock(lockPath).catch(() => undefined)
  return current?.metadata.ownerID === ownerID
}

export async function acquireOwnerLock(input: {
  layout: LcmDbLayout
  runtimeMode: LcmDbInitializeInput["runtimeMode"]
  schemaVersion: number
  options?: LcmOwnerLockOptions
}): Promise<AcquireOwnerLockResult> {
  const now = input.options?.now ?? Date.now
  const hostname = input.options?.hostname ?? os.hostname()
  const pid = input.options?.pid ?? process.pid
  const ownerID = input.options?.createOwnerID?.() ?? createLcmOwnerID()
  const operationID = input.options?.createOperationID?.() ?? createOperationID()
  const staleMs = input.options?.staleMs ?? LCM_OWNER_LOCK_STALE_MS
  const deadPidGraceMs = input.options?.deadPidGraceMs ?? LCM_OWNER_LOCK_DEAD_PID_GRACE_MS
  const livePidStaleVetoMs = input.options?.livePidStaleVetoMs ?? LCM_OWNER_LOCK_LIVE_PID_STALE_VETO_MS
  const heartbeatIntervalMs = input.options?.heartbeatIntervalMs ?? LCM_OWNER_LOCK_HEARTBEAT_MS
  const metadata = lockMetadata({
    ownerID,
    runtimeMode: input.runtimeMode,
    schemaVersion: input.schemaVersion,
    dataDir: input.layout.rootDir,
    hostname,
    pid,
    now: now(),
  })

  let created = false
  try {
    created = (await tryCreateLock(input.layout.ownerLockPath, metadata)) === "created"
  } catch {
    return {
      ok: false,
      status: "unavailable",
      safeError: createDbUnavailableError({ operationID, diagnosticCode: "lcm_owner_lock_create_failed" }),
    }
  }

  if (!created) {
    const existing = await readLock(input.layout.ownerLockPath).catch(() => undefined)
    const freshness = existing
      ? classifyLockFreshness(existing.metadata, {
          now: now(),
          staleMs,
          deadPidGraceMs,
          livePidStaleVetoMs,
          hostname,
        })
      : undefined
    if (!existing || !freshness?.stale) {
      return {
        ok: false,
        status: "locked",
        safeError: createDbLockedError({
          operationID,
          diagnosticCode: lockedDiagnosticCode({ existing, hostname, pid, freshness }),
        }),
      }
    }

    const reread = await readLock(input.layout.ownerLockPath).catch(() => undefined)
    if (!reread || reread.raw !== existing.raw) {
      return {
        ok: false,
        status: "locked",
        safeError: createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_race" }),
      }
    }

    const quarantinePath = `${input.layout.ownerLockPath}.quarantine.${safeFilenameSegment(
      existing.metadata.ownerID,
    )}.${safeFilenameSegment(operationID)}`
    try {
      if (await pathExists(quarantinePath)) {
        return {
          ok: false,
          status: "locked",
          safeError: createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_quarantine_exists" }),
        }
      }
      await fs.rename(input.layout.ownerLockPath, quarantinePath)
      const takeover = await tryCreateLock(input.layout.ownerLockPath, metadata)
      if (takeover !== "created") {
        return {
          ok: false,
          status: "locked",
          safeError: createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_takeover_lost" }),
        }
      }
    } catch {
      return {
        ok: false,
        status: "locked",
        safeError: createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_takeover_failed" }),
      }
    }
  }

  if (!(await verifyOwner(input.layout.ownerLockPath, ownerID))) {
    return {
      ok: false,
      status: "locked",
      safeError: createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_verify_failed" }),
    }
  }

  let closed = false
  let currentMetadata = metadata
  let lostError: LcmSafeError | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let heartbeatInFlight = Promise.resolve()
  const markLost = (safeError: LcmSafeError) => {
    if (!lostError) {
      lostError = safeError
      if (interval) clearInterval(interval)
      input.options?.onLost?.(safeError)
    }
    return lostError
  }
  const ownerLost = () => markLost(createDbLockedError({ operationID, diagnosticCode: "lcm_owner_lock_lost" }))
  const ownerVerifyUnavailable = () =>
    markLost(
      createDbUnavailableError({
        operationID,
        diagnosticCode: "lcm_owner_lock_verify_unavailable",
        retryable: true,
      }),
    )
  const verifyNow = async () => {
    if (lostError) throw lostError
    if (closed) return
    let owns: boolean | undefined
    try {
      owns = await verifyOwner(input.layout.ownerLockPath, ownerID)
    } catch {
      throw ownerVerifyUnavailable()
    }
    if (!owns) throw ownerLost()
  }
  const heartbeat = async () => {
    if (lostError) throw lostError
    if (closed) return
    const nextMetadata = {
      ...currentMetadata,
      heartbeatAt: iso(now()),
    }
    let refreshed: boolean
    try {
      refreshed = await refreshLockInPlaceIfOwner(
        input.layout.ownerLockPath,
        ownerID,
        nextMetadata,
        input.options?.beforeHeartbeatWrite,
      )
    } catch {
      throw ownerVerifyUnavailable()
    }
    if (!refreshed) throw ownerLost()
    await verifyNow()
    if (!closed && refreshed) currentMetadata = nextMetadata
  }
  const runHeartbeat = () => {
    heartbeatInFlight = heartbeatInFlight.then(heartbeat, heartbeat)
    return heartbeatInFlight
  }
  interval = setInterval(() => void runHeartbeat().catch(() => undefined), heartbeatIntervalMs)
  interval.unref?.()

  return {
    ok: true,
    handle: {
      ownerID,
      operationID,
      startedAt: metadata.startedAt,
      metadata,
      heartbeatNow: runHeartbeat,
      verifyNow,
      getLostError: () => lostError,
      close: async () => {
        closed = true
        if (interval) clearInterval(interval)
        await heartbeatInFlight.catch(() => undefined)
        const current = await readLock(input.layout.ownerLockPath).catch(() => undefined)
        if (current?.metadata.ownerID === ownerID) {
          await fs.rm(input.layout.ownerLockPath, { force: true })
        }
      },
    },
  }
}
