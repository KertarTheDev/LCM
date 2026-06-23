// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import * as Instance from "../../src/kilocode/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import * as SessionModule from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { writeLcmArtifact } from "../../src/session/lcm/artifacts"
import { LcmDb } from "../../src/session/lcm/db"
import { createDbCorruptError, createDbLockedError } from "../../src/session/lcm/db-errors"
import { resolveLcmDbLayout, resolveLcmFamilyRoot } from "../../src/session/lcm/db-layout"
import { deriveLcmFamilyID } from "../../src/session/lcm/family"
import { createLcmFinalizedSyncPendingStore } from "../../src/session/lcm/finalized-sync-retry"
import {
  ensureLcmDbReady,
  getCapabilities,
  getConversationScope,
  getOrCreateConversation,
  handleSessionDeleted,
  LCM_USAGE_MODES,
  LCM_USAGE_PURPOSES,
  recordUsage,
} from "../../src/session/lcm/lifecycle"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import type { ConversationID, LcmDbStatus, LcmSafeError, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

function operationID(suffix: string): OperationID {
  return `op_m05_${suffix}_${Date.now().toString(36)}` as OperationID
}

function runSession<A, E>(effect: Effect.Effect<A, E, SessionModule.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionModule.defaultLayer)))
}

const Session = {
  ...SessionModule,
  create(input?: Parameters<SessionModule.Interface["create"]>[0]) {
    return runSession(SessionModule.Service.use((session) => session.create(input)))
  },
  updateMessage<T extends Parameters<SessionModule.Interface["updateMessage"]>[0]>(message: T) {
    return runSession(SessionModule.Service.use((session) => session.updateMessage(message)))
  },
  remove(sessionID: Parameters<SessionModule.Interface["remove"]>[0]) {
    return runSession(SessionModule.Service.use((session) => session.remove(sessionID)))
  },
}

function configLayer(config: Config.Info) {
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed(config),
      getLocal: () => Effect.succeed(config),
      getGlobal: () => Effect.succeed(config),
      getConsoleState: () =>
        Effect.succeed({
          consoleManagedProviders: [],
          switchableOrgCount: 0,
        }),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({ info: config, changed: false }),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
      warnings: () => Effect.succeed([]),
    }),
  )
}

function runLcm<A, E>(effect: Effect.Effect<A, E, LcmDb.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.ensuring(LcmDb.Service.use((db) => db.close()).pipe(Effect.ignore)),
      Effect.provide(LcmDb.defaultLayer),
    ),
  )
}

function dbQuery<T>(
  sql: string,
  params: unknown[] = [],
  purpose: "sync" | "cleanup" | "debug_support" = "debug_support",
) {
  return LcmDb.Service.use((svc) =>
    svc.executeForeground({
      operationID: operationID("query"),
      purpose,
      run: async (db) => (await (db as PGlite).query<T>(sql, params)).rows,
    }),
  )
}

function dbExec(sql: string, params: unknown[] = [], purpose: "sync" | "cleanup" | "debug_support" = "debug_support") {
  return LcmDb.Service.use((svc) =>
    svc.executeForeground({
      operationID: operationID("exec"),
      purpose,
      run: async (db) => {
        await (db as PGlite).query(sql, params)
      },
    }),
  )
}

async function createSessions(directory: string, input?: { crossParentID?: string }) {
  return Instance.provide({
    directory,
    fn: async () => {
      const root = await Session.create({ title: "m05 root" })
      const child = await Session.create({
        title: "m05 child",
        parentID: (input?.crossParentID ?? root.id) as typeof root.id,
      })
      return { root, child }
    },
  })
}

async function withLcmEnv<T>(dataDir: string, fn: () => Promise<T>) {
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR =
    path.basename(path.dirname(dataDir)) === "families"
      ? path.dirname(path.dirname(path.dirname(dataDir)))
      : path.dirname(dataDir)
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
}

test("conversation creation is idempotent and persists lifecycle, capability, boundary, and scope metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { root, child } = await createSessions(tmp.path)

  const result = await runLcm(
    Effect.gen(function* () {
      const rootID = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const rootAgain = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const ignoredCapability = yield* getOrCreateConversation({
        sessionID: root.id,
        dataDir,
        capabilityClass: "map_child",
      } as never)
      const childID = yield* getOrCreateConversation({ sessionID: child.id, parentSessionID: root.id, dataDir })

      yield* dbExec(
        `
          INSERT INTO lcm_messages (
            message_row_id,
            conversation_id,
            source_session_id,
            source_message_id,
            role,
            message_order,
            created_at_ms
          )
          VALUES ('msg_m05_scope', $1, $2, 'source_msg_m05_scope', 'user', 1, 1777500000000)
        `,
        [childID, child.id],
        "sync",
      )
      yield* dbExec(
        `
          INSERT INTO lcm_message_parts (
            part_row_id,
            message_row_id,
            conversation_id,
            source_part_key,
            part_order,
            part_kind,
            text_content,
            search_text,
            created_at_ms
          )
          VALUES ('part_m05_scope', 'msg_m05_scope', $1, 'text:0', 1, 'text', 'RAW_SCOPE_SENTINEL', 'RAW_SCOPE_SENTINEL', 1777500000000)
        `,
        [childID],
        "sync",
      )

      const capabilities = yield* getCapabilities({ sessionID: root.id, strategy: "upward", dataDir })
      const childScope = yield* getConversationScope({ sessionID: child.id, dataDir })
      const rows = yield* dbQuery<{
        source_session_id: string
        conversation_id: ConversationID
        parent_conversation_id: ConversationID | null
        root_conversation_id: ConversationID
        capability_class: string
        lifecycle_state: string
        boundary_metadata_json: unknown
      }>(
        `
          SELECT source_session_id, conversation_id, parent_conversation_id, root_conversation_id,
                 capability_class, lifecycle_state, boundary_metadata_json
          FROM lcm_conversations
          ORDER BY source_session_id
        `,
      )

      return { rootID, rootAgain, ignoredCapability, childID, capabilities, childScope, rows }
    }),
  )

  expect(result.rootAgain).toBe(result.rootID)
  expect(result.ignoredCapability).toBe(result.rootID)
  expect(result.capabilities).toMatchObject({
    sessionID: root.id,
    conversationID: result.rootID,
    lifecycleState: "lcm_active",
    dbReady: true,
    lcmActive: true,
    canRetrieve: true,
  })

  const rootRow = result.rows.find((row) => row.source_session_id === root.id)
  const childRow = result.rows.find((row) => row.source_session_id === child.id)
  expect(rootRow).toMatchObject({
    conversation_id: result.rootID,
    parent_conversation_id: null,
    root_conversation_id: result.rootID,
    capability_class: "root",
    lifecycle_state: "lcm_active",
  })
  expect(childRow).toMatchObject({
    conversation_id: result.childID,
    parent_conversation_id: result.rootID,
    root_conversation_id: result.rootID,
    capability_class: "task_child",
    lifecycle_state: "lcm_active",
  })

  expect(result.childScope.ancestorConversationIDs).toEqual([result.rootID])
  expect(result.childScope.boundaryMetadata).toMatchObject({
    version: 1,
    projectID: child.projectID,
    sessionDirectoryCanonical: tmp.path,
  })
  expect(result.childScope.sourceCoverageCounts).toMatchObject({
    messages: 1,
    parts: 1,
  })
  expect(JSON.stringify(result.childScope)).not.toContain("RAW_SCOPE_SENTINEL")
})

test("boundary metadata is required and cross-project parent links are rejected", async () => {
  await using parentTmp = await tmpdir({ git: true })
  await using childTmp = await tmpdir({ git: true })
  const dataDir = path.join(parentTmp.path, "lcm")
  const parent = await Instance.provide({
    directory: parentTmp.path,
    fn: () => Session.create({ title: "m05 parent" }),
  })
  const { child } = await createSessions(childTmp.path, { crossParentID: parent.id })

  await expect(
    runLcm(
      Effect.gen(function* () {
        yield* getOrCreateConversation({ sessionID: parent.id, dataDir })
        yield* getOrCreateConversation({ sessionID: child.id, parentSessionID: parent.id, dataDir })
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_parent_boundary_mismatch",
  })

  await using invalidTmp = await tmpdir({ git: true })
  const invalidDataDir = path.join(invalidTmp.path, "lcm")
  const { root } = await createSessions(invalidTmp.path)

  await expect(
    runLcm(
      Effect.gen(function* () {
        yield* ensureLcmDbReady({ dataDir: invalidDataDir })
        yield* dbExec(
          `
            INSERT INTO lcm_conversations (
              conversation_id,
              source_session_id,
              root_conversation_id,
              project_id,
              workspace_id,
              session_directory,
              boundary_metadata_json,
              lifecycle_state,
              schema_version,
              feature_version,
              created_at_ms,
              updated_at_ms
            )
            VALUES (
              'conv_m05_empty_boundary',
              $1,
              'conv_m05_empty_boundary',
              $2,
              $3,
              $4,
              '{}'::jsonb,
              'passive_synced',
              4,
              1,
              1777500000000,
              1777500000000
            )
          `,
          [root.id, root.projectID, root.workspaceID ?? null, root.directory],
          "sync",
        )
        yield* getOrCreateConversation({ sessionID: root.id, dataDir: invalidDataDir })
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
  })
})

test("legacy-compacted sessions continue through normal LCM activation", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const legacy = await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "m17 legacy compacted" })
      const userID = MessageID.ascending()
      await Session.updateMessage({
        id: userID,
        sessionID: session.id,
        role: "user",
        time: { created: 1777500000000 },
        agent: "code",
        model: {
          providerID: ProviderID.make("provider_m17"),
          modelID: ModelID.make("model_m17"),
        },
      })
      await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: 1777500000000, completed: 1777500001000 },
        parentID: userID,
        providerID: ProviderID.make("provider_m17"),
        modelID: ModelID.make("model_m17"),
        mode: "code",
        agent: "code",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
        summary: true,
      })
      return session
    },
  })

  const result = await runLcm(
    Effect.gen(function* () {
      const conversationID = yield* getOrCreateConversation({ sessionID: legacy.id, dataDir })
      const createdCapabilities = yield* getCapabilities({ sessionID: legacy.id, strategy: "upward", dataDir })
      yield* dbExec(
        `
          UPDATE lcm_conversations
          SET lifecycle_state = 'legacy_read_only'
          WHERE conversation_id = $1
        `,
        [conversationID],
        "sync",
      )
      const recoveredCapabilities = yield* getCapabilities({ sessionID: legacy.id, strategy: "upward", dataDir })
      const rows = yield* dbQuery<{ lifecycle_state: string }>(
        "SELECT lifecycle_state FROM lcm_conversations WHERE conversation_id = $1",
        [conversationID],
      )
      return { conversationID, createdCapabilities, recoveredCapabilities, storedState: rows[0]?.lifecycle_state }
    }),
  )

  expect(result.createdCapabilities).toMatchObject({
    sessionID: legacy.id,
    conversationID: result.conversationID,
    lifecycleState: "passive_synced",
    lcmActive: false,
    canAssemble: false,
    canMaintain: false,
    canRetrieve: false,
  })
  expect(result.recoveredCapabilities).toMatchObject({
    sessionID: legacy.id,
    conversationID: result.conversationID,
    lifecycleState: "passive_synced",
  })
  expect(result.storedState).toBe("passive_synced")
})

test("usage writer records full taxonomy through an allowlist and rejects raw content fields", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { root } = await createSessions(tmp.path)
  const usageFixtures = LCM_USAGE_PURPOSES.map((purpose) => ({
    purpose,
    mode:
      purpose === "leaf_summary"
        ? "background"
        : purpose === "condensation" || purpose === "hard_limit_maintenance"
          ? "blocking"
          : purpose === "retrieval_expand_query"
            ? "explicit_retrieval"
            : purpose === "file_exploration"
              ? "explicit_exploration"
              : "map_item",
  })) satisfies Array<{
    purpose: (typeof LCM_USAGE_PURPOSES)[number]
    mode: (typeof LCM_USAGE_MODES)[number]
  }>

  const result = await runLcm(
    Effect.gen(function* () {
      const conversationID = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const records = []
      for (let index = 0; index < usageFixtures.length; index++) {
        const fixture = usageFixtures[index]!
        records.push(
          yield* recordUsage({
            sessionID: root.id,
            conversationID,
            jobID: operationID(`usage_${index}`),
            purpose: fixture.purpose,
            mode: fixture.mode,
            providerID: "provider_m05",
            modelID: "model_m05",
            inputTokens: index + 1,
            outputTokens: index + 2,
            cacheReadTokens: index,
            cacheWriteTokens: index,
            costStatus: index === 0 ? "provider_reported" : "unknown",
            ...(index === 0 ? { costAmount: 0.01, costCurrency: "USD" } : {}),
            createdAt: 1777500000000 + index,
            dataDir,
          }),
        )
      }
      const rows = yield* dbQuery<Record<string, unknown>>(
        `
          SELECT *
          FROM lcm_usage_records
          ORDER BY created_at_ms
        `,
      )
      const columns = yield* dbQuery<{ column_name: string }>(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'lcm_usage_records'
          ORDER BY ordinal_position
        `,
      )
      return { conversationID, records, rows, columns: columns.map((row) => row.column_name) }
    }),
  )

  expect(result.records.map((record) => record.purpose)).toEqual([...LCM_USAGE_PURPOSES])
  expect([...new Set(result.records.map((record) => record.mode))].sort()).toEqual([...LCM_USAGE_MODES].sort())
  expect(result.rows).toHaveLength(LCM_USAGE_PURPOSES.length)
  expect(result.columns).not.toContain("prompt_text")
  expect(result.columns).not.toContain("content")
  expect(result.columns).not.toContain("tool_output_text")
  expect(JSON.stringify(result.rows)).not.toContain("RAW_USAGE_SENTINEL")

  await expect(
    runLcm(
      recordUsage({
        sessionID: root.id,
        conversationID: result.conversationID,
        purpose: "leaf_summary",
        mode: "background",
        costStatus: "unknown",
        promptText: "RAW_USAGE_SENTINEL",
        dataDir,
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
  })
})

test("recursive deletion cleanup is guarded, cascades rows, and removes only LCM-owned artifacts", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const { root, child } = await createSessions(tmp.path)
  const workspaceFile = path.join(tmp.path, "workspace-source.txt")
  await fs.writeFile(workspaceFile, "workspace bytes")

  const result = await runLcm(
    Effect.gen(function* () {
      const rootID = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const childID = yield* getOrCreateConversation({ sessionID: child.id, parentSessionID: root.id, dataDir })
      const childScope = yield* getConversationScope({ sessionID: child.id, dataDir })
      const rootArtifact = yield* Effect.promise(() =>
        writeLcmArtifact({ artifactRoot: layout.artifactsDir, bytes: Buffer.from("root artifact", "utf8") }),
      )
      const childArtifact = yield* Effect.promise(() =>
        writeLcmArtifact({ artifactRoot: layout.artifactsDir, bytes: Buffer.from("child artifact", "utf8") }),
      )

      yield* dbExec(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            artifact_storage_kind,
            artifact_path,
            artifact_byte_count,
            artifact_content_sha256,
            created_at_ms,
            updated_at_ms
          )
          VALUES
            ('file_m05_root_artifact', $1, 'inline', 'file', $2, $3, $4, 1777500000000, 1777500000000),
            ('file_m05_child_artifact', $5, 'tool_output', 'file', $6, $7, $8, 1777500000000, 1777500000000)
        `,
        [
          rootID,
          rootArtifact.artifactPath,
          rootArtifact.byteCount,
          rootArtifact.sha256,
          childID,
          childArtifact.artifactPath,
          childArtifact.byteCount,
          childArtifact.sha256,
        ],
        "sync",
      )
      yield* dbExec(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            original_path,
            canonical_path,
            path_size_bytes,
            path_mtime_ms,
            path_content_sha256,
            path_hash_mode,
            boundary_metadata_json,
            artifact_storage_kind,
            created_at_ms,
            updated_at_ms
          )
          VALUES (
            'file_m05_path_backed',
            $1,
            'path',
            $2,
            $2,
            15,
            1777500000000,
            $3,
            'full',
            $4::jsonb,
            'none',
            1777500000000,
            1777500000000
          )
        `,
        [childID, workspaceFile, "b".repeat(64), JSON.stringify(childScope.boundaryMetadata)],
        "sync",
      )
      yield* recordUsage({
        sessionID: child.id,
        conversationID: childID,
        purpose: "leaf_summary",
        mode: "background",
        costStatus: "not_applicable",
        dataDir,
      })
      yield* dbExec(
        `
          INSERT INTO lcm_map_runs (
            map_id,
            conversation_id,
            tool_kind,
            status,
            request_fingerprint,
            input_file_id,
            worker_count,
            prompt_text,
            prompt_sha256,
            model_selection_json,
            schema_json,
            schema_sha256,
            created_at_ms,
            updated_at_ms
          )
          VALUES (
            'map_m05_cleanup',
            $1,
            'llm_map',
            'queued',
            'fingerprint_m05',
            'file_m05_child_artifact',
            1,
            'RAW_MAP_PROMPT_SENTINEL',
            $2,
            '{}'::jsonb,
            '{}'::jsonb,
            $2,
            1777500000000,
            1777500000000
          )
        `,
        [childID, "c".repeat(64)],
        "sync",
      )
      yield* dbExec(
        `
          INSERT INTO lcm_map_items (
            map_id,
            item_index,
            status,
            attempts,
            created_at_ms,
            updated_at_ms
          )
          VALUES ('map_m05_cleanup', 0, 'pending', 0, 1777500000000, 1777500000000)
        `,
        [],
        "sync",
      )

      const guarded = yield* Effect.exit(handleSessionDeleted({ sessionID: root.id, recursive: false, dataDir }))
      const before = yield* dbQuery<{ count: number }>("SELECT COUNT(*)::int AS count FROM lcm_conversations")
      yield* handleSessionDeleted({ sessionID: root.id, recursive: true, dataDir })
      yield* handleSessionDeleted({ sessionID: root.id, recursive: true, dataDir })
      const after = yield* dbQuery<{
        conversations: number
        usage_records: number
        map_runs: number
        map_items: number
      }>(
        `
          SELECT
            (SELECT COUNT(*)::int FROM lcm_conversations) AS conversations,
            (SELECT COUNT(*)::int FROM lcm_usage_records) AS usage_records,
            (SELECT COUNT(*)::int FROM lcm_map_runs) AS map_runs,
            (SELECT COUNT(*)::int FROM lcm_map_items) AS map_items
        `,
      )
      return {
        guarded,
        before: before[0],
        after: after[0],
        rootArtifact: rootArtifact.artifactPath,
        childArtifact: childArtifact.artifactPath,
      }
    }),
  )

  expect(String(result.guarded)).toContain("lcm_cleanup_non_recursive_has_children")
  expect(result.before.count).toBe(2)
  expect(result.after).toEqual({
    conversations: 0,
    usage_records: 0,
    map_runs: 0,
    map_items: 0,
  })
  await expect(fs.stat(path.join(layout.artifactsDir, result.rootArtifact))).rejects.toThrow()
  await expect(fs.stat(path.join(layout.artifactsDir, result.childArtifact))).rejects.toThrow()
  await expect(fs.stat(workspaceFile)).resolves.toBeTruthy()
})

test("normal session deletion invokes recursive LCM cleanup", async () => {
  await using tmp = await tmpdir({ git: true })
  const { root } = await createSessions(tmp.path)
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const dataDir = resolveLcmFamilyRoot({ kiloDataDir, familyID: deriveLcmFamilyID(root.id) })
  const layout = resolveLcmDbLayout(dataDir)
  const pendingStore = createLcmFinalizedSyncPendingStore({ kiloDataDir })

  const artifactPath = await runLcm(
    Effect.gen(function* () {
      const conversationID = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const artifact = yield* Effect.promise(() =>
        writeLcmArtifact({ artifactRoot: layout.artifactsDir, bytes: Buffer.from("normal delete artifact", "utf8") }),
      )
      yield* dbExec(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            artifact_storage_kind,
            artifact_path,
            artifact_byte_count,
            artifact_content_sha256,
            created_at_ms,
            updated_at_ms
          )
          VALUES ('file_m05_normal_delete', $1, 'inline', 'file', $2, $3, $4, 1777500000000, 1777500000000)
        `,
        [conversationID, artifact.artifactPath, artifact.byteCount, artifact.sha256],
        "sync",
      )
      return artifact.artifactPath
    }),
  )
  await Effect.runPromise(
    pendingStore.save({
      sessionID: root.id,
      upToMessageID: MessageID.make("msg_m05_finalized_sync_pending"),
      attempts: 1,
      safeError: createDbLockedError({ diagnosticCode: "lcm_test_pending_cleanup" }),
    }),
  )
  await expect(Effect.runPromise(pendingStore.load(root.id))).resolves.toMatchObject({ attempts: 1 })

  await withLcmEnv(dataDir, async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.remove(root.id)
        await LcmRuntime.close()
      },
    })
  })

  const remaining = await runLcm(
    Effect.gen(function* () {
      yield* ensureLcmDbReady({ dataDir })
      return yield* dbQuery<{ count: number }>("SELECT COUNT(*)::int AS count FROM lcm_conversations")
    }),
  )
  expect(remaining[0]?.count).toBe(0)
  await expect(fs.stat(path.join(layout.artifactsDir, artifactPath))).rejects.toThrow()
  await expect(Effect.runPromise(pendingStore.load(root.id))).resolves.toBeUndefined()
})

test("artifact cleanup failure leaves a durable retry queue", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const { root } = await createSessions(tmp.path)

  const artifactPath = await runLcm(
    Effect.gen(function* () {
      const conversationID = yield* getOrCreateConversation({ sessionID: root.id, dataDir })
      const artifact = yield* Effect.promise(() =>
        writeLcmArtifact({ artifactRoot: layout.artifactsDir, bytes: Buffer.from("retry delete artifact", "utf8") }),
      )
      yield* dbExec(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            artifact_storage_kind,
            artifact_path,
            artifact_byte_count,
            artifact_content_sha256,
            created_at_ms,
            updated_at_ms
          )
          VALUES ('file_m05_retry_delete', $1, 'inline', 'file', $2, $3, $4, 1777500000000, 1777500000000)
        `,
        [conversationID, artifact.artifactPath, artifact.byteCount, artifact.sha256],
        "sync",
      )
      return artifact.artifactPath
    }),
  )

  const artifactTarget = path.join(layout.artifactsDir, artifactPath)
  await fs.rm(artifactTarget, { force: true })
  await fs.mkdir(artifactTarget, { recursive: true })

  await expect(runLcm(handleSessionDeleted({ sessionID: root.id, recursive: true, dataDir }))).rejects.toMatchObject({
    diagnosticCode: expect.stringContaining("lcm_cleanup_artifact_remove_failed"),
  })

  const failedState = await runLcm(
    Effect.gen(function* () {
      yield* ensureLcmDbReady({ dataDir })
      return yield* dbQuery<{ conversations: number; queued: number; attempts: number }>(
        `
          SELECT
            (SELECT COUNT(*)::int FROM lcm_conversations) AS conversations,
            (SELECT COUNT(*)::int FROM lcm_artifact_cleanup_queue) AS queued,
            (SELECT COALESCE(MAX(attempt_count), 0)::int FROM lcm_artifact_cleanup_queue) AS attempts
        `,
      )
    }),
  )
  expect(failedState[0]).toEqual({ conversations: 0, queued: 1, attempts: 1 })

  await fs.rm(artifactTarget, { recursive: true, force: true })
  await runLcm(handleSessionDeleted({ sessionID: root.id, recursive: true, dataDir }))
  const retriedState = await runLcm(
    Effect.gen(function* () {
      yield* ensureLcmDbReady({ dataDir })
      return yield* dbQuery<{ queued: number }>("SELECT COUNT(*)::int AS queued FROM lcm_artifact_cleanup_queue")
    }),
  )
  expect(retriedState[0]?.queued).toBe(0)
})

test("capabilities surface locked and corrupt DB states without activating LCM", async () => {
  function stubLayer(status: LcmDbStatus) {
    const safeError = status.safeError ?? createDbLockedError()
    return Layer.succeed(
      LcmDb.Service,
      LcmDb.Service.of({
        getStatus: () => Effect.succeed(status),
        initialize: () => Effect.succeed(status),
        execute: () => Effect.fail(safeError),
        executeForeground: () => Effect.fail(safeError),
        close: () => Effect.void,
      }),
    )
  }

  const lockedError = createDbLockedError({ diagnosticCode: "lcm_m05_locked_fixture" })
  const lockedStatus: LcmDbStatus = {
    status: "locked",
    dataDir: "/tmp/lcm-locked",
    schemaVersion: 4,
    safeError: lockedError,
  }
  const locked = await Effect.runPromise(
    getCapabilities({ sessionID: "session_locked", strategy: "upward", dataDir: "/tmp/lcm-locked" }).pipe(
      Effect.provide(stubLayer(lockedStatus)),
    ),
  )
  expect(locked).toMatchObject({
    lifecycleState: "db_unavailable",
    dbReady: false,
    lcmActive: false,
    safeError: {
      code: "db_locked",
      diagnosticCode: "lcm_m05_locked_fixture",
    },
  })

  const corruptError = createDbCorruptError({ diagnosticCode: "lcm_m05_corrupt_fixture" })
  const corruptStatus: LcmDbStatus = {
    status: "corrupt",
    dataDir: "/tmp/lcm-corrupt",
    schemaVersion: 4,
    safeError: corruptError,
  }
  const runtimeLayer = LcmRuntime.layer.pipe(Layer.provide(stubLayer(corruptStatus)), Layer.provide(configLayer({})))
  const corrupt = await Effect.runPromise(
    LcmRuntime.Service.use((svc) => svc.getCapabilities({ sessionID: "session_corrupt" })).pipe(
      Effect.provide(runtimeLayer),
    ),
  )
  expect(corrupt).toMatchObject({
    lifecycleState: "db_unavailable",
    dbReady: false,
    lcmActive: false,
    safeError: {
      code: "db_corrupt",
      diagnosticCode: "lcm_m05_corrupt_fixture",
    },
  })

  const preflightInput = {
    sessionID: "session_preflight_locked",
    providerID: "provider_m17",
    modelID: "model_m17",
    reason: "prompt" as const,
    renderOptions: {
      providerID: "provider_m17",
      modelID: "model_m17",
      providerMediaCapability: "text_only" as const,
      stripMedia: false,
      taskCapabilityClass: "root" as const,
    },
  }
  const lockedRuntimeLayer = LcmRuntime.layer.pipe(
    Layer.provide(stubLayer(lockedStatus)),
    Layer.provide(configLayer({})),
  )
  const lockedPreflight = await Effect.runPromise(
    LcmRuntime.Service.use((svc) => svc.preflightBeforeModel(preflightInput)).pipe(Effect.provide(lockedRuntimeLayer)),
  )
  expect(lockedPreflight).toMatchObject({
    sessionID: "session_preflight_locked",
    lifecycleState: "db_unavailable",
    canProceed: false,
    safeError: {
      code: "db_locked",
      diagnosticCode: "lcm_m05_locked_fixture",
    },
  })
  expect(lockedPreflight.conversationID).toBeUndefined()

  const corruptPreflight = await Effect.runPromise(
    LcmRuntime.Service.use((svc) =>
      svc.preflightBeforeModel({ ...preflightInput, sessionID: "session_preflight_corrupt" }),
    ).pipe(Effect.provide(runtimeLayer)),
  )
  expect(corruptPreflight).toMatchObject({
    sessionID: "session_preflight_corrupt",
    lifecycleState: "db_unavailable",
    canProceed: false,
    safeError: {
      code: "db_corrupt",
      diagnosticCode: "lcm_m05_corrupt_fixture",
    },
  })
  expect(corruptPreflight.conversationID).toBeUndefined()
})
