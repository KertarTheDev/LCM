import path from "node:path"
import { chmod } from "node:fs/promises"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { t } from "../services/i18n"

function routed(sessionID: string, dir: string) {
  return { sessionID, directory: dir }
}

export async function routeConversationMemoryMessage(
  message: { type: string },
  ctx: {
    client: KiloClient | null
    resolveDir: (sessionID?: string) => string
    post: (message: unknown) => void
  },
): Promise<boolean> {
  const input = message as { type: string; sessionID?: unknown }
  if (input.type === "requestLcmStatus") {
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
  if (input.type === "showLcmTimeline") {
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
  if (input.type !== "exportLcmContext") return false
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

export async function fetchConversationMemoryStatus(client: KiloClient, sessionID: string, dir: string) {
  const response = await client.conversationMemory.status(routed(sessionID, dir), { throwOnError: true })
  return response.data
}

export async function fetchConversationMemoryActivity(client: KiloClient, sessionID: string, dir: string) {
  const response = await client.conversationMemory.activity(
    { ...routed(sessionID, dir), limit: "100" },
    { throwOnError: true },
  )
  return response.data.items
}

export async function showConversationMemoryTimeline(client: KiloClient, sessionID: string, dir: string) {
  const response = await client.conversationMemory.activity(
    { ...routed(sessionID, dir), limit: "100" },
    { throwOnError: true },
  )
  const selected = await vscode.window.showQuickPick(
    response.data.items.map((item) => ({
      label: `${item.kind.replaceAll("_", " ")} · ${new Date(item.createdAt).toLocaleString()}`,
      description:
        item.pressureBefore === undefined
          ? undefined
          : `${Math.round(item.pressureBefore * 100)}% → ${Math.round((item.pressureAfter ?? item.pressureBefore) * 100)}%`,
      detail: item.message,
      item,
    })),
    {
      title: t("conversationMemory.action.timeline"),
      placeHolder:
        response.data.items.length === 0
          ? t("conversationMemory.timeline.empty")
          : t("conversationMemory.timeline.select"),
      matchOnDescription: true,
      matchOnDetail: true,
    },
  )
  if (!selected) return
  const detail = [
    selected.item.message,
    selected.item.rawTokens === undefined
      ? undefined
      : t("conversationMemory.timeline.raw", { tokens: selected.item.rawTokens.toLocaleString() }),
    selected.item.summaryTokens === undefined
      ? undefined
      : t("conversationMemory.timeline.summary", { tokens: selected.item.summaryTokens.toLocaleString() }),
    selected.item.summaryIDs?.length
      ? t("conversationMemory.timeline.summaries", { ids: selected.item.summaryIDs.join(", ") })
      : undefined,
  ]
    .filter(Boolean)
    .join("\n")
  await vscode.window.showInformationMessage(detail, { modal: true })
}

export async function exportConversationMemoryContext(client: KiloClient, sessionID: string, dir: string) {
  const proceed = await vscode.window.showWarningMessage(
    t("conversationMemory.export.warning"),
    { modal: true },
    t("conversationMemory.export.continue"),
  )
  if (!proceed) return
  const response = await client.conversationMemory.export(routed(sessionID, dir), { throwOnError: true })
  const filename =
    response.response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    `kilo-context-${sessionID}-${Date.now()}.zip`
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(dir, path.basename(filename))),
    filters: { "ZIP archive": ["zip"] },
    saveLabel: t("conversationMemory.export.save"),
    title: t("conversationMemory.export.title"),
  })
  if (!uri) return false
  const temporary = uri.with({ path: `${uri.path}.${process.pid}.tmp` })
  // The SDK's generated `File` model collides with the web `File` name in the
  // binary response union. The HTTP client returns this response as a Blob.
  const payload = response.data as Blob
  let published = false
  try {
    await vscode.workspace.fs.writeFile(temporary, new Uint8Array(await payload.arrayBuffer()))
    if (temporary.scheme === "file") await chmod(temporary.fsPath, 0o600)
    await vscode.workspace.fs.rename(temporary, uri, { overwrite: false })
    published = true
  } finally {
    if (!published)
      await vscode.workspace.fs.delete(temporary).then(
        () => undefined,
        () => undefined,
      )
  }
  return uri
}
