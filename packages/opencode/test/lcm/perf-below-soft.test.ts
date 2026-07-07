// kilocode_change - new file
import { readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import type { Permission } from "../../src/permission"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { Info as SessionInfo } from "../../src/session/session"
import {
  LcmContext,
  Service as LcmContextService,
  type LcmRawLeafRenderPreparationInput,
  type LcmRawLeafThresholdInput,
} from "../../src/session/lcm/context"
import { LcmDb } from "../../src/session/lcm/db"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import type {
  ContextItemType,
  ConversationID,
  LcmAssemblyInput,
  LcmDbRequest,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { makeFixtureClock, type LcmMessageVisibilityInput } from "../../src/session/lcm/render-prep"
import { serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { tmpdir } from "../fixture/fixture"
import { createBenchmarkFixtureManifest, createHarnessBoundaryMetadata } from "./harness"

const now = 1_779_545_000_000
const conversationID = "conv_below_soft_warm_v1" as ConversationID
const sessionID = SessionID.make("ses_below_soft_warm_v1")
const providerID = "provider-below-soft" as ProviderID
const modelID = "model-below-soft" as ModelID
const timedIterations = 50

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function commandString(cmd: readonly string[], env: Record<string, string | undefined> = {}) {
  const envPrefix = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ")
  const rendered = cmd.map(shellQuote).join(" ")
  return envPrefix ? `env ${envPrefix} ${rendered}` : rendered
}

function percentile(values: readonly number[], pct: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)] ?? 0
}

function operationID(suffix: string): OperationID {
  return `op_below_soft_${suffix}` as OperationID
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

async function directoryBytes(target: string): Promise<number> {
  try {
    const info = await stat(target)
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0
    const entries = await readdir(target, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      total += await directoryBytes(path.join(target, entry.name))
    }
    return total
  } catch {
    return 0
  }
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
    name: "Below Soft Benchmark Model",
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
    limit: { context: 200_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-05-23",
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
    projectID: "project_below_soft",
    directory: "/workspace/below-soft",
    title: "below soft warm benchmark",
    version: "test",
    time: { created: now, updated: now },
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
  } as SessionInfo
}

function userMessage(index: number, text: string): MessageV2.WithParts {
  const messageID = MessageID.make(`msg_below_soft_user_${index}`)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: now + index * 10 },
      agent: "code",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: PartID.make(`prt_below_soft_user_${index}_text`),
        sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  }
}

function assistantMessage(index: number, parentID: MessageID, withTool: boolean): MessageV2.WithParts {
  const messageID = MessageID.make(`msg_below_soft_assistant_${index}`)
  const parts: MessageV2.Part[] = [
    {
      id: PartID.make(`prt_below_soft_assistant_${index}_text`),
      sessionID,
      messageID,
      type: "text",
      text: `assistant response ${index} with bounded context metadata`,
    },
  ]
  if (withTool) {
    parts.push({
      id: PartID.make(`prt_below_soft_assistant_${index}_tool`),
      sessionID,
      messageID,
      type: "tool",
      callID: `call_below_soft_${index}`,
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "printf below-soft" },
        output: "completed tool output for below-soft benchmark",
        title: "bash",
        metadata: {},
        time: { start: now + index * 10 + 1, end: now + index * 10 + 2 },
      },
    })
  }
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID,
      time: { created: now + index * 10 + 1, completed: now + index * 10 + 2 },
      mode: "primary",
      agent: "code",
      providerID,
      modelID,
      path: { cwd: "/workspace/below-soft", root: "/workspace/below-soft" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
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

function partSearchText(part: MessageV2.Part) {
  if (part.type === "text") return serializeMessagePartSearchText({ textContent: part.text })
  if (part.type === "tool" && part.state.status === "completed") return part.state.output
  return ""
}

async function seedMessage(db: PGlite, message: MessageV2.WithParts, order: number) {
  const messageRowID = `msg_below_soft_row_${order}`
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
        `${order}${partIndex}`.repeat(64).slice(0, 64),
        partSearchText(part),
        now + order + partIndex,
        part.type === "tool" ? now + order + partIndex + 1 : null,
      ],
    )
  }
  return messageRowID
}

async function seedBelowSoftConversation(db: PGlite) {
  const boundary = createHarnessBoundaryMetadata({
    projectID: "project_below_soft",
    workspaceID: "workspace_below_soft",
    sessionDirectoryOriginal: "/workspace/below-soft",
    sessionDirectoryCanonical: "/workspace/below-soft",
    worktreeOriginal: "/workspace/below-soft",
    worktreeCanonical: "/workspace/below-soft",
    allowedRootOriginals: ["/workspace/below-soft"],
    allowedRootCanonicals: ["/workspace/below-soft"],
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
      VALUES ($1, $2, $1, 'project_below_soft', 'workspace_below_soft', '/workspace/below-soft', '/workspace/below-soft', $3::jsonb, 'lcm_active', $4, 1, $5, $5)
    `,
    [conversationID, sessionID, JSON.stringify(boundary), LCM_DB_GATE_SCHEMA_VERSION, now],
  )

  const rows: Array<{ order: number; messageRowID: string }> = []
  let order = 1
  for (let turn = 1; turn <= 20; turn++) {
    const user = userMessage(turn, `below soft user turn ${turn} with stable short-chat content`)
    const userRowID = await seedMessage(db, user, order)
    rows.push({ order, messageRowID: userRowID })
    order++

    const assistant = assistantMessage(turn, user.info.id, turn === 10)
    const assistantRowID = await seedMessage(db, assistant, order)
    rows.push({ order, messageRowID: assistantRowID })
    order++
  }

  const current = userMessage(21, "current below-soft request after warmed context")
  const currentRowID = await seedMessage(db, current, order)
  rows.push({ order, messageRowID: currentRowID })

  for (const row of rows) {
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
      [`ctx_below_soft_${row.order}`, conversationID, row.order, row.messageRowID, now + row.order],
    )
  }
}

function sourceMessageIDs() {
  const ids: string[] = []
  for (let turn = 1; turn <= 20; turn++) {
    ids.push(`msg_below_soft_user_${turn}`)
    ids.push(`msg_below_soft_assistant_${turn}`)
  }
  ids.push("msg_below_soft_user_21")
  return ids
}

function visibility(): LcmMessageVisibilityInput {
  return {
    version: "kilo-prompt-queue-visibility-v1",
    hash: "below-soft-visible",
    visibleMessageIDs: sourceMessageIDs(),
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
    clock: makeFixtureClock(now + 1_000),
    stripMedia: false,
    format: { type: "text" },
    lastUser: {
      id: MessageID.make("msg_below_soft_user_21"),
      sessionID,
      role: "user",
      time: { created: now + 210 },
      agent: "code",
      model: { providerID, modelID },
    },
    prepareRenderOnlyMessages: ({ messages }) => Effect.succeed(messages),
    transformMessages: () => Effect.void,
    resolveSystem: () => Effect.succeed(["below soft system"]),
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

async function promptPreparation(worker: ReturnType<typeof createLcmDbWorker>, iteration: number) {
  const preparedRenderOptions = renderOptions()
  const preparedRender = renderPreparation()
  const targetCurrentUser = {
    sourceSessionID: sessionID,
    sourceMessageID: "msg_below_soft_user_21",
    messageRowID: "msg_below_soft_row_41",
    promptOperationID: operationID(`iteration_${iteration}`),
    visibilityBaseMessageID: "msg_below_soft_user_21",
  } satisfies LcmAssemblyInput["targetCurrentUser"]
  const result = await runContext(
    worker,
    Effect.gen(function* () {
      const svc = yield* LcmContextService
      const thresholdStart = performance.now()
      const threshold = yield* svc.isOverThreshold({
        conversationID,
        renderOptions: preparedRenderOptions,
        providerContextLimit: 200_000,
        providerOutputLimit: 16_000,
        renderPreparation: preparedRender,
        recordSnapshot: false,
        targetCurrentUser,
      } as LcmRawLeafThresholdInput)
      const thresholdMs = performance.now() - thresholdStart
      const assemblyStart = performance.now()
      const assembly = yield* svc.assembleModelMessages({
        sessionID,
        conversationID,
        targetCurrentUser,
        renderOptions: preparedRenderOptions,
        renderPreparation: preparedRender,
        threshold,
      } as Parameters<typeof svc.assembleModelMessages>[0])
      const assemblyMs = performance.now() - assemblyStart
      return { threshold, assembly, thresholdMs, assemblyMs }
    }),
  )
  const { threshold, assembly, thresholdMs, assemblyMs } = result
  expect(threshold.activeTokens).toBeLessThan(threshold.softThreshold)
  expect(threshold.overSoft).toBe(false)
  expect(threshold.softPressureReason).toBeUndefined()
  expect(threshold.overHard).toBe(false)
  if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)
  return { threshold, assembly, thresholdMs, assemblyMs }
}

async function countRows(worker: ReturnType<typeof createLcmDbWorker>, table: string) {
  const rows = await query<{ count: number }>(worker, `SELECT COUNT(*)::int AS count FROM ${table}`)
  return Number(rows[0]?.count ?? 0)
}

async function activeContextItemCounts(worker: ReturnType<typeof createLcmDbWorker>) {
  const rows = await query<{ item_type: ContextItemType; count: number }>(
    worker,
    `
      SELECT item_type, COUNT(*)::int AS count
      FROM lcm_context_items
      WHERE conversation_id = $1
      GROUP BY item_type
      ORDER BY item_type
    `,
    [conversationID],
  )
  return Object.fromEntries(rows.map((row) => [row.item_type, Number(row.count)]))
}

test("below-soft-warm-v1 records warm prompt-preparation p50/p95/p99 under release gate", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const layout = resolveLcmDbLayout(dataDir)
  const worker = await initialize(dataDir)
  try {
    await worker.executeForeground(request({ run: async (db) => seedBelowSoftConversation(db as PGlite) }))

    for (let i = 0; i < 5; i++) {
      await promptPreparation(worker, i)
    }

    const dbBytesBefore = await directoryBytes(layout.pgliteDir)
    const artifactBytesBefore = await directoryBytes(layout.artifactsDir)
    const durations: number[] = []
    const thresholdDurations: number[] = []
    const assemblyDurations: number[] = []
    let activeTokens = 0
    let modelMessageCount = 0
    for (let i = 0; i < timedIterations; i++) {
      const start = performance.now()
      const result = await promptPreparation(worker, i + 5)
      durations.push(performance.now() - start)
      thresholdDurations.push(result.thresholdMs)
      assemblyDurations.push(result.assemblyMs)
      activeTokens = result.threshold.activeTokens
      modelMessageCount = result.assembly.modelMessages.length
    }
    const dbBytesAfter = await directoryBytes(layout.pgliteDir)
    const artifactBytesAfter = await directoryBytes(layout.artifactsDir)

    const p50 = percentile(durations, 50)
    const p95 = percentile(durations, 95)
    const p99 = percentile(durations, 99)
    const gate = {
      p95LimitMs: 100,
      p99LimitMs: 300,
      status: p95 <= 100 && p99 <= 300 ? ("passed" as const) : ("failed" as const),
    }
    const report = {
      fixtureID: "below-soft-warm-v1",
      benchmarkFixture: {
        ...createBenchmarkFixtureManifest(),
        generatorVersion: "below-soft-warm-v1",
        rowCounts: {
          conversations: await countRows(worker, "lcm_conversations"),
          messages: await countRows(worker, "lcm_messages"),
          messageParts: await countRows(worker, "lcm_message_parts"),
          summaries: await countRows(worker, "lcm_summaries"),
          contextItems: await countRows(worker, "lcm_context_items"),
          contextSnapshots: await countRows(worker, "lcm_context_snapshots"),
          providerRequestSnapshots: await countRows(worker, "lcm_provider_request_snapshots"),
          largeFiles: await countRows(worker, "lcm_large_files"),
          mapRuns: await countRows(worker, "lcm_map_runs"),
        },
        activeContextItemCountsByType: await activeContextItemCounts(worker),
        dbBytes: dbBytesAfter,
        lcmOwnedArtifactBytes: artifactBytesAfter,
        dbByteGrowthDuringTimedRun: dbBytesAfter - dbBytesBefore,
        artifactByteGrowthDuringTimedRun: artifactBytesAfter - artifactBytesBefore,
        providerTokenCounterMode: "deterministic_fallback",
        cacheState: "warm",
        commandMetadata: {
          suiteID: "lcm:perf:below-soft",
          exactCommand: commandString(["bun", "run", "--cwd", "packages/opencode", "lcm:perf:below-soft"], {
            BUN_TMPDIR: process.env.BUN_TMPDIR,
            BUN_INSTALL: process.env.BUN_INSTALL,
          }),
          os: `${process.platform}-${process.arch}; ${os.type()} ${os.release()}`,
          date: new Date().toISOString().slice(0, 10),
          result: gate.status,
        },
      },
      p50,
      p95,
      p99,
      thresholdP95: percentile(thresholdDurations, 95),
      assemblyP95: percentile(assemblyDurations, 95),
      gate,
      activeTokens,
      contextItems: 41,
      modelMessageCount,
      iterations: timedIterations,
    }
    console.log(JSON.stringify(report))
    if (process.env.LCM_PERF_BELOW_SOFT_REPORT) {
      await Bun.write(process.env.LCM_PERF_BELOW_SOFT_REPORT, JSON.stringify(report, null, 2) + "\n")
    }
    expect(report.benchmarkFixture.rowCounts.messages).toBe(41)
    expect(report.benchmarkFixture.rowCounts.messageParts).toBe(42)
    expect(report.benchmarkFixture.activeContextItemCountsByType).toEqual({ raw_message: 41 })
    expect(report.p95).toBeLessThanOrEqual(100)
    expect(report.p99).toBeLessThanOrEqual(300)
  } finally {
    await worker.close()
  }
})
