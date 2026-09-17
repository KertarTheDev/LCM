import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import {
  completedToolCallHistory,
  currentTurnRecoveryCallCount,
  inertOutput,
  isolatedRecoveryPriorTurnCutoff,
  lcmMemorySessionID,
  LcmToolError,
  loadMemory,
  recoveryCallGuidance,
  repeatedRecoveryResult,
  reserveRecoveryBatchCall,
  requireIsolatedRecoverySource,
  requireSource,
  sourceChronology,
} from "./lcm-common"

const Parameters = Schema.Struct({
  sourceID: Schema.String.annotate({ description: "Exact current-session src_ source handle." }),
  maxBytes: Schema.optional(Schema.Number).annotate({
    description: "Maximum UTF-8 bytes to return (default 8192, maximum 32768).",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description:
      "Optional UTF-8 byte offset copied from a byteRange start in lcm_grep or nextOffset from lcm_read. Do not calculate it from returned content length.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description:
      "Optional exclusive UTF-8 byte bound copied from a structural closing marker. It prevents a read from crossing past the intended semantic interval and remains bound to continuation cursors.",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description:
      "Opaque nextCursor returned by the immediately preceding page of this source. Prefer returned nextOffset when copying an opaque cursor is error-prone. Never reuse the cursor just consumed. Mutually exclusive with offset; maxBytes may change between pages, while endOffset must remain identical.",
  }),
})

type LcmReadMetadata = {
  bytes: number
  repeatedInput: boolean
  duplicatePayloadSuppressed?: boolean
  truncated: boolean
  lcmResult?: Record<string, unknown>
}

export function textChunk(value: string, offset: number, limit: number, endOffset?: number) {
  const buffer = Buffer.from(value)
  const rangeEnd = Math.min(buffer.byteLength, endOffset ?? buffer.byteLength)
  let end = Math.min(rangeEnd, offset + limit)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  while (end > offset) {
    try {
      return { content: decoder.decode(buffer.subarray(offset, end)), end, total: buffer.byteLength, rangeEnd }
    } catch {
      end--
    }
  }
  return { content: "", end: offset, total: buffer.byteLength, rangeEnd }
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

export function readCursorQuery(source: { id: string; digest: string }, endOffset?: number) {
  return { sourceID: source.id, digest: source.digest, endOffset }
}

export function readContinuation(end: number, total: number, rangeEnd = total) {
  const complete = end >= rangeEnd
  const bounded = rangeEnd < total
  return {
    complete,
    nextOffset: complete ? null : end,
    ...(complete
      ? {
          advice: [
            bounded
              ? "This read reached the requested exclusive endOffset. nextOffset and nextCursor are null; do not read beyond that verified interval for the current semantic unit."
              : "This read reached the end of this transport source, not necessarily the end of a document, episode, section, or other semantic unit. nextOffset and nextCursor are null; do not retry this source. If verified boundaries show the unit continues, follow chronology.nextNonReceiptSource at offset 0.",
          ],
        }
      : {
          advice: [
            bounded
              ? "For the next contiguous page, keep the same endOffset and use nextOffset or nextCursor; never repeat the cursor or offset just consumed."
              : "For the next contiguous page, use nextOffset or nextCursor; never repeat the cursor or offset just consumed. Prefer targeted lcm_grep or lcm_expand_query recovery over scanning an entire large source page by page.",
          ],
        }),
  }
}

export const LcmReadTool = Tool.define(
  "lcm_read",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    const definition: Tool.DefWithoutID<typeof Parameters, LcmReadMetadata> = {
      description:
        "Targeted verbatim verification from one current-session src_ transport source. A source is never proof of a complete document, section, or other semantic unit. Seek directly with a structural or lcm_grep byteRange start, and pass the matching structural close as endOffset when the unit ends in this source so the read cannot cross it. For semantic interpretation, aggregation, or cross-source questions, prefer one focused lcm_expand_query over sequential 32 KiB scans. To continue within this interval, copy returned nextOffset or nextCursor; never calculate an offset from content length or repeat one just consumed. When complete is true, both continuations are null for the requested interval. Recent ordinary context is already visible and does not need recovery reads.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "lcm_read",
            patterns: [params.sourceID],
            always: ["*"],
            metadata: { sourceID: params.sourceID },
          })
          const history = completedToolCallHistory(ctx.messages, "lcm_read", params)
          const view = yield* loadMemory({
            sessionID: lcmMemorySessionID(ctx),
            signal: ctx.abort,
            memory,
            database,
          })
          const { source, content } = requireSource(view, params.sourceID)
          requireIsolatedRecoverySource(ctx, view, source)
          const chronology = sourceChronology(view, source.id, isolatedRecoveryPriorTurnCutoff(ctx, view))
          const batch = reserveRecoveryBatchCall(ctx.messages, "lcm_read", params)
          const previousIdenticalCalls = history.count + batch.previousIdenticalCalls
          const completedRecoveryCalls = currentTurnRecoveryCallCount(ctx.messages) + batch.batchCallNumber
          const callGuidance = recoveryCallGuidance({
            tool: "lcm_read",
            previousIdenticalCalls,
            sourceScoped: true,
            completedRecoveryCalls,
          })
          if (params.maxBytes !== undefined && !Number.isFinite(params.maxBytes))
            throw new LcmToolError("lcm_unavailable", "The source byte limit must be a finite number.")
          const maxBytes = Math.min(32 * 1024, Math.max(1, Math.floor(params.maxBytes ?? 8 * 1024)))
          if (params.offset !== undefined && (!Number.isSafeInteger(params.offset) || params.offset < 0))
            throw new LcmToolError("lcm_invalid_cursor", "The source byte offset must be a non-negative integer.")
          if (params.endOffset !== undefined && (!Number.isSafeInteger(params.endOffset) || params.endOffset < 0))
            throw new LcmToolError("lcm_invalid_cursor", "The source end offset must be a non-negative integer.")
          if (params.offset !== undefined && params.cursor)
            throw new LcmToolError("lcm_invalid_cursor", "Use either a source byte offset or a cursor, not both.")
          const query = readCursorQuery(source, params.endOffset)
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
          const repeated = repeatedRecoveryResult({
            tool: "lcm_read",
            previousIdenticalCalls,
            sourceScoped: true,
            completedRecoveryCalls,
            priorResult: history.priorResult,
          })
          if (content.immutableMedia) {
            if (offset !== 0 || params.endOffset !== undefined)
              throw new LcmToolError("lcm_invalid_cursor", "Media sources do not use byte bounds or cursors.")
            if (repeated)
              return {
                title: `Repeated Conversation Memory read suppressed: ${source.id}`,
                output: inertOutput({ ...repeated, chronology, sourceID: source.id, sourceKind: source.kind }),
                metadata: { bytes: 0, repeatedInput: true, duplicatePayloadSuppressed: true, truncated: false },
              }
            const media = content.immutableMedia
            const result = {
              callGuidance,
              chronology,
              kind: "media",
              sourceID: source.id,
              sourceKind: source.kind,
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
              metadata: {
                bytes: media.bytes.byteLength,
                repeatedInput: previousIdenticalCalls > 0,
                truncated: false,
                lcmResult: {
                  kind: "media",
                  sourceID: source.id,
                  sourceKind: source.kind,
                  totalBytes: media.bytes.byteLength,
                  attached: true,
                },
              },
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
          if (params.endOffset !== undefined) {
            if (!validUtf8Offset(content.content, params.endOffset))
              throw new LcmToolError(
                "lcm_invalid_cursor",
                "The source end offset is outside the source or is not a UTF-8 boundary. Copy it from a structural or lcm_grep byte range.",
              )
            if (requestedOffset > params.endOffset)
              throw new LcmToolError("lcm_invalid_cursor", "The source offset must not exceed endOffset.")
          }
          const resolvedOffset = resolveTextReadOffset(content.content, requestedOffset)
          offset = resolvedOffset.offset
          if (!validUtf8Offset(content.content, offset))
            throw new LcmToolError(
              "lcm_invalid_cursor",
              "The source byte offset is not a UTF-8 boundary. Copy nextOffset/nextCursor from lcm_read or a byteRange start from lcm_grep; do not probe nearby offsets.",
            )
          if (repeated)
            return {
              title: `Repeated Conversation Memory read suppressed: ${source.id}`,
              output: inertOutput({ ...repeated, chronology, sourceID: source.id, sourceKind: source.kind }),
              metadata: { bytes: 0, repeatedInput: true, duplicatePayloadSuppressed: true, truncated: false },
            }
          const chunk = textChunk(content.content, offset, maxBytes, params.endOffset)
          const continuation = readContinuation(chunk.end, chunk.total, chunk.rangeEnd)
          const result = {
            callGuidance,
            chronology,
            kind: "text",
            sourceID: source.id,
            sourceKind: source.kind,
            mediaType: source.mediaType ?? "text/plain",
            offset,
            ...(resolvedOffset.adjusted ? { requestedOffset, adjustedOffsetReason: "past_source_end" as const } : {}),
            bytesReturned: chunk.end - offset,
            totalBytes: chunk.total,
            ...(params.endOffset !== undefined
              ? {
                  scope: {
                    kind: "bounded_source_interval" as const,
                    startOffset: offset,
                    endOffset: params.endOffset,
                  },
                }
              : {}),
            ...continuation,
            nextCursor: chunk.end < chunk.rangeEnd ? encodeCursor(query, chunk.end) : null,
            ...(resolvedOffset.adjusted
              ? {
                  advice: [
                    ...continuation.advice,
                    "The requested offset was past totalBytes and was clamped to the source end. This source is complete; do not retry nearby offsets. Use focused search or a different source.",
                  ],
                }
              : {}),
            digest: source.digest,
            content: chunk.content,
          }
          return {
            title: `Read Conversation Memory: ${source.id}`,
            output: inertOutput(result),
            metadata: {
              bytes: result.bytesReturned,
              repeatedInput: previousIdenticalCalls > 0,
              truncated: chunk.end < chunk.rangeEnd,
              lcmResult: {
                kind: "text",
                sourceID: source.id,
                sourceKind: source.kind,
                offset: result.offset,
                bytesReturned: result.bytesReturned,
                totalBytes: result.totalBytes,
                complete: result.complete,
                nextOffset: result.nextOffset,
                ...(result.scope ? { scope: result.scope } : {}),
              },
            },
          }
        }),
    }
    return definition
  }),
)
