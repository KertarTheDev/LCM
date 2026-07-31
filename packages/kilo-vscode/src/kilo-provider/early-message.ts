import { routeSuggestionWebviewMessage } from "./handlers/suggestion"
import * as vscode from "vscode"
import * as ModelState from "./model-state"
import { routeInputToolMessage } from "../services/input-tools"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { SuggestionContext } from "./handlers/suggestion"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import {
  exportConversationMemoryContext,
  fetchConversationMemoryActivity,
  fetchConversationMemoryStatus,
  showConversationMemoryTimeline,
} from "./conversation-memory"
import { t } from "../services/i18n"

type Ctx = {
  question: SuggestionContext
  client: KiloClient | null
  connection: KiloConnectionService
  dir: string
  resolveDir: (sessionID?: string) => string
  post: (msg: unknown) => void
  exportTranscript: (sessionID: string) => Promise<void>
  copy: (text: string) => PromiseLike<void>
  openSessions: (ids: string[]) => void
}

type EarlyMessage = { type: string; id?: unknown; text?: unknown }

async function routeClipboardMessage(message: EarlyMessage, ctx: Pick<Ctx, "copy" | "post">): Promise<boolean> {
  if (message.type !== "copyToClipboard") return false
  if (typeof message.id !== "string") return true
  if (typeof message.text !== "string") {
    ctx.post({ type: "clipboardWriteResult", id: message.id, ok: false, error: "Invalid clipboard text" })
    return true
  }
  await ctx.copy(message.text).then(
    () => ctx.post({ type: "clipboardWriteResult", id: message.id, ok: true }),
    (err) =>
      ctx.post({
        type: "clipboardWriteResult",
        id: message.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
  )
  return true
}

export async function routeEarlyMessage(
  message: EarlyMessage,
  ctx: Ctx,
): Promise<boolean> {
  if (await routeClipboardMessage(message, ctx)) return true
  await routeSuggestionWebviewMessage(ctx.question, message)
  if (await ModelState.handleMessage(message.type, message, ctx.client, ctx.post)) return true
  if (message.type === "exportSessionTranscript") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string") await ctx.exportTranscript(input.sessionID)
    return true
  }
  if (message.type === "requestLcmStatus") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID !== "string" || !ctx.client) return true
    const dir = ctx.resolveDir(input.sessionID)
    const [status, activity] = await Promise.allSettled([
      fetchConversationMemoryStatus(ctx.client, input.sessionID, dir),
      fetchConversationMemoryActivity(ctx.client, input.sessionID, dir),
    ])
    if (status.status === "fulfilled") ctx.post({ type: "lcmStatus", sessionID: input.sessionID, status: status.value })
    else
      ctx.post({
        type: "lcmStatusError",
        sessionID: input.sessionID,
        message: status.reason instanceof Error ? status.reason.message : String(status.reason),
      })
    if (activity.status === "fulfilled")
      ctx.post({ type: "lcmActivity", sessionID: input.sessionID, items: activity.value })
    return true
  }
  if (message.type === "showLcmTimeline") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string" && ctx.client) {
      await showConversationMemoryTimeline(ctx.client, input.sessionID, ctx.resolveDir(input.sessionID)).catch(
        (error) => {
          vscode.window.showErrorMessage(
            t("conversationMemory.timeline.failed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          )
        },
      )
    }
    return true
  }
  if (message.type === "exportLcmContext") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string" && ctx.client) {
      await exportConversationMemoryContext(ctx.client, input.sessionID, ctx.resolveDir(input.sessionID))
        .then((uri) => {
          if (uri)
            vscode.window.showInformationMessage(
              t("conversationMemory.export.saved", { path: uri.fsPath || uri.toString() }),
            )
        })
        .catch((error) => {
          vscode.window.showErrorMessage(
            t("conversationMemory.export.failed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          )
        })
    }
    return true
  }
  if (message.type === "sidebar.openSessions") {
    const input = message as { sessionIDs?: unknown }
    const ids = Array.isArray(input.sessionIDs)
      ? input.sessionIDs.filter((id): id is string => typeof id === "string")
      : []
    ctx.openSessions(ids)
    return true
  }
  return await routeInputToolMessage(message, { connection: ctx.connection, dir: ctx.dir, post: ctx.post })
}
