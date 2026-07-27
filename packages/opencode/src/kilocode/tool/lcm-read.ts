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
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque nextCursor from the preceding read of this source.",
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

export const LcmReadTool = Tool.define(
  "lcm_read",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    return {
      description: "Read a bounded digest-verified byte range from one exact current-session conversation source.",
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
          const maxBytes = Math.min(32 * 1024, Math.max(1, Math.floor(params.maxBytes ?? 8 * 1024)))
          const query = { sourceID: source.id, digest: source.digest, maxBytes }
          let offset: number
          try {
            offset = decodeCursor(query, params.cursor)
          } catch {
            throw new LcmToolError("lcm_invalid_cursor", "The cursor does not belong to this source read.")
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
          const chunk = textChunk(content.content, offset, maxBytes)
          if (offset > chunk.total) throw new LcmToolError("lcm_invalid_cursor", "The source cursor is out of range.")
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
