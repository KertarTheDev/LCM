// kilocode_change - new file
import { PGlite } from "@electric-sql/pglite"
import path from "node:path"
import { RUNTIME_DEFAULTS } from "./config"
import {
  canonicalizeLcmPath,
  ensureLcmRoot,
  ensureLcmStorageDirectories,
  normalizeRegistryPath,
  resolveLcmDbLayout,
  type LcmDbLayout,
} from "./db-layout"
import { acquireOwnerLock, type LcmOwnerLockHandle, type LcmOwnerLockOptions } from "./owner-lock"
import {
  coerceDbRequestError,
  createDbCorruptError,
  createDbRequestCanceledError,
  createDbRequestTimeoutError,
  createDbUnavailableError,
  isLcmSafeError,
  safeErrorForDbStatus,
} from "./db-errors"
import { runLcmMigrations } from "./migrations"
import { createLcmPGlite } from "./pglite-assets"
import type { LcmFamilyTarget } from "./family"
import type { LcmDbInitializeInput, LcmDbQueueStatus, LcmDbRequest, LcmDbStatus, LcmSafeError } from "./types"

const LCM_DB_CLOSE_ACTIVE_DRAIN_TIMEOUT_MS = 5_000
const LCM_DB_BACKGROUND_FAIRNESS_FOREGROUND_BURST = 8

export const LCM_DB_REQUEST_TIMEOUTS_BY_PURPOSE = {
  sync: RUNTIME_DEFAULTS.db.syncRequestTimeoutMs,
  token_budget: RUNTIME_DEFAULTS.db.tokenBudgetRequestTimeoutMs,
  assembly: RUNTIME_DEFAULTS.db.assemblyRequestTimeoutMs,
  maintenance: RUNTIME_DEFAULTS.db.maintenanceRequestTimeoutMs,
  retrieval: RUNTIME_DEFAULTS.db.retrievalRequestTimeoutMs,
  large_file: RUNTIME_DEFAULTS.db.largeFileRequestTimeoutMs,
  map: RUNTIME_DEFAULTS.db.mapRequestTimeoutMs,
} satisfies Partial<Record<LcmDbRequest["purpose"], number>>

interface QueueItem<T> {
  readonly request: LcmDbRequest<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: LcmSafeError) => void
  settled: boolean
  started: boolean
  timeout?: ReturnType<typeof setTimeout>
  abortController?: AbortController
  abortListener?: () => void
}

interface ForegroundPriorityQueueOptions {
  readonly maxForegroundQueued: number
  readonly maxBackgroundQueued: number
  readonly defaultRequestTimeoutMs: number
  readonly requestTimeoutMsByPurpose: Partial<Record<LcmDbRequest["purpose"], number>>
}

function sanitizePositiveInt(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback
}

function sanitizeNonNegativeInt(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? Math.floor(value) : fallback
}

class ForegroundPriorityQueue {
  private foreground: QueueItem<unknown>[] = []
  private background: QueueItem<unknown>[] = []
  private running = false
  private closed = false
  private active?: Promise<void>
  private activeItem?: QueueItem<unknown>
  private foregroundBurst = 0
  private rejected = 0
  private canceled = 0
  private timedOut = 0

  constructor(
    private readonly options: ForegroundPriorityQueueOptions,
    private readonly runItem: <T>(request: LcmDbRequest<T>, abortSignal: AbortSignal) => Promise<T>,
  ) {}

  status(): LcmDbQueueStatus {
    return {
      foregroundQueued: this.foreground.length,
      backgroundQueued: this.background.length,
      foregroundLimit: this.options.maxForegroundQueued,
      backgroundLimit: this.options.maxBackgroundQueued,
      active: this.running,
      ...(this.activeItem
        ? {
            activeLane: this.activeItem.request.lane,
            activePurpose: this.activeItem.request.purpose,
          }
        : {}),
      rejected: this.rejected,
      canceled: this.canceled,
      timedOut: this.timedOut,
    }
  }

  enqueue<T>(request: LcmDbRequest<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(createDbUnavailableError({ diagnosticCode: "lcm_db_queue_closed" }))
    }
    if (request.abortSignal?.aborted) {
      this.canceled++
      return Promise.reject(
        createDbRequestCanceledError({
          operationID: request.operationID,
          diagnosticCode: "lcm_db_request_canceled_before_enqueue",
        }),
      )
    }
    const queue = request.lane === "foreground" ? this.foreground : this.background
    const limit = request.lane === "foreground" ? this.options.maxForegroundQueued : this.options.maxBackgroundQueued
    if (queue.length >= limit) {
      this.rejected++
      return Promise.reject(
        createDbUnavailableError({
          operationID: request.operationID,
          diagnosticCode:
            request.lane === "foreground" ? "lcm_db_foreground_queue_full" : "lcm_db_background_queue_full",
          retryable: true,
        }),
      )
    }
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        request,
        resolve,
        reject,
        settled: false,
        started: false,
      }
      const abortListener = () =>
        this.cancelItem(
          item as QueueItem<unknown>,
          createDbRequestCanceledError({
            operationID: request.operationID,
            diagnosticCode: item.started ? "lcm_db_request_canceled_active" : "lcm_db_request_canceled_queued",
          }),
          "canceled",
        )
      request.abortSignal?.addEventListener("abort", abortListener, { once: true })
      item.abortListener = abortListener
      const timeoutMs = this.timeoutMsFor(request)
      if (timeoutMs > 0) {
        item.timeout = setTimeout(() => {
          this.cancelItem(
            item as QueueItem<unknown>,
            createDbRequestTimeoutError({
              operationID: request.operationID,
              diagnosticCode: `lcm_db_${request.purpose}_request_timeout`,
            }),
            "timedOut",
          )
        }, timeoutMs)
      }
      queue.push(item as QueueItem<unknown>)
      this.drain()
    })
  }

  closeQueued(error: LcmSafeError) {
    this.closed = true
    if (this.activeItem) this.abortAndSettle(this.activeItem, error, "canceled")
    const queued = [...this.foreground, ...this.background]
    this.foreground = []
    this.background = []
    for (const item of queued) this.settle(item, error, "canceled")
    return this.active ?? Promise.resolve()
  }

  private timeoutMsFor(request: LcmDbRequest<unknown>) {
    return sanitizeNonNegativeInt(
      request.timeoutMs ?? this.options.requestTimeoutMsByPurpose[request.purpose],
      this.options.defaultRequestTimeoutMs,
    )
  }

  private removeQueued(item: QueueItem<unknown>) {
    const queue = item.request.lane === "foreground" ? this.foreground : this.background
    const index = queue.indexOf(item)
    if (index < 0) return false
    queue.splice(index, 1)
    return true
  }

  private cleanup(item: QueueItem<unknown>) {
    if (item.timeout) clearTimeout(item.timeout)
    if (item.abortListener) item.request.abortSignal?.removeEventListener("abort", item.abortListener)
    item.timeout = undefined
    item.abortListener = undefined
  }

  private settle(item: QueueItem<unknown>, error: LcmSafeError, reason: "canceled" | "timedOut" | "failed") {
    if (item.settled) return
    item.settled = true
    this.cleanup(item)
    if (reason === "canceled") this.canceled++
    if (reason === "timedOut") this.timedOut++
    item.reject(error)
  }

  private resolve(item: QueueItem<unknown>, value: unknown) {
    if (item.settled) return
    item.settled = true
    this.cleanup(item)
    item.resolve(value)
  }

  private abortAndSettle(item: QueueItem<unknown>, error: LcmSafeError, reason: "canceled" | "timedOut" | "failed") {
    item.abortController?.abort()
    this.settle(item, error, reason)
  }

  private cancelItem(item: QueueItem<unknown>, error: LcmSafeError, reason: "canceled" | "timedOut" | "failed") {
    if (item.started) {
      this.abortAndSettle(item, error, reason)
      return
    }
    if (!this.removeQueued(item)) return
    this.settle(item, error, reason)
  }

  private nextItem() {
    if (this.foreground.length === 0) return this.background.shift()
    if (this.background.length === 0) return this.foreground.shift()
    if (this.foregroundBurst >= LCM_DB_BACKGROUND_FAIRNESS_FOREGROUND_BURST) return this.background.shift()
    return this.foreground.shift()
  }

  private drain() {
    if (this.running || this.closed) return
    const item = this.nextItem()
    if (!item) return

    this.foregroundBurst = item.request.lane === "foreground" ? this.foregroundBurst + 1 : 0
    this.running = true
    this.activeItem = item
    item.started = true
    item.abortController = new AbortController()
    if (item.request.abortSignal?.aborted) item.abortController.abort()
    const active = this.runItem(item.request, item.abortController.signal)
      .then((value) => this.resolve(item, value))
      .catch((error) => {
        this.settle(item, coerceDbRequestError(error, { operationID: item.request.operationID }), "failed")
      })
      .finally(() => {
        if (this.active === active) this.active = undefined
        if (this.activeItem === item) this.activeItem = undefined
        item.abortController = undefined
        this.cleanup(item)
        this.running = false
        this.drain()
      })
    this.active = active
    void active
  }
}

export interface LcmDbWorkerOptions {
  readonly lock?: LcmOwnerLockOptions
  readonly closeActiveDrainTimeoutMs?: number
  readonly maxForegroundQueueDepth?: number
  readonly maxBackgroundQueueDepth?: number
  readonly defaultRequestTimeoutMs?: number
  readonly requestTimeoutMsByPurpose?: Partial<Record<LcmDbRequest["purpose"], number>>
}

interface InitializeTarget {
  readonly rootDir: string
  readonly runtimeMode: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion: number
}

function initializeTarget(input: LcmDbInitializeInput, layout: LcmDbLayout): InitializeTarget {
  return {
    rootDir: layout.rootDir,
    runtimeMode: input.runtimeMode,
    schemaVersion: input.schemaVersion,
  }
}

function sameInitializeTarget(left?: InitializeTarget, right?: InitializeTarget) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.rootDir === right.rootDir &&
    left.runtimeMode === right.runtimeMode &&
    left.schemaVersion === right.schemaVersion
  )
}

async function waitForActiveDrain(active: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs < 0) {
    await active
    return true
  }
  if (timeoutMs === 0) return false

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      active.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class LcmDbWorkerImpl {
  private status: LcmDbStatus = { status: "uninitialized", dataDir: "" }
  private db?: PGlite
  private layout?: LcmDbLayout
  private lock?: LcmOwnerLockHandle
  private queue: ForegroundPriorityQueue
  private activeTarget?: InitializeTarget
  private closeInFlight?: Promise<void>
  private initializeInFlight?: {
    readonly target: InitializeTarget
    readonly promise: Promise<LcmDbStatus>
  }

  constructor(private readonly options: LcmDbWorkerOptions = {}) {
    this.queue = this.createQueue()
  }

  private createQueue() {
    return new ForegroundPriorityQueue(
      {
        maxForegroundQueued: sanitizePositiveInt(
          this.options.maxForegroundQueueDepth,
          RUNTIME_DEFAULTS.db.maxForegroundQueueDepth,
        ),
        maxBackgroundQueued: sanitizePositiveInt(
          this.options.maxBackgroundQueueDepth,
          RUNTIME_DEFAULTS.db.maxBackgroundQueueDepth,
        ),
        defaultRequestTimeoutMs: sanitizeNonNegativeInt(
          this.options.defaultRequestTimeoutMs,
          RUNTIME_DEFAULTS.db.defaultRequestTimeoutMs,
        ),
        requestTimeoutMsByPurpose: {
          ...LCM_DB_REQUEST_TIMEOUTS_BY_PURPOSE,
          ...this.options.requestTimeoutMsByPurpose,
        },
      },
      (request, abortSignal) => this.runRequest(request, abortSignal),
    )
  }

  private statusForOwnerLockError(safeError: LcmSafeError): LcmDbStatus["status"] {
    return safeError.code === "db_locked" ? "locked" : "unavailable"
  }

  private handleOwnerLockLost(safeError: LcmSafeError) {
    if (this.status.status === "closed" || this.status.status === "uninitialized") return
    this.status = {
      status: this.statusForOwnerLockError(safeError),
      dataDir: this.layout?.rootDir ?? this.status.dataDir,
      schemaVersion: this.status.schemaVersion,
      safeError,
    }
    void this.queue.closeQueued(safeError).catch(() => undefined)
  }

  private async verifyOwnerLockForRequest(operationID: LcmDbRequest<unknown>["operationID"]) {
    const lostError = this.lock?.getLostError()
    if (lostError) {
      this.handleOwnerLockLost(lostError)
      throw lostError
    }
    try {
      await this.lock?.verifyNow()
    } catch (error) {
      const safeError = isLcmSafeError(error)
        ? error
        : createDbUnavailableError({
            operationID,
            diagnosticCode: "lcm_owner_lock_request_verify_failed",
            retryable: true,
          })
      this.handleOwnerLockLost(safeError)
      throw safeError
    }
  }

  getStatus(): LcmDbStatus {
    return {
      ...this.status,
      queue: this.queue.status(),
    }
  }

  async initialize(input: LcmDbInitializeInput): Promise<LcmDbStatus> {
    const nextLayout = resolveLcmDbLayout(input.dataDir)
    const target = initializeTarget(input, nextLayout)
    const inFlight = this.initializeInFlight
    if (inFlight) {
      if (sameInitializeTarget(inFlight.target, target)) return inFlight.promise
      await inFlight.promise.catch(() => undefined)
      return this.initialize(input)
    }

    if (this.status.status === "ready" && sameInitializeTarget(this.activeTarget, target)) return this.getStatus()
    if (this.db || this.lock) await this.close()

    const promise = this.initializeFresh(input, nextLayout, target)
    this.initializeInFlight = { target, promise }
    try {
      return await promise
    } finally {
      if (this.initializeInFlight?.promise === promise) this.initializeInFlight = undefined
    }
  }

  private async initializeFresh(
    input: LcmDbInitializeInput,
    nextLayout: LcmDbLayout,
    target: InitializeTarget,
  ): Promise<LcmDbStatus> {
    this.queue = this.createQueue()

    this.layout = nextLayout
    this.activeTarget = target
    this.status = {
      status: "starting",
      dataDir: this.layout.rootDir,
      schemaVersion: input.schemaVersion,
    }

    await ensureLcmRoot(this.layout).catch(() => undefined)
    const configuredLockOptions = this.options.lock
    const lockResult = await acquireOwnerLock({
      layout: this.layout,
      runtimeMode: input.runtimeMode,
      schemaVersion: input.schemaVersion,
      options: {
        ...configuredLockOptions,
        onLost: (safeError) => {
          configuredLockOptions?.onLost?.(safeError)
          this.handleOwnerLockLost(safeError)
        },
      },
    })
    if (!lockResult.ok) {
      this.status = {
        status: lockResult.status,
        dataDir: this.layout.rootDir,
        schemaVersion: input.schemaVersion,
        safeError: lockResult.safeError,
      }
      return this.getStatus()
    }

    this.lock = lockResult.handle
    try {
      await ensureLcmStorageDirectories(this.layout)
      this.db = await createLcmPGlite({ dataDir: this.layout.pgliteDir })
      this.status = {
        status: "migrating",
        dataDir: this.layout.rootDir,
        schemaVersion: input.schemaVersion,
      }
      await runLcmMigrations(this.db)
      await this.expireStaleProviderRequestSnapshotsOnStartup()
      await this.verifyOwnerLockForRequest(lockResult.handle.operationID)
      this.status = {
        status: "ready",
        dataDir: this.layout.rootDir,
        schemaVersion: input.schemaVersion,
        ownerID: this.lock.ownerID,
        startedAt: this.lock.startedAt,
      }
      return this.getStatus()
    } catch (error) {
      await this.db?.close().catch(() => undefined)
      this.db = undefined
      await this.lock.close().catch(() => undefined)
      this.lock = undefined
      const safeError = isLcmSafeError(error)
        ? error
        : createDbCorruptError({
            operationID: lockResult.handle.operationID,
            diagnosticCode: "lcm_db_startup_or_migration_corrupt",
          })
      this.status = {
        status:
          safeError.code === "db_locked" || safeError.code === "db_unavailable"
            ? this.statusForOwnerLockError(safeError)
            : "corrupt",
        dataDir: this.layout.rootDir,
        schemaVersion: input.schemaVersion,
        safeError,
      }
      return this.getStatus()
    }
  }

  private async hasProviderRequestSnapshotTable() {
    if (!this.db) return false
    const row = (
      await this.db.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'lcm_provider_request_snapshots'
          ) AS exists
        `,
      )
    ).rows[0]
    return row?.exists === true
  }

  private async expireStaleProviderRequestSnapshotsOnStartup() {
    if (!this.db || !(await this.hasProviderRequestSnapshotTable())) return
    const now = Date.now()
    await this.db.query(
      `
        UPDATE lcm_provider_request_snapshots
        SET status = 'expired',
            terminal_at_ms = $1
        WHERE status = 'in_flight'
          AND expires_at_ms <= $1
      `,
      [now],
    )
  }

  private async cancelInFlightProviderRequestSnapshotsOnClose() {
    if (!this.db || !(await this.hasProviderRequestSnapshotTable())) return
    const now = Date.now()
    await this.db.query(
      `
        UPDATE lcm_provider_request_snapshots
        SET status = 'canceled',
            terminal_at_ms = $1
        WHERE status = 'in_flight'
      `,
      [now],
    )
  }

  execute<T>(request: LcmDbRequest<T>): Promise<T> {
    if (this.status.status !== "ready" || !this.db) {
      return Promise.reject(safeErrorForDbStatus(this.status))
    }
    return this.queue.enqueue(request)
  }

  executeForeground<T>(request: Omit<LcmDbRequest<T>, "lane">): Promise<T> {
    return this.execute({ ...request, lane: "foreground" })
  }

  async close(): Promise<void> {
    if (this.closeInFlight) return this.closeInFlight
    const promise = this.closeFresh()
    this.closeInFlight = promise
    try {
      await promise
    } finally {
      if (this.closeInFlight === promise) this.closeInFlight = undefined
    }
  }

  private async closeFresh(): Promise<void> {
    const inFlight = this.initializeInFlight?.promise
    if (inFlight) await inFlight.catch(() => undefined)
    this.status = {
      status: "closed",
      dataDir: this.layout?.rootDir ?? this.status.dataDir,
      schemaVersion: this.status.schemaVersion,
    }
    const activeDrained = this.queue.closeQueued(createDbUnavailableError({ diagnosticCode: "lcm_db_closed" }))
    await waitForActiveDrain(
      activeDrained,
      Math.max(0, this.options.closeActiveDrainTimeoutMs ?? LCM_DB_CLOSE_ACTIVE_DRAIN_TIMEOUT_MS),
    )
    let cleanupError: LcmSafeError | undefined
    try {
      await this.cancelInFlightProviderRequestSnapshotsOnClose()
    } catch (error) {
      cleanupError = coerceDbRequestError(error)
    } finally {
      await this.db?.close().catch(() => undefined)
      this.db = undefined
      await this.lock?.close().catch(() => undefined)
      this.lock = undefined
      this.activeTarget = undefined
      this.queue = this.createQueue()
    }
    if (cleanupError) throw cleanupError
  }

  private async runRequest<T>(request: LcmDbRequest<T>, abortSignal: AbortSignal): Promise<T> {
    if (abortSignal.aborted) {
      throw createDbRequestCanceledError({
        operationID: request.operationID,
        diagnosticCode: "lcm_db_request_canceled_before_run",
      })
    }
    if (!this.db || this.status.status !== "ready") throw safeErrorForDbStatus(this.status)
    await this.verifyOwnerLockForRequest(request.operationID)
    if (abortSignal.aborted) {
      throw createDbRequestCanceledError({
        operationID: request.operationID,
        diagnosticCode: "lcm_db_request_canceled_after_lock_verify",
      })
    }
    if (!this.db || this.status.status !== "ready") throw safeErrorForDbStatus(this.status)
    return request.run(this.db, { abortSignal })
  }
}

export function createLcmDbWorker(options?: LcmDbWorkerOptions) {
  return new LcmDbWorkerImpl(options)
}

function registryKey(target: InitializeTarget) {
  return `${target.rootDir}\0${target.runtimeMode}\0${target.schemaVersion}`
}

function statusForUninitialized(target?: InitializeTarget): LcmDbStatus {
  return {
    status: "uninitialized",
    dataDir: target?.rootDir ?? "",
    schemaVersion: target?.schemaVersion,
  }
}

export class LcmDbWorkerRegistry {
  private workers = new Map<string, LcmDbWorkerImpl>()
  private selectedKey?: string

  constructor(private readonly options: LcmDbWorkerOptions = {}) {}

  private async targetFromInput(input: LcmDbInitializeInput): Promise<InitializeTarget> {
    const rootDir = await canonicalizeLcmPath(input.dataDir)
    return {
      rootDir,
      runtimeMode: input.runtimeMode,
      schemaVersion: input.schemaVersion,
    }
  }

  private targetFromFamily(target: LcmFamilyTarget): InitializeTarget {
    return {
      rootDir: normalizeRegistryPath(path.resolve(target.familyRoot)),
      runtimeMode: target.runtimeMode,
      schemaVersion: target.schemaVersion,
    }
  }

  private workerForTarget(target: InitializeTarget) {
    const key = registryKey(target)
    let worker = this.workers.get(key)
    if (!worker) {
      worker = createLcmDbWorker(this.options)
      this.workers.set(key, worker)
    }
    return { key, worker }
  }

  async initialize(input: LcmDbInitializeInput): Promise<LcmDbStatus> {
    const target = await this.targetFromInput(input)
    const { key, worker } = this.workerForTarget(target)
    const status = await worker.initialize({ ...input, dataDir: target.rootDir })
    this.selectedKey = key
    return status
  }

  async initializeFamily(target: LcmFamilyTarget): Promise<LcmDbStatus> {
    const next = this.targetFromFamily(target)
    const { key, worker } = this.workerForTarget(next)
    this.selectedKey = key
    return worker.initialize({
      dataDir: next.rootDir,
      runtimeMode: next.runtimeMode,
      schemaVersion: next.schemaVersion,
    })
  }

  getStatus(): LcmDbStatus {
    if (!this.selectedKey) return statusForUninitialized()
    return this.workers.get(this.selectedKey)?.getStatus() ?? statusForUninitialized()
  }

  getFamilyStatus(target: LcmFamilyTarget): LcmDbStatus {
    const next = this.targetFromFamily(target)
    return this.workers.get(registryKey(next))?.getStatus() ?? statusForUninitialized(next)
  }

  async execute<T>(request: LcmDbRequest<T>): Promise<T> {
    if (!this.selectedKey) throw safeErrorForDbStatus(statusForUninitialized())
    const worker = this.workers.get(this.selectedKey)
    if (!worker) throw safeErrorForDbStatus(statusForUninitialized())
    return worker.execute(request)
  }

  executeForeground<T>(request: Omit<LcmDbRequest<T>, "lane">): Promise<T> {
    return this.execute({ ...request, lane: "foreground" })
  }

  async executeForFamily<T>(target: LcmFamilyTarget, request: LcmDbRequest<T>): Promise<T> {
    const next = this.targetFromFamily(target)
    const worker = this.workers.get(registryKey(next))
    if (!worker) throw safeErrorForDbStatus(statusForUninitialized(next))
    return worker.execute(request)
  }

  executeForegroundForFamily<T>(target: LcmFamilyTarget, request: Omit<LcmDbRequest<T>, "lane">): Promise<T> {
    return this.executeForFamily(target, { ...request, lane: "foreground" })
  }

  async closeFamily(target: LcmFamilyTarget): Promise<void> {
    const next = this.targetFromFamily(target)
    const key = registryKey(next)
    const worker = this.workers.get(key)
    if (!worker) return
    await worker.close()
    this.workers.delete(key)
    if (this.selectedKey === key) this.selectedKey = undefined
  }

  async close(): Promise<void> {
    const workers = [...this.workers.values()]
    this.workers.clear()
    this.selectedKey = undefined
    await Promise.all(workers.map((worker) => worker.close().catch(() => undefined)))
  }
}

export function createLcmDbWorkerRegistry(options?: LcmDbWorkerOptions) {
  return new LcmDbWorkerRegistry(options)
}
