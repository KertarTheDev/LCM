// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import path from "node:path"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { Service as LcmContextService, layer as lcmContextLayer } from "../../src/session/lcm/context"
import { createDeterministicFallbackTokenCounter, computeThresholdDecision } from "../../src/session/lcm/token-budget"
import type { LcmLeafSummaryGenerator } from "../../src/session/lcm/summary"
import type {
  ConversationID,
  LcmDbRequest,
  LcmLeafCompactionInput,
  LcmProtectedCurrentUserInput,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { serializeMessagePartSearchText } from "../../src/session/lcm/validators"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const now = 1_779_000_000_000
const providerID = "provider_m43"
const modelID = "model_m43"

function operationID(suffix: string): OperationID {
  return `op_m43_${suffix}` as OperationID
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

async function seedRawConversation(worker: ReturnType<typeof createLcmDbWorker>, suffix: string, rawCount = 40) {
  const conversationID = `conv_m43_${suffix}` as ConversationID
  const sessionID = `ses_m43_${suffix}`
  const boundary = JSON.stringify(
    createHarnessBoundaryMetadata({
      projectID: "project_m43",
      workspaceID: "workspace_m43",
      sessionDirectoryOriginal: "/workspace/m43",
      sessionDirectoryCanonical: "/workspace/m43",
      worktreeOriginal: "/workspace/m43",
      worktreeCanonical: "/workspace/m43",
      allowedRootOriginals: ["/workspace/m43"],
      allowedRootCanonicals: ["/workspace/m43"],
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
            VALUES ($1, $2, $1, 'project_m43', 'workspace_m43', '/workspace/m43', '/workspace/m43',
                    $3::jsonb, 'lcm_active', 43, 1, $4, $4)
          `,
          [conversationID, sessionID, boundary, now],
        )

        for (let index = 1; index <= rawCount; index++) {
          const messageRowID = `msg_m43_${suffix}_${index}`
          const text = `soft backlog source message ${index}`
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
              conversationID,
              sessionID,
              `source_m43_${suffix}_${index}`,
              index,
              now + index,
              providerID,
              modelID,
              JSON.stringify({ version: 1, role: "user" }),
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
              `prt_m43_${suffix}_${index}`,
              messageRowID,
              conversationID,
              `derived:source_m43_${suffix}_${index}:1:text:i0s0c0`,
              text,
              `${index % 10}`.repeat(64),
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
                token_count,
                created_at_ms,
                updated_at_ms
              )
              VALUES ($1, $2, $3, 'raw_message', $4, 10, $5, $5)
            `,
            [`ctx_m43_${suffix}_${index}`, conversationID, index, messageRowID, now + index],
          )
        }
      },
    }),
  )

  return { conversationID, sessionID }
}

function softCompactionInput(input: {
  conversationID: ConversationID
  sessionID: string
  operationID: OperationID
  maintenanceInputBudget: number
  softThreshold?: number
  freshTailTokens?: number
  protectedCurrentUser?: LcmProtectedCurrentUserInput
  generator: LcmLeafSummaryGenerator
}) {
  return {
    conversationID: input.conversationID,
    reason: "soft_threshold" as const,
    blocking: false,
    operationID: input.operationID,
    sessionID: input.sessionID,
    providerID,
    modelID,
    maintenanceInputBudget: input.maintenanceInputBudget,
    softThreshold: input.softThreshold,
    freshTailTokens: input.freshTailTokens,
    protectedCurrentUser: input.protectedCurrentUser,
    tokenCounter: createDeterministicFallbackTokenCounter(),
    generator: input.generator,
  } as unknown as LcmLeafCompactionInput
}

async function setRawTokenCounts(
  worker: ReturnType<typeof createLcmDbWorker>,
  conversationID: ConversationID,
  counts: readonly number[],
) {
  await worker.executeForeground(
    request({
      run: async (db) => {
        const typedDb = db as PGlite
        for (const [index, tokenCount] of counts.entries()) {
          await typedDb.query(
            "UPDATE lcm_context_items SET token_count = $3 WHERE conversation_id = $1 AND item_order = $2",
            [conversationID, index + 1, tokenCount],
          )
        }
      },
    }),
  )
}

function acceptedSummaryFor(selectedMessageIDs: readonly string[], fillerCount: number) {
  return [
    "adaptive soft memory summary",
    ...selectedMessageIDs,
    ...Array.from({ length: fillerCount }, (_, index) => `detail_${index}_retained_for_quality`),
  ].join(" ")
}

test("lcm:soft-backlog threshold decision separates hard fill from raw-lane pressure", () => {
  const decision = computeThresholdDecision({
    conversationID: "conv_m43_decision" as ConversationID,
    strategy: "upward",
    budget: {
      providerContextLimit: 1000,
      providerInputLimit: 900,
      providerOutputLimit: 300,
      activeTokens: 500,
      systemPromptTokens: 50,
      toolSchemaTokens: 25,
    },
    laneItems: [
      { itemType: "raw_message", tokenCount: 250 },
      { itemType: "summary", tokenCount: 250, summaryType: "sprig", summaryLevel: 0 },
    ],
    softBacklogTokens: 250,
    softBacklogItemCount: 1,
  })

  expect(decision.activeTokens).toBe(500)
  expect(decision.hardLimit).toBe(675)
  expect(decision.hardFillRatio).toBeCloseTo(500 / 675)
  expect(decision.rawLaneTokens).toBe(250)
  expect(decision.rawLaneRatio).toBeCloseTo(250 / 375)
  expect(decision.softBacklogTokens).toBe(250)
  expect(decision.softBacklogRatio).toBeCloseTo(250 / 375)
  expect(decision.overSoft).toBe(false)
  expect(decision.overHard).toBe(false)

  const protectedTailPressure = computeThresholdDecision({
    conversationID: "conv_m43_decision_protected" as ConversationID,
    strategy: "upward",
    budget: {
      providerContextLimit: 1000,
      providerInputLimit: 900,
      providerOutputLimit: 300,
      activeTokens: 500,
      systemPromptTokens: 50,
      toolSchemaTokens: 25,
    },
    laneItems: [],
    softBacklogTokens: 7000,
    softBacklogItemCount: 3,
    protectedTailRawTokens: 2000,
    protectedTailRawItemCount: 2,
  })
  expect(protectedTailPressure.rawLaneTokens).toBe(9000)
  expect(protectedTailPressure.rawLaneRatio).toBeCloseTo(9000 / 375)
  expect(protectedTailPressure.overSoft).toBe(true)
})

test("lcm:soft-backlog soft compaction selects the whole eligible raw backlog when it fits", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "whole")
    let selectedMessageIDs: string[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("whole"),
            maintenanceInputBudget: 80,
            freshTailTokens: 20,
            generator: async ({ sourceItems }) => {
              selectedMessageIDs = sourceItems.map((item) => item.messageRowID)
              return [
                "useful soft sprig summary",
                ...selectedMessageIDs.slice(0, 4),
                ...Array.from({ length: 48 }, (_, index) => `d${index}`),
              ].join(" ")
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(result.workPerformed).toBe(true)
    expect(selectedMessageIDs).toEqual(Array.from({ length: 8 }, (_, index) => `msg_m43_whole_${index + 1}`))

    const evidence = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{
              context_count: number
              covered_count: number
              soft_backlog_tokens: number | null
              soft_backlog_item_count: number | null
              largest_source_tokens: string | null
              manifest_soft_tokens: string | null
            }>(
              `
                SELECT
                  (SELECT count(*)::int FROM lcm_context_items WHERE conversation_id = $1) AS context_count,
                  (SELECT count(*)::int FROM lcm_summary_messages sm JOIN lcm_summaries s ON s.summary_id = sm.summary_id WHERE s.conversation_id = $1) AS covered_count,
                  snapshot.soft_backlog_tokens,
                  snapshot.soft_backlog_item_count,
                  snapshot.metrics_json->>'softBacklogLargestSourceTokens' AS largest_source_tokens,
                  snapshot.restore_manifest_json->>'softBacklogTokens' AS manifest_soft_tokens
                FROM lcm_context_snapshots snapshot
                WHERE snapshot.conversation_id = $1
                ORDER BY snapshot.created_at_ms DESC, snapshot.snapshot_id DESC
                LIMIT 1
              `,
              [seeded.conversationID],
            )
          ).rows[0],
      }),
    )

    expect(evidence).toMatchObject({
      context_count: 33,
      covered_count: 8,
      soft_backlog_tokens: 0,
      soft_backlog_item_count: 0,
      largest_source_tokens: "0",
      manifest_soft_tokens: "0",
    })
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog adaptive soft tail leaves backlog with fewer than the old fixed tail", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "adaptive_eighteen", 18)
    await setRawTokenCounts(
      worker,
      seeded.conversationID,
      Array.from({ length: 18 }, () => 4000),
    )

    let selectedMessageIDs: string[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("adaptive_eighteen"),
            maintenanceInputBudget: 100_000,
            freshTailTokens: 8000,
            generator: async ({ sourceItems }) => {
              selectedMessageIDs = sourceItems.map((item) => item.messageRowID)
              return acceptedSummaryFor(selectedMessageIDs, 160)
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(selectedMessageIDs).toEqual(
      Array.from({ length: 16 }, (_, index) => `msg_m43_adaptive_eighteen_${index + 1}`),
    )
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog adaptive soft tail protects the newest fresh message even over token cap", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "oversized_fresh", 5)
    await setRawTokenCounts(worker, seeded.conversationID, [5000, 5000, 5000, 20_000, 20_000])

    let selectedMessageIDs: string[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("oversized_fresh"),
            maintenanceInputBudget: 50_000,
            freshTailTokens: 7500,
            generator: async ({ sourceItems }) => {
              selectedMessageIDs = sourceItems.map((item) => item.messageRowID)
              return acceptedSummaryFor(selectedMessageIDs, 160)
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(selectedMessageIDs).toEqual([
      "msg_m43_oversized_fresh_1",
      "msg_m43_oversized_fresh_2",
      "msg_m43_oversized_fresh_3",
      "msg_m43_oversized_fresh_4",
    ])
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog soft compaction protects the current user row and newer rows", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "protected_current", 8)
    await setRawTokenCounts(
      worker,
      seeded.conversationID,
      Array.from({ length: 8 }, () => 100),
    )

    let selectedMessageIDs: string[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("protected_current"),
            maintenanceInputBudget: 1000,
            freshTailTokens: 200,
            protectedCurrentUser: {
              sourceSessionID: seeded.sessionID,
              sourceMessageID: "source_m43_protected_current_6",
            },
            generator: async ({ sourceItems }) => {
              selectedMessageIDs = sourceItems.map((item) => item.messageRowID)
              return [
                "complete message sprig summary",
                ...selectedMessageIDs,
                ...Array.from({ length: 48 }, (_, index) => `pc${index}`),
              ].join(" ")
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(selectedMessageIDs).toEqual([
      "msg_m43_protected_current_1",
      "msg_m43_protected_current_2",
      "msg_m43_protected_current_3",
    ])

    const remainingRaw = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{ message_row_id: string }>(
              `
                SELECT message_row_id
                FROM lcm_context_items
                WHERE conversation_id = $1
                  AND item_type = 'raw_message'
                ORDER BY item_order
              `,
              [seeded.conversationID],
            )
          ).rows.map((row) => row.message_row_id),
      }),
    )
    expect(remainingRaw).toEqual([
      "msg_m43_protected_current_4",
      "msg_m43_protected_current_5",
      "msg_m43_protected_current_6",
      "msg_m43_protected_current_7",
      "msg_m43_protected_current_8",
    ])
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog consumed post-current rows become eligible outside the fresh tail", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "consumed_after_current", 8)
    await setRawTokenCounts(
      worker,
      seeded.conversationID,
      Array.from({ length: 8 }, () => 200),
    )

    let protectedSelected: string[] = []
    const protectedResult = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("consumed_after_current_protected"),
            maintenanceInputBudget: 1000,
            freshTailTokens: 100,
            protectedCurrentUser: {
              sourceSessionID: seeded.sessionID,
              sourceMessageID: "source_m43_consumed_after_current_4",
            },
            generator: async ({ sourceItems }) => {
              protectedSelected = sourceItems.map((item) => item.messageRowID)
              return acceptedSummaryFor(protectedSelected, 80)
            },
          }),
        ),
      ),
    )
    expect(protectedResult.status).toBe("skipped")
    expect(protectedSelected).toEqual([])

    await worker.executeForeground(
      request({
        run: async (db) => {
          const typedDb = db as PGlite
          await typedDb.query(
            `
              INSERT INTO lcm_provider_request_snapshots (
                request_snapshot_id,
                operation_id,
                conversation_id,
                source_session_id,
                provider_id,
                model_id,
                status,
                cue_ids_json,
                render_unit_ids_json,
                source_selection_hash,
                request_snapshot_protection_hash,
                visibility_hash,
                protected_span_hash,
                provider_transform_hash,
                provider_validator_hash,
                created_at_ms,
                expires_at_ms,
                terminal_at_ms
              )
              VALUES (
                'prs_m43_consumed_after_current',
                'op_m43_consumed_after_current_request',
                $1,
                $2,
                $3,
                $4,
                'resolved',
                '[]'::jsonb,
                '[]'::jsonb,
                'source',
                'protection',
                'visibility',
                'protected',
                'transform',
                'validator',
                $5,
                $6,
                $7
              )
            `,
            [seeded.conversationID, seeded.sessionID, providerID, modelID, now, now + 1000, now + 10],
          )
          for (const index of [5, 6, 7]) {
            await typedDb.query(
              `
                INSERT INTO lcm_context_item_consumption (
                  conversation_id,
                  context_item_id,
                  message_row_id,
                  first_request_snapshot_id,
                  first_operation_id,
                  first_consumed_at_ms
                )
                VALUES ($1, $2, $3, 'prs_m43_consumed_after_current', 'op_m43_consumed_after_current_request', $4)
              `,
              [
                seeded.conversationID,
                `ctx_m43_consumed_after_current_${index}`,
                `msg_m43_consumed_after_current_${index}`,
                now + 10,
              ],
            )
          }
        },
      }),
    )

    let consumedSelected: string[] = []
    const consumedResult = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("consumed_after_current_eligible"),
            maintenanceInputBudget: 1000,
            freshTailTokens: 100,
            protectedCurrentUser: {
              sourceSessionID: seeded.sessionID,
              sourceMessageID: "source_m43_consumed_after_current_4",
            },
            generator: async ({ sourceItems }) => {
              consumedSelected = sourceItems.map((item) => item.messageRowID)
              return acceptedSummaryFor(consumedSelected, 100)
            },
          }),
        ),
      ),
    )

    expect(consumedResult.status).toBe("completed")
    expect(consumedSelected).toEqual([
      "msg_m43_consumed_after_current_1",
      "msg_m43_consumed_after_current_2",
      "msg_m43_consumed_after_current_3",
      "msg_m43_consumed_after_current_5",
      "msg_m43_consumed_after_current_6",
    ])
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog soft compaction skips when the protected current user row is unproven", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "protected_missing", 5)
    let providerCalls = 0
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("protected_missing"),
            maintenanceInputBudget: 1000,
            protectedCurrentUser: {
              sourceSessionID: seeded.sessionID,
              sourceMessageID: "source_m43_protected_missing_absent",
            },
            generator: async () => {
              providerCalls++
              return "should not be used"
            },
          }),
        ),
      ),
    )

    expect(result).toMatchObject({
      status: "skipped",
      workNeeded: true,
      workPerformed: false,
      safeMessage:
        "Memory maintenance was skipped because the current user boundary is not available as a raw memory row.",
    })
    expect(providerCalls).toBe(0)
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog adaptive soft tail protects extra tiny messages only within token cap", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "many_small", 10)
    await setRawTokenCounts(
      worker,
      seeded.conversationID,
      Array.from({ length: 10 }, () => 1000),
    )

    let selectedMessageIDs: string[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("many_small"),
            maintenanceInputBudget: 20_000,
            freshTailTokens: 2000,
            generator: async ({ sourceItems }) => {
              selectedMessageIDs = sourceItems.map((item) => item.messageRowID)
              return acceptedSummaryFor(selectedMessageIDs, 120)
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(selectedMessageIDs).toEqual(Array.from({ length: 8 }, (_, index) => `msg_m43_many_small_${index + 1}`))
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog soft compaction reduces message count instead of truncating a message", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "complete_messages")
    await worker.executeForeground(
      request({
        run: async (db) =>
          (db as PGlite).query("UPDATE lcm_context_items SET token_count = 100 WHERE conversation_id = $1", [
            seeded.conversationID,
          ]),
      }),
    )
    let selected: { messageRowID: string; text: string; tokenCount: number }[] = []
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("complete_messages"),
            maintenanceInputBudget: 350,
            freshTailTokens: 200,
            generator: async ({ sourceItems }) => {
              selected = sourceItems.map((item) => ({
                messageRowID: item.messageRowID,
                text: item.text,
                tokenCount: item.tokenCount,
              }))
              return [
                "complete message sprig summary",
                ...selected.map((item) => item.messageRowID),
                ...Array.from({ length: 48 }, (_, index) => `cm${index}`),
              ].join(" ")
            },
          }),
        ),
      ),
    )

    expect(result.status).toBe("completed")
    expect(selected.map((item) => item.messageRowID)).toEqual([
      "msg_m43_complete_messages_1",
      "msg_m43_complete_messages_2",
      "msg_m43_complete_messages_3",
    ])
    expect(selected[0]?.text).toContain("soft backlog source message 1")
    expect(selected[1]?.text).toContain("soft backlog source message 2")
    expect(selected[2]?.text).toContain("soft backlog source message 3")
    expect(selected.reduce((total, item) => total + item.tokenCount, 0)).toBe(300)
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog no-fit soft compaction skips without provider work or active-context mutation", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "skip")
    let providerCalls = 0
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("skip"),
            maintenanceInputBudget: 20,
            freshTailTokens: 20,
            generator: async () => {
              providerCalls++
              return "should not be used"
            },
          }),
        ),
      ),
    )

    expect(result).toMatchObject({
      status: "skipped",
      workNeeded: true,
      workPerformed: false,
      blocking: false,
      summariesCreated: 0,
      contextItemsReplaced: 0,
    })
    expect(providerCalls).toBe(0)

    const counts = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{ context_count: number; summary_count: number }>(
              `
                SELECT
                  (SELECT count(*)::int FROM lcm_context_items WHERE conversation_id = $1) AS context_count,
                  (SELECT count(*)::int FROM lcm_summaries WHERE conversation_id = $1) AS summary_count
              `,
              [seeded.conversationID],
            )
          ).rows[0],
      }),
    )
    expect(counts).toEqual({ context_count: 40, summary_count: 0 })
  } finally {
    await worker.close()
  }
})

test("lcm:soft-backlog soft summary objective failure defers for retry", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
    const seeded = await seedRawConversation(worker, "objective_retry", 12)
    await setRawTokenCounts(
      worker,
      seeded.conversationID,
      Array.from({ length: 12 }, () => 100),
    )
    let providerCalls = 0
    const result = await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.compactLeavesToSprig(
          softCompactionInput({
            ...seeded,
            operationID: operationID("objective_retry"),
            maintenanceInputBudget: 800,
            freshTailTokens: 200,
            generator: async () => {
              providerCalls++
              return "too short"
            },
          }),
        ),
      ),
    )

    expect(result).toMatchObject({
      status: "deferred",
      workNeeded: true,
      workPerformed: false,
      beforeTokens: 800,
      afterTokens: 800,
      safeMessage: "Memory summary output did not meet quality checks. Memory maintenance will retry later.",
    })
    expect(result.safeError).toBeUndefined()
    expect(providerCalls).toBeGreaterThan(0)
  } finally {
    await worker.close()
  }
})
