// kilocode_change - new file
import { expect, test } from "bun:test"
import type { Tool as AITool } from "ai"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import type { Permission } from "../../src/permission"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Session from "../../src/session/session"
import type { Info as SessionInfo } from "../../src/session/session"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { lcmShouldAdmitPromptPathBackedFile } from "../../src/session/lcm/admission"
import {
  addLargeFileMarkerContextItem,
  loadLargeFileStatus,
  registerMapArtifactFile,
  registerPathBackedFile,
  readLargeFileRowWindow,
} from "../../src/session/lcm/large-files"
import { LcmRuntime } from "../../src/session/lcm/runtime"
import {
  LcmContext,
  Service as LcmContextService,
  type LcmRawLeafRenderPreparationInput,
} from "../../src/session/lcm/context"
import { renderLargeFileMarker } from "../../src/session/lcm/artifacts"
import { makeFixtureClock } from "../../src/session/lcm/render-prep"
import { syncFinalizedMessages } from "../../src/session/lcm/source-sync"
import type {
  ConversationID,
  LcmAssemblyInput,
  LcmDbRequest,
  LcmSafeError,
  OperationID,
} from "../../src/session/lcm/types"
import { validateArtifactPath } from "../../src/session/lcm/validators"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const now = 1_777_500_160_000
const providerID = "provider-large-file" as ProviderID
const modelID = "model-large-file" as ModelID

function operationID(suffix: string): OperationID {
  return `op_m16_${suffix}` as OperationID
}

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">): Omit<LcmDbRequest<T>, "lane"> {
  return {
    operationID: operationID("test"),
    purpose: "debug_support",
    run: input.run,
  }
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

function updateSessionMessage<T extends MessageV2.Info>(message: T) {
  return runSession(Session.Service.use((session) => session.updateMessage(message)))
}

function updateSessionPart<T extends MessageV2.Part>(part: T) {
  return runSession(Session.Service.use((session) => session.updatePart(part)))
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

async function insertTestConversation(input: {
  worker: ReturnType<typeof createLcmDbWorker>
  conversationID: ConversationID
  boundaryMetadata: unknown
}) {
  await input.worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
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
              capability_class,
              orchestration_metadata_json,
              lifecycle_state,
              schema_version,
              feature_version,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, $1, 'project_m23', 'workspace_m23', $3, $3, $4::jsonb, 'root',
                    $5::jsonb, 'lcm_active', 23, 1, $6, $6)
          `,
          [
            input.conversationID,
            "session_m23_large_file",
            (input.boundaryMetadata as { sessionDirectoryCanonical?: string }).sessionDirectoryCanonical ?? "",
            JSON.stringify(input.boundaryMetadata),
            JSON.stringify({ version: 1, source: "kilo_session", capabilityClass: "root" }),
            now,
          ],
        )
      },
    }),
  )
}

async function boundaryMetadataForRoot(root: string) {
  const canonicalRoot = await fs.realpath(root)
  return createHarnessBoundaryMetadata({
    projectID: "project_m23",
    workspaceID: "workspace_m23",
    sessionDirectoryOriginal: root,
    sessionDirectoryCanonical: canonicalRoot,
    worktreeOriginal: root,
    worktreeCanonical: canonicalRoot,
    allowedRootOriginals: [root],
    allowedRootCanonicals: [canonicalRoot],
  })
}

function tokens() {
  return {
    input: 1,
    output: 1,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
}

function payload(label: string) {
  return `${label}_START\n${"x".repeat(101_000)}\n${label}_END`
}

function fakeModel(): Provider.Model {
  return {
    id: modelID,
    providerID,
    api: {
      id: modelID,
      npm: "@ai-sdk/openai",
      url: "https://example.invalid/openai",
    },
    name: "Large File Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-05-01",
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
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
    tools: {},
    options: {},
  } as Agent.Info
}

function fakeSession(session: Session.Info, directory: string): SessionInfo {
  return {
    id: session.id,
    projectID: session.projectID,
    directory,
    title: session.title,
    version: "test",
    time: { created: now, updated: now },
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
  } as SessionInfo
}

function tool(): AITool {
  return {
    description: "large file fixture tool",
    inputSchema: {},
    execute: async () => "ok",
  } as unknown as AITool
}

function lastUserInfo(messages: MessageV2.WithParts[]) {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user || user.info.role !== "user") throw new Error("missing user fixture")
  return user.info
}

function renderPreparation(input: {
  session: Session.Info
  directory: string
  messages: MessageV2.WithParts[]
}): LcmRawLeafRenderPreparationInput {
  const sessionID = input.session.id as SessionID
  return {
    sessionID,
    session: fakeSession(input.session, input.directory),
    agent: fakeAgent(),
    model: fakeModel(),
    permissionProfile: fakeSession(input.session, input.directory).permission as Permission.Ruleset,
    taskCapabilityClass: "root",
    messageVisibility: {
      version: "kilo-prompt-queue-visibility-v1",
      hash: "large-file-visibility",
      visibleMessageIDs: input.messages.map((message) => message.info.id),
      hiddenMessageIDs: [],
    },
    envCache: {},
    clock: makeFixtureClock(now + 20),
    stripMedia: false,
    format: { type: "text" },
    lastUser: lastUserInfo(input.messages),
    resolveSystem: () => Effect.succeed(["large file system"]),
    resolveTools: () => Effect.succeed({ large_file_tool: tool() }),
  }
}

async function seedLargePayloadFixture(directory: string) {
  const session = await createSession({ title: "m16 large file" })
  const user = await updateSessionMessage<MessageV2.User>({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: now },
    agent: "code",
    model: { providerID, modelID },
  })
  const userText = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: user.id,
    type: "text",
    text: payload("USER_PAYLOAD"),
  })
  const userFile = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: user.id,
    type: "file",
    mime: "image/png",
    filename: "fixture.png",
    url: "data:image/png;base64,aGVsbG8=",
  })

  const assistant = await updateSessionMessage<MessageV2.Assistant>({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "assistant",
    time: { created: now + 10, completed: now + 100 },
    parentID: user.id,
    providerID,
    modelID,
    mode: "code",
    agent: "code",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: tokens(),
    finish: "stop",
  })
  const assistantText = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "text",
    text: payload("ASSISTANT_TEXT"),
    time: { start: now + 20, end: now + 30 },
  })
  const reasoning = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "reasoning",
    text: payload("ASSISTANT_REASONING"),
    time: { start: now + 31, end: now + 40 },
  })
  const completedTool = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "tool",
    callID: "call_large_output",
    tool: "large_file_tool",
    state: {
      status: "completed",
      input: { zed: false, alpha: { beta: "needle" } },
      output: payload("TOOL_OUTPUT"),
      title: "Large output",
      metadata: {},
      time: { start: now + 41, end: now + 50 },
    },
  })
  const erroredTool = await updateSessionPart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: assistant.id,
    type: "tool",
    callID: "call_large_error",
    tool: "large_file_tool",
    state: {
      status: "error",
      input: { cmd: "large" },
      error: payload("TOOL_ERROR"),
      metadata: { interrupted: true, output: payload("INTERRUPTED_OUTPUT") },
      time: { start: now + 51, end: now + 60 },
    },
  })

  return {
    session,
    messages: [
      { info: user, parts: [userText, userFile] },
      { info: assistant, parts: [assistantText, reasoning, completedTool, erroredTool] },
    ] satisfies MessageV2.WithParts[],
  }
}

test("large-file-marker-v1 renders exact label order", () => {
  expect(
    renderLargeFileMarker({
      fileID: "file_fixture" as never,
      sourceKind: "tool_output",
      byteCount: 123,
      sha256: "sha256_fixture",
      explorationStatus: "not_started",
      previewText: "bounded preview text",
    }),
  ).toBe(
    [
      "[File ID: file_fixture]",
      "[Source Kind: tool_output]",
      "[Bytes: 123]",
      "[SHA-256: sha256_fixture]",
      "[Exploration: not_started]",
      "[Recovery: root sessions use lcm_expand_query with this File ID; lcm_read requires child/explore/map access]",
      "",
      "[Preview]",
      "bounded preview text",
    ].join("\n"),
  )
})

test("prompt path admission policy admits only full reads above threshold", () => {
  expect(lcmShouldAdmitPromptPathBackedFile({ byteCount: 39_999, thresholdBytes: 40_000 })).toBe(false)
  expect(lcmShouldAdmitPromptPathBackedFile({ byteCount: 40_001, thresholdBytes: 40_000 })).toBe(true)
  expect(lcmShouldAdmitPromptPathBackedFile({ byteCount: 400_000, thresholdBytes: 40_000, offset: 10 })).toBe(false)
  expect(lcmShouldAdmitPromptPathBackedFile({ byteCount: 400_000, thresholdBytes: 40_000, limit: 20 })).toBe(false)
})

test("path-backed registrations persist provenance, markers, status, and read validation", async () => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const sourceDir = path.join(tmp.path, "src")
  const sourcePath = path.join(sourceDir, "path-backed.txt")
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.writeFile(sourcePath, "PATH_BACKED_SECRET_DO_NOT_SEARCH\nsecond line")

  const worker = await initialize(dataDir)
  const conversationID = "conv_m23_path" as ConversationID
  const boundaryMetadata = await boundaryMetadataForRoot(tmp.path)
  const artifactRoot = resolveLcmDbLayout(dataDir).artifactsDir
  try {
    await insertTestConversation({ worker, conversationID, boundaryMetadata })
    const row = await worker.executeForeground(
      request({
        run: (db) =>
          registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: sourcePath,
            boundaryMetadata,
            mimeType: "text/plain",
            nowMs: now,
          }),
      }),
    )
    expect(row.file_id).toMatch(/^file_[a-f0-9]{32}$/)
    expect(row.source_kind).toBe("path")
    expect(row.path_hash_mode).toBe("full")
    expect(row.path_content_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(row.boundary_metadata_json).toMatchObject({ projectID: "project_m23", workspaceID: "workspace_m23" })
    expect(row.preview_text).toContain("PATH_BACKED_SECRET")

    const reread = await worker.executeForeground(
      request({
        run: (db) =>
          registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: sourcePath,
            boundaryMetadata,
            mimeType: "text/plain",
            nowMs: now + 1,
          }),
      }),
    )
    expect(reread.file_id).toBe(row.file_id)

    const contextItemID = await worker.executeForeground(
      request({
        run: (db) =>
          addLargeFileMarkerContextItem({
            db: db as PGlite,
            conversationID,
            fileID: row.file_id,
            nowMs: now + 2,
          }),
      }),
    )
    expect(contextItemID).toMatch(/^ctx_/)
    const markers = await query<{ item_type: string; file_id: string }>(
      worker,
      `SELECT item_type, file_id FROM lcm_context_items WHERE conversation_id = $1`,
      [conversationID],
    )
    expect(markers).toEqual([{ item_type: "large_file_marker", file_id: row.file_id }])

    const read = await readLargeFileRowWindow({
      row,
      artifactRoot,
      window: { byteOffset: 0, maxBytes: 11 },
      permissionCheck: () => "allowed",
    })
    expect(read).toMatchObject({
      ok: true,
      fileID: row.file_id,
      sourceKind: "path",
      encoding: "utf8",
      content: "PATH_BACKED",
      page: { hasMore: true, nextCursor: "11" },
    })

    const readAbort = new AbortController()
    readAbort.abort()
    let readCanceled: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 4 },
        permissionCheck: () => "allowed",
        abortSignal: readAbort.signal,
      })
    } catch (error) {
      readCanceled = error as LcmSafeError
    }
    expect(readCanceled).toMatchObject({
      code: "canceled",
      templateKey: "lcm.operation.canceled",
      diagnosticCode: "lcm_file_read_canceled",
    })

    let denied: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 4 },
        permissionCheck: () => "denied",
      })
    } catch (error) {
      denied = error as LcmSafeError
    }
    expect(denied).toMatchObject({
      code: "permission_denied",
      templateKey: "lcm.file.stale",
      safeParams: { fileID: row.file_id, staleState: "permission_denied" },
    })

    await fs.writeFile(sourcePath, "changed-before-denied-permission")
    let staleBeforePermission: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 4 },
        permissionCheck: () => "denied",
      })
    } catch (error) {
      staleBeforePermission = error as LcmSafeError
    }
    expect(staleBeforePermission).toMatchObject({
      code: "stale_source",
      templateKey: "lcm.file.stale",
      safeParams: { fileID: row.file_id, staleState: "size_mismatch" },
    })

    await fs.writeFile(sourcePath, "changed")
    let stale: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 4 },
        permissionCheck: () => "allowed",
      })
    } catch (error) {
      stale = error as LcmSafeError
    }
    expect(stale).toMatchObject({
      code: "stale_source",
      templateKey: "lcm.file.stale",
      safeParams: { fileID: row.file_id, staleState: "size_mismatch" },
    })
    if (!stale) throw new Error("expected stale path-backed source")

    const changed = await worker.executeForeground(
      request({
        run: (db) =>
          registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: sourcePath,
            boundaryMetadata,
            mimeType: "text/plain",
            nowMs: now + 3,
          }),
      }),
    )
    expect(changed.file_id).not.toBe(row.file_id)
    expect(changed.path_content_sha256).not.toBe(row.path_content_sha256)

    const status = await worker.executeForeground(
      request({
        run: (db) =>
          loadLargeFileStatus(db as PGlite, row.file_id, {
            staleState: "size_mismatch",
            blockingUse: true,
            safeError: stale,
          }),
      }),
    )
    expect(status).toMatchObject({
      fileID: row.file_id,
      sourceKind: "path",
      staleState: "size_mismatch",
      safeReason: "stale_source",
      blockingUse: true,
    })

    const deniedRegistrationPath = path.join(sourceDir, "denied-registration.txt")
    await fs.writeFile(deniedRegistrationPath, "denied registration secret")
    let permissionChecks = 0
    let registrationDenied: LcmSafeError | undefined
    try {
      await worker.executeForeground(
        request({
          run: (db) =>
            registerPathBackedFile({
              db: db as PGlite,
              conversationID,
              originalPath: deniedRegistrationPath,
              boundaryMetadata,
              mimeType: "text/plain",
              permissionCheck: async () => {
                permissionChecks++
                await fs.writeFile(deniedRegistrationPath, "mutated before denied permission")
                return "denied" as const
              },
              nowMs: now + 4,
            }),
        }),
      )
    } catch (error) {
      registrationDenied = error as LcmSafeError
    }
    expect(permissionChecks).toBe(1)
    expect(registrationDenied).toMatchObject({
      code: "permission_denied",
      templateKey: "lcm.file.stale",
      action: "repeat_input",
      safeParams: {
        staleState: "permission_denied",
        action: "repeat_input",
      },
      diagnosticCode: "lcm_path_registration_permission_denied",
    })
    const deniedRows = await query<{ file_id: string }>(
      worker,
      `SELECT file_id FROM lcm_large_files WHERE original_path = $1`,
      [deniedRegistrationPath],
    )
    expect(deniedRows).toEqual([])

    const canceledRegistrationPath = path.join(sourceDir, "canceled-registration.txt")
    await fs.writeFile(canceledRegistrationPath, "canceled registration secret")
    const registrationAbort = new AbortController()
    let registrationCanceled: LcmSafeError | undefined
    try {
      await worker.executeForeground(
        request({
          run: (db) =>
            registerPathBackedFile({
              db: db as PGlite,
              conversationID,
              originalPath: canceledRegistrationPath,
              boundaryMetadata,
              mimeType: "text/plain",
              permissionCheck: () => {
                registrationAbort.abort()
                return "allowed" as const
              },
              nowMs: now + 5,
              abortSignal: registrationAbort.signal,
            }),
        }),
      )
    } catch (error) {
      registrationCanceled = error as LcmSafeError
    }
    expect(registrationCanceled).toMatchObject({
      code: "canceled",
      templateKey: "lcm.operation.canceled",
      diagnosticCode: "lcm_path_registration_canceled",
    })
    const canceledRows = await query<{ file_id: string }>(
      worker,
      `SELECT file_id FROM lcm_large_files WHERE original_path = $1`,
      [canceledRegistrationPath],
    )
    expect(canceledRows).toEqual([])

    const externalPath = path.join(external.path, "external-path.txt")
    await fs.writeFile(externalPath, "EXTERNAL_SECRET_FOR_PERMISSION_FLOW")
    let externalRegistrationDenied: LcmSafeError | undefined
    try {
      await worker.executeForeground(
        request({
          run: (db) =>
            registerPathBackedFile({
              db: db as PGlite,
              conversationID,
              originalPath: externalPath,
              boundaryMetadata,
              mimeType: "text/plain",
              nowMs: now + 6,
            }),
        }),
      )
    } catch (error) {
      externalRegistrationDenied = error as LcmSafeError
    }
    expect(externalRegistrationDenied).toMatchObject({
      code: "permission_denied",
      diagnosticCode: "lcm_path_registration_permission_denied",
    })
    const externalDeniedRows = await query<{ file_id: string }>(
      worker,
      `SELECT file_id FROM lcm_large_files WHERE original_path = $1`,
      [externalPath],
    )
    expect(externalDeniedRows).toEqual([])

    let externalPermissionChecks = 0
    const externalRow = await worker.executeForeground(
      request({
        run: (db) =>
          registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: externalPath,
            boundaryMetadata,
            mimeType: "text/plain",
            permissionCheck: () => {
              externalPermissionChecks++
              return "allowed"
            },
            nowMs: now + 6,
          }),
      }),
    )
    expect(externalPermissionChecks).toBe(1)
    expect(externalRow.file_id).toMatch(/^file_[a-f0-9]{32}$/)
    const externalRead = await readLargeFileRowWindow({
      row: externalRow,
      artifactRoot,
      window: { byteOffset: 0, maxBytes: 8 },
      permissionCheck: () => "allowed",
    })
    expect(externalRead).toMatchObject({
      ok: true,
      sourceKind: "path",
      content: "EXTERNAL",
    })
    let externalReadDenied: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row: externalRow,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 8 },
      })
    } catch (error) {
      externalReadDenied = error as LcmSafeError
    }
    expect(externalReadDenied).toMatchObject({
      code: "permission_denied",
      safeParams: { fileID: externalRow.file_id, staleState: "permission_denied" },
    })
  } finally {
    await worker.close()
  }
})

test("map artifact files persist artifact metadata and read bounded windows", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initialize(dataDir)
  const conversationID = "conv_m23_map" as ConversationID
  const boundaryMetadata = await boundaryMetadataForRoot(tmp.path)
  const artifactRoot = resolveLcmDbLayout(dataDir).artifactsDir
  const bytes = Buffer.concat([Buffer.from("MAP_UTF8_"), Buffer.from([0xc3, 0xa9]), Buffer.from("_END")])
  try {
    await insertTestConversation({ worker, conversationID, boundaryMetadata })
    const row = await worker.executeForeground(
      request({
        run: (db) =>
          registerMapArtifactFile({
            db: db as PGlite,
            artifactRoot,
            conversationID,
            sourceKind: "map_input",
            bytes,
            stableSeed: "map-input-1",
            mimeType: "text/plain",
            nowMs: now,
          }),
      }),
    )
    expect(row.file_id).toMatch(/^file_[a-f0-9]{32}$/)
    expect(row.source_kind).toBe("map_input")
    expect(row.artifact_storage_kind).toBe("file")
    expect(Number(row.artifact_byte_count)).toBe(bytes.byteLength)
    expect(row.artifact_content_sha256).toMatch(/^[a-f0-9]{64}$/)

    const idempotent = await worker.executeForeground(
      request({
        run: (db) =>
          registerMapArtifactFile({
            db: db as PGlite,
            artifactRoot,
            conversationID,
            sourceKind: "map_input",
            bytes,
            stableSeed: "map-input-1",
            mimeType: "text/plain",
            nowMs: now + 1,
          }),
      }),
    )
    expect(idempotent.file_id).toBe(row.file_id)

    const text = await readLargeFileRowWindow({
      row,
      artifactRoot,
      window: { byteOffset: 0, maxBytes: bytes.byteLength },
    })
    expect(text).toMatchObject({
      ok: true,
      sourceKind: "map_input",
      encoding: "utf8",
      page: { hasMore: false },
    })
    expect(text.content).toContain("MAP_UTF8_")

    const splitUtf8 = await readLargeFileRowWindow({
      row,
      artifactRoot,
      window: { byteOffset: Buffer.from("MAP_UTF8_").byteLength + 1, maxBytes: 2 },
    })
    expect(splitUtf8).toMatchObject({
      ok: true,
      encoding: "base64",
      page: { hasMore: true },
    })

    await fs.writeFile(path.join(artifactRoot, row.artifact_path!), "corrupt")
    let invalidArtifact: LcmSafeError | undefined
    try {
      await readLargeFileRowWindow({
        row,
        artifactRoot,
        window: { byteOffset: 0, maxBytes: 4 },
      })
    } catch (error) {
      invalidArtifact = error as LcmSafeError
    }
    expect(invalidArtifact).toMatchObject({
      code: "stale_source",
      templateKey: "lcm.file.stale",
      safeParams: { fileID: row.file_id, staleState: "artifact_size_mismatch" },
    })
  } finally {
    await worker.close()
  }
})

test("runtime path admission stores an LCM marker before prompt payload injection", async () => {
  await using tmp = await tmpdir({ git: true })
  const sourcePath = path.join(tmp.path, "oversized-prompt-read.txt")
  await fs.writeFile(sourcePath, ["CURRENT_USER_OBJECTIVE stays in the prompt", "X".repeat(45_000)].join("\n"))

  const session = await provideTestInstance({
    directory: tmp.path,
    fn: () => createSession({ title: "m16 admission" }),
  })
  const admitted = await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      runRuntime(
        LcmRuntime.Service.use((runtime) =>
          runtime.admitPathBackedFile({
            sessionID: session.id,
            originalPath: sourcePath,
            mimeType: "text/plain",
          }),
        ),
      ),
  })

  expect(admitted.fileID).toMatch(/^file_[a-f0-9]{32}$/)
  expect(admitted.contextItemID).toMatch(/^ctx_/)
  expect(admitted.byteCount).toBeGreaterThan(40_000)
  expect(admitted.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(admitted.markerText).toContain(`[File ID: ${admitted.fileID}]`)
  expect(admitted.markerText).toContain("[Source Kind: path]")
  expect(admitted.markerText).toContain("CURRENT_USER_OBJECTIVE")
})

test("sync stores finalized large source payloads as stable lcm_file artifacts", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const fixture = await provideTestInstance({
    directory: tmp.path,
    fn: () => seedLargePayloadFixture(tmp.path),
  })

  const result = await runLcm(syncFinalizedMessages({ sessionID: fixture.session.id, dataDir }))
  expect(result).toMatchObject({ insertedMessages: 2, insertedParts: 6, idempotent: false })
  const idempotent = await runLcm(syncFinalizedMessages({ sessionID: fixture.session.id, dataDir }))
  expect(idempotent).toMatchObject({ insertedMessages: 0, insertedParts: 0, idempotent: true })

  const worker = await initialize(dataDir)
  try {
    const parts = await query<{
      part_kind: string
      terminal_state: string | null
      content_storage_kind: string
      content_file_id: string
      text_content: string | null
      reasoning_content: string | null
      tool_output_text: string | null
      tool_error_text: string | null
      file_url: string | null
      media_mime: string | null
      search_text: string
    }>(
      worker,
      `
        SELECT part_kind, terminal_state, content_storage_kind, content_file_id, text_content, reasoning_content,
               tool_output_text, tool_error_text, file_url, media_mime, search_text
        FROM lcm_message_parts
        ORDER BY created_at_ms, part_order
      `,
    )
    expect(parts).toHaveLength(6)
    expect(parts.every((part) => part.content_storage_kind === "lcm_file")).toBe(true)
    expect(parts.map((part) => part.content_file_id)).toEqual([...new Set(parts.map((part) => part.content_file_id))])
    expect(parts[0]?.text_content).toBeNull()
    expect(parts[1]).toMatchObject({ part_kind: "file", file_url: null, media_mime: "image/png" })
    expect(parts[2]?.text_content).toBeNull()
    expect(parts[3]?.reasoning_content).toBeNull()
    expect(parts[4]).toMatchObject({ terminal_state: "completed", tool_output_text: null })
    expect(parts[5]).toMatchObject({ terminal_state: "error", tool_output_text: null, tool_error_text: null })
    expect(parts[4]?.search_text).toContain('{"alpha":{"beta":"needle"},"zed":false}')
    expect(parts[4]?.search_text).not.toContain("TOOL_OUTPUT_END")

    const files = await query<{
      file_id: string
      source_kind: string
      artifact_path: string
      artifact_byte_count: number | string
      artifact_content_sha256: string
      token_estimate_mode: string | null
      token_estimate_version: string | null
      preview_text: string
      exploration_status: string
    }>(
      worker,
      `
        SELECT file_id, source_kind, artifact_path, artifact_byte_count, artifact_content_sha256,
               token_estimate_mode, token_estimate_version, preview_text, exploration_status
        FROM lcm_large_files
        ORDER BY created_at_ms, file_id
      `,
    )
    expect(files).toHaveLength(6)
    expect(files.map((file) => file.source_kind).sort()).toEqual([
      "image",
      "inline",
      "inline",
      "inline",
      "tool_output",
      "tool_output",
    ])
    for (const file of files) {
      expect(file.file_id).toMatch(/^file_[a-f0-9]{32}$/)
      expect(validateArtifactPath(file.artifact_path).ok).toBe(true)
      expect(file.artifact_content_sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(file.token_estimate_mode).toBe("deterministic_fallback")
      expect(file.token_estimate_version).toBeTruthy()
      expect(file.exploration_status).toBe("not_started")
      const artifact = await fs.readFile(path.join(resolveLcmDbLayout(dataDir).artifactsDir, file.artifact_path))
      expect(artifact.byteLength).toBe(Number(file.artifact_byte_count))
    }
  } finally {
    await worker.close()
  }
})

test("large lcm_file source parts render in place and fail closed on corrupt artifacts", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const fixture = await provideTestInstance({
    directory: tmp.path,
    fn: () => seedLargePayloadFixture(tmp.path),
  })
  const sync = await runLcm(syncFinalizedMessages({ sessionID: fixture.session.id, dataDir }))
  const conversationID = sync.conversationID as ConversationID
  const worker = await initialize(dataDir)
  try {
    const assemblyInput = {
      sessionID: fixture.session.id as SessionID,
      conversationID,
      targetCurrentUser: {
        sourceSessionID: fixture.session.id as SessionID,
        sourceMessageID: "msg_large_file_current",
        promptOperationID: "op_large_file_current",
        visibilityBaseMessageID: "msg_large_file_current",
      },
      renderOptions: {
        providerID,
        modelID,
        providerMediaCapability: "supports_media",
        stripMedia: false,
        taskCapabilityClass: "root",
      },
      renderPreparation: renderPreparation({
        session: fixture.session,
        directory: tmp.path,
        messages: fixture.messages,
      }),
    } satisfies LcmAssemblyInput & { renderPreparation: LcmRawLeafRenderPreparationInput }

    const assembled = await runContext(
      worker,
      LcmContextService.use((svc) => svc.assembleModelMessages(assemblyInput)),
    )
    if (!assembled.ok) throw new Error(assembled.safeError.safeMessage)
    const serialized = JSON.stringify(assembled.modelMessages)
    expect(serialized).toContain("[File ID: file_")
    expect(serialized).toContain("[Source Kind: tool_output]")
    expect(serialized).toContain("[Exploration: not_started]")
    expect(serialized).not.toContain("[Old tool result content cleared]")
    expect(serialized).not.toContain("USER_PAYLOAD_END")
    expect(serialized).not.toContain("TOOL_OUTPUT_END")
    expect(serialized).not.toContain("TOOL_ERROR_END")

    const artifact = (
      await query<{ artifact_path: string }>(
        worker,
        `
          SELECT artifact_path
          FROM lcm_large_files
          WHERE conversation_id = $1
          ORDER BY created_at_ms
          LIMIT 1
        `,
        [conversationID],
      )
    )[0]
    expect(artifact).toBeTruthy()
    await fs.writeFile(path.join(resolveLcmDbLayout(dataDir).artifactsDir, artifact!.artifact_path), "corrupt")
    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) => svc.getCurrentContext({ conversationID })),
      ),
    ).rejects.toMatchObject({
      code: "recovery_required",
    })
  } finally {
    await worker.close()
  }
})
