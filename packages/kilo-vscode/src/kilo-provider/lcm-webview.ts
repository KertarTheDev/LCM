import type {
  KiloClient,
  LcmDbDiagnoseReport,
  LcmDbRebuildReport,
  LcmMaintenanceResult,
  LcmPromptExportReport,
  LcmSafeError,
  Session,
} from "@kilocode/sdk/v2/client"
import { extractLcmSafeError } from "./lcm-safe-error"

export type LcmWebviewRequest =
  | {
      type: "requestLcmSettings"
      requestID?: string
      body?: { sessionID?: string; projectID?: string; workspaceID?: string }
    }
  | {
      type: "updateLcmSettings"
      requestID?: string
      body?: {
        sessionID?: string
        projectID?: string
        workspaceID?: string
        strategy?: "upward" | "dolt"
        freshTailTokens?: number
        storageWarningThresholdBytes?: number
      }
    }
  | {
      type: "cancelLcmMaintenance"
      requestID?: string
      body?: { sessionID?: string }
    }
  | {
      type: "diagnoseLcmDb"
      requestID?: string
      body?: { sessionID?: string }
    }
  | {
      type: "rebuildLcmDb"
      requestID?: string
      body?: { sessionID?: string; dryRun?: boolean }
    }
  | {
      type: "exportLcmPrompts"
      requestID?: string
      body?: { sessionID?: string }
    }

type LcmWebviewContext = {
  client: KiloClient | null
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  currentSession: Session | null
  contextSessionID?: string
  projectID?: string
  setProjectID: (projectID: string) => void
  getWorkspaceDirectory: (sessionID?: string) => string
  postMessage: (message: unknown) => void
}

type LcmSafeErrorCode = LcmSafeError["code"]

const LCM_WEBVIEW_REQUEST_TYPES = new Set<LcmWebviewRequest["type"]>([
  "requestLcmSettings",
  "updateLcmSettings",
  "cancelLcmMaintenance",
  "diagnoseLcmDb",
  "rebuildLcmDb",
  "exportLcmPrompts",
])

export function isLcmWebviewRequest(message: { type?: unknown }): message is LcmWebviewRequest {
  return typeof message.type === "string" && LCM_WEBVIEW_REQUEST_TYPES.has(message.type as LcmWebviewRequest["type"])
}

function createLcmTransportError(input: {
  code?: LcmSafeErrorCode
  safeMessage: string
  retryable?: boolean
  diagnosticCode: string
}): LcmSafeError {
  return {
    code: input.code ?? "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    safeMessage: input.safeMessage,
    retryable: input.retryable ?? false,
    diagnosticCode: input.diagnosticCode,
  }
}

function normalizeLcmTransportError(error: unknown, diagnosticCode: string): LcmSafeError {
  const safeError = extractLcmSafeError(error)
  if (safeError) return safeError
  return createLcmTransportError({
    code: "db_unavailable",
    safeMessage: "Memory request failed.",
    diagnosticCode,
  })
}

function postLcmResult<TBody>(
  ctx: LcmWebviewContext,
  type: `${LcmWebviewRequest["type"]}.result`,
  requestID: string,
  result:
    | {
        ok: true
        body: TBody
      }
    | {
        ok: false
        error: LcmSafeError
      },
): void {
  ctx.postMessage({
    type,
    requestID,
    ...result,
  })
}

type LcmConnectedRequest = {
  ctx: LcmWebviewContext
  client: KiloClient
  requestID: string
  responseType: `${LcmWebviewRequest["type"]}.result`
  sessionID?: string
  directory: string
  currentWorkspaceID?: string
}

function resolveRequestSessionID(body: LcmWebviewRequest["body"], ctx: LcmWebviewContext): string | undefined {
  const bodySessionID = typeof body?.sessionID === "string" ? body.sessionID.trim() : undefined
  if (bodySessionID) return bodySessionID
  return ctx.currentSession?.id ?? ctx.contextSessionID ?? undefined
}

async function handleRequestSettings(request: LcmConnectedRequest): Promise<void> {
  const transportInput = {
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
  }
  const result = request.sessionID
    ? await request.client.session.lcm.settings.get({
        sessionID: request.sessionID,
        ...transportInput,
      })
    : await request.client.lcm.settings.get(transportInput)
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_settings_get_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

async function handleUpdateSettings(
  message: Extract<LcmWebviewRequest, { type: "updateLcmSettings" }>,
  request: LcmConnectedRequest,
): Promise<void> {
  const lcmUpdateSettingsInput = { ...(message.body ?? {}) }
  const transportInput = {
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
    lcmUpdateSettingsInput,
  }
  const result = request.sessionID
    ? await request.client.session.lcm.settings.update({
        sessionID: request.sessionID,
        ...transportInput,
      })
    : await request.client.lcm.settings.update({
        ...transportInput,
      })
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_settings_update_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

async function handleCancelMaintenance(request: LcmConnectedRequest): Promise<void> {
  if (!request.sessionID) {
    postLcmResult<LcmMaintenanceResult>(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: createLcmTransportError({
        safeMessage: "Open a Kilo task before canceling queued memory maintenance.",
        diagnosticCode: "lcm_webview_cancel_maintenance_session_missing",
      }),
    })
    return
  }
  const result = await request.client.session.lcm.maintenance.cancel({
    sessionID: request.sessionID,
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
    lcmCancelMaintenanceInput: { reason: "user" },
  })
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_maintenance_cancel_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

async function handleDiagnoseDb(request: LcmConnectedRequest): Promise<void> {
  if (!request.sessionID) {
    postLcmResult<LcmDbDiagnoseReport>(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: createLcmTransportError({
        safeMessage: "Open a Kilo task before running memory diagnostics.",
        diagnosticCode: "lcm_webview_db_diagnose_session_missing",
      }),
    })
    return
  }
  const result = await request.client.session.lcm.db.diagnose({
    sessionID: request.sessionID,
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
  })
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_db_diagnose_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

async function handleRebuildDb(
  message: Extract<LcmWebviewRequest, { type: "rebuildLcmDb" }>,
  request: LcmConnectedRequest,
): Promise<void> {
  if (!request.sessionID) {
    postLcmResult<LcmDbRebuildReport>(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: createLcmTransportError({
        safeMessage: "Open a Kilo task before repairing memory.",
        diagnosticCode: "lcm_webview_db_rebuild_session_missing",
      }),
    })
    return
  }
  const result = await request.client.session.lcm.db.rebuild({
    sessionID: request.sessionID,
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
    lcmDbRebuildInput: { dryRun: message.body?.dryRun ?? true },
  })
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_db_rebuild_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

async function handleExportPrompts(request: LcmConnectedRequest): Promise<void> {
  if (!request.sessionID) {
    postLcmResult<LcmPromptExportReport>(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: createLcmTransportError({
        safeMessage: "Open a Kilo task before exporting memory prompts.",
        diagnosticCode: "lcm_webview_prompts_export_session_missing",
      }),
    })
    return
  }
  const result = await request.client.session.lcm.prompts.export({
    sessionID: request.sessionID,
    directory: request.directory,
    ...(request.currentWorkspaceID ? { workspace: request.currentWorkspaceID } : {}),
  })
  if (result.error || !result.data) {
    postLcmResult(request.ctx, request.responseType, request.requestID, {
      ok: false,
      error: normalizeLcmTransportError(result.error, "lcm_webview_prompts_export_failed"),
    })
    return
  }
  postLcmResult(request.ctx, request.responseType, request.requestID, { ok: true, body: result.data })
}

export async function handleLcmWebviewRequest(message: LcmWebviewRequest, ctx: LcmWebviewContext): Promise<void> {
  const requestID = typeof message.requestID === "string" ? message.requestID : `lcm-${Date.now()}`
  const responseType = `${message.type}.result` as `${LcmWebviewRequest["type"]}.result`
  const client = ctx.client
  if (!client || ctx.connectionState !== "connected") {
    postLcmResult(ctx, responseType, requestID, {
      ok: false,
      error: createLcmTransportError({
        code: "db_unavailable",
        safeMessage: "Memory settings are unavailable because the CLI backend is not connected.",
        diagnosticCode: "lcm_webview_backend_not_connected",
        retryable: true,
      }),
    })
    return
  }

  const body = message.body ?? {}
  const sessionID = resolveRequestSessionID(body, ctx)
  const directory = ctx.getWorkspaceDirectory(sessionID)
  const currentWorkspaceID =
    ctx.currentSession?.id && ctx.currentSession.id === sessionID ? ctx.currentSession.workspaceID : undefined
  const request = { ctx, client, requestID, responseType, sessionID, directory, currentWorkspaceID }

  try {
    switch (message.type) {
      case "requestLcmSettings":
        await handleRequestSettings(request)
        return
      case "updateLcmSettings":
        await handleUpdateSettings(message, request)
        return
      case "cancelLcmMaintenance":
        await handleCancelMaintenance(request)
        return
      case "diagnoseLcmDb":
        await handleDiagnoseDb(request)
        return
      case "rebuildLcmDb":
        await handleRebuildDb(message, request)
        return
      case "exportLcmPrompts":
        await handleExportPrompts(request)
        return
    }
  } catch (error) {
    postLcmResult(ctx, responseType, requestID, {
      ok: false,
      error: normalizeLcmTransportError(error, "lcm_webview_transport_failed"),
    })
  }
}
