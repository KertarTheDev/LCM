// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import type { Permission } from "../../src/permission"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { Info as SessionInfo } from "../../src/session/session"
import {
  LCM_CONTEXT_RESTORE_MANIFEST_VERSION,
  LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
  LcmContext,
  Service as LcmContextService,
  type LcmRawLeafRenderPreparationInput,
  type LcmRawLeafThresholdInput,
  writeContextSnapshot,
} from "../../src/session/lcm/context"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { LCM_TOKEN_BUDGET_CACHE_VERSION } from "../../src/session/lcm/token-budget"
import type {
  ConversationID,
  LcmAssemblyInput,
  LcmDbRequest,
  LcmRetrievalCuePayload,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { makeFixtureClock, type LcmMessageVisibilityInput } from "../../src/session/lcm/render-prep"
import { serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const now = 1_777_500_360_000
const conversationID = "conv_m36_assembly_token_budget" as ConversationID
const sessionID = SessionID.make("ses_m36_assembly_token_budget")
const providerID = "provider-m36" as ProviderID
const modelID = "model-m36" as ModelID

function operationID(suffix: string): OperationID {
  return `op_m36_${suffix}` as OperationID
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
  return LcmContext.layer.pipe(Layer.provide(dbLayer))
}

function runContext<A, E>(
  worker: ReturnType<typeof createLcmDbWorker>,
  effect: Effect.Effect<A, E, LcmContextService>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(contextLayer(worker))))
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

function fakeModel(input: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: modelID,
    providerID,
    api: {
      id: modelID,
      npm: "@ai-sdk/openai",
      url: "https://example.invalid/openai",
    },
    name: "M36 Assembly Token Budget Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-05-07",
    ...input,
  } as Provider.Model
}

function fakeAgent(): Agent.Info {
  return {
    name: "code",
    description: "Code agent",
    mode: "primary",
    builtIn: true,
    topP: 1,
    temperature: 0,
    permission: [{ permission: "edit", pattern: "*", action: "ask" }],
    tools: {},
    options: {},
  } as Agent.Info
}

function fakeSession(): SessionInfo {
  return {
    id: sessionID,
    projectID: "project_m36",
    directory: "/workspace/m36",
    title: "assembly token budget",
    version: "test",
    time: { created: now, updated: now },
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
  } as SessionInfo
}

function userMessage(id: string, text: string, createdOffset: number): MessageV2.WithParts {
  const messageID = MessageID.make(id)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: now + createdOffset },
      agent: "code",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: PartID.make(`prt_${id.slice(4)}_text`),
        sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  }
}

function assistantToolMessage(parentID: string): MessageV2.WithParts {
  const messageID = MessageID.make("msg_m36_assistant_tool")
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: MessageID.make(parentID),
      time: { created: now + 2, completed: now + 3 },
      mode: "primary",
      agent: "code",
      providerID,
      modelID,
      path: { cwd: "/workspace/m36", root: "/workspace/m36" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: PartID.make("prt_m36_tool_completed"),
        sessionID,
        messageID,
        type: "tool",
        callID: "call_m36_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo m36" },
          output: "tool output m36",
          title: "bash",
          metadata: {},
          time: { start: now + 2, end: now + 3 },
        },
      },
    ],
  }
}

function messageMetadata(info: MessageV2.Info) {
  if (info.role === "user") {
    return {
      version: 1,
      role: "user",
      format: info.format,
      system: info.system,
      tools: info.tools,
      modelVariant: info.model.variant,
      summary: info.summary,
    }
  }
  return {
    version: 1,
    role: "assistant",
    parentID: info.parentID,
    mode: info.mode,
    path: info.path,
    summary: info.summary,
    structured: info.structured,
    error: info.error,
    cost: info.cost,
    tokens: info.tokens,
    variant: info.variant,
    finish: info.finish,
  }
}

function partRenderMetadata(part: MessageV2.Part) {
  const base = {
    version: 1,
    source: "message-v2",
    sourcePartType: part.type,
    sourcePartID: part.id,
  }
  if (part.type === "tool") {
    return {
      ...base,
      title: "title" in part.state ? part.state.title : undefined,
      stateMetadata: "metadata" in part.state ? part.state.metadata : undefined,
      time: "time" in part.state ? part.state.time : undefined,
    }
  }
  return base
}

async function seedMessage(db: PGlite, message: MessageV2.WithParts, order: number) {
  const messageRowID = `msg_m36_row_${order}`
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
        completed_at_ms,
        provider_id,
        model_id,
        agent_name,
        metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'code', $11::jsonb)
    `,
    [
      messageRowID,
      conversationID,
      message.info.sessionID,
      message.info.id,
      message.info.role,
      order,
      message.info.time.created,
      message.info.role === "assistant" ? (message.info.time.completed ?? null) : null,
      message.info.role === "assistant" ? message.info.providerID : message.info.model.providerID,
      message.info.role === "assistant" ? message.info.modelID : message.info.model.modelID,
      JSON.stringify(messageMetadata(message.info)),
    ],
  )

  for (const [partIndex, part] of message.parts.entries()) {
    await db.query(
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
        VALUES ($1, $2, $3, $1, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, '{}'::jsonb, $13::jsonb, $14, $15, $16, $17)
      `,
      [
        part.id,
        messageRowID,
        conversationID,
        `id:${part.id}`,
        partIndex + 1,
        part.type,
        part.type === "tool" ? part.state.status : null,
        part.type === "text" ? part.text : null,
        part.type === "tool" ? part.callID : null,
        part.type === "tool" ? part.tool : null,
        part.type === "tool" ? JSON.stringify(part.state.input) : null,
        part.type === "tool" && part.state.status === "completed" ? part.state.output : null,
        JSON.stringify(partRenderMetadata(part)),
        `${order}`.repeat(64).slice(0, 64),
        part.type === "text" ? serializeMessagePartSearchText({ textContent: part.text }) : "tool output m36",
        now + order + partIndex,
        part.type === "tool" ? now + order + partIndex + 1 : null,
      ],
    )
  }
  return messageRowID
}

function cuePayload(): LcmRetrievalCuePayload {
  return {
    query: "m36 recent tool result",
    cueText: "Use the m36 cue before answering.",
    summaryIDs: [],
    fileIDs: [],
    messageRowIDs: [],
    partRowIDs: [],
    tokenCount: 12,
    generatedAt: new Date(now + 4).toISOString(),
  }
}

async function seedAssemblyConversation(db: PGlite) {
  const boundary = createHarnessBoundaryMetadata({
    projectID: "project_m36",
    workspaceID: "workspace_m36",
    sessionDirectoryOriginal: "/workspace/m36",
    sessionDirectoryCanonical: "/workspace/m36",
    worktreeOriginal: "/workspace/m36",
    worktreeCanonical: "/workspace/m36",
    allowedRootOriginals: ["/workspace/m36"],
    allowedRootCanonicals: ["/workspace/m36"],
  })
  await db.query(
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
      VALUES ($1, $2, $1, 'project_m36', 'workspace_m36', '/workspace/m36', '/workspace/m36', $3::jsonb, 'lcm_active', 36, 1, $4, $4)
    `,
    [conversationID, sessionID, JSON.stringify(boundary), now],
  )

  const history = userMessage("msg_m36_user_history", "history user text m36", 1)
  const assistant = assistantToolMessage("msg_m36_user_history")
  const current = userMessage("msg_m36_user_current", "current user text m36", 5)
  const historyRowID = await seedMessage(db, history, 1)
  const assistantRowID = await seedMessage(db, assistant, 2)
  const currentRowID = await seedMessage(db, current, 5)

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
      VALUES ('sum_m36_provider', $1, 'sprig', 'provider-safe m36 summary text', 100, 10, 1, 'summary-leaf-v2', 'upward', 'accepted', 'none', $2)
    `,
    [conversationID, now + 3],
  )
  await db.query(
    `
      INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order)
      VALUES ('sum_m36_provider', $1, 1)
    `,
    [historyRowID],
  )

  const rows = [
    ["ctx_m36_history", 1, "raw_message", historyRowID, null, null],
    ["ctx_m36_assistant", 2, "raw_message", assistantRowID, null, null],
    ["ctx_m36_summary", 3, "summary", null, "sum_m36_provider", null],
    ["ctx_m36_cue", 4, "retrieval_cue", null, null, cuePayload()],
    ["ctx_m36_current", 5, "raw_message", currentRowID, null, null],
  ] as const
  for (const [contextItemID, order, itemType, messageRowID, summaryID, cue] of rows) {
    await db.query(
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          message_row_id,
          summary_id,
          cue_id,
          cue_payload_json,
          cue_lifecycle_state,
          cue_target_source_message_id,
          cue_generation_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $12)
      `,
      [
        contextItemID,
        conversationID,
        order,
        itemType,
        messageRowID,
        summaryID,
        cue ? "cue_m36_provider" : null,
        cue ? JSON.stringify(cue) : null,
        cue ? "active" : null,
        cue ? "msg_m36_user_current" : null,
        cue ? "cuegen_m36_provider" : null,
        now + order,
      ],
    )
  }
}

function visibility(): LcmMessageVisibilityInput {
  return {
    version: "kilo-prompt-queue-visibility-v1",
    hash: "m36-visible",
    visibleMessageIDs: ["msg_m36_user_history", "msg_m36_assistant_tool", "msg_m36_user_current"],
    hiddenMessageIDs: [],
  }
}

function renderPreparation(): LcmRawLeafRenderPreparationInput {
  return {
    sessionID,
    session: fakeSession(),
    agent: fakeAgent(),
    model: fakeModel(),
    permissionProfile: fakeSession().permission as Permission.Ruleset,
    taskCapabilityClass: "root",
    messageVisibility: visibility(),
    envCache: {},
    clock: makeFixtureClock(now + 10),
    stripMedia: false,
    format: { type: "text" },
    lastUser: {
      id: MessageID.make("msg_m36_user_current"),
      sessionID,
      role: "user",
      time: { created: now + 5 },
      agent: "code",
      model: { providerID, modelID },
    },
    prepareRenderOnlyMessages: ({ messages }) => Effect.succeed(messages),
    transformMessages: () => Effect.void,
    resolveSystem: () => Effect.succeed(["m36 system"]),
    resolveTools: () => Effect.succeed({}),
  }
}

function renderOptions(): LcmAssemblyInput["renderOptions"] {
  return {
    providerID,
    modelID,
    providerMediaCapability: "supports_media" as const,
    stripMedia: false,
    taskCapabilityClass: "root" as const,
  }
}

function thresholdInput(renderOptionsOverride = renderOptions()): LcmRawLeafThresholdInput {
  return {
    conversationID,
    renderOptions: renderOptionsOverride,
    providerContextLimit: 100_000,
    providerOutputLimit: 8_192,
    renderPreparation: renderPreparation(),
  }
}

function assemblyInput(renderOptionsOverride = renderOptions()): LcmAssemblyInput & {
  renderPreparation: LcmRawLeafRenderPreparationInput
} {
  return {
    sessionID,
    conversationID,
    targetCurrentUser: {
      sourceSessionID: sessionID,
      sourceMessageID: "msg_m36_user_current",
      messageRowID: "msg_m36_row_5",
      promptOperationID: operationID("current"),
      visibilityBaseMessageID: "msg_m36_user_current",
    },
    renderOptions: renderOptionsOverride,
    renderPreparation: renderPreparation(),
  }
}

async function latestSnapshot(worker: ReturnType<typeof createLcmDbWorker>) {
  const rows = await query<{
    active_tokens: number
    restore_manifest_json: unknown
    metrics_json: unknown
  }>(
    worker,
    `
      SELECT active_tokens, restore_manifest_json, metrics_json
      FROM lcm_context_snapshots
      WHERE conversation_id = $1
      ORDER BY created_at_ms DESC, snapshot_id DESC
      LIMIT 1
    `,
    [conversationID],
  )
  if (!rows[0]) throw new Error("missing snapshot")
  return rows[0]
}

test("lcm:assembly-token-budget writes provider-safe v2 snapshots and active render-unit counts", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))

    const threshold = await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(thresholdInput())),
    )
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.assembleModelMessages({
          ...assemblyInput(),
          threshold,
        } as Parameters<typeof svc.assembleModelMessages>[0]),
      ),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)

    expect(threshold.activeTokens).toBe(assembly.activeTokens)

    const snapshot = await latestSnapshot(worker)
    const preFinalManifest = jsonValue(snapshot.restore_manifest_json) as Record<string, unknown> & {
      items: Array<Record<string, unknown>>
    }
    const preFinalMetrics = jsonValue(snapshot.metrics_json) as Record<string, unknown>
    const preFinalProviderSafe = preFinalMetrics.providerSafe as Record<string, unknown>
    expect(preFinalManifest.schemaVersion).toBe(LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION)
    expect(snapshot.active_tokens).toBe(threshold.activeTokens)
    expect(preFinalManifest.activeTokens).toBe(threshold.activeTokens)
    expect(preFinalManifest.items).toHaveLength(5)
    expect(
      preFinalManifest.items.every((item) => typeof item.renderUnitID === "string" && item.renderUnitID.length > 0),
    ).toBe(true)
    expect(preFinalManifest.items.find((item) => item.contextItemID === "ctx_m36_current")?.placementSlot).toBe(
      "current_user",
    )
    expect(preFinalManifest.items.find((item) => item.contextItemID === "ctx_m36_cue")?.placementSlot).toBe(
      "before_current_user",
    )
    expect(preFinalManifest.providerValidatorHash).toBe("lcm-provider-validator-pending-m39-v1")
    expect(typeof preFinalManifest.requestSnapshotProtectionHash).toBe("string")
    expect((preFinalManifest.requestSnapshotProtectionHash as string).length).toBeGreaterThan(0)
    expect(preFinalProviderSafe.schemaVersion).toBe("lcm-provider-safe-snapshot-identity-v1")
    expect(preFinalProviderSafe.renderUnitOrderHash).toBe(preFinalManifest.renderUnitOrderHash)
    expect(preFinalProviderSafe.effectivePlacementHash).toBe(preFinalManifest.effectivePlacementHash)
    expect(preFinalProviderSafe.sourceSelectionHash).toBe(preFinalManifest.sourceSelectionHash)
    expect(preFinalProviderSafe.requestSnapshotProtectionHash).toBe(preFinalManifest.requestSnapshotProtectionHash)
    expect(preFinalProviderSafe.visibilityHash).toBe(preFinalManifest.visibilityHash)
    expect(preFinalProviderSafe.protectedSpanHash).toBe(preFinalManifest.protectedSpanHash)
    expect(preFinalProviderSafe.providerTransformHash).toBe(preFinalManifest.providerTransformHash)
    expect(preFinalProviderSafe.providerValidatorHash).toBe(preFinalManifest.providerValidatorHash)
    expect(preFinalProviderSafe.assemblyValidatorHash).toBe(preFinalManifest.assemblyValidatorHash)

    const rows = await query<{ token_count: number; cache_key: string | null; cache_version: number | null }>(
      worker,
      `
        SELECT token_count, cache_key, cache_version
        FROM lcm_context_items
        WHERE conversation_id = $1
        ORDER BY item_order
      `,
      [conversationID],
    )
    expect(rows.reduce((total, row) => total + row.token_count, 0)).toBe(threshold.activeTokens)
    expect(
      rows.every(
        (row) =>
          typeof row.cache_key === "string" &&
          row.cache_key.length === 64 &&
          row.cache_version === LCM_TOKEN_BUDGET_CACHE_VERSION,
      ),
    ).toBe(true)

    const finalProviderValidatorHash = "lcm-provider-validator-v1:test-final"
    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.recordProviderRequestSnapshotFinalValidation({
          requestSnapshotID: assembly.providerRequestSnapshotID,
          conversationID,
          providerValidatorHash: finalProviderValidatorHash,
        }),
      ),
    )

    const finalSnapshot = await latestSnapshot(worker)
    const finalManifest = jsonValue(finalSnapshot.restore_manifest_json) as Record<string, unknown> & {
      items: Array<Record<string, unknown>>
    }
    const finalMetrics = jsonValue(finalSnapshot.metrics_json) as Record<string, unknown>
    const finalProviderSafe = finalMetrics.providerSafe as Record<string, unknown>
    expect(finalManifest.providerValidatorHash).toBe(finalProviderValidatorHash)
    expect(finalProviderSafe.providerValidatorHash).toBe(finalProviderValidatorHash)
    expect(finalManifest.items.every((item) => item.cacheKey === undefined && item.cacheVersion === undefined)).toBe(
      true,
    )

    const finalRows = await query<{ token_count: number; cache_key: string | null; cache_version: number | null }>(
      worker,
      `
        SELECT token_count, cache_key, cache_version
        FROM lcm_context_items
        WHERE conversation_id = $1
        ORDER BY item_order
      `,
      [conversationID],
    )
    expect(finalRows.reduce((total, row) => total + row.token_count, 0)).toBe(threshold.activeTokens)
    expect(finalRows.every((row) => row.cache_key === null && row.cache_version === null)).toBe(true)
  } finally {
    await worker.close()
  }
})

test("lcm:assembly-token-budget changes cache identity for source placement and rejects scalar alias conflicts", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(thresholdInput())),
    )

    const firstSnapshot = await latestSnapshot(worker)
    const firstManifest = jsonValue(firstSnapshot.restore_manifest_json) as Record<string, unknown>
    const firstRows = await query<{ context_item_id: string; cache_key: string }>(
      worker,
      "SELECT context_item_id, cache_key FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
      [conversationID],
    )
    const firstSummaryKey = firstRows.find((row) => row.context_item_id === "ctx_m36_summary")?.cache_key

    await worker.executeForeground(
      request({
        run: async (db) => {
          await (db as PGlite).query(
            `
              UPDATE lcm_context_items
              SET item_order = CASE context_item_id
                WHEN 'ctx_m36_summary' THEN -4
                WHEN 'ctx_m36_cue' THEN -3
                ELSE item_order
              END
              WHERE conversation_id = $1
            `,
            [conversationID],
          )
          await (db as PGlite).query(
            `
              UPDATE lcm_context_items
              SET item_order = -item_order
              WHERE conversation_id = $1 AND item_order < 0
            `,
            [conversationID],
          )
        },
      }),
    )
    await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(thresholdInput())),
    )

    const secondSnapshot = await latestSnapshot(worker)
    const secondManifest = jsonValue(secondSnapshot.restore_manifest_json) as Record<string, unknown>
    const secondRows = await query<{ context_item_id: string; cache_key: string }>(
      worker,
      "SELECT context_item_id, cache_key FROM lcm_context_items WHERE conversation_id = $1 ORDER BY item_order",
      [conversationID],
    )
    const secondSummaryKey = secondRows.find((row) => row.context_item_id === "ctx_m36_summary")?.cache_key
    expect(secondManifest.sourceSelectionHash).not.toBe(firstManifest.sourceSelectionHash)
    expect(secondSummaryKey).not.toBe(firstSummaryKey)

    const rejected = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.assembleModelMessages(
          assemblyInput({
            ...renderOptions(),
            assemblyValidatorHash: "wrong-assembly-validator",
          }),
        ),
      ),
    )
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.safeError.diagnosticCode).toBe("lcm_render_options_alias_mismatch_assemblyValidatorHash")
    }
  } finally {
    await worker.close()
  }
})

test("lcm:assembly-token-budget cooperatively cancels after render preparation and skips snapshots", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const controller = new AbortController()
    const input = thresholdInput()
    const canceledInput = {
      ...input,
      abortSignal: controller.signal,
      renderPreparation: {
        ...input.renderPreparation!,
        prepareRenderOnlyMessages: ({ messages }) =>
          Effect.sync(() => {
            controller.abort()
            return messages
          }),
      },
    } satisfies LcmRawLeafThresholdInput

    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) => svc.isOverThreshold(canceledInput)),
      ),
    ).rejects.toMatchObject({
      code: "canceled",
      diagnosticCode: "lcm_threshold_canceled_after_render_preparation",
    })

    const snapshots = await query<{ count: number | string | bigint }>(
      worker,
      "SELECT COUNT(*) AS count FROM lcm_context_snapshots WHERE conversation_id = $1",
      [conversationID],
    )
    expect(Number(snapshots[0]?.count ?? 0)).toBe(0)
  } finally {
    await worker.close()
  }
})

test("lcm:assembly-token-budget clears non-provider snapshot token cache metadata during snapshot repair", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    await runContext(
      worker,
      LcmContextService.use((svc) => svc.isOverThreshold(thresholdInput())),
    )

    await worker.executeForeground(
      request({
        run: async (db) => {
          const manifest = await writeContextSnapshot({
            db: db as PGlite,
            conversationID,
            reason: "non-provider-snapshot-fixture",
            nowMs: Date.now() + 10_000,
          })
          expect(manifest.schemaVersion).toBe(LCM_CONTEXT_RESTORE_MANIFEST_VERSION)
          await (db as PGlite).query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])
        },
      }),
    )

    const rebuilt = await runContext(
      worker,
      LcmContextService.use((svc) => svc.rebuildActiveContext({ conversationID, reason: "non-provider-cache-clear" })),
    )
    expect(rebuilt).toMatchObject({ status: "rebuilt", itemsRebuilt: 5 })

    const rows = await query<{ token_count: number | null; cache_key: string | null; cache_version: number | null }>(
      worker,
      `
        SELECT token_count, cache_key, cache_version
        FROM lcm_context_items
        WHERE conversation_id = $1
        ORDER BY item_order
      `,
      [conversationID],
    )
    expect(rows).toHaveLength(5)
    expect(rows).toEqual([
      { token_count: null, cache_key: null, cache_version: null },
      { token_count: null, cache_key: null, cache_version: null },
      { token_count: null, cache_key: null, cache_version: null },
      { token_count: null, cache_key: null, cache_version: null },
      { token_count: null, cache_key: null, cache_version: null },
    ])
  } finally {
    await worker.close()
  }
})
