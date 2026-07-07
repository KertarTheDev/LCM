// kilocode_change - new file
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { LcmRouteErrors, LcmSettingsStateSchema, LcmUpdateSettingsInput } from "./session"

const root = "/lcm"

export const LcmSettingsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  projectID: Schema.optional(Schema.String),
  workspaceID: Schema.optional(Schema.String),
})

export const LcmPaths = {
  settings: `${root}/settings`,
} as const

export const LcmApi = HttpApi.make("lcm").add(
  HttpApiGroup.make("lcm")
    .add(
      HttpApiEndpoint.get("settingsGet", LcmPaths.settings, {
        query: LcmSettingsQuery,
        success: described(LcmSettingsStateSchema, "LCM settings state"),
        error: LcmRouteErrors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "lcm.settings.get",
          summary: "Get LCM settings",
          description:
            "Get config-backed LCM settings for the current project or workspace without requiring a session.",
        }),
      ),
      HttpApiEndpoint.patch("settingsUpdate", LcmPaths.settings, {
        query: LcmSettingsQuery,
        payload: LcmUpdateSettingsInput,
        success: described(LcmSettingsStateSchema, "Updated LCM settings state"),
        error: LcmRouteErrors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "lcm.settings.update",
          summary: "Update LCM settings",
          description:
            "Update config-backed LCM settings for the current project or workspace without requiring a session.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "lcm",
        description: "LCM settings routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
