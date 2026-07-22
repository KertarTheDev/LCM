// kilocode_change - new file
import { createHash } from "node:crypto"
import path from "node:path"
import { Effect, Option } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
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

type ResolveSessionFamilyTargetInput = {
  readonly sessionID: string
  readonly assertedParentSessionID?: string
  readonly kiloDataDir?: string
  readonly runtimeMode?: LcmDbInitializeInput["runtimeMode"]
  readonly schemaVersion?: number
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
  const templateKey = (() => {
    if (input.code === "not_found" || input.code === "unauthorized") return "lcm.auth.denied"
    if (input.code === "db_unavailable") return "lcm.db.unavailable"
    if (input.code === "recovery_required") return "lcm.recovery.required"
    return "lcm.request.invalid"
  })()
  return createLcmSafeError({
    code: input.code,
    templateKey,
    safeParams: {},
    retryable: input.retryable ?? false,
    diagnosticCode: input.diagnosticCode,
  })
}

function sameScope(child: KiloSessionRow, parent: KiloSessionRow) {
  return child.project_id === parent.project_id && (child.workspace_id ?? null) === (parent.workspace_id ?? null)
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

export function resolveKiloDataDirForLcm(input?: { kiloDataDir?: string }) {
  return input?.kiloDataDir ?? process.env.KILO_LCM_TEST_DATA_DIR ?? Global.Path.data
}

function inferKiloDataDirFromFamilyRoot(familyRoot: string) {
  const familiesRoot = path.dirname(familyRoot)
  const controlRoot = path.dirname(familiesRoot)
  if (path.basename(familiesRoot) !== "families" || path.basename(controlRoot) !== "lcm") return undefined
  return path.dirname(controlRoot)
}

export async function resolveSessionFamilyTarget(
  input: ResolveSessionFamilyTargetInput,
): Promise<LcmResolvedSessionFamilyTarget> {
  return Effect.runPromise(resolveSessionFamilyTargetWithDefaultDb(input)).catch((error) =>
    Promise.reject(
      parseLcmSafeError(error) ??
        safeError({ code: "db_unavailable", diagnosticCode: "lcm_family_database_open_failed", retryable: true }),
    ),
  )
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

function resolveSessionFamilyTargetWithDb(input: ResolveSessionFamilyTargetInput, db: CoreDatabase.Interface["db"]) {
  return Effect.gen(function* () {
    const loadCoreSession = (sessionID: string, diagnosticCode: string) =>
      db
        .get<KiloSessionRow>(sql`SELECT * FROM session WHERE id = ${sessionID}`)
        .pipe(Effect.mapError(() => safeError({ code: "db_unavailable", diagnosticCode, retryable: true })))
    const loadCoreProject = (projectID: string, diagnosticCode: string) =>
      db
        .get<KiloProjectRow>(sql`SELECT * FROM project WHERE id = ${projectID}`)
        .pipe(Effect.mapError(() => safeError({ code: "db_unavailable", diagnosticCode, retryable: true })))
    const canonical = (value: string, diagnosticCode: string) =>
      Effect.tryPromise({
        try: () => canonicalizeLcmPath(value),
        catch: (error) => parseLcmSafeError(error) ?? safeError({ code: "invalid_request", diagnosticCode }),
      })

    const session = yield* loadCoreSession(input.sessionID, "lcm_family_session_lookup_failed")
    if (!session)
      return yield* Effect.fail(safeError({ code: "not_found", diagnosticCode: "lcm_family_session_not_found" }))
    if (input.assertedParentSessionID && session.parent_id && input.assertedParentSessionID !== session.parent_id) {
      return yield* Effect.fail(
        safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_assertion_mismatch" }),
      )
    }
    if (input.assertedParentSessionID && !session.parent_id) {
      return yield* Effect.fail(
        safeError({ code: "invalid_request", diagnosticCode: "lcm_family_synthetic_parent_unproven" }),
      )
    }

    const project = yield* loadCoreProject(session.project_id, "lcm_family_project_lookup_failed")
    const projectRoots = (() => {
      const raw = project?.sandboxes as unknown
      const sandboxes = Array.isArray(raw)
        ? raw.filter((value): value is string => typeof value === "string" && value.length > 0)
        : typeof raw === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(raw) as unknown
                return Array.isArray(parsed)
                  ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
                  : []
              } catch {
                return []
              }
            })()
          : []
      return [project?.worktree, ...sandboxes].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    })()
    const canonicalProjectRoots = yield* Effect.forEach(
      projectRoots,
      (root) => canonical(root, "lcm_family_project_boundary_resolution_failed"),
      { concurrency: 1 },
    )

    const seen = new Set<string>()
    let current = session
    while (current.parent_id) {
      if (seen.has(current.id)) {
        return yield* Effect.fail(safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_cycle" }))
      }
      seen.add(current.id)
      if (current.parent_id === current.id) {
        return yield* Effect.fail(safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_self_link" }))
      }
      const parent = yield* loadCoreSession(current.parent_id, "lcm_family_parent_lookup_failed")
      if (!parent) {
        return yield* Effect.fail(safeError({ code: "not_found", diagnosticCode: "lcm_family_parent_not_found" }))
      }
      if (!sameScope(current, parent)) {
        return yield* Effect.fail(
          safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_scope_mismatch" }),
        )
      }
      if (typeof current.directory !== "string" || typeof parent.directory !== "string") {
        return yield* Effect.fail(
          safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_directory_invalid" }),
        )
      }
      const childDirectory = yield* canonical(current.directory, "lcm_family_child_directory_resolution_failed")
      const parentDirectory = yield* canonical(parent.directory, "lcm_family_parent_directory_resolution_failed")
      if (
        !pathInside(childDirectory, parentDirectory) &&
        !canonicalProjectRoots.some((root) => pathInside(childDirectory, root))
      ) {
        return yield* Effect.fail(
          safeError({ code: "invalid_request", diagnosticCode: "lcm_family_parent_boundary_mismatch" }),
        )
      }
      current = parent
    }

    const kiloDataDir = yield* canonical(resolveKiloDataDirForLcm(input), "lcm_family_data_dir_resolution_failed")
    const familyID = deriveLcmFamilyID(current.id)
    const familyRoot = yield* canonical(
      resolveLcmFamilyRoot({ kiloDataDir, familyID }),
      "lcm_family_root_resolution_failed",
    )
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
        source: "session" as const,
      },
      session,
      rootSession: current,
      project: project ?? undefined,
    }
  })
}

function resolveSessionFamilyTargetWithDefaultDb(input: ResolveSessionFamilyTargetInput) {
  return CoreDatabase.Service.use(({ db }) => resolveSessionFamilyTargetWithDb(input, db)).pipe(
    Effect.provide(CoreDatabase.defaultLayer),
  )
}

export function resolveSessionFamilyTargetEffect(input: ResolveSessionFamilyTargetInput) {
  return Effect.gen(function* () {
    const database = yield* Effect.serviceOption(CoreDatabase.Service)
    if (Option.isSome(database)) return yield* resolveSessionFamilyTargetWithDb(input, database.value.db)
    return yield* resolveSessionFamilyTargetWithDefaultDb(input)
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
