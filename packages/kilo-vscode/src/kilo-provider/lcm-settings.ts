import type { KiloClient, LcmSafeError, Session } from "@kilocode/sdk/v2/client"

export type LcmSettingsWebviewRequest =
  | { type: "requestLcmSettings"; requestID: string; sessionID?: string }
  | { type: "requestLcmStatus"; requestID: string; sessionID?: string }
  | { type: "requestLcmActivity"; requestID: string; sessionID?: string; limit?: number }
  | { type: "cancelLcmMaintenance"; requestID: string; sessionID?: string }
  | { type: "diagnoseLcmDb"; requestID: string; sessionID?: string }
  | { type: "recoverLcmDbLock"; requestID: string; sessionID?: string; dryRun?: boolean; force?: boolean }
  | { type: "rebuildLcmDb"; requestID: string; sessionID?: string; dryRun?: boolean }
  | { type: "exportLcmPrompts"; requestID: string; sessionID?: string }
  | {
      type: "updateLcmSettings"
      requestID: string
      sessionID?: string
      strategy?: "upward" | "dolt"
      storageWarningThresholdBytes?: number
    }

type LcmSupportWebviewRequest = Exclude<LcmSettingsWebviewRequest, { type: "requestLcmSettings" | "updateLcmSettings" }>
type LcmTransportResult = { data?: unknown; error?: unknown }

type Context = {
  client?: KiloClient
  connected: boolean
  currentSession?: Session
  contextSessionID?: string
  directory: (sessionID?: string) => string
  post: (message: unknown) => void
}

export function isLcmSettingsWebviewRequest(message: { type?: unknown }): message is LcmSettingsWebviewRequest {
  return (
    message.type === "requestLcmSettings" ||
    message.type === "updateLcmSettings" ||
    message.type === "requestLcmStatus" ||
    message.type === "requestLcmActivity" ||
    message.type === "cancelLcmMaintenance" ||
    message.type === "diagnoseLcmDb" ||
    message.type === "recoverLcmDbLock" ||
    message.type === "rebuildLcmDb" ||
    message.type === "exportLcmPrompts"
  )
}

function safeError(value: unknown): LcmSafeError | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const candidate =
    record.code && record.safeMessage
      ? record
      : record.error && typeof record.error === "object"
        ? ((record.error as Record<string, unknown>).error ?? record.error)
        : record.data && typeof record.data === "object"
          ? ((record.data as Record<string, unknown>).error ?? record.data)
          : undefined
  if (!candidate || typeof candidate !== "object") return undefined
  const parsed = candidate as Record<string, unknown>
  if (typeof parsed.code !== "string" || typeof parsed.safeMessage !== "string") return undefined
  return candidate as LcmSafeError
}

function fallbackError(diagnosticCode: string): LcmSafeError {
  return {
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: {},
    safeMessage: "Memory storage is not ready. Follow the shown recovery action.",
    retryable: true,
    diagnosticCode,
  }
}

function isLcmSupportWebviewRequest(message: LcmSettingsWebviewRequest): message is LcmSupportWebviewRequest {
  return message.type !== "requestLcmSettings" && message.type !== "updateLcmSettings"
}

async function requestLcmSupport(input: {
  message: LcmSupportWebviewRequest
  client: KiloClient
  sessionID: string
  transport: { directory: string; workspace?: string }
}): Promise<LcmTransportResult> {
  const { message, client, sessionID, transport } = input
  switch (message.type) {
    case "requestLcmStatus":
      return client.session.lcm.status({ sessionID, ...transport })
    case "requestLcmActivity":
      return client.session.lcm.activity({ sessionID, ...transport, limit: String(message.limit ?? 100) })
    case "cancelLcmMaintenance":
      return client.session.lcm.maintenance.cancel({
        sessionID,
        ...transport,
        lcmCancelMaintenanceInput: { reason: "user" },
      })
    case "diagnoseLcmDb":
      return client.session.lcm.db.diagnose({ sessionID, ...transport })
    case "recoverLcmDbLock":
      return client.session.lcm.db.recoverLock({
        sessionID,
        ...transport,
        lcmDbRecoverLockInput: { dryRun: message.dryRun ?? true, force: message.force ?? false },
      })
    case "rebuildLcmDb":
      return client.session.lcm.db.rebuild({
        sessionID,
        ...transport,
        lcmDbRebuildInput: { dryRun: message.dryRun ?? true },
      })
    case "exportLcmPrompts":
      return client.session.lcm.prompts.export({ sessionID, ...transport })
  }
}

async function requestLcmSettings(input: {
  message: Exclude<LcmSettingsWebviewRequest, LcmSupportWebviewRequest>
  client: KiloClient
  sessionID?: string
  transport: { directory: string; workspace?: string }
}): Promise<LcmTransportResult> {
  const { message, client, sessionID, transport } = input
  if (message.type === "requestLcmSettings") {
    return sessionID ? client.session.lcm.settings.get({ sessionID, ...transport }) : client.lcm.settings.get(transport)
  }
  const lcmUpdateSettingsInput = {
    strategy: message.strategy,
    storageWarningThresholdBytes: message.storageWarningThresholdBytes,
  }
  return sessionID
    ? client.session.lcm.settings.update({ sessionID, ...transport, lcmUpdateSettingsInput })
    : client.lcm.settings.update({ ...transport, lcmUpdateSettingsInput })
}

export async function handleLcmSettingsWebviewRequest(message: LcmSettingsWebviewRequest, ctx: Context) {
  const resultType = `${message.type}.result`
  if (!ctx.client || !ctx.connected) {
    ctx.post({
      type: resultType,
      requestID: message.requestID,
      ok: false,
      error: fallbackError("lcm_ui_offline"),
    })
    return
  }

  const currentSession = ctx.currentSession
  const sessionID = message.sessionID ?? currentSession?.id ?? ctx.contextSessionID
  const directory = ctx.directory(sessionID)
  const workspace = currentSession && currentSession.id === sessionID ? currentSession.workspaceID : undefined
  const transport = { directory, ...(workspace ? { workspace } : {}) }

  try {
    const supportRequest = isLcmSupportWebviewRequest(message)
    if (supportRequest) {
      if (!sessionID) {
        ctx.post({
          type: resultType,
          requestID: message.requestID,
          ok: false,
          error: fallbackError("lcm_ui_session_required"),
        })
        return
      }
    }
    const result = supportRequest
      ? await requestLcmSupport({ message, client: ctx.client, sessionID: sessionID!, transport })
      : await requestLcmSettings({ message, client: ctx.client, sessionID, transport })
    if (result.error || !result.data) {
      ctx.post({
        type: resultType,
        requestID: message.requestID,
        ok: false,
        error: safeError(result.error) ?? fallbackError("lcm_ui_request_failed"),
      })
      return
    }
    ctx.post({
      type: resultType,
      requestID: message.requestID,
      ok: true,
      ...(message.type === "requestLcmSettings" || message.type === "updateLcmSettings"
        ? { state: result.data }
        : { body: result.data }),
    })
  } catch (error) {
    ctx.post({
      type: resultType,
      requestID: message.requestID,
      ok: false,
      error: safeError(error) ?? fallbackError("lcm_ui_transport_failed"),
    })
  }
}

export async function routeLcmSettingsWebviewRequest(message: { type?: unknown }, ctx: Context) {
  if (!isLcmSettingsWebviewRequest(message)) return false
  await handleLcmSettingsWebviewRequest(message, ctx)
  return true
}
