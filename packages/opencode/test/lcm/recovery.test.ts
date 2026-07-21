// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { resolveLcmDbLayout, resolveLcmFamilyRoot } from "../../src/session/lcm/db-layout"
import { deriveLcmFamilyID } from "../../src/session/lcm/family"
import { LCM_DB_GATE_SCHEMA_VERSION, rebuildLcmDb } from "../../src/session/lcm/db-smoke"
import type { LcmDbRequest, OperationID } from "../../src/session/lcm/types"
import {
  LCM_HARNESS_SENTINELS,
  LCM_RECOVERY_FIXTURE_IDS,
  rebuildDerivedContextFromImmutableFixture,
  seedRecoveryConversationFixture,
} from "./harness"

function operationID(suffix: string): OperationID {
  return `op_m07_${suffix}` as OperationID
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

test("lcm:recovery rebuilds deleted derived context from immutable source rows", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await seedRecoveryConversationFixture(db as PGlite)
      },
    }),
  )

  const before = await worker.executeForeground(
    request({
      run: async (db) =>
        (
          await (db as PGlite).query<{ count: number }>(
            "SELECT count(*)::int AS count FROM lcm_context_items WHERE conversation_id = $1",
            [LCM_RECOVERY_FIXTURE_IDS.conversationID],
          )
        ).rows[0]?.count,
    }),
  )
  expect(before).toBe(2)

  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
      },
    }),
  )
  const recovery = await worker.executeForeground(
    request({
      run: async (db) =>
        rebuildDerivedContextFromImmutableFixture(db as PGlite, LCM_RECOVERY_FIXTURE_IDS.conversationID),
    }),
  )
  expect(recovery).toMatchObject({
    conversationID: LCM_RECOVERY_FIXTURE_IDS.conversationID,
    status: "rebuilt",
    itemsRebuilt: 2,
    lifecycleState: "passive_synced",
  })
  const rows = await worker.executeForeground(
    request({
      run: async (db) =>
        (
          await (db as PGlite).query<{ item_order: number; item_type: string }>(
            `
              SELECT item_order, item_type
              FROM lcm_context_items
              WHERE conversation_id = $1
              ORDER BY item_order
            `,
            [LCM_RECOVERY_FIXTURE_IDS.conversationID],
          )
        ).rows,
    }),
  )
  expect(rows).toEqual([
    { item_order: 1, item_type: "raw_message" },
    { item_order: 2, item_type: "summary" },
  ])
  await worker.close()
})

test("lcm:recovery fails closed with content-safe missing-source errors", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await seedRecoveryConversationFixture(db as PGlite)
        await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.conversationID,
        ])
        await (db as PGlite).query("DELETE FROM lcm_summary_messages WHERE summary_id = $1", [
          LCM_RECOVERY_FIXTURE_IDS.summaryID,
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
  const recovery = await worker.executeForeground(
    request({
      run: async (db) =>
        rebuildDerivedContextFromImmutableFixture(db as PGlite, LCM_RECOVERY_FIXTURE_IDS.conversationID),
    }),
  )
  expect(recovery).toMatchObject({
    status: "failed",
    lifecycleState: "recovery_failed",
    itemsRebuilt: 0,
    safeError: {
      code: "missing_source",
      templateKey: "lcm.recovery.missing_source",
      action: "repeat_input",
      retryable: false,
      diagnosticCode: "lcm_recovery_fixture_missing_source",
    },
  })
  expect(JSON.stringify(recovery)).not.toContain(LCM_HARNESS_SENTINELS.sourceText)
  await worker.close()
})

test("lcm:recovery crash/reopen helper preserves persisted fixture state", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  await worker.executeForeground(
    request({
      run: async (db) => {
        await seedRecoveryConversationFixture(db as PGlite)
      },
    }),
  )
  await worker.close()

  const reopened = await initialize(dataDir)
  const rows = await reopened.executeForeground(
    request({
      run: async (db) =>
        (
          await (db as PGlite).query<{ text_content: string; summary_count: number }>(
            `
              SELECT
                (SELECT text_content FROM lcm_message_parts WHERE part_row_id = 'part_harness_text') AS text_content,
                (SELECT count(*)::int FROM lcm_summaries WHERE conversation_id = $1) AS summary_count
            `,
            [LCM_RECOVERY_FIXTURE_IDS.conversationID],
          )
        ).rows[0],
    }),
  )
  expect(rows?.text_content).toContain(LCM_HARNESS_SENTINELS.sourceText)
  expect(rows?.summary_count).toBe(1)
  await reopened.close()
})

test("corrupt-db-artifact-metadata-v1 proves artifact bytes alone do not recreate DB handles", async () => {
  await using tmp = await tmpdir()
  const kiloDataDir = path.join(tmp.path, "kilo-data")
  const dataDir = resolveLcmFamilyRoot({
    kiloDataDir,
    familyID: deriveLcmFamilyID("ses_recovery_corrupt_artifact"),
  })
  const layout = resolveLcmDbLayout(dataDir)
  const worker = await initialize(dataDir)
  await worker.close()

  const orphanArtifactPath = path.join(layout.artifactsDir, "sha256", "orphan_artifact")
  await fs.mkdir(path.dirname(orphanArtifactPath), { recursive: true })
  await fs.writeFile(orphanArtifactPath, LCM_HARNESS_SENTINELS.artifactBytes)

  const dryRun = await rebuildLcmDb({ dataDir, dryRun: true })
  expect(dryRun).toMatchObject({
    status: "would_rebuild",
    rebuiltConversations: 0,
    readOnlyConversations: 0,
    skippedConversations: 0,
    failedConversations: 0,
  })
  expect(JSON.stringify(dryRun)).not.toContain(LCM_HARNESS_SENTINELS.artifactBytes)

  const apply = await rebuildLcmDb({ dataDir, dryRun: false })
  expect(apply.status).toBe("rebuilt")
  expect(apply.quarantinedDataDir).toContain(".quarantine.")
  expect(JSON.stringify(apply)).not.toContain(LCM_HARNESS_SENTINELS.artifactBytes)
  expect(await fs.readFile(orphanArtifactPath, "utf8")).toBe(LCM_HARNESS_SENTINELS.artifactBytes)

  const reopened = await initialize(dataDir)
  const counts = await reopened.executeForeground(
    request({
      run: async (db) =>
        (
          await (db as PGlite).query<{ file_count: number; part_count: number; conversation_count: number }>(
            `
              SELECT
                (SELECT count(*)::int FROM lcm_large_files) AS file_count,
                (SELECT count(*)::int FROM lcm_message_parts) AS part_count,
                (SELECT count(*)::int FROM lcm_conversations) AS conversation_count
            `,
          )
        ).rows[0],
    }),
  )
  expect(counts).toEqual({ file_count: 0, part_count: 0, conversation_count: 0 })
  await reopened.close()
})
