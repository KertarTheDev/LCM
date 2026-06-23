// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import path from "node:path"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import {
  Service as LcmContextService,
  layer as lcmContextLayer,
  type LcmLeafCompactionRuntimeInput,
} from "../../src/session/lcm/context"
import { makeFixtureClock } from "../../src/session/lcm/render-prep"
import {
  renderSummaryWrapper,
  runLeafSummaryGeneration,
  type LcmLeafSummaryGenerator,
} from "../../src/session/lcm/summary"
import { createDeterministicFallbackTokenCounter } from "../../src/session/lcm/token-budget"
import type { LcmAssemblyInput, LcmDbRequest, LcmSafeError, OperationID } from "../../src/session/lcm/types"
import { serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const now = 1_777_500_013_000
const conversationID = "conv_m13_summary"
const sessionID = "ses_m13_summary"
const providerID = "provider_m13"
const modelID = "model_m13"

function operationID(suffix: string): OperationID {
  return `op_m13_${suffix}` as OperationID
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

async function query<T>(worker: ReturnType<typeof createLcmDbWorker>, sql: string, params: unknown[] = []) {
  return worker.executeForeground(
    request({
      run: async (db) => (await (db as PGlite).query<T>(sql, params)).rows,
    }),
  )
}

async function seedConversation(worker: ReturnType<typeof createLcmDbWorker>, suffix = "") {
  const convID = `${conversationID}${suffix}`
  const sessID = `${sessionID}${suffix}`
  const boundary = JSON.stringify(
    createHarnessBoundaryMetadata({
      projectID: "project_m13",
      workspaceID: "workspace_m13",
      sessionDirectoryOriginal: "/workspace/m13",
      sessionDirectoryCanonical: "/workspace/m13",
      worktreeOriginal: "/workspace/m13",
      worktreeCanonical: "/workspace/m13",
      allowedRootOriginals: ["/workspace/m13"],
      allowedRootCanonicals: ["/workspace/m13"],
    }),
  )

  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        await typedDb.query(
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
            VALUES ($1, $2, $1, 'project_m13', 'workspace_m13', '/workspace/m13', '/workspace/m13',
                    $3::jsonb, 'lcm_active', 13, 1, $4, $4)
          `,
          [convID, sessID, boundary, now],
        )

        for (let index = 1; index <= 5; index++) {
          const messageRowID = `msg_m13${suffix}_${index}`
          const text = `sealed message ${index} source content ${"context continuity ".repeat(10)}`
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
                provider_id,
                model_id,
                agent_name,
                metadata_json
              )
              VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, $8, 'code', $9::jsonb)
            `,
            [
              messageRowID,
              convID,
              sessID,
              `msg_m13_source${suffix}_${index}`,
              index,
              now + index,
              providerID,
              modelID,
              JSON.stringify({
                version: 1,
                role: "user",
              }),
            ],
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
              VALUES ($1, $2, $3, $4, 1, 'text', $5, $6, $7, $8)
            `,
            [
              `prt_m13${suffix}_${index}`,
              messageRowID,
              convID,
              `derived:msg_m13_source${suffix}_${index}:1:text:i0s0c0`,
              text,
              `${index}`.repeat(64).slice(0, 64),
              serializeMessagePartSearchText({ textContent: text }),
              now + index,
            ],
          )
          await typedDb.query(
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
            [`ctx_m13${suffix}_${index}`, convID, index, messageRowID, now + index],
          )
        }
      },
    }),
  )

  return { conversationID: convID, sessionID: sessID }
}

function acceptedLeafSummaryText(suffix = "", label = "durable leaf summary") {
  const anchors = [
    `msg_m13${suffix}_1`,
    `msg_m13${suffix}_2`,
    `Decision: preserve continuity for packages/opencode/src/session/lcm/summary.ts.`,
    `$ bun run --cwd packages/opencode lcm:summary`,
    "The next follow-up must keep source provenance and unresolved work visible.",
  ].join(" ")
  return `${label} ${anchors} ${Array.from({ length: 48 }, (_, index) => `detail${index}`).join(" ")}`
}

function compactionInput(input: {
  conversationID: string
  sessionID: string
  operationID: OperationID
  generator?: LcmLeafSummaryGenerator
  maxAttempts?: number
  abortSignal?: AbortSignal
}) {
  return {
    conversationID: input.conversationID,
    reason: "hard_limit" as const,
    blocking: true,
    operationID: input.operationID,
    sessionID: input.sessionID,
    providerID,
    modelID,
    tokenCounter: createDeterministicFallbackTokenCounter(),
    generator: input.generator,
    maxAttempts: input.maxAttempts,
    abortSignal: input.abortSignal,
  } as unknown as LcmLeafCompactionRuntimeInput
}

function renderOptions() {
  return {
    providerID,
    modelID,
    providerMediaCapability: "unknown" as const,
    stripMedia: false,
  }
}

function assemblyInput(input: { conversationID: string; sessionID: string; suffix: string }): LcmAssemblyInput {
  const sourceMessageIDs = Array.from({ length: 5 }, (_, index) => `msg_m13_source${input.suffix}_${index + 1}`)
  return {
    conversationID: input.conversationID,
    sessionID: input.sessionID,
    targetCurrentUser: {
      sourceSessionID: input.sessionID,
      sourceMessageID: `msg_m13_current${input.suffix}`,
      promptOperationID: `op_m13_current${input.suffix}`,
      visibilityBaseMessageID: `msg_m13_current${input.suffix}`,
    },
    renderOptions: renderOptions(),
    renderPreparation: {
      sessionID: input.sessionID,
      session: {
        id: input.sessionID,
        projectID: "project_m13",
        directory: "/workspace/m13",
        title: "summary assembly",
        version: "test",
        time: { created: now, updated: now },
        permission: [],
      },
      agent: {
        name: "code",
        description: "Code agent",
        mode: "primary",
        builtIn: true,
        topP: 1,
        temperature: 0,
        permission: [],
        tools: {},
        options: {},
      },
      model: {
        id: modelID,
        providerID,
        api: {
          id: modelID,
          npm: "@ai-sdk/openai",
          url: "https://example.invalid/openai",
        },
        name: "M13 Test Model",
        family: "test",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: false,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {},
        limit: { context: 100_000, output: 4096 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-05-01",
      },
      permissionProfile: [],
      taskCapabilityClass: "root",
      messageVisibility: {
        version: "kilo-prompt-queue-visibility-v1",
        hash: `m13-${input.suffix}`,
        visibleMessageIDs: sourceMessageIDs,
        hiddenMessageIDs: [],
      },
      envCache: {},
      clock: makeFixtureClock(now + 20),
      stripMedia: false,
      format: { type: "text" },
      lastUser: {
        id: sourceMessageIDs[4]!,
        sessionID: input.sessionID,
        role: "user",
        time: { created: now + 5 },
        agent: "code",
        model: { providerID, modelID },
      },
      prepareRenderOnlyMessages: (renderInput: { messages: unknown }) => Effect.succeed(renderInput.messages),
      transformMessages: () => Effect.void,
      resolveSystem: () => Effect.succeed([]),
      resolveTools: () => Effect.succeed({}),
    },
  } as unknown as LcmAssemblyInput
}

async function runLeafCompaction(
  worker: ReturnType<typeof createLcmDbWorker>,
  input: { conversationID: string; sessionID: string; operationID: OperationID },
  generator?: LcmLeafSummaryGenerator,
  maxAttempts?: number,
  abortSignal?: AbortSignal,
) {
  return runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.compactLeavesToSprig(
        compactionInput({
          ...input,
          generator,
          maxAttempts,
          abortSignal,
        }),
      ),
    ),
  )
}

test("leaf summarization passes prompt abort signal to the provider generator", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker)
  const abortController = new AbortController()
  let observedSignal: AbortSignal | undefined

  try {
    const result = await runLeafCompaction(
      worker,
      { ...seeded, operationID: operationID("abort_signal") },
      async (input) => {
        observedSignal = input.abortSignal
        return acceptedLeafSummaryText("abort")
      },
      undefined,
      abortController.signal,
    )

    expect(result.status).toBe("completed")
    expect(observedSignal).toBe(abortController.signal)
  } finally {
    await worker.close()
  }
})

test("leaf summarization cancels promptly when the provider generator ignores abort", async () => {
  const abortController = new AbortController()
  let calls = 0
  let markStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })

  const pending = runLeafSummaryGeneration({
    operationID: operationID("noncoop_provider_canceled"),
    conversationID: "conv_m13_noncoop_provider_canceled" as never,
    sourceItems: [
      {
        messageRowID: "msg_m13_noncoop_provider_canceled_1" as never,
        text: "non-cooperative provider cancellation source ".repeat(800),
        tokenCount: 2400,
      },
    ],
    counter: createDeterministicFallbackTokenCounter(),
    generator: async () => {
      calls++
      markStarted?.()
      return new Promise<string>(() => {})
    },
    abortSignal: abortController.signal,
    maxAttempts: 2,
  })

  await started
  abortController.abort()
  await expect(pending).rejects.toMatchObject({
    code: "canceled",
    diagnosticCode: "lcm_leaf_summary_canceled_during_provider",
  })
  expect(calls).toBe(1)
})

test("leaf summarization creates a sprig with provenance, usage, and atomic context replacement", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker)

  const anchors = [
    "msg_m13_1",
    "msg_m13_2",
    "Decision: preserve continuity for packages/opencode/src/session/lcm/summary.ts.",
    "$ bun run --cwd packages/opencode lcm:summary",
    "The next follow-up must keep source provenance and unresolved work visible.",
  ].join(" ")
  const summaryText = [
    `durable leaf summary ${anchors} ${Array.from({ length: 28 }, (_, index) => `detail${index}`).join(" ")}`,
    "Compressed details: exact_commands; recover exact values through LCM retrieval using covered handles.",
  ].join("\n")
  const result = await runLeafCompaction(worker, { ...seeded, operationID: operationID("create") }, async () => ({
    text: summaryText,
    usage: { inputTokens: 77, outputTokens: 11, costStatus: "provider_reported" },
  }))

  expect(result).toMatchObject({
    status: "completed",
    workPerformed: true,
    summariesCreated: 1,
    contextItemsReplaced: 3,
    reason: "hard_limit",
  })
  expect(result.afterTokens).toBeLessThan(result.beforeTokens!)

  const summaries = await query<{
    summary_id: string
    summary_type: string
    content_text: string
    source_token_count: number
    summary_token_count: number
    summary_level: number
    prompt_version: string
    objective_status: string
    fallback_mode: string
    usage_record_id: string | null
  }>(
    worker,
    `
      SELECT summary_id, summary_type, content_text, source_token_count, summary_token_count, summary_level,
             prompt_version, objective_status, fallback_mode, usage_record_id
      FROM lcm_summaries
      WHERE conversation_id = $1
    `,
    [seeded.conversationID],
  )
  expect(summaries).toHaveLength(1)
  expect(summaries[0]).toMatchObject({
    summary_type: "sprig",
    content_text: summaryText,
    summary_level: 0,
    prompt_version: "summary-leaf-v2",
    objective_status: "provider_accepted",
    fallback_mode: "none",
  })
  expect(summaries[0]!.content_text).toContain("Compressed details: exact_commands")
  expect(Number(summaries[0]!.summary_token_count)).toBeLessThan(Number(summaries[0]!.source_token_count))
  expect(summaries[0]!.usage_record_id).toBeTruthy()

  const provenance = await query<{ message_row_id: string; source_order: number }>(
    worker,
    `
      SELECT message_row_id, source_order
      FROM lcm_summary_messages
      WHERE summary_id = $1
      ORDER BY source_order
    `,
    [summaries[0]!.summary_id],
  )
  expect(provenance.map((row) => row.message_row_id)).toEqual(["msg_m13_1", "msg_m13_2", "msg_m13_3"])

  const context = await query<{
    item_order: number
    item_type: string
    message_row_id: string | null
    summary_id: string | null
  }>(
    worker,
    `
      SELECT item_order, item_type, message_row_id, summary_id
      FROM lcm_context_items
      WHERE conversation_id = $1
      ORDER BY item_order
    `,
    [seeded.conversationID],
  )
  expect(context.map((row) => row.item_type)).toEqual(["summary", "raw_message", "raw_message"])
  expect(context[0]!.summary_id).toBe(summaries[0]!.summary_id)
  expect(context.slice(1).map((row) => row.message_row_id)).toEqual(["msg_m13_4", "msg_m13_5"])

  const usage = await query<{ input_tokens: number; output_tokens: number; cost_status: string }>(
    worker,
    "SELECT input_tokens, output_tokens, cost_status FROM lcm_usage_records WHERE usage_record_id = $1",
    [summaries[0]!.usage_record_id],
  )
  expect(usage[0]).toEqual({ input_tokens: 77, output_tokens: 11, cost_status: "provider_reported" })
  await worker.close()
})

test("leaf summary acceptance retries once and accepts terse smaller output", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker, "_retry")
  let attempts = 0

  const result = await runLeafCompaction(
    worker,
    { ...seeded, operationID: operationID("retry") },
    async () => {
      attempts++
      return attempts === 1 ? "" : acceptedLeafSummaryText("_retry", "retry accepted summary")
    },
    2,
  )

  expect(result).toMatchObject({ status: "completed", summariesCreated: 1 })
  expect(attempts).toBe(2)
  const rows = await query<{ content_text: string; objective_status: string; fallback_mode: string }>(
    worker,
    "SELECT content_text, objective_status, fallback_mode FROM lcm_summaries WHERE conversation_id = $1",
    [seeded.conversationID],
  )
  expect(rows[0]).toEqual({
    content_text: acceptedLeafSummaryText("_retry", "retry accepted summary"),
    objective_status: "provider_accepted",
    fallback_mode: "none",
  })
  await worker.close()
})

test("leaf summary fallback stores deterministic extractive key points after objective failure", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker, "_fallback")
  let attempts = 0

  const result = await runLeafCompaction(
    worker,
    { ...seeded, operationID: operationID("fallback") },
    async () => {
      attempts++
      return "not smaller ".repeat(2000)
    },
    2,
  )

  expect(result).toMatchObject({ status: "completed", summariesCreated: 1 })
  expect(attempts).toBe(2)
  const rows = await query<{
    content_text: string
    source_token_count: number
    summary_token_count: number
    objective_status: string
    fallback_mode: string
  }>(
    worker,
    `
      SELECT content_text, source_token_count, summary_token_count, objective_status, fallback_mode
      FROM lcm_summaries
      WHERE conversation_id = $1
    `,
    [seeded.conversationID],
  )
  expect(rows[0]!.content_text).toContain("[LCM leaf summary fallback; extractive_key_points from")
  expect(rows[0]!.content_text).toContain("Coverage: msg_")
  expect(rows[0]!.content_text).toContain("Key points:")
  expect(Number(rows[0]!.summary_token_count)).toBeLessThan(Number(rows[0]!.source_token_count))
  expect(rows[0]).toMatchObject({
    objective_status: "fallback_accepted",
    fallback_mode: "extractive_key_points",
  })
  await worker.close()
})

test("leaf summary fallback handles model errors after retry", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker, "_error")
  let attempts = 0

  const result = await runLeafCompaction(
    worker,
    { ...seeded, operationID: operationID("error") },
    async () => {
      attempts++
      throw new Error("simulated timeout")
    },
    2,
  )

  expect(result).toMatchObject({ status: "completed", summariesCreated: 1, contextItemsReplaced: 3 })
  expect(attempts).toBe(2)
  const rows = await query<{ objective_status: string; fallback_mode: string }>(
    worker,
    "SELECT objective_status, fallback_mode FROM lcm_summaries WHERE conversation_id = $1",
    [seeded.conversationID],
  )
  expect(rows[0]).toEqual({
    objective_status: "fallback_accepted",
    fallback_mode: "extractive_key_points",
  })
  await worker.close()
})

test("leaf summary context remains complete after worker reopen", async () => {
  await using tmp = await tmpdir()
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  const seeded = await seedConversation(worker, "_reopen")

  await runLeafCompaction(
    worker,
    { ...seeded, operationID: operationID("reopen") },
    async () => "durable sprig summary",
  )
  await worker.close()

  const reopened = await initialize(dataDir)
  const state = await query<{
    context_count: number
    summary_count: number
    provenance_count: number
    snapshot_count: number
  }>(
    reopened,
    `
      SELECT
        (SELECT count(*)::int FROM lcm_context_items WHERE conversation_id = $1) AS context_count,
        (SELECT count(*)::int FROM lcm_summaries WHERE conversation_id = $1) AS summary_count,
        (SELECT count(*)::int FROM lcm_summary_messages sm
          JOIN lcm_summaries s ON s.summary_id = sm.summary_id
          WHERE s.conversation_id = $1) AS provenance_count,
        (SELECT count(*)::int FROM lcm_context_snapshots WHERE conversation_id = $1) AS snapshot_count
    `,
    [seeded.conversationID],
  )
  expect(state[0]).toEqual({
    context_count: 3,
    summary_count: 1,
    provenance_count: 3,
    snapshot_count: 1,
  })
  await reopened.close()
})

test("mixed assembly renders sprig wrapper in order without merging into raw leaves", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  const seeded = await seedConversation(worker, "_assembly")

  await runLeafCompaction(worker, { ...seeded, operationID: operationID("assembly") }, async (input) => {
    expect(input.promptVersion).toBe("summary-leaf-v2")
    expect(input.prompt).toContain("replace the untrusted source messages below")
    expect(input.prompt).toContain("[Message ID: msg_m13_assembly_1]")
    expect(input.request.messages.map((message) => message.role)).toEqual(["system", "user"])
    expect(input.request.system).toContain("Do not continue the source conversation")
    expect(input.request.user).toContain("<untrusted_source_messages>")
    return acceptedLeafSummaryText("_assembly", "durable assembly summary")
  })

  const assembly = await runContext(
    worker,
    LcmContextService.use((svc) =>
      svc.assembleModelMessages(
        assemblyInput({
          ...seeded,
          suffix: "_assembly",
        }),
      ),
    ),
  )
  if (!assembly.ok) throw new Error(assembly.safeError.safeMessage)
  const rendered = assembly.modelMessages.map((message) => JSON.stringify(message))

  expect(assembly.contextItems.map((item) => item.itemType)).toEqual(["summary", "raw_message", "raw_message"])
  expect(rendered[0]).toContain("[Summary ID: sum_")
  expect(rendered[0]).toContain("durable assembly summary")
  expect(rendered[1]).toContain("sealed message 4 source content")
  expect(rendered[2]).toContain("sealed message 5 source content")
  await worker.close()
})

test("summary wrapper uses explicit model-visible boundaries", () => {
  const wrapper = renderSummaryWrapper({
    summaryID: "sum_m13_wrapper",
    parentSummaryIDs: ["sum_m13_parent_a", "sum_m13_parent_b"],
    contentText: "mentions file_fake and sum_fake inside bounded content",
  })

  expect(wrapper).toBe(
    [
      "[Summary ID: sum_m13_wrapper]",
      "[Parent Summaries: sum_m13_parent_a, sum_m13_parent_b]",
      "",
      "mentions file_fake and sum_fake inside bounded content",
    ].join("\n"),
  )
})

test("summary wrapper exposes truncated fallback provenance", () => {
  const wrapper = renderSummaryWrapper({
    summaryID: "sum_m13_fallback",
    contentText: "compact fallback continuity",
    objectiveStatus: "fallback_accepted",
    fallbackMode: "extractive_key_points",
    sourceTokenCount: 40_618,
    summaryTokenCount: 1_600,
  })

  expect(wrapper).toContain("[Fallback: extractive_key_points; source 40618 tokens -> summary 1600 tokens]")
  expect(wrapper).toContain("use authorized LCM retrieval/search with Summary ID sum_m13_fallback")
  expect(wrapper).toContain("compact fallback continuity")
})
