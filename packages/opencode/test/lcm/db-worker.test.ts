// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createLcmDbWorker, LCM_DB_REQUEST_TIMEOUTS_BY_PURPOSE } from "../../src/session/lcm/db-worker"
import { ensureLcmRoot, resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { acquireOwnerLock, type LcmOwnerLockMetadata } from "../../src/session/lcm/owner-lock"
import type { LcmDbRequest, OperationID } from "../../src/session/lcm/types"

const schemaVersion = 2

function operationID(suffix: string): OperationID {
  return `op_${suffix}` as OperationID
}

function request<T>(
  input: Omit<LcmDbRequest<T>, "operationID" | "purpose"> & {
    operationID?: OperationID
    purpose?: LcmDbRequest<T>["purpose"]
  },
): LcmDbRequest<T> {
  return {
    operationID: input.operationID ?? operationID("test"),
    purpose: input.purpose ?? "smoke",
    lane: input.lane,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    run: input.run,
  }
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

async function readJson<T>(target: string): Promise<T> {
  return JSON.parse(await fs.readFile(target, "utf8")) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function initInput(dataDir: string) {
  return {
    dataDir,
    runtimeMode: "source" as const,
    schemaVersion,
    smokeMode: true,
  }
}

function findDeadPid() {
  for (let pid = process.pid + 1_000; pid < process.pid + 20_000; pid++) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ESRCH"
      ) {
        return pid
      }
    }
  }
  throw new Error("could not find an unused PID for owner-lock recovery test")
}

test("worker config has bounded prompt-critical request timeouts", () => {
  expect(Object.keys(LCM_DB_REQUEST_TIMEOUTS_BY_PURPOSE).sort()).toEqual([
    "assembly",
    "large_file",
    "maintenance",
    "map",
    "retrieval",
    "sync",
    "token_budget",
  ])
  for (const purpose of ["sync", "token_budget", "assembly", "maintenance"] as const) {
    const timeoutMs = LCM_DB_REQUEST_TIMEOUTS_BY_PURPOSE[purpose]
    expect(typeof timeoutMs).toBe("number")
    expect(timeoutMs ?? 0).toBeGreaterThan(0)
  }
})

test("source PGlite worker smoke creates, commits, rolls back, closes, and reopens", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const worker = createLcmDbWorker()

  const status = await worker.initialize(initInput(dataDir))
  expect(status).toMatchObject({
    status: "ready",
    dataDir: layout.rootDir,
    schemaVersion,
  })
  expect(status.ownerID?.startsWith("owner_")).toBe(true)
  expect(await exists(layout.pgliteDir)).toBe(true)
  expect(await exists(layout.artifactsDir)).toBe(true)
  expect(await exists(layout.ownerLockPath)).toBe(true)

  await worker.executeForeground(
    request({
      lane: "foreground",
      run: async (db) => {
        await (db as PGlite).query(
          `
            insert into lcm_usage_records (
              usage_record_id,
              source_session_id,
              purpose,
              mode,
              cost_status,
              created_at_ms
            )
            values ($1, $2, 'leaf_summary', 'background', 'not_applicable', $3)
          `,
          ["usage_committed", "session_committed", Date.now()],
        )
      },
    }),
  )

  await expect(
    worker.executeForeground(
      request({
        lane: "foreground",
        run: async (db) => {
          await (db as PGlite).transaction(async (tx) => {
            await tx.query(
              `
                insert into lcm_usage_records (
                  usage_record_id,
                  source_session_id,
                  purpose,
                  mode,
                  cost_status,
                  created_at_ms
                )
                values ($1, $2, 'leaf_summary', 'background', 'not_applicable', $3)
              `,
              ["usage_rolled_back", "session_rolled_back", Date.now()],
            )
            throw new Error("rollback sentinel raw content")
          })
        },
      }),
    ),
  ).rejects.toMatchObject({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
  })

  await worker.close()
  expect(await exists(layout.ownerLockPath)).toBe(false)

  const reopened = createLcmDbWorker()
  const reopenStatus = await reopened.initialize(initInput(dataDir))
  expect(reopenStatus.status).toBe("ready")

  const rows = await reopened.executeForeground(
    request({
      lane: "foreground",
      run: async (db) => {
        return (
          await (db as PGlite).query<{ usage_record_id: string; purpose: string }>(
            "select usage_record_id, purpose from lcm_usage_records order by usage_record_id",
          )
        ).rows
      },
    }),
  )
  expect(rows).toEqual([{ usage_record_id: "usage_committed", purpose: "leaf_summary" }])

  await reopened.close()
})

test("source PGlite worker loads pg_trgm through embedded LCM assets", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker()
  expect((await worker.initialize(initInput(path.join(tmp.path, "lcm")))).status).toBe("ready")

  const result = await worker.executeForeground(
    request({
      lane: "foreground",
      run: async (db) => {
        await (db as PGlite).exec("create extension if not exists pg_trgm;")
        const rows = (
          await (db as PGlite).query<{ extname: string }>("select extname from pg_extension where extname = 'pg_trgm'")
        ).rows
        return rows[0]?.extname
      },
    }),
  )

  expect(result).toBe("pg_trgm")
  await worker.close()
})

test("concurrent same-worker initialization is single-flight and keeps one owner", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = createLcmDbWorker()

  const [first, second] = await Promise.all([
    worker.initialize(initInput(dataDir)),
    worker.initialize(initInput(dataDir)),
  ])

  expect(first.status).toBe("ready")
  expect(second.status).toBe("ready")
  expect(second.ownerID).toBe(first.ownerID)
  expect(second.startedAt).toBe(first.startedAt)

  await worker.close()
})

test("owner-lock-atomic-v1 heartbeat refresh and shutdown cleanup keep lock metadata content-safe", async () => {
  await using tmp = await tmpdir()
  const layout = resolveLcmDbLayout(path.join(tmp.path, "lcm"))
  await ensureLcmRoot(layout)
  let now = Date.parse("2026-04-29T00:00:00.000Z")

  const result = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      heartbeatIntervalMs: 60_000,
      staleMs: 120_000,
      createOwnerID: () => "owner_heartbeat",
      createOperationID: () => operationID("heartbeat"),
    },
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return

  const initial = await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)
  expect(initial).toMatchObject({
    version: 1,
    ownerID: "owner_heartbeat",
    runtimeMode: "source",
    schemaVersion,
    dataDir: layout.rootDir,
  })
  expect(JSON.stringify(initial)).not.toContain("RAW_MESSAGE_SENTINEL")
  expect(JSON.stringify(initial)).not.toContain("TOOL_OUTPUT_SENTINEL")

  now += 45_000
  await result.handle.heartbeatNow()
  const refreshed = await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)
  expect(Date.parse(refreshed.heartbeatAt)).toBe(now)

  await result.handle.close()
  expect(await exists(layout.ownerLockPath)).toBe(false)
})

test("owner-lock heartbeat cannot overwrite a newer stale-takeover owner", async () => {
  await using tmp = await tmpdir()
  const layout = resolveLcmDbLayout(path.join(tmp.path, "lcm"))
  await ensureLcmRoot(layout)
  let now = Date.parse("2026-04-29T00:00:00.000Z")
  const deadPid = findDeadPid()
  let releaseHeartbeat!: () => void
  let heartbeatValidated!: () => void
  const heartbeatGate = new Promise<void>((resolve) => {
    releaseHeartbeat = resolve
  })
  const heartbeatValidatedPromise = new Promise<void>((resolve) => {
    heartbeatValidated = resolve
  })

  const first = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      pid: deadPid,
      heartbeatIntervalMs: 60_000,
      staleMs: 1_000,
      deadPidGraceMs: 0,
      createOwnerID: () => "owner_delayed_heartbeat",
      createOperationID: () => operationID("delayed_heartbeat"),
      beforeHeartbeatWrite: async () => {
        heartbeatValidated()
        await heartbeatGate
      },
    },
  })
  expect(first.ok).toBe(true)
  if (!first.ok) return

  now += 5_000
  const heartbeat = first.handle.heartbeatNow()
  await heartbeatValidatedPromise

  const second = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      heartbeatIntervalMs: 60_000,
      staleMs: 1_000,
      deadPidGraceMs: 0,
      createOwnerID: () => "owner_stale_takeover_winner",
      createOperationID: () => operationID("stale_takeover_winner"),
    },
  })
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_stale_takeover_winner")

  releaseHeartbeat()
  await expect(heartbeat).rejects.toMatchObject({
    code: "db_locked",
    diagnosticCode: "lcm_owner_lock_lost",
  })
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_stale_takeover_winner")

  await first.handle.close()
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_stale_takeover_winner")
  await second.handle.close()
  expect(await exists(layout.ownerLockPath)).toBe(false)
})

test("worker fails closed when owner lock is lost before a DB request", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const worker = createLcmDbWorker({
    lock: {
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_worker_lost",
      createOperationID: () => operationID("worker_lost"),
    },
  })

  expect((await worker.initialize(initInput(dataDir))).status).toBe("ready")
  const current = await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)
  await fs.writeFile(
    layout.ownerLockPath,
    JSON.stringify(
      {
        ...current,
        ownerID: "owner_external_replacement",
        heartbeatAt: new Date(Date.parse(current.heartbeatAt) + 1_000).toISOString(),
      },
      null,
      2,
    ) + "\n",
  )

  await expect(
    worker.executeForeground(
      request({
        lane: "foreground",
        run: async () => "should not run",
      }),
    ),
  ).rejects.toMatchObject({
    code: "db_locked",
    diagnosticCode: "lcm_owner_lock_lost",
    action: "close_other_owner",
  })
  expect(worker.getStatus()).toMatchObject({
    status: "locked",
    safeError: {
      code: "db_locked",
      diagnosticCode: "lcm_owner_lock_lost",
    },
  })

  await worker.close()
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_external_replacement")
})

test("lock-conflict payload is content-safe, retryable, and fail-closed without owner proxying", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const first = createLcmDbWorker({ lock: { heartbeatIntervalMs: 60_000 } })
  const second = createLcmDbWorker({ lock: { heartbeatIntervalMs: 60_000 } })

  expect((await first.initialize(initInput(dataDir))).status).toBe("ready")
  const locked = await second.initialize(initInput(dataDir))

  expect(locked.status).toBe("locked")
  expect(locked.safeError).toMatchObject({
    code: "db_locked",
    templateKey: "lcm.db.unavailable",
    retryable: true,
    action: "close_other_owner",
    safeParams: {
      retryable: true,
      action: "close_other_owner",
    },
  })
  expect(JSON.stringify(locked)).not.toContain("RAW_MESSAGE_SENTINEL")
  expect(JSON.stringify(locked)).not.toContain("TOOL_OUTPUT_SENTINEL")

  await expect(
    second.executeForeground(
      request({
        lane: "foreground",
        run: async () => "should not run",
      }),
    ),
  ).rejects.toMatchObject({
    code: "db_locked",
    action: "close_other_owner",
  })

  await first.close()
  expect((await second.initialize(initInput(dataDir))).status).toBe("ready")
  await second.close()
})

test("same-process owner-lock conflicts include a diagnostic for duplicated DB owners", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const first = createLcmDbWorker({ lock: { heartbeatIntervalMs: 60_000 } })
  const second = createLcmDbWorker({ lock: { heartbeatIntervalMs: 60_000 } })

  expect((await first.initialize(initInput(dataDir))).status).toBe("ready")
  const locked = await second.initialize(initInput(dataDir))

  expect(locked.status).toBe("locked")
  expect(locked.safeError).toMatchObject({
    code: "db_locked",
    diagnosticCode: "lcm_owner_lock_same_process_conflict",
    action: "close_other_owner",
  })

  await first.close()
})

test("dead same-host owner lock can be recovered after the short dead-PID grace", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  await ensureLcmRoot(layout)
  const now = Date.parse("2026-04-29T12:00:00.000Z")
  const deadPid = findDeadPid()
  const existing: LcmOwnerLockMetadata = {
    version: 1,
    ownerID: "owner_dead_pid",
    pid: deadPid,
    hostname: os.hostname(),
    runtimeMode: "source",
    startedAt: new Date(now - 60_000).toISOString(),
    heartbeatAt: new Date(now - 1_999).toISOString(),
    schemaVersion,
    dataDir: layout.rootDir,
  }
  await fs.writeFile(layout.ownerLockPath, JSON.stringify(existing, null, 2) + "\n")

  const blocked = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      staleMs: 20_000,
      deadPidGraceMs: 2_000,
      livePidStaleVetoMs: 45_000,
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_too_early",
      createOperationID: () => operationID("dead_pid_too_early"),
    },
  })
  expect(blocked.ok).toBe(false)
  if (!blocked.ok) {
    expect(blocked.safeError).toMatchObject({
      code: "db_locked",
      diagnosticCode: "lcm_owner_lock_dead_pid_grace",
    })
  }

  await fs.writeFile(
    layout.ownerLockPath,
    JSON.stringify({ ...existing, heartbeatAt: new Date(now - 2_000).toISOString() }, null, 2) + "\n",
  )
  const recovered = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      staleMs: 20_000,
      deadPidGraceMs: 2_000,
      livePidStaleVetoMs: 45_000,
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_dead_pid_recovered",
      createOperationID: () => operationID("dead_pid_recovered"),
    },
  })

  expect(recovered.ok).toBe(true)
  if (!recovered.ok) return
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_dead_pid_recovered")
  expect(await exists(`${layout.ownerLockPath}.quarantine.owner_dead_pid.op_dead_pid_recovered`)).toBe(true)
  await recovered.handle.close()
})

test("live same-host stale owner lock veto is capped to avoid indefinite beta lockout", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  await ensureLcmRoot(layout)
  const now = Date.parse("2026-04-29T12:00:00.000Z")
  const existing: LcmOwnerLockMetadata = {
    version: 1,
    ownerID: "owner_live_pid",
    pid: process.pid,
    hostname: os.hostname(),
    runtimeMode: "source",
    startedAt: new Date(now - 60_000).toISOString(),
    heartbeatAt: new Date(now - 30_000).toISOString(),
    schemaVersion,
    dataDir: layout.rootDir,
  }
  await fs.writeFile(layout.ownerLockPath, JSON.stringify(existing, null, 2) + "\n")

  const vetoed = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      staleMs: 20_000,
      deadPidGraceMs: 2_000,
      livePidStaleVetoMs: 45_000,
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_live_pid_vetoed",
      createOperationID: () => operationID("live_pid_vetoed"),
    },
  })
  expect(vetoed.ok).toBe(false)
  if (!vetoed.ok) {
    expect(vetoed.safeError).toMatchObject({
      code: "db_locked",
      diagnosticCode: "lcm_owner_lock_live_pid_stale_veto",
    })
  }

  await fs.writeFile(
    layout.ownerLockPath,
    JSON.stringify({ ...existing, heartbeatAt: new Date(now - 45_000).toISOString() }, null, 2) + "\n",
  )
  const recovered = await acquireOwnerLock({
    layout,
    runtimeMode: "source",
    schemaVersion,
    options: {
      now: () => now,
      staleMs: 20_000,
      deadPidGraceMs: 2_000,
      livePidStaleVetoMs: 45_000,
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_live_pid_recovered",
      createOperationID: () => operationID("live_pid_recovered"),
    },
  })

  expect(recovered.ok).toBe(true)
  if (!recovered.ok) return
  expect((await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)).ownerID).toBe("owner_live_pid_recovered")
  expect(await exists(`${layout.ownerLockPath}.quarantine.owner_live_pid.op_live_pid_recovered`)).toBe(true)
  await recovered.handle.close()
})

test("owner-lock-platform-protocol-v1 stale takeover quarantines the observed owner before opening PGlite", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  await ensureLcmRoot(layout)
  const now = Date.parse("2026-04-29T12:00:00.000Z")
  const stale: LcmOwnerLockMetadata = {
    version: 1,
    ownerID: "owner_stale",
    pid: 987_654,
    hostname: os.hostname(),
    runtimeMode: "source",
    startedAt: new Date(now - 10_000).toISOString(),
    heartbeatAt: new Date(now - 10_000).toISOString(),
    schemaVersion,
    dataDir: layout.rootDir,
  }
  await fs.writeFile(layout.ownerLockPath, JSON.stringify(stale, null, 2) + "\n")

  const worker = createLcmDbWorker({
    lock: {
      now: () => now,
      staleMs: 1_000,
      heartbeatIntervalMs: 60_000,
      createOwnerID: () => "owner_takeover",
      createOperationID: () => operationID("takeover"),
    },
  })
  const status = await worker.initialize(initInput(dataDir))
  expect(status).toMatchObject({
    status: "ready",
    ownerID: "owner_takeover",
  })

  const current = await readJson<LcmOwnerLockMetadata>(layout.ownerLockPath)
  expect(current.ownerID).toBe("owner_takeover")
  const quarantine = `${layout.ownerLockPath}.quarantine.owner_stale.op_takeover`
  expect(await exists(quarantine)).toBe(true)
  expect((await readJson<LcmOwnerLockMetadata>(quarantine)).ownerID).toBe("owner_stale")

  await worker.close()
})

test("uncheckable owner lock conflicts remain locked until a valid stale lock can be proven", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  await ensureLcmRoot(layout)
  await fs.writeFile(layout.ownerLockPath, "{ not valid json")

  const worker = createLcmDbWorker()
  const status = await worker.initialize(initInput(dataDir))
  expect(status.status).toBe("locked")
  expect(status.safeError).toMatchObject({
    code: "db_locked",
    retryable: true,
    action: "close_other_owner",
  })
})

test("worker close drains active work before snapshot cleanup and owner-lock release", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const worker = createLcmDbWorker()
  expect((await worker.initialize(initInput(dataDir))).status).toBe("ready")

  let releaseSnapshotCleanup!: () => void
  let releaseActive!: () => void
  let activeFinished = false
  let cleanupStarted = false
  const activeStarted = new Promise<void>((resolve) => {
    const active = worker.executeForeground(
      request({
        lane: "foreground",
        run: async (db) => {
          resolve()
          await new Promise<void>((release) => {
            releaseActive = release
          })
          await (db as PGlite).query(
            `
              INSERT INTO lcm_usage_records (
                usage_record_id,
                source_session_id,
                purpose,
                mode,
                cost_status,
                created_at_ms
              )
              VALUES ('usage_close_drain', 'session_close_drain', 'leaf_summary', 'background', 'not_applicable', 1777500000000)
            `,
          )
          activeFinished = true
        },
      }),
    )
    void active.catch(() => undefined)
  })
  const snapshotCleanupStarted = new Promise<void>((resolve) => {
    ;(
      worker as unknown as {
        cancelInFlightProviderRequestSnapshotsOnClose: () => Promise<void>
      }
    ).cancelInFlightProviderRequestSnapshotsOnClose = async () => {
      cleanupStarted = true
      expect(activeFinished).toBe(true)
      resolve()
      await new Promise<void>((release) => {
        releaseSnapshotCleanup = release
      })
    }
  })

  await activeStarted
  const closePromise = worker.close()
  await Promise.resolve()
  expect(cleanupStarted).toBe(false)
  expect(await exists(layout.ownerLockPath)).toBe(true)
  releaseActive()
  await snapshotCleanupStarted
  expect(await exists(layout.ownerLockPath)).toBe(true)
  releaseSnapshotCleanup()
  await closePromise
  expect(await exists(layout.ownerLockPath)).toBe(false)
})

test("worker close bounds active queue drain so shutdown cannot hang indefinitely", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const worker = createLcmDbWorker({ closeActiveDrainTimeoutMs: 5 })
  expect((await worker.initialize(initInput(dataDir))).status).toBe("ready")

  let releaseActive!: () => void
  let activeFinished = false
  let activePromise!: Promise<unknown>
  const activeStarted = new Promise<void>((resolve) => {
    activePromise = worker.executeForeground(
      request({
        lane: "foreground",
        run: async () => {
          resolve()
          await new Promise<void>((release) => {
            releaseActive = release
          })
          activeFinished = true
        },
      }),
    )
    void activePromise.catch(() => undefined)
  })

  await activeStarted
  const closePromise = worker.close()
  const closed = await Promise.race([closePromise.then(() => true), sleep(200).then(() => false)])

  expect(closed).toBe(true)
  expect(activeFinished).toBe(false)
  expect(await exists(layout.ownerLockPath)).toBe(false)

  releaseActive()
  await activePromise.catch(() => undefined)
})

test("worker applies queue limits and reports content-safe queue metrics", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker({ maxForegroundQueueDepth: 1 })
  expect((await worker.initialize(initInput(path.join(tmp.path, "lcm")))).status).toBe("ready")

  let releaseActive!: () => void
  const activeStarted = new Promise<void>((resolve) => {
    void worker
      .executeForeground(
        request({
          lane: "foreground",
          run: async () => {
            resolve()
            await new Promise<void>((release) => {
              releaseActive = release
            })
          },
        }),
      )
      .catch(() => undefined)
  })
  await activeStarted

  let queuedRan = false
  const queued = worker.executeForeground(
    request({
      lane: "foreground",
      run: async () => {
        queuedRan = true
      },
    }),
  )
  await expect(
    worker.executeForeground(
      request({
        lane: "foreground",
        run: async () => "should not run",
      }),
    ),
  ).rejects.toMatchObject({
    code: "db_unavailable",
    diagnosticCode: "lcm_db_foreground_queue_full",
    retryable: true,
  })

  expect(worker.getStatus().queue).toMatchObject({
    foregroundQueued: 1,
    backgroundQueued: 0,
    foregroundLimit: 1,
    active: true,
    activeLane: "foreground",
    activePurpose: "smoke",
    rejected: 1,
  })

  releaseActive()
  await queued
  expect(queuedRan).toBe(true)
  await worker.close()
})

test("worker removes queued requests when their abort signal is canceled", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker()
  expect((await worker.initialize(initInput(path.join(tmp.path, "lcm")))).status).toBe("ready")

  let releaseActive!: () => void
  const activeStarted = new Promise<void>((resolve) => {
    void worker
      .executeForeground(
        request({
          lane: "foreground",
          run: async () => {
            resolve()
            await new Promise<void>((release) => {
              releaseActive = release
            })
          },
        }),
      )
      .catch(() => undefined)
  })
  await activeStarted

  const controller = new AbortController()
  let queuedRan = false
  const queued = worker.executeForeground(
    request({
      lane: "foreground",
      abortSignal: controller.signal,
      run: async () => {
        queuedRan = true
      },
    }),
  )
  controller.abort()

  await expect(queued).rejects.toMatchObject({
    code: "canceled",
    diagnosticCode: "lcm_db_request_canceled_queued",
  })
  expect(queuedRan).toBe(false)
  expect(worker.getStatus().queue).toMatchObject({
    foregroundQueued: 0,
    canceled: 1,
  })

  releaseActive()
  await worker.close()
})

test("worker times out active requests through the DB request abort control", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker({
    requestTimeoutMsByPurpose: {
      smoke: 5,
    },
  })
  expect((await worker.initialize(initInput(path.join(tmp.path, "lcm")))).status).toBe("ready")

  let observedAbort = false
  await expect(
    worker.executeForeground(
      request({
        lane: "foreground",
        run: async (_db, control) => {
          await new Promise<void>((resolve) => {
            control?.abortSignal.addEventListener(
              "abort",
              () => {
                observedAbort = true
                resolve()
              },
              { once: true },
            )
          })
          await sleep(10)
        },
      }),
    ),
  ).rejects.toMatchObject({
    code: "timeout",
    diagnosticCode: "lcm_db_smoke_request_timeout",
    retryable: true,
  })

  expect(observedAbort).toBe(true)
  expect(worker.getStatus().queue).toMatchObject({ timedOut: 1 })
  await worker.close()
})

test("startup migration corruption returns content-safe failure without raw exception or payloads", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  await fs.mkdir(layout.pgliteDir, { recursive: true })
  const corruptingDb = await PGlite.create({ dataDir: layout.pgliteDir })
  await corruptingDb.exec("create table lcm_migrations (bad text);")
  await corruptingDb.close()

  const worker = createLcmDbWorker()
  const status = await worker.initialize(initInput(dataDir))
  expect(status.status).toBe("corrupt")
  expect(status.safeError).toMatchObject({
    code: "db_migration_failed",
    templateKey: "lcm.db.unavailable",
    retryable: false,
    action: "contact_support",
    safeParams: {
      retryable: false,
      action: "contact_support",
    },
  })
  const serialized = JSON.stringify(status)
  expect(serialized).not.toContain("rollback sentinel raw content")
  expect(serialized).not.toContain("lcm_migrations")
  expect(serialized).not.toContain("bad text")
  expect(await exists(layout.ownerLockPath)).toBe(false)

  await expect(
    worker.executeForeground(
      request({
        lane: "foreground",
        run: async () => "should not run",
      }),
    ),
  ).rejects.toMatchObject({
    code: "db_migration_failed",
    action: "contact_support",
  })
})

test("foreground queue work runs before queued background smoke work", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker()
  expect((await worker.initialize(initInput(path.join(tmp.path, "lcm")))).status).toBe("ready")

  const order: string[] = []
  let releaseFirst!: () => void
  let firstStarted!: () => void
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve
  })
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const firstBackground = worker.execute(
    request({
      lane: "background",
      run: async () => {
        order.push("background-1-start")
        firstStarted()
        await firstGate
        order.push("background-1-end")
      },
    }),
  )
  await firstStartedPromise

  const secondBackground = worker.execute(
    request({
      lane: "background",
      run: async () => {
        order.push("background-2")
      },
    }),
  )
  const foreground = worker.executeForeground(
    request({
      lane: "foreground",
      run: async () => {
        order.push("foreground")
      },
    }),
  )

  releaseFirst()
  await Promise.all([firstBackground, secondBackground, foreground])
  expect(order).toEqual(["background-1-start", "background-1-end", "foreground", "background-2"])

  await worker.close()
})
