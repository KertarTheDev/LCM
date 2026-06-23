export type LcmSettingsRequestKind =
  | "read"
  | "update"
  | "cancelMaintenance"
  | "diagnoseDb"
  | "rebuildDb"
  | "exportPrompts"

export type LcmSettingsPendingRequests = {
  read?: string
  update?: string
  cancelMaintenance?: string
  diagnoseDb?: string
  rebuildDb?: string
  exportPrompts?: string
}

export type BeginLcmSettingsRequestResult = {
  pending: LcmSettingsPendingRequests
  started: boolean
}

export type FinishLcmSettingsRequestResult = {
  pending: LcmSettingsPendingRequests
  accepted: boolean
}

export type LcmMemoryRequestScope = {
  sessionID?: string
}

export function lcmMemoryRequestScope(sessionID: string | undefined): LcmMemoryRequestScope {
  const normalized = sessionID?.trim()
  if (!normalized || normalized.startsWith("cloud:")) return {}
  return { sessionID: normalized }
}

function pendingRequests(
  read?: string,
  update?: string,
  cancelMaintenance?: string,
  diagnoseDb?: string,
  rebuildDb?: string,
  exportPrompts?: string,
): LcmSettingsPendingRequests {
  const next: LcmSettingsPendingRequests = {}
  if (read) next.read = read
  if (update) next.update = update
  if (cancelMaintenance) next.cancelMaintenance = cancelMaintenance
  if (diagnoseDb) next.diagnoseDb = diagnoseDb
  if (rebuildDb) next.rebuildDb = rebuildDb
  if (exportPrompts) next.exportPrompts = exportPrompts
  return next
}

function clearRequest(pending: LcmSettingsPendingRequests, kind: LcmSettingsRequestKind): LcmSettingsPendingRequests {
  if (kind === "read") {
    return pendingRequests(
      undefined,
      pending.update,
      pending.cancelMaintenance,
      pending.diagnoseDb,
      pending.rebuildDb,
      pending.exportPrompts,
    )
  }
  if (kind === "update") {
    return pendingRequests(
      pending.read,
      undefined,
      pending.cancelMaintenance,
      pending.diagnoseDb,
      pending.rebuildDb,
      pending.exportPrompts,
    )
  }
  if (kind === "cancelMaintenance") {
    return pendingRequests(
      pending.read,
      pending.update,
      undefined,
      pending.diagnoseDb,
      pending.rebuildDb,
      pending.exportPrompts,
    )
  }
  if (kind === "diagnoseDb") {
    return pendingRequests(
      pending.read,
      pending.update,
      pending.cancelMaintenance,
      undefined,
      pending.rebuildDb,
      pending.exportPrompts,
    )
  }
  if (kind === "rebuildDb") {
    return pendingRequests(
      pending.read,
      pending.update,
      pending.cancelMaintenance,
      pending.diagnoseDb,
      undefined,
      pending.exportPrompts,
    )
  }
  return pendingRequests(pending.read, pending.update, pending.cancelMaintenance, pending.diagnoseDb, pending.rebuildDb)
}

export function beginLcmSettingsRead(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.update || pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { ...pending, read: requestID }, started: true }
}

export function beginLcmSettingsUpdate(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { update: requestID }, started: true }
}

export function beginLcmMaintenanceCancel(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { cancelMaintenance: requestID }, started: true }
}

export function beginLcmDbDiagnose(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { diagnoseDb: requestID }, started: true }
}

export function beginLcmDbRebuild(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { rebuildDb: requestID }, started: true }
}

export function beginLcmPromptsExport(
  pending: LcmSettingsPendingRequests,
  requestID: string,
): BeginLcmSettingsRequestResult {
  if (pending.cancelMaintenance || pending.diagnoseDb || pending.rebuildDb || pending.exportPrompts) {
    return { pending, started: false }
  }
  return { pending: { exportPrompts: requestID }, started: true }
}

export function finishLcmSettingsRequest(
  pending: LcmSettingsPendingRequests,
  kind: LcmSettingsRequestKind,
  requestID: string,
): FinishLcmSettingsRequestResult {
  if (pending[kind] !== requestID) return { pending, accepted: false }
  return { pending: clearRequest(pending, kind), accepted: true }
}
