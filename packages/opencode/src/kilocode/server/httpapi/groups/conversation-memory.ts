import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { ApiNotFoundError, ConflictError } from "@/server/routes/instance/httpapi/errors"
import * as Contract from "@/kilocode/session/lcm/contracts"
import "@/kilocode/session/lcm/events"

export const ConversationMemoryPaths = {
  status: "/session/:sessionID/lcm/status",
  activity: "/session/:sessionID/lcm/activity",
  export: "/session/:sessionID/lcm/context/export",
} as const

export const ConversationMemoryActivityQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})

export const ConversationMemoryApi = HttpApi.make("conversation-memory")
  .add(
    HttpApiGroup.make("conversation-memory")
      .add(
        HttpApiEndpoint.get("status", ConversationMemoryPaths.status, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Contract.Status, "Conversation Memory status"),
          error: [ConflictError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "conversationMemory.status",
            summary: "Get conversation context status",
            description: "Return current context pressure, composition, background work, and memory-work usage.",
          }),
        ),
        HttpApiEndpoint.get("activity", ConversationMemoryPaths.activity, {
          params: { sessionID: SessionID },
          query: ConversationMemoryActivityQuery,
          success: described(Contract.ActivityPage, "Conversation Memory activity"),
          error: [HttpApiError.BadRequest, ConflictError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "conversationMemory.activity",
            summary: "List conversation context activity",
            description: "Return a cursor-paged timeline of context preparation and projection activity.",
          }),
        ),
        HttpApiEndpoint.post("export", ConversationMemoryPaths.export, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/zip" })),
          error: [HttpApiError.ServiceUnavailable, ConflictError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "conversationMemory.export",
            summary: "Export normalized conversation context",
            description: "Download a redacted ZIP containing intervention frames and the latest active model input.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "conversation-memory",
          description: "Kilo Conversation Memory observability routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
