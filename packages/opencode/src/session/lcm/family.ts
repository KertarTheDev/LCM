// kilocode_change - new file
import { createHash } from "node:crypto"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { canonicalizeLcmPath, resolveLcmControlRoot, resolveLcmFamiliesRoot, resolveLcmFamilyRoot } from "./db-layout"
import { getLcmProductionSchemaVersion } from "./migrations"
import { parseLcmSafeError } from "./safe-error-schema"
import { createLcmSafeError, type LcmDbInitializeInput, type LcmSafeError } from "./types"

type KiloSessionRow = typeof SessionTable.$inferSelect
type KiloProjectRow = typeof ProjectTable.$inferSelect

export type LcmFamilyID = `family_${string}`

export interface LcmFamilyTarget {
  readonly familyID: LcmFamilyID
  readonly familyRoot: string
  readonly kiloDataDir: string
  readonly rootSessionID?: string
  readonly sessionID?: string
  readonly projectID?: string
  readonly workspaceID?: string
  readonly runtimeMode: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion: number
  readonly source: "session" | "debug"
}

export interface LcmResolvedSessionFamilyTarget {
  readonly target: LcmFamilyTarget
  readonly session: KiloSessionRow
  readonly rootSession: KiloSessionRow
  readonly project?: KiloProjectRow
}

export const LCM_FAMILY_ID_TEST_VECTOR = {
  rootSessionID: "ses_root_123",
  familyID: "family_1exf5Nokde4lQ9aMCrx5D1GzH3EwoiHGuBgsP13PgZ8" as LcmFamilyID,
} as const

export function deriveLcmFamilyID(rootSessionID: string): LcmFamilyID {
  const digest = createHash("sha256").update(`lcm-family-v1:${rootSessionID}`, "utf8").digest("base64url")
  return `family_${digest}` as LcmFamilyID
}

function safeError(input: {
  readonly code: LcmSafeError["code"]
  readonly diagnosticCode: string
  readonly retryable?: boolean
}): LcmSafeError {
  const templateKey =
    input.code === "not_found" || input.code === "unauthorized" ? "lcm.auth.denied" : "lcm.request.invalid"
  return createLcmSafeError({
    code: input.code,
    templateKey,
    safeParams: {},
    retryable: input.retryable ?? false,
    diagnosticCode: input.diagnosticCode,
  })
}

function loadSession(sessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID as KiloSessionRow["id"]))
      .get(),
  )
}

function loadProject(projectID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .where(eq(ProjectTable.id, projectID as KiloProjectRow["id"]))
      .get(),
  )
}

function sameScope(child: KiloSessionRow, parent: KiloSessionRow) {
  return child.project_id === parent.project_id && (child.workspace_id ?? null) === (parent.workspace_id ?? null)
}

async function canonicalDirectory(value: string) {
  return canonicalizeLcmPath(value)
}

function normalizeBoundaryPath(value: string) {
  const normalized = value.replace(/[\\/]+/g, "/").replace(/\/+$/, "")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function pathInside(child: string, root: string) {
  const nextChild = normalizeBoundaryPath(child)
  const nextRoot = normalizeBoundaryPath(root)
  return nextChild === nextRoot || nextChild.startsWith(`${nextRoot}/`)
}

async function validateParentLink(child: KiloSessionRow, parent: KiloSessionRow) {
  if (!sameScope(child, parent)) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_scope_mismatch" })
  }
  const childDirectory = await canonicalDirectory(child.directory)
  const parentDirectory = await canonicalDirectory(parent.directory)
  const parentProject = loadProject(parent.project_id)
  const parentWorktree = parentProject?.worktree ? await canonicalDirectory(parentProject.worktree) : undefined
  const childInsideParent = pathInside(childDirectory, parentDirectory)
  const childInsideWorktree = parentWorktree ? pathInside(childDirectory, parentWorktree) : false
  if (!childInsideParent && !childInsideWorktree) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_boundary_mismatch" })
  }
}

export function resolveKiloDataDirForLcm(input?: { kiloDataDir?: string }) {
  return input?.kiloDataDir ?? process.env.KILO_LCM_TEST_DATA_DIR ?? Global.Path.data
}

function inferKiloDataDirFromFamilyRoot(familyRoot: string) {
  const familiesRoot = path.dirname(familyRoot)
  const controlRoot = path.dirname(familiesRoot)
  if (path.basename(familiesRoot) !== "families" || path.basename(controlRoot) !== "lcm") return undefined
  return path.dirname(controlRoot)
}

export async function resolveSessionFamilyTarget(input: {
  readonly sessionID: string
  readonly assertedParentSessionID?: string
  readonly kiloDataDir?: string
  readonly runtimeMode?: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion?: number
}): Promise<LcmResolvedSessionFamilyTarget> {
  const session = loadSession(input.sessionID)
  if (!session) throw safeError({ code: "not_found", diagnosticCode: "lcm_family_session_not_found" })
  if (input.assertedParentSessionID && session.parent_id && input.assertedParentSessionID !== session.parent_id) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_assertion_mismatch" })
  }
  if (input.assertedParentSessionID && !session.parent_id) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_synthetic_parent_unproven" })
  }

  const seen = new Set<string>()
  let current = session
  while (current.parent_id) {
    if (seen.has(current.id)) {
      throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_cycle" })
    }
    seen.add(current.id)
    if (current.parent_id === current.id) {
      throw safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_self_link" })
    }
    const parent = loadSession(current.parent_id)
    if (!parent) throw safeError({ code: "not_found", diagnosticCode: "lcm_family_parent_not_found" })
    await validateParentLink(current, parent)
    current = parent
  }

  const kiloDataDir = await canonicalizeLcmPath(resolveKiloDataDirForLcm(input))
  const familyID = deriveLcmFamilyID(current.id)
  const familyRoot = await canonicalizeLcmPath(resolveLcmFamilyRoot({ kiloDataDir, familyID }))
  return {
    target: {
      familyID,
      familyRoot,
      kiloDataDir,
      rootSessionID: current.id,
      sessionID: session.id,
      projectID: session.project_id,
      ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}),
      runtimeMode: input.runtimeMode ?? "source",
      schemaVersion: input.schemaVersion ?? getLcmProductionSchemaVersion(),
      source: "session",
    },
    session,
    rootSession: current,
    project: loadProject(session.project_id) ?? undefined,
  }
}

function isSameOrInside(value: string, root: string) {
  const relative = path.relative(root, value)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export async function resolveDebugFamilyTarget(input: {
  readonly familyRoot: string
  readonly kiloDataDir?: string
  readonly runtimeMode?: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion?: number
}): Promise<LcmFamilyTarget> {
  const familyRoot = await canonicalizeLcmPath(input.familyRoot)
  const kiloDataDir = await canonicalizeLcmPath(
    input.kiloDataDir ??
      process.env.KILO_LCM_TEST_DATA_DIR ??
      inferKiloDataDirFromFamilyRoot(familyRoot) ??
      Global.Path.data,
  )
  const controlRoot = await canonicalizeLcmPath(resolveLcmControlRoot(kiloDataDir))
  const familiesRoot = await canonicalizeLcmPath(resolveLcmFamiliesRoot(kiloDataDir))
  const basename = path.basename(familyRoot)
  const parent = await canonicalizeLcmPath(path.dirname(familyRoot))

  if (familyRoot === kiloDataDir || familyRoot === controlRoot || familyRoot === familiesRoot) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_debug_family_root_not_explicit_family" })
  }
  if (basename === "pglite" || basename === "artifacts" || basename === "control") {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_debug_family_root_child_rejected" })
  }
  if (parent !== familiesRoot || !basename.startsWith("family_")) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_debug_family_root_old_global_or_malformed" })
  }
  if (!isSameOrInside(familyRoot, familiesRoot)) {
    throw safeError({ code: "invalid_request", diagnosticCode: "lcm_debug_family_root_outside_families" })
  }

  return {
    familyID: basename as LcmFamilyID,
    familyRoot,
    kiloDataDir,
    runtimeMode: input.runtimeMode ?? "source",
    schemaVersion: input.schemaVersion ?? getLcmProductionSchemaVersion(),
    source: "debug",
  }
}

export async function resolveDirectTestFamilyTarget(input: {
  readonly familyRoot: string
  readonly runtimeMode?: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion?: number
}): Promise<LcmFamilyTarget> {
  const familyRoot = await canonicalizeLcmPath(input.familyRoot)
  const basename = path.basename(familyRoot)
  const familyID = (basename.startsWith("family_") ? basename : deriveLcmFamilyID(`debug:${familyRoot}`)) as LcmFamilyID
  return {
    familyID,
    familyRoot,
    kiloDataDir: inferKiloDataDirFromFamilyRoot(familyRoot) ?? path.dirname(familyRoot),
    runtimeMode: input.runtimeMode ?? "source",
    schemaVersion: input.schemaVersion ?? getLcmProductionSchemaVersion(),
    source: "debug",
  }
}

export function resolveSessionFamilyTargetEffect(input: Parameters<typeof resolveSessionFamilyTarget>[0]) {
  return Effect.tryPromise({
    try: () => resolveSessionFamilyTarget(input),
    catch: (error) =>
      parseLcmSafeError(error) ??
      safeError({ code: "invalid_request", diagnosticCode: "lcm_family_resolution_failed" }),
  })
}

export function resolveDirectTestFamilyTargetEffect(input: Parameters<typeof resolveDirectTestFamilyTarget>[0]) {
  return Effect.tryPromise({
    try: () => resolveDirectTestFamilyTarget(input),
    catch: (error) =>
      parseLcmSafeError(error) ??
      safeError({ code: "invalid_request", diagnosticCode: "lcm_direct_family_resolution_failed" }),
  })
}

export function resolveDebugFamilyTargetEffect(input: Parameters<typeof resolveDebugFamilyTarget>[0]) {
  return Effect.tryPromise({
    try: () => resolveDebugFamilyTarget(input),
    catch: (error) =>
      parseLcmSafeError(error) ??
      safeError({ code: "invalid_request", diagnosticCode: "lcm_debug_family_resolution_failed" }),
  })
}
