// kilocode_change - new file
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

async function tempRoot() {
  const root = path.join(process.env.TMPDIR ?? os.tmpdir(), "lcm-retrieval-runtime-")
  const dir = await fs.mkdtemp(root)
  return {
    path: dir,
    [Symbol.asyncDispose]: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

function scopedEnv(patch: Record<string, string>) {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(patch)) previous.set(key, process.env[key])
  for (const [key, value] of Object.entries(patch)) process.env[key] = value
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("lcm:retrieval-runtime expand query keeps root session scope after child-slot accounting", async () => {
  await using tmp = await tempRoot()
  const xdgRoot = path.join(tmp.path, "xdg")
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const restoreEnv = scopedEnv({
    KILO_LCM_TEST_DATA_DIR: kiloDataDir,
    XDG_DATA_HOME: path.join(xdgRoot, "data"),
    XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
    XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
    XDG_STATE_HOME: path.join(xdgRoot, "state"),
  })

  try {
    const [
      Instance,
      SessionModule,
      { LCM_DB_GATE_SCHEMA_VERSION },
      { resolveLcmFamilyRoot },
      { deriveLcmFamilyID },
      { LcmRuntime },
      { LcmDb },
      { Config },
      { serializeMessagePartSearchText },
      { createHarnessBoundaryMetadata },
      { initializeRetrievalWorker, queryRetrieval, retrievalNow },
    ] = await Promise.all([
      import("../../src/kilocode/instance"),
      import("../../src/session/session"),
      import("../../src/session/lcm/db-smoke"),
      import("../../src/session/lcm/db-layout"),
      import("../../src/session/lcm/family"),
      import("../../src/session/lcm/runtime"),
      import("../../src/session/lcm/db"),
      import("../../src/config/config"),
      import("../../src/session/lcm/validators"),
      import("./harness"),
      import("./retrieval-fixture"),
    ])
    const configLayer = Layer.succeed(
      Config.Service,
      Config.Service.of({
        get: () => Effect.succeed({}),
        getGlobal: () => Effect.succeed({}),
        getConsoleState: () =>
          Effect.succeed({
            consoleManagedProviders: [],
            switchableOrgCount: 0,
          }),
        update: () => Effect.void,
        updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
        invalidate: () => Effect.void,
        directories: () => Effect.succeed([]),
        waitForDependencies: () => Effect.void,
        warnings: () => Effect.succeed([]),
      }),
    )

    const rootPath = await fs.realpath(tmp.path)
    const session = await Instance.provide({
      directory: rootPath,
      fn: () =>
        Effect.runPromise(
          SessionModule.Service.use((session) => session.create({ title: "m21 runtime expand query" })).pipe(
            Effect.provide(SessionModule.defaultLayer),
          ),
        ),
    })
    const dataDir = resolveLcmFamilyRoot({ kiloDataDir, familyID: deriveLcmFamilyID(session.id) })
    const worker = await initializeRetrievalWorker(dataDir)
    const summaryID = "sum_m21_runtime_expand_query"
    try {
      const conversationID = "conv_m21_runtime_expand_query"
      const messageRowID = "msg_m21_runtime_expand_query"
      const partRowID = "part_m21_runtime_expand_query"
      const sourceText = "AlphaRuntime root-safe expansion detail came from the real root session."
      const searchText = serializeMessagePartSearchText({ textContent: sourceText })
      const boundary = createHarnessBoundaryMetadata({
        projectID: session.projectID,
        ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
        sessionDirectoryOriginal: session.directory,
        sessionDirectoryCanonical: rootPath,
        worktreeOriginal: session.directory,
        worktreeCanonical: rootPath,
        allowedRootOriginals: [session.directory],
        allowedRootCanonicals: [rootPath],
      })

      await queryRetrieval(
        worker,
        `
          INSERT INTO lcm_conversations (
            conversation_id,
            source_session_id,
            root_conversation_id,
            project_id,
            workspace_id,
            session_directory,
            worktree_path,
            boundary_metadata_json,
            capability_class,
            orchestration_metadata_json,
            lifecycle_state,
            schema_version,
            feature_version,
            created_at_ms,
            updated_at_ms
          )
          VALUES ($1, $2, $1, $3, $4, $5, $6, $7::jsonb, 'root',
                  $8::jsonb, 'lcm_active', $9, 1, $10, $10)
        `,
        [
          conversationID,
          session.id,
          session.projectID,
          session.workspaceID ?? null,
          session.directory,
          rootPath,
          JSON.stringify(boundary),
          JSON.stringify({ version: 1, source: "kilo_session", capabilityClass: "root" }),
          LCM_DB_GATE_SCHEMA_VERSION,
          retrievalNow,
        ],
      )
      await queryRetrieval(
        worker,
        `
          INSERT INTO lcm_messages (
            message_row_id,
            conversation_id,
            source_session_id,
            source_message_id,
            role,
            message_order,
            created_at_ms,
            provider_id,
            model_id,
            agent_name,
            metadata_json
          )
          VALUES ($1, $2, $3, 'msg_runtime_source', 'user', 1, $4, 'provider_m21', 'model_m21', 'code', $5::jsonb)
        `,
        [messageRowID, conversationID, session.id, retrievalNow, JSON.stringify({ version: 1, role: "user" })],
      )
      await queryRetrieval(
        worker,
        `
          INSERT INTO lcm_message_parts (
            part_row_id,
            message_row_id,
            conversation_id,
            source_part_key,
            part_order,
            part_kind,
            text_content,
            content_storage_kind,
            content_sha256,
            search_text,
            created_at_ms
          )
          VALUES ($1, $2, $3, 'runtime:part:1', 1, 'text', $4, 'inline', $5, $6, $7)
        `,
        [partRowID, messageRowID, conversationID, sourceText, sha256Hex(searchText), searchText, retrievalNow],
      )
      await queryRetrieval(
        worker,
        `
          INSERT INTO lcm_summaries (
            summary_id,
            conversation_id,
            summary_type,
            content_text,
            source_token_count,
            summary_token_count,
            summary_level,
            prompt_version,
            strategy,
            objective_status,
            fallback_mode,
            created_at_ms
          )
          VALUES ($1, $2, 'sprig', 'Summary mentions AlphaRuntime root-safe expansion.', 100, 20, 1,
                  'summary-leaf-v2', 'upward', 'provider_accepted', 'none', $3)
        `,
        [summaryID, conversationID, retrievalNow],
      )
      await queryRetrieval(
        worker,
        "INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order) VALUES ($1, $2, 1)",
        [summaryID, messageRowID],
      )
    } finally {
      await worker.close()
    }

    const result = await Effect.runPromise(
      LcmRuntime.Service.use((runtime) =>
        runtime.expandQuery({
          sessionID: session.id,
          summaryID,
          query: "What exact AlphaRuntime detail was recovered?",
        }),
      ).pipe(
        Effect.ensuring(LcmRuntime.Service.use((runtime) => runtime.close()).pipe(Effect.ignore)),
        Effect.provide(LcmRuntime.layer.pipe(Layer.provide(LcmDb.defaultLayer), Layer.provide(configLayer))),
      ),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`${result.error.diagnosticCode}: ${result.error.safeMessage}`)
    expect(result.answer).toContain("AlphaRuntime")
    expect(result.citations).toContainEqual({ summaryID })

    const missingModel = await Effect.runPromise(
      LcmRuntime.Service.use((runtime) =>
        runtime.expandQuery({
          sessionID: session.id,
          summaryID,
          query: "What exact AlphaRuntime detail was recovered?",
          providerID: "missing-provider",
          modelID: "missing-model",
        }),
      ).pipe(
        Effect.ensuring(LcmRuntime.Service.use((runtime) => runtime.close()).pipe(Effect.ignore)),
        Effect.provide(LcmRuntime.layer.pipe(Layer.provide(LcmDb.defaultLayer), Layer.provide(configLayer))),
      ),
    )
    expect(missingModel).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        diagnosticCode: "lcm_expand_query_model_unavailable",
      },
    })
  } finally {
    restoreEnv()
  }
})
