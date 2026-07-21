import type { KiloClient, LcmSafeError, Session } from "@kilocode/sdk/v2/client"

export type LcmSettingsWebviewRequest =
  | { type: "requestLcmSettings"; requestID: string; sessionID?: string }
  | {
      type: "updateLcmSettings"
      requestID: string
      sessionID?: string
      strategy?: "upward" | "dolt"
      storageWarningThresholdBytes?: number
    }

type Context = {
  client?: KiloClient
  connected: boolean
  currentSession?: Session
  contextSessionID?: string
  directory: (sessionID?: string) => string
  post: (message: unknown) => void
}

export function isLcmSettingsWebviewRequest(message: { type?: unknown }): message is LcmSettingsWebviewRequest {
  return message.type === "requestLcmSettings" || message.type === "updateLcmSettings"
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
    const result =
      message.type === "requestLcmSettings"
        ? sessionID
          ? await ctx.client.session.lcm.settings.get({ sessionID, ...transport })
          : await ctx.client.lcm.settings.get(transport)
        : sessionID
          ? await ctx.client.session.lcm.settings.update({
              sessionID,
              ...transport,
              lcmUpdateSettingsInput: {
                strategy: message.strategy,
                storageWarningThresholdBytes: message.storageWarningThresholdBytes,
              },
            })
          : await ctx.client.lcm.settings.update({
              ...transport,
              lcmUpdateSettingsInput: {
                strategy: message.strategy,
                storageWarningThresholdBytes: message.storageWarningThresholdBytes,
              },
            })
    if (result.error || !result.data) {
      ctx.post({
        type: resultType,
        requestID: message.requestID,
        ok: false,
        error: safeError(result.error) ?? fallbackError("lcm_ui_request_failed"),
      })
      return
    }
    ctx.post({ type: resultType, requestID: message.requestID, ok: true, state: result.data })
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
