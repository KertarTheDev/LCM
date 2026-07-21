// kilocode_change - new file
import { Context, Effect } from "effect"
import type { AgenticMapChildRunner } from "./map"
import type { LcmChildConversationInput, LcmChildConversationResult, LcmConversationScope } from "./lifecycle"
import type { LcmPathPermissionCheck } from "./large-files"
import type { LcmPreflightRuntimeInput } from "./runtime-support"
import type {
  AgenticMapInput,
  ConversationID,
  LcmAdmittedPathBackedFile,
  LcmCapabilities,
  LcmCancelDeferredMaintenanceInput,
  LcmConversationCapabilityClass,
  LcmDbDiagnoseReport,
  LcmDbRecoverLockReport,
  LcmDbRebuildReport,
  LcmDescribeInput,
  LcmDescribeResult,
  LcmExpandInput,
  LcmExpandQueryInput,
  LcmExpandQueryResult,
  LcmExpandResult,
  LcmFileID,
  LcmFileStatus,
  LcmGrepInput,
  LcmGrepResult,
  LcmMaintenanceResult,
  LcmManualMaintenanceInput,
  LcmMapCancelInput,
  LcmMapResult,
  LcmMapStatusInput,
  LcmPathBackedAdmissionInput,
  LcmPreflightResult,
  LcmPromptExportReport,
  LcmReadInput,
  LcmReadResult,
  LcmRenderedSpanProviderFamily,
  LcmSafeError,
  LcmSettingsState,
  LcmSoftMaintenanceAfterTurnInput,
  LcmSyncResult,
  LcmToolErrorResult,
  LcmUpdateSettingsInput,
  LcmUsageRecord,
  LlmMapInput,
} from "./types"

// This is the stable process-facing contract. Runtime implementation modules
// should depend on the narrow method types they need rather than the composed layer.
export interface Interface {
  readonly getCapabilities: (input: { sessionID: string }) => Effect.Effect<LcmCapabilities>
  readonly getOrCreateConversation: (input: {
    sessionID: string
    parentSessionID?: string
  }) => Effect.Effect<ConversationID, LcmSafeError>
  readonly getOrCreateChildConversation: (
    input: Omit<LcmChildConversationInput, "dataDir">,
  ) => Effect.Effect<LcmChildConversationResult, LcmSafeError>
  readonly acquireChildSessionSlot: (input: {
    sessionID: string
    rootConversationID: ConversationID
    projectID: string
    workspaceID?: string
    capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
    localProviderCapacityKey?: string
  }) => Effect.Effect<{ release: Effect.Effect<void>; rootActive: number; workspaceActive: number }, LcmSafeError>
  readonly syncFinalizedMessages: (input: {
    sessionID: string
    upToMessageID?: string
  }) => Effect.Effect<LcmSyncResult, LcmSafeError>
  readonly admitPathBackedFile: (
    input: LcmPathBackedAdmissionInput & { abortSignal?: AbortSignal },
  ) => Effect.Effect<LcmAdmittedPathBackedFile, LcmSafeError>
  readonly preflightBeforeModel: (input: LcmPreflightRuntimeInput) => Effect.Effect<LcmPreflightResult>
  readonly queueSoftMaintenanceAfterTurn: (
    input: LcmSoftMaintenanceAfterTurnInput,
  ) => Effect.Effect<LcmMaintenanceResult | undefined>
  readonly cancelDeferredMaintenance: (
    input: LcmCancelDeferredMaintenanceInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly diagnoseDb: (input: { sessionID: string }) => Effect.Effect<LcmDbDiagnoseReport, LcmSafeError>
  readonly rebuildDb: (input: { sessionID: string; dryRun: boolean }) => Effect.Effect<LcmDbRebuildReport, LcmSafeError>
  readonly recoverDbLock: (input: {
    sessionID: string
    dryRun: boolean
    force: boolean
  }) => Effect.Effect<LcmDbRecoverLockReport, LcmSafeError>
  readonly exportPrompts: (input: {
    sessionID: string
    workspaceRoot: string
  }) => Effect.Effect<LcmPromptExportReport, LcmSafeError>
  readonly finalizeProviderRequestSnapshot: (input: {
    sessionID?: string
    conversationID?: ConversationID
    requestSnapshotID: string
    status: "resolved" | "canceled" | "expired"
    nowMs?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly recordProviderRequestSnapshotFinalValidation: (input: {
    sessionID?: string
    conversationID?: ConversationID
    requestSnapshotID: string
    providerValidatorHash: string
    providerFamily?: LcmRenderedSpanProviderFamily
    providerTransformOverheadTokenCount?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly runManualMaintenance: (input: LcmManualMaintenanceInput) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly getSettingsState: (input: {
    sessionID?: string
    projectID?: string
    workspaceID?: string
  }) => Effect.Effect<LcmSettingsState, LcmSafeError>
  readonly updateSettings: (input: LcmUpdateSettingsInput) => Effect.Effect<LcmSettingsState, LcmSafeError>
  readonly handleSessionDeleted: (input: { sessionID: string; recursive: boolean }) => Effect.Effect<void, LcmSafeError>
  readonly recordUsage: (input: unknown) => Effect.Effect<LcmUsageRecord, LcmSafeError>
  readonly getConversationScope: (input: { sessionID: string }) => Effect.Effect<LcmConversationScope, LcmSafeError>
  readonly grep: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmGrepInput,
  ) => Effect.Effect<LcmGrepResult | LcmToolErrorResult>
  readonly describe: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmDescribeInput,
  ) => Effect.Effect<LcmDescribeResult | LcmToolErrorResult>
  readonly expand: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmExpandInput,
  ) => Effect.Effect<LcmExpandResult | LcmToolErrorResult>
  readonly expandQuery: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      providerID?: string
      modelID?: string
    } & LcmExpandQueryInput,
  ) => Effect.Effect<LcmExpandQueryResult | LcmToolErrorResult>
  readonly read: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmReadInput,
  ) => Effect.Effect<LcmReadResult | LcmToolErrorResult>
  readonly exploreFile: (input: {
    sessionID: string
    fileID: LcmFileID
    abortSignal?: AbortSignal
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
  }) => Effect.Effect<LcmFileStatus | LcmToolErrorResult>
  readonly llmMap: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      sourceToolCallID?: string
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    } & LlmMapInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly agenticMap: (
    input: {
      sessionID: string
      abortSignal?: AbortSignal
      sourceToolCallID?: string
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
      childRunner: AgenticMapChildRunner
    } & AgenticMapInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly mapStatus: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly mapCancel: (
    input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput,
  ) => Effect.Effect<LcmMapResult | LcmToolErrorResult>
  readonly close: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LcmRuntime") {}
