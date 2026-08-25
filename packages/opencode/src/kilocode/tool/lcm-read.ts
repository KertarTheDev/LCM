import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { inertOutput, LcmToolError, loadMemory, requireSource } from "./lcm-common"

const Parameters = Schema.Struct({
  sourceID: Schema.String.annotate({ description: "Exact current-session src_ source handle." }),
  maxBytes: Schema.optional(Schema.Number).annotate({
    description: "Maximum UTF-8 bytes to return (default 8192, maximum 32768).",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Optional UTF-8 byte offset, such as a byteRange start returned by lcm_grep.",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque nextCursor from the preceding read of this source; mutually exclusive with offset.",
  }),
})

export function textChunk(value: string, offset: number, limit: number) {
  const buffer = Buffer.from(value)
  let end = Math.min(buffer.byteLength, offset + limit)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  while (end > offset) {
    try {
      return { content: decoder.decode(buffer.subarray(offset, end)), end, total: buffer.byteLength }
    } catch {
      end--
    }
  }
  return { content: "", end: offset, total: buffer.byteLength }
}

export function validUtf8Offset(value: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) return false
  const buffer = Buffer.from(value)
  if (offset > buffer.byteLength) return false
  return offset === buffer.byteLength || (buffer[offset]! & 0xc0) !== 0x80
}

export const LcmReadTool = Tool.define(
  "lcm_read",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    return {
      description:
        "Read a bounded digest-verified byte range from one exact current-session conversation source. Start at a lcm_grep byteRange with offset, or continue sequentially with nextCursor.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_read",
            patterns: [params.sourceID],
            always: ["*"],
            metadata: { sourceID: params.sourceID },
          })
          const view = yield* loadMemory({ sessionID: ctx.sessionID, signal: ctx.abort, memory, database })
          const { source, content } = requireSource(view, params.sourceID)
          if (params.maxBytes !== undefined && !Number.isFinite(params.maxBytes))
            throw new LcmToolError("lcm_unavailable", "The source byte limit must be a finite number.")
          const maxBytes = Math.min(32 * 1024, Math.max(1, Math.floor(params.maxBytes ?? 8 * 1024)))
          if (params.offset !== undefined && (!Number.isSafeInteger(params.offset) || params.offset < 0))
            throw new LcmToolError("lcm_invalid_cursor", "The source byte offset must be a non-negative integer.")
          if (params.offset !== undefined && params.cursor)
            throw new LcmToolError("lcm_invalid_cursor", "Use either a source byte offset or a cursor, not both.")
          const query = { sourceID: source.id, digest: source.digest, maxBytes }
          let offset: number
          if (params.offset !== undefined) {
            offset = params.offset
          } else {
            try {
              offset = decodeCursor(query, params.cursor)
            } catch {
              throw new LcmToolError("lcm_invalid_cursor", "The cursor does not belong to this source read.")
            }
          }
          if (content.immutableMedia) {
            if (offset !== 0) throw new LcmToolError("lcm_invalid_cursor", "Media sources do not use byte cursors.")
            const media = content.immutableMedia
            const result = {
              kind: "media",
              sourceID: source.id,
              mediaType: media.mediaType,
              totalBytes: media.bytes.byteLength,
              digest: source.digest,
              ...(media.filename ? { filename: media.filename } : {}),
              attached: true,
              content: "The verified persisted media is attached through Kilo's normal tool-result channel.",
            }
            return {
              title: `Read Conversation Memory: ${source.id}`,
              output: inertOutput(result),
              metadata: { bytes: media.bytes.byteLength, truncated: false },
              attachments: [
                {
                  type: "file" as const,
                  mime: media.mediaType,
                  url: `data:${media.mediaType};base64,${Buffer.from(media.bytes).toString("base64")}`,
                  ...(media.filename ? { filename: media.filename } : {}),
                },
              ],
            }
          }
          if (!validUtf8Offset(content.content, offset))
            throw new LcmToolError("lcm_invalid_cursor", "The source byte offset is not a UTF-8 boundary.")
          const chunk = textChunk(content.content, offset, maxBytes)
          const result = {
            kind: "text",
            sourceID: source.id,
            mediaType: source.mediaType ?? "text/plain",
            offset,
            bytesReturned: chunk.end - offset,
            totalBytes: chunk.total,
            digest: source.digest,
            content: chunk.content,
            ...(chunk.end < chunk.total ? { nextCursor: encodeCursor(query, chunk.end) } : {}),
          }
          return {
            title: `Read Conversation Memory: ${source.id}`,
            output: inertOutput(result),
            metadata: { bytes: result.bytesReturned, truncated: chunk.end < chunk.total },
          }
        }),
    }
  }),
)
