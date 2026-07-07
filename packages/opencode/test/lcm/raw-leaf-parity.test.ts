// kilocode_change - new file
import { expect, test } from "bun:test"
import type { Tool as AITool } from "ai"
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
  rawLeafNormalizedParityKey,
  Service as LcmContextService,
  type LcmRawLeafRenderPreparationInput,
} from "../../src/session/lcm/context"
import {
  makeFixtureClock,
  markLcmRenderOnlyPart,
  prepareKiloModelInput,
  type LcmMessageVisibilityInput,
} from "../../src/session/lcm/render-prep"
import type {
  ConversationID,
  LcmAssemblyInput,
  LcmDbRequest,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

const now = 1_777_500_100_000
const conversationID = "conv_m10_raw_leaf" as ConversationID
const sessionID = SessionID.make("ses_m10_raw_leaf")
const providerID = "provider-render" as ProviderID
const modelID = "model-render-a" as ModelID

const boundaryMetadata = {
  version: 1,
  projectID: "project_m10",
  workspaceID: "workspace_m10",
  platformPathFlavor: "posix",
  caseSensitivity: "sensitive",
  sessionDirectoryOriginal: "/workspace/project",
  sessionDirectoryCanonical: "/workspace/project",
  worktreeOriginal: "/workspace/project",
  worktreeCanonical: "/workspace/project",
  allowedRootOriginals: ["/workspace/project"],
  allowedRootCanonicals: ["/workspace/project"],
  kiloPermissionContext: {
    source: "worktree",
    permissionProfileID: "profile_m10",
  },
}

function operationID(suffix: string): OperationID {
  return `op_m10_${suffix}` as OperationID
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

function fakeModel(input: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: modelID,
    providerID,
    api: {
      id: modelID,
      npm: "@ai-sdk/openai",
      url: "https://example.invalid/openai",
    },
    name: "Render Model A",
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
    release_date: "2026-04-30",
    ...input,
  } as Provider.Model
}

function fakeAgent(input: Partial<Agent.Info> = {}): Agent.Info {
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
    ...input,
  } as Agent.Info
}

function fakeSession(input: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: sessionID,
    projectID: "project_m10",
    directory: "/workspace/project",
    title: "raw leaf parity",
    version: "test",
    time: { created: 1, updated: 1 },
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
    ...input,
  } as SessionInfo
}

function tool(description = "raw leaf parity tool"): AITool {
  return {
    description,
    inputSchema: {},
    execute: async () => "ok",
  } as unknown as AITool
}

function visibility(messages: MessageV2.WithParts[]): LcmMessageVisibilityInput {
  return {
    version: "kilo-prompt-queue-visibility-v1",
    hash: `visibility-${messages.map((message) => message.info.id).join("-")}`,
    visibleMessageIDs: messages.map((message) => message.info.id),
    hiddenMessageIDs: [],
  }
}

function lastUserInfo(messages: MessageV2.WithParts[]): MessageV2.User {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user) throw new Error("raw-leaf fixture must include a user message")
  return user.info as MessageV2.User
}

function baseMessages(input: { model?: Provider.Model; includeToolMedia?: boolean } = {}): MessageV2.WithParts[] {
  const model = input.model ?? fakeModel()
  const userID = MessageID.make("msg_m10_user")
  const assistantID = MessageID.make("msg_m10_assistant")
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: now },
        agent: "code",
        model: {
          providerID: model.providerID,
          modelID: model.id,
        },
        editorContext: {
          activeFile: "src/raw-leaf.ts",
          visibleFiles: ["src/raw-leaf.ts"],
          shell: "bash",
        },
      },
      parts: [
        {
          id: PartID.make("prt_m10_user_ignored"),
          sessionID,
          messageID: userID,
          type: "text",
          ignored: true,
          text: "ignored raw leaf text",
        },
        {
          id: PartID.make("prt_m10_user_text"),
          sessionID,
          messageID: userID,
          type: "text",
          text: "visible raw leaf text",
        } as MessageV2.TextPart & { compatibility: boolean },
        {
          id: PartID.make("prt_m10_user_file"),
          sessionID,
          messageID: userID,
          type: "file",
          mime: "image/png",
          filename: "diagram.png",
          url: "data:image/png;base64,ZmFrZQ==",
          source: {
            type: "file",
            path: "/workspace/project/diagram.png",
            text: { value: "diagram.png", start: 0, end: 11 },
          },
        },
      ],
    },
    {
      info: {
        id: assistantID,
        parentID: userID,
        role: "assistant",
        mode: "code",
        agent: "code",
        path: { cwd: "/workspace/project", root: "/workspace/project" },
        cost: 0,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 0, write: 0 } },
        modelID: model.id,
        providerID: model.providerID,
        time: { created: now + 1, completed: now + 2 },
        sessionID,
        finish: "tool-calls",
      },
      parts: [
        {
          id: PartID.make("prt_m10_step_start"),
          sessionID,
          messageID: assistantID,
          type: "step-start",
          snapshot: "snap_m10_before_tool",
        },
        {
          id: PartID.make("prt_m10_reasoning"),
          sessionID,
          messageID: assistantID,
          type: "reasoning",
          text: "reasoning raw leaf",
          metadata: { provider: "same-model" },
          time: { start: now + 2, end: now + 3 },
        },
        {
          id: PartID.make("prt_m10_assistant_text"),
          sessionID,
          messageID: assistantID,
          type: "text",
          text: "assistant raw leaf text",
          metadata: { provider: "same-model" },
          time: { start: now + 3, end: now + 4 },
        },
        {
          id: PartID.make("prt_m10_tool_completed"),
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: "call_m10_completed",
          tool: "read",
          metadata: { providerExecuted: true, requestID: "provider-call" },
          state: {
            status: "completed",
            input: { filePath: "src/raw-leaf.ts" },
            output: "tool output",
            title: "Read",
            metadata: { ok: true },
            time: { start: now + 4, end: now + 5 },
            attachments: input.includeToolMedia
              ? [
                  {
                    id: PartID.make("prt_m10_tool_media"),
                    sessionID,
                    messageID: assistantID,
                    type: "file",
                    mime: "image/png",
                    url: "data:image/png;base64,bWVkaWE=",
                  },
                ]
              : undefined,
          },
        },
        {
          id: PartID.make("prt_m10_tool_interrupted"),
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: "call_m10_interrupted",
          tool: "bash",
          state: {
            status: "error",
            input: { command: "make test" },
            error: "interrupted",
            metadata: { interrupted: true, output: "partial interrupted output" },
            time: { start: now + 6, end: now + 7 },
          },
        },
      ],
    },
  ]
}

function rawLeafScaleMessages(count: number): MessageV2.WithParts[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = String(index + 1).padStart(3, "0")
    const messageID = MessageID.make(`msg_m10_scale_${ordinal}`)
    return {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: now + index },
        agent: "code",
        model: {
          providerID,
          modelID,
        },
      },
      parts: [
        {
          id: PartID.make(`prt_m10_scale_text_${ordinal}`),
          sessionID,
          messageID,
          type: "text",
          text: `raw scale message ${ordinal}: deterministic renderer parity input`,
        },
      ],
    }
  })
}

function renderPreparation(input: {
  messages: MessageV2.WithParts[]
  model?: Provider.Model
  systemText?: string
  pluginText?: string
  stripMedia?: boolean
}): LcmRawLeafRenderPreparationInput {
  const model = input.model ?? fakeModel()
  return {
    sessionID,
    session: fakeSession(),
    agent: fakeAgent(),
    model,
    permissionProfile: fakeSession().permission as Permission.Ruleset,
    taskCapabilityClass: "root",
    messageVisibility: visibility(input.messages),
    envCache: {},
    clock: makeFixtureClock(now + 20),
    stripMedia: input.stripMedia ?? false,
    format: { type: "text" },
    lastUser: lastUserInfo(input.messages),
    prepareRenderOnlyMessages: ({ messages }) =>
      Effect.sync(() => {
        const user = messages.findLast((message) => message.info.role === "user")!
        user.parts.push({
          id: PartID.ascending(),
          sessionID,
          messageID: user.info.id,
          type: "text",
          synthetic: true,
          text: "<system-reminder>raw leaf reminder</system-reminder>",
        })
        return messages
      }),
    transformMessages: ({ messages, clockMs, operationID }) =>
      Effect.sync(() => {
        const user = messages.findLast((message) => message.info.role === "user")!
        const part: MessageV2.TextPart = {
          id: PartID.ascending(),
          sessionID,
          messageID: user.info.id,
          type: "text",
          text: input.pluginText ?? "raw leaf plugin text",
        }
        markLcmRenderOnlyPart(part, {
          kind: "plugin_transform",
          producer: "opencode.plugin.transform",
          operationID,
          createdAtMs: clockMs,
        })
        user.parts.push(part)
      }),
    resolveSystem: ({ clockMs }) =>
      Effect.succeed([`${input.systemText ?? "raw leaf system"}:${new Date(clockMs).toDateString()}`]),
    resolveTools: () => Effect.succeed({ raw_leaf_tool: tool("raw leaf tool description") }),
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
      editorContext:
        info.editorContext === undefined
          ? undefined
          : {
              version: 1,
              hash: "content-safe-editor-context-hash",
              fields: Object.keys(info.editorContext).sort(),
            },
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

function stripPartIdentity(part: MessageV2.Part) {
  const { id: _id, sessionID: _sessionID, messageID: _messageID, ...rest } = part
  return rest
}

function sourcePartKey(part: MessageV2.Part) {
  return `id:${part.id}`
}

function partFlags(part: MessageV2.Part & { compatibility?: boolean }) {
  return {
    ignored: "ignored" in part && part.ignored === true,
    synthetic: "synthetic" in part && part.synthetic === true,
    compatibility: part.compatibility === true,
  }
}

function partRenderMetadata(part: MessageV2.Part & { compatibility?: boolean }) {
  const flags = partFlags(part)
  const base = {
    version: 1,
    source: "message-v2",
    sourcePartType: part.type,
    sourcePartID: part.id,
    durableClassification: flags,
  }
  if (part.type === "text" || part.type === "reasoning") return { ...base, time: part.time }
  if (part.type === "file") return { ...base, source: part.source }
  if (part.type === "tool") {
    const state = part.state
    return {
      ...base,
      title: "title" in state ? state.title : undefined,
      stateMetadata: "metadata" in state ? state.metadata : undefined,
      time:
        "time" in state
          ? {
              start: state.time.start,
              end: "end" in state.time ? state.time.end : undefined,
              compacted: "compacted" in state.time ? state.time.compacted : undefined,
            }
          : undefined,
      attachments: state.status === "completed" ? state.attachments : undefined,
      interruptedOutputFromMetadata:
        state.status === "error" && typeof state.metadata?.output === "string" && state.metadata.interrupted === true,
    }
  }
  return { ...base, payload: stripPartIdentity(part) }
}

async function seedRawConversation(db: PGlite, messages: MessageV2.WithParts[]) {
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
      VALUES ($1, $2, $1, 'project_m10', 'workspace_m10', '/workspace/project', '/workspace/project', $3::jsonb, 'passive_synced', 10, 1, $4, $4)
    `,
    [conversationID, sessionID, JSON.stringify(boundaryMetadata), now],
  )
  for (const [messageIndex, message] of messages.entries()) {
    const messageRowID = `msgrow_m10_${messageIndex + 1}`
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        messageRowID,
        conversationID,
        message.info.sessionID,
        message.info.id,
        message.info.role,
        messageIndex + 1,
        message.info.time.created,
        message.info.role === "assistant" ? (message.info.time.completed ?? null) : null,
        message.info.role === "assistant" ? message.info.providerID : message.info.model.providerID,
        message.info.role === "assistant" ? message.info.modelID : message.info.model.modelID,
        message.info.agent,
        JSON.stringify(messageMetadata(message.info)),
      ],
    )
    for (const [partIndex, rawPart] of message.parts.entries()) {
      const part = rawPart as MessageV2.Part & { compatibility?: boolean }
      const flags = partFlags(part)
      const terminalState =
        part.type === "tool" && ["completed", "error"].includes(part.state.status) ? part.state.status : null
      const completedAt =
        part.type === "text" || part.type === "reasoning"
          ? (part.time?.end ?? null)
          : part.type === "tool" && "time" in part.state && "end" in part.state.time
            ? part.state.time.end
            : null
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
            ignored,
            synthetic,
            compatibility,
            terminal_state,
            text_content,
            reasoning_content,
            tool_call_id,
            tool_name,
            tool_input_json,
            tool_output_text,
            tool_error_text,
            file_url,
            media_mime,
            media_name,
            provider_metadata_json,
            render_metadata_json,
            content_storage_kind,
            content_sha256,
            search_text,
            created_at_ms,
            completed_at_ms
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21,
            $22::jsonb, $23::jsonb, 'inline', $24, $25, $26, $27
          )
        `,
        [
          part.id,
          messageRowID,
          conversationID,
          part.id,
          sourcePartKey(part),
          partIndex + 1,
          part.type,
          flags.ignored,
          flags.synthetic,
          flags.compatibility,
          terminalState,
          part.type === "text" ? part.text : null,
          part.type === "reasoning" ? part.text : null,
          part.type === "tool" ? part.callID : null,
          part.type === "tool" ? part.tool : null,
          part.type === "tool" ? JSON.stringify(part.state.input) : null,
          part.type === "tool" && part.state.status === "completed"
            ? part.state.output
            : part.type === "tool" && part.state.status === "error" && typeof part.state.metadata?.output === "string"
              ? part.state.metadata.output
              : null,
          part.type === "tool" && part.state.status === "error" ? part.state.error : null,
          part.type === "file" ? part.url : null,
          part.type === "file" ? part.mime : null,
          part.type === "file" ? (part.filename ?? null) : null,
          JSON.stringify("metadata" in part && part.metadata ? part.metadata : {}),
          JSON.stringify(partRenderMetadata(part)),
          "a".repeat(64),
          part.type === "text" ? part.text : "",
          now + partIndex,
          completedAt,
        ],
      )
    }
    await db.query(
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
      [`ctx_m10_${messageIndex + 1}`, conversationID, messageIndex + 1, messageRowID, now + messageIndex],
    )
  }
}

async function baseline(input: {
  messages: MessageV2.WithParts[]
  model?: Provider.Model
  systemText?: string
  pluginText?: string
  stripMedia?: boolean
}) {
  const prep = renderPreparation(input)
  return prepareKiloModelInput({
    ...prep,
    messages: structuredClone(input.messages),
    lastUser: lastUserInfo(input.messages),
  }).pipe(Effect.runPromise)
}

async function assemble(
  worker: ReturnType<typeof createLcmDbWorker>,
  input: {
    messages: MessageV2.WithParts[]
    model?: Provider.Model
    systemText?: string
    pluginText?: string
    stripMedia?: boolean
  },
) {
  const model = input.model ?? fakeModel()
  const renderPrep = renderPreparation({ ...input, model })
  const assemblyInput = {
    sessionID,
    conversationID,
    targetCurrentUser: {
      sourceSessionID: sessionID,
      sourceMessageID: "msg_raw_leaf_current",
      promptOperationID: "op_raw_leaf_current",
      visibilityBaseMessageID: "msg_raw_leaf_current",
    },
    renderOptions: {
      providerID: model.providerID,
      modelID: model.id,
      providerMediaCapability: "supports_media",
      stripMedia: input.stripMedia ?? false,
      taskCapabilityClass: "root",
    },
    renderPreparation: renderPrep,
  } satisfies LcmAssemblyInput & { renderPreparation: LcmRawLeafRenderPreparationInput }
  const result = await runContext(
    worker,
    LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput)),
  )
  if (!result.ok) throw new Error(result.safeError.safeMessage)
  return result
}

test("lcm:raw-leaf-parity matches shared renderer for raw-only context", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const messages = baseMessages()
    await worker.executeForeground(request({ run: async (db) => seedRawConversation(db as PGlite, messages) }))

    const expected = await baseline({ messages })
    const actual = await assemble(worker, { messages })

    expect(normalizeModelMessagesForRawLeafParity(actual.modelMessages)).toEqual(
      normalizeModelMessagesForRawLeafParity(expected.modelMessages),
    )
    expect(actual.contextItems.map((item) => item.itemType)).toEqual(["raw_message", "raw_message"])
    expect(actual.normalizedParityKey).toBeTruthy()
  } finally {
    await worker.close()
  }
})

test("lcm:raw-leaf-parity preserves media fallback, stripMedia, and different-model metadata behavior", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const model = fakeModel({
      id: "model-render-b" as ModelID,
      api: { id: "model-render-b", npm: "custom-provider", url: "https://example.invalid/custom-provider" },
    })
    const messages = baseMessages({ model, includeToolMedia: true })
    await worker.executeForeground(request({ run: async (db) => seedRawConversation(db as PGlite, messages) }))

    for (const stripMedia of [false, true]) {
      const expected = await baseline({ messages, model, stripMedia })
      const actual = await assemble(worker, { messages, model, stripMedia })
      expect(normalizeModelMessagesForRawLeafParity(actual.modelMessages)).toEqual(
        normalizeModelMessagesForRawLeafParity(expected.modelMessages),
      )
    }
  } finally {
    await worker.close()
  }
})

test("lcm:raw-leaf-parity cache key changes for manifest-significant render inputs", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const messages = baseMessages()
    await worker.executeForeground(request({ run: async (db) => seedRawConversation(db as PGlite, messages) }))

    const left = await assemble(worker, { messages, systemText: "system-a" })
    const right = await assemble(worker, { messages, systemText: "system-b" })

    expect(normalizeModelMessagesForRawLeafParity(left.modelMessages)).toEqual(
      normalizeModelMessagesForRawLeafParity(right.modelMessages),
    )
    expect(left.normalizedParityKey).not.toBe(right.normalizedParityKey)

    const expected = await baseline({ messages, systemText: "system-a" })
    expect(
      rawLeafNormalizedParityKey({
        modelMessages: expected.modelMessages,
        renderInputManifest: expected.renderInputManifest,
      }),
    ).toMatch(/^[0-9a-f]{64}$/)
  } finally {
    await worker.close()
  }
})

test("lcm:perf:scale raw-leaf fixture assembles a larger raw-only context", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const messages = rawLeafScaleMessages(64)
    await worker.executeForeground(request({ run: async (db) => seedRawConversation(db as PGlite, messages) }))

    const expected = await baseline({ messages, systemText: "scale-system", pluginText: "scale-plugin" })
    const actual = await assemble(worker, { messages, systemText: "scale-system", pluginText: "scale-plugin" })

    expect(normalizeModelMessagesForRawLeafParity(actual.modelMessages)).toEqual(
      normalizeModelMessagesForRawLeafParity(expected.modelMessages),
    )
    expect(actual.contextItems).toHaveLength(64)
    expect(actual.normalizedParityKey).toMatch(/^[0-9a-f]{64}$/)
  } finally {
    await worker.close()
  }
})

test("message-v2-taxonomy-v1 raw renderer fails closed for invalid lcm_file artifacts", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const messages = baseMessages()
    await worker.executeForeground(
      request({
        run: async (db) => {
          await seedRawConversation(db as PGlite, messages)
          await (db as PGlite).query(
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
            VALUES ('file_m10_large', $1, 'inline', 'file', $2, 10, $3, $4, $4)
          `,
            [conversationID, `sha256/aa/bb/${"b".repeat(64)}.bin`, "b".repeat(64), now],
          )
          await (db as PGlite).query(
            `
            UPDATE lcm_message_parts
            SET content_storage_kind = 'lcm_file',
                content_file_id = 'file_m10_large',
                content_byte_count = 10,
                content_sha256 = $2,
                text_content = NULL
            WHERE part_row_id = $1
          `,
            ["prt_m10_user_text", "b".repeat(64)],
          )
        },
      }),
    )

    await expect(assemble(worker, { messages })).rejects.toMatchObject({
      code: "recovery_required",
      diagnosticCode: "lcm_context_invalid_raw_message",
    })
  } finally {
    await worker.close()
  }
})

test("message-v2-taxonomy-v1 raw renderer rejects unsealed tool rows before rendering", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const messages = baseMessages()
    await worker.executeForeground(
      request({
        run: async (db) => {
          await seedRawConversation(db as PGlite, messages)
          await (db as PGlite).query("UPDATE lcm_message_parts SET terminal_state = NULL WHERE part_row_id = $1", [
            "prt_m10_tool_completed",
          ])
        },
      }),
    )

    await expect(assemble(worker, { messages })).rejects.toMatchObject({
      diagnosticCode: "lcm_raw_leaf_unknown_tool_state_missing",
    })
  } finally {
    await worker.close()
  }
})
