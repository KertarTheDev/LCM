import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient, Message, Part, Session } from "@kilocode/sdk/v2/client"
import { fetchMessagePage, MESSAGE_PAGE_LIMIT } from "./message-page"

type Item = {
  info: Message
  parts: Part[]
}

const TOOL_PREVIEW_LIMIT = 4_000
const MAX_EXPORT_PAGES = 1_000

export async function exportTranscript(
  client: KiloClient,
  input: {
    sessionID: string
    dir: string
  },
) {
  const { data: session } = await client.session.get(
    { sessionID: input.sessionID, directory: input.dir },
    { throwOnError: true },
  )
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(input.dir, `session-${session.id.slice(0, 8)}.md`)),
    filters: { Markdown: ["md", "markdown"] },
    saveLabel: "Export",
  })
  if (!uri) return false
  const text = formatTranscript(session, await fetchTranscriptItems(client, input))
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"))
  return true
}

export async function fetchTranscriptItems(
  client: KiloClient,
  input: {
    sessionID: string
    dir: string
    signal?: AbortSignal
  },
) {
  const pages: Item[][] = []
  const seen = new Set<string>()
  let before: string | undefined
  for (let i = 0; i < MAX_EXPORT_PAGES; i++) {
    const page = await fetchMessagePage(client, {
      sessionID: input.sessionID,
      workspaceDir: input.dir,
      limit: MESSAGE_PAGE_LIMIT,
      before,
      signal: input.signal,
    })
    pages.unshift(page.items)
    if (!page.cursor) return pages.flat()
    if (seen.has(page.cursor)) throw new Error("Repeated transcript cursor while exporting session")
    seen.add(page.cursor)
    before = page.cursor
  }
  throw new Error("Session transcript export exceeded the page limit")
}

export function formatTranscript(session: Session, items: Item[]): string {
  const head = [
    `# ${session.title}`,
    "",
    `**Session ID:** ${session.id}`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
    "",
  ].join("\n")
  const body = items.map((item) => formatMessage(item)).join("---\n\n")
  return `${head}${body}${items.length > 0 ? "---\n\n" : ""}`
}

function formatMessage(item: Item): string {
  const head = item.info.role === "user" ? "## User\n\n" : "## Assistant\n\n"
  return `${head}${item.parts.map((part) => formatPart(part)).join("")}`
}

function formatPart(part: Part): string {
  if (part.type === "text" && !part.synthetic) return `${part.text}\n\n`
  if (part.type === "tool") return formatToolPart(part)
  return ""
}

function formatToolPart(part: Extract<Part, { type: "tool" }>): string {
  const state = part.state
  const lines = [`**Tool: ${part.tool}**`, "", `Status: ${state.status}`]
  if (part.callID) lines.push(`Call ID: ${part.callID}`)
  if ("input" in state) lines.push(block("Input", json(state.input), "json"))
  if (state.status === "pending" && state.raw) lines.push(block("Raw request", preview(state.raw), "text"))
  if (state.status === "completed") {
    lines.push(block("Output preview", preview(state.output), "text"), ...toolOutputReferences(state.metadata))
  }
  if (state.status === "error") {
    lines.push(block("Error preview", preview(state.error), "text"), ...toolOutputReferences(state.metadata))
  }
  if (state.status === "running") lines.push(...toolOutputReferences(state.metadata))
  return `${lines.filter(Boolean).join("\n")}\n\n`
}

function block(label: string, content: string, language: string) {
  return `\n${label}:\n\n\`\`\`${language}\n${content}\n\`\`\``
}

function json(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function preview(text: string) {
  if (text.length <= TOOL_PREVIEW_LIMIT) return text
  const omitted = text.length - TOOL_PREVIEW_LIMIT
  return `${text.slice(0, TOOL_PREVIEW_LIMIT)}\n\n[Transcript export omitted ${omitted} chars from this tool field.]`
}

function toolOutputReferences(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return []
  const outputPath = typeof metadata.outputPath === "string" ? metadata.outputPath : undefined
  if (!outputPath) return []
  const lines = [`Full output sidecar: ${outputPath}`]
  const outputByteCount = metadata.outputByteCount
  if (typeof outputByteCount === "number" || typeof outputByteCount === "string") {
    lines.push(`Output bytes: ${outputByteCount}`)
  }
  if (typeof metadata.outputSha256 === "string") lines.push(`Output SHA-256: ${metadata.outputSha256}`)
  return lines
}
