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
  "lcm_map_items_pkey",
  "lcm_map_items_status_lease_idx",
  "lcm_map_runs_conversation_created_idx",
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

test("lcm:migration:smoke creates the current pre-beta schema baseline and reopens it unchanged", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm-current-schema")
  const worker = createLcmDbWorker()
  try {
    const status = await worker.initialize(initInput(dataDir))
    expect(status.status).toBe("ready")
    expect(status.schemaVersion).toBe(1)

    const migrations = await getLcmMigrations()
    expect(migrations.map((migration) => [migration.version, migration.name])).toEqual([[1, "current_schema"]])

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
          return { tables, indexes, snapshotColumns, usageColumns, lifecycleCheck, migrationRows }
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
    expect(shape.lifecycleCheck).toContain("legacy_read_only")
    expect(shape.lifecycleCheck).not.toContain("conversion_in_progress")
    expect(shape.lifecycleCheck).not.toContain("conversion_failed")
    expect(shape.migrationRows).toHaveLength(1)
    expect(shape.migrationRows[0]).toMatchObject({ version: 1, name: "current_schema" })
    expect(shape.migrationRows[0]!.checksum).toHaveLength(64)

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
      expect(rows).toEqual([{ version: 1, name: "current_schema" }])
    } finally {
      await reopened.close()
    }
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
