import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { sha256, sourceID } from "./ids"
import type { FinalSource, SourceKind } from "./types"

const LCM_TOOLS = new Set(["lcm_grep", "lcm_describe", "lcm_expand", "lcm_read"])
const EXCERPT_BYTES = 320

type WithParts = SessionV1.WithParts
type Part = SessionV1.Part

interface ExtractedSource {
  metadata: FinalSource
  content: string
  immutableMedia?: ImmutableMedia
}

interface ImmutableMedia {
  bytes: Uint8Array
  mediaType: string
  filename?: string
}

function bytes(value: string) {
  return Buffer.byteLength(value)
}

function tokens(value: string) {
  return Math.max(1, Math.ceil(bytes(value) / 4))
}

function excerpt(value: string) {
  const encoded = Buffer.from(value)
  if (encoded.byteLength <= EXCERPT_BYTES) return value
  return `${encoded
    .subarray(0, EXCERPT_BYTES)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "")}…`
}

function stringify(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)
}

function toolContent(part: Extract<Part, { type: "tool" }>) {
  const input = stringify(part.state.input)
  if (part.state.status === "completed") {
    return [`Tool: ${part.tool}`, `Input:\n${input}`, `Result:\n${part.state.output}`].join("\n\n")
  }
  if (part.state.status === "error") {
    const recovered = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
    return [
      `Tool: ${part.tool}`,
      `Input:\n${input}`,
      typeof recovered === "string" ? `Result:\n${recovered}` : `Error:\n${part.state.error}`,
    ].join("\n\n")
  }
}

function fileContent(part: Extract<Part, { type: "file" }>) {
  const header = `[Attached ${part.mime}: ${part.filename ?? "file"}]`
  if (!part.url.startsWith("data:")) return { content: header }
  const comma = part.url.indexOf(",")
  if (comma === -1) return { content: header }
  const metadata = part.url.slice(0, comma)
  const body = part.url.slice(comma + 1)
  const raw = metadata.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body))
  if (part.mime.startsWith("text/") || part.mime === "application/json") {
    return { content: `${header}\n${raw.toString("utf8")}` }
  }
  return {
    content: header,
    immutableMedia: {
      bytes: new Uint8Array(raw),
      mediaType: part.mime,
      ...(part.filename ? { filename: part.filename } : {}),
    },
  }
}

function partContent(part: Part):
  | {
      kind: SourceKind
      content: string
      mediaType?: string
      filename?: string
      immutableMedia?: ImmutableMedia
    }
  | undefined {
  if (part.type === "text") {
    if (part.ignored || part.text === "") return
    return { kind: "user_text", content: part.text }
  }
  if (part.type === "reasoning") {
    if (part.text.trim() === "") return
    return { kind: "reasoning", content: part.text }
  }
  if (part.type === "tool") {
    if (LCM_TOOLS.has(part.tool)) return
    const content = toolContent(part)
    if (!content) return
    return { kind: "tool", content }
  }
  if (part.type === "file") {
    const next = fileContent(part)
    return {
      kind: next.immutableMedia ? "media" : "attachment",
      content: next.content,
      mediaType: part.mime,
      ...(part.filename ? { filename: part.filename } : {}),
      ...(next.immutableMedia ? { immutableMedia: next.immutableMedia } : {}),
    }
  }
}

function isFinal(message: WithParts) {
  if (message.info.role === "user") return true
  if (message.info.summary) return false
  if (!message.info.finish && !message.info.error) return false
  return !message.parts.some(
    (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
  )
}

export function extractFinalSources(sessionID: string, messages: WithParts[]) {
  const result: ExtractedSource[] = []
  let ordinal = 0
  for (const message of messages) {
    if (message.info.sessionID !== sessionID || !isFinal(message)) continue
    if (message.info.role === "assistant" && message.info.summary) continue
    for (const part of message.parts) {
      if (part.type === "compaction" || part.type === "subtask") continue
      const next = partContent(part)
      if (!next) continue
      const kind =
        next.kind === "user_text" && message.info.role === "assistant" ? ("assistant_text" as const) : next.kind
      const digest = sha256(next.immutableMedia?.bytes ?? next.content)
      const id = sourceID({
        sessionID,
        messageID: message.info.id,
        partID: part.id,
        kind,
        digest,
      })
      result.push({
        metadata: {
          id,
          sessionID,
          messageID: message.info.id,
          partID: part.id,
          ordinal,
          kind,
          digest,
          tokens: tokens(next.content),
          bytes: next.immutableMedia?.bytes.byteLength ?? bytes(next.content),
          excerpt: excerpt(next.content),
          ...(next.mediaType ? { mediaType: next.mediaType } : {}),
          ...(next.filename ? { filename: next.filename } : {}),
        },
        content: next.content,
        ...(next.immutableMedia ? { immutableMedia: next.immutableMedia } : {}),
      })
      ordinal++
    }
  }
  return result
}
