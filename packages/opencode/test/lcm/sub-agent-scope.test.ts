// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import path from "node:path"
import { Effect } from "effect"
import { Session } from "../../src/session/session"
import { LcmDb } from "../../src/session/lcm/db"
import {
  ensureLcmDbReady,
  getCapabilities,
  getConversationScope,
  getOrCreateChildConversation,
  getOrCreateConversation,
} from "../../src/session/lcm/lifecycle"
import { lcmProviderCapacityKeyHash } from "../../src/session/lcm/provider-capacity"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import type { ConversationID, OperationID } from "../../src/session/lcm/types"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

function operationID(suffix: string): OperationID {
  return `op_m20_${suffix}_${Date.now().toString(36)}` as OperationID
}

function runLcm<A, E>(effect: Effect.Effect<A, E, LcmDb.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.ensuring(LcmDb.Service.use((db) => db.close()).pipe(Effect.ignore)),
      Effect.provide(LcmDb.defaultLayer),
    ),
  )
}

function runRuntime<A, E>(effect: Effect.Effect<A, E, LcmRuntime.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.ensuring(LcmRuntime.Service.use((svc) => svc.close()).pipe(Effect.ignore)),
      Effect.provide(LcmRuntime.defaultLayer),
    ),
  )
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(Session.defaultLayer)))
}

function createSession(input: Parameters<Session.Interface["create"]>[0]) {
  return runSession(Session.Service.use((session) => session.create(input)))
}

function dbExec(sql: string, params: unknown[] = []) {
  return LcmDb.Service.use((svc) =>
    svc.executeForeground({
      operationID: operationID("db"),
      purpose: "debug_support",
      run: async (db) => {
        await (db as PGlite).query(sql, params)
      },
    }),
  )
}

async function createSessionTree(directory: string) {
  return provideTestInstance({
    directory,
    fn: async () => {
      const root = await createSession({ title: "m20 root" })
      const task = await createSession({ title: "m20 task", parentID: root.id })
      const sibling = await createSession({ title: "m20 sibling", parentID: root.id })
      const explore = await createSession({ title: "m20 explore", parentID: root.id })
      const map = await createSession({ title: "m20 map", parentID: root.id })
      const nested = await createSession({ title: "m20 nested", parentID: task.id })
      return { root, task, sibling, explore, map, nested }
    },
  })
}

test("lcm:sub-agent-scope links task/explore/map children to root lineage", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const sessions = await createSessionTree(tmp.path)

  const result = await runLcm(
    Effect.gen(function* () {
      const rootID = yield* getOrCreateConversation({ sessionID: sessions.root.id, dataDir })
      yield* dbExec(
        `
          INSERT INTO lcm_large_files (
            file_id,
            conversation_id,
            source_kind,
            mime_type,
            created_at_ms,
            updated_at_ms
          )
          VALUES ('file_m20_map_input', $1, 'map_input', 'application/jsonl', $2, $2)
        `,
        [rootID, Date.now()],
      )
      yield* dbExec(
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
            'map_m20_fixture',
            $1,
            'agentic_map',
            'running',
            'fingerprint_m20_map',
            'file_m20_map_input',
            1,
            2,
            'prompt',
            'prompt_sha',
            '{"selector":"default","providerID":"p","modelID":"m"}'::jsonb,
            'read_only',
            '{"type":"object"}'::jsonb,
            'schema_sha',
            $2,
            $2
          )
        `,
        [rootID, Date.now()],
      )
      yield* dbExec(
        `
          INSERT INTO lcm_map_items (map_id, item_index, status, attempts, created_at_ms, updated_at_ms)
          VALUES ('map_m20_fixture', 0, 'running', 1, $1, $1)
        `,
        [Date.now()],
      )
      const taskScope = yield* getOrCreateChildConversation({
        sessionID: sessions.task.id,
        parentSessionID: sessions.root.id,
        capabilityClass: "task_child",
        source: "kilo_task",
        sourceMessageID: "msg_m20_task_source",
        sourceToolCallID: "toolu_m20_task",
        readCapable: false,
        dataDir,
      })
      const exploreScope = yield* getOrCreateChildConversation({
        sessionID: sessions.explore.id,
        parentSessionID: sessions.root.id,
        capabilityClass: "explore_child",
        source: "lcm_explore",
        operationID: operationID("explore"),
        dataDir,
      })
      const mapScope = yield* getOrCreateChildConversation({
        sessionID: sessions.map.id,
        parentSessionID: sessions.root.id,
        capabilityClass: "map_child",
        source: "lcm_map",
        operationID: operationID("map"),
        mapID: "map_m20_fixture",
        mapItemID: "item_0",
        dataDir,
      })
      return { rootID, taskScope, exploreScope, mapScope }
    }),
  )

  expect(result.taskScope).toMatchObject({
    sessionID: sessions.task.id,
    parentConversationID: result.rootID,
    rootConversationID: result.rootID,
    capabilityClass: "task_child",
    capabilityProven: true,
    directContentToolsAllowed: false,
  })
  expect(result.taskScope.ancestorConversationIDs).toEqual([result.rootID])
  expect(result.taskScope.allowedConversationIDs).toEqual([result.taskScope.conversationID, result.rootID])
  expect(result.exploreScope).toMatchObject({
    parentConversationID: result.rootID,
    rootConversationID: result.rootID,
    capabilityClass: "explore_child",
    directContentToolsAllowed: true,
  })
  expect(result.mapScope).toMatchObject({
    parentConversationID: result.rootID,
    rootConversationID: result.rootID,
    capabilityClass: "map_child",
    directContentToolsAllowed: true,
  })
})

test("lcm:sub-agent-scope rejects recursive child creation and unprovable restart metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const sessions = await createSessionTree(tmp.path)

  await expect(
    runLcm(
      Effect.gen(function* () {
        yield* getOrCreateConversation({ sessionID: sessions.root.id, dataDir })
        yield* getOrCreateChildConversation({
          sessionID: sessions.task.id,
          parentSessionID: sessions.root.id,
          capabilityClass: "task_child",
          source: "kilo_task",
          dataDir,
        })
        yield* getOrCreateChildConversation({
          sessionID: sessions.nested.id,
          parentSessionID: sessions.task.id,
          capabilityClass: "task_child",
          source: "kilo_task",
          dataDir,
        })
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_child_recursion_denied",
  })

  await expect(
    runLcm(
      Effect.gen(function* () {
        yield* ensureLcmDbReady({ dataDir })
        yield* dbExec(
          `
            UPDATE lcm_conversations
            SET orchestration_metadata_json = '{}'::jsonb
            WHERE source_session_id = $1
          `,
          [sessions.task.id],
        )
        yield* getConversationScope({ sessionID: sessions.task.id, dataDir })
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_capability_metadata_version",
  })

  const malformedCapabilities = await runLcm(
    getCapabilities({
      sessionID: sessions.task.id,
      strategy: "upward",
      dataDir,
    }),
  )
  expect(malformedCapabilities.canRetrieve).toBe(false)
  expect(malformedCapabilities.safeError?.diagnosticCode).toBe("lcm_capability_metadata_version")
})

test("lcm:sub-agent-scope excludes siblings and descendants from scoped lineage", async () => {
  await using tmp = await tmpdir({ git: true })
  await using foreignTmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const sessions = await createSessionTree(tmp.path)
  const foreignRoot = await provideTestInstance({
    directory: foreignTmp.path,
    fn: () => createSession({ title: "m20 foreign root" }),
  })

  const result = await runLcm(
    Effect.gen(function* () {
      const rootID = yield* getOrCreateConversation({ sessionID: sessions.root.id, dataDir })
      const foreignRootID = yield* getOrCreateConversation({ sessionID: foreignRoot.id, dataDir })
      const taskScope = yield* getOrCreateChildConversation({
        sessionID: sessions.task.id,
        parentSessionID: sessions.root.id,
        capabilityClass: "task_child",
        source: "kilo_task",
        dataDir,
      })
      const siblingScope = yield* getOrCreateChildConversation({
        sessionID: sessions.sibling.id,
        parentSessionID: sessions.root.id,
        capabilityClass: "task_child",
        source: "kilo_task",
        dataDir,
      })
      return { rootID, foreignRootID, taskScope, siblingScope }
    }),
  )

  expect(result.taskScope.allowedConversationIDs).toContain(result.rootID)
  expect(result.taskScope.allowedConversationIDs).toContain(result.taskScope.conversationID)
  expect(result.taskScope.allowedConversationIDs).not.toContain(result.siblingScope.conversationID)
  expect(result.taskScope.allowedConversationIDs).not.toContain(result.foreignRootID)

  await expect(
    runLcm(
      Effect.gen(function* () {
        yield* ensureLcmDbReady({ dataDir })
        yield* dbExec(
          `
            UPDATE lcm_conversations
            SET parent_conversation_id = $2
            WHERE conversation_id = $1
          `,
          [result.taskScope.conversationID, result.siblingScope.conversationID],
        )
        yield* getConversationScope({ sessionID: sessions.task.id, dataDir })
      }),
    ),
  ).rejects.toMatchObject({
    code: "invalid_request",
    diagnosticCode: "lcm_child_metadata_parent_conversation",
  })
})

test("lcm:sub-agent-scope shares runtime worker and enforces child slot caps", async () => {
  await using tmp = await tmpdir({ git: true })
  const sessions = await createSessionTree(tmp.path)
  const previous = process.env.KILO_LCM_DATA_DIR
  process.env.KILO_LCM_DATA_DIR = path.join(tmp.path, "lcm")
  try {
    const runtimeScope = await provideTestInstance({
      directory: tmp.path,
      fn: () =>
        runRuntime(
          LcmRuntime.Service.use((svc) =>
            Effect.gen(function* () {
              const rootID = yield* svc.getOrCreateConversation({ sessionID: sessions.root.id })
              const childScope = yield* svc.getOrCreateChildConversation({
                sessionID: sessions.task.id,
                parentSessionID: sessions.root.id,
                capabilityClass: "task_child",
                source: "kilo_task",
                sourceMessageID: "msg_m20_runtime",
                sourceToolCallID: "toolu_m20_runtime",
                readCapable: false,
              })
              const capabilities = yield* svc.getCapabilities({ sessionID: sessions.task.id })
              return { rootID, childScope, capabilities }
            }),
          ),
        ),
    })
    expect(runtimeScope.childScope.rootConversationID).toBe(runtimeScope.rootID)
    expect(runtimeScope.capabilities).toMatchObject({
      sessionID: sessions.task.id,
      conversationID: runtimeScope.childScope.conversationID,
      lifecycleState: "lcm_active",
      dbReady: true,
      canRetrieve: true,
    })

    const rootConversationID = "conv_m20_root_slot" as ConversationID
    await expect(
      runRuntime(
        LcmRuntime.Service.use((svc) =>
          Effect.gen(function* () {
            const releases = []
            for (let index = 0; index < 8; index++) {
              releases.push(
                yield* svc.acquireChildSessionSlot({
                  sessionID: `ses_m20_child_${index}`,
                  rootConversationID,
                  projectID: "proj_m20",
                  workspaceID: "ws_m20",
                  capabilityClass: "task_child",
                }),
              )
            }
            yield* svc.acquireChildSessionSlot({
              sessionID: "ses_m20_child_over_root",
              rootConversationID,
              projectID: "proj_m20",
              workspaceID: "ws_m20",
              capabilityClass: "task_child",
            })
            return releases
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_child_slot_root_exhausted",
    })

    const result = await runRuntime(
      LcmRuntime.Service.use((svc) =>
        Effect.gen(function* () {
          const first = yield* svc.acquireChildSessionSlot({
            sessionID: "ses_m20_release_first",
            rootConversationID,
            projectID: "proj_m20",
            workspaceID: "ws_m20",
            capabilityClass: "task_child",
          })
          yield* first.release
          return yield* svc.acquireChildSessionSlot({
            sessionID: "ses_m20_release_second",
            rootConversationID,
            projectID: "proj_m20",
            workspaceID: "ws_m20",
            capabilityClass: "task_child",
          })
        }),
      ),
    )
    expect(result.rootActive).toBe(1)
    expect(result.workspaceActive).toBe(1)
    await Effect.runPromise(result.release)

    await expect(
      runRuntime(
        LcmRuntime.Service.use((svc) =>
          Effect.gen(function* () {
            const first = yield* svc.acquireChildSessionSlot({
              sessionID: "ses_m20_local_provider_first",
              rootConversationID: "conv_m20_local_provider_root" as ConversationID,
              projectID: "proj_m20",
              workspaceID: "ws_m20",
              capabilityClass: "task_child",
              localProviderCapacityKey: "local_ollama|http://127.0.0.1:11434",
            })
            try {
              yield* svc.acquireChildSessionSlot({
                sessionID: "ses_m20_local_provider_second",
                rootConversationID: "conv_m20_local_provider_root" as ConversationID,
                projectID: "proj_m20",
                workspaceID: "ws_m20",
                capabilityClass: "explore_child",
                localProviderCapacityKey: "local_ollama|http://127.0.0.1:11434",
              })
            } finally {
              yield* first.release
            }
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "provider_capacity_deferred",
      templateKey: "lcm.provider_capacity.deferred",
      diagnosticCode: "lcm_child_slot_local_provider_busy",
      retryable: true,
      safeParams: {
        providerEndpointKeyHash: lcmProviderCapacityKeyHash("local_ollama|http://127.0.0.1:11434"),
        capacityClass: "local_ollama",
        retryable: true,
        action: "retry",
      },
    })

    await expect(
      runRuntime(
        LcmRuntime.Service.use((svc) =>
          Effect.gen(function* () {
            for (let index = 0; index < 16; index++) {
              yield* svc.acquireChildSessionSlot({
                sessionID: `ses_m20_workspace_child_${index}`,
                rootConversationID: `conv_m20_workspace_root_${index}` as ConversationID,
                projectID: "proj_m20",
                workspaceID: "ws_m20_workspace_cap",
                capabilityClass: "explore_child",
              })
            }
            yield* svc.acquireChildSessionSlot({
              sessionID: "ses_m20_workspace_over",
              rootConversationID: "conv_m20_workspace_root_over" as ConversationID,
              projectID: "proj_m20",
              workspaceID: "ws_m20_workspace_cap",
              capabilityClass: "explore_child",
            })
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      diagnosticCode: "lcm_child_slot_workspace_exhausted",
    })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_DATA_DIR
    else process.env.KILO_LCM_DATA_DIR = previous
  }
})
