import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
// kilocode_change start
import {
  LCM_SAFE_ACTIONS,
  LCM_SAFE_ERROR_CODES,
  LCM_SAFE_MESSAGE_TEMPLATES,
  type LcmSafeMessageTemplateKey,
} from "@/session/lcm/types"
// kilocode_change end
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { ApiNotFoundError, PermissionNotFoundError, SessionBusyError } from "../errors"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const root = "/session"
export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Schema.Literals(["project"])),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})
export const DiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Struct.omit(SessionSummary.DiffInput.fields, ["sessionID"]),
})
export const MessagesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  before: Schema.optional(Schema.String),
})
export const StatusMap = Schema.Record(Schema.String, SessionStatus.Info)
export const UpdatePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Session.Metadata),
  permission: Schema.optional(Permission.Ruleset),
  time: Schema.optional(
    Schema.Struct({
      archived: Schema.optional(Session.ArchivedTimestamp),
    }),
  ),
})
export const ForkPayload = Schema.Struct(Struct.omit(Session.ForkInput.fields, ["sessionID"]))
export const InitPayload = Schema.Struct({
  modelID: ModelID,
  providerID: ProviderID,
  messageID: MessageID,
})
export const SummarizePayload = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
  auto: Schema.optional(Schema.Boolean),
})
export const PromptPayload = Schema.Struct(Struct.omit(SessionPrompt.PromptInput.fields, ["sessionID"]))
export const CommandPayload = Schema.Struct(Struct.omit(SessionPrompt.CommandInput.fields, ["sessionID"]))
export const ShellPayload = Schema.Struct(Struct.omit(SessionPrompt.ShellInput.fields, ["sessionID"]))
export const RevertPayload = Schema.Struct(Struct.omit(SessionRevert.RevertInput.fields, ["sessionID"]))
export const PermissionResponsePayload = Schema.Struct({
  response: Permission.Reply,
})
// kilocode_change start
export const ViewedPayload = Schema.Struct({
  focused: Schema.optional(Schema.Array(Schema.String)),
  open: Schema.optional(Schema.Array(Schema.String)),
})
// kilocode_change end

// kilocode_change start
const LcmSafeParamValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
export const LcmSafeErrorSchema = Schema.Struct({
  code: Schema.Literals(LCM_SAFE_ERROR_CODES),
  templateKey: Schema.Literals(
    Object.keys(LCM_SAFE_MESSAGE_TEMPLATES) as [LcmSafeMessageTemplateKey, ...LcmSafeMessageTemplateKey[]],
  ),
  safeParams: Schema.Record(Schema.String, LcmSafeParamValue),
  safeMessage: Schema.String,
  action: Schema.optional(Schema.Literals(LCM_SAFE_ACTIONS)),
  retryable: Schema.Boolean,
  operationID: Schema.optional(Schema.String),
  conversationID: Schema.optional(Schema.String),
  summaryID: Schema.optional(Schema.String),
  fileID: Schema.optional(Schema.String),
  diagnosticCode: Schema.optional(Schema.String),
}).annotate({ identifier: "LcmSafeError" })
export const LcmRouteErrorResponseSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: LcmSafeErrorSchema,
}).annotate({ identifier: "LcmRouteErrorResponse" })
export class LcmBadRequestError extends Schema.ErrorClass<LcmBadRequestError>("LcmBadRequestError")(
  LcmRouteErrorResponseSchema.fields,
  { httpApiStatus: 400 },
) {}
export class LcmForbiddenError extends Schema.ErrorClass<LcmForbiddenError>("LcmForbiddenError")(
  LcmRouteErrorResponseSchema.fields,
  { httpApiStatus: 403 },
) {}
export class LcmNotFoundError extends Schema.ErrorClass<LcmNotFoundError>("LcmNotFoundError")(
  LcmRouteErrorResponseSchema.fields,
  { httpApiStatus: 404 },
) {}
export class LcmConflictError extends Schema.ErrorClass<LcmConflictError>("LcmConflictError")(
  LcmRouteErrorResponseSchema.fields,
  { httpApiStatus: 409 },
) {}
export class LcmServiceUnavailableError extends Schema.ErrorClass<LcmServiceUnavailableError>(
  "LcmServiceUnavailableError",
)(LcmRouteErrorResponseSchema.fields, { httpApiStatus: 503 }) {}
export class LcmTimeoutError extends Schema.ErrorClass<LcmTimeoutError>("LcmTimeoutError")(
  LcmRouteErrorResponseSchema.fields,
  { httpApiStatus: 504 },
) {}
export const LcmRouteErrors = [
  LcmBadRequestError,
  LcmForbiddenError,
  LcmNotFoundError,
  LcmConflictError,
  LcmServiceUnavailableError,
  LcmTimeoutError,
]

export const LcmDbStatusSchema = Schema.Struct({
  status: Schema.Literals([
    "uninitialized",
    "starting",
    "ready",
    "migrating",
    "locked",
    "corrupt",
    "unavailable",
    "closed",
  ]),
  dataDir: Schema.String,
  schemaVersion: Schema.optional(Schema.Number),
  ownerID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  queue: Schema.optional(
    Schema.Struct({
      foregroundQueued: Schema.Number,
      backgroundQueued: Schema.Number,
      foregroundLimit: Schema.Number,
      backgroundLimit: Schema.Number,
      active: Schema.Boolean,
      activeLane: Schema.optional(Schema.Literals(["foreground", "background"])),
      activePurpose: Schema.optional(
        Schema.Literals([
          "startup",
          "migration",
          "sync",
          "assembly",
          "token_budget",
          "maintenance",
          "retrieval",
          "large_file",
          "map",
          "cleanup",
          "smoke",
          "debug_support",
        ]),
      ),
      rejected: Schema.Number,
      canceled: Schema.Number,
      timedOut: Schema.Number,
    }),
  ),
  safeError: Schema.optional(LcmSafeErrorSchema),
}).annotate({ identifier: "LcmDbStatus" })

export const LcmCapabilitiesSchema = Schema.Struct({
  sessionID: SessionID,
  conversationID: Schema.optional(Schema.String),
  lifecycleState: Schema.Literals([
    "passive_synced",
    "lcm_active",
    "legacy_read_only",
    "recovery_required",
    "recovery_failed",
    "db_unavailable",
  ]),
  strategy: Schema.Literals(["upward", "dolt"]),
  dbReady: Schema.Boolean,
  lcmActive: Schema.Boolean,
  canAssemble: Schema.Boolean,
  canMaintain: Schema.Boolean,
  canRetrieve: Schema.Boolean,
  dbStatus: Schema.optional(LcmDbStatusSchema),
  safeError: Schema.optional(LcmSafeErrorSchema),
}).annotate({ identifier: "LcmCapabilities" })

export const LcmSettingsStateSchema = Schema.Struct({
  strategy: Schema.Literals(["upward", "dolt"]),
  freshTailTokens: Schema.Number,
  storageWarningThresholdBytes: Schema.Number,
  storageBytes: Schema.Number,
  storageWarning: Schema.Boolean,
  effectiveScope: Schema.Struct({
    kind: Schema.Literals(["workspace", "project", "default"]),
    projectID: Schema.optional(Schema.String),
    workspaceID: Schema.optional(Schema.String),
  }),
  lifecycleState: Schema.optional(LcmCapabilitiesSchema.fields.lifecycleState),
  dbStatus: Schema.optional(LcmDbStatusSchema),
  safeError: Schema.optional(LcmSafeErrorSchema),
  memoryMaintenanceCostTotal: Schema.optional(Schema.Number),
  retrievalCostTotal: Schema.optional(Schema.Number),
  fileExplorationCostTotal: Schema.optional(Schema.Number),
  mapCostTotal: Schema.optional(Schema.Number),
}).annotate({ identifier: "LcmSettingsState" })

const LcmUpdateSettingsInputFields = Schema.Struct({
  sessionID: Schema.optional(SessionID),
  projectID: Schema.optional(Schema.String),
  workspaceID: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.Literals(["upward", "dolt"])),
  freshTailTokens: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  storageWarningThresholdBytes: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
})
export const LcmUpdateSettingsInput = Schema.StructWithRest(LcmUpdateSettingsInputFields, [
  Schema.Record(Schema.String, Schema.Unknown),
]).annotate({ identifier: "LcmUpdateSettingsInput" })

export const LcmMaintenanceResultSchema = Schema.Struct({
  conversationID: Schema.String,
  operationID: Schema.String,
  workNeeded: Schema.Boolean,
  workPerformed: Schema.Boolean,
  blocking: Schema.Boolean,
  reason: Schema.Literals(["manual", "soft_threshold", "hard_limit", "repair"]),
  beforeTokens: Schema.optional(Schema.Number),
  afterTokens: Schema.optional(Schema.Number),
  summariesCreated: Schema.Number,
  contextItemsReplaced: Schema.Number,
  status: Schema.Literals([
    "healthy",
    "scheduled",
    "completed",
    "no_op",
    "deferred",
    "skipped",
    "failed",
    "canceled",
    "recovery_required",
  ]),
  safeMessage: Schema.optional(Schema.String),
  safeError: Schema.optional(LcmSafeErrorSchema),
}).annotate({ identifier: "LcmMaintenanceResult" })

export const LcmCancelMaintenanceInput = Schema.Struct({
  reason: Schema.optional(Schema.Literal("user")),
}).annotate({ identifier: "LcmCancelMaintenanceInput" })

const LcmDbDiagnosticCheckSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  code: Schema.optional(LcmSafeErrorSchema.fields.code),
}).annotate({ identifier: "LcmDbDiagnosticCheck" })
export const LcmDbDiagnoseReportSchema = Schema.Struct({
  operationID: Schema.String,
  dataDir: Schema.String,
  status: LcmDbStatusSchema.fields.status,
  schemaVersion: Schema.optional(Schema.Number),
  checks: Schema.Array(LcmDbDiagnosticCheckSchema),
  safeErrors: Schema.Array(LcmSafeErrorSchema),
  quarantineRecommended: Schema.Boolean,
}).annotate({ identifier: "LcmDbDiagnoseReport" })
const LcmDbRebuildInputFields = Schema.Struct({
  dryRun: Schema.optional(Schema.Boolean),
})
export const LcmDbRebuildInput = LcmDbRebuildInputFields.annotate({ identifier: "LcmDbRebuildInput" })
export const LcmDbRebuildReportSchema = Schema.Struct({
  operationID: Schema.String,
  dataDir: Schema.String,
  dryRun: Schema.Boolean,
  status: Schema.Literals(["would_rebuild", "rebuilt", "partial", "failed"]),
  quarantinedDataDir: Schema.optional(Schema.String),
  rebuiltConversations: Schema.Number,
  readOnlyConversations: Schema.Number,
  skippedConversations: Schema.Number,
  failedConversations: Schema.Number,
  safeErrors: Schema.Array(LcmSafeErrorSchema),
}).annotate({ identifier: "LcmDbRebuildReport" })
export const LcmPromptExportReportSchema = Schema.Struct({
  operationID: Schema.String,
  sessionID: Schema.String,
  conversationID: Schema.String,
  exportDir: Schema.String,
  fileCount: Schema.Number,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "LcmPromptExportReport" })

// kilocode_change end
export const SessionPaths = {
  list: root,
  status: `${root}/status`,
  get: `${root}/:sessionID`,
  children: `${root}/:sessionID/children`,
  todo: `${root}/:sessionID/todo`,
  diff: `${root}/:sessionID/diff`,
  messages: `${root}/:sessionID/message`,
  message: `${root}/:sessionID/message/:messageID`,
  create: root,
  remove: `${root}/:sessionID`,
  update: `${root}/:sessionID`,
  fork: `${root}/:sessionID/fork`,
  abort: `${root}/:sessionID/abort`,
  share: `${root}/:sessionID/share`,
  // kilocode_change start
  init: `${root}/:sessionID/init`,
  summarize: `${root}/:sessionID/summarize`,
  lcmCapabilities: `${root}/:sessionID/lcm/capabilities`,
  lcmSettings: `${root}/:sessionID/lcm/settings`,
  lcmMaintenanceCancel: `${root}/:sessionID/lcm/maintenance/cancel`,
  lcmDbDiagnose: `${root}/:sessionID/lcm/db/diagnose`,
  lcmDbRebuild: `${root}/:sessionID/lcm/db/rebuild`,
  lcmPromptsExport: `${root}/:sessionID/lcm/prompts/export`,
  // kilocode_change end
  prompt: `${root}/:sessionID/message`,
  promptAsync: `${root}/:sessionID/prompt_async`,
  command: `${root}/:sessionID/command`,
  shell: `${root}/:sessionID/shell`,
  revert: `${root}/:sessionID/revert`,
  unrevert: `${root}/:sessionID/unrevert`,
  permissions: `${root}/:sessionID/permissions/:permissionID`,
  deleteMessage: `${root}/:sessionID/message/:messageID`,
  deletePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  updatePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  viewed: `${root}/viewed`, // kilocode_change
} as const

export const SessionApi = HttpApi.make("session")
  .add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("list", SessionPaths.list, {
          query: ListQuery,
          success: described(Schema.Array(Session.Info), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.list",
            summary: "List sessions",
            description: "Get a list of all Kilo sessions, sorted by most recently updated.", // kilocode_change
          }),
        ),
        HttpApiEndpoint.get("status", SessionPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(StatusMap, "Get session status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.status",
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
          }),
        ),
        HttpApiEndpoint.get("get", SessionPaths.get, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Get session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.get",
            summary: "Get session",
            description: "Retrieve detailed information about a specific Kilo session.", // kilocode_change
          }),
        ),
        HttpApiEndpoint.get("children", SessionPaths.children, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Session.Info), "List of children"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.children",
            summary: "Get session children",
            description: "Retrieve all child sessions that were forked from the specified parent session.",
          }),
        ),
        HttpApiEndpoint.get("todo", SessionPaths.todo, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Todo.Info), "Todo list"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.todo",
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
          }),
        ),
        HttpApiEndpoint.get("diff", SessionPaths.diff, {
          params: { sessionID: SessionID },
          query: DiffQuery,
          success: described(Schema.Array(Snapshot.FileDiff), "Successfully retrieved diff"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.diff",
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
          }),
        ),
        HttpApiEndpoint.get("messages", SessionPaths.messages, {
          params: { sessionID: SessionID },
          query: MessagesQuery,
          success: described(Schema.Array(MessageV2.WithParts), "List of messages"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.messages",
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
          }),
        ),
        HttpApiEndpoint.get("message", SessionPaths.message, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(MessageV2.WithParts, "Message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.message",
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
          }),
        ),
        HttpApiEndpoint.post("create", SessionPaths.create, {
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Session.CreateInput],
          success: described(Session.Info, "Successfully created session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.create",
            summary: "Create session",
            description: "Create a new Kilo session for interacting with AI assistants and managing conversations.", // kilocode_change
          }),
        ),
        HttpApiEndpoint.delete("remove", SessionPaths.remove, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.delete",
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
          }),
        ),
        HttpApiEndpoint.patch("update", SessionPaths.update, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: UpdatePayload,
          success: described(Session.Info, "Successfully updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.update",
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
          }),
        ),
        HttpApiEndpoint.post("fork", SessionPaths.fork, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, ForkPayload], // kilocode_change - carry upstream bodyless full-session fork support
          success: described(Session.Info, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError], // kilocode_change - carry upstream malformed payload response
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.fork",
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
          }),
        ),
        HttpApiEndpoint.post("abort", SessionPaths.abort, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Aborted session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.abort",
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
          }),
        ),
        HttpApiEndpoint.post("init", SessionPaths.init, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: InitPayload,
          success: described(Schema.Boolean, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.init",
            summary: "Initialize session",
            description:
              "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
          }),
        ),
        HttpApiEndpoint.post("share", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully shared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.share",
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
          }),
        ),
        HttpApiEndpoint.delete("unshare", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully unshared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unshare",
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
          }),
        ),
        // kilocode_change start
        HttpApiEndpoint.post("summarize", SessionPaths.summarize, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: SummarizePayload,
          success: described(Schema.Boolean, "Summarized session"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.summarize",
            summary: "Summarize session",
            description: "Run LCM-owned memory maintenance for the session without legacy lossy compaction.",
          }),
        ),
        // kilocode_change end
        // kilocode_change start
        HttpApiEndpoint.get("lcmCapabilities", SessionPaths.lcmCapabilities, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(LcmCapabilitiesSchema, "LCM capabilities"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.capabilities",
            summary: "Get LCM capabilities",
            description: "Get content-safe LCM lifecycle and capability state for a session.",
          }),
        ),
        HttpApiEndpoint.get("lcmSettingsGet", SessionPaths.lcmSettings, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(LcmSettingsStateSchema, "LCM settings state"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.settings.get",
            summary: "Get LCM settings",
            description: "Get effective LCM settings for the session's trusted project or workspace scope.",
          }),
        ),
        HttpApiEndpoint.patch("lcmSettingsUpdate", SessionPaths.lcmSettings, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: LcmUpdateSettingsInput,
          success: described(LcmSettingsStateSchema, "Updated LCM settings state"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.settings.update",
            summary: "Update LCM settings",
            description: "Update user-writable LCM settings for the session's workspace or project scope.",
          }),
        ),
        HttpApiEndpoint.post("lcmMaintenanceCancel", SessionPaths.lcmMaintenanceCancel, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, LcmCancelMaintenanceInput],
          success: described(LcmMaintenanceResultSchema, "LCM maintenance cancellation result"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.maintenance.cancel",
            summary: "Cancel queued LCM maintenance",
            description: "Cancel a queued background LCM maintenance retry for the trusted session conversation.",
          }),
        ),
        HttpApiEndpoint.post("lcmDbDiagnose", SessionPaths.lcmDbDiagnose, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(LcmDbDiagnoseReportSchema, "LCM database diagnosis report"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.db.diagnose",
            summary: "Diagnose LCM database",
            description: "Run a content-safe, read-only LCM database diagnosis for the trusted session family.",
          }),
        ),
        HttpApiEndpoint.post("lcmDbRebuild", SessionPaths.lcmDbRebuild, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, LcmDbRebuildInput],
          success: described(LcmDbRebuildReportSchema, "LCM database rebuild report"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.db.rebuild",
            summary: "Rebuild LCM database",
            description:
              "Run a content-safe LCM database rebuild preview or apply-mode repair for the trusted session family.",
          }),
        ),
        HttpApiEndpoint.post("lcmPromptsExport", SessionPaths.lcmPromptsExport, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(LcmPromptExportReportSchema, "LCM prompt export report"),
          error: LcmRouteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.lcm.prompts.export",
            summary: "Export LCM prompts",
            description:
              "Write Markdown debug files for reconstructed LCM model prompts and active context for the trusted session.",
          }),
        ),
        // kilocode_change end
        HttpApiEndpoint.post("prompt", SessionPaths.prompt, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt",
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
          }),
        ),
        HttpApiEndpoint.post("promptAsync", SessionPaths.promptAsync, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(HttpApiSchema.NoContent, "Prompt accepted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt_async",
            summary: "Send async message",
            description:
              "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
          }),
        ),
        HttpApiEndpoint.post("command", SessionPaths.command, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: CommandPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.command",
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("shell", SessionPaths.shell, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: ShellPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.shell",
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
          }),
        ),
        HttpApiEndpoint.post("revert", SessionPaths.revert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: RevertPayload,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.revert",
            summary: "Revert message",
            description:
              "Revert a specific message in a session, undoing its effects and restoring the previous state.",
          }),
        ),
        HttpApiEndpoint.post("unrevert", SessionPaths.unrevert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unrevert",
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
          }),
        ),
        HttpApiEndpoint.post("permissionRespond", SessionPaths.permissions, {
          params: { sessionID: SessionID, permissionID: PermissionID },
          query: WorkspaceRoutingQuery,
          payload: PermissionResponsePayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, PermissionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.respond",
            summary: "Respond to permission",
            description: "Approve or deny a permission request from the AI assistant.",
            deprecated: true,
          }),
        ),
        HttpApiEndpoint.delete("deleteMessage", SessionPaths.deleteMessage, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.deleteMessage",
            summary: "Delete message",
            description:
              "Permanently delete a specific message and all of its parts from a session without reverting file changes.",
          }),
        ),
        HttpApiEndpoint.delete("deletePart", SessionPaths.deletePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.delete",
            description: "Delete a part from a message.",
          }),
        ),
        HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          payload: MessageV2.Part,
          success: described(MessageV2.Part, "Successfully updated part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.update",
            description: "Update a part in a message.",
          }),
        ),
        // kilocode_change start
        HttpApiEndpoint.post("viewed", SessionPaths.viewed, {
          query: WorkspaceRoutingQuery,
          payload: ViewedPayload,
          success: described(Schema.Boolean, "Viewed sessions updated"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.viewed",
            summary: "Set viewed sessions",
            description: "Notify the server which sessions the user is currently viewing, or clear all.",
          }),
        ),
        // kilocode_change end
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session",
          description: "Experimental HttpApi session routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
