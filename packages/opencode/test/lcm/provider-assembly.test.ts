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
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import {
  LcmContext,
  normalizeModelMessagesForRawLeafParity,
  Service as LcmContextService,
  createProviderTransformOverheadRenderUnitID,
  validateLcmPreparedProviderPayloadForAssembly,
  type LcmRawLeafRenderPreparationInput,
} from "../../src/session/lcm/context"
import { getLcmRuntimePreparedProviderPayload } from "../../src/session/lcm/provider-payload"
import { makeFixtureClock, type LcmMessageVisibilityInput } from "../../src/session/lcm/render-prep"
import type {
  ConversationID,
  LcmAssemblyInput,
  LcmDbRequest,
  LcmRetrievalCuePayload,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const now = 1_777_500_350_000
const conversationID = "conv_m35_provider_assembly" as ConversationID
const sessionID = SessionID.make("ses_m35_provider_assembly")
const providerID = "provider-m35" as ProviderID
const modelID = "model-m35" as ModelID

function operationID(suffix: string): OperationID {
  return `op_m35_${suffix}` as OperationID
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
    name: "M35 Provider Assembly Model",
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
    projectID: "project_m35",
    directory: "/workspace/m35",
    title: "provider assembly",
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
  const messageID = MessageID.make("msg_m35_assistant_tool")
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
      path: { cwd: "/workspace/m35", root: "/workspace/m35" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: PartID.make("prt_m35_tool_completed"),
        sessionID,
        messageID,
        type: "tool",
        callID: "call_m35_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo ok" },
          output: "tool output m35",
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
  const messageRowID = `msg_m35_row_${order}`
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
        part.type === "text" ? serializeMessagePartSearchText({ textContent: part.text }) : "tool output m35",
        now + order + partIndex,
        part.type === "tool" ? now + order + partIndex + 1 : null,
      ],
    )
  }
  return messageRowID
}

function cuePayload(): LcmRetrievalCuePayload {
  return {
    query: "recent tool result",
    cueText: "Use the adjacent tool result before answering.",
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
    projectID: "project_m35",
    workspaceID: "workspace_m35",
    sessionDirectoryOriginal: "/workspace/m35",
    sessionDirectoryCanonical: "/workspace/m35",
    worktreeOriginal: "/workspace/m35",
    worktreeCanonical: "/workspace/m35",
    allowedRootOriginals: ["/workspace/m35"],
    allowedRootCanonicals: ["/workspace/m35"],
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
      VALUES ($1, $2, $1, 'project_m35', 'workspace_m35', '/workspace/m35', '/workspace/m35', $3::jsonb, 'lcm_active', 35, 1, $4, $4)
    `,
    [conversationID, sessionID, JSON.stringify(boundary), now],
  )

  const history = userMessage("msg_m35_user_history", "history user text", 1)
  const assistant = assistantToolMessage("msg_m35_user_history")
  const current = userMessage("msg_m35_user_current", "current user text", 5)
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
      VALUES ('sum_m35_provider', $1, 'sprig', 'provider-safe summary text', 100, 10, 1, 'summary-leaf-v2', 'upward', 'accepted', 'none', $2)
    `,
    [conversationID, now + 3],
  )
  await db.query(
    `
      INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order)
      VALUES ('sum_m35_provider', $1, 1)
    `,
    [historyRowID],
  )

  const rows = [
    ["ctx_m35_history", 1, "raw_message", historyRowID, null, null],
    ["ctx_m35_assistant", 2, "raw_message", assistantRowID, null, null],
    ["ctx_m35_summary", 3, "summary", null, "sum_m35_provider", null],
    ["ctx_m35_cue", 4, "retrieval_cue", null, null, cuePayload()],
    ["ctx_m35_current", 5, "raw_message", currentRowID, null, null],
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
        cue ? "cue_m35_provider" : null,
        cue ? JSON.stringify(cue) : null,
        cue ? "active" : null,
        cue ? "msg_m35_user_current" : null,
        cue ? "cuegen_m35_provider" : null,
        now + order,
      ],
    )
  }
}

function visibility(): LcmMessageVisibilityInput {
  return {
    version: "kilo-prompt-queue-visibility-v1",
    hash: "m35-visible",
    visibleMessageIDs: ["msg_m35_user_history", "msg_m35_assistant_tool", "msg_m35_user_current"],
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
      id: MessageID.make("msg_m35_user_current"),
      sessionID,
      role: "user",
      time: { created: now + 5 },
      agent: "code",
      model: { providerID, modelID },
    },
    prepareRenderOnlyMessages: ({ messages }) => Effect.succeed(messages),
    transformMessages: () => Effect.void,
    resolveSystem: () => Effect.succeed(["m35 system"]),
    resolveTools: () => Effect.succeed({}),
  }
}

function assemblyInput(): LcmAssemblyInput & { renderPreparation: LcmRawLeafRenderPreparationInput } {
  return {
    sessionID,
    conversationID,
    targetCurrentUser: {
      sourceSessionID: sessionID,
      sourceMessageID: "msg_m35_user_current",
      messageRowID: "msg_m35_row_5",
      promptOperationID: operationID("current"),
      visibilityBaseMessageID: "msg_m35_user_current",
    },
    renderOptions: {
      providerID,
      modelID,
      providerMediaCapability: "supports_media",
      stripMedia: false,
      taskCapabilityClass: "root",
    },
    renderPreparation: renderPreparation(),
  }
}

test("lcm:provider-assembly builds render units, protected spans, and coherent payloads", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput())),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)

    expect(assembly.renderedSpans.length).toBe(assembly.contextItems.length)
    expect(assembly.preparedProviderPayload.renderedSpans).toEqual(assembly.renderedSpans)
    expect(assembly.preparedProviderPayload.renderInputManifest.assemblyValidatorHash).toBe(
      assembly.preparedProviderPayload.assemblyValidatorHash,
    )
    const runtimePayload = getLcmRuntimePreparedProviderPayload(assembly.preparedProviderPayload)
    expect(runtimePayload?.system).toEqual(["m35 system"])
    expect(runtimePayload?.tools).toEqual({})
    expect(runtimePayload?.modelMessages).toBe(assembly.modelMessages)
    expect(assembly.renderedSpans.filter((span) => span.sourceKind === "target_current_user")).toHaveLength(1)
    expect(assembly.renderedSpans.every((span) => span.spanHash.startsWith("lcm-rendered-span-v1:"))).toBe(true)
    expect(assembly.preparedProviderPayload.renderInputManifest.renderUnitOrderHash).toStartWith(
      "lcm-render-unit-order-v1:",
    )

    const protectedSpan = assembly.renderedSpans.find((span) => span.protected)
    expect(protectedSpan?.protectedReason).toBe("assistant_tool_results")
    expect(protectedSpan?.protocolSpanID).toStartWith("lcm-protocol-span-v1:")

    const projection = normalizeModelMessagesForRawLeafParity(assembly.modelMessages) as unknown[]
    const serialized = projection.map((message) => JSON.stringify(message))
    const assistantIndex = serialized.findIndex((message) => message.includes("tool-call"))
    const toolResultIndex = serialized.findIndex((message) => message.includes("tool-result"))
    const summaryIndex = serialized.findIndex((message) => message.includes("provider-safe summary text"))
    const cueIndex = serialized.findIndex((message) =>
      message.includes("Use the adjacent tool result before answering."),
    )
    expect(assistantIndex).toBeGreaterThanOrEqual(0)
    expect(toolResultIndex).toBe(assistantIndex + 1)
    expect(summaryIndex).toBeGreaterThan(toolResultIndex)
    expect(cueIndex).toBeGreaterThan(summaryIndex)
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly snapshots only matching active cues and finalizes request lifecycle", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    await worker.executeForeground(
      request({
        run: async (db) => {
          await (db as PGlite).query(
            `
              INSERT INTO lcm_context_items (
                context_item_id,
                conversation_id,
                item_order,
                item_type,
                cue_id,
                cue_payload_json,
                cue_lifecycle_state,
                cue_target_source_message_id,
                cue_generation_id,
                created_at_ms,
                updated_at_ms
              )
              VALUES
                (
                  'ctx_m35_old_active_cue',
                  $1,
                  6,
                  'retrieval_cue',
                  'cue_m35_old_active',
                  $2::jsonb,
                  'active',
                  'msg_m35_previous_user',
                  'cuegen_m35_old_active',
                  $3,
                  $3
                ),
                (
                  'ctx_m35_superseded_cue',
                  $1,
                  7,
                  'retrieval_cue',
                  'cue_m35_superseded',
                  $4::jsonb,
                  'superseded',
                  'msg_m35_user_current',
                  'cuegen_m35_superseded',
                  $3,
                  $3
                )
            `,
            [
              conversationID,
              JSON.stringify({
                ...cuePayload(),
                cueText: "Do not render the old active cue.",
                generatedAt: new Date(now + 20).toISOString(),
              }),
              now + 20,
              JSON.stringify({
                ...cuePayload(),
                cueText: "Do not render the superseded cue.",
                generatedAt: new Date(now + 21).toISOString(),
              }),
            ],
          )
        },
      }),
    )

    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput())),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)
    const projection = JSON.stringify(normalizeModelMessagesForRawLeafParity(assembly.modelMessages))
    expect(projection).toContain("Use the adjacent tool result before answering.")
    expect(projection).not.toContain("Do not render the old active cue.")
    expect(projection).not.toContain("Do not render the superseded cue.")
    expect(assembly.preparedProviderPayload.providerRequestSnapshotID).toBe(assembly.providerRequestSnapshotID)

    const snapshots = await query<{
      status: string
      cue_ids_json: unknown
      render_unit_ids_json: unknown
      created_at_ms: number | string | bigint
      expires_at_ms: number | string | bigint
      terminal_at_ms: number | string | bigint | null
    }>(
      worker,
      `
        SELECT status, cue_ids_json, render_unit_ids_json, created_at_ms, expires_at_ms, terminal_at_ms
        FROM lcm_provider_request_snapshots
        WHERE request_snapshot_id = $1
      `,
      [assembly.providerRequestSnapshotID],
    )
    expect(snapshots).toHaveLength(1)
    const snapshot = snapshots[0]!
    expect(snapshot.status).toBe("in_flight")
    expect(snapshot.terminal_at_ms).toBeNull()
    expect(Number(snapshot.expires_at_ms) - Number(snapshot.created_at_ms)).toBe(30 * 60 * 1000)
    expect(jsonValue(snapshot.cue_ids_json)).toEqual(["cue_m35_provider"])
    expect(jsonValue(snapshot.render_unit_ids_json)).toEqual(assembly.renderedSpans.map((span) => span.renderUnitID))
    const snapshotItems = await query<{ item_count: number; raw_count: number }>(
      worker,
      `
        SELECT count(*)::int AS item_count,
               count(*) FILTER (WHERE item_type = 'raw_message')::int AS raw_count
        FROM lcm_provider_request_snapshot_items
        WHERE request_snapshot_id = $1
      `,
      [assembly.providerRequestSnapshotID],
    )
    expect(snapshotItems[0]?.item_count).toBeGreaterThan(0)
    expect(snapshotItems[0]?.raw_count).toBeGreaterThan(0)

    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.finalizeProviderRequestSnapshot({
          requestSnapshotID: assembly.providerRequestSnapshotID,
          status: "resolved",
          nowMs: now + 30,
        }),
      ),
    )
    const finalized = await query<{ status: string; terminal_at_ms: number | string | bigint | null }>(
      worker,
      "SELECT status, terminal_at_ms FROM lcm_provider_request_snapshots WHERE request_snapshot_id = $1",
      [assembly.providerRequestSnapshotID],
    )
    expect(finalized[0]?.status).toBe("resolved")
    expect(Number(finalized[0]?.terminal_at_ms)).toBe(now + 30)
    const consumed = await query<{ count: number }>(
      worker,
      "SELECT count(*)::int AS count FROM lcm_context_item_consumption WHERE first_request_snapshot_id = $1",
      [assembly.providerRequestSnapshotID],
    )
    expect(consumed[0]?.count).toBe(snapshotItems[0]?.raw_count)

    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) =>
          svc.finalizeProviderRequestSnapshot({
            requestSnapshotID: assembly.providerRequestSnapshotID,
            conversationID,
            status: "canceled",
            nowMs: now + 31,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      diagnosticCode: "lcm_provider_request_snapshot_terminalization_unavailable",
    })
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly excludes DB-loaded hidden queued raw and derived context", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const input = assemblyInput()
    const hiddenInput = {
      ...input,
      renderPreparation: {
        ...input.renderPreparation,
        messageVisibility: {
          version: "kilo-prompt-queue-visibility-v1",
          hash: "m38-hidden-history",
          visibleMessageIDs: ["msg_m35_user_current"],
          hiddenMessageIDs: ["msg_m35_user_history", "msg_m35_assistant_tool"],
        },
      },
    } satisfies ReturnType<typeof assemblyInput>
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(hiddenInput)),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)

    const projection = JSON.stringify(normalizeModelMessagesForRawLeafParity(assembly.modelMessages))
    expect(projection).not.toContain("history user text")
    expect(projection).not.toContain("tool output m35")
    expect(projection).not.toContain("provider-safe summary text")
    expect(projection).toContain("current user text")
    expect(assembly.renderedSpans.length).toBeLessThan(assembly.contextItems.length)
    expect(assembly.preparedProviderPayload.renderInputManifest.messageVisibilityHash).toBe("m38-hidden-history")
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly fails closed when a required target or cue provenance is hidden", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const targetHiddenInput = assemblyInput()
    const targetHiddenAssemblyInput = {
      ...targetHiddenInput,
      renderPreparation: {
        ...targetHiddenInput.renderPreparation,
        messageVisibility: {
          version: "kilo-prompt-queue-visibility-v1",
          hash: "m38-hidden-target",
          visibleMessageIDs: ["msg_m35_user_history", "msg_m35_assistant_tool"],
          hiddenMessageIDs: ["msg_m35_user_current"],
        },
      },
    } satisfies ReturnType<typeof assemblyInput>
    const targetHidden = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(targetHiddenAssemblyInput)),
    )
    expect(targetHidden.ok).toBe(false)
    if (!targetHidden.ok)
      expect(targetHidden.safeError.diagnosticCode).toBe("lcm_provider_assembly_target_current_user_hidden")

    await worker.executeForeground(
      request({
        run: async (db) => {
          await (db as PGlite).query(
            `
              UPDATE lcm_context_items
              SET cue_payload_json = $1::jsonb
              WHERE context_item_id = 'ctx_m35_cue'
            `,
            [
              JSON.stringify({
                ...cuePayload(),
                messageRowIDs: ["msg_m35_row_1"],
              }),
            ],
          )
        },
      }),
    )
    const cueHiddenInput = assemblyInput()
    const cueHiddenAssemblyInput = {
      ...cueHiddenInput,
      renderPreparation: {
        ...cueHiddenInput.renderPreparation,
        messageVisibility: {
          version: "kilo-prompt-queue-visibility-v1",
          hash: "m38-hidden-cue-source",
          visibleMessageIDs: ["msg_m35_user_current"],
          hiddenMessageIDs: ["msg_m35_user_history", "msg_m35_assistant_tool"],
        },
      },
    } satisfies ReturnType<typeof assemblyInput>
    const cueHidden = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(cueHiddenAssemblyInput)),
    )
    expect(cueHidden.ok).toBe(false)
    if (!cueHidden.ok)
      expect(cueHidden.safeError.diagnosticCode).toBe("lcm_provider_assembly_retrieval_cue_hidden_source")
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly cue replacement preserves in-flight referenced cues until terminal cleanup", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput())),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)

    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.replaceRetrievalCues({
          conversationID,
          targetCurrentUserSourceMessageID: "msg_m35_next_user",
          cuePayloads: [
            {
              ...cuePayload(),
              cueText: "Replacement cue for the next user turn.",
              generatedAt: new Date(now + 40).toISOString(),
            },
          ],
          nowMs: now + 40,
        }),
      ),
    )
    const protectedRows = await query<{
      cue_id: string
      cue_lifecycle_state: string
      cue_superseded_by_id: string | null
      cue_superseded_by_generation_id: string | null
    }>(
      worker,
      `
        SELECT cue_id, cue_lifecycle_state, cue_superseded_by_id, cue_superseded_by_generation_id
        FROM lcm_context_items
        WHERE conversation_id = $1 AND item_type = 'retrieval_cue'
        ORDER BY item_order
      `,
      [conversationID],
    )
    expect(protectedRows.map((row) => row.cue_lifecycle_state)).toEqual(["active", "superseded"])
    const protectedOriginal = protectedRows.find((row) => row.cue_id === "cue_m35_provider")
    expect(protectedOriginal?.cue_superseded_by_id).toBe(
      protectedRows.find((row) => row.cue_lifecycle_state === "active")?.cue_id,
    )
    expect(protectedOriginal?.cue_superseded_by_generation_id).toStartWith("cuegen_")

    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.finalizeProviderRequestSnapshot({
          requestSnapshotID: assembly.providerRequestSnapshotID,
          status: "resolved",
          nowMs: now + 50,
        }),
      ),
    )
    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.replaceRetrievalCues({
          conversationID,
          targetCurrentUserSourceMessageID: "msg_m35_later_user",
          cuePayloads: [
            {
              ...cuePayload(),
              cueText: "Later replacement cue after provider resolution.",
              generatedAt: new Date(now + 60).toISOString(),
            },
          ],
          nowMs: now + 60,
        }),
      ),
    )
    const cleanedRows = await query<{ cue_id: string; cue_lifecycle_state: string }>(
      worker,
      `
        SELECT cue_id, cue_lifecycle_state
        FROM lcm_context_items
        WHERE conversation_id = $1 AND item_type = 'retrieval_cue'
        ORDER BY item_order
      `,
      [conversationID],
    )
    expect(cleanedRows).toHaveLength(1)
    expect(cleanedRows[0]?.cue_lifecycle_state).toBe("active")
    expect(cleanedRows[0]?.cue_id).not.toBe("cue_m35_provider")
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly family close cancels in-flight request snapshots", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  let worker = await initialize(dataDir)
  const assemblyID = await (async () => {
    try {
      await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
      const assembly = await runContext(
        worker,
        LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput())),
      )
      if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)
      return assembly.providerRequestSnapshotID
    } finally {
      await worker.close()
    }
  })()

  worker = await initialize(dataDir)
  try {
    const snapshots = await query<{ status: string; terminal_at_ms: number | string | bigint | null }>(
      worker,
      "SELECT status, terminal_at_ms FROM lcm_provider_request_snapshots WHERE request_snapshot_id = $1",
      [assemblyID],
    )
    expect(snapshots[0]?.status).toBe("canceled")
    expect(Number(snapshots[0]?.terminal_at_ms)).toBeGreaterThan(0)
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly rejects empty-span payloads and reserves overhead pseudo IDs", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput())),
    )
    if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)

    const safeError = validateLcmPreparedProviderPayloadForAssembly({
      payload: {
        ...assembly.preparedProviderPayload,
        renderedSpans: [],
      },
    })
    expect(safeError?.diagnosticCode).toBe("lcm_provider_assembly_empty_spans")

    expect(
      createProviderTransformOverheadRenderUnitID({
        providerID,
        modelID,
        transformStage: "provider_transformed",
        index: 0,
        reason: "m39-placeholder",
      }),
    ).toBe(
      createProviderTransformOverheadRenderUnitID({
        providerID,
        modelID,
        transformStage: "provider_transformed",
        index: 0,
        reason: "m39-placeholder",
      }),
    )
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly does not create request snapshots for blocked assembly", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const input = assemblyInput()
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.assembleModelMessages({
          ...input,
          renderPreparation: {
            ...input.renderPreparation,
            messageVisibility: {
              version: "kilo-prompt-queue-visibility-v1",
              hash: "m35-hide-current-user",
              visibleMessageIDs: ["msg_m35_user_history", "msg_m35_assistant_tool"],
              hiddenMessageIDs: ["msg_m35_user_current"],
            },
          },
        } as LcmAssemblyInput & { renderPreparation: LcmRawLeafRenderPreparationInput }),
      ),
    )
    expect(assembly.ok).toBe(false)
    if (!assembly.ok) expect(assembly.safeError.diagnosticCode).toBe("lcm_provider_assembly_target_current_user_hidden")

    const snapshots = await query<{ count: number | string | bigint }>(
      worker,
      "SELECT COUNT(*) AS count FROM lcm_provider_request_snapshots",
    )
    expect(Number(snapshots[0]?.count ?? 0)).toBe(0)
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly cooperatively cancels after render preparation and does not snapshot", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const controller = new AbortController()
    const input = assemblyInput()
    const canceledInput = {
      ...input,
      abortSignal: controller.signal,
      renderPreparation: {
        ...input.renderPreparation,
        prepareRenderOnlyMessages: ({ messages }) =>
          Effect.sync(() => {
            controller.abort()
            return messages
          }),
      },
    } satisfies ReturnType<typeof assemblyInput> & { abortSignal: AbortSignal }

    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) => svc.assembleModelMessages(canceledInput)),
      ),
    ).rejects.toMatchObject({
      code: "canceled",
      diagnosticCode: "lcm_provider_assembly_canceled_after_render_preparation",
    })

    const snapshots = await query<{ count: number | string | bigint }>(
      worker,
      "SELECT COUNT(*) AS count FROM lcm_provider_request_snapshots",
    )
    expect(Number(snapshots[0]?.count ?? 0)).toBe(0)
  } finally {
    await worker.close()
  }
})

test("lcm:provider-assembly fails closed when the target current user is unproven", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    await worker.executeForeground(request({ run: async (db) => seedAssemblyConversation(db as PGlite) }))
    const input = assemblyInput()
    const assembly = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.assembleModelMessages({
          ...input,
          targetCurrentUser: {
            ...input.targetCurrentUser,
            sourceMessageID: "msg_m35_missing_current",
            messageRowID: "msg_m35_missing",
          },
          renderPreparation: {
            ...input.renderPreparation,
            lastUser: undefined,
          },
        } as LcmAssemblyInput & { renderPreparation: LcmRawLeafRenderPreparationInput }),
      ),
    )
    expect(assembly.ok).toBe(false)
    if (!assembly.ok)
      expect(assembly.safeError.diagnosticCode).toBe("lcm_provider_assembly_target_current_user_unproven")
  } finally {
    await worker.close()
  }
})
