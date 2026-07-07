// kilocode_change - new file
import type { Config } from "@/config/config"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { SessionTable } from "../session.sql"
import * as LcmConfig from "./config"
import { createOperationID } from "./id"
import {
  createLcmSafeError,
  type LcmSafeError,
  type LcmSettingsScopeKind,
  type LcmSettingsState,
  type LcmUpdateSettingsInput,
  type OperationID,
} from "./types"

type KiloSessionRow = typeof SessionTable.$inferSelect

export interface LcmSettingsResolvedScope {
  readonly kind: Exclude<LcmSettingsScopeKind, "default">
  readonly projectID: string
  readonly workspaceID?: string
  readonly sessionID?: string
}

export function lcmSettingsUnavailable(diagnosticCode: string, operationID: OperationID = createOperationID()) {
  return createLcmSafeError({
    code: "settings_unavailable",
    templateKey: "lcm.settings.unavailable",
    safeParams: { operationID, retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode,
  })
}

function lcmSettingsInvalidRequest(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

function loadKiloSessionRow(sessionID: string) {
  const row = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID as KiloSessionRow["id"]))
      .get(),
  )
  if (!row) {
    throw createLcmSafeError({
      code: "not_found",
      templateKey: "lcm.auth.denied",
      safeParams: {},
      retryable: false,
      diagnosticCode: "lcm_settings_session_not_found",
    })
  }
  return row
}

export function resolveLcmSettingsScope(input: {
  readonly sessionID?: string
  readonly projectID?: string
  readonly workspaceID?: string
}): LcmSettingsResolvedScope {
  if (input.sessionID) {
    const session = loadKiloSessionRow(input.sessionID)
    if (input.projectID !== undefined && input.projectID !== session.project_id) {
      throw lcmSettingsInvalidRequest("lcm_settings_project_scope_mismatch")
    }
    if (Object.hasOwn(input, "workspaceID") && input.workspaceID !== (session.workspace_id ?? undefined)) {
      throw lcmSettingsInvalidRequest("lcm_settings_workspace_scope_mismatch")
    }
    return {
      kind: session.workspace_id ? "workspace" : "project",
      projectID: session.project_id,
      ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}),
      sessionID: input.sessionID,
    }
  }

  if (!input.projectID) throw lcmSettingsInvalidRequest("lcm_settings_project_required")
  return {
    kind: input.workspaceID ? "workspace" : "project",
    projectID: input.projectID,
    ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
  }
}

export function validateLcmSettingsUpdate(input: LcmUpdateSettingsInput) {
  const allowed = new Set([
    "sessionID",
    "projectID",
    "workspaceID",
    "strategy",
    "freshTailTokens",
    "storageWarningThresholdBytes",
  ])
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) throw lcmSettingsInvalidRequest("lcm_settings_unsupported_field")
    if (value === null) throw lcmSettingsInvalidRequest("lcm_settings_null_field")
  }
  if (input.strategy !== undefined && input.strategy !== "upward" && input.strategy !== "dolt") {
    throw lcmSettingsInvalidRequest("lcm_settings_invalid_strategy")
  }
  const freshTailTokens = input.freshTailTokens
  if (
    freshTailTokens !== undefined &&
    (typeof freshTailTokens !== "number" ||
      !Number.isInteger(freshTailTokens) ||
      freshTailTokens <= 0 ||
      !Number.isFinite(freshTailTokens))
  ) {
    throw lcmSettingsInvalidRequest("lcm_settings_invalid_fresh_tail_tokens")
  }
  const threshold = input.storageWarningThresholdBytes
  if (
    threshold !== undefined &&
    (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0 || !Number.isFinite(threshold))
  ) {
    throw lcmSettingsInvalidRequest("lcm_settings_invalid_storage_threshold")
  }
}

function hasPublicLcmSetting(config: Config.Info["lcm"] | undefined) {
  return (
    config?.strategy !== undefined ||
    config?.freshTailTokens !== undefined ||
    config?.storage?.warningThresholdBytes !== undefined
  )
}

export function lcmSettingsConfigPatch(input: LcmUpdateSettingsInput): Config.Info {
  const lcm: NonNullable<Config.Info["lcm"]> = {}
  if (input.strategy !== undefined) lcm.strategy = input.strategy
  if (input.freshTailTokens !== undefined) lcm.freshTailTokens = input.freshTailTokens
  if (input.storageWarningThresholdBytes !== undefined) {
    lcm.storage = { warningThresholdBytes: input.storageWarningThresholdBytes }
  }
  return { lcm }
}

export function mergePublicLcmSettings(input: {
  readonly current: Config.Info["lcm"] | undefined
  readonly patch: LcmUpdateSettingsInput
}): Config.Info["lcm"] {
  return {
    ...(input.current ?? {}),
    ...(input.patch.strategy !== undefined ? { strategy: input.patch.strategy } : {}),
    ...(input.patch.freshTailTokens !== undefined ? { freshTailTokens: input.patch.freshTailTokens } : {}),
    storage: {
      ...(input.current?.storage ?? {}),
      ...(input.patch.storageWarningThresholdBytes !== undefined
        ? { warningThresholdBytes: input.patch.storageWarningThresholdBytes }
        : {}),
    },
  }
}

export function lcmSettingsStateFromConfig(input: {
  readonly scope: LcmSettingsResolvedScope
  readonly effectiveConfig: Config.Info
  readonly localConfig?: Config.Info
  readonly storageBytes?: number
  readonly lifecycleState?: LcmSettingsState["lifecycleState"]
  readonly safeError?: LcmSafeError
}): LcmSettingsState {
  const resolved = LcmConfig.resolve(input.effectiveConfig.lcm)
  const threshold = resolved.storage.warningThresholdBytes
  const explicit = hasPublicLcmSetting(input.localConfig?.lcm)
  const storageBytes = input.storageBytes ?? 0
  return {
    strategy: resolved.strategy,
    freshTailTokens: resolved.freshTailTokens,
    storageWarningThresholdBytes: threshold,
    storageBytes,
    storageWarning: LcmConfig.storageWarning({
      storageBytes,
      warningThresholdBytes: threshold,
    }),
    effectiveScope: explicit
      ? {
          kind: input.scope.kind,
          projectID: input.scope.projectID,
          ...(input.scope.workspaceID ? { workspaceID: input.scope.workspaceID } : {}),
        }
      : {
          kind: "default",
          projectID: input.scope.projectID,
          ...(input.scope.workspaceID ? { workspaceID: input.scope.workspaceID } : {}),
        },
    ...(input.lifecycleState ? { lifecycleState: input.lifecycleState } : {}),
    ...(input.safeError ? { safeError: input.safeError } : {}),
  }
}
