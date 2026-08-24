import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { sha256, sourceID } from "./ids"
import type { FinalSource, SourceKind } from "./types"

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

/**
 * MessageV2.stream() pages the Kilo transcript newest-first. LCM has exactly
 * one ordering boundary so callers, legacy sessions, imports, and tests all
 * receive the same oldest-first source chronology.
 */
export function normalizeTranscriptChronology(messages: WithParts[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .toSorted(
      (a, b) =>
        a.message.info.time.created - b.message.info.time.created ||
        a.message.info.id.localeCompare(b.message.info.id) ||
        a.index - b.index,
    )
    .map((item) => item.message)
}

/**
 * A retained successful assistant response is durable proof that every earlier
 * message in that transcript was consumed by a provider. This bootstraps a
 * rebuilt sidecar conservatively without treating the response's own parts as
 * consumed.
 */
export function bootstrapConsumedThrough(sessionID: string, messages: WithParts[], sources: FinalSource[]) {
  const ordered = normalizeTranscriptChronology(messages).filter((message) => message.info.sessionID === sessionID)
  const proof = ordered.findLastIndex(
    (message) =>
      message.info.role === "assistant" &&
      message.info.summary !== true &&
      !message.info.error &&
      Boolean(message.info.finish) &&
      isFinal(message),
  )
  if (proof <= 0) return -1
  const consumedMessages = new Set<string>(ordered.slice(0, proof).map((message) => message.info.id))
  return sources.findLast((source) => consumedMessages.has(source.messageID))?.ordinal ?? -1
}

export function replacementBootstrapConsumedThrough(input: {
  sessionID: string
  messages: WithParts[]
  previousSources: FinalSource[]
  sources: FinalSource[]
  hadPreviousLineage: boolean
}) {
  const strictAppend =
    input.hadPreviousLineage &&
    input.previousSources.length <= input.sources.length &&
    input.previousSources.every(
      (source, index) =>
        source.id === input.sources[index]?.id &&
        source.digest === input.sources[index]?.digest &&
        source.ordinal === input.sources[index]?.ordinal,
    )
  if (strictAppend) return -1
  return bootstrapConsumedThrough(input.sessionID, input.messages, input.sources)
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
  for (const message of normalizeTranscriptChronology(messages)) {
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
