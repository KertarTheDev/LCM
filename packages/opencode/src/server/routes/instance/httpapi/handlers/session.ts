import { Image } from "@/image/image" // kilocode_change - classify user image validation defects
import { KiloSessionHttpApi } from "@/kilocode/server/httpapi/session-fork" // kilocode_change
// kilocode_change start
import * as InstanceState from "@/effect/instance-state" // kilocode_change - LCM settings/export use trusted instance context
// kilocode_change end
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
// kilocode_change start
import { lcmRouteErrorResponse, lcmRouteHttpStatus } from "@/session/lcm/route-errors"
import { Service as LcmRuntimeService } from "@/session/lcm/runtime"
import { createLcmSafeError, type LcmSafeError } from "@/session/lcm/types"
// kilocode_change end
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  // kilocode_change start
  LcmBadRequestError,
  LcmCancelMaintenanceInput,
  LcmConflictError,
  LcmDbRebuildInput,
  LcmForbiddenError,
  LcmNotFoundError,
  LcmServiceUnavailableError,
  LcmTimeoutError,
  LcmUpdateSettingsInput,
  // kilocode_change end
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
  ViewedPayload, // kilocode_change
} from "../groups/session"
import { PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const runState = yield* SessionRunState.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope
    // kilocode_change start
    const lcmRuntime = yield* LcmRuntimeService

    function createLcmRouteInvalidRequest(diagnosticCode: string) {
      return createLcmSafeError({
        code: "invalid_request",
        templateKey: "lcm.request.invalid",
        safeParams: {},
        retryable: false,
        diagnosticCode,
      })
    }

    function validateLcmSettingsAssertions(input: {
      assertedProjectID?: string
      assertedWorkspaceID?: string
      currentProjectID: string
      currentWorkspaceID?: string
    }) {
      if (input.assertedProjectID !== undefined && input.assertedProjectID !== input.currentProjectID) {
        return createLcmRouteInvalidRequest("lcm_settings_project_assertion_mismatch")
      }
      if (input.assertedWorkspaceID !== undefined && input.assertedWorkspaceID !== input.currentWorkspaceID) {
        return createLcmRouteInvalidRequest("lcm_settings_workspace_assertion_mismatch")
      }
      return undefined
    }

    function validateLcmSettingsPayloadKeys(payload: typeof LcmUpdateSettingsInput.Type) {
      const allowed = new Set([
        "sessionID",
        "projectID",
        "workspaceID",
        "strategy",
        "freshTailTokens",
        "storageWarningThresholdBytes",
      ])
      for (const key of Object.keys(payload)) {
        if (!allowed.has(key)) return createLcmRouteInvalidRequest("lcm_settings_unsupported_field")
      }
      return undefined
    }

    function validateLcmDbRebuildPayloadKeys(payload: typeof LcmDbRebuildInput.Type) {
      for (const key of Object.keys(payload)) {
        if (key !== "dryRun") return createLcmRouteInvalidRequest("lcm_db_rebuild_unsupported_field")
      }
      return undefined
    }

    function lcmHttpError(error: LcmSafeError) {
      const body = lcmRouteErrorResponse(error)
      switch (lcmRouteHttpStatus(error)) {
        case 403:
          return new LcmForbiddenError(body)
        case 404:
          return new LcmNotFoundError(body)
        case 409:
          return new LcmConflictError(body)
        case 503:
          return new LcmServiceUnavailableError(body)
        case 504:
          return new LcmTimeoutError(body)
        default:
          return new LcmBadRequestError(body)
      }
    }

    const mapLcmError = <A, E extends LcmSafeError, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((error) => lcmHttpError(error)))
    // kilocode_change end

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        }),
      )
    })

    const forkRaw = KiloSessionHttpApi.forkRaw(fork) // kilocode_change - carry upstream bodyless full-session fork support

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // kilocode_change start
    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })
    // kilocode_change end

    // kilocode_change start
    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* mapLcmError(
        Effect.gen(function* () {
          yield* lcmRuntime.getOrCreateConversation({ sessionID: ctx.params.sessionID })
          yield* lcmRuntime.syncFinalizedMessages({ sessionID: ctx.params.sessionID })
          const maintenance = yield* lcmRuntime.runManualMaintenance({
            sessionID: ctx.params.sessionID,
            reason: "manual",
            blocking: true,
            renderOptions: {
              providerID: ctx.payload.providerID,
              modelID: ctx.payload.modelID,
              providerMediaCapability: "unknown",
              stripMedia: false,
              taskCapabilityClass: "root",
              clockPolicy: "runtime_per_preparation",
            },
          })
          if (maintenance.safeError) return yield* Effect.fail(maintenance.safeError)
        }),
      )
      return true
    })
    // kilocode_change end

    // kilocode_change start
    const lcmCapabilities = Effect.fn("SessionHttpApi.lcmCapabilities")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const capabilities = yield* mapLcmError(lcmRuntime.getCapabilities({ sessionID: ctx.params.sessionID }))
      return { ...capabilities, sessionID: ctx.params.sessionID }
    })

    const lcmSettingsGet = Effect.fn("SessionHttpApi.lcmSettingsGet")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* mapLcmError(
        lcmRuntime.getSettingsState({
          sessionID: ctx.params.sessionID,
          projectID: instance.project.id,
          workspaceID,
        }),
      )
    })

    const lcmSettingsUpdate = Effect.fn("SessionHttpApi.lcmSettingsUpdate")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof LcmUpdateSettingsInput.Type
    }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const assertionError =
        validateLcmSettingsPayloadKeys(ctx.payload) ??
        (ctx.payload.sessionID && ctx.payload.sessionID !== ctx.params.sessionID
          ? createLcmRouteInvalidRequest("lcm_settings_path_body_session_mismatch")
          : validateLcmSettingsAssertions({
              assertedProjectID: ctx.payload.projectID,
              assertedWorkspaceID: ctx.payload.workspaceID,
              currentProjectID: instance.project.id,
              currentWorkspaceID: workspaceID,
            }))
      if (assertionError) return yield* Effect.fail(lcmHttpError(assertionError))
      return yield* mapLcmError(
        lcmRuntime.updateSettings({
          sessionID: ctx.params.sessionID,
          projectID: instance.project.id,
          workspaceID,
          strategy: ctx.payload.strategy,
          freshTailTokens: ctx.payload.freshTailTokens,
          storageWarningThresholdBytes: ctx.payload.storageWarningThresholdBytes,
        }),
      )
    })

    const lcmMaintenanceCancel = Effect.fn("SessionHttpApi.lcmMaintenanceCancel")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof LcmCancelMaintenanceInput.Type | typeof HttpApiSchema.NoContent.Type
    }) {
      const payload = ctx.payload && typeof ctx.payload === "object" && "reason" in ctx.payload ? ctx.payload : {}
      return yield* mapLcmError(
        lcmRuntime.cancelDeferredMaintenance({
          sessionID: ctx.params.sessionID,
          reason: payload.reason ?? "user",
        }),
      )
    })

    const lcmDbDiagnose = Effect.fn("SessionHttpApi.lcmDbDiagnose")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      return yield* mapLcmError(lcmRuntime.diagnoseDb({ sessionID: ctx.params.sessionID }))
    })

    const lcmDbRebuild = Effect.fn("SessionHttpApi.lcmDbRebuild")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof LcmDbRebuildInput.Type
    }) {
      const assertionError = validateLcmDbRebuildPayloadKeys(ctx.payload)
      if (assertionError) return yield* Effect.fail(lcmHttpError(assertionError))
      return yield* mapLcmError(
        lcmRuntime.rebuildDb({
          sessionID: ctx.params.sessionID,
          dryRun: ctx.payload.dryRun ?? true,
        }),
      )
    })

    const lcmDbRebuildRaw = Effect.fn("SessionHttpApi.lcmDbRebuildRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* lcmDbRebuild({ params: ctx.params, payload: {} })

      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => lcmHttpError(createLcmRouteInvalidRequest("lcm_db_rebuild_invalid_payload")),
      })
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return yield* Effect.fail(lcmHttpError(createLcmRouteInvalidRequest("lcm_db_rebuild_invalid_payload")))
      }
      const unsupportedKey = Object.keys(json).find((key) => key !== "dryRun")
      if (unsupportedKey) {
        return yield* Effect.fail(lcmHttpError(createLcmRouteInvalidRequest("lcm_db_rebuild_unsupported_field")))
      }
      const payload = yield* Schema.decodeUnknownEffect(LcmDbRebuildInput)(json).pipe(
        Effect.mapError(() => lcmHttpError(createLcmRouteInvalidRequest("lcm_db_rebuild_invalid_payload"))),
      )
      return yield* lcmDbRebuild({ params: ctx.params, payload })
    })

    const lcmPromptsExport = Effect.fn("SessionHttpApi.lcmPromptsExport")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const instance = yield* InstanceState.context
      return yield* mapLcmError(
        lcmRuntime.exportPrompts({
          sessionID: ctx.params.sessionID,
          workspaceRoot: instance.directory,
        }),
      )
    })

    // kilocode_change end
    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const message = yield* promptSvc
        .prompt({ ...ctx.payload, sessionID: ctx.params.sessionID } as unknown as SessionPrompt.PromptInput) // kilocode_change
        .pipe(
          // kilocode_change start - reject only typed user image validation defects as request errors
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            if (
              error instanceof Image.InvalidDataUrlError ||
              error instanceof Image.DecodeError ||
              error instanceof Image.SizeError
            )
              return Effect.fail(new HttpApiError.BadRequest({}))
            return Effect.die(error)
          }),
          // kilocode_change end
        )
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      // kilocode_change start - cast to bridge schema-readonly to PromptInput mutable; matches legacy Hono session.ts
      yield* promptSvc
        .prompt({ ...ctx.payload, sessionID: ctx.params.sessionID } as unknown as SessionPrompt.PromptInput)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logError("prompt_async failed").pipe(
                Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
              )
              yield* bus.publish(Session.Event.Error, {
                sessionID: ctx.params.sessionID,
                error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
              })
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      // kilocode_change end
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }).pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    // kilocode_change start
    const viewed = Effect.fn("SessionHttpApi.viewed")(function* (ctx: { payload: typeof ViewedPayload.Type }) {
      const { KiloSessions } = yield* Effect.promise(() => import("@/kilo-sessions/kilo-sessions"))
      KiloSessions.setViewedSessions({ focused: ctx.payload.focused ?? [], open: ctx.payload.open ?? [] })
      return true
    })
    // kilocode_change end

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      // kilocode_change start
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw) // carry upstream bodyless full-session fork support
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("lcmCapabilities", lcmCapabilities)
      .handle("lcmSettingsGet", lcmSettingsGet)
      .handle("lcmSettingsUpdate", lcmSettingsUpdate)
      .handle("lcmMaintenanceCancel", lcmMaintenanceCancel)
      .handle("lcmDbDiagnose", lcmDbDiagnose)
      .handleRaw("lcmDbRebuild", lcmDbRebuildRaw)
      .handle("lcmPromptsExport", lcmPromptsExport)
      // kilocode_change end
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
      .handle("viewed", viewed) // kilocode_change
  }),
)
