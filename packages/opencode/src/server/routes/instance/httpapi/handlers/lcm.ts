// kilocode_change - new file
import * as InstanceState from "@/effect/instance-state"
import { Service as LcmRuntimeService } from "@/session/lcm/runtime"
import { lcmRouteErrorResponse, lcmRouteHttpStatus } from "@/session/lcm/route-errors"
import { createLcmSafeError, type LcmSafeError } from "@/session/lcm/types"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  LcmBadRequestError,
  LcmConflictError,
  LcmForbiddenError,
  LcmNotFoundError,
  LcmServiceUnavailableError,
  LcmTimeoutError,
  LcmUpdateSettingsInput,
} from "../groups/session"
import { LcmSettingsQuery } from "../groups/lcm"

export const lcmHandlers = HttpApiBuilder.group(InstanceHttpApi, "lcm", (handlers) =>
  Effect.gen(function* () {
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

    const settingsGet = Effect.fn("LcmHttpApi.settingsGet")(function* (ctx: { query: typeof LcmSettingsQuery.Type }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const assertionError = validateLcmSettingsAssertions({
        assertedProjectID: ctx.query.projectID,
        assertedWorkspaceID: ctx.query.workspaceID,
        currentProjectID: instance.project.id,
        currentWorkspaceID: workspaceID,
      })
      if (assertionError) return yield* Effect.fail(lcmHttpError(assertionError))
      return yield* mapLcmError(
        lcmRuntime.getSettingsState({
          projectID: instance.project.id,
          workspaceID,
        }),
      )
    })

    const settingsUpdate = Effect.fn("LcmHttpApi.settingsUpdate")(function* (ctx: {
      query: typeof LcmSettingsQuery.Type
      payload: typeof LcmUpdateSettingsInput.Type
    }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const assertionError =
        validateLcmSettingsPayloadKeys(ctx.payload) ??
        (ctx.payload.sessionID !== undefined
          ? createLcmRouteInvalidRequest("lcm_settings_primary_route_session_id_unsupported")
          : validateLcmSettingsAssertions({
              assertedProjectID: ctx.payload.projectID ?? ctx.query.projectID,
              assertedWorkspaceID: ctx.payload.workspaceID ?? ctx.query.workspaceID,
              currentProjectID: instance.project.id,
              currentWorkspaceID: workspaceID,
            }))
      if (assertionError) return yield* Effect.fail(lcmHttpError(assertionError))
      return yield* mapLcmError(
        lcmRuntime.updateSettings({
          projectID: instance.project.id,
          workspaceID,
          strategy: ctx.payload.strategy,
          freshTailTokens: ctx.payload.freshTailTokens,
          storageWarningThresholdBytes: ctx.payload.storageWarningThresholdBytes,
        }),
      )
    })

    return handlers.handle("settingsGet", settingsGet).handle("settingsUpdate", settingsUpdate)
  }),
)
