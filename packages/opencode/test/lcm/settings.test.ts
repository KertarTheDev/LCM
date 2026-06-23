// kilocode_change - new file
import { beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { LcmDb } from "../../src/session/lcm/db"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import { createLcmSafeError } from "../../src/session/lcm/types"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await resetDatabase()
})

function mergeTestLcmConfig(current: Config.Info["lcm"] | undefined, patch: Config.Info["lcm"] | undefined) {
  return {
    ...(current ?? {}),
    ...(patch?.strategy !== undefined ? { strategy: patch.strategy } : {}),
    ...(patch?.freshTailTokens !== undefined ? { freshTailTokens: patch.freshTailTokens } : {}),
    storage:
      current?.storage !== undefined || patch?.storage !== undefined
        ? {
            ...(current?.storage ?? {}),
            ...(patch?.storage ?? {}),
          }
        : undefined,
  } satisfies Config.Info["lcm"]
}

function failConfig<T>(error: unknown) {
  return Effect.fail(error) as unknown as Effect.Effect<T>
}

function configLayer(
  config: Config.Info,
  options: {
    local?: Config.Info
    getError?: unknown
    getLocalError?: unknown
    updateError?: unknown
  } = {},
) {
  let effectiveConfig = config
  let localConfig = options.local ?? {}
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => (options.getError ? failConfig<Config.Info>(options.getError) : Effect.succeed(effectiveConfig)),
      getLocal: () =>
        options.getLocalError ? failConfig<Config.Info>(options.getLocalError) : Effect.succeed(localConfig),
      getGlobal: () => Effect.succeed(effectiveConfig),
      getConsoleState: () =>
        Effect.succeed({
          consoleManagedProviders: [],
          switchableOrgCount: 0,
        }),
      update: (patch) =>
        options.updateError
          ? failConfig<void>(options.updateError)
          : Effect.sync(() => {
              effectiveConfig = {
                ...effectiveConfig,
                lcm: mergeTestLcmConfig(effectiveConfig.lcm, patch.lcm),
              }
              localConfig = {
                ...localConfig,
                lcm: mergeTestLcmConfig(localConfig.lcm, patch.lcm),
              }
            }),
      updateGlobal: () => Effect.succeed({ info: effectiveConfig, changed: false }),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
      warnings: () => Effect.succeed([]),
    }),
  )
}

function failIfSettingsTouchDbLayer() {
  const error = createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: false },
    retryable: false,
    diagnosticCode: "lcm_settings_unexpected_db_access",
  })
  return Layer.succeed(
    LcmDb.Service,
    LcmDb.Service.of({
      getStatus: () => Effect.die(error),
      initialize: () => Effect.die(error),
      execute: () => Effect.fail(error),
      executeForeground: () => Effect.fail(error),
      close: () => Effect.void,
    }),
  )
}

function runtimeLayer(
  config: Config.Info,
  dbLayer = LcmDb.defaultLayer,
  configOptions?: Parameters<typeof configLayer>[1],
) {
  return LcmRuntime.layer.pipe(Layer.provide(dbLayer), Layer.provide(configLayer(config, configOptions)))
}

async function withLcmDataDir<T>(dataDir: string, fn: () => Promise<T>) {
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = dataDir
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
}

function createSession(
  directory: string,
  input: Parameters<Session.Interface["create"]>[0] = {},
): Promise<Session.Info> {
  return Effect.runPromise(
    Session.Service.use((svc) => svc.create(input)).pipe(
      provideInstance(directory),
      Effect.provide(Session.defaultLayer),
    ),
  )
}

test("settings persist through Kilo config without touching LCM memory tables", async () => {
  await using tmp = await tmpdir()
  await withLcmDataDir(path.join(tmp.path, "lcm"), async () => {
    const layer = runtimeLayer(
      {
        lcm: {
          strategy: "dolt",
          freshTailTokens: 12_000,
          storage: { warningThresholdBytes: 2048 },
        },
      },
      failIfSettingsTouchDbLayer(),
    )

    const result = await Effect.runPromise(
      LcmRuntime.Service.use((svc) =>
        Effect.gen(function* () {
          const defaults = yield* svc.getSettingsState({ projectID: "project_settings", workspaceID: "workspace_a" })
          const updated = yield* svc.updateSettings({
            projectID: "project_settings",
            workspaceID: "workspace_a",
            strategy: "upward",
            freshTailTokens: 20_000,
            storageWarningThresholdBytes: 4096,
          })
          const reread = yield* svc.getSettingsState({ projectID: "project_settings", workspaceID: "workspace_a" })
          return { defaults, updated, reread }
        }),
      ).pipe(Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)), Effect.provide(layer)),
    )

    expect(result.defaults).toMatchObject({
      strategy: "dolt",
      freshTailTokens: 12_000,
      storageWarningThresholdBytes: 2048,
      effectiveScope: {
        kind: "default",
        projectID: "project_settings",
        workspaceID: "workspace_a",
      },
    })
    expect(result.updated).toMatchObject({
      strategy: "upward",
      freshTailTokens: 20_000,
      storageWarningThresholdBytes: 4096,
      effectiveScope: {
        kind: "workspace",
        projectID: "project_settings",
        workspaceID: "workspace_a",
      },
    })
    expect(result.reread).toMatchObject({
      strategy: "upward",
      freshTailTokens: 20_000,
      storageWarningThresholdBytes: 4096,
      effectiveScope: {
        kind: "workspace",
        projectID: "project_settings",
        workspaceID: "workspace_a",
      },
    })
    expect(result.defaults).not.toHaveProperty("lifecycleState")
    expect(result.updated).not.toHaveProperty("lifecycleState")
    expect(result.reread).not.toHaveProperty("lifecycleState")
  })
})

test("settings config failures are content-safe and writes fail closed", async () => {
  const readError = createLcmSafeError({
    code: "settings_unavailable",
    templateKey: "lcm.settings.unavailable",
    safeParams: { retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "lcm_test_local_config_unreadable",
  })
  const writeError = createLcmSafeError({
    code: "settings_unavailable",
    templateKey: "lcm.settings.unavailable",
    safeParams: { retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "lcm_test_config_unwritable",
  })

  const state = await Effect.runPromise(
    LcmRuntime.Service.use((svc) =>
      Effect.gen(function* () {
        return yield* svc.getSettingsState({ projectID: "project_config_error" })
      }),
    ).pipe(Effect.provide(runtimeLayer({}, failIfSettingsTouchDbLayer(), { getLocalError: readError }))),
  )
  const write = await Effect.runPromise(
    LcmRuntime.Service.use((svc) =>
      svc
        .updateSettings({ projectID: "project_config_error", strategy: "dolt" })
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined })),
    ).pipe(Effect.provide(runtimeLayer({}, failIfSettingsTouchDbLayer(), { updateError: writeError }))),
  )

  expect(state).toMatchObject({
    strategy: "upward",
    freshTailTokens: 20_000,
    storageWarningThresholdBytes: 10737418240,
    effectiveScope: { kind: "default", projectID: "project_config_error" },
    safeError: {
      code: "settings_unavailable",
      diagnosticCode: "lcm_settings_local_config_read_failed",
    },
  })
  expect(state).not.toHaveProperty("dbStatus")
  expect(write).toMatchObject({
    code: "settings_unavailable",
    diagnosticCode: "lcm_settings_config_write_failed",
  })
  expect(JSON.stringify(state)).not.toContain("RAW_MEMORY_SENTINEL")
  expect(JSON.stringify(write)).not.toContain("RAW_MEMORY_SENTINEL")
})

test("primary settings route rejects forged scope assertions before config writes", async () => {
  await using tmp = await tmpdir({ git: true })
  const headers = { "x-kilo-directory": tmp.path }
  const app = Server.Default().app
  try {
    const projectMismatch = await app.request("/lcm/settings?projectID=forged_project", { headers })
    expect(projectMismatch.status).toBe(400)
    expect(await projectMismatch.json()).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_settings_project_assertion_mismatch",
      },
    })

    const workspaceMismatch = await app.request("/lcm/settings?workspaceID=forged_workspace", { headers })
    expect(workspaceMismatch.status).toBe(400)
    expect(await workspaceMismatch.json()).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_settings_workspace_assertion_mismatch",
      },
    })

    const sessionIDRejected = await app.request("/lcm/settings", {
      method: "PATCH",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionID: "ses_forged", strategy: "dolt" }),
    })
    expect(sessionIDRejected.status).toBe(400)
    expect(await sessionIDRejected.json()).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_settings_primary_route_session_id_unsupported",
      },
    })
  } finally {
    await disposeAllInstances()
  }
})

test("session settings route rejects a wrong instance target before writing config", async () => {
  await using sessionDir = await tmpdir({ git: true })
  await using otherDir = await tmpdir({ git: true })
  const session = await createSession(sessionDir.path)
  const app = Server.Default().app

  try {
    const response = await app.request(`/session/${session.id}/lcm/settings`, {
      method: "PATCH",
      headers: {
        "x-kilo-directory": otherDir.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ strategy: "dolt" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_settings_project_scope_mismatch",
      },
    })
  } finally {
    await disposeAllInstances()
  }
})

test("session settings route reports runtime-owned DB status without exposing it on the primary config route", async () => {
  await using sessionDir = await tmpdir({ git: true })
  await using lcmTmp = await tmpdir()
  const session = await createSession(sessionDir.path)
  const app = Server.Default().app
  const lcmDir = path.join(lcmTmp.path, "kilo-data")
  const headers = { "x-kilo-directory": sessionDir.path }

  try {
    const sessionResponse = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/settings`, { headers }),
    )
    expect(sessionResponse.status).toBe(200)
    expect(await sessionResponse.json()).toMatchObject({
      lifecycleState: "passive_synced",
      dbStatus: {
        status: "ready",
        schemaVersion: 1,
      },
    })

    const primaryResponse = await withLcmDataDir(lcmDir, async () => app.request("/lcm/settings", { headers }))
    expect(primaryResponse.status).toBe(200)
    const primary = await primaryResponse.json()
    expect(primary).not.toHaveProperty("lifecycleState")
    expect(primary).not.toHaveProperty("dbStatus")
  } finally {
    await disposeAllInstances()
  }
})

test("session DB diagnose route returns a content-safe support report for the trusted family", async () => {
  await using sessionDir = await tmpdir({ git: true })
  await using lcmTmp = await tmpdir()
  const session = await createSession(sessionDir.path)
  const app = Server.Default().app
  const lcmDir = path.join(lcmTmp.path, "kilo-data")

  try {
    const response = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/db/diagnose`, {
        method: "POST",
        headers: {
          "x-kilo-directory": sessionDir.path,
        },
      }),
    )

    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report).toMatchObject({
      status: "ready",
      schemaVersion: 1,
      quarantineRecommended: false,
      safeErrors: [],
    })
    expect(report.operationID).toMatch(/^op_/)
    expect(report.dataDir).toContain("family_")
    expect(report.checks).toContainEqual({ name: "Open DB for diagnosis", status: "passed" })
    expect(report.checks).toContainEqual({ name: "Production migration registry readable", status: "passed" })
    expect(JSON.stringify(report)).not.toContain("RAW_MEMORY_SENTINEL")
    expect(JSON.stringify(report)).not.toContain(session.id)
  } finally {
    await disposeAllInstances()
  }
})

test("session DB rebuild route previews repair and refuses healthy apply for the trusted family", async () => {
  await using sessionDir = await tmpdir({ git: true })
  await using lcmTmp = await tmpdir()
  const session = await createSession(sessionDir.path)
  const app = Server.Default().app
  const lcmDir = path.join(lcmTmp.path, "kilo-data")
  const headers = {
    "x-kilo-directory": sessionDir.path,
    "content-type": "application/json",
  }

  try {
    const preview = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/db/rebuild`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dryRun: true, dataDir: "/tmp/forged" }),
      }),
    )

    expect(preview.status).toBe(400)

    const defaultPreview = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/db/rebuild`, {
        method: "POST",
        headers: {
          "x-kilo-directory": sessionDir.path,
        },
      }),
    )
    expect(defaultPreview.status).toBe(200)
    expect(await defaultPreview.json()).toMatchObject({
      dryRun: true,
      status: "would_rebuild",
    })

    const validPreview = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/db/rebuild`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dryRun: true }),
      }),
    )
    expect(validPreview.status).toBe(200)
    const report = await validPreview.json()
    expect(report).toMatchObject({
      dryRun: true,
      status: "would_rebuild",
      rebuiltConversations: 0,
      failedConversations: 0,
    })
    expect(report.dataDir).toContain("family_")
    expect(JSON.stringify(report)).not.toContain(session.id)

    const healthyApply = await withLcmDataDir(lcmDir, async () =>
      app.request(`/session/${session.id}/lcm/db/rebuild`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dryRun: false }),
      }),
    )
    expect(healthyApply.status).toBe(400)
    expect(await healthyApply.json()).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_db_rebuild_refused_ready_family",
      },
    })
  } finally {
    await disposeAllInstances()
  }
})

test("session settings runtime rejects a wrong workspace assertion without touching memory DB", async () => {
  await using tmp = await tmpdir({ git: true })
  const workspaceID = WorkspaceID.ascending()
  const wrongWorkspaceID = WorkspaceID.ascending()
  const session = await createSession(tmp.path, { workspaceID })

  const result = await Effect.runPromise(
    LcmRuntime.Service.use((svc) =>
      svc
        .getSettingsState({
          sessionID: session.id,
          projectID: session.projectID,
          workspaceID: wrongWorkspaceID,
        })
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined })),
    ).pipe(Effect.provide(runtimeLayer({}, failIfSettingsTouchDbLayer()))),
  )

  expect(result).toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_settings_workspace_scope_mismatch",
  })
})

test("settings route maps real config write failures without starting LCM storage", async () => {
  await using tmp = await tmpdir({ git: true })
  await using lcmTmp = await tmpdir()
  const headers = {
    "x-kilo-directory": tmp.path,
    "content-type": "application/json",
  }
  const app = Server.Default().app
  const configPath = path.join(tmp.path, ".kilo", "kilo.json")
  const lcmDir = path.join(lcmTmp.path, "lcm")

  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, "{}\n", "utf8")
  try {
    const warm = await app.request("/lcm/settings", { headers })
    expect(warm.status).toBe(200)
    await fs.chmod(configPath, 0o400)

    const response = await withLcmDataDir(lcmDir, async () =>
      app.request("/lcm/settings", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ strategy: "dolt" }),
      }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: "settings_unavailable",
        diagnosticCode: "lcm_settings_config_write_failed",
      },
    })
    await expect(fs.access(lcmDir).then(() => true)).rejects.toThrow()
  } finally {
    await fs.chmod(configPath, 0o600).catch(() => undefined)
    await disposeAllInstances()
  }
})
