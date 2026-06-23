// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Session as SessionRuntime } from "../../src/session/session"
import { LcmDb } from "../../src/session/lcm/db"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { MESSAGE_V2_SYNC_TAXONOMY, createSourcePartKey, syncFinalizedMessages } from "../../src/session/lcm/source-sync"
import type { OperationID } from "../../src/session/lcm/types"
import { TRUNCATION_DIR, truncationOutputMetadata } from "../../src/tool/truncation-dir"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

function operationID(suffix: string): OperationID {
  return `op_m06_${suffix}_${Date.now().toString(36)}` as OperationID
}

function runLcm<A, E>(effect: Effect.Effect<A, E, LcmDb.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.ensuring(LcmDb.Service.use((db) => db.close()).pipe(Effect.ignore)),
      Effect.provide(LcmDb.defaultLayer),
    ),
  )
}

function dbQuery<T>(sql: string, params: unknown[] = []) {
  return LcmDb.Service.use((svc) =>
    svc.executeForeground({
      operationID: operationID("query"),
      purpose: "debug_support",
      run: async (db) => (await (db as PGlite).query<T>(sql, params)).rows,
    }),
  )
}

function tokens() {
  return {
    input: 1,
    output: 1,
    reasoning: 0,
    cache: {
      read: 0,
      write: 0,
    },
  }
}

const providerID = "test-provider" as ProviderID
const modelID = "test-model" as ModelID

function runSession<A, E>(effect: Effect.Effect<A, E, SessionRuntime.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionRuntime.defaultLayer)))
}

const Session = {
  create: (input?: Parameters<SessionRuntime.Interface["create"]>[0]) =>
    runSession(SessionRuntime.Service.use((svc) => svc.create(input))),
  updateMessage: <T extends MessageV2.Info>(msg: T) =>
    runSession(SessionRuntime.Service.use((svc) => svc.updateMessage(msg))),
  updatePart: <T extends MessageV2.Part>(part: T) =>
    runSession(SessionRuntime.Service.use((svc) => svc.updatePart(part))),
}

async function createSession() {
  return Session.create({ title: "m06 finalized sync" })
}

async function seedSealedFixture(directory: string) {
  const session = await createSession()
  const now = 1_777_500_006_000
  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()

  const user = await Session.updateMessage<MessageV2.User>({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: now },
    agent: "build",
    model: { providerID, modelID, variant: "fast" },
    system: "system metadata",
    tools: { read: true },
    editorContext: {
      visibleFiles: ["src/a.ts"],
      activeFile: "src/a.ts",
    },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: user.id,
    type: "text",
    text: "hello source",
    synthetic: true,
  })

  const assistant = await Session.updateMessage<MessageV2.Assistant>({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    time: { created: now + 10, completed: now + 100 },
    parentID: user.id,
    providerID,
    modelID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: tokens(),
    finish: "stop",
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "text",
    text: "assistant text",
    time: { start: now + 20, end: now + 30 },
    metadata: { provider: "meta" },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "reasoning",
    text: "assistant reasoning",
    time: { start: now + 31, end: now + 40 },
  })
  const completedTool: MessageV2.ToolPart = await Session.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "tool",
    callID: "call_completed",
    tool: "read",
    state: {
      status: "completed",
      input: { zed: false, alpha: { beta: "needle" } },
      output: "tool output",
      title: "Read",
      metadata: { providerMeta: true },
      time: { start: now + 41, end: now + 50 },
      attachments: [
        {
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AA==",
          filename: "image.png",
        },
      ],
    },
    metadata: { providerExecuted: true },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "tool",
    callID: "call_error",
    tool: "bash",
    state: {
      status: "error",
      input: { cmd: "sleep" },
      error: "Tool execution aborted",
      metadata: { interrupted: true, output: "partial output" },
      time: { start: now + 51, end: now + 60 },
    },
  })

  return { session, user, completedTool }
}

test("syncs finalized messages and terminal parts idempotently with inline source metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, completedTool } = await provideTestInstance({
    directory: tmp.path,
    fn: () => seedSealedFixture(tmp.path),
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    sessionID: session.id,
    insertedMessages: 2,
    insertedParts: 5,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: false,
    lifecycleState: "passive_synced",
  })

  const syncedState = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      const rows = yield* dbQuery<{
        source_message_id: string
        part_kind: string
        terminal_state: string | null
        text_content: string | null
        reasoning_content: string | null
        tool_input_json: unknown
        tool_output_text: string | null
        tool_error_text: string | null
        content_storage_kind: string
        content_file_id: string | null
        content_sha256: string | null
        search_text: string
        synthetic: boolean
      }>(
        `
          SELECT m.source_message_id, p.part_kind, p.terminal_state, p.text_content, p.reasoning_content,
                 p.tool_input_json, p.tool_output_text, p.tool_error_text, p.content_storage_kind,
                 p.content_file_id, p.content_sha256, p.search_text, p.synthetic
          FROM lcm_message_parts p
          JOIN lcm_messages m ON m.message_row_id = p.message_row_id
          ORDER BY m.message_order, p.part_order
        `,
      )
      const contextRows = yield* dbQuery<{ item_order: number; item_type: string; source_message_id: string }>(
        `
          SELECT ci.item_order, ci.item_type, m.source_message_id
          FROM lcm_context_items ci
          JOIN lcm_messages m ON m.message_row_id = ci.message_row_id
          WHERE ci.conversation_id = (SELECT conversation_id FROM lcm_conversations WHERE source_session_id = $1)
          ORDER BY ci.item_order
        `,
        [session.id],
      )
      const snapshots = yield* dbQuery<{ snapshot_count: number; manifest_version: string }>(
        `
          SELECT
            count(*)::int AS snapshot_count,
            max(restore_manifest_json->>'schemaVersion') AS manifest_version
          FROM lcm_context_snapshots
          WHERE conversation_id = (SELECT conversation_id FROM lcm_conversations WHERE source_session_id = $1)
        `,
        [session.id],
      )
      return { rows, contextRows, snapshots }
    }),
  )

  const { rows, contextRows, snapshots } = syncedState
  expect(rows).toHaveLength(5)
  expect(rows[0]).toMatchObject({
    part_kind: "text",
    text_content: "hello source",
    synthetic: true,
    content_storage_kind: "inline",
    content_file_id: null,
  })
  expect(rows[0]?.content_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(rows[2]).toMatchObject({
    part_kind: "reasoning",
    reasoning_content: "assistant reasoning",
  })
  expect(rows[3]).toMatchObject({
    part_kind: "tool",
    terminal_state: "completed",
    tool_output_text: "tool output",
  })
  expect(rows[3]?.search_text).toContain('{"alpha":{"beta":"needle"},"zed":false}')
  expect(rows[4]).toMatchObject({
    part_kind: "tool",
    terminal_state: "error",
    tool_output_text: "partial output",
    tool_error_text: "Tool execution aborted",
  })
  expect(contextRows.map((row) => ({ item_order: row.item_order, item_type: row.item_type }))).toEqual([
    { item_order: 1, item_type: "raw_message" },
    { item_order: 2, item_type: "raw_message" },
  ])
  expect(new Set(contextRows.map((row) => row.source_message_id)).size).toBe(2)
  expect(snapshots[0]).toEqual({ snapshot_count: 1, manifest_version: "lcm-context-restore-manifest-v2" })

  const idempotent = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(idempotent).toMatchObject({
    insertedMessages: 0,
    insertedParts: 0,
    idempotent: true,
  })

  if (completedTool.state.status !== "completed") throw new Error("expected completed tool fixture")
  const completedState = completedTool.state
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      Session.updatePart({
        ...completedTool,
        state: {
          ...completedState,
          time: { ...completedState.time, compacted: Date.now() },
        },
      }),
  })
  const afterLegacyPrune = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(afterLegacyPrune).toMatchObject({
    insertedMessages: 0,
    insertedParts: 0,
    idempotent: true,
  })
})

test("sync re-pins the current user raw context when the source row already exists", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, user } = await provideTestInstance({
    directory: tmp.path,
    fn: () => seedSealedFixture(tmp.path),
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))

  const repaired = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      const conversation = yield* dbQuery<{ conversation_id: string }>(
        "SELECT conversation_id FROM lcm_conversations WHERE source_session_id = $1",
        [session.id],
      )
      const conversationID = conversation[0]!.conversation_id
      yield* dbQuery("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])

      const result = yield* syncFinalizedMessages({ sessionID: session.id, dataDir, upToMessageID: user.id })
      const rows = yield* dbQuery<{ source_message_id: string; item_order: number }>(
        `
          SELECT m.source_message_id, ci.item_order
          FROM lcm_context_items ci
          JOIN lcm_messages m ON m.message_row_id = ci.message_row_id
          WHERE ci.conversation_id = $1
          ORDER BY ci.item_order
        `,
        [conversationID],
      )
      return { result, rows }
    }),
  )

  expect(repaired.result).toMatchObject({
    insertedMessages: 0,
    insertedParts: 0,
    idempotent: false,
  })
  expect(repaired.rows).toEqual([{ source_message_id: user.id, item_order: 1 }])

  const idempotent = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir, upToMessageID: user.id }))
  expect(idempotent).toMatchObject({
    insertedMessages: 0,
    insertedParts: 0,
    idempotent: true,
  })
})

test("aborted finalized sync returns content-safe cancellation before mutating memory", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session } = await provideTestInstance({
    directory: tmp.path,
    fn: () => seedSealedFixture(tmp.path),
  })
  const abortController = new AbortController()
  abortController.abort()

  await expect(
    runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir, abortSignal: abortController.signal })),
  ).rejects.toMatchObject({
    code: "canceled",
    diagnosticCode: "lcm_sync_canceled_before_resolution",
  })

  const afterCancel = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(afterCancel).toMatchObject({
    insertedMessages: 2,
    insertedParts: 5,
    idempotent: false,
  })
})

test("skips streamed or unsealed assistant state without creating immutable rows", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_500
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      } satisfies MessageV2.User)
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "sealed user",
      })
      const assistant = await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
      } satisfies MessageV2.Assistant)
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "reasoning",
        text: "open reasoning",
        time: { start: now + 20 },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "tool",
        callID: "call_running",
        tool: "bash",
        state: {
          status: "running",
          input: { cmd: "sleep" },
          title: "Run",
          time: { start: now + 30 },
        },
      })
      return session
    },
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 1,
    insertedParts: 1,
    skippedUnsealedMessages: 1,
    skippedUnsealedParts: 2,
  })
  expect(result.safeError).toMatchObject({
    code: "missing_source",
    diagnosticCode: "lcm_sync_unsealed_source_skipped",
  })

  const counts = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ messages: number | string; parts: number | string }>(
        `
          SELECT
            (SELECT count(*) FROM lcm_messages) AS messages,
            (SELECT count(*) FROM lcm_message_parts) AS parts
        `,
      )
    }),
  )
  expect(Number(counts[0]?.messages)).toBe(1)
  expect(Number(counts[0]?.parts)).toBe(1)
})

test("ignores superseded empty unsealed assistant rows while syncing later durable user input", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_550
      const firstUser = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: firstUser.id,
        type: "text",
        text: "incomplete prompt before cancel",
      })
      await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10 },
        parentID: firstUser.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
      })
      const secondUser = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now + 20 },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: secondUser.id,
        type: "text",
        text: "missing details after cancel",
      })
      return session
    },
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 2,
    insertedParts: 2,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
  })
  expect(result.safeError).toBeUndefined()

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ role: string; message_order: number | string }>(
        "SELECT role, message_order FROM lcm_messages ORDER BY message_order",
      )
    }),
  )
  expect(rows.map((row) => ({ role: row.role, order: Number(row.message_order) }))).toEqual([
    { role: "user", order: 1 },
    { role: "user", order: 3 },
  ])
})

test("ignores superseded non-terminal assistant residue while syncing later durable user input", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_575
      const firstUser = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: firstUser.id,
        type: "text",
        text: "prompt before interrupted assistant residue",
      })
      const assistant = await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10 },
        parentID: firstUser.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "reasoning",
        text: "unfinished reasoning after cancel",
        time: { start: now + 20 },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "tool",
        callID: "call_running_superseded",
        tool: "bash",
        state: {
          status: "running",
          input: { cmd: "sleep" },
          title: "Run",
          time: { start: now + 30 },
        },
      })
      const secondUser = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now + 40 },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: secondUser.id,
        type: "text",
        text: "durable follow-up after cancel",
      })
      return session
    },
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 2,
    insertedParts: 2,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
  })
  expect(result.safeError).toBeUndefined()

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ role: string; message_order: number | string }>(
        "SELECT role, message_order FROM lcm_messages ORDER BY message_order",
      )
    }),
  )
  expect(rows.map((row) => ({ role: row.role, order: Number(row.message_order) }))).toEqual([
    { role: "user", order: 1 },
    { role: "user", order: 3 },
  ])
})

test("syncs finalized zero-part assistant metadata without creating a raw context item", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_600
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "sealed user before abort",
      })
      await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10, completed: now + 100 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
        error: new MessageV2.AbortedError({ message: "Aborted" }).toObject(),
      })
      return session
    },
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 2,
    insertedParts: 1,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: false,
  })

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ role: string; part_count: number | string; context_count: number | string }>(
        `
          SELECT m.role,
                 count(p.part_row_id)::int AS part_count,
                 count(ci.context_item_id)::int AS context_count
          FROM lcm_messages m
          LEFT JOIN lcm_message_parts p ON p.message_row_id = m.message_row_id
          LEFT JOIN lcm_context_items ci ON ci.message_row_id = m.message_row_id
          GROUP BY m.message_order, m.role
          ORDER BY m.message_order
        `,
      )
    }),
  )
  expect(
    rows.map((row) => ({ role: row.role, parts: Number(row.part_count), context: Number(row.context_count) })),
  ).toEqual([
    { role: "user", parts: 1, context: 1 },
    { role: "assistant", parts: 0, context: 0 },
  ])
})

test("adds raw context item when finalized parts arrive for existing metadata-only assistant", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, assistantID } = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_625
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "sealed user before late assistant part",
      })
      const assistant = await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10, completed: now + 100 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
        finish: "stop",
      })
      return { session, assistantID: assistant.id }
    },
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistantID,
        type: "text",
        text: "late finalized assistant text",
        time: { start: 1_777_500_006_655, end: 1_777_500_006_660 },
      }),
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 0,
    insertedParts: 1,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: false,
  })

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ role: string; part_count: number | string; context_count: number | string }>(
        `
          SELECT m.role,
                 count(p.part_row_id)::int AS part_count,
                 count(ci.context_item_id)::int AS context_count
          FROM lcm_messages m
          LEFT JOIN lcm_message_parts p ON p.message_row_id = m.message_row_id
          LEFT JOIN lcm_context_items ci ON ci.message_row_id = m.message_row_id
          GROUP BY m.message_order, m.role
          ORDER BY m.message_order
        `,
      )
    }),
  )
  expect(
    rows.map((row) => ({ role: row.role, parts: Number(row.part_count), context: Number(row.context_count) })),
  ).toEqual([
    { role: "user", parts: 1, context: 1 },
    { role: "assistant", parts: 1, context: 1 },
  ])
})

test("syncs terminal assistant error metadata even when completed time is missing", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_650
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "sealed user before terminal error",
      })
      await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
        finish: "error",
        error: new MessageV2.AbortedError({ message: "Aborted" }).toObject(),
      })
      return session
    },
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 2,
    insertedParts: 1,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: false,
  })

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ role: string; completed_at_ms: number | string | bigint | null; metadata_json: unknown }>(
        "SELECT role, completed_at_ms, metadata_json FROM lcm_messages ORDER BY message_order",
      )
    }),
  )
  expect(rows[1]?.role).toBe("assistant")
  expect(rows[1]?.completed_at_ms).toBeNull()
  expect(JSON.stringify(rows[1]?.metadata_json)).toContain("Aborted")
})

test("preserves current structured parts as metadata-only rows without text coercion", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const session = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_700
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "structured carrier",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "compaction",
        auto: true,
        overflow: false,
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "subtask",
        prompt: "subtask prompt is metadata in milestone 06",
        description: "subtask",
        agent: "explore",
        model: { providerID, modelID },
        command: "inspect",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "agent",
        name: "explore",
        source: { value: "@explore", start: 1, end: 8 },
      })

      const assistant = await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10, completed: now + 100 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
        finish: "stop",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "step-start",
        snapshot: "snap_start",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "snapshot",
        snapshot: "snap_current",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "patch",
        hash: "patch_hash",
        files: ["src/a.ts"],
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "retry",
        attempt: 1,
        error: new MessageV2.APIError({ message: "retryable", isRetryable: true }).toObject() as MessageV2.APIError,
        time: { created: now + 20 },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "step-finish",
        reason: "stop",
        snapshot: "snap_end",
        cost: 0,
        tokens: tokens(),
      })
      return session
    },
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{
        part_kind: string
        text_content: string | null
        reasoning_content: string | null
        tool_output_text: string | null
        content_sha256: string | null
        search_text: string
      }>(
        `
          SELECT part_kind, text_content, reasoning_content, tool_output_text, content_sha256, search_text
          FROM lcm_message_parts
          WHERE part_kind <> 'text'
          ORDER BY part_kind
        `,
      )
    }),
  )

  expect(rows.map((row) => row.part_kind)).toEqual([
    "agent",
    "compaction",
    "patch",
    "retry",
    "snapshot",
    "step-finish",
    "step-start",
    "subtask",
  ])
  for (const row of rows) {
    expect(row.text_content).toBeNull()
    expect(row.reasoning_content).toBeNull()
    expect(row.tool_output_text).toBeNull()
    expect(row.content_sha256).toBeNull()
    expect(row.search_text).toBe("")
  }
})

test("sync stores validated truncated tool sidecars as full LCM tool output artifacts", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const validPath = path.join(TRUNCATION_DIR, `tool_${suffix}_valid_lcm_sidecar`)
  const invalidPath = path.join(tmp.path, "outside-tool-output")
  const validText = ["LCM_VALID_SIDECAR_START", "x".repeat(55_000), "LCM_VALID_SIDECAR_END"].join("\n")
  const invalidText = ["LCM_INVALID_SIDECAR_START", "y".repeat(55_000), "LCM_INVALID_SIDECAR_END"].join("\n")

  await fs.mkdir(TRUNCATION_DIR, { recursive: true })
  await fs.writeFile(validPath, validText)
  await fs.writeFile(invalidPath, invalidText)
  try {
    const session = await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession()
        const now = 1_777_500_006_780
        const user = await Session.updateMessage<MessageV2.User>({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: now },
          agent: "build",
          model: { providerID, modelID },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "sealed user before truncated sidecars",
        })
        const assistant = await Session.updateMessage<MessageV2.Assistant>({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: now + 10, completed: now + 100 },
          parentID: user.id,
          providerID,
          modelID,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: tokens(),
          finish: "stop",
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          callID: "call_valid_sidecar",
          tool: "sidecar_tool_valid",
          state: {
            status: "completed",
            input: { query: "valid" },
            output: "VISIBLE_VALID_TRUNCATED_WRAPPER",
            title: "Valid sidecar",
            metadata: {
              truncated: true,
              ...truncationOutputMetadata({ outputPath: validPath, text: validText }),
            },
            time: { start: now + 20, end: now + 30 },
          },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          callID: "call_invalid_sidecar",
          tool: "sidecar_tool_invalid",
          state: {
            status: "completed",
            input: { query: "invalid" },
            output: "VISIBLE_INVALID_TRUNCATED_WRAPPER",
            title: "Invalid sidecar",
            metadata: {
              truncated: true,
              ...truncationOutputMetadata({ outputPath: invalidPath, text: invalidText }),
            },
            time: { start: now + 31, end: now + 40 },
          },
        })
        return session
      },
    })

    const rows = await runLcm(
      Effect.gen(function* () {
        yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
        return yield* dbQuery<{
          tool_name: string
          tool_output_text: string | null
          content_storage_kind: string
          content_file_id: string | null
          artifact_path: string | null
        }>(
          `
            SELECT part.tool_name, part.tool_output_text, part.content_storage_kind,
                   part.content_file_id, file.artifact_path
            FROM lcm_message_parts part
            LEFT JOIN lcm_large_files file ON file.file_id = part.content_file_id
            WHERE part.tool_name IN ('sidecar_tool_valid', 'sidecar_tool_invalid')
            ORDER BY part.tool_name
          `,
        )
      }),
    )

    const valid = rows.find((row) => row.tool_name === "sidecar_tool_valid")
    const invalid = rows.find((row) => row.tool_name === "sidecar_tool_invalid")
    expect(valid).toBeDefined()
    expect(invalid).toBeDefined()
    expect(valid?.content_storage_kind).toBe("lcm_file")
    expect(valid?.tool_output_text).toBeNull()
    expect(valid?.content_file_id).toMatch(/^file_/)
    expect(valid?.artifact_path).toBeTruthy()
    expect(invalid?.content_storage_kind).toBe("inline")
    expect(invalid?.tool_output_text).toBe("VISIBLE_INVALID_TRUNCATED_WRAPPER")
    expect(invalid?.content_file_id).toBeNull()

    const artifactPath = path.join(resolveLcmDbLayout(dataDir).artifactsDir, valid!.artifact_path!)
    const artifact = await fs.readFile(artifactPath, "utf8")
    expect(artifact).toContain("LCM_VALID_SIDECAR_START")
    expect(artifact).toContain("LCM_VALID_SIDECAR_END")
    expect(artifact).not.toContain("VISIBLE_VALID_TRUNCATED_WRAPPER")
  } finally {
    await fs.rm(validPath, { force: true }).catch(() => undefined)
    await fs.rm(invalidPath, { force: true }).catch(() => undefined)
  }
})

test("tolerates assistant accounting metadata updates after source sync", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, assistant } = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const now = 1_777_500_006_825
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID, modelID },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "sealed user before usage update",
      })
      const assistant = await Session.updateMessage<MessageV2.Assistant>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "assistant",
        time: { created: now + 10, completed: now + 100 },
        parentID: user.id,
        providerID,
        modelID,
        mode: "build",
        agent: "build",
        path: { cwd: tmp.path, root: tmp.path },
        cost: 0,
        tokens: tokens(),
        finish: "stop",
      })
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: assistant.id,
        type: "text",
        text: "assistant answer before usage update",
        time: { start: now + 20, end: now + 30 },
      })
      return { session, assistant }
    },
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      Session.updateMessage<MessageV2.Assistant>({
        ...assistant,
        summary: true,
        cost: 1.25,
        tokens: {
          total: 42,
          input: 10,
          output: 20,
          reasoning: 2,
          cache: {
            read: 3,
            write: 7,
          },
        },
      }),
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(result).toMatchObject({
    insertedMessages: 0,
    insertedParts: 0,
    idempotent: true,
  })

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{ metadata_json: unknown }>(
        "SELECT metadata_json FROM lcm_messages WHERE source_message_id = $1",
        [assistant.id],
      )
    }),
  )
  expect(rows[0]?.metadata_json).toMatchObject({
    cost: 0,
    tokens: tokens(),
  })
  expect(JSON.stringify(rows[0]?.metadata_json)).not.toContain('"summary"')
})

test("auto-rebuilds raw-only source drift from durable Kilo messages", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, text } = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: 1_777_500_006_875 },
        agent: "build",
        model: { providerID, modelID },
      } satisfies MessageV2.User)
      const text = await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "before safe drift",
      })
      return { session, text }
    },
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  await provideTestInstance({
    directory: tmp.path,
    fn: () => Session.updatePart({ ...text, text: "after safe drift" }),
  })

  const repaired = await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  expect(repaired).toMatchObject({
    insertedMessages: 1,
    insertedParts: 1,
    idempotent: false,
  })

  const rows = await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      return yield* dbQuery<{
        text_content: string | null
        context_count: number | string
        snapshot_count: number | string
      }>(
        `
          SELECT
            (SELECT text_content FROM lcm_message_parts LIMIT 1) AS text_content,
            (SELECT count(*)::int FROM lcm_context_items) AS context_count,
            (SELECT count(*)::int FROM lcm_context_snapshots) AS snapshot_count
        `,
      )
    }),
  )
  expect(rows[0]).toEqual({
    text_content: "after safe drift",
    context_count: 1,
    snapshot_count: 1,
  })
})

test("fails closed on immutable source drift and keeps derived source part keys deterministic", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const { session, text } = await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await createSession()
      const user = await Session.updateMessage<MessageV2.User>({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: 1_777_500_006_900 },
        agent: "build",
        model: { providerID, modelID },
      } satisfies MessageV2.User)
      const text = await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "before drift",
        ignored: true,
      })
      return { session, text }
    },
  })

  await runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))
  await runLcm(
    Effect.gen(function* () {
      yield* syncFinalizedMessages({ sessionID: session.id, dataDir })
      const conversation = yield* dbQuery<{ conversation_id: string }>(
        "SELECT conversation_id FROM lcm_conversations WHERE source_session_id = $1",
        [session.id],
      )
      yield* dbQuery(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            created_at_ms,
            updated_at_ms
          )
          VALUES ('file_m06_rebuild_blocker', $1, 'inline', $2, $2)
        `,
        [conversation[0]?.conversation_id, 1_777_500_006_901],
      )
    }),
  )
  await provideTestInstance({
    directory: tmp.path,
    fn: () => Session.updatePart({ ...text, text: "after drift" }),
  })

  await expect(runLcm(syncFinalizedMessages({ sessionID: session.id, dataDir }))).rejects.toMatchObject({
    code: "recovery_required",
    diagnosticCode: "lcm_source_drift_part_text_content",
    action: "start_new_thread",
    safeParams: {
      action: "start_new_thread",
    },
  })

  expect(
    createSourcePartKey({
      sourcePartID: null,
      sourceMessageID: "msg_source",
      partOrder: 3,
      partKind: "text",
      ignored: true,
      synthetic: false,
      compatibility: true,
    }),
  ).toBe("derived:msg_source:3:text:i1s0c1")
})

test("message-v2 closure artifact matches the runtime taxonomy used by final-only sync", async () => {
  const artifactPath = path.join(
    import.meta.dir,
    "../../../../specifications/fixtures/message-v2/closure-message-v2-current-shape-v1.json",
  )
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8")) as {
    taxonomy: typeof MESSAGE_V2_SYNC_TAXONOMY
  }

  expect(artifact.taxonomy.roles).toEqual(MESSAGE_V2_SYNC_TAXONOMY.roles)
  expect(artifact.taxonomy.partKinds).toEqual(MESSAGE_V2_SYNC_TAXONOMY.partKinds)
  expect(artifact.taxonomy.toolStates).toEqual(MESSAGE_V2_SYNC_TAXONOMY.toolStates)
  expect(artifact.taxonomy.terminalToolStates).toEqual(MESSAGE_V2_SYNC_TAXONOMY.terminalToolStates)
  expect(artifact.taxonomy.fileSourceKinds).toEqual(MESSAGE_V2_SYNC_TAXONOMY.fileSourceKinds)
  expect(artifact.taxonomy.partRenderFlags).toEqual(MESSAGE_V2_SYNC_TAXONOMY.partRenderFlags)
})
