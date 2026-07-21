// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import type { Bus } from "@/bus"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "./provider-ids"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { SessionID as RuntimeSessionID } from "../schema"
import type { SessionStatus } from "../status"
import * as LcmConfig from "./config"
import {
  type LcmHardLimitRuntimeInput,
  type LcmLeafCompactionRuntimeInput,
  type Interface as LcmContextInterface,
} from "./context"
import type { LcmDb } from "./db"
import { isLcmSafeError } from "./db-errors"
import {
  cancelQueuedDeferredSoftMaintenanceJob,
  finishDeferredSoftMaintenanceJob,
  readDeferredSoftMaintenanceJobs,
  upsertDeferredSoftMaintenanceJob,
  type LcmDeferredJobTerminalStatus,
  type LcmDeferredSoftMaintenanceJob,
} from "./deferred-jobs"
import {
  createLcmMaintenanceStartedEvent,
  LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
  LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
  LCM_BLOCKING_LEAF_MAINTENANCE_LABEL,
  LCM_BLOCKING_MAINTENANCE_LABEL,
  publishLcmEvent,
} from "./events"
import type { LcmFamilyTarget } from "./family"
import { createOperationID } from "./id"
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
  type LcmMaintenanceAttemptStatus,
  type LcmSummaryFailureBackoffRoute,
  type LcmSummaryFailureBackoffState,
  type LcmSoftSweepBudget,
} from "./maintenance-results"
import type { Interface as RuntimeInterface } from "./runtime-interface"
import type { RuntimeSummaryGenerator } from "./runtime-provider"
import {
  hardLimitProgressLabel,
  invalidRequest,
  isPromptPreparationStatus,
  isSoftThresholdContextInvalid,
  LCM_DEFERRED_MAINTENANCE_CLOSE_GRACE_MS,
  legacyReadOnly,
  lcmCountWorkspaceSoftMaintenance,
  lcmMaintenanceWorkspaceKey,
  operationTimeout,
  providerUsageFromGeneration,
  recoveryMissing,
  softMaintenanceProtectedCurrentUserTarget,
  thresholdEventFields,
  type LcmGenerationMessage,
} from "./runtime-support"
import {
  computeMaintenanceInputBudget,
  computeSummaryGenerationMaxOutputTokens,
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
} from "./summary"
import type {
  ConversationID,
  LcmCancelDeferredMaintenanceInput,
  LcmCapabilities,
  LcmMaintenanceResult,
  LcmManualMaintenanceInput,
  LcmMetricsSnapshot,
  LcmSafeError,
  LcmSettingsState,
  LcmSoftMaintenanceAfterTurnInput,
  LcmStrategy,
  LcmThresholdDecision,
  MessageRowID,
  OperationID,
} from "./types"
import { createLcmSafeError } from "./types"
import { resolveLcmModelLimits } from "./model-limits"
import type { LcmProviderCapacityPriority } from "./provider-capacity"
import { decideMaintenanceTrigger } from "./scheduler"

type RuntimeFamilyDb = {
  readonly dataDir: string
  readonly target: LcmFamilyTarget
  readonly lcmDb: LcmDb.Interface
}

type WriteSoftMaintenanceAttemptInput = {
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
}

type RuntimeMaintenanceDependencies = {
  readonly provider?: Provider.Interface
  readonly bus?: Bus.Interface
  readonly sessionStatus?: SessionStatus.Interface
  readonly getResolved: () => Effect.Effect<ReturnType<typeof LcmConfig.resolve>>
  readonly getCapabilities: RuntimeInterface["getCapabilities"]
  readonly effectiveSettings: (input: {
    sessionID?: string
    projectID?: string
    workspaceID?: string
  }) => Effect.Effect<{ state: LcmSettingsState }, LcmSafeError>
  readonly resolveSessionContext: (input: { sessionID: string }) => Effect.Effect<LcmContextInterface, LcmSafeError>
  readonly resolveSessionFamilyDb: (input: { sessionID: string }) => Effect.Effect<RuntimeFamilyDb, LcmSafeError>
  readonly writeSoftMaintenanceAttempt: (input: WriteSoftMaintenanceAttemptInput) => Effect.Effect<void, LcmSafeError>
  readonly publishMetrics: (input: {
    sessionID: string
    conversationID: ConversationID
    operationID?: OperationID
    reason: "sync" | "maintenance" | "large_file_marker"
    lastMaintenance?: LcmMaintenanceResult
  }) => Effect.Effect<LcmMetricsSnapshot | undefined>
  readonly publishTerminalMaintenance: (input: {
    sessionID: string
    conversationID: ConversationID
    operationID: OperationID
    result: LcmMaintenanceResult
    phase?: "leaf_summary" | "condensation" | "hard_limit" | "deterministic_fallback" | "repair"
    threshold?: LcmThresholdDecision
  }) => Effect.Effect<LcmMetricsSnapshot | undefined>
  readonly applyLaneLatches: (threshold: LcmThresholdDecision) => LcmThresholdDecision
  readonly clearActiveLatchesFromThreshold: (threshold: LcmThresholdDecision) => void
  readonly runLcmTextGeneration: (input: {
    readonly model: Provider.Model
    readonly language: LanguageModelV3
    readonly sessionID: string
    readonly priority: LcmProviderCapacityPriority
    readonly operationID?: OperationID
    readonly prompt: string
    readonly request?: { readonly messages: readonly LcmGenerationMessage[] }
    readonly maxOutputTokens?: number
    readonly reserveReasoningTokens?: boolean
    readonly abortSignal?: AbortSignal
  }) => Promise<{ text: string; usage: unknown }>
  readonly makeSummaryGenerator: (
    model: Provider.Model,
    sessionID: string,
    renderOptions: LcmSoftMaintenanceAfterTurnInput["renderOptions"],
    priority?: LcmProviderCapacityPriority,
    defaultMaxOutputTokens?: number,
  ) => RuntimeSummaryGenerator
}

const LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_ATTEMPTS = 3

export function manualMaintenanceEventIdentity(input: Pick<LcmManualMaintenanceInput, "reason" | "blocking">) {
  return {
    phase: "repair" as const,
    reason: input.reason,
    blocking: input.blocking,
  }
}

export function normalizeManualMaintenanceResult(
  result: LcmMaintenanceResult,
  input: Pick<LcmManualMaintenanceInput, "reason" | "blocking">,
): LcmMaintenanceResult {
  return { ...result, reason: input.reason, blocking: input.blocking }
}

/**
 * Owns all process-local soft-maintenance coordination. Keep retry timers,
 * in-flight caps, and backoff state together so teardown and deletion cannot
 * leave one representation live after another has been cleared.
 */
export function createRuntimeMaintenance(deps: RuntimeMaintenanceDependencies) {
  const {
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
  } = deps
  const softMaintenanceInFlight = new Map<string, string>()
  const softSummaryBackoffs = new Map<string, LcmSummaryFailureBackoffState>()
  const canceledSessionIDs = new Set<string>()
  const deferredSoftMaintenanceRetries = new Map<
    string,
    {
      input: LcmSoftMaintenanceAfterTurnInput
      attempts: number
      timer?: ReturnType<typeof setTimeout>
      running?: Promise<void>
    }
  >()

  const runManualMaintenance = Effect.fn("LcmRuntime.runManualMaintenance")(function* (
    input: LcmManualMaintenanceInput,
  ) {
    const operationID = createOperationID()
    const cfg = yield* getResolved()
    const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
    const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    const strategy = settings?.state.strategy ?? cfg.strategy
    const freshTailTokens = LcmConfig.RUNTIME_DEFAULTS.performance.freshTailTokens
    const conversationID = capabilities.conversationID
    const eventIdentity = manualMaintenanceEventIdentity(input)
    const manualResult = (result: LcmMaintenanceResult) => normalizeManualMaintenanceResult(result, input)

    if (capabilities.lifecycleState === "db_unavailable") {
      const safeError =
        capabilities.safeError ??
        createLcmSafeError({
          code: "db_unavailable",
          templateKey: "lcm.db.unavailable",
          safeParams: { operationID, retryable: false, action: "contact_support" },
          retryable: false,
          diagnosticCode: "lcm_maintenance_db_unavailable",
        })
      if (!conversationID) return yield* Effect.fail(safeError)
      return failedMaintenanceResult({
        conversationID,
        operationID,
        reason: input.reason,
        blocking: input.blocking,
        safeError,
      })
    }

    if (!conversationID) {
      return yield* Effect.fail(invalidRequest("lcm_maintenance_conversation_missing", { operationID }))
    }

    switch (capabilities.lifecycleState) {
      case "legacy_read_only":
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError: legacyReadOnly({ operationID, conversationID }),
        })
      case "recovery_required": {
        const safeError =
          capabilities.safeError ??
          recoveryMissing({
            operationID,
            conversationID,
            code: "recovery_required",
            retryable: true,
            action: "retry",
            diagnosticCode: "lcm_maintenance_recovery_required",
          })
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          status: "recovery_required",
          safeError,
        })
      }
      case "recovery_failed":
        return failedMaintenanceResult({
          conversationID,
          operationID,
          reason: input.reason,
          blocking: input.blocking,
          safeError: recoveryMissing({
            operationID,
            conversationID,
            code: "recovery_failed",
            retryable: false,
            action: "start_new_thread",
            diagnosticCode: "lcm_maintenance_recovery_failed",
          }),
        })
      case "passive_synced":
      case "lcm_active":
        break
    }

    if (!input.renderOptions) {
      return failedMaintenanceResult({
        conversationID,
        operationID,
        reason: input.reason,
        blocking: input.blocking,
        safeError: invalidRequest("lcm_maintenance_render_options_missing", { operationID, conversationID }),
      })
    }
    const renderOptions = input.renderOptions

    if (!provider) {
      return failedMaintenanceResult({
        conversationID,
        operationID,
        reason: input.reason,
        blocking: input.blocking,
        safeError: invalidRequest("lcm_maintenance_runtime_services_missing", { operationID, conversationID }),
      })
    }
    const contextResult = yield* resolveSessionContext({ sessionID: input.sessionID }).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          safeError: isLcmSafeError(error)
            ? error
            : invalidRequest("lcm_maintenance_context_resolution_failed", { operationID, conversationID }),
        }),
        onSuccess: (context) => ({ ok: true as const, context }),
      }),
    )
    if (!contextResult.ok) {
      return failedMaintenanceResult({
        conversationID,
        operationID,
        reason: input.reason,
        blocking: input.blocking,
        safeError: contextResult.safeError,
      })
    }
    const sessionContext = contextResult.context

    const model = yield* provider
      .getModel(ProviderID.make(renderOptions.providerID), ModelID.make(renderOptions.modelID))
      .pipe(
        Effect.catch(() =>
          Effect.fail(invalidRequest("lcm_maintenance_model_not_found", { operationID, conversationID })),
        ),
      )
    const modelLimits = resolveLcmModelLimits(model)
    const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
      providerContextLimit: modelLimits.context,
      providerOutputLimit: modelLimits.output,
    })
    const makeLeafSummaryGenerator = (priority: LcmProviderCapacityPriority) => {
      let languagePromise: Promise<LanguageModelV3> | undefined
      return async ({
        prompt,
        request,
        operationID,
        maxOutputTokens,
      }: {
        prompt: string
        request?: { readonly messages: readonly LcmGenerationMessage[] }
        operationID?: OperationID
        maxOutputTokens?: number
      }) => {
        const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
        const result = await runLcmTextGeneration({
          model,
          language,
          sessionID: input.sessionID,
          priority,
          operationID,
          prompt,
          request,
          maxOutputTokens: maxOutputTokens ?? summaryGenerationMaxOutputTokens,
        })
        return {
          text: result.text,
          usage: providerUsageFromGeneration({
            usage: result.usage,
            providerID: renderOptions.providerID,
            modelID: renderOptions.modelID,
          }),
        }
      }
    }

    let threshold = yield* sessionContext
      .isOverThreshold({
        conversationID,
        renderOptions,
        strategy,
        providerContextLimit: modelLimits.context,
        providerInputLimit: modelLimits.input,
        providerOutputLimit: modelLimits.output,
        budgetStatus: modelLimits.budgetStatus,
        freshTailTokens,
      })
      .pipe(
        Effect.catch((error: unknown) => {
          const safeError = isLcmSafeError(error)
            ? error
            : invalidRequest("lcm_maintenance_threshold_failed", { operationID, conversationID })
          return Effect.fail(safeError)
        }),
      )
    threshold = applyLaneLatches(threshold)

    const trigger = decideMaintenanceTrigger({ threshold, operationID })
    if (trigger.trigger === "hard_blocking") {
      const sessionID = input.sessionID as RuntimeSessionID
      const previousStatus = sessionStatus ? yield* sessionStatus.get(sessionID) : undefined
      const restoreStatus = isPromptPreparationStatus(previousStatus)
        ? ({ type: "idle" } as const)
        : (previousStatus ?? ({ type: "idle" } as const))

      const maintenance = yield* Effect.gen(function* () {
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
              ...eventIdentity,
              beforeTokens: threshold.activeTokens,
              ...thresholdEventFields(threshold),
              safeLabel: LCM_BLOCKING_MAINTENANCE_LABEL,
            }),
          )
        }

        const generator = makeLeafSummaryGenerator("foreground")
        const rawMaintenance = yield* sessionContext
          .compactUntilUnderHardLimit({
            sessionID: input.sessionID,
            conversationID,
            threshold,
            renderOptions,
            abortSignalID: input.abortSignalID,
            providerContextLimit: modelLimits.context,
            providerInputLimit: modelLimits.input,
            providerOutputLimit: modelLimits.output,
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
                : invalidRequest("lcm_maintenance_hard_limit_failed", { operationID, conversationID })
              return Effect.succeed(
                failedMaintenanceResult({
                  conversationID,
                  operationID,
                  reason: input.reason,
                  blocking: input.blocking,
                  safeError,
                  beforeTokens: threshold.activeTokens,
                  afterTokens: threshold.activeTokens,
                }),
              )
            }),
          )
        const maintenance = manualResult(rawMaintenance)
        if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
          clearActiveLatchesFromThreshold(threshold)
        }
        yield* publishTerminalMaintenance({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          result: maintenance,
          phase: eventIdentity.phase,
          threshold,
        })
        return maintenance
      }).pipe(
        Effect.ensuring(
          sessionStatus && restoreStatus
            ? sessionStatus.set(sessionID, restoreStatus).pipe(Effect.ignore)
            : Effect.void,
        ),
      )
      return maintenance
    }

    if (trigger.trigger === "none") {
      return {
        ...trigger.result,
        reason: input.reason,
        blocking: input.blocking,
      }
    }

    if (trigger.trigger === "soft_background") {
      if (bus) {
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceStartedEvent({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            phase: eventIdentity.phase,
            reason: eventIdentity.reason,
            status: "scheduled",
            blocking: eventIdentity.blocking,
            beforeTokens: threshold.activeTokens,
            ...thresholdEventFields(threshold),
            safeLabel: input.blocking ? LCM_BLOCKING_MAINTENANCE_LABEL : LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
          }),
        )
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceStartedEvent({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            ...eventIdentity,
            beforeTokens: threshold.activeTokens,
            ...thresholdEventFields(threshold),
            safeLabel: input.blocking ? LCM_BLOCKING_LEAF_MAINTENANCE_LABEL : LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
          }),
        )
      }
      const generator = makeLeafSummaryGenerator(input.blocking ? "foreground" : "background")
      const maintenanceInputBudget = computeMaintenanceInputBudget({
        providerContextLimit: modelLimits.context,
        providerInputLimit: modelLimits.input,
        summaryGenerationMaxOutputTokens,
      })
      const rawMaintenance = yield* sessionContext
        .compactLeavesToSprig({
          conversationID,
          reason: input.reason,
          blocking: input.blocking,
          maintenanceInputBudget,
          softThreshold: threshold.softThreshold,
          freshTailTokens,
          summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          abortSignalID: input.abortSignalID,
          operationID,
          sessionID: input.sessionID,
          providerID: input.renderOptions.providerID,
          modelID: input.renderOptions.modelID,
          generator,
        } satisfies LcmLeafCompactionRuntimeInput)
        .pipe(
          Effect.catch((error: unknown) => {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_maintenance_leaf_summary_failed", { operationID, conversationID })
            return Effect.succeed(
              failedMaintenanceResult({
                conversationID,
                operationID,
                reason: input.reason,
                blocking: input.blocking,
                safeError,
                beforeTokens: threshold.activeTokens,
                afterTokens: threshold.activeTokens,
              }),
            )
          }),
        )
      const maintenance = manualResult(rawMaintenance)
      if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
        clearActiveLatchesFromThreshold(threshold)
      }
      yield* publishTerminalMaintenance({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        result: maintenance,
        phase: eventIdentity.phase,
        threshold,
      })
      return maintenance
    }

    if (trigger.trigger === "soft_cap_deferred" && bus) {
      yield* publishLcmEvent(
        bus,
        createLcmMaintenanceStartedEvent({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          phase: eventIdentity.phase,
          reason: eventIdentity.reason,
          status: "scheduled",
          blocking: eventIdentity.blocking,
          beforeTokens: threshold.activeTokens,
          ...thresholdEventFields(threshold),
          safeLabel: trigger.result.safeMessage ?? LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
        }),
      )
    }

    return manualResult(trigger.result)
  })

  function softSummaryBackoffRoute(
    input: LcmSoftMaintenanceAfterTurnInput,
    conversationID: ConversationID,
  ): LcmSummaryFailureBackoffRoute {
    return {
      conversationID,
      purpose: "leaf_summary",
      promptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
      providerID: input.providerID,
      modelID: input.modelID,
    }
  }

  function withSoftSweepResultTelemetry(input: {
    result: LcmMaintenanceResult
    sweepBudget: LcmSoftSweepBudget
    passesCompleted: number
    nowMs?: number
    stopReason?: LcmMaintenanceResult["sweepStopReason"]
  }) {
    return lcmMaintenanceResultWithSoftSweepTelemetry(input.result, {
      budget: input.sweepBudget,
      passesCompleted: input.passesCompleted,
      nowMs: input.nowMs ?? Date.now(),
      stopReason: input.stopReason ?? lcmSoftSweepStopReasonForResult(input.result),
    })
  }

  function updateSoftSummaryBackoffForOutcome(input: {
    retryInput: LcmSoftMaintenanceAfterTurnInput
    conversationID: ConversationID
    result: LcmMaintenanceResult
    nowMs?: number
  }) {
    const route = softSummaryBackoffRoute(input.retryInput, input.conversationID)
    const key = lcmSummaryFailureBackoffKey(route)
    const nowMs = input.nowMs ?? Date.now()
    const shouldCountFailure = !!input.result.safeError && lcmShouldRetrySoftMaintenance(input.result)
    if (!shouldCountFailure) {
      if (!lcmShouldRetrySoftMaintenance(input.result)) softSummaryBackoffs.delete(key)
      return input.result
    }

    const state = lcmRecordSummaryFailureBackoff({
      route,
      state: softSummaryBackoffs.get(key),
      safeError: input.result.safeError,
      nowMs,
    })
    softSummaryBackoffs.set(key, state)
    return {
      ...input.result,
      ...lcmSummaryFailureBackoffTelemetry({ state, nowMs }),
    } satisfies LcmMaintenanceResult
  }

  const queueSoftMaintenanceAfterTurn: RuntimeInterface["queueSoftMaintenanceAfterTurn"] = Effect.fn(
    "LcmRuntime.queueSoftMaintenanceAfterTurn",
  )(function* (input: LcmSoftMaintenanceAfterTurnInput) {
    if (canceledSessionIDs.has(input.sessionID)) return undefined
    const operationID = createOperationID()
    const cfg = yield* getResolved()
    const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
    const conversationID = capabilities.conversationID
    if (!conversationID) return undefined
    const recordTerminalAttempt = (result: LcmMaintenanceResult) =>
      resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.flatMap((ready) =>
          writeSoftMaintenanceAttempt({
            familyDb: ready.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: maintenanceAttemptStatus(result),
            safeError: result.safeError,
            safeMessage: result.safeMessage,
            summarySourceTokens: result.beforeTokens,
          }),
        ),
        Effect.catch(() => Effect.void),
      )

    if (capabilities.lifecycleState !== "lcm_active") {
      const result = emptyMaintenanceResult({
        conversationID,
        operationID,
        reason: "soft_threshold",
        blocking: false,
        status: "skipped",
        workNeeded: false,
        safeMessage: "Memory maintenance was skipped because this session is not using active memory.",
      })
      yield* recordTerminalAttempt(result)
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
      return result
    }
    if (!provider) {
      const safeError = invalidRequest("lcm_soft_provider_unavailable", { operationID, conversationID })
      const result = failedMaintenanceResult({
        conversationID,
        operationID,
        reason: "soft_threshold",
        blocking: false,
        safeError,
      })
      yield* recordTerminalAttempt(result)
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
      return result
    }

    const key = conversationID
    const familyResult = yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
      Effect.match({
        onFailure: (safeError) => ({ ok: false as const, safeError }),
        onSuccess: (family) => ({ ok: true as const, family }),
      }),
    )
    if (!familyResult.ok) {
      const result = failedMaintenanceResult({
        conversationID,
        operationID,
        reason: "soft_threshold",
        blocking: false,
        safeError: familyResult.safeError,
      })
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
      yield* recordTerminalAttempt(result)
      return result
    }
    const family = familyResult.family
    const workspaceKey = lcmMaintenanceWorkspaceKey(family.target)
    if (softMaintenanceInFlight.has(key)) {
      const result = {
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: false,
        blocking: false,
        reason: "soft_threshold",
        summariesCreated: 0,
        contextItemsReplaced: 0,
        status: "deferred",
        safeMessage: "Memory maintenance is already queued for this conversation.",
      } satisfies LcmMaintenanceResult
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
      if (input.recordNoOpAttempt !== false) yield* recordTerminalAttempt(result)
      return result
    }
    if (
      lcmCountWorkspaceSoftMaintenance(softMaintenanceInFlight.values(), workspaceKey) >=
      cfg.scheduler.maxBackgroundMaintenanceModelJobsPerWorkspace
    ) {
      const result = {
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: false,
        blocking: false,
        reason: "soft_threshold",
        summariesCreated: 0,
        contextItemsReplaced: 0,
        status: "deferred",
        safeMessage: "Memory maintenance is already queued.",
      } satisfies LcmMaintenanceResult
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
      if (input.recordNoOpAttempt !== false) yield* recordTerminalAttempt(result)
      return result
    }

    softMaintenanceInFlight.set(key, workspaceKey)
    return yield* Effect.gen(function* () {
      const blockingSoftMaintenance = true
      const settings = yield* effectiveSettings({ sessionID: input.sessionID }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const sessionContext = yield* resolveSessionContext({ sessionID: input.sessionID })
      const strategy = settings?.state.strategy ?? cfg.strategy
      const freshTailTokens = input.freshTailTokens ?? LcmConfig.RUNTIME_DEFAULTS.performance.freshTailTokens
      const model = yield* provider
        .getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID))
        .pipe(
          Effect.catch(() => Effect.fail(invalidRequest("lcm_soft_model_not_found", { operationID, conversationID }))),
        )
      const modelLimits = resolveLcmModelLimits(model)
      const protectedCurrentUser = input.protectedCurrentUser
      const protectedCurrentUserMessageRowID = protectedCurrentUser
        ? yield* family.lcmDb.executeForeground({
            operationID,
            purpose: "maintenance",
            run: async (db) => {
              const rows = (
                await (db as PGlite).query<{ message_row_id: MessageRowID }>(
                  `
                  SELECT message_row_id
                  FROM lcm_messages
                  WHERE conversation_id = $1
                    AND source_session_id = $2
                    AND source_message_id = $3
                    AND role = 'user'
                    ${protectedCurrentUser.messageRowID ? "AND message_row_id = $4" : ""}
                  ORDER BY message_order DESC
                  LIMIT 1
                `,
                  protectedCurrentUser.messageRowID
                    ? [
                        conversationID,
                        protectedCurrentUser.sourceSessionID,
                        protectedCurrentUser.sourceMessageID,
                        protectedCurrentUser.messageRowID,
                      ]
                    : [conversationID, protectedCurrentUser.sourceSessionID, protectedCurrentUser.sourceMessageID],
                )
              ).rows
              return rows[0]?.message_row_id
            },
          })
        : undefined
      if (protectedCurrentUser && !protectedCurrentUserMessageRowID) {
        const result = emptyMaintenanceResult({
          conversationID,
          operationID,
          reason: "soft_threshold",
          blocking: blockingSoftMaintenance,
          status: "skipped",
          workNeeded: true,
          safeMessage:
            "Memory maintenance was skipped because the current user boundary is not available as a raw memory row.",
        })
        if (input.recordNoOpAttempt !== false) {
          yield* writeSoftMaintenanceAttempt({
            familyDb: family.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: "skipped",
            safeMessage: result.safeMessage,
          })
        }
        yield* publishMetrics({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          reason: "maintenance",
          lastMaintenance: result,
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }
      const targetCurrentUser =
        protectedCurrentUser && protectedCurrentUserMessageRowID
          ? softMaintenanceProtectedCurrentUserTarget({
              protectedCurrentUser,
              messageRowID: protectedCurrentUserMessageRowID,
              operationID,
            })
          : undefined
      const thresholdInput = () => ({
        conversationID,
        renderOptions: input.renderOptions,
        strategy,
        providerContextLimit: modelLimits.context,
        providerInputLimit: modelLimits.input,
        providerOutputLimit: modelLimits.output,
        budgetStatus: modelLimits.budgetStatus,
        freshTailTokens,
        ...(targetCurrentUser ? { targetCurrentUser } : {}),
      })
      const readThreshold = () =>
        sessionContext.isOverThreshold(thresholdInput()).pipe(
          Effect.map((threshold) => ({ ok: true as const, threshold })),
          Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
        )
      let thresholdAttempt = yield* readThreshold()
      if (!thresholdAttempt.ok && isSoftThresholdContextInvalid(thresholdAttempt.safeError)) {
        const recovery = yield* sessionContext
          .rebuildActiveContext({
            conversationID,
            reason: "soft_maintenance_threshold",
            strategy,
          })
          .pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((safeError) => Effect.succeed({ ok: false as const, safeError })),
          )
        if (!recovery.ok) return yield* Effect.fail(recovery.safeError)
        if (recovery.result.safeError) return yield* Effect.fail(recovery.result.safeError)
        thresholdAttempt = yield* readThreshold()
      }
      if (!thresholdAttempt.ok) return yield* Effect.fail(thresholdAttempt.safeError)
      let threshold = applyLaneLatches(thresholdAttempt.threshold)
      if (!threshold.overSoft || threshold.softBacklogItemCount <= 0 || threshold.softBacklogTokens <= 0) {
        const result = updateSoftSummaryBackoffForOutcome({
          retryInput: input,
          conversationID,
          result: emptyMaintenanceResult({
            conversationID,
            operationID,
            reason: "soft_threshold",
            blocking: blockingSoftMaintenance,
            status: "no_op",
            workNeeded: false,
            beforeTokens: threshold.activeTokens,
            afterTokens: threshold.activeTokens,
            safeMessage: "Memory maintenance was no longer needed when the background job ran.",
          }),
        })
        if (input.recordNoOpAttempt !== false) {
          yield* writeSoftMaintenanceAttempt({
            familyDb: family.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: "no_op",
            safeMessage: result.safeMessage,
            summarySourceTokens: result.beforeTokens,
          })
        }
        yield* publishMetrics({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          reason: "sync",
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }

      const sweepBudget = createLcmSoftSweepBudget({
        maxPasses: cfg.performance.softSweepMaxPasses,
        maxElapsedMs: cfg.performance.softSweepMaxElapsedMs,
      })
      const backoffRoute = softSummaryBackoffRoute(input, conversationID)
      const backoffState = softSummaryBackoffs.get(lcmSummaryFailureBackoffKey(backoffRoute))
      const backoffRemainingMs = lcmSummaryFailureBackoffRemainingMs({
        state: backoffState,
        nowMs: Date.now(),
      })
      if (backoffState && backoffRemainingMs > 0) {
        const result = withSoftSweepResultTelemetry({
          result: {
            ...emptyMaintenanceResult({
              conversationID,
              operationID,
              reason: "soft_threshold",
              blocking: blockingSoftMaintenance,
              status: "deferred",
              workNeeded: true,
              beforeTokens: threshold.activeTokens,
              afterTokens: threshold.activeTokens,
              safeMessage: "Memory maintenance is cooling down after repeated summary failures.",
            }),
            ...lcmSummaryFailureBackoffTelemetry({ state: backoffState, nowMs: Date.now() }),
          },
          sweepBudget,
          passesCompleted: 0,
          stopReason: "backoff",
        })
        if (input.recordNoOpAttempt !== false) {
          yield* writeSoftMaintenanceAttempt({
            familyDb: family.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: "deferred",
            safeMessage: result.safeMessage,
            summarySourceTokens: result.beforeTokens,
          })
        }
        yield* publishTerminalMaintenance({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          result,
          phase: "leaf_summary",
          threshold,
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }

      const startDecision = lcmSoftSweepShouldStartPass({
        budget: sweepBudget,
        passesCompleted: 0,
        nowMs: Date.now(),
      })
      if (!startDecision.canStart) {
        const safeError =
          startDecision.stopReason === "elapsed_cap"
            ? operationTimeout({
                diagnosticCode: "lcm_soft_maintenance_sweep_elapsed_cap",
                operationID,
                conversationID,
              })
            : undefined
        const result = withSoftSweepResultTelemetry({
          result: emptyMaintenanceResult({
            conversationID,
            operationID,
            reason: "soft_threshold",
            blocking: blockingSoftMaintenance,
            status: "deferred",
            workNeeded: true,
            beforeTokens: threshold.activeTokens,
            afterTokens: threshold.activeTokens,
            safeMessage:
              startDecision.stopReason === "elapsed_cap"
                ? "Memory maintenance paused because the sweep time budget was exhausted."
                : "Memory maintenance paused because the sweep pass budget was exhausted.",
            ...(safeError ? { safeError } : {}),
          }),
          sweepBudget,
          passesCompleted: 0,
          nowMs: Date.now(),
          stopReason: startDecision.stopReason,
        })
        if (input.recordNoOpAttempt !== false) {
          yield* writeSoftMaintenanceAttempt({
            familyDb: family.lcmDb,
            sessionID: input.sessionID,
            conversationID,
            operationID,
            providerID: input.providerID,
            modelID: input.modelID,
            status: "deferred",
            safeError: result.safeError,
            safeMessage: result.safeMessage,
            summarySourceTokens: result.beforeTokens,
          })
        }
        yield* publishTerminalMaintenance({
          sessionID: input.sessionID,
          conversationID,
          operationID,
          result,
          phase: "leaf_summary",
          threshold,
        })
        yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
        return result
      }

      const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
        providerContextLimit: modelLimits.context,
        providerOutputLimit: modelLimits.output,
      })
      const maintenanceInputBudget = computeMaintenanceInputBudget({
        providerContextLimit: modelLimits.context,
        providerInputLimit: modelLimits.input,
        summaryGenerationMaxOutputTokens,
      })

      if (input.recordNoOpAttempt !== false) {
        yield* writeSoftMaintenanceAttempt({
          familyDb: family.lcmDb,
          sessionID: input.sessionID,
          conversationID,
          operationID,
          providerID: input.providerID,
          modelID: input.modelID,
          status: "scheduled",
          safeMessage: blockingSoftMaintenance
            ? LCM_BLOCKING_LEAF_MAINTENANCE_LABEL
            : LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
          summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          maintenanceInputBudget,
          summarySourceTokens: threshold.activeTokens,
        })
      }

      if (bus) {
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceStartedEvent({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            phase: "leaf_summary",
            reason: "soft_threshold",
            status: "scheduled",
            blocking: blockingSoftMaintenance,
            beforeTokens: threshold.activeTokens,
            ...thresholdEventFields(threshold),
            sweepMaxPasses: sweepBudget.maxPasses,
            sweepMaxElapsedMs: sweepBudget.maxElapsedMs,
            summaryPromptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
            summaryBackoffPurpose: "leaf_summary",
            safeLabel: blockingSoftMaintenance
              ? LCM_BLOCKING_MAINTENANCE_LABEL
              : LCM_BACKGROUND_MAINTENANCE_PENDING_LABEL,
          }),
        )
        yield* publishLcmEvent(
          bus,
          createLcmMaintenanceStartedEvent({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            phase: "leaf_summary",
            reason: "soft_threshold",
            blocking: blockingSoftMaintenance,
            beforeTokens: threshold.activeTokens,
            ...thresholdEventFields(threshold),
            sweepMaxPasses: sweepBudget.maxPasses,
            sweepMaxElapsedMs: sweepBudget.maxElapsedMs,
            summaryPromptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
            summaryBackoffPurpose: "leaf_summary",
            safeLabel: blockingSoftMaintenance
              ? LCM_BLOCKING_LEAF_MAINTENANCE_LABEL
              : LCM_BACKGROUND_MAINTENANCE_RUNNING_LABEL,
          }),
        )
      }

      const rawMaintenance = yield* sessionContext
        .compactLeavesToSprig({
          conversationID,
          reason: "soft_threshold",
          blocking: blockingSoftMaintenance,
          maintenanceInputBudget,
          softThreshold: threshold.softThreshold,
          freshTailTokens,
          summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          abortSignalID: input.abortSignalID,
          operationID,
          sessionID: input.sessionID,
          providerID: input.providerID,
          modelID: input.modelID,
          protectedCurrentUser: input.protectedCurrentUser,
          generator: makeSummaryGenerator(
            model,
            input.sessionID,
            input.renderOptions,
            "foreground",
            summaryGenerationMaxOutputTokens,
          ),
        } satisfies LcmLeafCompactionRuntimeInput)
        .pipe(
          Effect.catch((error: unknown) => {
            const safeError = isLcmSafeError(error)
              ? error
              : invalidRequest("lcm_soft_leaf_summary_failed", { operationID, conversationID })
            return Effect.succeed(
              failedMaintenanceResult({
                conversationID,
                operationID,
                reason: "soft_threshold",
                blocking: blockingSoftMaintenance,
                safeError,
                beforeTokens: threshold.activeTokens,
                afterTokens: threshold.activeTokens,
              }),
            )
          }),
        )
      const maintenance = updateSoftSummaryBackoffForOutcome({
        retryInput: input,
        conversationID,
        result: withSoftSweepResultTelemetry({
          result: rawMaintenance,
          sweepBudget,
          passesCompleted: 1,
        }),
      })
      yield* writeSoftMaintenanceAttempt({
        familyDb: family.lcmDb,
        sessionID: input.sessionID,
        conversationID,
        operationID,
        providerID: input.providerID,
        modelID: input.modelID,
        status: maintenanceAttemptStatus(maintenance),
        safeError: maintenance.safeError,
        safeMessage: maintenance.safeMessage,
        summaryTargetTokens: LcmConfig.RUNTIME_DEFAULTS.performance.summaryTargetTokens,
        summaryGenerationMaxOutputTokens,
        maintenanceInputBudget,
        summarySourceTokens: maintenance.beforeTokens ?? threshold.activeTokens,
      })

      if (maintenance.status === "failed" || maintenance.status === "canceled" || maintenance.safeError) {
        clearActiveLatchesFromThreshold(threshold)
      }

      yield* publishTerminalMaintenance({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        result: maintenance,
        phase: "leaf_summary",
        threshold,
      })
      yield* handleSoftMaintenanceRetryOutcome(input, conversationID, maintenance)
      return maintenance
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.gen(function* () {
          const safeError = isLcmSafeError(error)
            ? error
            : invalidRequest("lcm_soft_maintenance_failed", { operationID, conversationID })
          const result = failedMaintenanceResult({
            conversationID,
            operationID,
            reason: "soft_threshold",
            blocking: true,
            safeError,
          })
          yield* recordTerminalAttempt(result)
          yield* publishTerminalMaintenance({
            sessionID: input.sessionID,
            conversationID,
            operationID,
            result,
            phase: "leaf_summary",
          })
          yield* handleSoftMaintenanceRetryOutcome(input, conversationID, result)
          return result
        }),
      ),
      Effect.ensuring(Effect.sync(() => softMaintenanceInFlight.delete(key))),
    )
  })

  function shouldRetrySoftMaintenance(result: LcmMaintenanceResult): boolean {
    return lcmShouldRetrySoftMaintenance(result)
  }

  function deferredJobTerminalStatus(result: LcmMaintenanceResult): LcmDeferredJobTerminalStatus {
    if (result.status === "canceled") return "canceled"
    if (result.status === "failed" || result.status === "recovery_required") return "failed"
    return "completed"
  }

  function clearDeferredSoftMaintenanceRetry(conversationID: ConversationID, result?: LcmMaintenanceResult) {
    return Effect.gen(function* () {
      const deferred = deferredSoftMaintenanceRetries.get(conversationID)
      yield* Effect.sync(() => {
        if (deferred?.timer) clearTimeout(deferred.timer)
        deferredSoftMaintenanceRetries.delete(conversationID)
      })
      if (!result) return
      const input = deferred?.input
      if (!input) return
      yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.flatMap((ready) =>
          ready.lcmDb.execute({
            operationID: createOperationID(),
            lane: "background",
            purpose: "maintenance",
            run: async (db) =>
              finishDeferredSoftMaintenanceJob({
                db: db as PGlite,
                conversationID,
                status: deferredJobTerminalStatus(result),
                safeError: result.safeError,
                safeMessage: result.safeMessage,
              }),
          }),
        ),
        Effect.catch(() => Effect.void),
      )
    })
  }

  function scheduleDeferredSoftMaintenanceTimer(input: {
    retryInput: LcmSoftMaintenanceAfterTurnInput
    conversationID: ConversationID
    attempts: number
    delayMs: number
  }) {
    return Effect.sync(() => {
      const existing = deferredSoftMaintenanceRetries.get(input.conversationID)
      if (existing?.timer) return

      const timer = setTimeout(() => {
        const scheduled = deferredSoftMaintenanceRetries.get(input.conversationID)
        if (!scheduled || scheduled.timer !== timer) return
        deferredSoftMaintenanceRetries.set(input.conversationID, { ...scheduled, timer: undefined })
        const running = Effect.runPromise(queueSoftMaintenanceAfterTurn(scheduled.input))
          .then((result) => {
            if (!result || !shouldRetrySoftMaintenance(result)) {
              const current = deferredSoftMaintenanceRetries.get(input.conversationID)
              if (current?.running === running) deferredSoftMaintenanceRetries.delete(input.conversationID)
            }
          })
          .catch(() => {
            const current = deferredSoftMaintenanceRetries.get(input.conversationID)
            if (current?.running === running) deferredSoftMaintenanceRetries.delete(input.conversationID)
          })
        deferredSoftMaintenanceRetries.set(input.conversationID, { ...scheduled, timer: undefined, running })
      }, input.delayMs)
      ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
      deferredSoftMaintenanceRetries.set(input.conversationID, {
        input: input.retryInput,
        attempts: input.attempts,
        timer,
      })
    })
  }

  function scheduleDeferredSoftMaintenanceRetry(
    input: LcmSoftMaintenanceAfterTurnInput,
    conversationID: ConversationID,
    result: LcmMaintenanceResult,
  ) {
    return Effect.gen(function* () {
      const existing = deferredSoftMaintenanceRetries.get(conversationID)
      if (existing?.timer) return

      const attempts = (existing?.attempts ?? 0) + 1
      if (attempts > LCM_SOFT_MAINTENANCE_DEFERRED_RETRY_MAX_ATTEMPTS) {
        yield* clearDeferredSoftMaintenanceRetry(conversationID, {
          ...result,
          status: result.status === "deferred" ? "failed" : result.status,
          safeMessage: result.safeMessage ?? "Memory maintenance retry limit reached.",
        })
        return
      }

      const retryInput = { ...input, renderOptions: { ...input.renderOptions } }
      const delayMs = Math.max(lcmDeferredSoftMaintenanceRetryDelayMs(attempts), result.summaryBackoffRemainingMs ?? 0)
      const nextRunAtMs = Date.now() + delayMs
      yield* resolveSessionFamilyDb({ sessionID: input.sessionID }).pipe(
        Effect.flatMap((ready) =>
          ready.lcmDb.execute({
            operationID: createOperationID(),
            lane: "background",
            purpose: "maintenance",
            run: async (db) =>
              upsertDeferredSoftMaintenanceJob({
                db: db as PGlite,
                conversationID,
                retryInput,
                attemptCount: attempts,
                nextRunAtMs,
                safeError: result.safeError,
                safeMessage: result.safeMessage,
              }),
          }),
        ),
        Effect.catch(() => Effect.void),
      )
      yield* scheduleDeferredSoftMaintenanceTimer({
        retryInput,
        conversationID,
        attempts,
        delayMs,
      })
    })
  }

  const resumeDeferredSoftMaintenanceRetries = Effect.fn("LcmRuntime.resumeDeferredSoftMaintenanceRetries")(
    function* (input: { sessionID: string }) {
      const ready = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
      const jobs = yield* ready.lcmDb.execute({
        operationID: createOperationID(),
        lane: "background",
        purpose: "maintenance",
        run: async (db) =>
          readDeferredSoftMaintenanceJobs({
            db: db as PGlite,
            sessionID: input.sessionID,
          }),
      })
      for (const job of jobs) {
        yield* schedulePersistedDeferredSoftMaintenanceRetry(job)
      }
    },
  )

  function schedulePersistedDeferredSoftMaintenanceRetry(job: LcmDeferredSoftMaintenanceJob) {
    if (deferredSoftMaintenanceRetries.has(job.conversationID)) return Effect.void
    const retryInput = {
      sessionID: job.sessionID,
      providerID: job.providerID,
      modelID: job.modelID,
      renderOptions: { ...job.renderOptions },
      ...(job.protectedCurrentUser ? { protectedCurrentUser: job.protectedCurrentUser } : {}),
    } satisfies LcmSoftMaintenanceAfterTurnInput
    return scheduleDeferredSoftMaintenanceTimer({
      retryInput,
      conversationID: job.conversationID,
      attempts: job.attemptCount,
      delayMs: Math.max(0, job.nextRunAtMs - Date.now()),
    })
  }

  function handleSoftMaintenanceRetryOutcome(
    input: LcmSoftMaintenanceAfterTurnInput,
    conversationID: ConversationID,
    result: LcmMaintenanceResult,
  ) {
    if (canceledSessionIDs.has(input.sessionID)) return clearDeferredSoftMaintenanceRetry(conversationID)
    return shouldRetrySoftMaintenance(result)
      ? scheduleDeferredSoftMaintenanceRetry(input, conversationID, result)
      : clearDeferredSoftMaintenanceRetry(conversationID, result)
  }

  const cancelDeferredMaintenance: RuntimeInterface["cancelDeferredMaintenance"] = Effect.fn(
    "LcmRuntime.cancelDeferredMaintenance",
  )(function* (input: LcmCancelDeferredMaintenanceInput) {
    const operationID = createOperationID()
    const capabilities = yield* getCapabilities({ sessionID: input.sessionID })
    const conversationID = capabilities.conversationID
    if (!conversationID) {
      return yield* Effect.fail(invalidRequest("lcm_cancel_deferred_conversation_missing", { operationID }))
    }

    const scheduled = deferredSoftMaintenanceRetries.get(conversationID)
    if (scheduled && !scheduled.timer) {
      return emptyMaintenanceResult({
        conversationID,
        operationID,
        reason: "soft_threshold",
        blocking: false,
        status: "no_op",
        workNeeded: false,
        safeMessage: "Memory maintenance is already running and will finish in background.",
      })
    }

    const family = yield* resolveSessionFamilyDb({ sessionID: input.sessionID })
    const safeMessage = "Queued memory maintenance retry was canceled."
    const canceledInMemory = yield* Effect.sync(() => {
      const current = deferredSoftMaintenanceRetries.get(conversationID)
      if (!current?.timer) return false
      clearTimeout(current.timer)
      deferredSoftMaintenanceRetries.delete(conversationID)
      return true
    })
    const canceledPersisted = yield* family.lcmDb.execute({
      operationID,
      lane: "background",
      purpose: "maintenance",
      run: async (db) =>
        cancelQueuedDeferredSoftMaintenanceJob({
          db: db as PGlite,
          conversationID,
          safeMessage,
        }),
    })

    const canceled = canceledInMemory || canceledPersisted
    const result = emptyMaintenanceResult({
      conversationID,
      operationID,
      reason: "soft_threshold",
      blocking: false,
      status: canceled ? "canceled" : "no_op",
      workNeeded: canceled,
      safeMessage: canceled ? safeMessage : "No queued memory maintenance retry was found.",
    })

    yield* writeSoftMaintenanceAttempt({
      familyDb: family.lcmDb,
      sessionID: input.sessionID,
      conversationID,
      operationID,
      status: maintenanceAttemptStatus(result),
      safeMessage: result.safeMessage,
    }).pipe(Effect.catch(() => Effect.void))

    if (canceled) {
      yield* publishTerminalMaintenance({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        result,
        phase: "leaf_summary",
      })
    } else {
      yield* publishMetrics({
        sessionID: input.sessionID,
        conversationID,
        operationID,
        reason: "maintenance",
        lastMaintenance: result,
      })
    }

    return result
  })

  const cancelSessionMaintenance = Effect.fn("LcmRuntime.cancelSessionMaintenance")(function* (input: {
    sessionID: string
  }) {
    yield* Effect.sync(() => {
      canceledSessionIDs.add(input.sessionID)
      for (const [conversationID, deferred] of deferredSoftMaintenanceRetries) {
        if (deferred.input.sessionID !== input.sessionID || !deferred.timer) continue
        clearTimeout(deferred.timer)
        deferredSoftMaintenanceRetries.delete(conversationID)
      }
    })
  })

  const close = Effect.fn("LcmRuntime.closeDeferredMaintenance")(function* () {
    const running = yield* Effect.sync(() => {
      const running: Promise<void>[] = []
      for (const deferred of deferredSoftMaintenanceRetries.values()) {
        if (deferred.timer) clearTimeout(deferred.timer)
        else if (deferred.running) running.push(deferred.running)
      }
      softSummaryBackoffs.clear()
      canceledSessionIDs.clear()
      return running
    })
    if (running.length) {
      yield* Effect.promise(() =>
        Promise.race([
          Promise.allSettled(running),
          new Promise<void>((resolve) => setTimeout(resolve, LCM_DEFERRED_MAINTENANCE_CLOSE_GRACE_MS)),
        ]),
      ).pipe(Effect.catch(() => Effect.void))
    }
    yield* Effect.sync(() => deferredSoftMaintenanceRetries.clear())
  })

  return {
    runManualMaintenance,
    queueSoftMaintenanceAfterTurn,
    cancelDeferredMaintenance,
    resumeDeferredSoftMaintenanceRetries,
    cancelSessionMaintenance,
    close,
  }
}
