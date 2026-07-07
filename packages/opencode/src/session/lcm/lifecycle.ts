// kilocode_change - new file
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { MessageTable, SessionTable } from "@/session/session.sql"
import { createDbUnavailableError, safeErrorForDbStatus } from "./db-errors"
import { LcmDb } from "./db"
import { resolveLcmDbLayout } from "./db-layout"
import { resolveDirectTestFamilyTargetEffect, resolveSessionFamilyTargetEffect, type LcmFamilyTarget } from "./family"
import { allocateStableLcmID, createOperationID } from "./id"
import { getLcmProductionSchemaVersion } from "./migrations"
import {
  isCompleteBoundaryMetadataV1,
  validateArtifactPath,
  validateBoundaryMetadataV1,
  type LcmBoundaryMetadataV1,
} from "./validators"
import { parseLcmSafeError } from "./safe-error-schema"
import {
  createLcmSafeError,
  type ConversationID,
  type LcmCapabilities,
  type LcmConversationCapabilityClass,
  type LcmDbStatus,
  type LcmLifecycleState,
  type LcmSafeError,
  type LcmStrategy,
  type LcmUsageMode,
  type LcmUsagePurpose,
  type LcmUsageRecord,
  type OperationID,
} from "./types"

type KiloSessionRow = typeof SessionTable.$inferSelect
type KiloProjectRow = typeof ProjectTable.$inferSelect

interface ConversationRow {
  conversation_id: ConversationID
  source_session_id: string
  parent_session_id: string | null
  parent_conversation_id: ConversationID | null
  root_conversation_id: ConversationID
  project_id: string
  workspace_id: string | null
  session_directory: string
  worktree_path: string | null
  boundary_metadata_json: unknown
  capability_class: LcmConversationCapabilityClass
  orchestration_metadata_json: unknown
  lifecycle_state: LcmLifecycleState
  schema_version: number
  feature_version: number
  created_at_ms: number
  updated_at_ms: number
  last_error_code: string | null
  last_safe_message: string | null
}

interface CountRow {
  count: number | string | bigint
}

export interface LcmSourceCoverageCounts {
  readonly messages: number
  readonly parts: number
  readonly summaries: number
  readonly contextItems: number
  readonly largeFiles: number
  readonly usageRecords: number
  readonly mapRuns: number
  readonly mapItems: number
}

export interface LcmConversationScope {
  readonly sessionID: string
  readonly conversationID: ConversationID
  readonly lifecycleState: LcmLifecycleState
  readonly capabilityClass: LcmConversationCapabilityClass
  readonly capabilityProven: boolean
  readonly directContentToolsAllowed: boolean
  readonly mapChildMode?: "read_only" | "write_capable"
  readonly projectID: string
  readonly workspaceID?: string
  readonly parentConversationID?: ConversationID
  readonly rootConversationID: ConversationID
  readonly ancestorConversationIDs: ConversationID[]
  readonly allowedConversationIDs: ConversationID[]
  readonly boundaryMetadata: LcmBoundaryMetadataV1
  readonly sourceCoverageCounts: LcmSourceCoverageCounts
}

export type LcmChildOrchestrationSource = "kilo_task" | "lcm_explore" | "lcm_map"

export interface LcmChildConversationInput {
  readonly sessionID: string
  readonly parentSessionID: string
  readonly capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
  readonly source: LcmChildOrchestrationSource
  readonly sourceMessageID?: string
  readonly sourceToolCallID?: string
  readonly operationID?: OperationID
  readonly mapID?: string
  readonly mapItemID?: string
  readonly readCapable?: boolean
  readonly dataDir?: string
}

export interface LcmChildConversationResult extends LcmConversationScope {
  readonly directContentToolsAllowed: boolean
}

export const LCM_USAGE_PURPOSES = [
  "leaf_summary",
  "condensation",
  "hard_limit_maintenance",
  "retrieval_expand_query",
  "file_exploration",
  "llm_map",
] as const satisfies readonly LcmUsagePurpose[]

export const LCM_USAGE_MODES = [
  "background",
  "blocking",
  "explicit_retrieval",
  "explicit_exploration",
  "map_item",
] as const satisfies readonly LcmUsageMode[]

const LCM_USAGE_COST_STATUSES = ["provider_reported", "unknown", "not_applicable"] as const

const LCM_USAGE_ALLOWED_KEYS = new Set([
  "usageRecordID",
  "sessionID",
  "conversationID",
  "jobID",
  "purpose",
  "mode",
  "providerID",
  "modelID",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costAmount",
  "costCurrency",
  "costStatus",
  "createdAt",
  "dataDir",
])

const LCM_USAGE_FORBIDDEN_CONTENT_KEYS = new Set([
  "prompt",
  "promptText",
  "summary",
  "summaryText",
  "message",
  "messageText",
  "toolOutput",
  "toolOutputText",
  "toolError",
  "toolErrorText",
  "fileContent",
  "inlinePayload",
  "inlinePayloadBytes",
  "mapItem",
  "mapItemInput",
  "mapItemOutput",
  "helperOutput",
  "stdout",
  "stderr",
  "query",
  "answer",
  "content",
])

export interface LcmUsageWriteInput {
  readonly usageRecordID?: string
  readonly sessionID: string
  readonly conversationID: ConversationID
  readonly jobID?: OperationID
  readonly purpose: LcmUsagePurpose
  readonly mode: LcmUsageMode
  readonly providerID?: string
  readonly modelID?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly costAmount?: number
  readonly costCurrency?: string
  readonly costStatus: LcmUsageRecord["costStatus"]
  readonly createdAt?: string | number | Date
  readonly dataDir?: string
}

interface RuntimeDbReady {
  readonly status: LcmDbStatus & { status: "ready" }
  readonly dataDir: string
  readonly target: LcmFamilyTarget
}

function nowMs() {
  return Date.now()
}

function toIso(ms: number) {
  return new Date(ms).toISOString()
}

function countValue(row?: CountRow) {
  return Number(row?.count ?? 0)
}

function queryOne<T>(rows: T[]) {
  return rows[0]
}

function sessionMessageCount(sessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID as KiloSessionRow["id"]))
      .all(),
  ).length
}

function initialLifecycleState(sessionID: string): LcmLifecycleState {
  return sessionMessageCount(sessionID) <= 1 ? "lcm_active" : "passive_synced"
}

async function continueLegacyReadOnlyConversation(input: {
  readonly db: PGlite
  readonly row: ConversationRow
  readonly sessionID: string
}) {
  if (input.row.lifecycle_state !== "legacy_read_only") return input.row
  const lifecycleState = initialLifecycleState(input.sessionID)
  const updatedAtMs = nowMs()
  await input.db.query(
    `
      UPDATE lcm_conversations
      SET lifecycle_state = $2,
          updated_at_ms = $3
      WHERE conversation_id = $1
    `,
    [input.row.conversation_id, lifecycleState, updatedAtMs],
  )
  input.row.lifecycle_state = lifecycleState
  input.row.updated_at_ms = updatedAtMs
  return input.row
}

function placeholders(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`).join(", ")
}

function jsonValue(value: unknown) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  const parsed = jsonValue(value)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function requireCapabilityMetadata(row: ConversationRow) {
  const metadata = recordValue(row.orchestration_metadata_json)
  if (!metadata) throw createInvalidRequest("lcm_capability_metadata_invalid")
  if (metadata.version !== 1) throw createInvalidRequest("lcm_capability_metadata_version")
  if (metadata.capabilityClass !== row.capability_class) {
    throw createInvalidRequest("lcm_capability_metadata_class_mismatch")
  }

  if (row.capability_class === "root") {
    if (row.parent_conversation_id || row.parent_session_id) throw createInvalidRequest("lcm_root_has_parent")
    if (row.root_conversation_id !== row.conversation_id) throw createInvalidRequest("lcm_root_mismatch")
    if (metadata.source !== "kilo_session") throw createInvalidRequest("lcm_root_metadata_source")
    return metadata
  }

  if (!row.parent_conversation_id || !row.parent_session_id) {
    throw createInvalidRequest("lcm_child_missing_parent")
  }

  const source = metadata.source
  const expectedSource =
    row.capability_class === "task_child"
      ? source === "kilo_task" || source === "kilo_session_parent"
      : row.capability_class === "explore_child"
        ? source === "lcm_explore"
        : source === "lcm_map"
  if (!expectedSource) throw createInvalidRequest("lcm_child_metadata_source")
  if (metadata.parentSessionID !== row.parent_session_id) {
    throw createInvalidRequest("lcm_child_metadata_parent_session")
  }
  if (metadata.parentConversationID !== row.parent_conversation_id) {
    throw createInvalidRequest("lcm_child_metadata_parent_conversation")
  }
  return metadata
}

function mapItemIndexFromMetadata(value: unknown) {
  if (typeof value !== "string") return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const match = /^item_(\d+)$/.exec(value)
  return match ? Number(match[1]) : undefined
}

async function proveMapChildCapability(input: { readonly db: PGlite; readonly row: ConversationRow }) {
  if (input.row.capability_class !== "map_child") {
    return { capabilityProven: true, directContentToolsAllowed: directContentToolsAllowed(input.row) }
  }
  let metadata: Record<string, unknown>
  try {
    metadata = requireCapabilityMetadata(input.row) as Record<string, unknown>
  } catch {
    return { capabilityProven: false, directContentToolsAllowed: false }
  }
  const mapID = optionalString(metadata.mapID)
  const itemIndex = mapItemIndexFromMetadata(metadata.mapItemID)
  if (!mapID || itemIndex === undefined || !input.row.parent_conversation_id) {
    return { capabilityProven: false, directContentToolsAllowed: false }
  }
  const proof = (
    await input.db.query<{ agentic_mode: "read_only" | "write_capable" | null }>(
      `
        SELECT run.agentic_mode
        FROM lcm_map_runs run
        JOIN lcm_map_items item ON item.map_id = run.map_id
        WHERE run.map_id = $1
          AND run.tool_kind = 'agentic_map'
          AND run.conversation_id = $2
          AND item.item_index = $3
        LIMIT 1
      `,
      [mapID, input.row.parent_conversation_id, itemIndex],
    )
  ).rows[0]
  if (!proof?.agentic_mode) return { capabilityProven: false, directContentToolsAllowed: false }
  return {
    capabilityProven: true,
    directContentToolsAllowed: true,
    mapChildMode: proof.agentic_mode,
  }
}

function validateParentBoundaryRows(input: { readonly child: ConversationRow; readonly parent: ConversationRow }) {
  if (input.child.parent_conversation_id !== input.parent.conversation_id) {
    throw createInvalidRequest("lcm_parent_conversation_link_mismatch")
  }
  if (input.child.parent_session_id !== input.parent.source_session_id) {
    throw createInvalidRequest("lcm_parent_session_link_mismatch")
  }

  const parentBoundary = requireBoundaryMetadata(input.parent)
  const childBoundary = requireBoundaryMetadata(input.child)
  const sameProject = parentBoundary.projectID === childBoundary.projectID
  const sameWorkspace = (parentBoundary.workspaceID ?? null) === (childBoundary.workspaceID ?? null)
  const sessionInsideParent = parentBoundary.allowedRootCanonicals.some((root) =>
    pathInsideRoot(childBoundary.sessionDirectoryCanonical, root, parentBoundary),
  )
  const sameWorktree = sameBoundaryPath(
    parentBoundary.worktreeCanonical,
    childBoundary.worktreeCanonical,
    parentBoundary,
  )

  if (!sameProject || !sameWorkspace || !sessionInsideParent || !sameWorktree) {
    throw createInvalidRequest("lcm_parent_boundary_mismatch")
  }
  if (input.child.root_conversation_id !== input.parent.root_conversation_id) {
    throw createInvalidRequest("lcm_root_conversation_mismatch")
  }
}

function defaultOrchestrationMetadata(input: {
  readonly session: KiloSessionRow
  readonly parent?: ConversationRow
  readonly capabilityClass: LcmConversationCapabilityClass
}) {
  if (!input.parent) {
    return {
      version: 1,
      source: "kilo_session",
      capabilityClass: "root",
    }
  }
  return {
    version: 1,
    source: "kilo_session_parent",
    parentSessionID: input.session.parent_id,
    parentConversationID: input.parent.conversation_id,
    rootConversationID: input.parent.root_conversation_id,
    capabilityClass: input.capabilityClass,
  }
}

function childOrchestrationMetadata(input: {
  readonly child: LcmChildConversationInput
  readonly parent: ConversationRow
}) {
  const metadata: Record<string, unknown> = {
    version: 1,
    source: input.child.source,
    parentSessionID: input.child.parentSessionID,
    parentConversationID: input.parent.conversation_id,
    rootConversationID: input.parent.root_conversation_id,
    capabilityClass: input.child.capabilityClass,
  }
  const sourceMessageID = optionalString(input.child.sourceMessageID)
  const sourceToolCallID = optionalString(input.child.sourceToolCallID)
  const operationID = optionalString(input.child.operationID)
  const mapID = optionalString(input.child.mapID)
  const mapItemID = optionalString(input.child.mapItemID)
  if (sourceMessageID) metadata.sourceMessageID = sourceMessageID
  if (sourceToolCallID) metadata.sourceToolCallID = sourceToolCallID
  if (operationID) metadata.operationID = operationID
  if (mapID) metadata.mapID = mapID
  if (mapItemID) metadata.mapItemID = mapItemID
  if (input.child.readCapable !== undefined) metadata.readCapable = input.child.readCapable
  return metadata
}

function directContentToolsAllowed(row: ConversationRow) {
  if (row.capability_class === "root") return false
  if (row.capability_class === "explore_child") return true
  if (row.capability_class === "task_child") {
    const metadata = requireCapabilityMetadata(row)
    return metadata.readCapable === true
  }
  if (row.capability_class === "map_child") return false
  return false
}

function createInvalidRequest(diagnosticCode: string, input?: { operationID?: OperationID; action?: "retry" }) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.action ? { action: input.action } : {}),
    },
    retryable: false,
    diagnosticCode,
  })
}

function createNotFound(
  diagnosticCode: string,
  input?: { operationID?: OperationID; conversationID?: ConversationID },
) {
  return createLcmSafeError({
    code: "not_found",
    templateKey: "lcm.auth.denied",
    safeParams: {
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.conversationID ? { conversationID: input.conversationID } : {}),
    },
    retryable: false,
    diagnosticCode,
  })
}

function createRecoveryRequired(diagnosticCode: string, input?: { conversationID?: ConversationID }) {
  return createLcmSafeError({
    code: "recovery_required",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      ...(input?.conversationID ? { conversationID: input.conversationID } : {}),
      action: "contact_support",
    },
    retryable: false,
    diagnosticCode,
  })
}

function operationRequest<T>(input: {
  readonly purpose: "sync" | "cleanup" | "debug_support"
  readonly abortSignal?: AbortSignal
  readonly run: (db: PGlite) => Promise<T>
}) {
  return {
    operationID: createOperationID(),
    purpose: input.purpose,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    run: (db: unknown) => input.run(db as PGlite),
  }
}

export function resolveRuntimeLcmDataDir(input?: { dataDir?: string }) {
  const dataDir = input?.dataDir ?? process.env.KILO_LCM_DATA_DIR
  return dataDir ? path.resolve(dataDir) : ""
}

const resolveLifecycleFamilyTarget = Effect.fn("LcmLifecycle.resolveFamilyTarget")(function* (input?: {
  readonly sessionID?: string
  readonly parentSessionID?: string
  readonly dataDir?: string
}) {
  if (input?.dataDir) {
    return yield* resolveDirectTestFamilyTargetEffect({ familyRoot: input.dataDir })
  }
  if (!input?.sessionID) {
    return yield* Effect.fail(createInvalidRequest("lcm_family_session_required"))
  }
  const resolved = yield* resolveSessionFamilyTargetEffect({
    sessionID: input.sessionID,
    assertedParentSessionID: input.parentSessionID,
  })
  return resolved.target
})

export const ensureLcmDbReady = Effect.fn("LcmLifecycle.ensureLcmDbReady")(function* (input?: {
  readonly sessionID?: string
  readonly parentSessionID?: string
  readonly dataDir?: string
}) {
  const lcmDb = yield* LcmDb.Service
  const target = yield* resolveLifecycleFamilyTarget(input)
  const status = yield* LcmDb.initializeFamily(lcmDb, target)
  if (status.status === "ready")
    return { status: status as RuntimeDbReady["status"], dataDir: target.familyRoot, target } satisfies RuntimeDbReady
  return yield* Effect.fail(status.safeError ?? safeErrorForDbStatus(status))
})

function loadKiloSession(sessionID: string) {
  return Effect.sync(() =>
    Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID as KiloSessionRow["id"]))
        .get(),
    ),
  ).pipe(
    Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(createNotFound("lcm_kilo_session_not_found")))),
  )
}

function loadKiloProject(projectID: string) {
  return Effect.sync(() =>
    Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectID as KiloProjectRow["id"]))
        .get(),
    ),
  )
}

async function canonicalizePath(value: string) {
  const resolved = path.resolve(value)
  return fs.realpath(resolved).catch(() => resolved)
}

function platformPathFlavor(): LcmBoundaryMetadataV1["platformPathFlavor"] {
  return process.platform === "win32" ? "win32" : "posix"
}

function caseSensitivity(): LcmBoundaryMetadataV1["caseSensitivity"] {
  return process.platform === "win32" ? "insensitive" : "sensitive"
}

function normalizeBoundaryPath(value: string, metadata: Pick<LcmBoundaryMetadataV1, "caseSensitivity">) {
  let normalized = value.replace(/[\\/]+/g, "/")
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, "")
  return metadata.caseSensitivity === "insensitive" ? normalized.toLowerCase() : normalized
}

function sameBoundaryPath(
  left: string | undefined,
  right: string | undefined,
  metadata: Pick<LcmBoundaryMetadataV1, "caseSensitivity">,
) {
  if (!left || !right) return left === right
  return normalizeBoundaryPath(left, metadata) === normalizeBoundaryPath(right, metadata)
}

function pathInsideRoot(child: string, root: string, metadata: Pick<LcmBoundaryMetadataV1, "caseSensitivity">) {
  const normalizedChild = normalizeBoundaryPath(child, metadata)
  const normalizedRoot = normalizeBoundaryPath(root, metadata)
  if (normalizedChild === normalizedRoot) return true
  if (normalizedRoot === "/") return normalizedChild.startsWith("/")
  return normalizedChild.startsWith(`${normalizedRoot}/`)
}

async function buildBoundaryMetadata(input: {
  readonly session: KiloSessionRow
  readonly project?: KiloProjectRow
}): Promise<LcmBoundaryMetadataV1> {
  const sessionDirectoryCanonical = await canonicalizePath(input.session.directory)
  const worktreeOriginal = input.project?.worktree
  const worktreeCanonical = worktreeOriginal ? await canonicalizePath(worktreeOriginal) : undefined
  const allowedRootOriginals = [input.session.directory]
  const allowedRootCanonicals = [sessionDirectoryCanonical]

  if (worktreeOriginal && !allowedRootOriginals.includes(worktreeOriginal)) allowedRootOriginals.push(worktreeOriginal)
  if (worktreeCanonical && !allowedRootCanonicals.includes(worktreeCanonical))
    allowedRootCanonicals.push(worktreeCanonical)

  const metadata: LcmBoundaryMetadataV1 = {
    version: 1,
    projectID: input.session.project_id,
    ...(input.session.workspace_id ? { workspaceID: input.session.workspace_id } : {}),
    platformPathFlavor: platformPathFlavor(),
    caseSensitivity: caseSensitivity(),
    sessionDirectoryOriginal: input.session.directory,
    sessionDirectoryCanonical,
    ...(worktreeOriginal ? { worktreeOriginal } : {}),
    ...(worktreeCanonical ? { worktreeCanonical } : {}),
    allowedRootOriginals,
    allowedRootCanonicals,
    kiloPermissionContext: {
      source:
        worktreeCanonical &&
        pathInsideRoot(sessionDirectoryCanonical, worktreeCanonical, { caseSensitivity: caseSensitivity() })
          ? "worktree"
          : "session",
    },
  }

  const validation = validateBoundaryMetadataV1(metadata)
  if (!validation.ok) throw createInvalidRequest(`lcm_boundary_metadata_build_${validation.reason ?? "invalid"}`)
  return metadata
}

function requireBoundaryMetadata(row: ConversationRow): LcmBoundaryMetadataV1 {
  const value = jsonValue(row.boundary_metadata_json)
  const validation = validateBoundaryMetadataV1(value)
  if (!validation.ok) {
    throw createInvalidRequest(`lcm_boundary_metadata_invalid_${validation.reason ?? "unknown"}`, {
      action: "retry",
    })
  }
  return value as LcmBoundaryMetadataV1
}

function validateParentBoundary(input: {
  readonly child: {
    readonly session: KiloSessionRow
    readonly boundary: LcmBoundaryMetadataV1
    readonly expectedParentSessionID: string
  }
  readonly parent: ConversationRow
}) {
  const parentBoundary = requireBoundaryMetadata(input.parent)
  const childBoundary = input.child.boundary
  const sameProject = parentBoundary.projectID === childBoundary.projectID
  const sameWorkspace = (parentBoundary.workspaceID ?? null) === (childBoundary.workspaceID ?? null)
  const sessionInsideParent = parentBoundary.allowedRootCanonicals.some((root) =>
    pathInsideRoot(childBoundary.sessionDirectoryCanonical, root, parentBoundary),
  )
  const sameWorktree = sameBoundaryPath(
    parentBoundary.worktreeCanonical,
    childBoundary.worktreeCanonical,
    parentBoundary,
  )

  if (!sameProject || !sameWorkspace || !sessionInsideParent || !sameWorktree) {
    throw createInvalidRequest("lcm_parent_boundary_mismatch")
  }

  if (input.parent.source_session_id !== input.child.expectedParentSessionID) {
    throw createInvalidRequest("lcm_parent_session_link_mismatch")
  }
}

async function findConversationBySession(db: PGlite, sessionID: string) {
  return queryOne(
    (
      await db.query<ConversationRow>(
        `
          SELECT *
          FROM lcm_conversations
          WHERE source_session_id = $1
        `,
        [sessionID],
      )
    ).rows,
  )
}

async function findConversationByID(db: PGlite, conversationID: ConversationID) {
  return queryOne(
    (
      await db.query<ConversationRow>(
        `
          SELECT *
          FROM lcm_conversations
          WHERE conversation_id = $1
        `,
        [conversationID],
      )
    ).rows,
  )
}

function conversationCapabilities(input: {
  readonly sessionID: string
  readonly strategy: LcmStrategy
  readonly status: LcmDbStatus
  readonly row?: ConversationRow
  readonly mapChildCapabilityProven?: boolean
  readonly safeError?: LcmSafeError
}): LcmCapabilities {
  const lifecycleState = input.safeError
    ? input.safeError.code === "recovery_required"
      ? "recovery_required"
      : "db_unavailable"
    : (input.row?.lifecycle_state ?? "passive_synced")
  const lcmActive = !input.safeError && input.row?.lifecycle_state === "lcm_active"
  const canRetrieve =
    lcmActive &&
    input.row !== undefined &&
    (input.row.capability_class === "root" ||
      input.row.capability_class === "task_child" ||
      input.row.capability_class === "explore_child" ||
      (input.row.capability_class === "map_child" && input.mapChildCapabilityProven === true))
  return {
    sessionID: input.sessionID,
    ...(input.row ? { conversationID: input.row.conversation_id } : {}),
    lifecycleState,
    strategy: input.strategy,
    dbReady: input.status.status === "ready",
    lcmActive,
    canAssemble: lcmActive,
    canMaintain: lcmActive,
    canRetrieve,
    dbStatus: input.status,
    ...(input.safeError ? { safeError: input.safeError } : {}),
  }
}

export const getCapabilities: (input: {
  readonly sessionID: string
  readonly strategy: LcmStrategy
  readonly dataDir?: string
}) => Effect.Effect<LcmCapabilities, never, LcmDb.Service> = Effect.fn("LcmLifecycle.getCapabilities")(
  function* (input) {
    const lcmDb = yield* LcmDb.Service
    if (!lcmDb.initializeFamily) {
      const status = yield* lcmDb.initialize({
        dataDir: input.dataDir ?? "",
        runtimeMode: "source",
        schemaVersion: getLcmProductionSchemaVersion(),
      })
      if (status.status !== "ready") {
        return conversationCapabilities({
          sessionID: input.sessionID,
          strategy: input.strategy,
          status,
          safeError: status.safeError ?? safeErrorForDbStatus(status),
        })
      }
    }
    const targetResult = yield* resolveLifecycleFamilyTarget(input).pipe(
      Effect.match({
        onFailure: (safeError) => ({ ok: false as const, safeError }),
        onSuccess: (target) => ({ ok: true as const, target }),
      }),
    )
    if (!targetResult.ok) {
      return conversationCapabilities({
        sessionID: input.sessionID,
        strategy: input.strategy,
        status: {
          status: "unavailable",
          dataDir: "",
          schemaVersion: getLcmProductionSchemaVersion(),
          safeError: targetResult.safeError,
        },
        safeError: targetResult.safeError,
      })
    }
    const status = yield* LcmDb.initializeFamily(lcmDb, targetResult.target)
    const familyDb = LcmDb.scoped(lcmDb, targetResult.target)

    if (status.status !== "ready") {
      return conversationCapabilities({
        sessionID: input.sessionID,
        strategy: input.strategy,
        status,
        safeError: status.safeError ?? safeErrorForDbStatus(status),
      })
    }

    return yield* familyDb
      .executeForeground(
        operationRequest({
          purpose: "debug_support",
          run: async (db) => {
            const row = await findConversationBySession(db, input.sessionID)
            if (!row) {
              return conversationCapabilities({
                sessionID: input.sessionID,
                strategy: input.strategy,
                status: status as RuntimeDbReady["status"],
              })
            }
            try {
              requireBoundaryMetadata(row)
              requireCapabilityMetadata(row)
              await continueLegacyReadOnlyConversation({ db, row, sessionID: input.sessionID })
              const mapCapability =
                row.capability_class === "map_child" ? await proveMapChildCapability({ db, row }) : undefined
              return conversationCapabilities({
                sessionID: input.sessionID,
                strategy: input.strategy,
                status: status as RuntimeDbReady["status"],
                row,
                mapChildCapabilityProven: mapCapability?.capabilityProven,
              })
            } catch (error) {
              const safeError =
                parseLcmSafeError(error) ??
                createRecoveryRequired("lcm_capability_boundary_recovery_required", {
                  conversationID: row.conversation_id,
                })
              return conversationCapabilities({
                sessionID: input.sessionID,
                strategy: input.strategy,
                status: status as RuntimeDbReady["status"],
                row,
                safeError,
              })
            }
          },
        }),
      )
      .pipe(
        Effect.catch((safeError) =>
          Effect.succeed(
            conversationCapabilities({
              sessionID: input.sessionID,
              strategy: input.strategy,
              status,
              safeError,
            }),
          ),
        ),
      )
  },
)

async function insertConversation(input: {
  readonly db: PGlite
  readonly session: KiloSessionRow
  readonly boundary: LcmBoundaryMetadataV1
  readonly parent?: ConversationRow
  readonly capabilityClass?: LcmConversationCapabilityClass
  readonly orchestrationMetadata?: Record<string, unknown>
}) {
  const existing = await findConversationBySession(input.db, input.session.id)
  if (existing) {
    requireBoundaryMetadata(existing)
    const existingMetadata = requireCapabilityMetadata(existing) as Record<string, unknown>
    if (input.parent && existing.parent_conversation_id !== input.parent.conversation_id) {
      throw createInvalidRequest("lcm_existing_parent_mismatch")
    }
    if (input.capabilityClass && existing.capability_class !== input.capabilityClass) {
      throw createInvalidRequest("lcm_existing_capability_mismatch")
    }
    if (input.orchestrationMetadata?.source === "lcm_map") {
      if (
        existingMetadata.source !== "lcm_map" ||
        existingMetadata.mapID !== input.orchestrationMetadata.mapID ||
        existingMetadata.mapItemID !== input.orchestrationMetadata.mapItemID
      ) {
        throw createInvalidRequest("lcm_existing_map_child_metadata_mismatch")
      }
    }
    const continued = await continueLegacyReadOnlyConversation({
      db: input.db,
      row: existing,
      sessionID: input.session.id,
    })
    return continued.conversation_id
  }

  const parentConversationID = input.parent?.conversation_id
  const rootConversationID = input.parent?.root_conversation_id
  const capabilityClass: LcmConversationCapabilityClass =
    input.capabilityClass ?? (input.parent ? "task_child" : "root")
  if (!input.parent && capabilityClass !== "root") throw createInvalidRequest("lcm_child_missing_parent")
  if (input.parent && capabilityClass === "root") throw createInvalidRequest("lcm_root_with_parent")
  const conversationID = await allocateStableLcmID("conv", async (id) => {
    const rows = (
      await input.db.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM lcm_conversations
            WHERE conversation_id = $1
          ) AS exists
        `,
        [id],
      )
    ).rows
    return Boolean(rows[0]?.exists)
  })
  const now = nowMs()
  const lifecycleState = initialLifecycleState(input.session.id)
  const orchestrationMetadata =
    input.orchestrationMetadata ??
    defaultOrchestrationMetadata({
      session: input.session,
      parent: input.parent,
      capabilityClass,
    })

  await input.db.query(
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11,
        $12::jsonb,
        $13,
        $14,
        1,
        $15,
        $15
      )
    `,
    [
      conversationID,
      input.session.id,
      input.session.parent_id,
      parentConversationID ?? null,
      rootConversationID ?? conversationID,
      input.session.project_id,
      input.session.workspace_id ?? null,
      input.boundary.sessionDirectoryCanonical,
      input.boundary.worktreeCanonical ?? null,
      JSON.stringify(input.boundary),
      capabilityClass,
      JSON.stringify(orchestrationMetadata),
      lifecycleState,
      getLcmProductionSchemaVersion(),
      now,
    ],
  )

  return conversationID
}

function getOrCreateConversationInternal(input: {
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly dataDir?: string
  readonly capabilityClass?: LcmConversationCapabilityClass
  readonly orchestrationMetadata?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
}): Effect.Effect<ConversationID, LcmSafeError, LcmDb.Service> {
  return Effect.gen(function* () {
    const ready = yield* ensureLcmDbReady(input)
    const lcmDbRoot = yield* LcmDb.Service
    const lcmDb = LcmDb.scoped(lcmDbRoot, ready.target)
    const session = yield* loadKiloSession(input.sessionID)
    const project = yield* loadKiloProject(session.project_id)
    const trustedParentSessionID = input.parentSessionID ?? session.parent_id ?? undefined

    if (input.parentSessionID && session.parent_id && input.parentSessionID !== session.parent_id) {
      return yield* Effect.fail(createInvalidRequest("lcm_parent_input_mismatch"))
    }
    if (trustedParentSessionID === session.id) {
      return yield* Effect.fail(createInvalidRequest("lcm_parent_self_link"))
    }

    let parentConversation: ConversationRow | undefined
    if (trustedParentSessionID) {
      yield* getOrCreateConversation({
        sessionID: trustedParentSessionID,
        dataDir: input.dataDir,
        abortSignal: input.abortSignal,
      })
      parentConversation = yield* lcmDb.executeForeground(
        operationRequest({
          purpose: "debug_support",
          abortSignal: input.abortSignal,
          run: async (db) => {
            const row = await findConversationBySession(db, trustedParentSessionID)
            if (!row) throw createNotFound("lcm_parent_conversation_not_found")
            return row
          },
        }),
      )
    }

    const boundary = yield* Effect.tryPromise({
      try: () => buildBoundaryMetadata({ session, project: project ?? undefined }),
      catch: (error) => parseLcmSafeError(error) ?? createInvalidRequest("lcm_boundary_metadata_build_failed"),
    })

    if (parentConversation && trustedParentSessionID) {
      yield* Effect.try({
        try: () =>
          validateParentBoundary({
            child: { session, boundary, expectedParentSessionID: trustedParentSessionID },
            parent: parentConversation,
          }),
        catch: (error) => parseLcmSafeError(error) ?? createInvalidRequest("lcm_parent_boundary_validation_failed"),
      })
    }

    return yield* lcmDb.executeForeground(
      operationRequest({
        purpose: "sync",
        abortSignal: input.abortSignal,
        run: async (db) => {
          return insertConversation({
            db,
            session: {
              ...session,
              parent_id: (trustedParentSessionID ?? null) as KiloSessionRow["parent_id"],
            },
            boundary,
            parent: parentConversation,
            capabilityClass: input.capabilityClass,
            orchestrationMetadata: input.orchestrationMetadata,
          })
        },
      }),
    )
  })
}

export function getOrCreateConversation(input: {
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly dataDir?: string
  readonly abortSignal?: AbortSignal
}): Effect.Effect<ConversationID, LcmSafeError, LcmDb.Service> {
  return getOrCreateConversationInternal({
    sessionID: input.sessionID,
    parentSessionID: input.parentSessionID,
    dataDir: input.dataDir,
    abortSignal: input.abortSignal,
  })
}

export function getOrCreateChildConversation(
  input: LcmChildConversationInput,
): Effect.Effect<LcmChildConversationResult, LcmSafeError, LcmDb.Service> {
  return Effect.gen(function* () {
    if (input.source === "kilo_task" && input.capabilityClass !== "task_child") {
      return yield* Effect.fail(createInvalidRequest("lcm_child_task_class_mismatch"))
    }
    if (input.source === "lcm_explore" && input.capabilityClass !== "explore_child") {
      return yield* Effect.fail(createInvalidRequest("lcm_child_explore_class_mismatch"))
    }
    if (input.source === "lcm_map" && input.capabilityClass !== "map_child") {
      return yield* Effect.fail(createInvalidRequest("lcm_child_map_class_mismatch"))
    }

    const ready = yield* ensureLcmDbReady(input)
    const lcmDbRoot = yield* LcmDb.Service
    const lcmDb = LcmDb.scoped(lcmDbRoot, ready.target)
    const parentConversation = yield* lcmDb.executeForeground(
      operationRequest({
        purpose: "debug_support",
        run: async (db) => {
          const row = await findConversationBySession(db, input.parentSessionID)
          if (!row) throw createNotFound("lcm_parent_conversation_not_found")
          requireBoundaryMetadata(row)
          requireCapabilityMetadata(row)
          if (row.capability_class !== "root") throw createInvalidRequest("lcm_child_recursion_denied")
          return row
        },
      }),
    )

    yield* getOrCreateConversationInternal({
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      capabilityClass: input.capabilityClass,
      orchestrationMetadata: childOrchestrationMetadata({ child: input, parent: parentConversation }),
      dataDir: input.dataDir,
    })
    const scope = yield* getConversationScope({ sessionID: input.sessionID, dataDir: input.dataDir })
    return {
      ...scope,
      directContentToolsAllowed: scope.directContentToolsAllowed,
    }
  })
}

function assertUsageInput(input: unknown): asserts input is LcmUsageWriteInput & Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw createInvalidRequest("lcm_usage_input_not_object")
  }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (LCM_USAGE_FORBIDDEN_CONTENT_KEYS.has(key) || !LCM_USAGE_ALLOWED_KEYS.has(key)) {
      throw createInvalidRequest(`lcm_usage_forbidden_field_${key}`)
    }
  }
  if (typeof record.sessionID !== "string" || !record.sessionID) throw createInvalidRequest("lcm_usage_missing_session")
  if (typeof record.conversationID !== "string" || !record.conversationID.startsWith("conv_")) {
    throw createInvalidRequest("lcm_usage_missing_conversation")
  }
  if (!LCM_USAGE_PURPOSES.includes(record.purpose as LcmUsagePurpose)) {
    throw createInvalidRequest("lcm_usage_invalid_purpose")
  }
  if (!LCM_USAGE_MODES.includes(record.mode as LcmUsageMode)) {
    throw createInvalidRequest("lcm_usage_invalid_mode")
  }
  if (!LCM_USAGE_COST_STATUSES.includes(record.costStatus as LcmUsageRecord["costStatus"])) {
    throw createInvalidRequest("lcm_usage_invalid_cost_status")
  }
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    const value = record[key]
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
      throw createInvalidRequest(`lcm_usage_invalid_${key}`)
    }
  }
  if (record.costAmount !== undefined && (typeof record.costAmount !== "number" || record.costAmount < 0)) {
    throw createInvalidRequest("lcm_usage_invalid_cost")
  }
  if (record.costAmount !== undefined && record.costStatus !== "provider_reported") {
    throw createInvalidRequest("lcm_usage_cost_without_provider_report")
  }
}

function usageID() {
  return `usage_${randomBytes(16).toString("hex")}`
}

function createdAtMs(value: LcmUsageWriteInput["createdAt"]) {
  if (value === undefined) return nowMs()
  if (typeof value === "number") return value
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(ms)) throw createInvalidRequest("lcm_usage_invalid_created_at")
  return ms
}

export const recordUsage = Effect.fn("LcmLifecycle.recordUsage")(function* (input: unknown) {
  yield* Effect.try({
    try: () => assertUsageInput(input),
    catch: (error) => parseLcmSafeError(error) ?? createInvalidRequest("lcm_usage_validation_failed"),
  })
  const usage = input as LcmUsageWriteInput & Record<string, unknown>
  const ready = yield* ensureLcmDbReady({
    sessionID: usage.sessionID,
    dataDir: usage.dataDir as string | undefined,
  })
  const lcmDbRoot = yield* LcmDb.Service
  const lcmDb = LcmDb.scoped(lcmDbRoot, ready.target)
  const createdMs = yield* Effect.try({
    try: () => createdAtMs(usage.createdAt),
    catch: (error) => parseLcmSafeError(error) ?? createInvalidRequest("lcm_usage_invalid_created_at"),
  })
  return yield* lcmDb.executeForeground(
    operationRequest({
      purpose: "sync",
      run: async (db) => {
        const conversation = await findConversationByID(db, usage.conversationID)
        if (!conversation)
          throw createNotFound("lcm_usage_conversation_not_found", { conversationID: usage.conversationID })
        if (conversation.source_session_id !== usage.sessionID) throw createInvalidRequest("lcm_usage_session_mismatch")

        const id = usage.usageRecordID ?? usageID()
        await db.query(
          `
            INSERT INTO lcm_usage_records (
              usage_record_id,
              conversation_id,
              source_session_id,
              job_id,
              purpose,
              mode,
              provider_id,
              model_id,
              input_tokens,
              output_tokens,
              cache_read_tokens,
              cache_write_tokens,
              cost_amount,
              cost_currency,
              cost_status,
              created_at_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          `,
          [
            id,
            usage.conversationID,
            usage.sessionID,
            usage.jobID ?? null,
            usage.purpose,
            usage.mode,
            usage.providerID ?? null,
            usage.modelID ?? null,
            usage.inputTokens ?? null,
            usage.outputTokens ?? null,
            usage.cacheReadTokens ?? null,
            usage.cacheWriteTokens ?? null,
            usage.costAmount ?? null,
            usage.costCurrency ?? null,
            usage.costStatus,
            createdMs,
          ],
        )

        return {
          usageRecordID: id,
          sessionID: usage.sessionID,
          conversationID: usage.conversationID,
          ...(usage.jobID ? { jobID: usage.jobID } : {}),
          purpose: usage.purpose,
          mode: usage.mode,
          ...(usage.providerID ? { providerID: usage.providerID } : {}),
          ...(usage.modelID ? { modelID: usage.modelID } : {}),
          ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
          ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
          ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
          ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
          ...(usage.costAmount !== undefined ? { costAmount: usage.costAmount } : {}),
          ...(usage.costCurrency ? { costCurrency: usage.costCurrency } : {}),
          costStatus: usage.costStatus,
          createdAt: toIso(createdMs),
        } satisfies LcmUsageRecord
      },
    }),
  )
})

async function coverageCounts(db: PGlite, conversationID: ConversationID): Promise<LcmSourceCoverageCounts> {
  const [messages, parts, summaries, contextItems, largeFiles, usageRecords, mapRuns, mapItems] = await Promise.all([
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_messages WHERE conversation_id = $1", [conversationID]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_message_parts WHERE conversation_id = $1", [
      conversationID,
    ]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_summaries WHERE conversation_id = $1", [conversationID]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_context_items WHERE conversation_id = $1", [
      conversationID,
    ]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_large_files WHERE conversation_id = $1", [
      conversationID,
    ]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_usage_records WHERE conversation_id = $1", [
      conversationID,
    ]),
    db.query<CountRow>("SELECT COUNT(*)::int AS count FROM lcm_map_runs WHERE conversation_id = $1", [conversationID]),
    db.query<CountRow>(
      `
        SELECT COUNT(*)::int AS count
        FROM lcm_map_items item
        JOIN lcm_map_runs run ON run.map_id = item.map_id
        WHERE run.conversation_id = $1
      `,
      [conversationID],
    ),
  ])
  return {
    messages: countValue(messages.rows[0]),
    parts: countValue(parts.rows[0]),
    summaries: countValue(summaries.rows[0]),
    contextItems: countValue(contextItems.rows[0]),
    largeFiles: countValue(largeFiles.rows[0]),
    usageRecords: countValue(usageRecords.rows[0]),
    mapRuns: countValue(mapRuns.rows[0]),
    mapItems: countValue(mapItems.rows[0]),
  }
}

async function lineageRows(db: PGlite, row: ConversationRow) {
  const ancestors: ConversationID[] = []
  const rows: ConversationRow[] = [row]
  let parentID = row.parent_conversation_id
  const seen = new Set<ConversationID>([row.conversation_id])
  while (parentID) {
    if (seen.has(parentID)) throw createInvalidRequest("lcm_ancestor_cycle")
    seen.add(parentID)
    const parent = await findConversationByID(db, parentID)
    if (!parent) throw createInvalidRequest("lcm_ancestor_missing")
    requireBoundaryMetadata(parent)
    requireCapabilityMetadata(parent)
    validateParentBoundaryRows({ child: rows[rows.length - 1], parent })
    ancestors.push(parent.conversation_id)
    rows.push(parent)
    parentID = parent.parent_conversation_id
  }
  return { ancestors, rows }
}

export const getConversationScope = Effect.fn("LcmLifecycle.getConversationScope")(function* (input: {
  readonly sessionID: string
  readonly dataDir?: string
}) {
  const ready = yield* ensureLcmDbReady(input)
  const lcmDbRoot = yield* LcmDb.Service
  const lcmDb = LcmDb.scoped(lcmDbRoot, ready.target)
  return yield* lcmDb.executeForeground(
    operationRequest({
      purpose: "debug_support",
      run: async (db) => {
        const row = await findConversationBySession(db, input.sessionID)
        if (!row) throw createNotFound("lcm_scope_conversation_not_found")
        await continueLegacyReadOnlyConversation({ db, row, sessionID: input.sessionID })
        const boundary = requireBoundaryMetadata(row)
        requireCapabilityMetadata(row)
        if (!isCompleteBoundaryMetadataV1(boundary)) throw createInvalidRequest("lcm_scope_boundary_incomplete")
        const lineage = await lineageRows(db, row)
        const capability = await proveMapChildCapability({ db, row })
        return {
          sessionID: input.sessionID,
          conversationID: row.conversation_id,
          lifecycleState: row.lifecycle_state,
          capabilityClass: row.capability_class,
          capabilityProven: capability.capabilityProven,
          directContentToolsAllowed: capability.directContentToolsAllowed,
          ...(capability.mapChildMode ? { mapChildMode: capability.mapChildMode } : {}),
          projectID: row.project_id,
          ...(row.workspace_id ? { workspaceID: row.workspace_id } : {}),
          ...(row.parent_conversation_id ? { parentConversationID: row.parent_conversation_id } : {}),
          rootConversationID: row.root_conversation_id,
          ancestorConversationIDs: lineage.ancestors,
          allowedConversationIDs: [row.conversation_id, ...lineage.ancestors],
          boundaryMetadata: boundary,
          sourceCoverageCounts: await coverageCounts(db, row.conversation_id),
        } satisfies LcmConversationScope
      },
    }),
  )
})

async function conversationTree(db: PGlite, conversationID: ConversationID) {
  return (
    await db.query<{ conversation_id: ConversationID }>(
      `
        WITH RECURSIVE tree(conversation_id) AS (
          SELECT conversation_id
          FROM lcm_conversations
          WHERE conversation_id = $1
          UNION ALL
          SELECT child.conversation_id
          FROM lcm_conversations child
          JOIN tree parent ON child.parent_conversation_id = parent.conversation_id
        )
        SELECT conversation_id
        FROM tree
      `,
      [conversationID],
    )
  ).rows.map((row) => row.conversation_id)
}

async function collectArtifactPaths(db: PGlite, treeIDs: ConversationID[]) {
  if (treeIDs.length === 0) return []
  const treePlaceholders = placeholders(treeIDs.length)
  const rows = (
    await db.query<{ artifact_path: string }>(
      `
        SELECT DISTINCT artifact_path
        FROM lcm_large_files
        WHERE conversation_id IN (${treePlaceholders})
          AND artifact_storage_kind = 'file'
          AND source_kind <> 'path'
          AND artifact_path IS NOT NULL
      `,
      treeIDs,
    )
  ).rows
  const rawPaths = rows.map((row) => row.artifact_path).filter((artifactPath) => validateArtifactPath(artifactPath).ok)
  if (rawPaths.length === 0) return []

  const pathPlaceholders = placeholders(rawPaths.length)
  const outsidePlaceholders = placeholders(treeIDs.length, rawPaths.length)
  const outside = (
    await db.query<{ artifact_path: string; count: number | string | bigint }>(
      `
        SELECT artifact_path, COUNT(*)::int AS count
        FROM lcm_large_files
        WHERE artifact_path IN (${pathPlaceholders})
          AND conversation_id NOT IN (${outsidePlaceholders})
        GROUP BY artifact_path
      `,
      [...rawPaths, ...treeIDs],
    )
  ).rows
  const outsideRefs = new Set(outside.filter((row) => countValue(row) > 0).map((row) => row.artifact_path))
  return rawPaths.filter((artifactPath) => !outsideRefs.has(artifactPath))
}

async function deleteTreeRows(db: PGlite, treeIDs: ConversationID[]) {
  if (treeIDs.length === 0) return
  const ids = placeholders(treeIDs.length)
  await db.transaction(async (tx) => {
    await tx.query(
      `
        DELETE FROM lcm_map_items
        WHERE map_id IN (
          SELECT map_id
          FROM lcm_map_runs
          WHERE conversation_id IN (${ids})
        )
      `,
      treeIDs,
    )
    await tx.query(`DELETE FROM lcm_map_runs WHERE conversation_id IN (${ids})`, treeIDs)
    await tx.query(`DELETE FROM lcm_conversations WHERE conversation_id IN (${ids})`, treeIDs)
  })
}

function createArtifactCleanupID() {
  return `cleanup_${randomBytes(16).toString("hex")}`
}

async function queueArtifactCleanup(db: PGlite, artifactPaths: string[]) {
  const validPaths = [...new Set(artifactPaths)].filter((artifactPath) => validateArtifactPath(artifactPath).ok)
  if (validPaths.length === 0) return
  const now = Date.now()
  for (const artifactPath of validPaths) {
    await db.query(
      `
        INSERT INTO lcm_artifact_cleanup_queue (
          cleanup_id,
          artifact_path,
          first_seen_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $3)
        ON CONFLICT (artifact_path) DO UPDATE
        SET updated_at_ms = EXCLUDED.updated_at_ms
      `,
      [createArtifactCleanupID(), artifactPath, now],
    )
  }
}

async function removeArtifactPath(input: { dataDir: string; artifactPath: string }) {
  const validation = validateArtifactPath(input.artifactPath)
  if (!validation.ok) return undefined
  const artifactsDir = resolveLcmDbLayout(input.dataDir).artifactsDir
  const artifactsRoot = path.resolve(artifactsDir)
  const target = path.resolve(artifactsDir, input.artifactPath)
  const relative = path.relative(artifactsRoot, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  try {
    await fs.rm(target, { force: true })
    return undefined
  } catch (error) {
    return `lcm_cleanup_artifact_remove_failed_${(error as { code?: string } | undefined)?.code ?? "unknown"}`
  }
}

async function drainArtifactCleanupQueue(input: { db: PGlite; dataDir: string }) {
  const rows = (
    await input.db.query<{ cleanup_id: string; artifact_path: string }>(
      `
        SELECT cleanup_id, artifact_path
        FROM lcm_artifact_cleanup_queue
        ORDER BY first_seen_at_ms, cleanup_id
      `,
    )
  ).rows
  let firstFailure: string | undefined
  for (const row of rows) {
    const failureCode = await removeArtifactPath({ dataDir: input.dataDir, artifactPath: row.artifact_path })
    if (!failureCode) {
      await input.db.query("DELETE FROM lcm_artifact_cleanup_queue WHERE cleanup_id = $1", [row.cleanup_id])
      continue
    }
    firstFailure ??= failureCode
    await input.db.query(
      `
        UPDATE lcm_artifact_cleanup_queue
        SET attempt_count = attempt_count + 1,
            updated_at_ms = $2,
            last_error_code = $3
        WHERE cleanup_id = $1
      `,
      [row.cleanup_id, Date.now(), failureCode],
    )
  }
  if (firstFailure) {
    throw createDbUnavailableError({ diagnosticCode: firstFailure })
  }
}

export const handleSessionDeleted = Effect.fn("LcmLifecycle.handleSessionDeleted")(function* (input: {
  readonly sessionID: string
  readonly recursive: boolean
  readonly dataDir?: string
}) {
  const ready = yield* ensureLcmDbReady(input)
  const lcmDbRoot = yield* LcmDb.Service
  const lcmDb = LcmDb.scoped(lcmDbRoot, ready.target)
  const cleanup = yield* lcmDb.executeForeground(
    operationRequest({
      purpose: "cleanup",
      run: async (db) => {
        const row = await findConversationBySession(db, input.sessionID)
        if (!row) return { treeIDs: [] as ConversationID[] }
        if (!input.recursive) {
          const childCount = countValue(
            queryOne(
              (
                await db.query<CountRow>(
                  `
                    SELECT COUNT(*)::int AS count
                    FROM lcm_conversations
                    WHERE parent_conversation_id = $1
                  `,
                  [row.conversation_id],
                )
              ).rows,
            ),
          )
          if (childCount > 0) throw createInvalidRequest("lcm_cleanup_non_recursive_has_children")
        }

        const treeIDs = input.recursive ? await conversationTree(db, row.conversation_id) : [row.conversation_id]
        const artifactPaths = await collectArtifactPaths(db, treeIDs)
        await queueArtifactCleanup(db, artifactPaths)
        await deleteTreeRows(db, treeIDs)
        return { treeIDs }
      },
    }),
  )
  yield* lcmDb.executeForeground(
    operationRequest({
      purpose: "cleanup",
      run: async (db) => {
        await drainArtifactCleanupQueue({ db, dataDir: ready.dataDir })
      },
    }),
  )
  if (cleanup.treeIDs.length === 0) return
})

export * as LcmLifecycle from "./lifecycle"
