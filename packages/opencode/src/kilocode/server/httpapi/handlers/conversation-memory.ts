import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import * as ConversationMemoryFeature from "@/kilocode/session/lcm/feature"
import { Config } from "@/config/config"
import { createContextExport } from "@/kilocode/session/lcm/context-export"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import * as ApiError from "@/server/routes/instance/httpapi/errors"
import { ConversationMemoryActivityQuery } from "../groups/conversation-memory"

export const conversationMemoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "conversation-memory", (handlers) =>
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const sessions = yield* Session.Service
    const config = yield* Config.Service

    const requireEnabled = () =>
      config.get().pipe(
        Effect.flatMap((cfg) =>
          ConversationMemoryFeature.enabled(cfg)
            ? Effect.void
            : Effect.fail(
                new ApiError.ConflictError({
                  message: ConversationMemoryFeature.DISABLED_MESSAGE,
                  resource: "conversation-memory",
                }),
              ),
        ),
      )

    const current = (sessionID: string) =>
      sessions.get(SessionID.make(sessionID)).pipe(Effect.mapError((error) => ApiError.notFound(error.message)))

    const status = Effect.fn("ConversationMemoryHttpApi.status")(function* (ctx: { params: { sessionID: string } }) {
      yield* requireEnabled()
      yield* current(ctx.params.sessionID)
      return yield* memory.status(ctx.params.sessionID)
    })

    const activity = Effect.fn("ConversationMemoryHttpApi.activity")(function* (ctx: {
      params: { sessionID: string }
      query: typeof ConversationMemoryActivityQuery.Type
    }) {
      yield* requireEnabled()
      yield* current(ctx.params.sessionID)
      const limit = Math.min(100, Math.max(1, Math.floor(ctx.query.limit ?? 50)))
      const query = { sessionID: ctx.params.sessionID, limit }
      const before = yield* Effect.try({
        try: () => decodeCursor(query, ctx.query.cursor),
        catch: () => new HttpApiError.BadRequest({}),
      })
      const items = yield* memory.activity(ctx.params.sessionID, {
        ...(before === 0 ? {} : { before }),
        limit: limit + 1,
      })
      const page = items.slice(0, limit)
      const last = page.at(-1)?.sequence
      return {
        items: page,
        ...(items.length > limit && last !== undefined ? { nextCursor: encodeCursor(query, last) } : {}),
      }
    })

    return handlers
      .handle("status", status)
      .handle("activity", activity)
      .handleRaw("export", (ctx) =>
        Effect.gen(function* () {
          yield* requireEnabled()
          yield* current(ctx.params.sessionID)
          const access = yield* memory.access(ctx.params.sessionID)
          if (!access) {
            return HttpServerResponse.text("Conversation Memory export is temporarily unavailable.", {
              status: 503,
            })
          }
          const output = yield* Effect.tryPromise({
            try: () => createContextExport({ sessionID: ctx.params.sessionID, store: access.store }),
            catch: () => new HttpApiError.ServiceUnavailable({}),
          })
          return HttpServerResponse.uint8Array(output.bytes, {
            contentType: "application/zip",
            headers: {
              "access-control-expose-headers":
                "Content-Disposition, X-LCM-Export-ID, X-LCM-Frame-Count, X-Content-SHA256",
              "content-disposition": `attachment; filename="${output.filename}"`,
              "x-content-sha256": output.digest,
              "x-lcm-export-id": output.id,
              "x-lcm-frame-count": String(output.frameCount),
            },
          })
        }),
      )
  }),
)
