// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Database } from "../../src/storage/db"
import { WorkspaceID } from "../../src/control-plane/schema"
import * as Instance from "../../src/kilocode/instance"
import * as SessionModule from "../../src/session/session"
import { SessionTable } from "../../src/session/session.sql"
import {
  resolveLcmControlRoot,
  resolveLcmDbLayout,
  resolveLcmFamiliesRoot,
  resolveLcmFamilyRoot,
} from "../../src/session/lcm/db-layout"
import { LCM_DB_GATE_SCHEMA_VERSION, diagnoseLcmDb, runLcmDbSmoke } from "../../src/session/lcm/db-smoke"
import { createLcmDbWorker, createLcmDbWorkerRegistry } from "../../src/session/lcm/db-worker"
import { LcmDb } from "../../src/session/lcm/db"
import { LcmContext } from "../../src/session/lcm/context"
import {
  deriveLcmFamilyID,
  LCM_FAMILY_ID_TEST_VECTOR,
  resolveDebugFamilyTarget,
  resolveDirectTestFamilyTarget,
  resolveSessionFamilyTarget,
  type LcmFamilyTarget,
} from "../../src/session/lcm/family"
import { LCM_PGLITE_GATE_TEST_SCALE } from "../../src/session/lcm/pglite-gate"
import type { ConversationID, LcmDbRequest, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.resolve(import.meta.dir, "../..")
const schemaVersion = LCM_DB_GATE_SCHEMA_VERSION

function runSession<A, E>(effect: Effect.Effect<A, E, SessionModule.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionModule.defaultLayer)))
}

const Session = {
  ...SessionModule,
  create(input?: Parameters<SessionModule.Interface["create"]>[0]) {
    return runSession(SessionModule.Service.use((session) => session.create(input)))
  },
}

function operationID(suffix: string): OperationID {
  return `op_m31_${suffix}_${Date.now().toString(36)}` as OperationID
}

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose">): LcmDbRequest<T> {
  return {
    operationID: operationID("family"),
    purpose: "smoke",
    lane: input.lane,
    run: input.run,
  }
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

async function withKiloDataDir<T>(kiloDataDir: string, fn: () => Promise<T>) {
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = kiloDataDir
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
}

async function familyTarget(input: {
  kiloDataDir: string
  rootSessionID: string
  runtimeMode?: LcmFamilyTarget["runtimeMode"]
}) {
  return resolveDirectTestFamilyTarget({
    familyRoot: resolveLcmFamilyRoot({
      kiloDataDir: input.kiloDataDir,
      familyID: deriveLcmFamilyID(input.rootSessionID),
    }),
    runtimeMode: input.runtimeMode ?? "source",
    schemaVersion,
  })
}

function updateSession(id: string, patch: Partial<typeof SessionTable.$inferSelect>) {
  Database.use((db) =>
    db
      .update(SessionTable)
      .set(patch)
      .where(eq(SessionTable.id, id as typeof SessionTable.$inferSelect.id))
      .run(),
  )
}

async function spawnJson(input: { cmd: string[]; cwd: string; kiloDataDir: string }) {
  const xdgRoot = path.join(input.kiloDataDir, "xdg")
  const proc = Bun.spawn(input.cmd, {
    cwd: input.cwd,
    env: {
      ...process.env,
      BUN_TMPDIR: process.env.BUN_TMPDIR ?? input.kiloDataDir,
      BUN_INSTALL: process.env.BUN_INSTALL,
      KILO_LCM_TEST_DATA_DIR: input.kiloDataDir,
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`command failed (${exitCode}): ${input.cmd.join(" ")}\n${stderr}\n${stdout}`)
  }
  return JSON.parse(stdout) as unknown
}

test("family ID derivation is deterministic and does not leak raw session IDs into paths", () => {
  const familyID = deriveLcmFamilyID(LCM_FAMILY_ID_TEST_VECTOR.rootSessionID)
  const kiloDataDir = path.join("/tmp", "kilo-data")
  const familyRoot = resolveLcmFamilyRoot({ kiloDataDir, familyID })

  expect(familyID).toBe(LCM_FAMILY_ID_TEST_VECTOR.familyID)
  expect(familyRoot).not.toContain(LCM_FAMILY_ID_TEST_VECTOR.rootSessionID)
})

test("trusted session family resolution follows root lineage and rejects untrusted parent links", async () => {
  await using tmp = await tmpdir({ git: true })
  const kiloDataDir = path.join(tmp.path, "kilo-data")

  const sessions = await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const workspaceA = WorkspaceID.ascending("wrk_m31_a")
      const workspaceB = WorkspaceID.ascending("wrk_m31_b")
      const root = await Session.create({ title: "m31 root" })
      const child = await Session.create({ title: "m31 child", parentID: root.id })
      const grandchild = await Session.create({ title: "m31 grandchild", parentID: child.id })
      const selfCycle = await Session.create({ title: "m31 cycle" })
      const missingParent = await Session.create({ title: "m31 missing parent" })
      const workspaceParent = await Session.create({ title: "m31 workspace parent", workspaceID: workspaceA })
      const workspaceChild = await Session.create({
        title: "m31 workspace child",
        parentID: workspaceParent.id,
        workspaceID: workspaceB,
      })
      return { root, child, grandchild, selfCycle, missingParent, workspaceParent, workspaceChild }
    },
  })

  updateSession(sessions.selfCycle.id, { parent_id: sessions.selfCycle.id as typeof sessions.selfCycle.id })
  updateSession(sessions.missingParent.id, { parent_id: "ses_missing_m31" as typeof sessions.missingParent.id })

  await withKiloDataDir(kiloDataDir, async () => {
    const resolved = await resolveSessionFamilyTarget({ sessionID: sessions.grandchild.id })
    expect(resolved.rootSession.id).toBe(sessions.root.id)
    expect(resolved.target.rootSessionID).toBe(sessions.root.id)
    expect(resolved.target.familyID).toBe(deriveLcmFamilyID(sessions.root.id))
    expect(resolved.target.familyRoot).toBe(
      await fs
        .realpath(tmp.path)
        .then((realTmp) =>
          resolveLcmFamilyRoot({
            kiloDataDir: path.join(realTmp, "kilo-data"),
            familyID: deriveLcmFamilyID(sessions.root.id),
          }),
        ),
    )

    await expect(resolveSessionFamilyTarget({ sessionID: sessions.missingParent.id })).rejects.toMatchObject({
      code: "not_found",
      diagnosticCode: "lcm_family_parent_not_found",
    })
    await expect(resolveSessionFamilyTarget({ sessionID: sessions.selfCycle.id })).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_family_parent_self_link",
    })
    await expect(resolveSessionFamilyTarget({ sessionID: sessions.workspaceChild.id })).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_family_parent_scope_mismatch",
    })
    await expect(
      resolveSessionFamilyTarget({
        sessionID: sessions.root.id,
        assertedParentSessionID: sessions.child.id,
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_family_synthetic_parent_unproven",
    })
  })

  await using foreignTmp = await tmpdir({ git: true })
  const foreignParent = await Instance.provide({
    directory: foreignTmp.path,
    fn: () => Session.create({ title: "m31 foreign parent" }),
  })
  const crossProject = await Instance.provide({
    directory: tmp.path,
    fn: () => Session.create({ title: "m31 cross project", parentID: foreignParent.id }),
  })

  await withKiloDataDir(kiloDataDir, async () => {
    await expect(resolveSessionFamilyTarget({ sessionID: crossProject.id })).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_family_parent_scope_mismatch",
    })
  })
})

test("family worker registry isolates unrelated families and same-family owner locks", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const targetA = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_family_a" })
  const targetB = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_family_b" })
  const registry = createLcmDbWorkerRegistry({ lock: { heartbeatIntervalMs: 60_000 } })

  const [statusA, statusB] = await Promise.all([registry.initializeFamily(targetA), registry.initializeFamily(targetB)])
  expect(statusA.status).toBe("ready")
  expect(statusB.status).toBe("ready")
  expect(statusA.dataDir).not.toBe(statusB.dataDir)

  await registry.executeForFamily(
    targetA,
    request({
      lane: "foreground",
      run: async (db) => {
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
            VALUES ('usage_m31_a', 'session_m31_a', 'leaf_summary', 'background', 'not_applicable', 1777500000000)
          `,
        )
      },
    }),
  )

  const rowsInB = await registry.executeForFamily(
    targetB,
    request({
      lane: "foreground",
      run: async (db) =>
        (await (db as PGlite).query<{ count: number }>("SELECT COUNT(*)::int AS count FROM lcm_usage_records")).rows,
    }),
  )
  expect(rowsInB[0]?.count).toBe(0)

  const conflicting = createLcmDbWorker({ lock: { heartbeatIntervalMs: 60_000 } })
  const locked = await conflicting.initialize({
    dataDir: targetA.familyRoot,
    runtimeMode: targetA.runtimeMode,
    schemaVersion: targetA.schemaVersion,
    smokeMode: true,
  })
  expect(locked.status).toBe("locked")
  expect(locked.safeError).toMatchObject({ code: "db_locked" })

  await registry.closeFamily(targetA)
  expect(registry.getFamilyStatus(targetA).status).toBe("uninitialized")
  expect(registry.getFamilyStatus(targetB).status).toBe("ready")

  await conflicting.close()
  await registry.close()
})

test("family-scoped LCM context ignores the registry-selected family", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const targetA = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_context_a" })
  const targetB = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_context_b" })
  const registry = createLcmDbWorkerRegistry({ lock: { heartbeatIntervalMs: 60_000 } })

  try {
    expect((await registry.initializeFamily(targetA)).status).toBe("ready")
    expect((await registry.initializeFamily(targetB)).status).toBe("ready")

    const seedSnapshot = async (target: LcmFamilyTarget, conversationID: string, sourceSessionID: string) => {
      await registry.executeForFamily(
        target,
        request({
          lane: "foreground",
          run: async (db) => {
            await (db as PGlite).query(
              `
                INSERT INTO lcm_conversations (
                  conversation_id,
                  source_session_id,
                  root_conversation_id,
                  project_id,
                  session_directory,
                  boundary_metadata_json,
                  lifecycle_state,
                  schema_version,
                  feature_version,
                  created_at_ms,
                  updated_at_ms
                )
                VALUES ($1, $2, $1, 'project_m31_context', '/tmp/session', '{}'::jsonb, 'lcm_active', 1, 1, 1, 1)
              `,
              [conversationID, sourceSessionID],
            )
            await (db as PGlite).query(
              `
                INSERT INTO lcm_provider_request_snapshots (
                  request_snapshot_id,
                  operation_id,
                  conversation_id,
                  source_session_id,
                  provider_id,
                  model_id,
                  status,
                  cue_ids_json,
                  render_unit_ids_json,
                  source_selection_hash,
                  request_snapshot_protection_hash,
                  visibility_hash,
                  protected_span_hash,
                  provider_transform_hash,
                  provider_validator_hash,
                  created_at_ms,
                  expires_at_ms,
                  terminal_at_ms
                )
                VALUES (
                  'reqsnap_m31_context_shared',
                  'op_m31_context',
                  $1,
                  $2,
                  'provider_m31_context',
                  'model_m31_context',
                  'in_flight',
                  '[]'::jsonb,
                  '[]'::jsonb,
                  'source',
                  'protection',
                  'visibility',
                  'span',
                  'transform',
                  NULL,
                  1,
                  1800001,
                  NULL
                )
              `,
              [conversationID, sourceSessionID],
            )
          },
        }),
      )
    }

    await seedSnapshot(targetA, "conv_m31_context_a", "ses_m31_context_a")
    await seedSnapshot(targetB, "conv_m31_context_b", "ses_m31_context_b")

    const rootDb = LcmDb.Service.of({
      getStatus: () => Effect.sync(() => registry.getStatus()),
      initialize: (input) => Effect.promise(() => registry.initialize(input)),
      execute: (input) => Effect.promise(() => registry.execute(input)),
      executeForeground: (input) => Effect.promise(() => registry.executeForeground(input)),
      close: () => Effect.promise(() => registry.close()),
      getFamilyStatus: (target) => Effect.sync(() => registry.getFamilyStatus(target)),
      initializeFamily: (target) => Effect.promise(() => registry.initializeFamily(target)),
      executeForFamily: (target, input) => Effect.promise(() => registry.executeForFamily(target, input)),
      executeForegroundForFamily: (target, input) =>
        Effect.promise(() => registry.executeForegroundForFamily(target, input)),
      closeFamily: (target) => Effect.promise(() => registry.closeFamily(target)),
    })
    const scopedA = LcmDb.scoped(rootDb, targetA)
    const contextLayer = LcmContext.layer.pipe(Layer.provide(Layer.succeed(LcmDb.Service, scopedA)))

    await Effect.runPromise(
      LcmContext.Service.use((context) =>
        context.finalizeProviderRequestSnapshot({
          requestSnapshotID: "reqsnap_m31_context_shared",
          conversationID: "conv_m31_context_a" as ConversationID,
          status: "resolved",
          nowMs: 2,
        }),
      ).pipe(Effect.provide(contextLayer)),
    )

    const [rowA] = await registry.executeForFamily(
      targetA,
      request({
        lane: "foreground",
        run: async (db) =>
          (
            await (db as PGlite).query<{ status: string; terminal_at_ms: number | string | bigint | null }>(
              "SELECT status, terminal_at_ms FROM lcm_provider_request_snapshots WHERE request_snapshot_id = 'reqsnap_m31_context_shared'",
            )
          ).rows,
      }),
    )
    const [rowB] = await registry.executeForFamily(
      targetB,
      request({
        lane: "foreground",
        run: async (db) =>
          (
            await (db as PGlite).query<{ status: string; terminal_at_ms: number | string | bigint | null }>(
              "SELECT status, terminal_at_ms FROM lcm_provider_request_snapshots WHERE request_snapshot_id = 'reqsnap_m31_context_shared'",
            )
          ).rows,
      }),
    )

    expect(rowA?.status).toBe("resolved")
    expect(Number(rowA?.terminal_at_ms)).toBe(2)
    expect(rowB).toEqual({ status: "in_flight", terminal_at_ms: null })
  } finally {
    await registry.close()
  }
})

test("canonical family root variants reuse the same registry key", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const familyID = deriveLcmFamilyID("ses_m31_canonical")
  const familyRoot = resolveLcmFamilyRoot({ kiloDataDir, familyID })
  const variantRoot = path.join(familyRoot, "..", path.basename(familyRoot), ".")
  const firstTarget = await resolveDirectTestFamilyTarget({ familyRoot, schemaVersion })
  const secondTarget = await resolveDirectTestFamilyTarget({ familyRoot: variantRoot, schemaVersion })
  const registry = createLcmDbWorkerRegistry()

  const first = await registry.initializeFamily(firstTarget)
  const second = await registry.initializeFamily(secondTarget)

  expect(second.status).toBe("ready")
  expect(second.dataDir).toBe(first.dataDir)
  expect(second.ownerID).toBe(first.ownerID)

  await registry.close()
})

test("debug family roots reject parent, control, child, and old global paths", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const familyRoot = resolveLcmFamilyRoot({
    kiloDataDir,
    familyID: deriveLcmFamilyID("ses_m31_debug"),
  })
  const controlRoot = resolveLcmControlRoot(kiloDataDir)
  const rejected = [
    kiloDataDir,
    controlRoot,
    resolveLcmFamiliesRoot(kiloDataDir),
    path.join(familyRoot, "pglite"),
    path.join(familyRoot, "artifacts"),
    path.join(controlRoot, "pglite"),
    path.join(controlRoot, "artifacts"),
    path.join(controlRoot, "owner.lock"),
    path.join(controlRoot, "family_old_global"),
  ]

  await withKiloDataDir(kiloDataDir, async () => {
    for (const candidate of rejected) {
      await expect(resolveDebugFamilyTarget({ familyRoot: candidate })).rejects.toMatchObject({
        code: "invalid_request",
      })
    }

    const accepted = await resolveDebugFamilyTarget({ familyRoot })
    expect(accepted.familyRoot).toBe(resolveLcmDbLayout(familyRoot).rootDir)
  })
})

test("stale global root leftovers are ignored and not mutated by family startup", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const controlRoot = resolveLcmControlRoot(kiloDataDir)
  const target = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_stale_global" })
  await fs.mkdir(path.join(controlRoot, "pglite"), { recursive: true })
  await fs.mkdir(path.join(controlRoot, "artifacts"), { recursive: true })
  await fs.writeFile(path.join(controlRoot, "owner.lock"), "old global owner lock\n")

  const registry = createLcmDbWorkerRegistry()
  const status = await registry.initializeFamily(target)

  expect(status.status).toBe("ready")
  expect(await fs.readFile(path.join(controlRoot, "owner.lock"), "utf8")).toBe("old global owner lock\n")
  expect(await exists(resolveLcmDbLayout(target.familyRoot).ownerLockPath)).toBe(true)
  expect(await exists(path.join(controlRoot, "pglite"))).toBe(true)
  expect(await exists(path.join(controlRoot, "artifacts"))).toBe(true)

  await registry.close()
})

test("source, serve-mode, and compiled CLI smokes use explicit family roots", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const sourceTarget = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_source", runtimeMode: "source" })
  const serveTarget = await familyTarget({ kiloDataDir, rootSessionID: "ses_m31_serve", runtimeMode: "serve" })
  const compiledTarget = await familyTarget({
    kiloDataDir,
    rootSessionID: "ses_m31_compiled",
    runtimeMode: "compiled-bin",
  })

  await withKiloDataDir(kiloDataDir, async () => {
    const sourceReport = await runLcmDbSmoke({
      dataDir: sourceTarget.familyRoot,
      runtimeMode: "source",
      scale: LCM_PGLITE_GATE_TEST_SCALE,
      regexStartupTimeoutMs: 20_000,
      regexQueryTimeoutMs: 100,
    })
    expect(sourceReport.status).toBe("passed")
    expect(sourceReport.dataDir).toBe(sourceTarget.familyRoot)

    for (const target of [serveTarget, compiledTarget]) {
      const registry = createLcmDbWorkerRegistry()
      const status = await registry.initializeFamily(target)
      expect(status.status).toBe("ready")
      const rows = await registry.executeForFamily(
        target,
        request({
          lane: "foreground",
          run: async (db) => (await (db as PGlite).query<{ ok: number }>("SELECT 1::int AS ok")).rows,
        }),
      )
      expect(rows[0]?.ok).toBe(1)
      await registry.close()
    }

    const compiledBinary = path.join(packageRoot, "dist", "@kilocode", "cli-linux-x64", "bin", "kilo")
    expect(await exists(compiledBinary)).toBe(true)
    const diagnose = await spawnJson({
      cmd: [compiledBinary, "debug", "lcm-db-diagnose", "--data-dir", compiledTarget.familyRoot, "--json"],
      cwd: packageRoot,
      kiloDataDir,
    })
    expect(diagnose).toMatchObject({
      status: "ready",
      dataDir: compiledTarget.familyRoot,
    })

    expect(await exists(resolveLcmDbLayout(sourceTarget.familyRoot).pgliteDir)).toBe(true)
  })
})
