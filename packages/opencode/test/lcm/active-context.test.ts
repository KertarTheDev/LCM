// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import {
  LCM_CONTEXT_RESTORE_MANIFEST_VERSION,
  Service as LcmContextService,
  layer as lcmContextLayer,
  writeContextSnapshot,
} from "../../src/session/lcm/context"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { rowToItem } from "../../src/session/lcm/context-core"
import { loadSummaryMetadata, loadVisibilityProvenance } from "../../src/session/lcm/context-render"
import { loadContextRows } from "../../src/session/lcm/context-state"
import type { LcmDbRequest, LcmSafeError, OperationID, SessionID } from "../../src/session/lcm/types"
import { LCM_HARNESS_SENTINELS, LCM_RECOVERY_FIXTURE_IDS, seedRecoveryConversationFixture } from "./harness"

function operationID(suffix: string): OperationID {
  return `op_m08_${suffix}` as OperationID
}

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">): Omit<LcmDbRequest<T>, "lane"> {
  return {
    operationID: operationID("test"),
    purpose: "debug_support",
    run: input.run,
  }
}

async function initialize(dataDir: string) {
  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir,
    runtimeMode: "source",
    schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
    smokeMode: true,
  })
  expect(status.status).toBe("ready")
  return worker
}

function contextLayer(worker: ReturnType<typeof createLcmDbWorker>) {
  const dbLayer = Layer.succeed(
    LcmDb.Service,
    LcmDb.Service.of({
      getStatus: () => Effect.sync(() => worker.getStatus()),
      initialize: (input) => Effect.promise(() => worker.initialize(input)),
      execute: (input) =>
        Effect.tryPromise({
          try: () => worker.execute(input),
          catch: (error) => error as LcmSafeError,
        }),
      executeForeground: (input) =>
        Effect.tryPromise({
          try: () => worker.executeForeground(input),
          catch: (error) => error as LcmSafeError,
        }),
      close: () => Effect.promise(() => worker.close()),
    }),
  )
  return lcmContextLayer.pipe(Layer.provide(dbLayer))
}

function runContext<A, E>(
  worker: ReturnType<typeof createLcmDbWorker>,
  effect: Effect.Effect<A, E, LcmContextService>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(contextLayer(worker))))
}

async function seed(worker: ReturnType<typeof createLcmDbWorker>) {
  await worker.executeForeground(
    request({
      run: async (db) => {
        await seedRecoveryConversationFixture(db as PGlite)
      },
    }),
  )
}

async function query<T>(worker: ReturnType<typeof createLcmDbWorker>, sql: string, params: unknown[] = []) {
  return worker.executeForeground(
    request({
      run: async (db) => (await (db as PGlite).query<T>(sql, params)).rows,
    }),
  )
}

function jsonValue(value: unknown) {
  if (typeof value !== "string") return value
  return JSON.parse(value)
}

async function writeSnapshotAndDeleteContext(worker: ReturnType<typeof createLcmDbWorker>) {
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await writeContextSnapshot({
          db: typedDb,
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          reason: "before-condensation",
          nowMs: 1_777_500_007_050,
        })
        await typedDb.query(
          `
            INSERT INTO lcm_messages (
              message_row_id,
              conversation_id,
              source_session_id,
              source_message_id,
              role,
              message_order,
              created_at_ms,
              metadata_json
            )
            VALUES ('msg_m08_snapshot_raw', $1, $2, 'source_msg_m08_snapshot_raw', 'user', 2,
                    1777500007900, '{}'::jsonb)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.sessionID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_message_parts (
              part_row_id,
              message_row_id,
              conversation_id,
              source_part_key,
              part_order,
              part_kind,
              text_content,
              content_sha256,
              search_text,
              created_at_ms
            )
            VALUES ('part_m08_snapshot_raw', 'msg_m08_snapshot_raw', $1,
                    'derived:source_msg_m08_snapshot_raw:1:text:i0s0c0', 1, 'text', 'snapshot raw source',
                    repeat('d', 64), 'snapshot raw source', 1777500007900)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            UPDATE lcm_context_items
            SET message_row_id = 'msg_m08_snapshot_raw'
            WHERE conversation_id = $1
              AND context_item_id = $2
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.rawContextID],
        )
        await writeContextSnapshot({
          db: typedDb,
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          reason: "fixture",
          nowMs: 1_777_500_008_000,
        })
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )
}

async function mutateLatestManifest(
  worker: ReturnType<typeof createLcmDbWorker>,
  mutate: (manifest: Record<string, unknown>) => unknown,
) {
  await worker.executeForeground(
    request({
      run: async (db) => {
        const snapshot = (
          await (db as PGlite).query<{ snapshot_id: string; restore_manifest_json: unknown }>(
            `
              SELECT snapshot_id, restore_manifest_json
              FROM lcm_context_snapshots
              WHERE conversation_id = $1
              ORDER BY created_at_ms DESC, snapshot_id DESC
              LIMIT 1
            `,
            [LCM_RECOVERY_FIXTURE_IDS.conversationID],
          )
        ).rows[0]
        if (!snapshot) throw new Error("missing snapshot")
        const manifest = jsonValue(snapshot.restore_manifest_json) as Record<string, unknown>
        const next = mutate(manifest)
        await (db as PGlite).query(
          "UPDATE lcm_context_snapshots SET restore_manifest_json = $2::jsonb WHERE snapshot_id = $1",
          [snapshot.snapshot_id, JSON.stringify(next)],
        )
      },
    }),
  )
}

test("valid current active context is retained and snapshotted", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "test" }),
    ),
  )
  expect(result).toMatchObject({ status: "healthy", itemsRebuilt: 0, lifecycleState: "passive_synced" })

  const state = await query<{
    context_count: number
    snapshot_count: number
    manifest_version: string
  }>(
    worker,
    `
      SELECT
        (SELECT count(*)::int FROM lcm_context_items WHERE conversation_id = $1) AS context_count,
        (SELECT count(*)::int FROM lcm_context_snapshots WHERE conversation_id = $1) AS snapshot_count,
        (SELECT restore_manifest_json->>'schemaVersion'
         FROM lcm_context_snapshots
         WHERE conversation_id = $1
         ORDER BY created_at_ms DESC, snapshot_id DESC
         LIMIT 1) AS manifest_version
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(state[0]).toEqual({
    context_count: 2,
    snapshot_count: 1,
    manifest_version: LCM_CONTEXT_RESTORE_MANIFEST_VERSION,
  })
  await worker.close()
})

test("rebuild snapshots the caller-selected strategy for healthy context", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({
        conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
        reason: "dolt-strategy",
        strategy: "dolt",
      }),
    ),
  )
  expect(result).toMatchObject({ status: "healthy", itemsRebuilt: 0 })

  const snapshots = await query<{ strategy: string }>(
    worker,
    `
      SELECT strategy
      FROM lcm_context_snapshots
      WHERE conversation_id = $1
      ORDER BY created_at_ms DESC, snapshot_id DESC
      LIMIT 1
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(snapshots[0]).toEqual({ strategy: "dolt" })
  await worker.close()
})

test("rebuild restores the newest valid snapshot manifest atomically", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await writeSnapshotAndDeleteContext(worker)

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "restore" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 2 })

  const rows = await query<{ context_item_id: string; item_order: number; item_type: string }>(
    worker,
    `
      SELECT context_item_id, item_order, item_type
      FROM lcm_context_items
      WHERE conversation_id = $1
      ORDER BY item_order
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([
    { context_item_id: LCM_RECOVERY_FIXTURE_IDS.rawContextID, item_order: 1, item_type: "raw_message" },
    { context_item_id: LCM_RECOVERY_FIXTURE_IDS.summaryContextID, item_order: 2, item_type: "summary" },
  ])
  await worker.close()
})

test("durable rebuild activates only archived summary roots and keeps descendant messages covered", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES ('sum_m08_bindle_root', $1, 'bindle', 'root bindle', 20, 8, 1,
                    'summary-condense-v2', 'dolt', 'accepted', 'none', 1777500007100)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
            VALUES ('sum_m08_bindle_root', $1, 1)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.summaryID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_lineage_pointers (
              pointer_id,
              conversation_id,
              summary_id,
              root_summary_id,
              pointer_kind,
              created_at_ms
            )
            VALUES ('ptr_m08_bindle_root', $1, 'sum_m08_bindle_root', 'sum_m08_bindle_root',
                    'archive_stub', 1777500007200)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "lineage-roots" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 1 })
  const rows = await query<{
    item_type: string
    summary_id: string | null
    pointer_id: string | null
    message_row_id: string | null
  }>(
    worker,
    `
      SELECT item_type, summary_id, pointer_id, message_row_id
      FROM lcm_context_items
      WHERE conversation_id = $1
      ORDER BY item_order
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([
    {
      item_type: "archive_stub",
      summary_id: "sum_m08_bindle_root",
      pointer_id: "ptr_m08_bindle_root",
      message_row_id: null,
    },
  ])
  const lineage = await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        const contextRows = await loadContextRows(typedDb, LCM_RECOVERY_FIXTURE_IDS.conversationID)
        const metadata = await loadSummaryMetadata(typedDb, LCM_RECOVERY_FIXTURE_IDS.conversationID, contextRows)
        const unrelatedVisibility = await loadVisibilityProvenance({
          db: typedDb,
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          contextItems: contextRows.map(rowToItem),
          hiddenSourceMessageIDs: ["source_msg_unrelated"],
        })
        const hiddenVisibility = await loadVisibilityProvenance({
          db: typedDb,
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          contextItems: contextRows.map(rowToItem),
          hiddenSourceMessageIDs: ["source_msg_harness_user"],
        })
        const root = metadata.get("sum_m08_bindle_root")
        return {
          coveredMessageRowIDs: root ? [...root.coveredMessageRowIDs] : [],
          coveredSourceChronology: root?.coveredSourceChronology,
          unrelatedHiddenContextItemIDs: [...unrelatedVisibility.hiddenContextItemIDs],
          unrelatedMissingContextItemIDs: [...unrelatedVisibility.missingContextItemIDs],
          hiddenContextItemIDs: [...hiddenVisibility.hiddenContextItemIDs],
          contextItemIDs: contextRows.map((row) => row.context_item_id),
        }
      },
    }),
  )
  expect(lineage).toEqual({
    coveredMessageRowIDs: [LCM_RECOVERY_FIXTURE_IDS.messageRowID],
    coveredSourceChronology: 1,
    unrelatedHiddenContextItemIDs: [],
    unrelatedMissingContextItemIDs: [],
    hiddenContextItemIDs: lineage.contextItemIDs,
    contextItemIDs: lineage.contextItemIDs,
  })
  await worker.close()
})

test("snapshot restore skips manifests that predate durable source", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await writeContextSnapshot({
          db: typedDb,
          conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
          reason: "before-later-source",
          nowMs: 1_777_500_008_000,
        })
        await typedDb.query(
          `
            INSERT INTO lcm_messages (
              message_row_id,
              conversation_id,
              source_session_id,
              source_message_id,
              role,
              message_order,
              created_at_ms,
              metadata_json
            )
            VALUES ('msg_m08_later_durable', $1, $2, 'source_msg_m08_later', 'user', 2,
                    1777500008100, '{}'::jsonb)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.sessionID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_message_parts (
              part_row_id,
              message_row_id,
              conversation_id,
              source_part_key,
              part_order,
              part_kind,
              text_content,
              content_sha256,
              search_text,
              created_at_ms
            )
            VALUES ('part_m08_later_durable', 'msg_m08_later_durable', $1,
                    'derived:source_msg_m08_later:1:text:i0s0c0', 1, 'text', 'later durable source',
                    repeat('c', 64), 'later durable source', 1777500008100)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "stale-snapshot" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 2 })
  const rows = await query<{ item_type: string; message_row_id: string | null; summary_id: string | null }>(
    worker,
    `
      SELECT item_type, message_row_id, summary_id
      FROM lcm_context_items
      WHERE conversation_id = $1
      ORDER BY item_order
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([
    {
      item_type: "summary",
      message_row_id: null,
      summary_id: LCM_RECOVERY_FIXTURE_IDS.summaryID,
    },
    {
      item_type: "raw_message",
      message_row_id: "msg_m08_later_durable",
      summary_id: null,
    },
  ])
  await worker.close()
})

test("durable rebuild ignores finalized metadata-only messages without raw parts", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
          `
            INSERT INTO lcm_messages (
              message_row_id,
              conversation_id,
              source_session_id,
              source_message_id,
              role,
              message_order,
              created_at_ms,
              metadata_json
            )
            VALUES ('msg_m08_metadata_only', $1, $2, 'source_msg_m08_metadata_only', 'assistant', 2,
                    1777500008125, '{"error":{"name":"MessageAbortedError"}}'::jsonb)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.sessionID],
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "metadata-only" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", lifecycleState: "passive_synced", itemsRebuilt: 1 })
  const rows = await query<{ item_type: string; summary_id: string | null; message_row_id: string | null }>(
    worker,
    `
      SELECT item_type, summary_id, message_row_id
      FROM lcm_context_items
      WHERE conversation_id = $1
      ORDER BY item_order
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([
    {
      item_type: "summary",
      summary_id: LCM_RECOVERY_FIXTURE_IDS.summaryID,
      message_row_id: null,
    },
  ])
  await worker.close()
})

test("durable rebuild fails closed when summary lineage has no active root", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES ('sum_m08_cycle_bindle', $1, 'bindle', 'cycle bindle', 20, 8, 1,
                    'summary-condense-v2', 'upward', 'accepted', 'none', 1777500008150)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
            VALUES
              ('sum_m08_cycle_bindle', $1, 1),
              ($1, 'sum_m08_cycle_bindle', 1)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.summaryID],
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "summary-cycle" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: {
      code: "recovery_required",
      diagnosticCode: "lcm_context_rebuild_summary_roots_missing",
    },
  })
  const rows = await query<{ count: number | string | bigint }>(
    worker,
    "SELECT count(*) AS count FROM lcm_context_items WHERE conversation_id = $1",
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(Number(rows[0]?.count ?? 0)).toBe(0)
  await worker.close()
})

test("durable rebuild fails closed when a rooted summary lineage contains a descendant cycle", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES
              ('sum_m08_cycle_parent', $1, 'bindle', 'cycle parent', 30, 9, 1,
               'summary-condense-v2', 'upward', 'accepted', 'none', 1777500008155),
              ('sum_m08_cycle_root', $1, 'bindle', 'cycle root', 40, 10, 2,
               'summary-condense-v2', 'upward', 'accepted', 'none', 1777500008156)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
            VALUES
              ('sum_m08_cycle_root', $1, 1),
              ($1, 'sum_m08_cycle_parent', 1),
              ('sum_m08_cycle_parent', $1, 1)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.summaryID],
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "rooted-cycle" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: {
      code: "recovery_required",
      diagnosticCode: "lcm_context_rebuild_summary_lineage_invalid",
    },
  })
  await worker.close()
})

test("durable rebuild fails closed when a disconnected summary cycle exists beside a valid root", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES
              ('sum_m08_disconnected_a', $1, 'bindle', 'disconnected a', 30, 9, 1,
               'summary-condense-v2', 'upward', 'accepted', 'none', 1777500008157),
              ('sum_m08_disconnected_b', $1, 'bindle', 'disconnected b', 30, 9, 1,
               'summary-condense-v2', 'upward', 'accepted', 'none', 1777500008158)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
            VALUES
              ('sum_m08_disconnected_a', 'sum_m08_disconnected_b', 1),
              ('sum_m08_disconnected_b', 'sum_m08_disconnected_a', 1)
          `,
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({
        conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
        reason: "disconnected-cycle",
      }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: {
      code: "recovery_required",
      diagnosticCode: "lcm_context_rebuild_summary_lineage_invalid",
    },
  })
  await worker.close()
})

test("durable rebuild fails closed when summary lineage exceeds the bounded depth", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            SELECT format('sum_m08_depth_%s', depth),
                   $1,
                   'bindle',
                   format('depth %s', depth),
                   30,
                   9,
                   depth + 1,
                   'summary-condense-v2',
                   'upward',
                   'accepted',
                   'none',
                   1777500008200 + depth
            FROM generate_series(0, 257) AS depth
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
            SELECT format('sum_m08_depth_%s', depth),
                   CASE
                     WHEN depth = 0 THEN $1
                     ELSE format('sum_m08_depth_%s', depth - 1)
                   END,
                   1
            FROM generate_series(0, 257) AS depth
          `,
          [LCM_RECOVERY_FIXTURE_IDS.summaryID],
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "summary-depth" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: {
      code: "recovery_required",
      diagnosticCode: "lcm_context_rebuild_summary_lineage_invalid",
    },
  })
  await worker.close()
})

test("durable rebuild fails closed instead of omitting an invalid active summary root", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES ('sum_m08_invalid_root', $1, 'sprig', 'invalid root', 20, 8, 1,
                    'summary-leaf-v2', 'upward', 'accepted', 'none', 1777500008160)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await typedDb.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "invalid-root" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: {
      code: "recovery_required",
      diagnosticCode: "lcm_context_rebuild_summary_roots_invalid",
    },
  })
  const rows = await query<{ count: number | string | bigint }>(
    worker,
    "SELECT count(*) AS count FROM lcm_context_items WHERE conversation_id = $1",
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(Number(rows[0]?.count ?? 0)).toBe(0)
  await worker.close()
})

test("retrieval cue validation rejects cyclic conversation ancestry", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
          `
            INSERT INTO lcm_conversations (
              conversation_id,
              source_session_id,
              parent_session_id,
              parent_conversation_id,
              root_conversation_id,
              project_id,
              workspace_id,
              session_directory,
              worktree_path,
              boundary_metadata_json,
              capability_class,
              lifecycle_state,
              schema_version,
              feature_version,
              created_at_ms,
              updated_at_ms
            )
            SELECT 'conv_m08_cycle_child',
                   'session_m08_cycle_child',
                   source_session_id,
                   conversation_id,
                   root_conversation_id,
                   project_id,
                   workspace_id,
                   session_directory,
                   worktree_path,
                   boundary_metadata_json,
                   'task_child',
                   lifecycle_state,
                   schema_version,
                   feature_version,
                   1777500008200,
                   1777500008200
            FROM lcm_conversations
            WHERE conversation_id = $1
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            UPDATE lcm_conversations
            SET parent_conversation_id = 'conv_m08_cycle_child',
                parent_session_id = 'session_m08_cycle_child'
            WHERE conversation_id = $1
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_context_items (
              context_item_id,
              conversation_id,
              item_order,
              item_type,
              cue_payload_json,
              cue_id,
              cue_lifecycle_state,
              cue_target_source_message_id,
              cue_generation_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES ('ctx_m08_cycle_cue', $1, 3, 'retrieval_cue',
                    '{"query":"safe","cueText":"safe","summaryIDs":[],"fileIDs":[],"messageRowIDs":[],
                      "partRowIDs":[],"tokenCount":1,"generatedAt":"2026-07-09T00:00:00.000Z"}'::jsonb,
                    'cue_m08_cycle', 'active', 'source_msg_harness_user', 'cuegen_m08_cycle',
                    1777500008300, 1777500008300)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID],
        )
      },
    }),
  )

  await expect(
    runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.getCurrentContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID }),
      ),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_retrieval_cue_ancestor_cycle",
  })
  await worker.close()
})

test("active-context rows stay ordered while raw-leaf assembly requires render dependencies", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)

  try {
    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) =>
          svc.assembleModelMessages({
            sessionID: LCM_RECOVERY_FIXTURE_IDS.sessionID as SessionID,
            conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
            targetCurrentUser: {
              sourceSessionID: LCM_RECOVERY_FIXTURE_IDS.sessionID as SessionID,
              sourceMessageID: "msg_active_context_current",
              promptOperationID: "op_active_context_current",
              visibilityBaseMessageID: "msg_active_context_current",
            },
            renderOptions: {
              providerMediaCapability: "unknown",
              stripMedia: false,
              modelID: "fake-model",
              providerID: "fake-provider",
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_raw_leaf_render_preparation_missing",
    })

    const rows = await query<{ item_order: number; item_type: string }>(
      worker,
      "SELECT item_order, item_type FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
      [LCM_RECOVERY_FIXTURE_IDS.conversationID],
    )
    expect(rows).toEqual([
      { item_order: 1, item_type: "raw_message" },
      { item_order: 2, item_type: "summary" },
    ])
  } finally {
    await worker.close()
  }
})

test("durable rebuild keeps valid summaries and standalone file markers without model calls", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
          `
            INSERT INTO lcm_large_files (
              file_id,
              conversation_id,
              source_kind,
              mime_type,
              preview_text,
              artifact_storage_kind,
              created_at_ms,
              updated_at_ms
            )
            VALUES (
              'file_m08_standalone_marker',
              $1,
              'inline',
              'text/plain',
              'bounded preview',
              'none',
              $2,
              $2
            )
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, 1_777_500_008_250],
        )
        await (db as PGlite).query(
          `
            INSERT INTO lcm_context_items (
              context_item_id,
              conversation_id,
              item_order,
              item_type,
              file_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES ('ctx_m08_standalone_marker', $1, 3, 'large_file_marker', 'file_m08_standalone_marker', $2, $2)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, 1_777_500_008_250],
        )
        await (db as PGlite).query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "durable-file" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 2 })
  const rows = await query<{ item_order: number; item_type: string }>(
    worker,
    "SELECT item_order, item_type FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([
    { item_order: 1, item_type: "summary" },
    { item_order: 2, item_type: "large_file_marker" },
  ])
  const summaryCount = await query<{ count: number }>(
    worker,
    "SELECT count(*)::int AS count FROM lcm_summaries WHERE conversation_id = $1",
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(summaryCount[0]?.count).toBe(1)
  await worker.close()
})

test("durable rebuild keeps archive stubs from lineage pointers without active rows", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
          `
            INSERT INTO lcm_summary_lineage_pointers (
              pointer_id,
              conversation_id,
              summary_id,
              root_summary_id,
              pointer_kind,
              created_at_ms
            )
            VALUES ('ptr_m08_archive_stub', $1, $2, $2, 'archive_stub', $3)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.summaryID, 1_777_500_008_500],
        )
        await (db as PGlite).query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "durable-archive" }),
    ),
  )
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 1 })
  const rows = await query<{ item_order: number; item_type: string; pointer_id: string | null }>(
    worker,
    "SELECT item_order, item_type, pointer_id FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(rows).toEqual([{ item_order: 1, item_type: "archive_stub", pointer_id: "ptr_m08_archive_stub" }])
  await worker.close()
})

const invalidManifestCases = [
  {
    name: "unknown version",
    mutate: (manifest: Record<string, unknown>) => ({ ...manifest, schemaVersion: "future-version" }),
  },
  {
    name: "missing required field",
    mutate: (manifest: Record<string, unknown>) => {
      const next = { ...manifest }
      delete next.snapshotID
      return next
    },
  },
  {
    name: "duplicate order",
    mutate: (manifest: Record<string, unknown>) => {
      const items = [...(manifest.items as Record<string, unknown>[])]
      items[1] = { ...items[1], itemOrder: 1 }
      return { ...manifest, items }
    },
  },
  {
    name: "item count mismatch",
    mutate: (manifest: Record<string, unknown>) => ({
      ...manifest,
      items: (manifest.items as unknown[]).slice(0, 1),
    }),
  },
  {
    name: "top-level metadata mismatch",
    mutate: (manifest: Record<string, unknown>) => ({ ...manifest, activeTokens: 999 }),
  },
  {
    name: "invalid reference shape",
    mutate: (manifest: Record<string, unknown>) => {
      const items = [...(manifest.items as Record<string, unknown>[])]
      const first = { ...items[0] }
      delete first.messageRowID
      items[0] = first
      return { ...manifest, items }
    },
  },
  {
    name: "stale reference",
    mutate: (manifest: Record<string, unknown>) => {
      const items = [...(manifest.items as Record<string, unknown>[])]
      items[1] = { ...items[1], summaryID: "sum_missing" }
      return { ...manifest, items }
    },
  },
  {
    name: "duplicate durable reference",
    mutate: (manifest: Record<string, unknown>) => {
      const items = [...(manifest.items as Record<string, unknown>[])]
      const first: Record<string, unknown> = {
        ...items[0],
        itemType: "summary",
        summaryID: LCM_RECOVERY_FIXTURE_IDS.summaryID,
      }
      delete first.messageRowID
      items[0] = first
      return { ...manifest, items }
    },
  },
  {
    name: "corrupt token metadata",
    mutate: (manifest: Record<string, unknown>) => {
      const items = [...(manifest.items as Record<string, unknown>[])]
      items[0] = { ...items[0], tokenCount: -1 }
      return { ...manifest, items }
    },
  },
]

for (const fixture of invalidManifestCases) {
  test(`context-snapshot-restore-manifest-v2 skips ${fixture.name} and falls back to durable rebuild`, async () => {
    await using tmp = await tmpdir()
    const worker = await initialize(path.join(tmp.path, "lcm"))
    await seed(worker)
    await writeSnapshotAndDeleteContext(worker)
    await mutateLatestManifest(worker, fixture.mutate)

    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: fixture.name }),
      ),
    )
    expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 2 })
    const rows = await query<{ item_order: number; item_type: string }>(
      worker,
      "SELECT item_order, item_type FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
      [LCM_RECOVERY_FIXTURE_IDS.conversationID],
    )
    expect(rows).toEqual([
      { item_order: 1, item_type: "summary" },
      { item_order: 2, item_type: "raw_message" },
    ])
    await worker.close()
  })
}

test("missing immutable source fails closed without leaking source text", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_summaries WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_message_parts WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_messages WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "missing-source" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: { code: "missing_source", templateKey: "lcm.recovery.missing_source" },
  })
  expect(JSON.stringify(result)).not.toContain(LCM_HARNESS_SENTINELS.sourceText)
  await worker.close()
})

test("missing LCM-owned artifact fails only the dependent rebuild path", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
          `
            INSERT INTO lcm_large_files (
              file_id,
              conversation_id,
              source_kind,
              mime_type,
              preview_text,
              artifact_storage_kind,
              artifact_path,
              artifact_byte_count,
              artifact_content_sha256,
              created_at_ms,
              updated_at_ms
            )
            VALUES (
              'file_m08_missing_artifact',
              $1,
              'inline',
              'text/plain',
              'safe preview',
              'file',
              $3,
              12,
              repeat('a', 64),
              $2,
              $2
            )
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, 1_777_500_008_500, `sha256/aa/aa/${"a".repeat(64)}.bin`],
        )
        await (db as PGlite).query(
          `
            INSERT INTO lcm_context_items (
              context_item_id,
              conversation_id,
              item_order,
              item_type,
              file_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES ('ctx_m08_missing_artifact', $1, 3, 'large_file_marker', 'file_m08_missing_artifact', $2, $2)
          `,
          [LCM_RECOVERY_FIXTURE_IDS.conversationID, 1_777_500_008_500],
        )
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "missing-artifact" }),
    ),
  )
  expect(result).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    safeError: { code: "stale_source", templateKey: "lcm.file.stale" },
  })
  expect(JSON.stringify(result)).not.toContain("safe preview")
  const readable = await query<{ message_count: number; summary_count: number }>(
    worker,
    `
      SELECT
        (SELECT count(*)::int FROM lcm_messages WHERE conversation_id = $1) AS message_count,
        (SELECT count(*)::int FROM lcm_summaries WHERE conversation_id = $1) AS summary_count
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID],
  )
  expect(readable[0]).toEqual({ message_count: 1, summary_count: 1 })
  await worker.close()
})

test("manifest payload content is not leaked through recovery results", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  await seed(worker)
  await writeSnapshotAndDeleteContext(worker)
  await mutateLatestManifest(worker, (manifest) => {
    const items = [...(manifest.items as Record<string, unknown>[])]
    items[0] = {
      contextItemID: "ctx_m08_cue",
      conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
      itemOrder: 1,
      itemType: "retrieval_cue",
      cueID: "cue_m08",
      cuePayload: {
        query: LCM_HARNESS_SENTINELS.promptBoundary,
        cueText: LCM_HARNESS_SENTINELS.sourceText,
        summaryIDs: [],
        fileIDs: [],
        messageRowIDs: [],
        partRowIDs: [],
        tokenCount: 1,
        generatedAt: new Date(1_777_500_008_000).toISOString(),
      },
      createdAtMs: 1_777_500_008_000,
      updatedAtMs: 1_777_500_008_000,
    }
    return { ...manifest, schemaVersion: "future-version", items }
  })
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query("DELETE FROM lcm_summaries WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_message_parts WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_messages WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )

  const result = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.rebuildActiveContext({ conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID, reason: "non-leak" }),
    ),
  )
  expect(result.status).toBe("failed")
  expect(JSON.stringify(result)).not.toContain(LCM_HARNESS_SENTINELS.promptBoundary)
  expect(JSON.stringify(result)).not.toContain(LCM_HARNESS_SENTINELS.sourceText)
  await worker.close()
})

test("lcm:perf:scale reads and rebuilds a release-scale raw context fixture", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  const conversationID = "conv_m08_scale"
  await worker.executeForeground(
    request({
      run: async (db) => {
        const boundary = JSON.stringify({
          version: 1,
          projectID: "project_m08",
          workspaceID: "workspace_m08",
          platformPathFlavor: "posix",
          caseSensitivity: "sensitive",
          sessionDirectoryOriginal: "/workspace/m08",
          sessionDirectoryCanonical: "/workspace/m08",
          worktreeOriginal: "/workspace/m08",
          worktreeCanonical: "/workspace/m08",
          allowedRootOriginals: ["/workspace/m08"],
          allowedRootCanonicals: ["/workspace/m08"],
          kiloPermissionContext: { source: "worktree" },
        })
        await (db as PGlite).query(
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
              lifecycle_state,
              schema_version,
              feature_version,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, 'session_m08_scale', $1, 'project_m08', 'workspace_m08', '/workspace/m08',
                    '/workspace/m08', $2::jsonb, 'passive_synced', 8, 1, $3, $3)
          `,
          [conversationID, boundary, 1_777_500_009_000],
        )
        for (let index = 1; index <= 250; index++) {
          const messageID = `msg_m08_scale_${index.toString().padStart(4, "0")}`
          await (db as PGlite).query(
            `
              INSERT INTO lcm_messages (
                message_row_id,
                conversation_id,
                source_session_id,
                source_message_id,
                role,
                message_order,
                created_at_ms,
                metadata_json
              )
              VALUES ($1, $2, 'session_m08_scale', $3, 'user', $4, $5, '{}'::jsonb)
            `,
            [messageID, conversationID, `source_${index}`, index, 1_777_500_009_000 + index],
          )
          await (db as PGlite).query(
            `
              INSERT INTO lcm_message_parts (
                part_row_id,
                message_row_id,
                conversation_id,
                source_part_key,
                part_order,
                part_kind,
                text_content,
                content_sha256,
                search_text,
                created_at_ms
              )
              VALUES ($1, $2, $3, $4, 1, 'text', $5, repeat('b', 64), $5, $6)
            `,
            [
              `part_m08_scale_${index.toString().padStart(4, "0")}`,
              messageID,
              conversationID,
              `derived:source_${index}:1:text:i0s0c0`,
              `scale source ${index}`,
              1_777_500_009_000 + index,
            ],
          )
        }
      },
    }),
  )

  const started = performance.now()
  const result = await runContext(
    worker,
    LcmContextService.use((svc) => svc.rebuildActiveContext({ conversationID, reason: "release-scale-index-v1" })),
  )
  const elapsedMs = performance.now() - started
  expect(result).toMatchObject({ status: "rebuilt", itemsRebuilt: 250 })
  expect(elapsedMs).toBeLessThan(10_000)

  const counts = await query<{ context_count: number; snapshot_count: number }>(
    worker,
    `
      SELECT
        (SELECT count(*)::int FROM lcm_context_items WHERE conversation_id = $1) AS context_count,
        (SELECT count(*)::int FROM lcm_context_snapshots WHERE conversation_id = $1) AS snapshot_count
    `,
    [conversationID],
  )
  expect(counts[0]).toEqual({ context_count: 250, snapshot_count: 1 })
  await worker.close()

  const layout = resolveLcmDbLayout(dataDir)
  await expect(fs.stat(layout.pgliteDir)).resolves.toBeDefined()
})
