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
    description:
      "Optional UTF-8 byte offset copied from a byteRange start in lcm_grep or nextOffset from lcm_read. Do not calculate it from returned content length.",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description:
      "Opaque nextCursor returned by the immediately preceding page of this source. Prefer returned nextOffset when copying an opaque cursor is error-prone. Never reuse the cursor just consumed. Mutually exclusive with offset; maxBytes may change between pages.",
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

export function resolveTextReadOffset(value: string, requestedOffset: number) {
  const total = Buffer.byteLength(value)
  return {
    offset: Math.min(requestedOffset, total),
    total,
    adjusted: requestedOffset > total,
  }
}

export function readCursorQuery(source: { id: string; digest: string }) {
  return { sourceID: source.id, digest: source.digest }
}

export function readContinuation(end: number, total: number) {
  const complete = end >= total
  return {
    complete,
    nextOffset: complete ? null : end,
    ...(complete
      ? {
          advice: [
            "This read reached the end of the source. nextOffset and nextCursor are null; do not calculate or retry another offset for this source.",
          ],
        }
      : {
          advice: [
            "For the next contiguous page, use nextOffset or nextCursor; never repeat the cursor or offset just consumed. Prefer targeted lcm_grep or lcm_expand_query recovery over scanning an entire large source page by page.",
          ],
        }),
  }
}

export const LcmReadTool = Tool.define(
  "lcm_read",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    return {
      description:
        "Read a bounded digest-verified exact excerpt from one current-session src_ source. Seek directly with a structural or lcm_grep byteRange start. For aggregation or cross-source questions, prefer lcm_expand_query or lcm_grep over sequential 32 KiB scans. To continue a necessary contiguous read, copy returned nextOffset or nextCursor; never calculate an offset from content length or repeat one just consumed. When complete is true, both continuations are null: stop reading that source. Recent ordinary context is already visible and does not need recovery reads.",
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
          const query = readCursorQuery(source)
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
          const requestedOffset = offset
          const resolvedOffset = resolveTextReadOffset(content.content, requestedOffset)
          offset = resolvedOffset.offset
          if (!validUtf8Offset(content.content, offset))
            throw new LcmToolError(
              "lcm_invalid_cursor",
              "The source byte offset is not a UTF-8 boundary. Copy nextOffset/nextCursor from lcm_read or a byteRange start from lcm_grep; do not probe nearby offsets.",
            )
          const chunk = textChunk(content.content, offset, maxBytes)
          const continuation = readContinuation(chunk.end, chunk.total)
          const result = {
            kind: "text",
            sourceID: source.id,
            mediaType: source.mediaType ?? "text/plain",
            offset,
            ...(resolvedOffset.adjusted
              ? { requestedOffset, adjustedOffsetReason: "past_source_end" as const }
              : {}),
            bytesReturned: chunk.end - offset,
            totalBytes: chunk.total,
            digest: source.digest,
            content: chunk.content,
            ...continuation,
            nextCursor: chunk.end < chunk.total ? encodeCursor(query, chunk.end) : null,
            ...(resolvedOffset.adjusted
              ? {
                  advice: [
                    "The requested offset was past totalBytes and was clamped to the source end. This source is complete; do not retry nearby offsets. Use focused search or a different source.",
                  ],
                }
              : {}),
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
