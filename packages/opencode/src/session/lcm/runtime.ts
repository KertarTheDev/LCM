// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { makeRuntime } from "@/effect/run-service"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "./provider-ids"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateText, type ModelMessage } from "ai"
import { Context, Effect, Layer, Option } from "effect"
import { mergeDeep } from "remeda"
import { SessionID as RuntimeSessionID } from "../schema"
import { SessionStatus } from "../status"
import * as LcmConfig from "./config"
import {
  finalizeProviderRequestSnapshotRow,
  inheritThresholdAssemblyCache,
  LcmContext,
  recordProviderRequestSnapshotFinalValidationRow,
  type LcmHardLimitRuntimeInput,
  type LcmHardLimitProgress,
  type LcmLeafCompactionRuntimeInput,
  type LcmRawLeafAssemblyInput,
  type LcmRawLeafRenderPreparationInput,
  type LcmRawLeafThresholdInput,
} from "./context"
import { LcmDb } from "./db"
import { isLcmSafeError, safeErrorForDbStatus } from "./db-errors"
import { diagnoseRuntimeLcmDb, rebuildRuntimeLcmDb, recoverRuntimeLcmDbLock } from "./db-support-actions"
import {
  cancelQueuedDeferredSoftMaintenanceJob,
  finishDeferredSoftMaintenanceJob,
  readDeferredSoftMaintenanceJobs,
  upsertDeferredSoftMaintenanceJob,
  type LcmDeferredJobTerminalStatus,
  type LcmDeferredSoftMaintenanceJob,
} from "./deferred-jobs"
import {
  createLcmMaintenanceEndedEvent,
  createLcmMaintenanceFailedEvent,
  createLcmMaintenanceStartedEvent,
  createLcmContextUpdatedEvent,
  createLcmDbStatusEvent,
  createLcmFileStatusEvent,
  createLcmMetricsUpdatedEvent,
  LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
  LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
  LCM_BLOCKING_ARCHIVE_MAINTENANCE_LABEL,
  LCM_BLOCKING_CONDENSE_MAINTENANCE_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_BLOCKING_MAINTENANCE_LABEL,
  LCM_PREFLIGHT_ASSEMBLY_LABEL,
  LCM_PREFLIGHT_BUDGET_LABEL,
  LCM_PREFLIGHT_REBUILD_LABEL,
  LCM_PREFLIGHT_RETRIEVAL_LABEL,
  LCM_PREFLIGHT_STORAGE_LABEL,
  LCM_PREFLIGHT_SYNC_LABEL,
  LCM_PROMPT_PREPARATION_LABELS,
  publishLcmEvent,
} from "./events"
import { createLcmFinalizedSyncPendingStore } from "./finalized-sync-retry"
import { createOperationID } from "./id"
import { readLcmActivity } from "./activity"
import { resolveLcmDbLayout } from "./db-layout"
import { renderLargeFileMarker } from "./artifacts"
import {
  exploreLargeFileRow,
  updateLargeFileExplorationStatus,
  type LcmFileExplorationOutcome,
} from "./file-exploration"
import {
  addLargeFileMarkerContextItem,
  loadLargeFileRow,
  loadLargeFileStatus,
  registerPathBackedFile,
  type LcmLargeFileRow,
  type LcmPathPermissionCheck,
} from "./large-files"
import {
  calculateLcmStorageBytes,
  createAggregateLcmStorageBytesSampler,
  readLcmMetricsSnapshot,
  type LcmMetricsQueryable,
} from "./metrics"
import {
  resolveDebugFamilyTargetEffect,
  resolveKiloDataDirForLcm,
  resolveSessionFamilyTargetEffect,
  type LcmFamilyTarget,
} from "./family"
import {
  getCapabilities as getLifecycleCapabilities,
  getOrCreateChildConversation as getOrCreateLifecycleChildConversation,
  getConversationScope as getLifecycleConversationScope,
  type LcmChildConversationInput,
  type LcmChildConversationResult,
  type LcmConversationScope,
  getOrCreateConversation as getOrCreateLifecycleConversation,
  handleSessionDeleted as handleLifecycleSessionDeleted,
  recordUsage as recordLifecycleUsage,
  ensureLcmDbReady,
} from "./lifecycle"
import { getLcmProductionSchemaVersion } from "./migrations"
import { decideMaintenanceTrigger } from "./scheduler"
import {
  defaultLcmProviderCapacityRegistry,
  lcmProviderBaseURLFromOptions,
  lcmProviderCapacityInputFromModel,
  lcmProviderCapacitySafeFieldsFromKey,
  lcmProviderCapacityLane,
  runWithLcmProviderCapacity,
  type LcmProviderCapacityPriority,
} from "./provider-capacity"
import { LcmRetrieval } from "./retrieval"
import { LcmMap, resolveLcmMapWorkerCount, type AgenticMapChildRunner, type LcmMapModelSelection } from "./map"
import {
  createLcmSoftSweepBudget,
  emptyMaintenanceResult,
  failedMaintenanceResult,
  lcmDeferredSoftMaintenanceRetryDelayMs,
  lcmMaintenanceResultWithSoftSweepTelemetry,
  lcmRecordSummaryFailureBackoff,
  lcmShouldRetrySoftMaintenance,
  lcmSoftSweepShouldStartPass,
  lcmSoftSweepStopReasonForResult,
  lcmSummaryFailureBackoffKey,
  lcmSummaryFailureBackoffRemainingMs,
  lcmSummaryFailureBackoffTelemetry,
  maintenanceAttemptStatus,
  maintenanceAttemptUsageRecordID,
  type LcmMaintenanceAttemptStatus,
  type LcmSummaryFailureBackoffRoute,
  type LcmSummaryFailureBackoffState,
  type LcmSoftSweepBudget,
} from "./maintenance-results"
import { clearLcmLaneLatch, updateLcmLaneLatches } from "./token-budget"
import {
  computeMaintenanceInputBudget,
  computeSummaryGenerationMaxOutputTokens,
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
} from "./summary"
import { lcmPreflightRecoverableSafeError } from "./preflight-errors"
import { lcmProviderOverflowRecoveryInputLimit, resolveLcmModelLimits } from "./model-limits"
import {
  lcmSettingsConfigPatch,
  lcmSettingsStateFromConfig,
  lcmSettingsUnavailable,
  mergePublicLcmSettings,
  resolveLcmSettingsScope,
  validateLcmSettingsUpdate,
  type LcmSettingsResolvedScope,
} from "./settings-state"
import { exportLcmPrompts } from "./prompt-export"
import {
  createLcmSafeError,
  type AgenticMapInput,
  type ConversationID,
  type LcmAssemblyInput,
  type LcmAdmittedPathBackedFile,
  type LcmCapabilities,
  type LcmCancelDeferredMaintenanceInput,
  type LcmConversationCapabilityClass,
  type LcmContextUpdatedEventPayload,
  type LcmDescribeInput,
  type LcmDescribeResult,
  type LcmDbDiagnoseReport,
  type LcmDbRecoverLockReport,
  type LcmDbRebuildReport,
  type LcmExpandQueryInput,
  type LcmExpandQueryResult,
  type LcmDbStatus,
  type LcmExpandInput,
  type LcmExpandResult,
  type LcmFileID,
  type LcmFileStatus,
  type LcmGrepInput,
  type LcmGrepResult,
  type LcmLaneLatchState,
  type LcmMapResult,
  type LcmMapCancelInput,
  type LcmMapStatusInput,
  type LcmMaintenanceResult,
  type LcmMetricsSnapshot,
  type LcmManualMaintenanceInput,
  type LcmTargetCurrentUserInput,
  type MessageRowID,
  type LcmPreflightInput,
  type LcmPreflightResult,
  type LcmPromptExportReport,
  type LcmReadInput,
  type LcmReadResult,
  type LcmRenderedSpanProviderFamily,
  type LcmSafeAction,
  type LcmSafeError,
  type LcmFileStaleState,
  type LcmSoftMaintenanceAfterTurnInput,
  type LcmSettingsState,
  type LcmStrategy,
  type LcmSyncResult,
  type LcmThresholdDecision,
  type LcmToolErrorResult,
  type LcmUpdateSettingsInput,
  type LcmUsageRecord,
  type LcmPathBackedAdmissionInput,
  type LlmMapInput,
  type OperationID,
} from "./types"
import { syncFinalizedMessages as syncFinalizedSourceMessages } from "./source-sync"
import { Service, type Interface } from "./runtime-interface"
import { createRuntimeMaintenance } from "./runtime-maintenance"
import { createRuntimeProvider } from "./runtime-provider"
import {
  admittedPathBackedFileFromRow,
  blockedPreflight,
  hardLimitProgressLabel,
  hardLimitMaintenanceBlocksPreflight,
  hardLimitUnresolved,
  invalidRequest,
  isPromptPreparationStatus,
  lcmGenerationMessages,
  lcmMaxOutputTokens,
  lcmProviderDiagnostics,
  legacyReadOnly,
  localProviderBusy,
  mergeLcmProviderOptions,
  pending,
  preflightFallbackLifecycleState,
  providerUsageFromGeneration,
  recoveryMissing,
  thresholdEventFields,
  type LcmGenerationMessage,
  type LcmPreflightRuntimeInput,
} from "./runtime-support"

export { Service, type Interface } from "./runtime-interface"
export {
  lcmCountWorkspaceSoftMaintenance,
  lcmMaintenanceWorkspaceKey,
  type LcmPreflightRuntimeInput,
} from "./runtime-support"

export {
  createLcmSoftSweepBudget,
  lcmDeferredSoftMaintenanceRetryDelayMs,
  lcmRecordSummaryFailureBackoff,
  lcmShouldRetrySoftMaintenance,
  lcmSoftSweepShouldStartPass,
  lcmSummaryFailureBackoffKey,
  lcmSummaryFailureBackoffRemainingMs,
  lcmSummaryFailureBackoffTelemetry,
} from "./maintenance-results"

// Maintainer boundary: LcmRuntime is the process-facing coordinator. Keep this
// file focused on lifecycle orchestration and delegate durable context mutation
// to LcmContext, storage ownership to LcmDb/lifecycle, and tool semantics to
// retrieval/map modules.

type LcmSessionDeletionInput = { sessionID: string; recursive: boolean }

let activeSessionCleanup:
  | {
      readonly owner: symbol
      readonly run: (input: LcmSessionDeletionInput) => Promise<void>
      readonly close: () => Promise<void>
    }
  | undefined

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const lcmDb = yield* LcmDb.Service
    const lcmContext = Option.getOrUndefined(yield* Effect.serviceOption(LcmContext.Service))
    const provider = Option.getOrUndefined(yield* Effect.serviceOption(Provider.Service))
    const bus = Option.getOrUndefined(yield* Effect.serviceOption(Bus.Service))
    const sessionStatus = Option.getOrUndefined(yield* Effect.serviceOption(SessionStatus.Service))
    const mapScheduler = LcmMap.createLcmMapScheduler(lcmDb)
    const aggregateStorageBytes = createAggregateLcmStorageBytesSampler({
      resolveKiloDataDir: () => resolveKiloDataDirForLcm(),
    })
    const laneLatches = new Map<string, LcmLaneLatchState>()

    const applyLaneLatches = (threshold: LcmThresholdDecision) => {
      const updated = updateLcmLaneLatches({ decision: threshold, latches: laneLatches })
      laneLatches.clear()
      for (const [key, value] of updated.latches) laneLatches.set(key, value)
      return inheritThresholdAssemblyCache(threshold, updated.decision)
    }

    const clearActiveLatchesFromThreshold = (threshold: LcmThresholdDecision) => {
      for (const diagnostic of threshold.laneLatchDiagnostics ?? []) {
        if (diagnostic.phase === "exited") continue
        clearLcmLaneLatch({ latches: laneLatches, conversationID: diagnostic.conversationID, lane: diagnostic.lane })
      }
    }
    const childSlots = new Map<
      string,
      {
        rootConversationID: ConversationID
        workspaceKey: string
        capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
        localProviderCapacityKey?: string
      }
    >()

    const getResolved = Effect.fn("LcmRuntime.getResolvedConfig")(function* () {
      const cfg = yield* config.get()
      return LcmConfig.resolve(cfg.lcm)
    })

    const storageBytes = (dataDir?: string) =>
      dataDir ? Effect.promise(() => calculateLcmStorageBytes(dataDir).catch(() => 0)) : Effect.succeed(0)
    const aggregateStorageBytesEffect = Effect.promise(() => aggregateStorageBytes.read().catch(() => 0))

    const initializeExplicitDebugDb = Effect.fn("LcmRuntime.initializeExplicitDebugDb")(function* () {
      const familyRoot = process.env.KILO_LCM_DATA_DIR
      if (!familyRoot) {
        return {
          status: "unavailable" as const,
          dataDir: "",
          schemaVersion: getLcmProductionSchemaVersion(),
          safeError: invalidRequest("lcm_family_session_required"),
        }
      }
      const target = yield* resolveDebugFamilyTargetEffect({ familyRoot }).pipe(
        Effect.match({
          onFailure: (safeError) => ({ ok: false as const, safeError }),
          onSuccess: (target) => ({ ok: true as const, target }),
        }),
      )
      if (!target.ok) {
        return {
          status: "unavailable" as const,
          dataDir: "",
          schemaVersion: getLcmProductionSchemaVersion(),
          safeError: target.safeError,
        }
      }
      return yield* LcmDb.initializeFamily(lcmDb, target.target)
    })

    const initializeDb = Effect.fn("LcmRuntime.initializeDb")(function* (input: { sessionID?: string } = {}) {
      if (!lcmDb.initializeFamily) {
        return yield* lcmDb.initialize({
          dataDir: process.env.KILO_LCM_DATA_DIR ?? "",
          runtimeMode: "source",
          schemaVersion: getLcmProductionSchemaVersion(),
        })
      }
      if (input.sessionID) {
        const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
          Effect.provideService(LcmDb.Service, lcmDb),
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (ready) => ({ ok: true as const, ready }),
          }),
        )
        if (!ready.ok) {
          return {
            status: "unavailable" as const,
            dataDir: "",
            schemaVersion: getLcmProductionSchemaVersion(),
            safeError: ready.safeError,
          }
        }
        return ready.ready.status
      }
      return yield* initializeExplicitDebugDb()
    })

    const resolveSessionFamilyDb = Effect.fn("LcmRuntime.resolveSessionFamilyDb")(function* (input: {
      sessionID: string
    }) {
      const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
        Effect.provideService(LcmDb.Service, lcmDb),
      )
      return {
        dataDir: ready.dataDir,
        target: ready.target,
        lcmDb: LcmDb.scoped(lcmDb, ready.target),
      }
    })

    const contextLayerForDb = (familyDb: LcmDb.Interface) =>
      LcmContext.layer.pipe(Layer.provide(Layer.succeed(LcmDb.Service, familyDb)))

    const resolveSessionContext = Effect.fn("LcmRuntime.resolveSessionContext")(function* (input: {
      sessionID: string
    }) {
      if (lcmContext && lcmContext.runtimeDbBinding !== "lcm_context_layer") return lcmContext
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      return yield* LcmContext.Service.use((context) => Effect.succeed(context)).pipe(
        Effect.provide(contextLayerForDb(ready.lcmDb)),
      )
    })

    const writeSoftMaintenanceAttempt = Effect.fn("LcmRuntime.writeSoftMaintenanceAttempt")(function* (input: {
      familyDb: LcmDb.Interface
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      providerID?: string
      modelID?: string
      status: LcmMaintenanceAttemptStatus
      safeError?: LcmSafeError
      safeMessage?: string
      summaryTargetTokens?: number
      summaryGenerationMaxOutputTokens?: number
      maintenanceInputBudget?: number
      summarySourceTokens?: number
    }) {
      yield* input.familyDb.execute({
        operationID: input.operationID,
        lane: "background",
        purpose: "maintenance",
        run: async (db) => {
          await (db as PGlite).query(
            `
              INSERT INTO lcm_usage_records (
                usage_record_id,
                conversation_id,
                source_session_id,
                job_id,
                purpose,
                mode,
                provider_id,
                model_id,
                cost_status,
                summary_target_tokens,
                summary_generation_max_output_tokens,
                maintenance_input_budget,
                summary_source_tokens,
                maintenance_status,
                maintenance_safe_code,
                maintenance_diagnostic_code,
                maintenance_safe_message,
                created_at_ms
              )
              VALUES (
                $1, $2, $3, $4, 'leaf_summary', 'background', $5, $6, 'not_applicable',
                $7, $8, $9, $10, $11, $12, $13, $14, $15
              )
              ON CONFLICT (usage_record_id) DO UPDATE SET
                provider_id = COALESCE(EXCLUDED.provider_id, lcm_usage_records.provider_id),
                model_id = COALESCE(EXCLUDED.model_id, lcm_usage_records.model_id),
                summary_target_tokens = COALESCE(
                  EXCLUDED.summary_target_tokens,
                  lcm_usage_records.summary_target_tokens
                ),
                summary_generation_max_output_tokens = COALESCE(
                  EXCLUDED.summary_generation_max_output_tokens,
                  lcm_usage_records.summary_generation_max_output_tokens
                ),
                maintenance_input_budget = COALESCE(
                  EXCLUDED.maintenance_input_budget,
                  lcm_usage_records.maintenance_input_budget
                ),
                summary_source_tokens = COALESCE(EXCLUDED.summary_source_tokens, lcm_usage_records.summary_source_tokens),
                maintenance_status = EXCLUDED.maintenance_status,
                maintenance_safe_code = EXCLUDED.maintenance_safe_code,
                maintenance_diagnostic_code = EXCLUDED.maintenance_diagnostic_code,
                maintenance_safe_message = EXCLUDED.maintenance_safe_message
            `,
            [
              maintenanceAttemptUsageRecordID(input.operationID),
              input.conversationID,
              input.sessionID,
              input.operationID,
              input.providerID ?? null,
              input.modelID ?? null,
              input.summaryTargetTokens ?? null,
              input.summaryGenerationMaxOutputTokens ?? null,
              input.maintenanceInputBudget ?? null,
              input.summarySourceTokens ?? null,
              input.status,
              input.safeError?.code ?? null,
              input.safeError?.diagnosticCode ?? null,
              input.safeMessage ?? input.safeError?.safeMessage ?? null,
              Date.now(),
            ],
          )
        },
      })
    })

    const readMetrics = Effect.fn("LcmRuntime.readMetrics")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID?: OperationID
      lastMaintenance?: LcmMaintenanceResult
      strategy?: LcmStrategy
      storageWarningThresholdBytes?: number
    }) {
      const cfg = yield* getResolved()
      const ready = yield* ensureLcmDbReady({ sessionID: input.sessionID }).pipe(
        Effect.provideService(LcmDb.Service, lcmDb),
      )
      const scopedDb = LcmDb.scoped(lcmDb, ready.target)
      const bytes = yield* storageBytes(ready.dataDir)
      return yield* scopedDb.executeForeground({
        operationID: input.operationID ?? createOperationID(),
        purpose: "debug_support",
        run: async (db) =>
          readLcmMetricsSnapshot({
            db: db as LcmMetricsQueryable,
            conversationID: input.conversationID,
            strategy: input.strategy ?? cfg.strategy,
            storageBytes: bytes,
            storageWarningThresholdBytes: input.storageWarningThresholdBytes ?? cfg.storage.warningThresholdBytes,
            lastMaintenance: input.lastMaintenance,
          }),
      })
    })

    const readSettings = Effect.fn("LcmRuntime.readSettings")(function* (input: {
      scope: LcmSettingsResolvedScope
      lifecycleState?: LcmSettingsState["lifecycleState"]
    }) {
      let safeError: LcmSafeError | undefined
      const effectiveConfig = yield* config.get().pipe(
        Effect.catch(() => {
          safeError = lcmSettingsUnavailable("lcm_settings_config_read_failed")
          return Effect.succeed({} as Config.Info)
        }),
      )
      const localConfig = yield* config.getLocal().pipe(
        Effect.catch(() => {
          safeError ??= lcmSettingsUnavailable("lcm_settings_local_config_read_failed")
          return Effect.succeed({} as Config.Info)
        }),
      )
      const storageBytes = yield* aggregateStorageBytesEffect
      return lcmSettingsStateFromConfig({
        scope: input.scope,
        effectiveConfig,
        localConfig,
        storageBytes,
        lifecycleState: input.lifecycleState,
        safeError,
      })
    })

    const effectiveSettings = Effect.fn("LcmRuntime.effectiveSettings")(function* (input: {
      sessionID?: string
      projectID?: string
      workspaceID?: string
    }) {
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })
      const state = yield* readSettings({
        scope,
      })
      return { scope, state }
    })

    const publishMetrics = Effect.fn("LcmRuntime.publishMetrics")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID?: OperationID
      reason: LcmContextUpdatedEventPayload["reason"]
      lastMaintenance?: LcmMaintenanceResult
    }) {
      if (!bus) return undefined
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const metrics = yield* readMetrics({
        ...input,
        strategy: settings?.state.strategy,
        storageWarningThresholdBytes: settings?.state.storageWarningThresholdBytes,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!metrics) return
      yield* publishLcmEvent(
        bus,
        createLcmContextUpdatedEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          lifecycleState: metrics.lifecycleState,
          strategy: metrics.strategy,
          reason: input.reason,
          activeTokens: metrics.activeTokens,
          hardLimit: metrics.hardLimit,
          softThreshold: metrics.softThreshold,
          freshTailTokens: metrics.freshTailTokens,
          softBacklogTokens: metrics.softBacklogTokens,
          softBacklogItemCount: metrics.softBacklogItemCount,
          freshTailRawTokens: metrics.freshTailRawTokens,
          freshTailRawItemCount: metrics.freshTailRawItemCount,
          unconsumedRawTokens: metrics.unconsumedRawTokens,
          unconsumedRawItemCount: metrics.unconsumedRawItemCount,
          protectedTailRawTokens: metrics.protectedTailRawTokens,
          protectedTailRawItemCount: metrics.protectedTailRawItemCount,
          rawLaneTokens: metrics.rawLaneTokens,
          hardFillRatio: metrics.hardFillRatio,
          rawLaneRatio: metrics.rawLaneRatio,
          softBacklogRatio: metrics.softBacklogRatio,
          softBacklogLargestSourceTokens: metrics.softBacklogLargestSourceTokens,
          budgetStatus: metrics.budgetStatus,
          softPressureReason: metrics.softPressureReason,
          laneLatchDiagnostics: metrics.laneLatchDiagnostics,
          contextItemCounts: metrics.contextItemCounts,
        }),
      )
      yield* publishLcmEvent(
        bus,
        createLcmMetricsUpdatedEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          metrics,
        }),
      )
      return metrics
    })

    function maintenanceEventFieldsFromMetrics(metrics: LcmMetricsSnapshot) {
      return {
        hardLimit: metrics.hardLimit,
        softThreshold: metrics.softThreshold,
        freshTailTokens: metrics.freshTailTokens,
        softBacklogTokens: metrics.softBacklogTokens,
        softBacklogItemCount: metrics.softBacklogItemCount,
        softBacklogLargestSourceTokens: metrics.softBacklogLargestSourceTokens,
        freshTailRawTokens: metrics.freshTailRawTokens,
        freshTailRawItemCount: metrics.freshTailRawItemCount,
        unconsumedRawTokens: metrics.unconsumedRawTokens,
        unconsumedRawItemCount: metrics.unconsumedRawItemCount,
        protectedTailRawTokens: metrics.protectedTailRawTokens,
        protectedTailRawItemCount: metrics.protectedTailRawItemCount,
        rawLaneTokens: metrics.rawLaneTokens,
        rawLaneRatio: metrics.rawLaneRatio,
        softBacklogRatio: metrics.softBacklogRatio,
        afterSoftBacklogTokens: metrics.softBacklogTokens,
        afterSoftBacklogItemCount: metrics.softBacklogItemCount,
        softPressureReason: metrics.softPressureReason,
        laneLatchDiagnostics: metrics.laneLatchDiagnostics,
      }
    }

    const publishTerminalMaintenance = Effect.fn("LcmRuntime.publishTerminalMaintenance")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      result: LcmMaintenanceResult
      phase?: "leaf_summary" | "condensation" | "hard_limit" | "deterministic_fallback" | "repair"
      threshold?: LcmThresholdDecision
    }) {
      const metrics = yield* publishMetrics({
        sessionID: input.sessionID,
        conversationID: input.conversationID,
        operationID: input.operationID,
        reason: "maintenance",
        lastMaintenance: input.result,
      })
      if (bus) {
        const fields = metrics
          ? maintenanceEventFieldsFromMetrics(metrics)
          : input.threshold
            ? thresholdEventFields(input.threshold)
            : {}
        const event =
          input.result.status === "failed" || input.result.status === "canceled" || input.result.safeError
            ? createLcmMaintenanceFailedEvent({
                sessionID: input.sessionID,
                result: input.result,
                phase: input.phase,
                ...fields,
              })
            : createLcmMaintenanceEndedEvent({
                sessionID: input.sessionID,
                result: input.result,
                phase: input.phase,
                ...fields,
              })
        yield* publishLcmEvent(bus, event)
      }
      return metrics
    })

    const publishDbStatus = Effect.fn("LcmRuntime.publishDbStatus")(function* (input: {
      capabilities: LcmCapabilities
      operationID?: OperationID
    }) {
      if (!bus || !input.capabilities.dbStatus) return
      if (input.capabilities.dbStatus.status === "ready" && !input.capabilities.safeError) return
      yield* publishLcmEvent(
        bus,
        createLcmDbStatusEvent({
          status: input.capabilities.dbStatus,
          sessionID: input.capabilities.sessionID,
          conversationID: input.capabilities.conversationID,
          lifecycleState: input.capabilities.lifecycleState,
          operationID: input.operationID,
        }),
      )
    })

    const publishDirectDbStatus = Effect.fn("LcmRuntime.publishDirectDbStatus")(function* (input: {
      status: LcmDbStatus
      sessionID: string
      conversationID?: ConversationID
      lifecycleState: LcmCapabilities["lifecycleState"]
      operationID?: OperationID
    }) {
      if (!bus || input.status.status === "ready") return
      yield* publishLcmEvent(
        bus,
        createLcmDbStatusEvent({
          status: input.status,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          lifecycleState: input.lifecycleState,
          operationID: input.operationID,
        }),
      )
    })

    const getCapabilities = Effect.fn("LcmRuntime.getCapabilities")(function* (input: { sessionID: string }) {
      const cfg = yield* getResolved()
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const capabilities = yield* getLifecycleCapabilities({
        sessionID: input.sessionID,
        strategy: settings?.state.strategy ?? cfg.strategy,
      }).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      yield* publishDbStatus({ capabilities })
      if (capabilities.lifecycleState === "lcm_active") {
        yield* resumeDeferredSoftMaintenanceRetries({ sessionID: input.sessionID }).pipe(Effect.ignore)
      }
      return capabilities
    })

    function settingsWithRuntimeState(state: LcmSettingsState, capabilities: LcmCapabilities | undefined) {
      if (!capabilities) return state
      const safeError = state.safeError ?? capabilities.safeError
      return {
        ...state,
        lifecycleState: capabilities.lifecycleState,
        dbStatus: capabilities.dbStatus,
        ...(safeError ? { safeError } : {}),
      }
    }

    const readSettingsWithRuntimeState = Effect.fn("LcmRuntime.readSettingsWithRuntimeState")(function* (
      scope: LcmSettingsResolvedScope,
    ) {
      const capabilities = scope.sessionID ? yield* getCapabilities({ sessionID: scope.sessionID }) : undefined
      const state = yield* readSettings({ scope, lifecycleState: capabilities?.lifecycleState })
      return settingsWithRuntimeState(state, capabilities)
    })

    const getOrCreateConversation = Effect.fn("LcmRuntime.getOrCreateConversation")(function* (input: {
      sessionID: string
      parentSessionID?: string
    }) {
      return yield* getOrCreateLifecycleConversation(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const getOrCreateChildConversation = Effect.fn("LcmRuntime.getOrCreateChildConversation")(function* (
      input: Omit<LcmChildConversationInput, "dataDir">,
    ) {
      return yield* getOrCreateLifecycleChildConversation(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const acquireChildSessionSlot = Effect.fn("LcmRuntime.acquireChildSessionSlot")(function* (input: {
      sessionID: string
      rootConversationID: ConversationID
      projectID: string
      workspaceID?: string
      capabilityClass: Exclude<LcmConversationCapabilityClass, "root">
      localProviderCapacityKey?: string
    }) {
      const workspaceKey = input.workspaceID ? `workspace:${input.workspaceID}` : `project:${input.projectID}`
      const existing = childSlots.get(input.sessionID)
      if (existing) {
        const rootActive = Array.from(childSlots.values()).filter(
          (slot) => slot.rootConversationID === existing.rootConversationID,
        ).length
        const workspaceActive = Array.from(childSlots.values()).filter(
          (slot) => slot.workspaceKey === existing.workspaceKey,
        ).length
        return {
          rootActive,
          workspaceActive,
          release: Effect.sync(() => {}),
        }
      }

      const rootActive = Array.from(childSlots.values()).filter(
        (slot) => slot.rootConversationID === input.rootConversationID,
      ).length
      const workspaceActive = Array.from(childSlots.values()).filter(
        (slot) => slot.workspaceKey === workspaceKey,
      ).length
      if (rootActive >= LcmConfig.RUNTIME_DEFAULTS.scheduler.maxChildSessionsPerRoot) {
        return yield* Effect.fail(invalidRequest("lcm_child_slot_root_exhausted"))
      }
      if (workspaceActive >= LcmConfig.RUNTIME_DEFAULTS.scheduler.maxChildSessionsPerWorkspace) {
        return yield* Effect.fail(invalidRequest("lcm_child_slot_workspace_exhausted"))
      }
      if (input.localProviderCapacityKey) {
        const localProviderActive = Array.from(childSlots.values()).some(
          (slot) =>
            slot.rootConversationID === input.rootConversationID &&
            slot.localProviderCapacityKey === input.localProviderCapacityKey,
        )
        if (localProviderActive) {
          return yield* Effect.fail(
            localProviderBusy("lcm_child_slot_local_provider_busy", {
              localProviderCapacityKey: input.localProviderCapacityKey,
            }),
          )
        }
      }

      childSlots.set(input.sessionID, {
        rootConversationID: input.rootConversationID,
        workspaceKey,
        capabilityClass: input.capabilityClass,
        ...(input.localProviderCapacityKey ? { localProviderCapacityKey: input.localProviderCapacityKey } : {}),
      })
      return {
        rootActive: rootActive + 1,
        workspaceActive: workspaceActive + 1,
        release: Effect.sync(() => {
          const current = childSlots.get(input.sessionID)
          if (current?.rootConversationID === input.rootConversationID && current.workspaceKey === workspaceKey) {
            childSlots.delete(input.sessionID)
          }
        }),
      }
    })

    const sessionDeletionTree = Effect.fn("LcmRuntime.sessionDeletionTree")(function* (input: {
      sessionID: string
      recursive: boolean
    }) {
      if (!input.recursive) return [input.sessionID]
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      return yield* family.lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "cleanup",
        run: async (db) => {
          const rows = (
            await (db as PGlite).query<{ source_session_id: string }>(
              `
                WITH RECURSIVE tree(conversation_id, source_session_id) AS (
                  SELECT conversation_id, source_session_id
                  FROM lcm_conversations
                  WHERE source_session_id = $1
                  UNION ALL
                  SELECT child.conversation_id, child.source_session_id
                  FROM lcm_conversations child
                  JOIN tree parent ON child.parent_conversation_id = parent.conversation_id
                )
                SELECT source_session_id
                FROM tree
              `,
              [input.sessionID],
            )
          ).rows
          return [...new Set([input.sessionID, ...rows.map((row) => row.source_session_id)])]
        },
      })
    })

    const handleSessionDeleted = Effect.fn("LcmRuntime.handleSessionDeleted")(function* (
      input: LcmSessionDeletionInput,
    ) {
      // Snapshot the trusted LCM tree before lifecycle cleanup removes it. Each
      // process-local scheduler is keyed by source session rather than conversation.
      const sessionIDs = yield* sessionDeletionTree(input).pipe(Effect.catch(() => Effect.succeed([input.sessionID])))
      for (const sessionID of sessionIDs) {
        yield* cancelSessionMaintenance({ sessionID })
        yield* Effect.promise(() => mapScheduler.cancelBySession({ sessionID, operationID: createOperationID() })).pipe(
          Effect.catch(() => Effect.void),
        )
        yield* createLcmFinalizedSyncPendingStore()
          .delete(sessionID as RuntimeSessionID)
          .pipe(Effect.ignore)
        childSlots.delete(sessionID)
      }
      const result = yield* handleLifecycleSessionDeleted(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      aggregateStorageBytes.invalidate()
      return result
    })

    const writeUsageRecord = Effect.fn("LcmRuntime.recordUsage")(function* (input: unknown) {
      return yield* recordLifecycleUsage(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const getConversationScope = Effect.fn("LcmRuntime.getConversationScope")(function* (input: { sessionID: string }) {
      return yield* getLifecycleConversationScope(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
    })

    const getStatus = Effect.fn("LcmRuntime.getStatus")(function* (input: { sessionID: string }) {
      const conversationID = yield* getOrCreateConversation(input)
      return yield* readMetrics({ sessionID: input.sessionID, conversationID })
    })

    const getActivity = Effect.fn("LcmRuntime.getActivity")(function* (input: { sessionID: string; limit?: number }) {
      const conversationID = yield* getOrCreateConversation(input)
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      return yield* ready.lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "debug_support",
        run: (db) => readLcmActivity({ db: db as PGlite, conversationID, limit: input.limit }),
      })
    })

    const markConversationActive = Effect.fn("LcmRuntime.markConversationActive")(function* (input: {
      sessionID: string
      conversationID: ConversationID
    }) {
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      yield* family.lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "sync",
        run: async (db) => {
          await (db as { query: (sql: string, params?: unknown[]) => Promise<unknown> }).query(
            `
              UPDATE lcm_conversations
              SET lifecycle_state = 'lcm_active', updated_at_ms = $2, last_error_code = NULL, last_safe_message = NULL
              WHERE conversation_id = $1 AND lifecycle_state = 'passive_synced'
            `,
            [input.conversationID, Date.now()],
          )
        },
      })
    })

    const { runLcmTextGeneration, makeSummaryGenerator, resolveMapModel, resolveRuntimeMapWorkers } =
      createRuntimeProvider({ provider })

    const getSettingsState = Effect.fn("LcmRuntime.getSettingsState")(function* (input: {
      sessionID?: string
      projectID?: string
      workspaceID?: string
    }) {
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })
      return yield* readSettingsWithRuntimeState(scope)
    })

    const updateSettings = Effect.fn("LcmRuntime.updateSettings")(function* (input: LcmUpdateSettingsInput) {
      yield* Effect.try({
        try: () => validateLcmSettingsUpdate(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_validation_failed")),
      })
      const scope = yield* Effect.try({
        try: () => resolveLcmSettingsScope(input),
        catch: (error) => (isLcmSafeError(error) ? error : invalidRequest("lcm_settings_scope_resolution_failed")),
      })

      if (input.strategy === undefined && input.storageWarningThresholdBytes === undefined) {
        return yield* readSettingsWithRuntimeState(scope)
      }

      const effectiveBefore = yield* config.get().pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_read_before_write_failed"))),
        Effect.catchDefect(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_read_before_write_failed"))),
      )
      const localBefore = yield* config.getLocal().pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_local_config_read_before_write_failed"))),
        Effect.catchDefect(() =>
          Effect.fail(lcmSettingsUnavailable("lcm_settings_local_config_read_before_write_failed")),
        ),
      )
      yield* config.update(lcmSettingsConfigPatch(input)).pipe(
        Effect.catch(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_write_failed"))),
        Effect.catchDefect(() => Effect.fail(lcmSettingsUnavailable("lcm_settings_config_write_failed"))),
      )
      const effectiveConfig = {
        ...effectiveBefore,
        lcm: mergePublicLcmSettings({ current: effectiveBefore.lcm, patch: input }),
      } satisfies Config.Info
      const localConfig = {
        ...localBefore,
        lcm: mergePublicLcmSettings({ current: localBefore.lcm, patch: input }),
      } satisfies Config.Info
      const storageBytes = yield* aggregateStorageBytesEffect

      const capabilities = scope.sessionID ? yield* getCapabilities({ sessionID: scope.sessionID }) : undefined
      const state = lcmSettingsStateFromConfig({
        scope,
        effectiveConfig,
        localConfig,
        storageBytes,
        lifecycleState: capabilities?.lifecycleState,
      })
      return settingsWithRuntimeState(state, capabilities)
    })

    const {
      runManualMaintenance,
      queueSoftMaintenanceAfterTurn,
      cancelDeferredMaintenance,
      resumeDeferredSoftMaintenanceRetries,
      cancelSessionMaintenance,
      close: closeDeferredMaintenance,
    } = createRuntimeMaintenance({
      provider,
      bus,
      sessionStatus,
      getResolved,
      getCapabilities,
      effectiveSettings,
      resolveSessionContext,
      resolveSessionFamilyDb,
      writeSoftMaintenanceAttempt,
      publishMetrics,
      publishTerminalMaintenance,
      applyLaneLatches,
      clearActiveLatchesFromThreshold,
      runLcmTextGeneration,
      makeSummaryGenerator,
    })

    const diagnoseDb: Interface["diagnoseDb"] = Effect.fn("LcmRuntime.diagnoseDb")(function* (input) {
      return yield* diagnoseRuntimeLcmDb({ lcmDb, sessionID: input.sessionID })
    })

    const rebuildDb: Interface["rebuildDb"] = Effect.fn("LcmRuntime.rebuildDb")(function* (input) {
      return yield* rebuildRuntimeLcmDb({ lcmDb, sessionID: input.sessionID, dryRun: input.dryRun })
    })

    const recoverDbLock: Interface["recoverDbLock"] = Effect.fn("LcmRuntime.recoverDbLock")(function* (input) {
      return yield* recoverRuntimeLcmDbLock({
        lcmDb,
        sessionID: input.sessionID,
        dryRun: input.dryRun,
        force: input.force,
      })
    })

    const exportPrompts: Interface["exportPrompts"] = Effect.fn("LcmRuntime.exportPrompts")(function* (input) {
      const scope = yield* getConversationScope({ sessionID: input.sessionID })
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const operationID = createOperationID()
      return yield* ready.lcmDb.executeForeground({
        operationID,
        purpose: "debug_support",
        run: (db) =>
          exportLcmPrompts({
            db: db as PGlite,
            sessionID: input.sessionID,
            conversationID: scope.conversationID,
            dataDir: ready.dataDir,
            workspaceRoot: input.workspaceRoot,
            operationID,
          }),
      })
    })

    const preflightBeforeModel: Interface["preflightBeforeModel"] = (input) => {
      const operationID = createOperationID()
      const runtimeSessionID = input.sessionID as RuntimeSessionID
      const setPreflightStatus = (message: string) =>
        sessionStatus ? sessionStatus.set(runtimeSessionID, { type: "busy", message }).pipe(Effect.ignore) : Effect.void
      const clearPreflightStatus = sessionStatus
        ? Effect.gen(function* () {
            const current = yield* sessionStatus.get(runtimeSessionID)
            if (isPromptPreparationStatus(current)) {
              yield* sessionStatus.set(runtimeSessionID, { type: "idle" })
            }
          }).pipe(Effect.ignore)
        : Effect.void
      return Effect.gen(function* () {
        const internal = input as LcmPreflightRuntimeInput
        const unavailable = (diagnosticCode: string) =>
          createLcmSafeError({
            code: "db_unavailable",
            templateKey: "lcm.db.unavailable",
            safeParams: { operationID, retryable: false, action: "contact_support" },
            retryable: false,
            diagnosticCode,
          })

        yield* setPreflightStatus(LCM_PREFLIGHT_STORAGE_LABEL)
        const dbStatus = yield* initializeDb({ sessionID: input.sessionID })
        if (dbStatus.status !== "ready") {
          yield* publishDirectDbStatus({
            status: dbStatus,
            sessionID: input.sessionID,
            lifecycleState: "db_unavailable",
            operationID,
          })
          return blockedPreflight({
            sessionID: input.sessionID,
            lifecycleState: "db_unavailable",
            safeError: dbStatus.safeError ?? safeErrorForDbStatus(dbStatus),
          })
        }

        const settings = yield* effectiveSettings({ sessionID: input.sessionID })
        const initialCapabilities = yield* getCapabilities({ sessionID: input.sessionID })
        if (initialCapabilities.lifecycleState === "db_unavailable") {
          const safeError = initialCapabilities.safeError ?? unavailable("lcm_preflight_db_unavailable")
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: "db_unavailable",
            safeError,
          })
        }

        if (!provider) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: invalidRequest("lcm_preflight_runtime_services_missing", {
              operationID,
              conversationID: initialCapabilities.conversationID,
              action: "contact_support",
            }),
          })
        }
        const contextResult = yield* resolveSessionContext({ sessionID: input.sessionID }).pipe(
          Effect.match({
            onFailure: (error) => ({
              ok: false as const,
              safeError: isLcmSafeError(error)
                ? error
                : invalidRequest("lcm_preflight_context_resolution_failed", {
                    operationID,
                    conversationID: initialCapabilities.conversationID,
                    action: "retry",
                    retryable: true,
                  }),
            }),
            onSuccess: (context) => ({ ok: true as const, context }),
          }),
        )
        if (!contextResult.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: contextResult.safeError,
          })
        }
        const sessionContext = contextResult.context

        yield* setPreflightStatus(LCM_PREFLIGHT_SYNC_LABEL)
        const synced = yield* syncFinalizedSourceMessages({
          sessionID: input.sessionID,
          upToMessageID:
            internal.syncUpToMessageID ??
            internal.renderPreparation?.lastUserMessageID ??
            internal.renderPreparation?.lastUser?.id,
          strategy: settings.state.strategy,
          abortSignal: internal.abortSignal,
        }).pipe(
          Effect.provideService(LcmDb.Service, lcmDb),
          Effect.map((result) => ({ ok: true as const, result })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!synced.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: initialCapabilities.conversationID,
            lifecycleState: initialCapabilities.lifecycleState,
            safeError: synced.safeError,
          })
        }

        const conversationID = synced.result.conversationID
        const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
        if (capabilities.lifecycleState === "legacy_read_only") {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: "legacy_read_only",
            safeError: legacyReadOnly({ operationID, conversationID }),
          })
        }
        if (capabilities.lifecycleState === "db_unavailable") {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID: capabilities.conversationID,
            lifecycleState: "db_unavailable",
            safeError: capabilities.safeError ?? unavailable("lcm_preflight_db_unavailable_after_sync"),
          })
        }
        if (synced.result.safeError) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: synced.result.safeError,
          })
        }
        if (!internal.renderPreparation) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: invalidRequest("lcm_preflight_render_preparation_missing", {
              operationID,
              conversationID,
              action: "retry",
              retryable: true,
            }),
          })
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_REBUILD_LABEL)
        const recovery = yield* sessionContext
          .rebuildActiveContext({
            conversationID,
            reason: "preflight",
            strategy: settings.state.strategy,
            abortSignal: internal.abortSignal,
          })
          .pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        if (!recovery.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: recovery.safeError,
          })
        }
        if (recovery.result.safeError) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: recovery.result.lifecycleState,
            safeError: recovery.result.safeError,
          })
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_RETRIEVAL_LABEL)
        const cuePayloadsResult =
          capabilities.lifecycleState === "lcm_active"
            ? yield* LcmRetrieval.memoryCues({
                sessionID: input.sessionID,
                dataDir: dbStatus.dataDir,
                currentSourceMessageID:
                  internal.renderPreparation.lastUserMessageID ?? internal.renderPreparation.lastUser?.id,
                abortSignal: internal.abortSignal,
              }).pipe(
                Effect.provideService(LcmDb.Service, lcmDb),
                Effect.map((cuePayloads) => ({ ok: true as const, cuePayloads })),
                Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
              )
            : { ok: true as const, cuePayloads: [] }
        if (!cuePayloadsResult.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: cuePayloadsResult.safeError,
          })
        }
        const targetCurrentUserSourceMessageID =
          internal.renderPreparation.lastUserMessageID ?? internal.renderPreparation.lastUser?.id
        if (!targetCurrentUserSourceMessageID) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: recoveryMissing({
              operationID,
              conversationID,
              code: "missing_source",
              retryable: false,
              action: "repeat_input",
              diagnosticCode: "lcm_preflight_current_user_unproven",
            }),
          })
        }
        const cueRefresh = yield* sessionContext
          .replaceRetrievalCues({
            conversationID,
            targetCurrentUserSourceMessageID,
            cuePayloads: cuePayloadsResult.cuePayloads,
            abortSignal: internal.abortSignal,
          })
          .pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        if (!cueRefresh.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: cueRefresh.safeError,
          })
        }

        const model = yield* provider.getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID)).pipe(
          Effect.catch(() =>
            Effect.fail(
              invalidRequest("lcm_preflight_model_not_found", {
                operationID,
                conversationID,
                action: "retry",
                retryable: true,
              }),
            ),
          ),
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (model) => ({ ok: true as const, model }),
          }),
        )
        if (!model.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: model.safeError,
          })
        }
        const modelLimits = resolveLcmModelLimits(model.model)
        const providerInputLimit = lcmProviderOverflowRecoveryInputLimit({
          modelLimits,
          recovery: internal.providerOverflowRecovery,
        })

        const targetCurrentUser = {
          sourceSessionID: input.sessionID,
          sourceMessageID: targetCurrentUserSourceMessageID,
          promptOperationID: operationID,
          visibilityBaseMessageID: targetCurrentUserSourceMessageID,
        } satisfies LcmAssemblyInput["targetCurrentUser"]

        const thresholdInput = () =>
          ({
            conversationID,
            renderOptions: input.renderOptions,
            strategy: settings.state.strategy,
            providerContextLimit: modelLimits.context,
            providerInputLimit,
            providerOutputLimit: modelLimits.output,
            budgetStatus: modelLimits.budgetStatus,
            freshTailTokens: LcmConfig.RUNTIME_DEFAULTS.performance.freshTailTokens,
            renderPreparation: internal.renderPreparation,
            recordSnapshot: false,
            targetCurrentUser,
            abortSignal: internal.abortSignal,
          }) satisfies LcmRawLeafThresholdInput

        yield* setPreflightStatus(LCM_PREFLIGHT_BUDGET_LABEL)
        let threshold = yield* sessionContext.isOverThreshold(thresholdInput()).pipe(
          Effect.map((threshold) => ({ ok: true as const, threshold })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!threshold.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            safeError: threshold.safeError,
          })
        }
        threshold = { ok: true as const, threshold: applyLaneLatches(threshold.threshold) }

        let maintenance: LcmMaintenanceResult | undefined
        const currentThreshold = threshold.threshold
        if (currentThreshold.overHard) {
          const sessionID = runtimeSessionID
          const previousStatus = sessionStatus ? yield* sessionStatus.get(sessionID) : undefined
          const restoreStatus = isPromptPreparationStatus(previousStatus)
            ? ({ type: "idle" } as const)
            : (previousStatus ?? ({ type: "idle" } as const))

          maintenance = yield* Effect.gen(function* () {
            if (sessionStatus) {
              yield* sessionStatus.set(sessionID, { type: "busy", message: LCM_BLOCKING_MAINTENANCE_LABEL })
            }
            if (bus) {
              yield* publishLcmEvent(
                bus,
                createLcmMaintenanceStartedEvent({
                  sessionID: input.sessionID,
                  conversationID,
                  operationID,
                  phase: "hard_limit",
                  reason: "hard_limit",
                  blocking: true,
                  beforeTokens: currentThreshold.activeTokens,
                  hardLimit: currentThreshold.hardLimit,
                  safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
                }),
              )
            }

            const generator = makeSummaryGenerator(model.model, input.sessionID, input.renderOptions)
            const result = yield* sessionContext
              .compactUntilUnderHardLimit({
                sessionID: input.sessionID,
                conversationID,
                threshold: currentThreshold,
                renderOptions: input.renderOptions,
                abortSignalID: input.abortSignalID,
                abortSignal: internal.abortSignal,
                providerContextLimit: modelLimits.context,
                providerInputLimit,
                providerOutputLimit: modelLimits.output,
                renderPreparation: internal.renderPreparation,
                operationID,
                leafGenerator: generator,
                condenseGenerator: generator,
                onProgress: (progress) =>
                  sessionStatus
                    ? sessionStatus
                        .set(sessionID, { type: "busy", message: hardLimitProgressLabel(progress) })
                        .pipe(Effect.ignore)
                    : Effect.void,
              } satisfies LcmHardLimitRuntimeInput)
              .pipe(
                Effect.catch((error: unknown) => {
                  const safeError = isLcmSafeError(error)
                    ? error
                    : invalidRequest("lcm_preflight_hard_limit_failed", {
                        operationID,
                        conversationID,
                        action: "retry",
                        retryable: true,
                      })
                  return Effect.succeed(
                    failedMaintenanceResult({
                      conversationID,
                      operationID,
                      reason: "hard_limit",
                      blocking: true,
                      safeError,
                      beforeTokens: currentThreshold.activeTokens,
                      afterTokens: currentThreshold.activeTokens,
                    }),
                  )
                }),
              )
            yield* publishTerminalMaintenance({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              result,
              phase: "hard_limit",
              threshold: currentThreshold,
            })
            return result
          }).pipe(
            Effect.ensuring(
              sessionStatus && restoreStatus
                ? sessionStatus.set(sessionID, restoreStatus).pipe(Effect.ignore)
                : Effect.void,
            ),
          )
          if (hardLimitMaintenanceBlocksPreflight(maintenance)) {
            yield* publishMetrics({
              sessionID: input.sessionID,
              conversationID,
              operationID,
              reason: "maintenance",
              lastMaintenance: maintenance,
            })
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID,
              lifecycleState: capabilities.lifecycleState,
              threshold: currentThreshold,
              maintenance,
              safeError:
                maintenance.safeError ??
                hardLimitUnresolved({
                  operationID,
                  conversationID,
                  beforeTokens: currentThreshold.activeTokens,
                  hardLimit: currentThreshold.hardLimit,
                  diagnosticCode: "lcm_preflight_hard_limit_unresolved",
                }),
            })
          }

          threshold = yield* sessionContext.isOverThreshold(thresholdInput()).pipe(
            Effect.map((threshold) => ({ ok: true as const, threshold })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
          if (!threshold.ok) {
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID,
              lifecycleState: capabilities.lifecycleState,
              maintenance,
              safeError: threshold.safeError,
            })
          }
          threshold = { ok: true as const, threshold: applyLaneLatches(threshold.threshold) }
        }

        yield* setPreflightStatus(LCM_PREFLIGHT_ASSEMBLY_LABEL)
        const assemblyInput = {
          sessionID: input.sessionID,
          conversationID,
          targetCurrentUser,
          renderOptions: input.renderOptions,
          renderPreparation: internal.renderPreparation,
          threshold: threshold.threshold,
          abortSignal: internal.abortSignal,
        } satisfies LcmRawLeafAssemblyInput
        const assembly = yield* sessionContext.assembleModelMessages(assemblyInput).pipe(
          Effect.map((assembly) => ({ ok: true as const, assembly })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
        if (!assembly.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            threshold: threshold.threshold,
            maintenance,
            safeError: assembly.safeError,
          })
        }
        if (!assembly.assembly.ok) {
          return blockedPreflight({
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: capabilities.lifecycleState,
            threshold: threshold.threshold,
            maintenance,
            safeError: assembly.assembly.safeError,
          })
        }

        const assembled = assembly.assembly
        return yield* Effect.gen(function* () {
          if (capabilities.lifecycleState === "passive_synced") {
            yield* markConversationActive({ sessionID: input.sessionID, conversationID })
          }

          yield* publishMetrics({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            reason: maintenance ? "maintenance" : "sync",
            ...(maintenance ? { lastMaintenance: maintenance } : {}),
          })

          return {
            sessionID: input.sessionID,
            conversationID,
            lifecycleState: "lcm_active",
            threshold: threshold.threshold,
            assembly: assembled,
            ...(maintenance ? { maintenance } : {}),
            canProceed: true,
          } satisfies LcmPreflightResult
        }).pipe(
          Effect.catch((error) => {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_preflight_post_assembly_failed", {
                  operationID,
                  conversationID,
                  action: "retry",
                  retryable: true,
                })
            return Effect.gen(function* () {
              const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
              yield* ready.lcmDb.executeForeground({
                operationID: createOperationID(),
                purpose: "assembly",
                run: (db) =>
                  finalizeProviderRequestSnapshotRow({
                    db: db as PGlite,
                    requestSnapshotID: assembled.providerRequestSnapshotID,
                    conversationID,
                    status: "canceled",
                  }),
              })
            }).pipe(
              Effect.catch(() => Effect.void),
              Effect.as(
                blockedPreflight({
                  sessionID: input.sessionID,
                  conversationID,
                  lifecycleState: capabilities.lifecycleState,
                  threshold: threshold.threshold,
                  maintenance,
                  safeError,
                }),
              ),
            )
          }),
        )
      }).pipe(
        Effect.catch((error) => {
          const safeError = isLcmSafeError(error)
            ? error
            : invalidRequest("lcm_preflight_unhandled_failure", {
                operationID,
                action: "retry",
                retryable: true,
              })
          return Effect.gen(function* () {
            const observedCapabilities = yield* getCapabilities({ sessionID: input.sessionID }).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            return blockedPreflight({
              sessionID: input.sessionID,
              conversationID: observedCapabilities?.conversationID ?? safeError.conversationID,
              lifecycleState: preflightFallbackLifecycleState({
                safeError,
                observedLifecycleState: observedCapabilities?.lifecycleState,
              }),
              safeError,
            })
          })
        }),
        Effect.tap((result) => (result.canProceed ? Effect.void : clearPreflightStatus)),
        Effect.onInterrupt(() => clearPreflightStatus),
      )
    }

    const expandQuery = Effect.fn("LcmRuntime.expandQuery")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        providerID?: string
        modelID?: string
      } & LcmExpandQueryInput,
    ) {
      const rootScope = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const operationID = createOperationID()
      let releaseChildSlot: Effect.Effect<void> | undefined
      const providerID = input.providerID
      const modelID = input.modelID
      const model =
        provider && providerID && modelID
          ? yield* provider
              .getModel(ProviderID.make(providerID), ModelID.make(modelID))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      if (providerID && modelID && !model) {
        return {
          ok: false,
          error: invalidRequest("lcm_expand_query_model_unavailable", {
            operationID,
            ...(rootScope ? { conversationID: rootScope.conversationID } : {}),
          }),
        } satisfies LcmToolErrorResult
      }
      const providerInfo =
        provider && model
          ? yield* provider.getProvider(model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      const localProviderCapacityKey = model
        ? (() => {
            const lane = lcmProviderCapacityLane(
              lcmProviderCapacityInputFromModel({
                model,
                priority: "foreground",
                ...(providerInfo ? { provider: providerInfo } : {}),
              }),
            )
            return lane.capacityClass === "remote_or_unknown" ? undefined : lane.key
          })()
        : undefined
      if (rootScope?.capabilityClass === "root") {
        const capacitySlotID = `${input.sessionID}:lcm_expand_query:${operationID}`
        const slot = yield* acquireChildSessionSlot({
          sessionID: capacitySlotID,
          rootConversationID: rootScope.rootConversationID,
          projectID: rootScope.projectID,
          ...(rootScope.workspaceID ? { workspaceID: rootScope.workspaceID } : {}),
          capabilityClass: "explore_child",
          ...(localProviderCapacityKey ? { localProviderCapacityKey } : {}),
        }).pipe(
          Effect.match({
            onFailure: (safeError) => ({ ok: false as const, safeError }),
            onSuccess: (slot) => ({ ok: true as const, slot }),
          }),
        )
        if (!slot.ok) return { ok: false, error: slot.safeError } satisfies LcmToolErrorResult
        releaseChildSlot = slot.slot.release
      }
      let usage: LcmRetrieval.LcmExpandQueryUsage | undefined
      let languagePromise: Promise<LanguageModelV3> | undefined
      const runExpandQuery = LcmRetrieval.expandQuery({
        ...input,
        sessionID: input.sessionID,
        generator:
          provider && model && providerID && modelID
            ? async ({ prompt, request, maxAnswerTokens }) => {
                const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
                const generated = await runLcmTextGeneration({
                  model,
                  language,
                  sessionID: input.sessionID,
                  priority: "foreground",
                  operationID,
                  prompt,
                  request,
                  maxOutputTokens: maxAnswerTokens,
                  reserveReasoningTokens: true,
                  abortSignal: input.abortSignal,
                })
                usage = providerUsageFromGeneration({
                  usage: generated.usage,
                  providerID,
                  modelID,
                })
                return { text: generated.text, usage, providerDiagnostics: generated.providerDiagnostics }
              }
            : undefined,
      }).pipe(Effect.provideService(LcmDb.Service, lcmDb))
      const result = yield* releaseChildSlot ? runExpandQuery.pipe(Effect.ensuring(releaseChildSlot)) : runExpandQuery
      if (result.ok && usage) {
        const scope =
          rootScope ??
          (yield* getConversationScope({ sessionID: input.sessionID }).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          ))
        if (scope) {
          yield* writeUsageRecord({
            sessionID: input.sessionID,
            conversationID: scope.conversationID,
            purpose: "retrieval_expand_query",
            mode: "explicit_retrieval",
            ...usage,
          }).pipe(Effect.catch(() => Effect.void))
        }
      }
      if (!result.ok) return result
      const publicResult = result as LcmExpandQueryResult & { usage?: unknown }
      return {
        ok: true,
        answer: publicResult.answer,
        citations: publicResult.citations,
        ...(publicResult.coverage ? { coverage: publicResult.coverage } : {}),
        ...(publicResult.truncated !== undefined ? { truncated: publicResult.truncated } : {}),
        ...(publicResult.noAnswerReason ? { noAnswerReason: publicResult.noAnswerReason } : {}),
        ...(publicResult.answerSource ? { answerSource: publicResult.answerSource } : {}),
        ...(publicResult.fallbackReason ? { fallbackReason: publicResult.fallbackReason } : {}),
        ...(publicResult.searchedExcerptCount !== undefined
          ? { searchedExcerptCount: publicResult.searchedExcerptCount }
          : {}),
        ...(publicResult.rejectedCitationCount !== undefined
          ? { rejectedCitationCount: publicResult.rejectedCitationCount }
          : {}),
        ...(publicResult.providerDiagnostics ? { providerDiagnostics: publicResult.providerDiagnostics } : {}),
      } satisfies LcmExpandQueryResult
    })

    const fileStaleStates = new Set<LcmFileStaleState>([
      "current",
      "missing",
      "moved",
      "size_mismatch",
      "mtime_mismatch",
      "hash_mismatch",
      "symlink_retargeted",
      "permission_denied",
      "outside_boundary",
      "artifact_missing",
      "artifact_size_mismatch",
      "artifact_hash_mismatch",
      "unknown",
    ])

    const publishReadFileStatus = Effect.fn("LcmRuntime.publishReadFileStatus")(function* (input: {
      sessionID: string
      result: LcmReadResult | LcmToolErrorResult
    }) {
      if (!bus || input.result.ok || input.result.error.templateKey !== "lcm.file.stale") return
      const safeParams = input.result.error.safeParams as { fileID?: string; staleState?: string }
      if (!safeParams.fileID?.startsWith("file_")) return
      const staleState = fileStaleStates.has(safeParams.staleState as LcmFileStaleState)
        ? (safeParams.staleState as LcmFileStaleState)
        : "unknown"
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!family) return
      const status = yield* family.lcmDb
        .executeForeground({
          operationID: createOperationID(),
          purpose: "large_file",
          run: (db) =>
            loadLargeFileStatus(db as PGlite, safeParams.fileID as LcmFileID, {
              staleState,
              blockingUse: true,
              safeError: input.result.ok ? undefined : input.result.error,
            }),
        })
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!status) return
      yield* publishLcmEvent(
        bus,
        createLcmFileStatusEvent({
          sessionID: input.sessionID,
          conversationID: status.safeError?.conversationID,
          status,
        }),
      ).pipe(Effect.catch(() => Effect.void))
    })

    const admitPathBackedFile = Effect.fn("LcmRuntime.admitPathBackedFile")(function* (
      input: LcmPathBackedAdmissionInput & { abortSignal?: AbortSignal },
    ) {
      const operationID = createOperationID()
      const conversationID = yield* getOrCreateConversation({ sessionID: input.sessionID })
      const scope = yield* getConversationScope({ sessionID: input.sessionID })
      if (scope.conversationID !== conversationID) {
        return yield* Effect.fail(invalidRequest("lcm_path_admission_scope_mismatch", { operationID, conversationID }))
      }
      const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const admitted = yield* family.lcmDb.executeForeground({
        operationID,
        purpose: "large_file",
        abortSignal: input.abortSignal,
        run: async (db) => {
          const row = await registerPathBackedFile({
            db: db as PGlite,
            conversationID,
            originalPath: input.originalPath,
            boundaryMetadata: scope.boundaryMetadata,
            mimeType: input.mimeType,
            abortSignal: input.abortSignal,
          })
          const contextItemID = await addLargeFileMarkerContextItem({
            db: db as PGlite,
            conversationID,
            fileID: row.file_id,
          })
          return admittedPathBackedFileFromRow({ row, conversationID, contextItemID })
        },
      })
      yield* publishMetrics({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        reason: "large_file_marker",
      }).pipe(Effect.catch(() => Effect.void))
      yield* publishExplorationStatus({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        status: yield* family.lcmDb.executeForeground({
          operationID,
          purpose: "large_file",
          run: (db) => loadLargeFileStatus(db as PGlite, admitted.fileID, { blockingUse: true }),
        }),
      }).pipe(Effect.catch(() => Effect.void))
      return admitted
    })

    const publishExplorationStatus = Effect.fn("LcmRuntime.publishExplorationStatus")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      status?: LcmFileStatus
    }) {
      if (!bus || !input.status) return
      yield* publishLcmEvent(
        bus,
        createLcmFileStatusEvent({
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          status: input.status,
        }),
      ).pipe(Effect.catch(() => Effect.void))
    })

    const writeExplorationStatus = Effect.fn("LcmRuntime.writeExplorationStatus")(function* (input: {
      sessionID: string
      conversationID: ConversationID
      operationID: OperationID
      fileID: LcmFileID
      status: LcmFileStatus["explorationStatus"]
      explorerKind: LcmFileStatus["explorerKind"]
      safeReason?: LcmFileStatus["safeReason"]
      sampled?: boolean
      sampleBytes?: number
      summaryText?: string | null
      promptVersion?: "file-exploration-summary-v2" | null
      usageRecordID?: string | null
      lcmDbService?: typeof lcmDb
    }) {
      const dbService = input.lcmDbService ?? lcmDb
      const status = yield* dbService.executeForeground({
        operationID: input.operationID,
        purpose: "large_file",
        run: (db) =>
          updateLargeFileExplorationStatus({
            db: db as PGlite,
            fileID: input.fileID,
            status: input.status,
            explorerKind: input.explorerKind,
            safeReason: input.safeReason,
            sampled: input.sampled,
            sampleBytes: input.sampleBytes,
            summaryText: input.summaryText,
            promptVersion: input.promptVersion,
            usageRecordID: input.usageRecordID,
          }),
      })
      yield* publishExplorationStatus({
        sessionID: input.sessionID,
        conversationID: input.conversationID,
        operationID: input.operationID,
        status,
      })
      return status
    })

    const unauthorizedFile = (input: {
      operationID: OperationID
      conversationID?: ConversationID
      fileID: LcmFileID
    }) =>
      createLcmSafeError({
        code: "unauthorized",
        templateKey: "lcm.auth.denied",
        safeParams: {
          operationID: input.operationID,
          ...(input.conversationID ? { conversationID: input.conversationID } : {}),
          fileID: input.fileID,
        },
        retryable: false,
        diagnosticCode: "lcm_file_exploration_unauthorized",
      })

    const exploreFileInner = Effect.fn("LcmRuntime.exploreFile")(function* (input: {
      sessionID: string
      fileID: LcmFileID
      abortSignal?: AbortSignal
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    }) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_file_exploration_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scope = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.catch((error) => Effect.fail(error)),
      )
      const row = yield* familyDb.executeForeground({
        operationID,
        purpose: "large_file",
        abortSignal: input.abortSignal,
        run: (db) => loadLargeFileRow(db as PGlite, input.fileID),
      })
      if (!row) {
        return {
          ok: false,
          error: createLcmSafeError({
            code: "not_found",
            templateKey: "lcm.auth.denied",
            safeParams: { operationID, conversationID: scope.conversationID, fileID: input.fileID },
            retryable: false,
            diagnosticCode: "lcm_file_exploration_not_found",
          }),
        } satisfies LcmToolErrorResult
      }
      if (!scope.allowedConversationIDs.includes(row.conversation_id)) {
        return {
          ok: false,
          error: unauthorizedFile({ operationID, conversationID: scope.conversationID, fileID: input.fileID }),
        } satisfies LcmToolErrorResult
      }

      yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: "queued",
        explorerKind: "none",
        lcmDbService: familyDb,
      })
      yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: "running",
        explorerKind: "none",
        lcmDbService: familyDb,
      })

      const cfg = yield* getResolved()
      const providerID = input.providerID
      const modelID = input.modelID
      const model =
        provider && providerID && modelID
          ? yield* provider
              .getModel(ProviderID.make(providerID), ModelID.make(modelID))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
      let languagePromise: Promise<LanguageModelV3> | undefined
      const outcome: LcmFileExplorationOutcome = yield* Effect.tryPromise({
        try: () =>
          exploreLargeFileRow({
            row,
            artifactRoot: resolveLcmDbLayout(dbResult.db.dataDir).artifactsDir,
            operationID,
            abortSignal: input.abortSignal,
            permissionCheck: input.checkPathPermission,
            limits: {
              sampleBytes: cfg.largePayloads.explorationSampleBytes,
              maxFullLoadBytes: cfg.largePayloads.explorationMaxFullLoadBytes,
              maxOutputTokens: cfg.largePayloads.explorationMaxOutputTokens,
            },
            generator:
              provider && model && providerID && modelID
                ? async ({ prompt, request, abortSignal }) => {
                    const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
                    const generated = await runLcmTextGeneration({
                      model,
                      language,
                      sessionID: input.sessionID,
                      priority: "background",
                      operationID,
                      prompt,
                      request,
                      maxOutputTokens: cfg.largePayloads.explorationMaxOutputTokens,
                      abortSignal: abortSignal ?? input.abortSignal,
                    })
                    return {
                      text: generated.text,
                      usage: providerUsageFromGeneration({
                        usage: generated.usage,
                        providerID,
                        modelID,
                      }),
                    }
                  }
                : undefined,
          }),
        catch: () =>
          createLcmSafeError({
            code: "invalid_request",
            templateKey: "lcm.request.invalid",
            safeParams: { operationID },
            retryable: false,
            diagnosticCode: "lcm_file_exploration_failed",
          }),
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            fileID: input.fileID,
            conversationID: row.conversation_id,
            explorationStatus: error.code === "canceled" ? "canceled" : "failed",
            explorerKind: "unknown",
            safeReason: error.code === "canceled" ? "canceled" : "helper_failed",
            sampled: false,
            sampleBytes: 0,
          } as LcmFileExplorationOutcome),
        ),
      )

      let usageRecordID: string | undefined
      if (outcome.promptVersion) {
        const usage = yield* writeUsageRecord({
          sessionID: input.sessionID,
          conversationID: scope.conversationID,
          jobID: operationID,
          purpose: "file_exploration",
          mode: "explicit_exploration",
          providerID: outcome.usage?.providerID ?? providerID,
          modelID: outcome.usage?.modelID ?? modelID,
          inputTokens: outcome.usage?.inputTokens,
          outputTokens: outcome.usage?.outputTokens,
          cacheReadTokens: outcome.usage?.cacheReadTokens,
          cacheWriteTokens: outcome.usage?.cacheWriteTokens,
          costAmount: outcome.usage?.costAmount,
          costCurrency: outcome.usage?.costCurrency,
          costStatus: outcome.usage?.costStatus ?? "unknown",
        }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        usageRecordID = usage?.usageRecordID
      }

      const finalStatus = yield* writeExplorationStatus({
        sessionID: input.sessionID,
        conversationID: row.conversation_id,
        operationID,
        fileID: input.fileID,
        status: outcome.explorationStatus,
        explorerKind: outcome.explorerKind,
        safeReason: outcome.safeReason,
        sampled: outcome.sampled,
        sampleBytes: outcome.sampleBytes,
        summaryText: outcome.summaryText ?? null,
        promptVersion: outcome.promptVersion ?? null,
        usageRecordID: usageRecordID ?? null,
        lcmDbService: familyDb,
      })
      return (
        finalStatus ??
        ({
          ok: false,
          error: unauthorizedFile({ operationID, conversationID: scope.conversationID, fileID: input.fileID }),
        } satisfies LcmToolErrorResult)
      )
    })

    const exploreFile = (input: {
      sessionID: string
      fileID: LcmFileID
      abortSignal?: AbortSignal
      checkPathPermission?: LcmPathPermissionCheck
      providerID?: string
      modelID?: string
    }) =>
      exploreFileInner(input).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : createLcmSafeError({
                  code: "invalid_request",
                  templateKey: "lcm.request.invalid",
                  safeParams: {},
                  retryable: false,
                  diagnosticCode: "lcm_file_exploration_unhandled",
                }),
          } satisfies LcmToolErrorResult),
        ),
      )

    const llmMap = Effect.fn("LcmRuntime.llmMap")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        sourceToolCallID?: string
        checkPathPermission?: LcmPathPermissionCheck
        providerID?: string
        modelID?: string
      } & LlmMapInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      const resolvedEffect = resolveMapModel({
        selection: input.model,
        providerID: input.providerID,
        modelID: input.modelID,
        operationID,
        conversationID: scope.conversationID,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_model_resolution_failed", { operationID }),
          }),
          onSuccess: (resolved) => ({ ok: true as const, resolved }),
        }),
      )
      const resolvedResult = yield* resolvedEffect
      if (!resolvedResult.ok) return { ok: false, error: resolvedResult.error } satisfies LcmToolErrorResult
      const resolved = resolvedResult.resolved
      const workers = yield* Effect.promise(() =>
        resolveRuntimeMapWorkers({
          toolKind: "llm_map",
          mapInput: input,
          resolved,
        }),
      )
      const modelLimits = resolveLcmModelLimits(resolved.model)

      let languagePromise: Promise<LanguageModelV3> | undefined
      const mapEffect = LcmMap.llmMap({
        ...input,
        workers,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
        modelSelection: resolved.modelSelection,
        generator: async ({ prompt, request, abortSignal }) => {
          const language = await (languagePromise ??= Effect.runPromise(provider!.getLanguage(resolved.model)))
          const generated = await runLcmTextGeneration({
            model: resolved.model,
            language,
            sessionID: input.sessionID,
            priority: "background",
            operationID,
            prompt,
            request,
            maxOutputTokens: Math.min(modelLimits.output ?? ProviderTransform.maxOutputTokens(resolved.model), 4096),
            abortSignal,
          })
          return {
            text: generated.text,
            usage: providerUsageFromGeneration({
              usage: generated.usage,
              providerID: resolved.modelSelection.providerID,
              modelID: resolved.modelSelection.modelID,
            }),
          }
        },
        permissionCheck: input.checkPathPermission,
        recordUsage: async (usageInput) => {
          await Effect.runPromise(
            writeUsageRecord({
              sessionID: usageInput.sessionID,
              conversationID: usageInput.conversationID,
              jobID: usageInput.jobID,
              purpose: "llm_map",
              mode: "map_item",
              providerID: usageInput.usage.providerID,
              modelID: usageInput.usage.modelID,
              inputTokens: usageInput.usage.inputTokens,
              outputTokens: usageInput.usage.outputTokens,
              cacheReadTokens: usageInput.usage.cacheReadTokens,
              cacheWriteTokens: usageInput.usage.cacheWriteTokens,
              costAmount: usageInput.usage.costAmount,
              costCurrency: usageInput.usage.costCurrency,
              costStatus: usageInput.usage.costStatus,
            }).pipe(Effect.catch(() => Effect.void)),
          )
        },
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
      const result = yield* mapEffect
      return result
    })

    const agenticMap = Effect.fn("LcmRuntime.agenticMap")(function* (
      input: {
        sessionID: string
        abortSignal?: AbortSignal
        sourceToolCallID?: string
        checkPathPermission?: LcmPathPermissionCheck
        providerID?: string
        modelID?: string
        childRunner: AgenticMapChildRunner
      } & AgenticMapInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_agentic_map_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      const resolvedResult = yield* resolveMapModel({
        selection: input.model,
        providerID: input.providerID,
        modelID: input.modelID,
        operationID,
        conversationID: scope.conversationID,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_model_resolution_failed", { operationID }),
          }),
          onSuccess: (resolved) => ({ ok: true as const, resolved }),
        }),
      )
      if (!resolvedResult.ok) return { ok: false, error: resolvedResult.error } satisfies LcmToolErrorResult
      const workers = yield* Effect.promise(() =>
        resolveRuntimeMapWorkers({
          toolKind: "agentic_map",
          mapInput: input,
          resolved: resolvedResult.resolved,
        }),
      )

      return yield* LcmMap.agenticMap({
        ...input,
        workers,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
        modelSelection: resolvedResult.resolved.modelSelection,
        permissionCheck: input.checkPathPermission,
        childRunner: input.childRunner,
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_agentic_map_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const mapStatus = Effect.fn("LcmRuntime.mapStatus")(function* (
      input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_status_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_status_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      const languagePromises = new Map<string, Promise<LanguageModelV3>>()
      const statusEffect = provider
        ? LcmMap.resumeMap({
            mapID: input.mapID,
            sessionID: input.sessionID,
            dataDir: dbResult.db.dataDir,
            operationID,
            scope,
            scheduler: mapScheduler,
            processor: async ({ prompt, request, modelSelection, abortSignal }) => {
              const model = await Effect.runPromise(
                provider.getModel(ProviderID.make(modelSelection.providerID), ModelID.make(modelSelection.modelID)),
              )
              const key = `${model.providerID}/${model.id}`
              const language = await (languagePromises.get(key) ??
                (() => {
                  const promise = Effect.runPromise(provider.getLanguage(model))
                  languagePromises.set(key, promise)
                  return promise
                })())
              const generated = await runLcmTextGeneration({
                model,
                language,
                sessionID: input.sessionID,
                priority: "background",
                operationID,
                prompt,
                request,
                maxOutputTokens: Math.min(
                  resolveLcmModelLimits(model).output ?? ProviderTransform.maxOutputTokens(model),
                  4096,
                ),
                abortSignal,
              })
              return {
                text: generated.text,
                usage: providerUsageFromGeneration({
                  usage: generated.usage,
                  providerID: modelSelection.providerID,
                  modelID: modelSelection.modelID,
                }),
              }
            },
            recordUsage: async (usageInput) => {
              await Effect.runPromise(
                writeUsageRecord({
                  sessionID: usageInput.sessionID,
                  conversationID: usageInput.conversationID,
                  jobID: usageInput.jobID,
                  purpose: "llm_map",
                  mode: "map_item",
                  providerID: usageInput.usage.providerID,
                  modelID: usageInput.usage.modelID,
                  inputTokens: usageInput.usage.inputTokens,
                  outputTokens: usageInput.usage.outputTokens,
                  cacheReadTokens: usageInput.usage.cacheReadTokens,
                  cacheWriteTokens: usageInput.usage.cacheWriteTokens,
                  costAmount: usageInput.usage.costAmount,
                  costCurrency: usageInput.usage.costCurrency,
                  costStatus: usageInput.usage.costStatus,
                }).pipe(Effect.catch(() => Effect.void)),
              )
            },
          })
        : LcmMap.mapStatus({
            mapID: input.mapID,
            sessionID: input.sessionID,
            dataDir: dbResult.db.dataDir,
            operationID,
            scope,
          })
      return yield* statusEffect.pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_status_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const mapCancel = Effect.fn("LcmRuntime.mapCancel")(function* (
      input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput,
    ) {
      const operationID = createOperationID()
      const dbResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error) ? error : invalidRequest("lcm_map_cancel_db_unavailable", { operationID }),
          }),
          onSuccess: (db) => ({ ok: true as const, db }),
        }),
      )
      if (!dbResult.ok) return { ok: false, error: dbResult.error } satisfies LcmToolErrorResult
      const familyDb = dbResult.db.lcmDb
      const scopeResult = yield* getConversationScope({ sessionID: input.sessionID }).pipe(
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_cancel_scope_resolution_failed", { operationID }),
          }),
          onSuccess: (scope) => ({ ok: true as const, scope }),
        }),
      )
      if (!scopeResult.ok) return { ok: false, error: scopeResult.error } satisfies LcmToolErrorResult
      const scope = scopeResult.scope
      return yield* LcmMap.mapCancel({
        mapID: input.mapID,
        sessionID: input.sessionID,
        dataDir: dbResult.db.dataDir,
        operationID,
        scope,
        scheduler: mapScheduler,
      }).pipe(
        Effect.provideService(LcmDb.Service, familyDb),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error: isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_map_cancel_unhandled_failure", {
                  operationID,
                  conversationID: scope.conversationID,
                }),
          } satisfies LcmToolErrorResult),
        ),
      )
    })

    const closeRuntime = Effect.fn("LcmRuntime.close")(function* () {
      yield* closeDeferredMaintenance()
      yield* Effect.promise(() => mapScheduler.shutdown({ operationID: createOperationID() })).pipe(
        Effect.catch(() => Effect.void),
      )
      childSlots.clear()
      yield* lcmDb.close()
    })

    const sessionCleanupOwner = Symbol("lcm-session-cleanup")
    activeSessionCleanup = {
      owner: sessionCleanupOwner,
      run: (input) => Effect.runPromise(handleSessionDeleted(input)),
      close: () => Effect.runPromise(closeRuntime()),
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (activeSessionCleanup?.owner === sessionCleanupOwner) activeSessionCleanup = undefined
      }),
    )

    yield* Effect.addFinalizer(() => closeRuntime().pipe(Effect.ignore))

    return Service.of({
      getCapabilities,
      getOrCreateConversation,
      getOrCreateChildConversation,
      acquireChildSessionSlot,
      syncFinalizedMessages: (input) =>
        Effect.gen(function* () {
          const settings = yield* effectiveSettings({ sessionID: input.sessionID })
          return yield* syncFinalizedSourceMessages({ ...input, strategy: settings.state.strategy }).pipe(
            Effect.provideService(LcmDb.Service, lcmDb),
          )
        }),
      admitPathBackedFile,
      preflightBeforeModel,
      queueSoftMaintenanceAfterTurn,
      cancelDeferredMaintenance,
      diagnoseDb,
      rebuildDb,
      recoverDbLock,
      exportPrompts,
      finalizeProviderRequestSnapshot: (input) =>
        Effect.gen(function* () {
          if (input.sessionID) {
            const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
            return yield* ready.lcmDb.executeForeground({
              operationID: createOperationID(),
              purpose: "assembly",
              run: (db) =>
                finalizeProviderRequestSnapshotRow({
                  db: db as PGlite,
                  requestSnapshotID: input.requestSnapshotID,
                  status: input.status,
                  conversationID: input.conversationID,
                  nowMs: input.nowMs,
                }),
            })
          }
          if (!lcmContext) {
            return yield* Effect.fail(invalidRequest("lcm_provider_request_snapshot_context_missing"))
          }
          return yield* lcmContext.finalizeProviderRequestSnapshot(input)
        }),
      recordProviderRequestSnapshotFinalValidation: (input) =>
        Effect.gen(function* () {
          if (input.sessionID) {
            const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
            return yield* ready.lcmDb.executeForeground({
              operationID: createOperationID(),
              purpose: "assembly",
              run: (db) =>
                recordProviderRequestSnapshotFinalValidationRow({
                  db: db as PGlite,
                  requestSnapshotID: input.requestSnapshotID,
                  providerValidatorHash: input.providerValidatorHash,
                  providerFamily: input.providerFamily,
                  providerTransformOverheadTokenCount: input.providerTransformOverheadTokenCount,
                  conversationID: input.conversationID,
                }),
            })
          }
          if (!lcmContext) {
            return yield* Effect.fail(invalidRequest("lcm_provider_request_snapshot_context_missing"))
          }
          return yield* lcmContext.recordProviderRequestSnapshotFinalValidation(input)
        }),
      runManualMaintenance,
      getSettingsState,
      updateSettings,
      handleSessionDeleted,
      recordUsage: writeUsageRecord,
      getConversationScope,
      getStatus,
      getActivity,
      grep: (input) => LcmRetrieval.grep(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      describe: (input) => LcmRetrieval.describe(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      expand: (input) => LcmRetrieval.expand(input).pipe(Effect.provideService(LcmDb.Service, lcmDb)),
      expandQuery,
      read: (input) =>
        Effect.gen(function* () {
          const result = yield* LcmRetrieval.read(input).pipe(Effect.provideService(LcmDb.Service, lcmDb))
          yield* publishReadFileStatus({ sessionID: input.sessionID, result })
          return result
        }),
      exploreFile,
      llmMap,
      agenticMap,
      mapStatus,
      mapCancel,
      close: () => closeRuntime(),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(CoreDatabase.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(LcmContext.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(LcmDb.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Bus.defaultLayer),
)

const runtime = makeRuntime(Service, defaultLayer)
const { runPromise } = runtime

async function handleSessionDeletedStandalone(input: LcmSessionDeletionInput) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const sessionIDs = yield* Effect.gen(function* () {
        if (!input.recursive) return [input.sessionID]
        const ready = yield* ensureLcmDbReady(input)
        const root = yield* LcmDb.Service
        const db = LcmDb.scoped(root, ready.target)
        const rows = yield* db.executeForeground({
          operationID: createOperationID(),
          purpose: "cleanup",
          run: async (client) =>
            (
              await (client as PGlite).query<{ source_session_id: string }>(
                `
                  WITH RECURSIVE tree(conversation_id, source_session_id) AS (
                    SELECT conversation_id, source_session_id
                    FROM lcm_conversations
                    WHERE source_session_id = $1
                    UNION ALL
                    SELECT child.conversation_id, child.source_session_id
                    FROM lcm_conversations child
                    JOIN tree parent ON child.parent_conversation_id = parent.conversation_id
                  )
                  SELECT source_session_id
                  FROM tree
                `,
                [input.sessionID],
              )
            ).rows,
        })
        return [...new Set([input.sessionID, ...rows.map((row) => row.source_session_id)])]
      }).pipe(Effect.catch(() => Effect.succeed([input.sessionID])))

      const pending = createLcmFinalizedSyncPendingStore()
      for (const sessionID of sessionIDs) {
        yield* pending.delete(sessionID as RuntimeSessionID).pipe(Effect.ignore)
      }
      yield* handleLifecycleSessionDeleted(input)
    }).pipe(
      Effect.ensuring(LcmDb.Service.use((db) => db.close()).pipe(Effect.ignore)),
      Effect.provide(LcmDb.defaultLayer),
    ),
  )
}

export function getCapabilities(input: { sessionID: string }) {
  return runPromise((svc) => svc.getCapabilities(input))
}

export function getStatus(input: { sessionID: string }) {
  return runPromise((svc) => svc.getStatus(input))
}

export function getActivity(input: { sessionID: string; limit?: number }) {
  return runPromise((svc) => svc.getActivity(input))
}

export function getSettingsState(input: { sessionID?: string; projectID?: string; workspaceID?: string }) {
  return runPromise((svc) => svc.getSettingsState(input))
}

export function updateSettings(input: LcmUpdateSettingsInput) {
  return runPromise((svc) => svc.updateSettings(input))
}

export function getOrCreateConversation(input: { sessionID: string; parentSessionID?: string }) {
  return runPromise((svc) => svc.getOrCreateConversation(input))
}

export function getOrCreateChildConversation(input: Omit<LcmChildConversationInput, "dataDir">) {
  return runPromise((svc) => svc.getOrCreateChildConversation(input))
}

export function syncFinalizedMessages(input: { sessionID: string; upToMessageID?: string }) {
  return runPromise((svc) => svc.syncFinalizedMessages(input))
}

export function handleSessionDeleted(input: LcmSessionDeletionInput) {
  return activeSessionCleanup?.run(input) ?? handleSessionDeletedStandalone(input)
}

export function runManualMaintenance(input: LcmManualMaintenanceInput) {
  return runPromise((svc) => svc.runManualMaintenance(input))
}

export function queueSoftMaintenanceAfterTurn(input: LcmSoftMaintenanceAfterTurnInput) {
  return runPromise((svc) => svc.queueSoftMaintenanceAfterTurn(input))
}

export function cancelDeferredMaintenance(input: LcmCancelDeferredMaintenanceInput) {
  return runPromise((svc) => svc.cancelDeferredMaintenance(input))
}

export function diagnoseDb(input: { sessionID: string }) {
  return runPromise((svc) => svc.diagnoseDb(input))
}

export function rebuildDb(input: { sessionID: string; dryRun: boolean }) {
  return runPromise((svc) => svc.rebuildDb(input))
}

export function recoverDbLock(input: { sessionID: string; dryRun: boolean; force: boolean }) {
  return runPromise((svc) => svc.recoverDbLock(input))
}

export function exportPrompts(input: { sessionID: string; workspaceRoot: string }) {
  return runPromise((svc) => svc.exportPrompts(input))
}

export function writeUsageRecord(input: unknown) {
  return runPromise((svc) => svc.recordUsage(input))
}

export function grep(input: { sessionID: string; abortSignal?: AbortSignal } & LcmGrepInput) {
  return runPromise((svc) => svc.grep(input))
}

export function describe(input: { sessionID: string; abortSignal?: AbortSignal } & LcmDescribeInput) {
  return runPromise((svc) => svc.describe(input))
}

export function expand(input: { sessionID: string; abortSignal?: AbortSignal } & LcmExpandInput) {
  return runPromise((svc) => svc.expand(input))
}

export function exploreFile(input: {
  sessionID: string
  fileID: LcmFileID
  abortSignal?: AbortSignal
  checkPathPermission?: LcmPathPermissionCheck
  providerID?: string
  modelID?: string
}) {
  return runPromise((svc) => svc.exploreFile(input))
}

export function llmMap(
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
  } & LlmMapInput,
) {
  return runPromise((svc) => svc.llmMap(input))
}

export function agenticMap(
  input: {
    sessionID: string
    abortSignal?: AbortSignal
    sourceToolCallID?: string
    checkPathPermission?: LcmPathPermissionCheck
    providerID?: string
    modelID?: string
    childRunner: AgenticMapChildRunner
  } & AgenticMapInput,
) {
  return runPromise((svc) => svc.agenticMap(input))
}

export function mapStatus(input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapStatusInput) {
  return runPromise((svc) => svc.mapStatus(input))
}

export function mapCancel(input: { sessionID: string; abortSignal?: AbortSignal } & LcmMapCancelInput) {
  return runPromise((svc) => svc.mapCancel(input))
}

export function close() {
  const active = activeSessionCleanup
  if (!active) return runtime.dispose()
  return active.close().finally(() => {
    if (activeSessionCleanup?.owner === active.owner) activeSessionCleanup = undefined
  })
}

export * as LcmRuntime from "./runtime"
