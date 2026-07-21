// kilocode_change - new file; LCM-owned HTTP contract schemas shared by the session and project-scoped route groups
import { SessionID } from "@/session/schema"
import {
  LCM_SAFE_ACTIONS,
  LCM_SAFE_ERROR_CODES,
  LCM_SAFE_MESSAGE_TEMPLATES,
  type LcmSafeMessageTemplateKey,
} from "@/session/lcm/types"
import { Schema } from "effect"

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

const LcmOwnerLockSupportReportSchema = Schema.Struct({
  present: Schema.Boolean,
  recoveryState: Schema.Literals([
    "absent",
    "fresh",
    "wait",
    "recoverable",
    "force_required",
    "blocked",
    "unavailable",
  ]),
  diagnosticCode: Schema.String,
  canRecover: Schema.Boolean,
  forceRequired: Schema.Boolean,
  retryable: Schema.Boolean,
  lockAgeMs: Schema.optional(Schema.Number),
  retryAfterMs: Schema.optional(Schema.Number),
}).annotate({ identifier: "LcmOwnerLockSupportReport" })

export const LcmDbDiagnoseReportSchema = Schema.Struct({
  operationID: Schema.String,
  dataDir: Schema.String,
  status: LcmDbStatusSchema.fields.status,
  schemaVersion: Schema.optional(Schema.Number),
  checks: Schema.Array(LcmDbDiagnosticCheckSchema),
  safeErrors: Schema.Array(LcmSafeErrorSchema),
  quarantineRecommended: Schema.Boolean,
  ownerLock: Schema.optional(LcmOwnerLockSupportReportSchema),
}).annotate({ identifier: "LcmDbDiagnoseReport" })

export const LcmDbRebuildInput = Schema.Struct({
  dryRun: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "LcmDbRebuildInput" })

export const LcmDbRecoverLockInput = Schema.Struct({
  dryRun: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "LcmDbRecoverLockInput" })

export const LcmDbRecoverLockReportSchema = Schema.Struct({
  operationID: Schema.String,
  dataDir: Schema.String,
  dryRun: Schema.Boolean,
  force: Schema.Boolean,
  status: Schema.Literals(["would_recover", "recovered", "not_needed", "refused", "failed"]),
  ownerLock: LcmOwnerLockSupportReportSchema,
  safeErrors: Schema.Array(LcmSafeErrorSchema),
}).annotate({ identifier: "LcmDbRecoverLockReport" })

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
