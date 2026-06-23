// kilocode_change - new file
import { createHash } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import { LcmDb } from "../../src/session/lcm/db"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { writeLcmArtifact } from "../../src/session/lcm/artifacts"
import type { LcmDbRequest, LcmSafeError, OperationID } from "../../src/session/lcm/types"
import { serializeInlinePartSourceBytes, serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { createHarnessBoundaryMetadata } from "./harness"

export const retrievalNow = 1_777_600_210_000

export const retrievalIDs = {
  rootSession: "session_m21_root",
  taskSession: "session_m21_task",
  readTaskSession: "session_m22_read_task",
  exploreSession: "session_m21_explore",
  mapSession: "session_m21_map",
  siblingSession: "session_m21_sibling",
  foreignSession: "session_m21_foreign",
  rootConversation: "conv_m21_root",
  taskConversation: "conv_m21_task",
  readTaskConversation: "conv_m22_read_task",
  exploreConversation: "conv_m21_explore",
  mapConversation: "conv_m21_map",
  siblingConversation: "conv_m21_sibling",
  foreignConversation: "conv_m21_foreign",
  rootMessage: "msg_m21_root_1",
  rootPart: "part_m21_root_1",
  fileMessage: "msg_m21_file_1",
  filePart: "part_m21_file_1",
  currentMessage: "msg_m21_current_1",
  currentPart: "part_m21_current_1",
  fallbackMessage: "msg_m21_fallback_source",
  fallbackPart: "part_m21_fallback_source",
  targetSummary: "sum_m21_target",
  parentSummary: "sum_m21_parent",
  fallbackSummary: "sum_m21_fallback",
  siblingSummary: "sum_m21_sibling",
  foreignSummary: "sum_m21_foreign",
  file: "file_m21_artifact",
  framedFile: "file_m21_framed_tool_output",
  pathFile: "file_m22_path",
  mapRun: "map_m21_agentic",
} as const

function operationID(suffix: string): OperationID {
  return `op_m21_${suffix}` as OperationID
}

export function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">) {
  return {
    operationID: operationID("fixture"),
    purpose: "debug_support" as const,
    run: input.run,
  }
}

export async function initializeRetrievalWorker(dataDir: string) {
  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir,
    runtimeMode: "source",
    schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
    smokeMode: true,
  })
  if (status.status !== "ready") throw new Error(status.safeError?.safeMessage ?? "LCM DB did not initialize")
  return worker
}

export function retrievalDbLayer(worker: ReturnType<typeof createLcmDbWorker>) {
  return Layer.succeed(
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
}

export function runRetrieval<A, E>(
  worker: ReturnType<typeof createLcmDbWorker>,
  effect: Effect.Effect<A, E, LcmDb.Service>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(retrievalDbLayer(worker))))
}

export async function queryRetrieval<T>(
  worker: ReturnType<typeof createLcmDbWorker>,
  sql: string,
  params: unknown[] = [],
) {
  return worker.executeForeground(
    request({
      run: async (db) => (await (db as PGlite).query<T>(sql, params)).rows,
    }),
  )
}

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function boundary(projectID = "project_m21", workspaceID = "workspace_m21") {
  return JSON.stringify(
    createHarnessBoundaryMetadata({
      projectID,
      workspaceID,
      sessionDirectoryOriginal: "/workspace/m21",
      sessionDirectoryCanonical: "/workspace/m21",
      worktreeOriginal: "/workspace/m21",
      worktreeCanonical: "/workspace/m21",
      allowedRootOriginals: ["/workspace/m21"],
      allowedRootCanonicals: ["/workspace/m21"],
    }),
  )
}

async function insertConversation(
  db: PGlite,
  input: {
    conversationID: string
    sessionID: string
    capabilityClass: "root" | "task_child" | "explore_child" | "map_child"
    parentConversationID?: string
    parentSessionID?: string
    rootConversationID?: string
    source?: "kilo_session" | "kilo_task" | "lcm_explore" | "lcm_map"
    projectID?: string
    workspaceID?: string
    readCapable?: boolean
    mapID?: string
    mapItemID?: string
  },
) {
  const metadata =
    input.capabilityClass === "root"
      ? { version: 1, source: "kilo_session", capabilityClass: "root" }
      : {
          version: 1,
          source: input.source,
          parentSessionID: input.parentSessionID,
          parentConversationID: input.parentConversationID,
          rootConversationID: input.rootConversationID,
          capabilityClass: input.capabilityClass,
          ...(input.readCapable ? { readCapable: true } : {}),
          ...(input.mapID ? { mapID: input.mapID } : {}),
          ...(input.mapItemID ? { mapItemID: input.mapItemID } : {}),
        }
  await db.query(
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
        orchestration_metadata_json,
        lifecycle_state,
        schema_version,
        feature_version,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, '/workspace/m21', '/workspace/m21', $8::jsonb, $9, $10::jsonb,
              'lcm_active', 21, 1, $11, $11)
    `,
    [
      input.conversationID,
      input.sessionID,
      input.parentSessionID ?? null,
      input.parentConversationID ?? null,
      input.rootConversationID ?? input.conversationID,
      input.projectID ?? "project_m21",
      input.workspaceID ?? "workspace_m21",
      boundary(input.projectID, input.workspaceID),
      input.capabilityClass,
      JSON.stringify(metadata),
      retrievalNow,
    ],
  )
}

async function insertMessagePart(
  db: PGlite,
  input: {
    conversationID: string
    sessionID: string
    messageRowID: string
    partRowID: string
    messageOrder: number
    partOrder?: number
    text: string
    searchText?: string
    contentFileID?: string
  },
) {
  await db.query(
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
      VALUES ($1, $2, $3, $4, 'user', $5, $6, 'provider_m21', 'model_m21', 'code', $7::jsonb)
    `,
    [
      input.messageRowID,
      input.conversationID,
      input.sessionID,
      `${input.messageRowID}_source`,
      input.messageOrder,
      retrievalNow + input.messageOrder,
      JSON.stringify({ version: 1, role: "user" }),
    ],
  )
  await db.query(
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
        content_file_id,
        content_byte_count,
        content_sha256,
        search_text,
        created_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, 'text', $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      input.partRowID,
      input.messageRowID,
      input.conversationID,
      `${input.messageRowID}:part:${input.partOrder ?? 1}`,
      input.partOrder ?? 1,
      input.contentFileID ? null : input.text,
      input.contentFileID ? "lcm_file" : "inline",
      input.contentFileID ?? null,
      input.contentFileID ? Buffer.byteLength(input.text, "utf8") : null,
      input.contentFileID ? sha256Hex(input.text) : sha256Hex(input.searchText ?? input.text),
      input.searchText ?? serializeMessagePartSearchText({ textContent: input.text }),
      retrievalNow + input.messageOrder,
    ],
  )
}

async function insertSummary(
  db: PGlite,
  input: {
    summaryID: string
    conversationID: string
    content: string
    createdOffset: number
    objectiveStatus?: "provider_accepted" | "fallback_accepted"
    fallbackMode?: "none" | "truncated_prefix" | "extractive_key_points"
  },
) {
  await db.query(
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
      VALUES ($1, $2, 'sprig', $3, 100, 20, 1, 'summary-leaf-v2', 'upward', $4, $5, $6)
    `,
    [
      input.summaryID,
      input.conversationID,
      input.content,
      input.objectiveStatus ?? "provider_accepted",
      input.fallbackMode ?? "none",
      retrievalNow + input.createdOffset,
    ],
  )
}

export async function seedRetrievalFixture(worker: ReturnType<typeof createLcmDbWorker>) {
  const artifactPayload = Buffer.from("ARTIFACT_SECRET_DO_NOT_SEARCH", "utf8")
  const artifact = await writeLcmArtifact({
    artifactRoot: resolveLcmDbLayout(worker.getStatus().dataDir).artifactsDir,
    bytes: artifactPayload,
  })
  const framedArtifactPayload = serializeInlinePartSourceBytes({
    toolInputJson: { command: "demo" },
    toolOutputText: "FRAMED_TOOL_OUTPUT_SECRET appears in decoded artifact content.",
  })
  if (!framedArtifactPayload) throw new Error("framed retrieval artifact payload was not created")
  const framedArtifact = await writeLcmArtifact({
    artifactRoot: resolveLcmDbLayout(worker.getStatus().dataDir).artifactsDir,
    bytes: framedArtifactPayload,
  })
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.rootConversation,
          sessionID: retrievalIDs.rootSession,
          capabilityClass: "root",
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.taskConversation,
          sessionID: retrievalIDs.taskSession,
          capabilityClass: "task_child",
          parentConversationID: retrievalIDs.rootConversation,
          parentSessionID: retrievalIDs.rootSession,
          rootConversationID: retrievalIDs.rootConversation,
          source: "kilo_task",
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.readTaskConversation,
          sessionID: retrievalIDs.readTaskSession,
          capabilityClass: "task_child",
          parentConversationID: retrievalIDs.rootConversation,
          parentSessionID: retrievalIDs.rootSession,
          rootConversationID: retrievalIDs.rootConversation,
          source: "kilo_task",
          readCapable: true,
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.exploreConversation,
          sessionID: retrievalIDs.exploreSession,
          capabilityClass: "explore_child",
          parentConversationID: retrievalIDs.rootConversation,
          parentSessionID: retrievalIDs.rootSession,
          rootConversationID: retrievalIDs.rootConversation,
          source: "lcm_explore",
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.mapConversation,
          sessionID: retrievalIDs.mapSession,
          capabilityClass: "map_child",
          parentConversationID: retrievalIDs.rootConversation,
          parentSessionID: retrievalIDs.rootSession,
          rootConversationID: retrievalIDs.rootConversation,
          source: "lcm_map",
          mapID: retrievalIDs.mapRun,
          mapItemID: "item_0",
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.siblingConversation,
          sessionID: retrievalIDs.siblingSession,
          capabilityClass: "task_child",
          parentConversationID: retrievalIDs.rootConversation,
          parentSessionID: retrievalIDs.rootSession,
          rootConversationID: retrievalIDs.rootConversation,
          source: "kilo_task",
        })
        await insertConversation(typedDb, {
          conversationID: retrievalIDs.foreignConversation,
          sessionID: retrievalIDs.foreignSession,
          capabilityClass: "root",
          projectID: "project_m21_foreign",
          workspaceID: "workspace_m21_foreign",
        })

        await typedDb.query(
          `
            INSERT INTO lcm_large_files (
              file_id,
              conversation_id,
              source_kind,
              mime_type,
              token_estimate,
              preview_text,
              exploration_status,
              artifact_storage_kind,
              artifact_path,
              artifact_byte_count,
              artifact_content_sha256,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, 'tool_output', 'text/plain', 12, 'stored preview only', 'completed',
                    'file', $3, $4, $5, $6, $6)
          `,
          [
            retrievalIDs.file,
            retrievalIDs.rootConversation,
            artifact.artifactPath,
            artifact.byteCount,
            artifact.sha256,
            retrievalNow,
          ],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_large_files (
              file_id,
              conversation_id,
              source_kind,
              mime_type,
              token_estimate,
              preview_text,
              exploration_status,
              artifact_storage_kind,
              artifact_path,
              artifact_byte_count,
              artifact_content_sha256,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, 'tool_output', 'text/plain', 16, 'framed preview only', 'completed',
                    'file', $3, $4, $5, $6, $6)
          `,
          [
            retrievalIDs.framedFile,
            retrievalIDs.rootConversation,
            framedArtifact.artifactPath,
            framedArtifact.byteCount,
            framedArtifact.sha256,
            retrievalNow,
          ],
        )
        await typedDb.query(
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
              mime_type,
              token_estimate,
              preview_text,
              exploration_status,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, 'path', '/workspace/m21/src/path-backed.txt',
                    '/workspace/m21/src/path-backed.txt', 64, $3, $4, 'full', $5::jsonb,
                    'text/plain', 16, 'path preview only', 'completed', $3, $3)
          `,
          [
            retrievalIDs.pathFile,
            retrievalIDs.rootConversation,
            retrievalNow,
            sha256Hex("PATH_BACKED_SECRET_DO_NOT_READ"),
            boundary(),
          ],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_map_runs (
              map_id,
              conversation_id,
              tool_kind,
              status,
              request_fingerprint,
              input_file_id,
              worker_count,
              max_retries,
              prompt_text,
              prompt_sha256,
              model_selection_json,
              agentic_mode,
              schema_json,
              schema_sha256,
              created_at_ms,
              updated_at_ms
            )
            VALUES (
              $1,
              $2,
              'agentic_map',
              'running',
              'fingerprint_m21_map',
              $3,
              1,
              2,
              'prompt',
              'prompt_sha',
              '{"selector":"default","providerID":"provider_m21","modelID":"model_m21"}'::jsonb,
              'read_only',
              '{"type":"object"}'::jsonb,
              'schema_sha',
              $4,
              $4
            )
          `,
          [retrievalIDs.mapRun, retrievalIDs.rootConversation, retrievalIDs.file, retrievalNow],
        )
        await typedDb.query(
          `
            INSERT INTO lcm_map_items (map_id, item_index, status, attempts, created_at_ms, updated_at_ms)
            VALUES ($1, 0, 'running', 1, $2, $2)
          `,
          [retrievalIDs.mapRun, retrievalNow],
        )

        const canonicalToolSearch = serializeMessagePartSearchText({
          toolInputJson: { zeta: "last", alpha: "first" },
          textContent:
            "AlphaCode IdentifierX PATH_FLAG --enable-lcm hash deadbeef stack Error: boom Привет REGEX_TOKEN_42",
        })
        await insertMessagePart(typedDb, {
          conversationID: retrievalIDs.rootConversation,
          sessionID: retrievalIDs.rootSession,
          messageRowID: retrievalIDs.rootMessage,
          partRowID: retrievalIDs.rootPart,
          messageOrder: 1,
          text: "AlphaCode IdentifierX PATH_FLAG --enable-lcm hash deadbeef stack Error: boom Привет REGEX_TOKEN_42",
          searchText: canonicalToolSearch,
        })
        await insertMessagePart(typedDb, {
          conversationID: retrievalIDs.rootConversation,
          sessionID: retrievalIDs.rootSession,
          messageRowID: retrievalIDs.fileMessage,
          partRowID: retrievalIDs.filePart,
          messageOrder: 2,
          text: "ARTIFACT_SECRET_DO_NOT_SEARCH",
          searchText: "tool output marker searchable preview, not the full artifact secret",
          contentFileID: retrievalIDs.file,
        })
        await insertMessagePart(typedDb, {
          conversationID: retrievalIDs.rootConversation,
          sessionID: retrievalIDs.rootSession,
          messageRowID: retrievalIDs.currentMessage,
          partRowID: retrievalIDs.currentPart,
          messageOrder: 3,
          text: "Current retrieval cue boundary row.",
        })
        await insertMessagePart(typedDb, {
          conversationID: retrievalIDs.rootConversation,
          sessionID: retrievalIDs.rootSession,
          messageRowID: retrievalIDs.fallbackMessage,
          partRowID: retrievalIDs.fallbackPart,
          messageOrder: 4,
          text: "FALLBACK_NEEDLE original source text is complete and should outrank fallback memory.",
        })
        await insertMessagePart(typedDb, {
          conversationID: retrievalIDs.siblingConversation,
          sessionID: retrievalIDs.siblingSession,
          messageRowID: "msg_m21_sibling_1",
          partRowID: "part_m21_sibling_1",
          messageOrder: 1,
          text: "SIBLING_SECRET should never be visible to task siblings",
        })

        await insertSummary(typedDb, {
          summaryID: retrievalIDs.parentSummary,
          conversationID: retrievalIDs.rootConversation,
          content: "Parent summary mentions multilingual Привет and /tmp/example.ts for summary closure.",
          createdOffset: 10,
        })
        await insertSummary(typedDb, {
          summaryID: retrievalIDs.targetSummary,
          conversationID: retrievalIDs.rootConversation,
          content: "Target summary mentions AlphaCode and points at parent memory.",
          createdOffset: 20,
        })
        await insertSummary(typedDb, {
          summaryID: retrievalIDs.fallbackSummary,
          conversationID: retrievalIDs.rootConversation,
          content: "FALLBACK_NEEDLE deterministic truncated prefix only.",
          createdOffset: 25,
          objectiveStatus: "fallback_accepted",
          fallbackMode: "truncated_prefix",
        })
        await insertSummary(typedDb, {
          summaryID: retrievalIDs.siblingSummary,
          conversationID: retrievalIDs.siblingConversation,
          content: "SIBLING_SECRET summary outside the current child lineage.",
          createdOffset: 30,
        })
        await insertSummary(typedDb, {
          summaryID: retrievalIDs.foreignSummary,
          conversationID: retrievalIDs.foreignConversation,
          content: "FOREIGN_SECRET summary outside the workspace.",
          createdOffset: 40,
        })
        await typedDb.query(
          "INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order) VALUES ($1, $2, 1)",
          [retrievalIDs.targetSummary, retrievalIDs.parentSummary],
        )
        await typedDb.query(
          "INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order) VALUES ($1, $2, 1), ($1, $3, 2)",
          [retrievalIDs.targetSummary, retrievalIDs.rootMessage, retrievalIDs.fileMessage],
        )
        await typedDb.query(
          "INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order) VALUES ($1, $2, 1)",
          [retrievalIDs.fallbackSummary, retrievalIDs.fallbackMessage],
        )
        await typedDb.query(
          "INSERT INTO lcm_id_aliases (alias_id, canonical_id, id_kind, conversation_id, created_at_ms) VALUES ($1, $2, 'summary', $3, $4)",
          ["sum_m21_target_alias", retrievalIDs.targetSummary, retrievalIDs.rootConversation, retrievalNow],
        )
      },
    }),
  )
}
