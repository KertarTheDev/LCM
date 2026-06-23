// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import path from "node:path"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { exportLcmPrompts } from "../../src/session/lcm/prompt-export"
import type { ConversationID, LcmDbRequest, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const sessionID = "session_prompt_export"
const conversationID = "conv_prompt_export" as ConversationID
const now = 1_779_600_000_000

function operationID(suffix: string): OperationID {
  return `op_prompt_export_${suffix}` as OperationID
}

function request<T>(run: LcmDbRequest<T>["run"]): LcmDbRequest<T> {
  return {
    operationID: operationID("seed"),
    lane: "foreground",
    purpose: "debug_support",
    timeoutMs: 20_000,
    run,
  }
}

async function seedPromptExportConversation(db: PGlite, workspaceRoot: string) {
  const query = async (label: string, sql: string, params: unknown[]) => {
    try {
      await db.query(sql, params)
    } catch (error) {
      throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const boundary = createHarnessBoundaryMetadata({
    projectID: "project_prompt_export",
    workspaceID: "workspace_prompt_export",
    sessionDirectoryOriginal: workspaceRoot,
    sessionDirectoryCanonical: workspaceRoot,
    worktreeOriginal: workspaceRoot,
    worktreeCanonical: workspaceRoot,
    allowedRootOriginals: [workspaceRoot],
    allowedRootCanonicals: [workspaceRoot],
  })
  await query(
    "conversation",
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
      VALUES ($1, $2, $1, 'project_prompt_export', 'workspace_prompt_export', $3, $3, $4::jsonb,
              'lcm_active', $5, 1, $6, $6)
    `,
    [conversationID, sessionID, workspaceRoot, JSON.stringify(boundary), LCM_DB_GATE_SCHEMA_VERSION, now],
  )
  await query(
    "messages",
    `
      INSERT INTO lcm_messages (
        message_row_id,
        conversation_id,
        source_session_id,
        source_message_id,
        role,
        message_order,
        created_at_ms,
        completed_at_ms,
        provider_id,
        model_id,
        agent_name,
        metadata_json
      )
      VALUES
        ('msg_prompt_export_user', $1, $2, 'source_user', 'user', 1, $3, NULL, 'provider_a', 'model_a', 'code', '{}'::jsonb),
        ('msg_prompt_export_assistant', $1, $2, 'source_assistant', 'assistant', 2, $4, $5, 'provider_a', 'model_a', 'code', '{}'::jsonb)
    `,
    [conversationID, sessionID, now, now + 10, now + 20],
  )
  await query(
    "parts",
    `
      INSERT INTO lcm_message_parts (
        part_row_id,
        message_row_id,
        conversation_id,
        source_part_id,
        source_part_key,
        part_order,
        part_kind,
        terminal_state,
        text_content,
        tool_call_id,
        tool_name,
        tool_input_json,
        tool_output_text,
        provider_metadata_json,
        render_metadata_json,
        content_sha256,
        search_text,
        created_at_ms,
        completed_at_ms
      )
      VALUES
        ('part_prompt_export_user_text', 'msg_prompt_export_user', $1, 'part_prompt_export_user_text',
         'id:part_prompt_export_user_text', 1, 'text', NULL, 'visible user prompt text', NULL, NULL,
         NULL, NULL, '{}'::jsonb, '{}'::jsonb, $2, 'visible user prompt text', $3, NULL),
        ('part_prompt_export_assistant_tool', 'msg_prompt_export_assistant', $1, 'part_prompt_export_assistant_tool',
         'id:part_prompt_export_assistant_tool', 1, 'tool', 'completed', NULL, 'call_prompt_export',
         'debug_tool', $4::jsonb, 'HIDDEN_TOOL_OUTPUT_SENTINEL', '{}'::jsonb, '{}'::jsonb, $5,
         'debug tool output', $6, $7)
    `,
    [conversationID, "0".repeat(64), now, JSON.stringify({ path: "src/index.ts" }), "1".repeat(64), now + 10, now + 20],
  )
  for (const [contextItemID, itemOrder, messageRowID] of [
    ["ctx_prompt_export_user", 1, "msg_prompt_export_user"],
    ["ctx_prompt_export_assistant", 2, "msg_prompt_export_assistant"],
  ] as const) {
    await query(
      `context:${contextItemID}`,
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          message_row_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, 'raw_message', $4, $5, $5)
      `,
      [contextItemID, conversationID, itemOrder, messageRowID, now + itemOrder],
    )
  }
  await query(
    "snapshot",
    `
      INSERT INTO lcm_context_snapshots (
        snapshot_id,
        conversation_id,
        created_at_ms,
        strategy,
        active_tokens,
        hard_limit,
        soft_threshold,
        soft_backlog_tokens,
        soft_backlog_item_count,
        context_item_count,
        token_counter_mode,
        token_counter_version,
        lane_counts_json,
        metrics_json,
        restore_manifest_json
      )
      VALUES ($1, $2, $3, 'upward', 40, 100, 50, 0, 0, 2, 'deterministic_fallback',
              'lcm-test-token-counter', '{}'::jsonb, $4::jsonb, $5::jsonb)
    `,
    [
      "snap_prompt_export_initial",
      conversationID,
      now + 30,
      JSON.stringify({ reason: "assembly" }),
      JSON.stringify({
        schemaVersion: "lcm-test-context-manifest-v1",
        items: [
          { itemType: "raw_message", messageRowID: "msg_prompt_export_user" },
          { itemType: "raw_message", messageRowID: "msg_prompt_export_assistant" },
        ],
      }),
    ],
  )
}

test(
  "prompt exporter writes active context markdown with hidden tool output",
  async () => {
    await using tmp = await tmpdir()
    const dataDir = path.join(tmp.path, "lcm")
    const workspaceRoot = path.join(tmp.path, "workspace")
    await fs.mkdir(workspaceRoot, { recursive: true })
    const worker = createLcmDbWorker()
    await worker.initialize({
      dataDir,
      runtimeMode: "source",
      schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
      smokeMode: true,
    })

    try {
      const seedError = await worker.executeForeground(
        request(async (db) => {
          try {
            await seedPromptExportConversation(db as PGlite, workspaceRoot)
            return undefined
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }),
      )
      expect(seedError).toBeUndefined()
      const exportResult = await worker.executeForeground(
        request(async (db) => {
          try {
            return {
              ok: true as const,
              report: await exportLcmPrompts({
                db: db as PGlite,
                sessionID,
                conversationID,
                dataDir,
                workspaceRoot,
                operationID: operationID("export"),
              }),
            }
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      )
      expect(exportResult).toMatchObject({ ok: true })
      if (!exportResult.ok) throw new Error(exportResult.error)
      const report = exportResult.report

      expect(report.exportDir.startsWith(path.join(workspaceRoot, "lcm-export"))).toBe(true)
      expect(report.fileCount).toBeGreaterThanOrEqual(2)
      const filenames = await fs.readdir(report.exportDir)
      expect(filenames).toContain("0000-index.md")
      const dialogFilename = filenames.find((filename) => filename.endsWith("-dialog-active-context.md"))
      expect(dialogFilename).toBeDefined()
      const dialog = await fs.readFile(path.join(report.exportDir, dialogFilename!), "utf8")
      expect(dialog).toContain("visible user prompt text")
      expect(dialog).toContain("Tool Input")
      expect(dialog).toContain('"path": "src/index.ts"')
      expect(dialog).toContain("Tool Output")
      expect(dialog).toContain("HIDDEN_TOOL_OUTPUT_SENTINEL")
    } finally {
      await worker.close()
    }
  },
  { timeout: 30_000 },
)
