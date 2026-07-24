// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import { tmpdir } from "../fixture/fixture"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { getLcmMigrations, getLcmProductionSchemaVersion } from "../../src/session/lcm/migrations"
import { createLcmPGlite } from "../../src/session/lcm/pglite-assets"
import type { LcmDbRequest, OperationID } from "../../src/session/lcm/types"

const schemaVersion = getLcmProductionSchemaVersion()

function operationID(suffix: string): OperationID {
  return `op_migration_${suffix}` as OperationID
}

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">): Omit<LcmDbRequest<T>, "lane"> {
  return {
    operationID: operationID("test"),
    purpose: "migration",
    run: input.run,
  }
}

function initInput(dataDir: string) {
  return {
    dataDir,
    runtimeMode: "source" as const,
    schemaVersion,
  }
}

const requiredTables = [
  "lcm_artifact_cleanup_queue",
  "lcm_context_item_consumption",
  "lcm_context_items",
  "lcm_context_snapshots",
  "lcm_conversations",
  "lcm_deferred_jobs",
  "lcm_id_aliases",
  "lcm_large_files",
  "lcm_map_items",
  "lcm_map_runs",
  "lcm_message_parts",
  "lcm_messages",
  "lcm_migrations",
  "lcm_provider_request_snapshot_items",
  "lcm_provider_request_snapshots",
  "lcm_provider_transform_overheads",
  "lcm_summaries",
  "lcm_summary_lineage_pointers",
  "lcm_summary_messages",
  "lcm_summary_parents",
  "lcm_usage_records",
]

const requiredIndexes = [
  "lcm_artifact_cleanup_queue_path_unique",
  "lcm_artifact_cleanup_queue_pkey",
  "lcm_artifact_cleanup_queue_updated_idx",
  "lcm_context_item_consumption_message_idx",
  "lcm_context_item_consumption_pkey",
  "lcm_context_item_consumption_snapshot_idx",
  "lcm_context_items_active_cue_target_idx",
  "lcm_context_items_conversation_cue_unique",
  "lcm_context_items_conversation_order_unique",
  "lcm_context_items_cue_generation_idx",
  "lcm_context_items_cue_id_idx",
  "lcm_context_items_cue_superseded_generation_idx",
  "lcm_context_items_file_idx",
  "lcm_context_items_message_idx",
  "lcm_context_items_pkey",
  "lcm_context_items_pointer_idx",
  "lcm_context_items_summary_idx",
  "lcm_context_items_type_order_idx",
  "lcm_context_snapshots_conversation_created_idx",
  "lcm_context_snapshots_pkey",
  "lcm_conversations_lifecycle_updated_idx",
  "lcm_conversations_parent_conversation_id_idx",
  "lcm_conversations_pkey",
  "lcm_conversations_root_conversation_id_idx",
  "lcm_conversations_scope_idx",
  "lcm_conversations_source_session_id_unique",
  "lcm_deferred_jobs_conversation_status_idx",
  "lcm_deferred_jobs_pkey",
  "lcm_deferred_jobs_session_status_next_idx",
  "lcm_id_aliases_canonical_idx",
  "lcm_id_aliases_conversation_kind_idx",
  "lcm_id_aliases_pkey",
  "lcm_large_files_artifact_created_idx",
  "lcm_large_files_conversation_source_created_idx",
  "lcm_large_files_exploration_status_idx",
  "lcm_large_files_file_conversation_idx",
  "lcm_large_files_path_fingerprint_idx",
  "lcm_large_files_pkey",
  "lcm_map_items_claim_idx",
  "lcm_map_items_phase_idx",
  "lcm_map_items_pkey",
  "lcm_map_items_status_lease_idx",
  "lcm_map_runs_conversation_created_idx",
  "lcm_map_runs_parent_status_idx",
  "lcm_map_runs_pkey",
  "lcm_map_runs_request_fingerprint_idx",
  "lcm_map_runs_status_lease_idx",
  "lcm_map_runs_tool_call_idx",
  "lcm_message_parts_content_file_id_idx",
  "lcm_message_parts_order_idx",
  "lcm_message_parts_pkey",
  "lcm_message_parts_search_text_trgm_gin",
  "lcm_message_parts_source_part_id_unique",
  "lcm_message_parts_source_part_key_unique",
  "lcm_messages_conversation_order_idx",
  "lcm_messages_conversation_source_message_unique",
  "lcm_messages_pkey",
  "lcm_messages_source_session_message_idx",
  "lcm_migrations_pkey",
  "lcm_provider_request_snapshot_items_context_idx",
  "lcm_provider_request_snapshot_items_message_idx",
  "lcm_provider_request_snapshot_items_pkey",
  "lcm_provider_request_snapshots_conversation_status_expiry_idx",
  "lcm_provider_request_snapshots_cue_ids_gin_idx",
  "lcm_provider_request_snapshots_operation_idx",
  "lcm_provider_request_snapshots_pkey",
  "lcm_provider_transform_overheads_pkey",
  "lcm_provider_transform_overheads_updated_idx",
  "lcm_summaries_content_text_trgm_gin",
  "lcm_summaries_conversation_type_created_idx",
  "lcm_summaries_conversation_type_level_created_idx",
  "lcm_summaries_pkey",
  "lcm_summary_lineage_pointers_conversation_summary_idx",
  "lcm_summary_lineage_pointers_pkey",
  "lcm_summary_lineage_pointers_root_idx",
  "lcm_summary_messages_message_idx",
  "lcm_summary_messages_pkey",
  "lcm_summary_messages_summary_order_idx",
  "lcm_summary_parents_parent_idx",
  "lcm_summary_parents_pkey",
  "lcm_summary_parents_summary_order_idx",
  "lcm_usage_records_conversation_created_idx",
  "lcm_usage_records_job_idx",
  "lcm_usage_records_pkey",
  "lcm_usage_records_session_purpose_created_idx",
]

test("lcm:migration:smoke creates the current schema and reopens it unchanged", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm-current-schema")
  const worker = createLcmDbWorker()
  try {
    const status = await worker.initialize(initInput(dataDir))
    expect(status.status).toBe("ready")
    expect(status.schemaVersion).toBe(2)

    const migrations = await getLcmMigrations()
    expect(migrations.map((migration) => [migration.version, migration.name])).toEqual([
      [1, "current_schema"],
      [2, "runtime_owned_maps"],
    ])

    const shape = await worker.executeForeground(
      request({
        run: async (db) => {
          const typedDb = db as PGlite
          const tables = (
            await typedDb.query<{ table_name: string }>(
              `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                  AND table_name LIKE 'lcm_%'
                ORDER BY table_name
              `,
            )
          ).rows.map((row) => row.table_name)
          const indexes = (
            await typedDb.query<{ indexname: string }>(
              `
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname LIKE 'lcm_%'
                ORDER BY indexname
              `,
            )
          ).rows.map((row) => row.indexname)
          const snapshotColumns = (
            await typedDb.query<{ column_name: string; is_nullable: string }>(
              `
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'lcm_context_snapshots'
                ORDER BY ordinal_position
              `,
            )
          ).rows
          const usageColumns = (
            await typedDb.query<{ column_name: string; is_nullable: string }>(
              `
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'lcm_usage_records'
                ORDER BY ordinal_position
              `,
            )
          ).rows
          const mapRunColumns = (
            await typedDb.query<{ column_name: string; is_nullable: string }>(
              `
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'lcm_map_runs'
                ORDER BY ordinal_position
              `,
            )
          ).rows
          const mapItemColumns = (
            await typedDb.query<{ column_name: string; is_nullable: string }>(
              `
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'lcm_map_items'
                ORDER BY ordinal_position
              `,
            )
          ).rows
          const lifecycleCheck = (
            await typedDb.query<{ definition: string }>(
              `
                SELECT pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE conname = 'lcm_conversations_lifecycle_state_check'
              `,
            )
          ).rows[0]?.definition
          const migrationRows = (
            await typedDb.query<{ version: number; name: string; checksum: string }>(
              "SELECT version, name, checksum FROM lcm_migrations ORDER BY version",
            )
          ).rows
          return {
            tables,
            indexes,
            snapshotColumns,
            usageColumns,
            mapRunColumns,
            mapItemColumns,
            lifecycleCheck,
            migrationRows,
          }
        },
      }),
    )

    expect(shape.tables).toEqual(requiredTables)
    expect(shape.tables).not.toContain("lcm_legacy_conversion_operations")
    expect(shape.indexes).toEqual(requiredIndexes)
    expect(shape.snapshotColumns).toEqual(
      expect.arrayContaining([
        { column_name: "restore_manifest_json", is_nullable: "NO" },
        { column_name: "soft_backlog_tokens", is_nullable: "YES" },
        { column_name: "soft_backlog_item_count", is_nullable: "YES" },
      ]),
    )
    expect(shape.usageColumns).toEqual(
      expect.arrayContaining([
        { column_name: "maintenance_status", is_nullable: "YES" },
        { column_name: "maintenance_safe_code", is_nullable: "YES" },
        { column_name: "maintenance_diagnostic_code", is_nullable: "YES" },
        { column_name: "maintenance_safe_message", is_nullable: "YES" },
      ]),
    )
    expect(shape.mapRunColumns).toEqual(
      expect.arrayContaining([
        { column_name: "parent_session_id", is_nullable: "YES" },
        { column_name: "submitting_agent", is_nullable: "YES" },
        { column_name: "parent_directory", is_nullable: "YES" },
        { column_name: "provider_capacity_class", is_nullable: "YES" },
        { column_name: "started_at_ms", is_nullable: "YES" },
        { column_name: "last_progress_at_ms", is_nullable: "YES" },
      ]),
    )
    expect(shape.mapItemColumns).toEqual(
      expect.arrayContaining([
        { column_name: "execution_phase", is_nullable: "YES" },
        { column_name: "phase_started_at_ms", is_nullable: "YES" },
        { column_name: "active_ms", is_nullable: "NO" },
      ]),
    )
    expect(shape.lifecycleCheck).toContain("legacy_read_only")
    expect(shape.lifecycleCheck).not.toContain("conversion_in_progress")
    expect(shape.lifecycleCheck).not.toContain("conversion_failed")
    expect(shape.migrationRows).toHaveLength(2)
    expect(shape.migrationRows[0]).toMatchObject({ version: 1, name: "current_schema" })
    expect(shape.migrationRows[0]!.checksum).toHaveLength(64)
    expect(shape.migrationRows[1]).toMatchObject({ version: 2, name: "runtime_owned_maps" })
    expect(shape.migrationRows[1]!.checksum).toHaveLength(64)

    await worker.close()
    const reopened = createLcmDbWorker()
    try {
      const reopenedStatus = await reopened.initialize(initInput(dataDir))
      expect(reopenedStatus.status).toBe("ready")
      const rows = await reopened.executeForeground(
        request({
          run: async (db) => {
            const typedDb = db as PGlite
            return (
              await typedDb.query<{ version: number; name: string }>(
                "SELECT version, name FROM lcm_migrations ORDER BY version",
              )
            ).rows
          },
        }),
      )
      expect(rows).toEqual([
        { version: 1, name: "current_schema" },
        { version: 2, name: "runtime_owned_maps" },
      ])
    } finally {
      await reopened.close()
    }
  } finally {
    await worker.close()
  }
})

test("runtime-owned map migration retires only unfinished alpha agentic work", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm-map-upgrade")
  const layout = resolveLcmDbLayout(dataDir)
  await fs.mkdir(layout.pgliteDir, { recursive: true })
  const migrations = await getLcmMigrations()
  const initial = migrations[0]!
  const db = await createLcmPGlite({ dataDir: layout.pgliteDir })
  try {
    await db.exec(initial.sql)
    await db.query("INSERT INTO lcm_migrations (version, name, applied_at_ms, checksum) VALUES ($1, $2, $3, $4)", [
      initial.version,
      initial.name,
      1_700_000_000_000,
      initial.checksum,
    ])
    await db.query(
      `
        INSERT INTO lcm_conversations (
          conversation_id, source_session_id, root_conversation_id, project_id,
          session_directory, lifecycle_state, schema_version, feature_version,
          created_at_ms, updated_at_ms
        )
        VALUES ($1, $2, $1, $3, $4, 'lcm_active', 1, 1, $5, $5)
      `,
      ["conv_map_upgrade", "session_map_upgrade", "project_map_upgrade", tmp.path, 1_700_000_000_000],
    )
    await db.query(
      `
        INSERT INTO lcm_large_files (
          file_id, conversation_id, source_kind, created_at_ms, updated_at_ms
        )
        VALUES ($1, $2, 'map_input', $3, $3)
      `,
      ["file_map_upgrade_input", "conv_map_upgrade", 1_700_000_000_000],
    )
    for (const [mapID, status] of [
      ["map_upgrade_running", "running"],
      ["map_upgrade_completed", "completed"],
    ] as const) {
      await db.query(
        `
          INSERT INTO lcm_map_runs (
            map_id, conversation_id, tool_kind, status, request_fingerprint,
            input_file_id, worker_count, prompt_text, prompt_sha256,
            model_selection_json, agentic_mode, schema_json, schema_sha256,
            created_at_ms, updated_at_ms
          )
          VALUES (
            $1, $2, 'agentic_map', $3, $4,
            $5, 1, 'square', 'prompt-sha',
            '{"selector":"default","providerID":"ollama","modelID":"qwen"}'::jsonb,
            'read_only', '{"type":"object"}'::jsonb, 'schema-sha',
            $6, $6
          )
        `,
        [mapID, "conv_map_upgrade", status, `${mapID}-fingerprint`, "file_map_upgrade_input", 1_700_000_000_000],
      )
      await db.query(
        `
          INSERT INTO lcm_map_items (
            map_id, item_index, status, attempts, output_json, created_at_ms, updated_at_ms
          )
          VALUES ($1, 0, $2, 1, $3::jsonb, $4, $4)
        `,
        [
          mapID,
          status === "completed" ? "completed" : "running",
          status === "completed" ? '{"square":49}' : null,
          1_700_000_000_000,
        ],
      )
    }
  } finally {
    await db.close()
  }

  const worker = createLcmDbWorker()
  try {
    const status = await worker.initialize(initInput(dataDir))
    expect(status.status).toBe("ready")
    const rows = await worker.executeForeground(
      request({
        run: async (database) => {
          const typedDb = database as PGlite
          return (
            await typedDb.query<{
              map_id: string
              run_status: string
              item_status: string
              parent_session_id: string
              execution_phase: string
              diagnostic_code: string | null
            }>(
              `
                SELECT
                  run.map_id,
                  run.status AS run_status,
                  item.status AS item_status,
                  run.parent_session_id,
                  item.execution_phase,
                  run.safe_error_json->>'diagnosticCode' AS diagnostic_code
                FROM lcm_map_runs run
                JOIN lcm_map_items item ON item.map_id = run.map_id
                ORDER BY run.map_id
              `,
            )
          ).rows
        },
      }),
    )
    expect(rows).toEqual([
      {
        map_id: "map_upgrade_completed",
        run_status: "completed",
        item_status: "completed",
        parent_session_id: "session_map_upgrade",
        execution_phase: "terminal",
        diagnostic_code: null,
      },
      {
        map_id: "map_upgrade_running",
        run_status: "failed",
        item_status: "failed",
        parent_session_id: "session_map_upgrade",
        execution_phase: "terminal",
        diagnostic_code: "lcm_map_alpha_restart_required",
      },
    ])
  } finally {
    await worker.close()
  }
})

test("pre-beta LCM schemas are unsupported instead of migrated", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm-pre-beta-schema")
  const layout = resolveLcmDbLayout(dataDir)
  await fs.mkdir(layout.pgliteDir, { recursive: true })
  const db = await createLcmPGlite({ dataDir: layout.pgliteDir })
  try {
    await db.exec(`
      CREATE TABLE lcm_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at_ms bigint NOT NULL
      );
    `)
  } finally {
    await db.close()
  }

  const worker = createLcmDbWorker()
  try {
    const status = await worker.initialize(initInput(dataDir))
    expect(status.status).toBe("corrupt")
    expect(status.safeError).toMatchObject({
      code: "db_migration_failed",
      diagnosticCode: "lcm_unsupported_pre_beta_schema",
    })
  } finally {
    await worker.close()
  }
})
