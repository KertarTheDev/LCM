// kilocode_change - new file
export type ConversationID = `conv_${string}`
export type MessageRowID = `msg_${string}`
export type PartRowID = `part_${string}`
export type SummaryID = `sum_${string}`
export type LcmFileID = `file_${string}`
export type ContextItemID = `ctx_${string}`
export type MapRunID = `map_${string}`
export type OperationID = `op_${string}`
export type LcmGrepResultID = `grep_${string}`
export type SessionID = string
export type ISO8601 = string

export type LcmStrategy = "upward" | "dolt"
export type LcmSettingsScopeKind = "workspace" | "project" | "default"
export type LcmPromptVersion =
  | "summary-leaf-v2"
  | "summary-condense-v2"
  | "summary-aggressive-v2"
  | "retrieval-expand-query-v3"
  | "file-exploration-summary-v2"
  | "map-item-v1"
export type LcmTokenCounterMode = "provider" | "deterministic_fallback" | "fake"
export type LcmBudgetStatus = "budgeted" | "unavailable" | "provider_limit_fallback"
export type LcmRenderOnlyHelperKind =
  | "dynamic_editor_context"
  | "environment_details"
  | "plan_reminder"
  | "plan_followup"
  | "code_switch_reminder"
  | "max_step"
  | "close_reason"
  | "plugin_transform"
  | "tool_description_placement"
  | "provider_media_fallback"
export type LcmCueLifecycleState = "active" | "superseded" | "tombstoned"
export type LcmProviderRequestSnapshotStatus = "in_flight" | "resolved" | "canceled" | "expired"
export type LcmNormalizedProviderProjectionKind =
  | "message"
  | "text_part"
  | "reasoning_part"
  | "tool_call"
  | "tool_result"
  | "media_fallback"
  | "large_file_marker"
  | "provider_transform_overhead"
export type LcmSafeOrHashedID = { kind: "safe"; safeID: string } | { kind: "sha256"; sha256: string }
export type LcmLaneKey = "raw_leaves" | "sprigs" | "bindles" | "archive_stubs" | "large_file_markers" | "retrieval_cues"
export type LcmSoftPressureReason = "global_soft_threshold" | "below_soft_raw_backlog" | "lane_latch"
export type LcmLaneLatchEnteredReason = LcmSoftPressureReason | "hard_limit"
export type LcmLaneLatchExitReason =
  | "at_or_below_target"
  | "no_eligible_items"
  | "strategy_changed"
  | "maintenance_failed"
  | "maintenance_canceled"
export type LcmLaneLatchPhase = "entered" | "staying" | "exited"

export interface LcmLaneLatchState {
  lane: LcmLaneKey
  conversationID: ConversationID
  strategy: LcmStrategy
  enteredReason: LcmLaneLatchEnteredReason
  enteredPressure: number
  targetTokens: number
  lastObservedPressure: number
  updatedAtMs: number
  nextAction: "summarize_leaves" | "condense_summaries" | "create_archive_stub"
}

export interface LcmLaneLatchDiagnostic extends LcmLaneLatchState {
  phase: LcmLaneLatchPhase
  exitReason?: LcmLaneLatchExitReason
}

export type LcmLifecycleState =
  | "passive_synced"
  | "lcm_active"
  | "legacy_read_only"
  | "recovery_required"
  | "recovery_failed"
  | "db_unavailable"

export type LcmConversationCapabilityClass = "root" | "task_child" | "explore_child" | "map_child"
export type LcmProviderCapacityClass = "remote_or_unknown" | "local_ollama" | "local_openai_compatible"

export type LcmSummaryObjectiveStatus =
  | "provider_accepted"
  | "rejected_empty"
  | "rejected_not_smaller"
  | "rejected_too_large"
  | "rejected_tiny"
  | "rejected_source_echo"
  | "rejected_prompt_wrapper"
  | "rejected_refusal"
  | "rejected_anchorless"
  | "retry_pending"
  | "fallback_accepted"
export type LcmSummaryFallbackMode = "none" | "truncated_prefix" | "extractive_key_points"
export type LcmSummaryReasoningPolicy =
  | "provider_default"
  | "no_reasoning"
  | "minimal_reasoning"
  | "bounded_reasoning"
  | "not_supported"
export type LcmSoftSweepStopReason =
  | "completed"
  | "iteration_cap"
  | "elapsed_cap"
  | "canceled"
  | "provider_capacity"
  | "backoff"
  | "no_work"
  | "failed"
export type LcmSummaryBackoffPurpose = "leaf_summary" | "condensation" | "hard_limit_maintenance"

export type LcmSafeErrorCode =
  | "db_unavailable"
  | "db_locked"
  | "db_migration_failed"
  | "db_corrupt"
  | "settings_unavailable"
  | "not_found"
  | "unauthorized"
  | "invalid_request"
  | "over_limit"
  | "timeout"
  | "canceled"
  | "recovery_required"
  | "recovery_failed"
  | "missing_source"
  | "stale_source"
  | "permission_denied"
  | "provider_unavailable"
  | "hard_limit_unresolved"
  | "legacy_read_only"
  | "provider_capacity_deferred"

export const LCM_SAFE_ERROR_CODES = [
  "db_unavailable",
  "db_locked",
  "db_migration_failed",
  "db_corrupt",
  "settings_unavailable",
  "not_found",
  "unauthorized",
  "invalid_request",
  "over_limit",
  "timeout",
  "canceled",
  "recovery_required",
  "recovery_failed",
  "missing_source",
  "stale_source",
  "permission_denied",
  "provider_unavailable",
  "hard_limit_unresolved",
  "legacy_read_only",
  "provider_capacity_deferred",
] as const satisfies readonly LcmSafeErrorCode[]

export type LcmSafeAction =
  | "retry"
  | "repeat_input"
  | "start_new_thread"
  | "re_register_file"
  | "delete_session"
  | "close_other_owner"
  | "contact_support"

export const LCM_SAFE_ACTIONS = [
  "retry",
  "repeat_input",
  "start_new_thread",
  "re_register_file",
  "delete_session",
  "close_other_owner",
  "contact_support",
] as const satisfies readonly LcmSafeAction[]

type LcmAssertExact<T extends true> = T
type LcmSafeErrorCodesCoverType = LcmAssertExact<
  Exclude<LcmSafeErrorCode, (typeof LCM_SAFE_ERROR_CODES)[number]> extends never ? true : false
>
type LcmSafeActionsCoverType = LcmAssertExact<
  Exclude<LcmSafeAction, (typeof LCM_SAFE_ACTIONS)[number]> extends never ? true : false
>

export interface LcmSafeParamsByTemplate {
  "lcm.db.unavailable": {
    operationID?: OperationID
    conversationID?: ConversationID
    retryable: boolean
    action?: LcmSafeAction
  }
  "lcm.settings.unavailable": {
    operationID?: OperationID
    retryable: boolean
    action?: LcmSafeAction
  }
  "lcm.auth.denied": {
    operationID?: OperationID
    conversationID?: ConversationID
    summaryID?: SummaryID
    fileID?: LcmFileID
    action?: LcmSafeAction
  }
  "lcm.request.invalid": {
    operationID?: OperationID
    limit?: number
    maxLimit?: number
    action?: LcmSafeAction
  }
  "lcm.operation.timeout": {
    operationID?: OperationID
    retryable: boolean
    action?: LcmSafeAction
  }
  "lcm.operation.canceled": {
    operationID?: OperationID
    retryable: boolean
    action?: LcmSafeAction
  }
  "lcm.recovery.missing_source": {
    operationID?: OperationID
    conversationID?: ConversationID
    action?: LcmSafeAction
  }
  "lcm.file.stale": {
    operationID?: OperationID
    fileID?: LcmFileID
    staleState?: LcmFileStaleState
    action?: LcmSafeAction
  }
  "lcm.hard_limit.unresolved": {
    operationID?: OperationID
    conversationID?: ConversationID
    beforeTokens?: number
    hardLimit?: number
    action?: LcmSafeAction
  }
  "lcm.provider_capacity.deferred": {
    operationID?: OperationID
    providerEndpointKeyHash?: string
    capacityClass?: LcmProviderCapacityClass
    retryable: boolean
    action?: LcmSafeAction
  }
  "lcm.provider.unavailable": {
    operationID?: OperationID
    providerEndpointKeyHash?: string
    capacityClass?: LcmProviderCapacityClass
    retryable: boolean
    action?: LcmSafeAction
  }
}

export type LcmSafeMessageTemplateKey = keyof LcmSafeParamsByTemplate

export interface LcmSafeError<TTemplateKey extends LcmSafeMessageTemplateKey = LcmSafeMessageTemplateKey> {
  code: LcmSafeErrorCode
  templateKey: TTemplateKey
  safeParams: LcmSafeParamsByTemplate[TTemplateKey]
  safeMessage: string
  action?: LcmSafeAction
  retryable: boolean
  operationID?: OperationID
  conversationID?: ConversationID
  summaryID?: SummaryID
  fileID?: LcmFileID
  diagnosticCode?: string
}

export class LcmSafeErrorFailure extends Error {
  override readonly name = "LcmSafeErrorFailure"

  constructor(readonly safeError: LcmSafeError) {
    super(safeError.safeMessage)
  }
}

export interface LcmRouteErrorResponse {
  ok: false
  error: LcmSafeError
}

export type LcmWebviewMessageName =
  | "requestLcmSettings"
  | "updateLcmSettings"
  | "cancelLcmMaintenance"
  | "diagnoseLcmDb"
  | "rebuildLcmDb"
  | "exportLcmPrompts"

export interface LcmWebviewRequestEnvelope<
  TName extends LcmWebviewMessageName = LcmWebviewMessageName,
  TBody = unknown,
> {
  type: TName
  requestID: OperationID
  body: TBody
}

export type LcmWebviewResponseEnvelope<TName extends LcmWebviewMessageName = LcmWebviewMessageName, TBody = unknown> =
  | {
      type: `${TName}.result`
      requestID: OperationID
      ok: true
      body: TBody
    }
  | {
      type: `${TName}.result`
      requestID: OperationID
      ok: false
      error: LcmSafeError
    }

export interface LcmPageInput {
  limit?: number
  cursor?: string
}

export interface LcmPageInfo {
  limit: number
  nextCursor?: string
  hasMore: boolean
}

export interface LcmCapabilities {
  sessionID: SessionID
  conversationID?: ConversationID
  lifecycleState: LcmLifecycleState
  strategy: LcmStrategy
  dbReady: boolean
  lcmActive: boolean
  canAssemble: boolean
  canMaintain: boolean
  canRetrieve: boolean
  dbStatus?: LcmDbStatus
  safeError?: LcmSafeError
}

export interface LcmRuntime {
  getCapabilities(input: { sessionID: SessionID }): Promise<LcmCapabilities>
  getOrCreateConversation(input: { sessionID: SessionID; parentSessionID?: SessionID }): Promise<ConversationID>
  syncFinalizedMessages(input: { sessionID: SessionID; upToMessageID?: string }): Promise<LcmSyncResult>
  admitPathBackedFile(input: LcmPathBackedAdmissionInput): Promise<LcmAdmittedPathBackedFile>
  preflightBeforeModel(input: LcmPreflightInput): Promise<LcmPreflightResult>
  queueSoftMaintenanceAfterTurn(input: LcmSoftMaintenanceAfterTurnInput): Promise<LcmMaintenanceResult | undefined>
  cancelDeferredMaintenance(input: LcmCancelDeferredMaintenanceInput): Promise<LcmMaintenanceResult>
  diagnoseDb(input: { sessionID: SessionID }): Promise<LcmDbDiagnoseReport>
  rebuildDb(input: { sessionID: SessionID; dryRun: boolean }): Promise<LcmDbRebuildReport>
  runManualMaintenance(input: LcmManualMaintenanceInput): Promise<LcmMaintenanceResult>
  getSettingsState(input: {
    sessionID?: SessionID
    projectID?: string
    workspaceID?: string
  }): Promise<LcmSettingsState>
  updateSettings(input: LcmUpdateSettingsInput): Promise<LcmSettingsState>
  handleSessionDeleted(input: { sessionID: SessionID; recursive: boolean }): Promise<void>
  llmMap(
    input: { sessionID: SessionID; sourceToolCallID?: string } & LlmMapInput,
  ): Promise<LcmMapResult | LcmToolErrorResult>
  agenticMap(
    input: { sessionID: SessionID; sourceToolCallID?: string } & AgenticMapInput,
  ): Promise<LcmMapResult | LcmToolErrorResult>
  mapStatus(input: { sessionID: SessionID } & LcmMapStatusInput): Promise<LcmMapResult | LcmToolErrorResult>
  mapCancel(input: { sessionID: SessionID } & LcmMapCancelInput): Promise<LcmMapResult | LcmToolErrorResult>
}

export interface LcmPathBackedAdmissionInput {
  sessionID: SessionID
  originalPath: string
  mimeType?: string | null
}

export interface LcmAdmittedPathBackedFile {
  conversationID: ConversationID
  contextItemID: ContextItemID
  fileID: LcmFileID
  sourceKind: LcmFileSourceKind
  byteCount: number
  sha256: string
  markerText: string
}

export interface LcmSyncResult {
  sessionID: SessionID
  conversationID: ConversationID
  insertedMessages: number
  insertedParts: number
  skippedUnsealedMessages: number
  skippedUnsealedParts: number
  idempotent: boolean
  lifecycleState: LcmLifecycleState
  safeError?: LcmSafeError
}

export interface LcmPreflightInput {
  sessionID: SessionID
  modelID: string
  providerID: string
  agentName?: string
  reason: "prompt" | "retry" | "repair"
  renderOptions: LcmRenderOptions
  abortSignalID?: string
}

export type LcmPreflightResult = LcmPreflightProceedResult | LcmPreflightBlockedResult

export interface LcmPreflightProceedResult {
  sessionID: SessionID
  conversationID: ConversationID
  lifecycleState: LcmLifecycleState
  threshold: LcmThresholdDecision
  assembly: LcmAssemblySuccessResult
  maintenance?: LcmMaintenanceResult
  canProceed: true
}

export interface LcmPreflightBlockedResult {
  sessionID: SessionID
  conversationID?: ConversationID
  lifecycleState: LcmLifecycleState
  threshold?: LcmThresholdDecision
  assembly?: LcmAssemblyResult
  maintenance?: LcmMaintenanceResult
  canProceed: false
  safeError: LcmSafeError
}

export interface LcmManualMaintenanceInput {
  sessionID: SessionID
  reason: "manual" | "repair"
  blocking: boolean
  renderOptions?: LcmRenderOptions
  abortSignalID?: string
}

export interface LcmCancelMaintenanceInput {
  reason?: "user"
}

export type LcmCancelDeferredMaintenanceInput = LcmCancelMaintenanceInput & {
  sessionID: SessionID
}

export interface LcmSoftMaintenanceAfterTurnInput {
  sessionID: SessionID
  providerID: string
  modelID: string
  renderOptions: LcmRenderOptions
  freshTailTokens?: number
  protectedCurrentUser?: LcmProtectedCurrentUserInput
  abortSignalID?: string
  recordNoOpAttempt?: boolean
}

export interface LcmLeafCompactionInput {
  conversationID: ConversationID
  reason: "soft_threshold" | "hard_limit" | "manual" | "repair"
  blocking: boolean
  maintenanceInputBudget?: number
  maxSourceTokens?: number
  freshTailTokens?: number
  summaryTargetTokens?: number
  summaryGenerationMaxOutputTokens?: number
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  abortSignalID?: string
}

export interface LcmHardLimitInput {
  sessionID: SessionID
  conversationID: ConversationID
  threshold: LcmThresholdDecision
  renderOptions: LcmRenderOptions
  maxRounds?: number
  abortSignalID?: string
}

export type LcmDbStatusCode =
  | "uninitialized"
  | "starting"
  | "ready"
  | "migrating"
  | "locked"
  | "corrupt"
  | "unavailable"
  | "closed"

export interface LcmDbInitializeInput {
  dataDir: string
  runtimeMode: "source" | "compiled-bin" | "serve" | "vscode-bundled"
  schemaVersion: number
  smokeMode?: boolean
}

export interface LcmDbStatus {
  status: LcmDbStatusCode
  dataDir: string
  schemaVersion?: number
  ownerID?: string
  startedAt?: ISO8601
  queue?: LcmDbQueueStatus
  safeError?: LcmSafeError
}

export interface LcmDbQueueStatus {
  foregroundQueued: number
  backgroundQueued: number
  foregroundLimit: number
  backgroundLimit: number
  active: boolean
  activeLane?: "foreground" | "background"
  activePurpose?: LcmDbRequest["purpose"]
  rejected: number
  canceled: number
  timedOut: number
}

export type LcmDebugCheckStatus = "passed" | "failed" | "skipped"
export type LcmDbRebuildStatus = "would_rebuild" | "rebuilt" | "partial" | "failed"
export type LcmDbSmokeRuntimeMode = "source" | "compiled-bin" | "serve" | "vscode-bundled"

export interface LcmDbDiagnosticCheck {
  name: string
  status: LcmDebugCheckStatus
  code?: LcmSafeErrorCode
}

export interface LcmDbDiagnoseReport {
  operationID: OperationID
  dataDir: string
  status: LcmDbStatusCode
  schemaVersion?: number
  checks: LcmDbDiagnosticCheck[]
  safeErrors: LcmSafeError[]
  quarantineRecommended: boolean
}

export interface LcmDbRebuildReport {
  operationID: OperationID
  dataDir: string
  dryRun: boolean
  status: LcmDbRebuildStatus
  quarantinedDataDir?: string
  rebuiltConversations: number
  readOnlyConversations: number
  skippedConversations: number
  failedConversations: number
  safeErrors: LcmSafeError[]
}

export interface LcmPromptExportReport {
  operationID: OperationID
  sessionID: SessionID
  conversationID: ConversationID
  exportDir: string
  fileCount: number
  warnings: string[]
}

export interface LcmDbSmokeReport {
  operationID: OperationID
  dataDir: string
  runtimeMode: LcmDbSmokeRuntimeMode
  status: "passed" | "failed"
  schemaVersion?: number
  checks: Array<
    LcmDbDiagnosticCheck & {
      detailCode?:
        | "pglite_startup"
        | "fresh_create"
        | "reopen"
        | "owner_lock"
        | "asset_loading"
        | "pg_trgm"
        | "literal_search"
        | "regex_cancellation"
        | "map_claim"
        | "packaged_runtime"
    }
  >
  safeErrors: LcmSafeError[]
}

export interface LcmDbRequest<T = unknown> {
  operationID: OperationID
  lane: "foreground" | "background"
  purpose:
    | "startup"
    | "migration"
    | "sync"
    | "assembly"
    | "token_budget"
    | "maintenance"
    | "retrieval"
    | "large_file"
    | "map"
    | "cleanup"
    | "smoke"
    | "debug_support"
  timeoutMs?: number
  abortSignal?: AbortSignal
  run(db: unknown, control?: LcmDbRequestControl): Promise<T>
}

export interface LcmDbRequestControl {
  abortSignal: AbortSignal
}

export interface LcmDbWorker {
  initialize(input: LcmDbInitializeInput): Promise<LcmDbStatus>
  execute<T>(request: LcmDbRequest<T>): Promise<T>
  executeForeground<T>(request: Omit<LcmDbRequest<T>, "lane">): Promise<T>
  close(): Promise<void>
}

export type ContextItemType = "raw_message" | "summary" | "archive_stub" | "large_file_marker" | "retrieval_cue"

export interface ContextItemBase {
  contextItemID: ContextItemID
  conversationID: ConversationID
  itemOrder: number
  itemType: ContextItemType
  tokenCount?: number
  cacheKey?: string
  cacheVersion?: number
  createdAt: ISO8601
  updatedAt: ISO8601
}

export type ContextItem =
  | (ContextItemBase & { itemType: "raw_message"; messageRowID: MessageRowID })
  | (ContextItemBase & { itemType: "summary"; summaryID: SummaryID })
  | (ContextItemBase & { itemType: "archive_stub"; summaryID: SummaryID; pointerID: string })
  | (ContextItemBase & { itemType: "large_file_marker"; fileID: LcmFileID })
  | (ContextItemBase & {
      itemType: "retrieval_cue"
      cueID: string
      cuePayload: LcmRetrievalCuePayload
      cueLifecycleState: LcmRetrievalCueLifecycleState
      cueTargetSourceMessageID: string
      cueGenerationID: string
      cueSupersededByID?: string
      cueSupersededByGenerationID?: string
    })

export interface LcmRenderInputManifestV1 {
  version: 1
  rendererVersion: string
  renderPreparationVersion: string
  sourceSelectionHash: string
  requestSnapshotProtectionHash: string
  renderUnitOrderHash: string
  effectivePlacementHash: string
  protectedSpanHash: string
  providerTransformHash: string
  providerValidatorHash: string
  assemblyValidatorHash: string
  systemPromptVersion: string
  systemPromptHash: string
  toolSchemaVersion: string
  toolSchemaHash: string
  pluginTransformVersion: string
  pluginTransformHash: string
  dynamicPromptVersion: string
  dynamicPromptHash: string
  messageVisibilityVersion: string
  messageVisibilityHash: string
  providerMediaCapability: "supports_media" | "text_only" | "unknown"
  stripMedia: boolean
  modelID: string
  providerID: string
  providerModelRevision?: string
  agentName?: string
  permissionProfileVersion?: string
  taskCapabilityClass: LcmConversationCapabilityClass
  clockPolicy: "runtime_per_preparation" | "fixture_frozen"
}

export interface LcmRenderOptions {
  renderInputManifest?: LcmRenderInputManifestV1
  rendererVersion?: string
  renderPreparationVersion?: string
  sourceSelectionHash?: string
  requestSnapshotProtectionHash?: string
  renderUnitOrderHash?: string
  effectivePlacementHash?: string
  protectedSpanHash?: string
  providerTransformHash?: string
  providerValidatorHash?: string
  assemblyValidatorHash?: string
  systemPromptVersion?: string
  systemPromptHash?: string
  toolSchemaVersion?: string
  toolSchemaHash?: string
  pluginTransformVersion?: string
  pluginTransformHash?: string
  dynamicPromptVersion?: string
  dynamicPromptHash?: string
  messageVisibilityVersion?: string
  messageVisibilityHash?: string
  providerMediaCapability: "supports_media" | "text_only" | "unknown"
  stripMedia: boolean
  modelID: string
  providerID: string
  providerModelRevision?: string
  agentName?: string
  permissionProfileVersion?: string
  taskCapabilityClass?: LcmConversationCapabilityClass
  clockPolicy?: "runtime_per_preparation" | "fixture_frozen"
}

export type LcmRenderedSpanSourceKind =
  | ContextItemType
  | "target_current_user"
  | "render_only_prompt_helper"
  | "provider_transform_overhead"
export type LcmRenderedSpanTransformStage = "rendered" | "provider_transformed"
export type LcmRenderedSpanProviderFamily =
  | "openai_compatible"
  | "copilot"
  | "anthropic"
  | "mistral"
  | "interleaved_reasoning"
  | "generic"
export type LcmRenderedSpanProtectedReason =
  | "assistant_tool_results"
  | "provider_media_fallback"
  | "provider_tool_use_order"
  | "mistral_sequence_repair"
  | "interleaved_reasoning"
  | "synthetic_media_fallback"

export interface LcmTargetCurrentUserInput {
  sourceSessionID: SessionID
  sourceMessageID: string
  messageRowID?: MessageRowID
  promptOperationID: OperationID
  visibilityBaseMessageID: string
}

export interface LcmProtectedCurrentUserInput {
  sourceSessionID: SessionID
  sourceMessageID: string
  messageRowID?: MessageRowID
}

export interface LcmAssemblyInput {
  sessionID: SessionID
  conversationID: ConversationID
  targetCurrentUser: LcmTargetCurrentUserInput
  renderOptions: LcmRenderOptions
}

export interface LcmRenderedSpanBase {
  renderUnitID: string
  sourceKind: LcmRenderedSpanSourceKind
  sourceHandle?: string
  canonicalOrder: number
  effectiveOrder: number
  placementSlot: "history" | "before_current_user" | "current_user" | "after_current_user" | "provider_tail"
  startIndex: number
  messageCount: number
  providerFamily: LcmRenderedSpanProviderFamily
  transformStage: LcmRenderedSpanTransformStage
  spanHash: string
}

export type LcmRenderedSpan =
  | (LcmRenderedSpanBase & {
      protected: true
      protectedReason: LcmRenderedSpanProtectedReason
      protocolSpanID: string
    })
  | (LcmRenderedSpanBase & {
      protected: false
      protectedReason?: never
      protocolSpanID?: never
    })

export type LcmValidatedModelMessages = unknown[] & {
  readonly __lcmValidatedProviderInput: true
}

export type LcmFinalValidatedProviderPayload = LcmPreparedProviderPayload & {
  readonly __lcmFinalProviderValidation: true
  finalProviderValidatorHash: string
  finalProviderTransformHash: string
}

export interface LcmPreparedProviderPayload {
  operationID: OperationID
  conversationID: ConversationID
  providerRequestSnapshotID: string
  providerID: string
  modelID: string
  systemPromptHash: string
  toolSchemaHash: string
  toolChoiceHash?: string
  modelMessages: LcmValidatedModelMessages
  renderInputManifest: LcmRenderInputManifestV1
  renderedSpans: LcmRenderedSpan[]
  assemblyValidatorHash: string
}

export interface LcmNormalizedProviderProjectionItem {
  itemIndex: number
  kind: LcmNormalizedProviderProjectionKind
  providerFamily: LcmRenderedSpanProviderFamily
  messageIndex?: number
  partIndex?: number
  role?: "system" | "user" | "assistant" | "tool"
  partKind?: string
  toolCallID?: LcmSafeOrHashedID
  toolResultID?: LcmSafeOrHashedID
  toolName?: LcmSafeOrHashedID
  adjacencyGroupID?: string
  protocolSpanID?: string
  renderUnitID?: string
  sourceHandle?: string
  spanHash?: string
  markerHandle?: string
  markerKind?:
    | "media_fallback"
    | "reasoning_marker"
    | "large_file_marker"
    | "tool_placeholder"
    | "provider_transform_overhead"
  reasoningKind?: "native" | "interleaved" | "fallback_marker"
  mediaFallbackKind?: "provider_text_fallback" | "synthetic_attachment" | "tool_result_media"
  providerTransformOverheadID?: string
  transformStage: LcmRenderedSpanTransformStage
}

export interface LcmNormalizedProviderProjection {
  schemaVersion: "lcm-normalized-provider-projection-v1"
  providerID: LcmSafeOrHashedID
  modelID: LcmSafeOrHashedID
  providerFamily: LcmRenderedSpanProviderFamily
  providerTransformHash: string
  providerValidatorHash: string
  items: LcmNormalizedProviderProjectionItem[]
}

export type LcmAssemblyResult = LcmAssemblySuccessResult | LcmAssemblyBlockedResult

export type LcmProviderRequestSnapshotTerminalStatus = Exclude<LcmProviderRequestSnapshotStatus, "in_flight">

export interface LcmAssemblySuccessResult {
  conversationID: ConversationID
  lifecycleState: LcmLifecycleState
  ok: true
  contextItems: ContextItem[]
  modelMessages: LcmValidatedModelMessages
  renderedSpans: LcmRenderedSpan[]
  activeTokens: number
  preparedProviderPayload: LcmPreparedProviderPayload
  providerRequestSnapshotID: string
  normalizedParityKey?: string
}

export interface LcmAssemblyBlockedResult {
  conversationID?: ConversationID
  lifecycleState: LcmLifecycleState
  ok: false
  contextItems?: ContextItem[]
  safeError: LcmSafeError
}

export interface LcmRecoveryResult {
  conversationID: ConversationID
  status: "healthy" | "rebuilt" | "failed"
  itemsRebuilt: number
  lifecycleState: LcmLifecycleState
  safeError?: LcmSafeError
}

export interface LcmContext {
  getCurrentContext(input: { conversationID: ConversationID }): Promise<ContextItem[]>
  rebuildActiveContext(input: {
    conversationID: ConversationID
    reason: string
    strategy?: LcmStrategy
  }): Promise<LcmRecoveryResult>
  assembleModelMessages(input: LcmAssemblyInput): Promise<LcmAssemblyResult>
  isOverThreshold(input: LcmThresholdInput): Promise<LcmThresholdDecision>
  compactLeavesToSprig(input: LcmLeafCompactionInput): Promise<LcmMaintenanceResult>
  compactUntilUnderHardLimit(input: LcmHardLimitInput): Promise<LcmMaintenanceResult>
}

export interface LcmLaneDecision {
  lane: LcmLaneKey
  tokens: number
  itemCount: number
  targetTokens: number
  softTokens?: number
  hysteresisDelta?: number
  overTarget: boolean
  eligibleItemCount: number
  nextAction: "none" | "summarize_leaves" | "condense_summaries" | "create_archive_stub"
  latch?: LcmLaneLatchDiagnostic
}

export interface LcmThresholdInput {
  conversationID: ConversationID
  renderOptions: LcmRenderOptions
  strategy?: LcmStrategy
  assemblyOperationID?: OperationID
  targetCurrentUser?: LcmTargetCurrentUserInput
  renderInputManifest?: LcmRenderInputManifestV1
  renderedSpanHashes?: string[]
  preparedProviderPayloadHash?: string
  freshTailTokens?: number
  activeTokens?: number
  systemPromptTokens?: number
  toolSchemaTokens?: number
  outputReserve?: number
  tokenCounterMode?: LcmTokenCounterMode
  tokenCounterVersion?: string
  providerContextLimit: number
  providerInputLimit?: number
  providerOutputLimit?: number
  budgetStatus?: LcmBudgetStatus
}

export interface LcmThresholdDecision {
  conversationID: ConversationID
  strategy: LcmStrategy
  activeTokens: number
  hardLimit: number
  softThreshold: number
  freshTailTokens: number
  softBacklogTokens: number
  softBacklogItemCount: number
  softBacklogLargestSourceTokens?: number
  freshTailRawTokens: number
  freshTailRawItemCount: number
  unconsumedRawTokens: number
  unconsumedRawItemCount: number
  protectedTailRawTokens: number
  protectedTailRawItemCount: number
  rawLaneTokens: number
  outputReserve: number
  systemPromptTokens: number
  toolSchemaTokens: number
  providerContextLimit: number
  providerInputLimit?: number
  providerOutputLimit?: number
  hardFillRatio: number
  rawLaneRatio: number
  softBacklogRatio: number
  tokenCounterMode: LcmTokenCounterMode
  tokenCounterVersion: string
  budgetStatus?: LcmBudgetStatus
  softPressureReason?: LcmSoftPressureReason
  laneLatchDiagnostics?: readonly LcmLaneLatchDiagnostic[]
  overSoft: boolean
  overHard: boolean
  lanes: {
    rawLeaves: LcmLaneDecision
    sprigs: LcmLaneDecision
    bindles: LcmLaneDecision
    archiveStubs: LcmLaneDecision
    largeFileMarkers: LcmLaneDecision
    retrievalCues: LcmLaneDecision
  }
}

export interface LcmMaintenanceResult {
  conversationID: ConversationID
  operationID: OperationID
  workNeeded: boolean
  workPerformed: boolean
  blocking: boolean
  reason: "manual" | "soft_threshold" | "hard_limit" | "repair"
  beforeTokens?: number
  afterTokens?: number
  summariesCreated: number
  contextItemsReplaced: number
  status:
    | "healthy"
    | "scheduled"
    | "completed"
    | "no_op"
    | "deferred"
    | "skipped"
    | "failed"
    | "canceled"
    | "recovery_required"
  safeMessage?: string
  safeError?: LcmSafeError
  sweepPassesCompleted?: number
  sweepMaxPasses?: number
  sweepElapsedMs?: number
  sweepMaxElapsedMs?: number
  sweepStopReason?: LcmSoftSweepStopReason
  summaryPromptVersion?: LcmPromptVersion
  summaryBackoffPurpose?: LcmSummaryBackoffPurpose
  summaryBackoffFailureCount?: number
  summaryBackoffDelayMs?: number
  summaryBackoffRemainingMs?: number
}

export type LcmUsagePurpose =
  | "leaf_summary"
  | "condensation"
  | "hard_limit_maintenance"
  | "retrieval_expand_query"
  | "file_exploration"
  | "llm_map"
export type LcmUsageMode = "background" | "blocking" | "explicit_retrieval" | "explicit_exploration" | "map_item"

export interface LcmUsageRecord {
  usageRecordID: string
  sessionID: SessionID
  conversationID: ConversationID
  jobID?: OperationID
  purpose: LcmUsagePurpose
  mode: LcmUsageMode
  providerID?: string
  modelID?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  summaryTargetTokens?: number
  summaryGenerationMaxOutputTokens?: number
  maintenanceInputBudget?: number
  summarySourceTokens?: number
  candidateSummaryTokens?: number
  acceptedSummaryTokens?: number
  summaryObjectiveStatus?: LcmSummaryObjectiveStatus
  summaryFallbackMode?: LcmSummaryFallbackMode
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  summaryRetryAttempt?: number
  maintenanceStatus?: Exclude<LcmMaintenanceResult["status"], "healthy">
  maintenanceSafeCode?: LcmSafeError["code"]
  maintenanceDiagnosticCode?: string
  maintenanceSafeMessage?: string
  costAmount?: number
  costCurrency?: string
  costStatus: "provider_reported" | "unknown" | "not_applicable"
  createdAt: ISO8601
}

export interface LcmMetricsSnapshot {
  conversationID: ConversationID
  lifecycleState: LcmLifecycleState
  strategy: LcmStrategy
  activeTokens: number
  hardLimit: number
  softThreshold: number
  freshTailTokens: number
  softBacklogTokens: number
  softBacklogItemCount: number
  softBacklogLargestSourceTokens?: number
  freshTailRawTokens: number
  freshTailRawItemCount: number
  unconsumedRawTokens: number
  unconsumedRawItemCount: number
  protectedTailRawTokens: number
  protectedTailRawItemCount: number
  rawLaneTokens: number
  hardFillRatio?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  budgetStatus?: LcmBudgetStatus
  softPressureReason?: LcmSoftPressureReason
  laneLatchDiagnostics?: readonly LcmLaneLatchDiagnostic[]
  providerContextLimit?: number
  providerInputLimit?: number
  providerOutputLimit?: number
  outputReserve?: number
  systemPromptTokens?: number
  toolSchemaTokens?: number
  providerCapacityDeferred?: boolean
  providerEndpointKeyHash?: string
  tokenCounterMode: LcmTokenCounterMode
  tokenCounterVersion: string
  laneTokens: Record<LcmLaneDecision["lane"], number>
  contextItemCounts: Record<ContextItemType, number>
  deferredSoftMaintenanceQueued: boolean
  deferredSoftMaintenanceQueuedCount: number
  deferredSoftMaintenanceAttemptCount?: number
  deferredSoftMaintenanceNextRunAtMs?: number
  storageBytes: number
  storageWarningThresholdBytes: number
  storageWarning: boolean
  memoryMaintenanceCostTotal?: number
  retrievalCostTotal?: number
  fileExplorationCostTotal?: number
  mapCostTotal?: number
  currency?: string
  lastMaintenance?: Pick<
    LcmMaintenanceResult,
    "operationID" | "status" | "reason" | "blocking" | "beforeTokens" | "afterTokens"
  >
  updatedAt: ISO8601
}

export type LcmEventName =
  | "lcm.db.status"
  | "lcm.context.updated"
  | "lcm.metrics.updated"
  | "lcm.file.status"
  | "lcm.maintenance.started"
  | "lcm.maintenance.ended"
  | "lcm.maintenance.failed"

export type LcmMaintenanceEventStatus =
  | "started"
  | "scheduled"
  | "completed"
  | "no_op"
  | "deferred"
  | "skipped"
  | "canceled"
  | "failed"
  | "recovery_required"

export interface LcmEventEnvelope<TPayload> {
  type: LcmEventName
  sessionID?: SessionID
  conversationID?: ConversationID
  operationID?: OperationID
  timestamp: ISO8601
  payload: TPayload
}

export interface LcmDbStatusEventPayload {
  status: LcmDbStatusCode
  schemaVersion?: number
  lifecycleState?: LcmLifecycleState
  dbReady: boolean
  safeError?: LcmSafeError
}

export interface LcmContextUpdatedEventPayload {
  lifecycleState: LcmLifecycleState
  strategy: LcmStrategy
  activeTokens?: number
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  softBacklogLargestSourceTokens?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  hardFillRatio?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  budgetStatus?: LcmBudgetStatus
  softPressureReason?: LcmSoftPressureReason
  laneLatchDiagnostics?: readonly LcmLaneLatchDiagnostic[]
  contextItemCounts?: Record<ContextItemType, number>
  reason: "sync" | "rebuild" | "maintenance" | "large_file_marker" | "retrieval_cue" | "recovery"
}

export interface LcmMaintenanceEventPayload {
  phase: "leaf_summary" | "condensation" | "hard_limit" | "deterministic_fallback" | "repair"
  reason: LcmMaintenanceResult["reason"]
  status: LcmMaintenanceEventStatus
  blocking: boolean
  beforeTokens?: number
  afterTokens?: number
  hardLimit?: number
  softThreshold?: number
  freshTailTokens?: number
  softBacklogTokens?: number
  softBacklogItemCount?: number
  softBacklogLargestSourceTokens?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  rawLaneRatio?: number
  softBacklogRatio?: number
  afterSoftBacklogTokens?: number
  afterSoftBacklogItemCount?: number
  providerCapacityDeferred?: boolean
  providerEndpointKeyHash?: string
  softPressureReason?: LcmSoftPressureReason
  laneLatchDiagnostics?: readonly LcmLaneLatchDiagnostic[]
  tokenCounterMode?: LcmTokenCounterMode
  tokenCounterVersion?: string
  sweepPassesCompleted?: number
  sweepMaxPasses?: number
  sweepElapsedMs?: number
  sweepMaxElapsedMs?: number
  sweepStopReason?: LcmSoftSweepStopReason
  summaryPromptVersion?: LcmPromptVersion
  summaryBackoffPurpose?: LcmSummaryBackoffPurpose
  summaryBackoffFailureCount?: number
  summaryBackoffDelayMs?: number
  summaryBackoffRemainingMs?: number
  summariesCreated?: number
  contextItemsReplaced?: number
  safeLabel?: string
  safeError?: LcmSafeError
}

export interface LcmFileStatusEventPayload {
  fileID: LcmFileID
  sourceKind: LcmFileSourceKind
  staleState: LcmFileStaleState
  explorationStatus: LcmFileExplorationStatus
  explorerKind: LcmFileExplorerKind
  sampled: boolean
  sampleBytes?: number
  blockingUse: boolean
  safeReason?: LcmFileStatusReason
  safeError?: LcmSafeError
}

export interface LcmToolErrorResult {
  ok: false
  error: LcmSafeError
}

export interface LcmGrepInput extends LcmPageInput {
  pattern: string
  mode?: "regex" | "literal"
  caseSensitive?: boolean
  summaryID?: SummaryID
}

export interface LcmGrepResult {
  ok: true
  results: Array<{
    resultID: LcmGrepResultID
    summaryID?: SummaryID
    fileID?: LcmFileID
    messageRowID?: MessageRowID
    partRowID?: PartRowID
    role?: "user" | "assistant" | "tool" | "system"
    summaryDegraded?: boolean
    summaryObjectiveStatus?: LcmSummaryObjectiveStatus
    summaryFallbackMode?: LcmSummaryFallbackMode
    snippet: string
    lineNumber?: number
    score?: number
  }>
  page: LcmPageInfo
}

export interface LcmDescribeInput {
  id: SummaryID | LcmFileID
}

export interface LcmDescribeResult {
  ok: true
  id: SummaryID | LcmFileID
  kind: "summary" | "file"
  summaryType?: "sprig" | "bindle" | "archive_stub"
  fileSourceKind?: LcmFileSourceKind
  tokenCount?: number
  sourceTokenCount?: number
  summaryDegraded?: boolean
  summaryObjectiveStatus?: LcmSummaryObjectiveStatus
  summaryFallbackMode?: LcmSummaryFallbackMode
  byteCount?: number
  preview?: string
  parentSummaryIDs?: SummaryID[]
  childSummaryIDs?: SummaryID[]
  coveredMessageCount?: number
  staleState?: LcmFileStaleState
  explorationStatus?: LcmFileExplorationStatus
}

export interface LcmExpandInput extends LcmPageInput {
  summaryID: SummaryID
}

export interface LcmExpandResult {
  ok: true
  summaryID: SummaryID
  items: Array<{
    kind: "message" | "summary" | "file_marker"
    messageRowID?: MessageRowID
    summaryID?: SummaryID
    fileID?: LcmFileID
    content?: string
    role?: "user" | "assistant" | "tool" | "system"
    summaryDegraded?: boolean
    summaryObjectiveStatus?: LcmSummaryObjectiveStatus
    summaryFallbackMode?: LcmSummaryFallbackMode
  }>
  page: LcmPageInfo
}

export interface LcmExpandQueryInput {
  query: string
  summaryID?: SummaryID
  maxAnswerTokens?: number
}

export interface LcmExpandQueryResult {
  ok: true
  answer: string
  citations: Array<{ summaryID?: SummaryID; fileID?: LcmFileID; messageRowID?: MessageRowID; partRowID?: PartRowID }>
  coverage?: "full" | "partial" | "none"
  truncated?: boolean
}

export interface LcmReadInput {
  fileID: LcmFileID
  byteOffset?: number
  maxBytes?: number
}

export interface LcmReadResult {
  ok: true
  fileID: LcmFileID
  sourceKind: LcmFileSourceKind
  mimeType?: string
  byteOffset: number
  bytesReturned: number
  encoding: "utf8" | "base64"
  content: string
  page: LcmPageInfo
}

export interface LcmRetrievalCuePayload {
  query: string
  cueText: string
  summaryIDs: SummaryID[]
  fileIDs: LcmFileID[]
  messageRowIDs: MessageRowID[]
  partRowIDs: PartRowID[]
  tokenCount: number
  generatedAt: ISO8601
}

export type LcmRetrievalCueLifecycleState = "active" | "superseded" | "tombstoned"

export type LcmFileSourceKind = "path" | "inline" | "image" | "tool_output" | "map_input" | "map_output"

export type LcmFileStaleState =
  | "current"
  | "missing"
  | "moved"
  | "size_mismatch"
  | "mtime_mismatch"
  | "hash_mismatch"
  | "symlink_retargeted"
  | "permission_denied"
  | "outside_boundary"
  | "artifact_missing"
  | "artifact_size_mismatch"
  | "artifact_hash_mismatch"
  | "unknown"

export type LcmFileExplorationStatus =
  | "not_started"
  | "queued"
  | "running"
  | "completed"
  | "sampled"
  | "unavailable"
  | "unsafe"
  | "corrupt"
  | "timeout"
  | "over_limit"
  | "canceled"
  | "failed"

export type LcmFileExplorerKind = "none" | "text" | "html" | "pdf" | "image" | "sqlite" | "unknown"

export type LcmFileStatusReason =
  | "none"
  | "sampled"
  | "unsupported_type"
  | "missing_helper"
  | "unsafe_active_content"
  | "corrupt_input"
  | "timeout"
  | "over_limit"
  | "canceled"
  | "helper_failed"
  | "stale_source"
  | "permission_denied"
  | "artifact_invalid"

export interface LcmFileStatus {
  fileID: LcmFileID
  sourceKind: LcmFileSourceKind
  staleState: LcmFileStaleState
  explorationStatus: LcmFileExplorationStatus
  explorerKind: LcmFileExplorerKind
  safeReason?: LcmFileStatusReason
  sampled: boolean
  sampleBytes?: number
  blockingUse: boolean
  safeError?: LcmSafeError
}

export interface LcmSettingsState {
  strategy: LcmStrategy
  freshTailTokens: number
  storageWarningThresholdBytes: number
  storageBytes: number
  storageWarning: boolean
  effectiveScope: {
    kind: LcmSettingsScopeKind
    projectID?: string
    workspaceID?: string
  }
  lifecycleState?: LcmLifecycleState
  dbStatus?: LcmDbStatus
  safeError?: LcmSafeError
  memoryMaintenanceCostTotal?: number
  retrievalCostTotal?: number
  fileExplorationCostTotal?: number
  mapCostTotal?: number
}

export interface LcmUpdateSettingsInput {
  sessionID?: SessionID
  projectID?: string
  workspaceID?: string
  strategy?: LcmStrategy
  freshTailTokens?: number
  storageWarningThresholdBytes?: number
}

export type LcmMapRunStatus = "queued" | "running" | "completed" | "failed" | "canceled"
export type LcmMapItemStatus = "pending" | "running" | "completed" | "retryable" | "failed" | "canceled"

export interface LlmMapInput {
  inputFileID?: LcmFileID
  inputPath?: string
  inputJsonl?: string
  itemSchema: unknown
  prompt: string
  model?: "small" | "default" | { providerID: string; modelID: string }
  workers?: number
  maxRetries?: number
}

export interface AgenticMapInput extends LlmMapInput {
  mode: "read_only" | "write_capable"
}

export interface LcmMapStatusInput {
  mapID: MapRunID
}

export interface LcmMapCancelInput {
  mapID: MapRunID
}

export interface LcmMapResult {
  ok: true
  mapID: MapRunID
  status: LcmMapRunStatus
  inputFileID: LcmFileID
  outputFileID?: LcmFileID
  totalItems: number
  completedItems: number
  failedItems: number
  retriedItems: number
  safeError?: LcmSafeError
}

export const LCM_SAFE_MESSAGE_TEMPLATES = {
  "lcm.db.unavailable": "Memory storage is not ready. Follow the shown recovery action.",
  "lcm.settings.unavailable": "Memory settings are not ready. Retry or check the project configuration.",
  "lcm.auth.denied": "That memory item is not available from this session.",
  "lcm.request.invalid": "The memory request is outside the supported limits.",
  "lcm.operation.timeout": "The memory operation did not finish.",
  "lcm.operation.canceled": "The memory operation was canceled.",
  "lcm.recovery.missing_source": "Some required source was not saved. Repeat the missing input or action.",
  "lcm.file.stale":
    "The recorded file source is stale or inaccessible. Re-register the current file if you want to use it.",
  "lcm.hard_limit.unresolved":
    "Memory could not be reduced enough for this response. Start a new thread or repeat the needed input.",
  "lcm.provider_capacity.deferred": "Local model capacity is busy. The memory operation will retry later.",
  "lcm.provider.unavailable": "The model provider is not available. Retry after checking the provider connection.",
} satisfies Record<LcmSafeMessageTemplateKey, string>

export function createLcmSafeError<TTemplateKey extends LcmSafeMessageTemplateKey>(
  input: Omit<LcmSafeError<TTemplateKey>, "safeMessage" | "action">,
): LcmSafeError<TTemplateKey> {
  const safeParams = input.safeParams as Record<string, unknown>
  const action = safeParams.action as LcmSafeAction | undefined
  return normalizeLcmSafeError({
    ...input,
    safeMessage: LCM_SAFE_MESSAGE_TEMPLATES[input.templateKey],
    ...(action ? { action } : {}),
    ...("operationID" in safeParams && safeParams.operationID
      ? { operationID: safeParams.operationID as OperationID }
      : {}),
    ...("conversationID" in safeParams && safeParams.conversationID
      ? { conversationID: safeParams.conversationID as ConversationID }
      : {}),
    ...("summaryID" in safeParams && safeParams.summaryID ? { summaryID: safeParams.summaryID as SummaryID } : {}),
    ...("fileID" in safeParams && safeParams.fileID ? { fileID: safeParams.fileID as LcmFileID } : {}),
  })
}

export function normalizeLcmSafeError<TTemplateKey extends LcmSafeMessageTemplateKey>(
  input: LcmSafeError<TTemplateKey>,
): LcmSafeError<TTemplateKey> {
  const safeParams = input.safeParams as Record<string, unknown>
  const action = safeParams.action as LcmSafeAction | undefined
  const normalized = {
    ...input,
    safeMessage: LCM_SAFE_MESSAGE_TEMPLATES[input.templateKey],
    ...("operationID" in safeParams && safeParams.operationID
      ? { operationID: safeParams.operationID as OperationID }
      : {}),
    ...("conversationID" in safeParams && safeParams.conversationID
      ? { conversationID: safeParams.conversationID as ConversationID }
      : {}),
    ...("summaryID" in safeParams && safeParams.summaryID ? { summaryID: safeParams.summaryID as SummaryID } : {}),
    ...("fileID" in safeParams && safeParams.fileID ? { fileID: safeParams.fileID as LcmFileID } : {}),
  }

  if (!action) {
    delete normalized.action
    return normalized
  }

  return {
    ...normalized,
    action,
  }
}
