// kilocode_change - new file; extracted from the LCM context service
import type { PGlite } from "@electric-sql/pglite"
import { Context, Effect, Layer } from "effect"
import { LcmDb } from "./db"
import { stableHash } from "./hash"
import { createOperationID } from "./id"
import { RUNTIME_DEFAULTS } from "./config"
import { prepareKiloModelInput } from "./render-prep"
import { classifyLcmProviderFamily } from "./provider-protocol"
import { isLcmProviderCapacityDeferredError } from "./provider-capacity"
import { allocateContextItemID } from "./id-allocation"
import { failIfOperationCanceled, operationTimeout, throwIfOperationCanceled } from "./operation-control"
import { loadProviderTransformOverheadReserve, providerInputLimitWithTransformReserve } from "./provider-overhead"
import {
  LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
  computeSummaryGenerationMaxOutputTokens,
  isLcmSummaryObjectiveFailedError,
  runCondenseSummaryGeneration,
  runLeafSummaryGeneration,
  summaryTinyTokenFloor,
  type LcmSummaryCondenseGenerator,
} from "./summary"
import { validateBoundaryMetadataV1 } from "./validators"
import type {
  ContextItem,
  ConversationID,
  LcmAssemblyInput,
  LcmAssemblyResult,
  LcmLifecycleState,
  LcmMaintenanceResult,
  LcmProviderRequestSnapshotTerminalStatus,
  LcmRecoveryResult,
  LcmRenderedSpan,
  LcmRenderedSpanProviderFamily,
  LcmRetrievalCuePayload,
  LcmSafeError,
  LcmStrategy,
  LcmThresholdDecision,
  LcmValidatedModelMessages,
  MessageRowID,
  OperationID,
  SessionID,
} from "./types"
import {
  computeThresholdDecision,
  createDeterministicFallbackTokenCounter,
  renderManifestHash,
  type LcmTokenCounter,
} from "./token-budget"
import type { LcmRuntimePreparedProviderPayload } from "./provider-payload"
import {
  contextRowsSemanticHash,
  conversationAuthorityHash,
  type ContextRow,
  hardLimitUnresolved,
  hasRawLeafRenderPreparation,
  hasRawLeafThresholdPreparation,
  invalidRequest,
  isRetrievalCuePayload,
  jsonValue,
  type LcmHardLimitProgress,
  type LcmHardLimitRuntimeInput,
  type LcmLeafCompactionRuntimeInput,
  type LcmRawLeafThresholdInput,
  type LcmRenderUnit,
  lcmSafeError,
  type LcmThresholdRuntimeInput,
  loadRawLeafMessageEntries,
  modelVisibleSourceStateHash,
  missingSource,
  type ProviderSafeSnapshotEvidence,
  type Queryable,
  rawLeafNormalizedParityKey,
  recoveryRequired,
  type SummaryCondensePromptVersion,
  thresholdAssemblyCache,
  type ThresholdAssemblyCache,
  type ThresholdContextItemCount,
  thresholdTokenCounter,
  tokenBudgetDiagnostic,
  tokenBudgetInput,
  type Transactional,
  validateRenderOptionAliases,
} from "./context-core"
import {
  buildRenderUnits,
  computeSoftBacklogFromCounted,
  loadStandaloneLargeFileMarkerMessages,
  loadSummaryWrapperMessages,
  loadVisibilityProvenance,
  manifestWithAssemblyHashes,
  renderedSpanForUnit,
  renderPrefixCounts,
  validateAssemblyPayload,
  withRenderUnitOrigins,
} from "./context-render"
import {
  countAssemblyActiveTokens,
  countContextItems,
  countThresholdFromAssembly,
  loadThresholdSource,
  overheadCacheKey,
  renderUnitSnapshotItemsFromContextItems,
  targetMessageRowIDForSoftBacklog,
  thresholdSourceSemanticHash,
} from "./context-budget"
import {
  createProviderRequestSnapshot,
  cueGenerationID,
  cueRowID,
  durableRebuild,
  finalizeProviderRequestSnapshotRow,
  findConversation,
  findSourceMessageRowID,
  insertContextRow,
  loadConsumedRawMessageRowIDs,
  loadContextRows,
  persistThresholdCounts,
  providerRequestSnapshotID,
  recordProviderRequestSnapshotFinalValidationRow,
  requestSnapshotProtectionForConversation,
  restoreFromSnapshots,
  validateContextRows,
  writeContextSnapshot,
} from "./context-state"
import {
  artifactRootFromDataDir,
  commitLeafSummary,
  commitSummaryCondensation,
  createArchiveStub,
  insertMaintenanceUsageEvidence,
  insertSummaryMaintenanceUsageRecord,
  isLeafSummarySkippedSelection,
  markRecoveryFailed,
  selectLeafSummarySource,
  selectSummaryCondenseSource,
  usageModeForLeafSummary,
  usagePurposeForSummary,
} from "./context-maintenance"

// Maintainer boundary: This facade owns Effect service orchestration. The semantic modules below own reconstruction, rendering, budgets, durable state, and maintenance commits.

export {
  LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE,
  LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION,
  LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
  LCM_CONTEXT_RESTORE_MANIFEST_VERSION,
  LCM_CONTEXT_SHELL_TOKEN_COUNTER_MODE,
  LCM_CONTEXT_SHELL_TOKEN_COUNTER_VERSION,
  createProviderTransformOverheadRenderUnitID,
  inheritThresholdAssemblyCache,
  normalizeModelMessagesForRawLeafParity,
  rawLeafNormalizedParityKey,
} from "./context-core"
export type {
  LcmHardLimitProgress,
  LcmHardLimitProgressPhase,
  LcmHardLimitRuntimeInput,
  LcmLeafCompactionRuntimeInput,
  LcmRawLeafAssemblyInput,
  LcmRawLeafRenderPreparationInput,
  LcmRawLeafThresholdInput,
  LcmThresholdRuntimeInput,
} from "./context-core"
export { validateLcmPreparedProviderPayloadForAssembly } from "./context-render"
export {
  appendRawMessageContextItems,
  finalizeProviderRequestSnapshotRow,
  recordProviderRequestSnapshotFinalValidationRow,
  writeContextSnapshot,
} from "./context-state"

// Maintainer boundary: this service owns derived context state. Keep provider
// snapshot lifecycle, hard-limit convergence, retrieval cue placement, and raw
// leaf rendering changes covered by the focused LCM suites before moving code
// across this boundary.
export interface Interface {
  readonly runtimeDbBinding?: "lcm_context_layer"
  readonly getCurrentContext: (input: {
    conversationID: string
    abortSignal?: AbortSignal
  }) => Effect.Effect<ContextItem[], LcmSafeError>
  readonly rebuildActiveContext: (input: {
    conversationID: string
    reason: string
    strategy?: LcmStrategy
    abortSignal?: AbortSignal
  }) => Effect.Effect<LcmRecoveryResult, LcmSafeError>
  readonly replaceRetrievalCues: (input: {
    conversationID: string
    targetCurrentUserSourceMessageID: string
    cuePayloads: readonly LcmRetrievalCuePayload[]
    abortSignal?: AbortSignal
    nowMs?: number
  }) => Effect.Effect<{ insertedCues: number }, LcmSafeError>
  readonly finalizeProviderRequestSnapshot: (input: {
    requestSnapshotID: string
    status: LcmProviderRequestSnapshotTerminalStatus
    conversationID?: ConversationID
    nowMs?: number
  }) => Effect.Effect<void, LcmSafeError>
  readonly recordProviderRequestSnapshotFinalValidation: (input: {
    requestSnapshotID: string
    providerValidatorHash: string
    providerFamily?: LcmRenderedSpanProviderFamily
    providerTransformOverheadTokenCount?: number
    conversationID?: ConversationID
  }) => Effect.Effect<void, LcmSafeError>
  readonly assembleModelMessages: (
    input: LcmAssemblyInput & { readonly abortSignal?: AbortSignal },
  ) => Effect.Effect<LcmAssemblyResult, LcmSafeError>
  readonly isOverThreshold: (input: LcmThresholdRuntimeInput) => Effect.Effect<LcmThresholdDecision, LcmSafeError>
  readonly compactLeavesToSprig: (
    input: LcmLeafCompactionRuntimeInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
  readonly compactUntilUnderHardLimit: (
    input: LcmHardLimitRuntimeInput,
  ) => Effect.Effect<LcmMaintenanceResult, LcmSafeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LcmContext") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lcmDb = yield* LcmDb.Service

    const getCurrentContext = Effect.fn("LcmContext.getCurrentContext")(function* (input: {
      conversationID: string
      abortSignal?: AbortSignal
    }) {
      const status = yield* lcmDb.getStatus()
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(db as PGlite, conversationID)
          if (!conversation) throw invalidRequest("lcm_context_conversation_not_found")
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            throw recoveryRequired("lcm_context_boundary_invalid", conversationID)
          }
          const rows = await loadContextRows(db as PGlite, conversationID)
          const validation = await validateContextRows({
            db: db as PGlite,
            conversationID,
            rows,
            allowEmpty: true,
            artifactRoot: artifactRootFromDataDir(status.dataDir),
          })
          if (!validation.ok)
            throw recoveryRequired(`lcm_context_invalid_${validation.reason ?? "unknown"}`, conversationID)
          return validation.items ?? []
        },
      })
    })

    const replaceRetrievalCues = Effect.fn("LcmContext.replaceRetrievalCues")(function* (input: {
      conversationID: string
      targetCurrentUserSourceMessageID: string
      cuePayloads: readonly LcmRetrievalCuePayload[]
      abortSignal?: AbortSignal
      nowMs?: number
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite & Transactional
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(typedDb, conversationID)
          if (!conversation) throw invalidRequest("lcm_retrieval_cue_conversation_not_found")
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            throw recoveryRequired("lcm_retrieval_cue_boundary_invalid", conversationID)
          }
          const now = input.nowMs ?? Date.now()
          await typedDb.transaction(async (tx) => {
            const protection = await requestSnapshotProtectionForConversation({ db: tx, conversationID, nowMs: now })
            const protectedCueIDs = new Set(protection.protectedCueIDs)
            const currentRows = await loadContextRows(tx, conversationID, { includeInactiveCues: true })
            const nonCueRows = currentRows.filter((row) => row.item_type !== "retrieval_cue")
            const cueRows = currentRows.filter((row) => row.item_type === "retrieval_cue")
            const activeCueRows = cueRows.filter((row) => row.cue_lifecycle_state === "active")
            const sameTargetRetry =
              activeCueRows.length > 0 &&
              activeCueRows.every((row) => row.cue_target_source_message_id === input.targetCurrentUserSourceMessageID)
            const activeCueIDsToSupersede = new Set(
              activeCueRows
                .filter((row) =>
                  sameTargetRetry ? row.cue_target_source_message_id === input.targetCurrentUserSourceMessageID : true,
                )
                .map((row) => row.context_item_id),
            )
            const generationID = cueGenerationID()
            const newCueRows: ContextRow[] = []
            for (const cuePayload of input.cuePayloads) {
              if (!isRetrievalCuePayload(cuePayload)) throw invalidRequest("lcm_retrieval_cue_payload_invalid")
              newCueRows.push({
                context_item_id: await allocateContextItemID(tx),
                conversation_id: conversationID,
                item_order: 0,
                item_type: "retrieval_cue",
                message_row_id: null,
                summary_id: null,
                pointer_id: null,
                file_id: null,
                cue_id: cueRowID(),
                cue_payload_json: cuePayload,
                cue_lifecycle_state: "active",
                cue_superseded_by_id: null,
                cue_superseded_by_generation_id: null,
                cue_target_source_message_id: input.targetCurrentUserSourceMessageID,
                cue_generation_id: generationID,
                token_count: cuePayload.tokenCount,
                cache_key: null,
                cache_version: null,
                created_at_ms: now,
                updated_at_ms: now,
              })
            }
            let supersedeIndex = 0
            const oneToOneSuccessors = activeCueIDsToSupersede.size === newCueRows.length
            const supersededRows = cueRows.map((row): ContextRow => {
              if (!activeCueIDsToSupersede.has(row.context_item_id)) return row
              const directSuccessor = oneToOneSuccessors ? newCueRows[supersedeIndex] : undefined
              supersedeIndex++
              return {
                ...row,
                cue_lifecycle_state: "superseded",
                cue_superseded_by_id: directSuccessor?.cue_id ?? null,
                cue_superseded_by_generation_id: generationID,
                updated_at_ms: now,
              }
            })
            const retainedCueRows = supersededRows.flatMap((row): ContextRow[] => {
              const cueID = row.cue_id
              const protectedBySnapshot = cueID ? protectedCueIDs.has(cueID) : false
              const lifecycle = row.cue_lifecycle_state
              if (lifecycle === "active") return [row]
              if (protectedBySnapshot) return [row]
              return []
            })
            const nextRows = [...nonCueRows, ...newCueRows, ...retainedCueRows]
            await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])
            for (const [index, row] of nextRows.entries()) {
              await insertContextRow(tx, {
                ...row,
                item_order: index + 1,
                updated_at_ms: now,
              })
            }
            const validation = await validateContextRows({
              db: tx,
              conversationID,
              rows: await loadContextRows(tx, conversationID, { includeInactiveCues: true }),
              allowEmpty: true,
              allowInactiveCues: true,
            })
            if (!validation.ok)
              throw recoveryRequired(
                `lcm_retrieval_cue_context_invalid_${validation.reason ?? "unknown"}`,
                conversationID,
              )
          })
          return { insertedCues: input.cuePayloads.length }
        },
      })
    })

    const finalizeProviderRequestSnapshot = Effect.fn("LcmContext.finalizeProviderRequestSnapshot")(function* (input: {
      requestSnapshotID: string
      status: LcmProviderRequestSnapshotTerminalStatus
      conversationID?: ConversationID
      nowMs?: number
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        run: async (db) => {
          await finalizeProviderRequestSnapshotRow({ ...input, db: db as PGlite })
        },
      })
    })

    const recordProviderRequestSnapshotFinalValidation = Effect.fn(
      "LcmContext.recordProviderRequestSnapshotFinalValidation",
    )(function* (input: {
      requestSnapshotID: string
      providerValidatorHash: string
      providerFamily?: LcmRenderedSpanProviderFamily
      providerTransformOverheadTokenCount?: number
      conversationID?: ConversationID
    }) {
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        run: async (db) => {
          await recordProviderRequestSnapshotFinalValidationRow({ ...input, db: db as PGlite })
        },
      })
    })

    const rebuildActiveContext = Effect.fn("LcmContext.rebuildActiveContext")(function* (input: {
      conversationID: string
      reason: string
      strategy?: LcmStrategy
      abortSignal?: AbortSignal
    }) {
      const status = yield* lcmDb.getStatus()
      return yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "assembly",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite
          const conversationID = input.conversationID as ConversationID
          const conversation = await findConversation(typedDb, conversationID)
          if (!conversation) throw invalidRequest("lcm_context_conversation_not_found")
          const strategy: LcmStrategy = input.strategy ?? conversation.strategy ?? "upward"
          if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
            const result: LcmRecoveryResult = {
              conversationID,
              status: "failed",
              itemsRebuilt: 0,
              lifecycleState: "recovery_failed",
              safeError: missingSource("lcm_context_rebuild_boundary_invalid", conversationID),
            }
            return markRecoveryFailed(typedDb, result)
          }

          const artifactRoot = artifactRootFromDataDir(status.dataDir)
          const currentRows = await loadContextRows(typedDb, conversationID)
          const current = await validateContextRows({
            db: typedDb,
            conversationID,
            rows: currentRows,
            allowEmpty: false,
            artifactRoot,
          })
          if (current.ok) {
            await writeContextSnapshot({
              db: typedDb,
              conversationID,
              strategy,
              reason: input.reason,
            })
            return {
              conversationID,
              status: "healthy",
              itemsRebuilt: 0,
              lifecycleState: conversation.lifecycle_state as LcmRecoveryResult["lifecycleState"],
            } satisfies LcmRecoveryResult
          }

          const restored = await restoreFromSnapshots({
            db: typedDb,
            conversationID,
            strategy,
            reason: input.reason,
            artifactRoot,
          })
          if (restored.restored) {
            return {
              conversationID,
              status: "rebuilt",
              itemsRebuilt: restored.count,
              lifecycleState: conversation.lifecycle_state as LcmRecoveryResult["lifecycleState"],
            } satisfies LcmRecoveryResult
          }

          const rebuilt = await durableRebuild({
            db: typedDb,
            conversationID,
            strategy,
            reason: input.reason,
            artifactRoot,
          })
          return markRecoveryFailed(typedDb, rebuilt)
        },
      })
    })

    const isOverThreshold = Effect.fn("LcmContext.isOverThreshold")(function* (input: LcmThresholdRuntimeInput) {
      const counter = thresholdTokenCounter(input)
      const operationID = input.assemblyOperationID ?? input.targetCurrentUser?.promptOperationID
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_before_source_load",
      })
      const status = yield* lcmDb.getStatus()
      const conversationID = input.conversationID as ConversationID
      const providerFamilyRenderPreparation = hasRawLeafThresholdPreparation(input)
        ? input.renderPreparation
        : undefined
      const providerFamily = providerFamilyRenderPreparation
        ? classifyLcmProviderFamily({
            providerID: providerFamilyRenderPreparation.model.providerID,
            modelID: providerFamilyRenderPreparation.model.id,
            apiNpm: providerFamilyRenderPreparation.model.api.npm,
            apiID: providerFamilyRenderPreparation.model.api.id,
            interleaved: providerFamilyRenderPreparation.model.capabilities?.interleaved === true,
          })
        : classifyLcmProviderFamily({
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
          })
      const includeRawMessages = hasRawLeafThresholdPreparation(input) && !!input.renderPreparation
      const hiddenSourceMessageIDs = hasRawLeafThresholdPreparation(input)
        ? (input.renderPreparation?.messageVisibility?.hiddenMessageIDs ?? [])
        : []
      const thresholdSource = yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "token_budget",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) => {
          const typedDb = db as PGlite
          const source = await loadThresholdSource({
            db: typedDb,
            conversationID,
            artifactRoot: artifactRootFromDataDir(status.dataDir),
            includeRawMessages,
            hiddenSourceMessageIDs,
          })
          const providerTransformOverheadReserveTokens = await loadProviderTransformOverheadReserve({
            db: typedDb,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            providerFamily,
            providerContextLimit: input.providerContextLimit,
          })
          const consumedMessageRowIDs = await loadConsumedRawMessageRowIDs(typedDb, conversationID)
          return { source, providerTransformOverheadReserveTokens, consumedMessageRowIDs }
        },
      })
      const { source, providerTransformOverheadReserveTokens, consumedMessageRowIDs } = thresholdSource
      const sourceAuthorityHash = conversationAuthorityHash(source.conversation)
      const sourceContextStateHash = contextRowsSemanticHash(source.rows)
      const sourceSemanticHash = thresholdSourceSemanticHash(source)
      const consumedSourceHash = stableHash([...consumedMessageRowIDs].sort())
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_after_source_load",
      })

      let renderHash = renderManifestHash(input.renderOptions.renderInputManifest ?? input.renderOptions)
      let systemText = tokenBudgetInput(input).systemPromptText ?? ""
      let toolText = tokenBudgetInput(input).toolSchemaText ?? ""
      let providerSafe: ProviderSafeSnapshotEvidence | undefined
      let assemblyCounted: ThresholdContextItemCount[] | undefined
      let assemblyCache: ThresholdAssemblyCache | undefined
      const scalarAliasManifest = input.renderOptions.renderInputManifest
      if (scalarAliasManifest) {
        const aliasDiagnostic = validateRenderOptionAliases({
          renderOptions: input.renderOptions,
          manifest: scalarAliasManifest,
        })
        if (aliasDiagnostic) return yield* Effect.fail(invalidRequest(aliasDiagnostic))
      }
      if (hasRawLeafThresholdPreparation(input) && input.renderPreparation && source.rawMessages.length > 0) {
        const renderPreparation = input.renderPreparation
        if (
          input.renderOptions.providerID !== renderPreparation.model.providerID ||
          input.renderOptions.modelID !== renderPreparation.model.id
        ) {
          return yield* Effect.fail(invalidRequest("lcm_threshold_model_mismatch"))
        }
        const countedAssembly = yield* countThresholdFromAssembly({
          source,
          thresholdInput: input,
          renderPreparation,
          renderOptions: input.renderOptions,
          counter,
          abortSignal: input.abortSignal,
          consumedSourceHash,
          providerTransformOverheadReserveTokens,
        })
        renderHash = countedAssembly.renderHash
        systemText = countedAssembly.systemText
        toolText = countedAssembly.toolText
        providerSafe = countedAssembly.providerSafe
        assemblyCounted = countedAssembly.counted
        assemblyCache = countedAssembly.assemblyCache
      }
      const providerInputLimit = providerInputLimitWithTransformReserve({
        providerContextLimit: input.providerContextLimit,
        providerInputLimit: input.providerInputLimit,
        reserveTokens: providerTransformOverheadReserveTokens,
      })

      let counted: ThresholdContextItemCount[]
      let decision: LcmThresholdDecision
      try {
        const systemPromptTokens = counter.countText({
          text: systemText,
          cacheKey: overheadCacheKey({
            counter,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            renderHash,
            contentKind: "prompt",
            text: systemText,
          }),
        })
        const toolSchemaTokens = counter.countText({
          text: toolText,
          cacheKey: overheadCacheKey({
            counter,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            renderHash,
            contentKind: "tool_schema",
            text: toolText,
          }),
        })
        counted =
          assemblyCounted ??
          countContextItems({
            source,
            counter,
            renderHash,
            providerID: input.renderOptions.providerID,
            modelID: input.renderOptions.modelID,
            rawModelTexts: [],
            abortSignal: input.abortSignal,
            operationID,
          })
        const activeTokens = counted.reduce((total, item) => total + item.tokenCount, 0)
        const thresholdInput = tokenBudgetInput(input)
        const strategy = input.strategy ?? source.conversation.strategy ?? "upward"
        const budget = {
          providerContextLimit: input.providerContextLimit,
          providerInputLimit,
          providerOutputLimit: input.providerOutputLimit,
          explicitOutputReserve: thresholdInput.explicitOutputReserve,
          providerOutputReserve: thresholdInput.providerOutputReserve,
          activeTokens,
          systemPromptTokens,
          toolSchemaTokens,
        }
        const freshTailTokens = input.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens
        const softBacklog = computeSoftBacklogFromCounted({
          counted,
          summaryMetadata: source.summaryMetadata,
          strategy,
          targetMessageRowID: targetMessageRowIDForSoftBacklog({ source, thresholdInput: input }),
          freshTailTokens,
          consumedMessageRowIDs,
        })
        decision = computeThresholdDecision({
          conversationID,
          strategy,
          budgetStatus: input.budgetStatus,
          budget,
          laneItems: counted.map((item) => item.lane),
          freshTailTokens,
          softBacklogTokens: softBacklog.tokens,
          softBacklogItemCount: softBacklog.itemCount,
          softBacklogLargestSourceTokens: softBacklog.largestSourceTokens,
          freshTailRawTokens: softBacklog.freshTailTokens,
          freshTailRawItemCount: softBacklog.freshTailItemCount,
          unconsumedRawTokens: softBacklog.unconsumedTokens,
          unconsumedRawItemCount: softBacklog.unconsumedItemCount,
          protectedTailRawTokens: softBacklog.protectedTailTokens,
          protectedTailRawItemCount: softBacklog.protectedTailItemCount,
        })
      } catch (error) {
        const safeError = lcmSafeError(error)
        if (safeError) return yield* Effect.fail(safeError)
        return yield* Effect.fail(invalidRequest(tokenBudgetDiagnostic(error)))
      }

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_before_count_persist",
      })
      const persisted = yield* lcmDb.executeForeground({
        operationID: createOperationID(),
        purpose: "token_budget",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db, control) => {
          const typedDb = db as PGlite & Transactional
          return typedDb.transaction(async (tx) => {
            const operationAbortSignal = control?.abortSignal ?? input.abortSignal
            const checkCanceled = (diagnosticCode: string) =>
              throwIfOperationCanceled({ abortSignal: operationAbortSignal, operationID, diagnosticCode })
            checkCanceled("lcm_threshold_canceled_before_persist_validation")
            const currentSource = await loadThresholdSource({
              db: tx,
              conversationID,
              artifactRoot: artifactRootFromDataDir(status.dataDir),
              includeRawMessages,
              hiddenSourceMessageIDs,
            })
            const currentConsumedMessageRowIDs = await loadConsumedRawMessageRowIDs(tx, conversationID)
            const currentProviderTransformOverheadReserveTokens = await loadProviderTransformOverheadReserve({
              db: tx,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              providerFamily,
              providerContextLimit: input.providerContextLimit,
            })
            checkCanceled("lcm_threshold_canceled_after_persist_validation")
            if (conversationAuthorityHash(currentSource.conversation) !== sourceAuthorityHash) {
              return { status: "authority_stale" } as const
            }
            if (
              contextRowsSemanticHash(currentSource.rows) !== sourceContextStateHash ||
              thresholdSourceSemanticHash(currentSource) !== sourceSemanticHash ||
              stableHash([...currentConsumedMessageRowIDs].sort()) !== consumedSourceHash ||
              currentProviderTransformOverheadReserveTokens !== providerTransformOverheadReserveTokens
            ) {
              return { status: "context_stale" } as const
            }
            await persistThresholdCounts({
              db: tx,
              conversationID,
              counted,
              decision,
              counter,
              providerContextLimit: input.providerContextLimit,
              providerInputLimit: decision.providerInputLimit,
              providerOutputLimit: input.providerOutputLimit,
              providerTransformOverheadReserveTokens,
              outputReserve: decision.outputReserve,
              providerSafe,
              writeSnapshot: input.recordSnapshot !== false,
            })
            checkCanceled("lcm_threshold_canceled_after_count_persist")
            const persistedConversation = await findConversation(tx, conversationID)
            if (!persistedConversation) throw invalidRequest("lcm_threshold_conversation_missing_after_persist")
            return {
              status: "committed",
              authorityHash: conversationAuthorityHash(persistedConversation),
            } as const
          })
        },
      })
      if (persisted.status !== "committed") {
        return yield* Effect.fail(
          invalidRequest(
            persisted.status === "authority_stale" ? "lcm_threshold_authority_stale" : "lcm_threshold_context_stale",
          ),
        )
      }
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_threshold_canceled_after_count_persist",
      })
      if (assemblyCache) {
        thresholdAssemblyCache.set(decision, {
          ...assemblyCache,
          conversationAuthorityHash: persisted.authorityHash,
          thresholdDecisionHash: stableHash(decision),
        })
      }
      return decision
    })

    const compactLeavesToSprig = Effect.fn("LcmContext.compactLeavesToSprig")(function* (
      input: LcmLeafCompactionRuntimeInput,
    ) {
      if (input.maintenanceInputBudget !== undefined && input.maxSourceTokens !== undefined) {
        return yield* Effect.fail(invalidRequest("lcm_leaf_summary_budget_alias_conflict"))
      }
      const internal = input
      const operationID = internal.operationID ?? createOperationID()
      const counter = internal.tokenCounter ?? createDeterministicFallbackTokenCounter()
      const conversationID = input.conversationID as ConversationID
      const status = yield* lcmDb.getStatus()
      const runMaintenance = <T>(run: (db: unknown) => Promise<T>) =>
        input.blocking
          ? lcmDb.executeForeground({
              operationID,
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run,
            })
          : lcmDb.execute({
              operationID,
              lane: "background",
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run,
            })

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_before_selection",
      })
      const selection = yield* runMaintenance((db) =>
        selectLeafSummarySource({
          db: db as PGlite,
          conversationID,
          reason: input.reason,
          maintenanceInputBudget: input.maintenanceInputBudget,
          maxSourceTokens: input.maxSourceTokens,
          counter,
          protectedMessageRowIDs: internal.protectedMessageRowIDs,
          protectedCurrentUser: internal.protectedCurrentUser,
          softThreshold: internal.softThreshold,
          freshTailTokens: internal.freshTailTokens,
          artifactRoot: artifactRootFromDataDir(status.dataDir),
        }),
      )
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_after_selection",
      })

      if (isLeafSummarySkippedSelection(selection)) {
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          beforeTokens: selection.candidateTokens,
          afterTokens: selection.candidateTokens,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "skipped",
          safeMessage: selection.safeMessage ?? "No eligible raw memory span fits the maintenance budget.",
        } satisfies LcmMaintenanceResult
      }

      if (!selection) {
        return {
          conversationID,
          operationID,
          workNeeded: false,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "no_op",
          safeMessage: "No eligible raw leaves are ready for lossless leaf summarization.",
        } satisfies LcmMaintenanceResult
      }

      const summaryTargetTokens = input.summaryTargetTokens ?? RUNTIME_DEFAULTS.performance.summaryTargetTokens
      const summaryGenerationMaxOutputTokens =
        input.summaryGenerationMaxOutputTokens ?? RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens
      const maintenanceInputBudget =
        input.maintenanceInputBudget ??
        input.maxSourceTokens ??
        selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
      const sourceTokenCount = selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
      if (
        input.reason === "soft_threshold" &&
        summaryGenerationMaxOutputTokens < summaryTinyTokenFloor(sourceTokenCount)
      ) {
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: false,
          blocking: input.blocking,
          reason: input.reason,
          beforeTokens: sourceTokenCount,
          afterTokens: sourceTokenCount,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "skipped",
          safeMessage: "The provider output cap is too small for a useful memory summary.",
        } satisfies LcmMaintenanceResult
      }

      const summaryResult = yield* Effect.tryPromise({
        try: () =>
          runLeafSummaryGeneration({
            operationID,
            conversationID,
            sourceItems: selection.sourceItems,
            counter,
            generator: internal.generator,
            maxAttempts: internal.maxAttempts,
            allowFallback: input.blocking && input.reason !== "soft_threshold",
            summaryTargetTokens,
            summaryGenerationMaxOutputTokens,
            maintenanceInputBudget,
            summaryReasoningPolicy: input.summaryReasoningPolicy ?? "provider_default",
            retrySummaryReasoningPolicy: internal.retrySummaryReasoningPolicy ?? "not_supported",
            allowAggressiveOversize: input.reason === "hard_limit",
            abortSignalID: input.abortSignalID,
            abortSignal: input.abortSignal,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (summary) => ({ ok: true as const, summary }),
        }),
      )
      if (!summaryResult.ok) {
        const error = summaryResult.error
        const safeError = lcmSafeError(error)
        if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
        if (isLcmProviderCapacityDeferredError(error) && !input.blocking) {
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: false,
            blocking: input.blocking,
            reason: input.reason,
            summariesCreated: 0,
            contextItemsReplaced: 0,
            status: "deferred",
            safeMessage: error.safeError.safeMessage,
            safeError: error.safeError,
          } satisfies LcmMaintenanceResult
        }
        if (isLcmSummaryObjectiveFailedError(error)) {
          if (internal.sessionID && error.usageEvidence.length > 0) {
            yield* runMaintenance((db) =>
              insertMaintenanceUsageEvidence({
                db: db as Queryable,
                sessionID: internal.sessionID!,
                conversationID,
                operationID,
                mode: usageModeForLeafSummary({
                  conversationID,
                  reason: input.reason,
                  blocking: input.blocking,
                }),
                purpose: "leaf_summary",
                evidence: error.usageEvidence,
                providerID: internal.providerID,
                modelID: internal.modelID,
                nowMs: internal.nowMs ?? Date.now(),
              }),
            )
          }
          if (input.reason === "soft_threshold") {
            return {
              conversationID,
              operationID,
              workNeeded: true,
              workPerformed: false,
              blocking: input.blocking,
              reason: input.reason,
              beforeTokens: sourceTokenCount,
              afterTokens: sourceTokenCount,
              summariesCreated: 0,
              contextItemsReplaced: 0,
              status: "deferred",
              safeMessage: "Memory summary output did not meet quality checks. Memory maintenance will retry later.",
            } satisfies LcmMaintenanceResult
          }
          const summarySafeError = invalidRequest(error.message)
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: false,
            blocking: input.blocking,
            reason: input.reason,
            beforeTokens: sourceTokenCount,
            afterTokens: sourceTokenCount,
            summariesCreated: 0,
            contextItemsReplaced: 0,
            status: "failed",
            safeMessage: summarySafeError.safeMessage,
            safeError: summarySafeError,
          } satisfies LcmMaintenanceResult
        }
        return yield* Effect.fail(invalidRequest("lcm_leaf_summary_generation_failed"))
      }
      const summary = summaryResult.summary

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_before_commit",
      })
      const committed = yield* runMaintenance((db) =>
        commitLeafSummary({
          db: db as PGlite & Transactional,
          conversationID,
          operationID,
          selection,
          summary,
          blocking: input.blocking,
          reason: input.reason,
          sessionID: internal.sessionID,
          providerID: internal.providerID,
          modelID: internal.modelID,
          nowMs: internal.nowMs ?? Date.now(),
        }),
      )

      return {
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: true,
        blocking: input.blocking,
        reason: input.reason,
        beforeTokens: summary.sourceTokenCount,
        afterTokens: summary.summaryTokenCount,
        summariesCreated: 1,
        contextItemsReplaced: committed.contextItemsReplaced,
        status: "completed",
      } satisfies LcmMaintenanceResult
    })

    const compactOneSummaryLane = Effect.fn("LcmContext.compactOneSummaryLane")(function* (input: {
      conversationID: ConversationID
      operationID: OperationID
      targetLane: "sprigs" | "bindles"
      hardPressure: boolean
      blocking: boolean
      promptVersion: SummaryCondensePromptVersion
      counter: LcmTokenCounter
      generator?: LcmSummaryCondenseGenerator
      maxAttempts?: number
      allowFallback?: boolean
      failOnGenerationFailure?: boolean
      summaryTargetTokens?: number
      summaryGenerationMaxOutputTokens?: number
      abortSignalID?: string
      abortSignal?: AbortSignal
      sessionID?: SessionID
      providerID?: string
      modelID?: string
      nowMs: number
      artifactRoot?: string
    }) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_before_selection",
      })
      const selection = yield* lcmDb.executeForeground({
        operationID: input.operationID,
        purpose: "maintenance",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) =>
          selectSummaryCondenseSource({
            db: db as PGlite,
            conversationID: input.conversationID,
            targetLane: input.targetLane,
            hardPressure: input.hardPressure,
            counter: input.counter,
            artifactRoot: input.artifactRoot,
          }),
      })
      if (!selection) return undefined
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_after_selection",
      })

      const summary = yield* Effect.tryPromise({
        try: () =>
          runCondenseSummaryGeneration({
            operationID: input.operationID,
            conversationID: input.conversationID,
            sourceItems: selection.sourceItems,
            counter: input.counter,
            promptVersion: input.promptVersion,
            generator: input.generator,
            maxAttempts: input.maxAttempts,
            allowFallback: input.allowFallback,
            summaryTargetTokens: input.summaryTargetTokens ?? RUNTIME_DEFAULTS.performance.summaryTargetTokens,
            summaryGenerationMaxOutputTokens:
              input.summaryGenerationMaxOutputTokens ?? RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens,
            maintenanceInputBudget: selection.sourceItems.reduce((total, item) => total + item.tokenCount, 0),
            summaryReasoningPolicy: "provider_default",
            retrySummaryReasoningPolicy: "not_supported",
            allowAggressiveOversize: input.promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
            abortSignalID: input.abortSignalID,
            abortSignal: input.abortSignal,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const safeError = lcmSafeError(error)
            if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
            if (isLcmSummaryObjectiveFailedError(error)) {
              if (input.sessionID && error.usageEvidence.length > 0) {
                yield* lcmDb.executeForeground({
                  operationID: input.operationID,
                  purpose: "maintenance",
                  ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
                  run: async (db) =>
                    insertSummaryMaintenanceUsageRecord({
                      db: db as Queryable,
                      sessionID: input.sessionID!,
                      conversationID: input.conversationID,
                      operationID: input.operationID,
                      mode: input.blocking ? "blocking" : "background",
                      purpose: usagePurposeForSummary(input.promptVersion),
                      evidence: error.usageEvidence,
                      providerID: input.providerID,
                      modelID: input.modelID,
                      nowMs: input.nowMs,
                    }),
                })
              }
              if (input.failOnGenerationFailure) return yield* Effect.fail(invalidRequest(error.message))
              return undefined
            }
            if (input.failOnGenerationFailure) {
              return yield* Effect.fail(invalidRequest("lcm_summary_condense_generation_failed"))
            }
            return undefined
          }),
        ),
      )
      if (!summary) return undefined

      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_before_commit",
      })
      const committed = yield* lcmDb.executeForeground({
        operationID: input.operationID,
        purpose: "maintenance",
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        run: async (db) =>
          commitSummaryCondensation({
            db: db as PGlite & Transactional,
            conversationID: input.conversationID,
            operationID: input.operationID,
            selection,
            summary,
            blocking: input.blocking,
            promptVersion: input.promptVersion,
            sessionID: input.sessionID,
            providerID: input.providerID,
            modelID: input.modelID,
            nowMs: input.nowMs,
          }),
      })
      return {
        beforeTokens: summary.sourceTokenCount,
        afterTokens: summary.summaryTokenCount,
        summariesCreated: 1,
        contextItemsReplaced: committed.contextItemsReplaced,
      }
    })

    const compactUntilUnderHardLimit = Effect.fn("LcmContext.compactUntilUnderHardLimit")(function* (
      input: LcmHardLimitRuntimeInput,
    ) {
      const internal = input
      const operationID = internal.operationID ?? createOperationID()
      const conversationID = input.conversationID as ConversationID
      const counter = internal.tokenCounter ?? createDeterministicFallbackTokenCounter()
      const status = yield* lcmDb.getStatus()
      const artifactRoot = artifactRootFromDataDir(status.dataDir)
      const maxRounds = Math.max(1, internal.maxRounds ?? RUNTIME_DEFAULTS.thresholds.maxBlockingRounds)
      const elapsedNowMs = internal.elapsedNowMs ?? Date.now
      const startedAt = elapsedNowMs()
      const maxElapsedMs = internal.maxElapsedMs ?? 180_000
      const providerContextLimit = Math.max(
        1,
        internal.providerContextLimit ??
          input.threshold.hardLimit +
            input.threshold.outputReserve +
            input.threshold.systemPromptTokens +
            input.threshold.toolSchemaTokens,
      )
      const providerInputLimit = internal.providerInputLimit
      const providerOutputLimit = internal.providerOutputLimit
      const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
        providerContextLimit,
        providerOutputLimit,
      })
      const protectedMessageRowIDs = new Set<MessageRowID>()
      const protectedSourceMessageID =
        internal.renderPreparation?.lastUserMessageID ?? internal.renderPreparation?.lastUser?.id
      if (protectedSourceMessageID) {
        const protectedMessageRowID = yield* lcmDb.executeForeground({
          operationID,
          purpose: "maintenance",
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          run: async (db) =>
            findSourceMessageRowID({
              db: db as PGlite,
              conversationID,
              sourceSessionID: internal.renderPreparation?.sessionID ?? input.sessionID,
              sourceMessageID: protectedSourceMessageID,
            }),
        })
        if (protectedMessageRowID) protectedMessageRowIDs.add(protectedMessageRowID)
      }
      const thresholdInput = () =>
        ({
          conversationID,
          renderOptions: input.renderOptions,
          providerContextLimit,
          providerInputLimit,
          providerOutputLimit,
          budgetStatus: current.budgetStatus,
          renderPreparation: internal.renderPreparation,
          tokenCounter: counter,
          abortSignal: input.abortSignal,
        }) satisfies LcmRawLeafThresholdInput

      let current = input.threshold
      let summariesCreated = 0
      let contextItemsReplaced = 0
      let afterTokens = current.activeTokens
      let elapsedTimeout = false
      const reportProgress = (progress: LcmHardLimitProgress) =>
        internal.onProgress ? internal.onProgress(progress) : Effect.void

      if (!current.overHard) {
        return {
          conversationID,
          operationID,
          workNeeded: false,
          workPerformed: false,
          blocking: true,
          reason: "hard_limit",
          beforeTokens: current.activeTokens,
          afterTokens: current.activeTokens,
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "healthy",
        } satisfies LcmMaintenanceResult
      }

      const recompute = Effect.fn("LcmContext.compactUntilUnderHardLimit.recompute")(function* () {
        current = yield* isOverThreshold(thresholdInput())
        afterTokens = current.activeTokens
        return current
      })

      const recordWork = (work: { summariesCreated: number; contextItemsReplaced: number }) => {
        summariesCreated += work.summariesCreated
        contextItemsReplaced += work.contextItemsReplaced
      }

      const targetLanes = () => {
        const lanes: ("sprigs" | "bindles")[] = []
        if (current.lanes.sprigs.overTarget || current.lanes.sprigs.nextAction === "condense_summaries")
          lanes.push("sprigs")
        if (
          current.lanes.bindles.overTarget ||
          current.lanes.bindles.nextAction === "condense_summaries" ||
          current.lanes.bindles.nextAction === "create_archive_stub"
        ) {
          lanes.push("bindles")
        }
        if (lanes.length === 0) lanes.push("sprigs", "bindles")
        return lanes
      }

      const shouldCompactRawLeaves = () =>
        current.lanes.rawLeaves.nextAction === "summarize_leaves" ||
        (current.overHard &&
          current.lanes.rawLeaves.tokens > 0 &&
          current.lanes.rawLeaves.eligibleItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize)

      const hardLimitLeafInputBudget = () => {
        if (current.lanes.rawLeaves.nextAction === "summarize_leaves") return current.lanes.rawLeaves.targetTokens
        const excessTokens = Math.max(0, current.activeTokens - current.hardLimit)
        return Math.max(
          RUNTIME_DEFAULTS.performance.summaryTargetTokens * 2,
          Math.min(
            current.lanes.rawLeaves.targetTokens,
            excessTokens + RUNTIME_DEFAULTS.performance.summaryTargetTokens * 2,
          ),
        )
      }

      const unresolvedDiagnosticCode = () => {
        const hasCompressibleLane =
          current.lanes.rawLeaves.eligibleItemCount >= RUNTIME_DEFAULTS.performance.minMessagesToSummarize ||
          current.lanes.sprigs.eligibleItemCount > 0 ||
          current.lanes.bindles.eligibleItemCount > 0
        if (!hasCompressibleLane) return "lcm_hard_limit_unresolved_no_compressible_items"
        if (summariesCreated > 0 || contextItemsReplaced > 0) return "lcm_hard_limit_unresolved_after_maintenance"
        return "lcm_hard_limit_unresolved_m14"
      }

      const canceledMaintenanceResult = (safeError: LcmSafeError): LcmMaintenanceResult => ({
        conversationID,
        operationID,
        workNeeded: true,
        workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
        blocking: true,
        reason: "hard_limit",
        beforeTokens: input.threshold.activeTokens,
        afterTokens,
        summariesCreated,
        contextItemsReplaced,
        status: "canceled",
        safeMessage: safeError.safeMessage,
        safeError,
      })

      const checkCanceled = (diagnosticCode: string) =>
        failIfOperationCanceled({
          abortSignal: input.abortSignal,
          operationID,
          diagnosticCode,
        })

      const runHardLimitMaintenance = Effect.gen(function* () {
        yield* checkCanceled("lcm_hard_limit_canceled_before_rounds")
        for (let round = 0; round < maxRounds && current.overHard; round++) {
          yield* checkCanceled("lcm_hard_limit_canceled_before_round")
          if (elapsedNowMs() - startedAt > maxElapsedMs) {
            elapsedTimeout = true
            break
          }
          let worked = false

          if (shouldCompactRawLeaves()) {
            yield* checkCanceled("lcm_hard_limit_canceled_before_leaf_summary")
            yield* reportProgress({ phase: "leaf_summary", round })
            yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_progress")
            const leaf = yield* compactLeavesToSprig({
              conversationID,
              reason: "hard_limit",
              blocking: true,
              maintenanceInputBudget: hardLimitLeafInputBudget(),
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              operationID,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              tokenCounter: counter,
              generator: internal.leafGenerator,
              protectedMessageRowIDs: [...protectedMessageRowIDs],
              maxAttempts: internal.maxAttempts,
              nowMs: internal.nowMs,
            } satisfies LcmLeafCompactionRuntimeInput)
            if (leaf.workPerformed) {
              recordWork(leaf)
              worked = true
              yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_summary")
              yield* recompute()
              yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_recompute")
              continue
            }
            yield* checkCanceled("lcm_hard_limit_canceled_after_leaf_noop")
          }

          for (const lane of targetLanes()) {
            yield* checkCanceled(`lcm_hard_limit_canceled_before_${lane}_condensation`)
            yield* reportProgress({ phase: "condensation", round, lane })
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_progress`)
            const condensed = yield* compactOneSummaryLane({
              conversationID,
              operationID,
              targetLane: lane,
              hardPressure: true,
              blocking: true,
              promptVersion: LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
              counter,
              generator: internal.condenseGenerator,
              maxAttempts: internal.maxAttempts,
              allowFallback: false,
              failOnGenerationFailure: false,
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              nowMs: internal.nowMs ?? Date.now(),
              artifactRoot,
            })
            if (condensed) {
              recordWork(condensed)
              worked = true
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation`)
              yield* recompute()
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_recompute`)
              break
            }
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_condensation_noop`)
          }
          if (worked) continue

          if (current.strategy === "dolt" && current.lanes.bindles.overTarget) {
            yield* checkCanceled("lcm_hard_limit_canceled_before_archive_stub")
            yield* reportProgress({ phase: "archive_stub", round, lane: "bindles" })
            yield* checkCanceled("lcm_hard_limit_canceled_after_archive_progress")
            const archived = yield* lcmDb.executeForeground({
              operationID,
              purpose: "maintenance",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run: async (db) =>
                createArchiveStub({
                  db: db as PGlite & Transactional,
                  conversationID,
                  counter,
                  nowMs: internal.nowMs ?? Date.now(),
                  artifactRoot,
                }),
            })
            if (archived) {
              recordWork(archived)
              worked = true
              yield* checkCanceled("lcm_hard_limit_canceled_after_archive_stub")
              yield* recompute()
              yield* checkCanceled("lcm_hard_limit_canceled_after_archive_recompute")
              continue
            }
            yield* checkCanceled("lcm_hard_limit_canceled_after_archive_noop")
          }

          for (const lane of targetLanes()) {
            yield* checkCanceled(`lcm_hard_limit_canceled_before_${lane}_aggressive_condensation`)
            yield* reportProgress({ phase: "aggressive_condensation", round, lane })
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_progress`)
            const aggressive = yield* compactOneSummaryLane({
              conversationID,
              operationID,
              targetLane: lane,
              hardPressure: true,
              blocking: true,
              promptVersion: LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
              counter,
              generator: internal.condenseGenerator,
              maxAttempts: internal.maxAttempts,
              allowFallback: true,
              failOnGenerationFailure: true,
              summaryTargetTokens: RUNTIME_DEFAULTS.performance.summaryTargetTokens,
              summaryGenerationMaxOutputTokens,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
              sessionID: input.sessionID,
              providerID: input.renderOptions.providerID,
              modelID: input.renderOptions.modelID,
              nowMs: internal.nowMs ?? Date.now(),
              artifactRoot,
            })
            if (aggressive) {
              recordWork(aggressive)
              worked = true
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_condensation`)
              yield* recompute()
              yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_recompute`)
              break
            }
            yield* checkCanceled(`lcm_hard_limit_canceled_after_${lane}_aggressive_noop`)
          }

          if (!worked) break
        }

        yield* checkCanceled("lcm_hard_limit_canceled_before_result")
        if (!current.overHard) {
          return {
            conversationID,
            operationID,
            workNeeded: true,
            workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
            blocking: true,
            reason: "hard_limit",
            beforeTokens: input.threshold.activeTokens,
            afterTokens,
            summariesCreated,
            contextItemsReplaced,
            status: "completed",
          } satisfies LcmMaintenanceResult
        }

        const safeError = elapsedTimeout
          ? operationTimeout({
              diagnosticCode: "lcm_hard_limit_maintenance_timeout",
              operationID,
            })
          : hardLimitUnresolved({
              diagnosticCode: unresolvedDiagnosticCode(),
              operationID,
              conversationID,
              beforeTokens: input.threshold.activeTokens,
              hardLimit: input.threshold.hardLimit,
            })
        return {
          conversationID,
          operationID,
          workNeeded: true,
          workPerformed: summariesCreated > 0 || contextItemsReplaced > 0,
          blocking: true,
          reason: "hard_limit",
          beforeTokens: input.threshold.activeTokens,
          afterTokens,
          summariesCreated,
          contextItemsReplaced,
          status: "failed",
          safeMessage: safeError.safeMessage,
          safeError,
        } satisfies LcmMaintenanceResult
      })

      return yield* runHardLimitMaintenance.pipe(
        Effect.catch((error) => {
          const safeError = lcmSafeError(error)
          if (safeError?.code === "canceled") {
            return Effect.succeed(canceledMaintenanceResult(safeError))
          }
          return Effect.fail(error)
        }),
      )
    })

    return Service.of({
      runtimeDbBinding: "lcm_context_layer",
      getCurrentContext,
      rebuildActiveContext,
      replaceRetrievalCues,
      finalizeProviderRequestSnapshot,
      recordProviderRequestSnapshotFinalValidation,
      assembleModelMessages: (input) =>
        Effect.gen(function* () {
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_before_start",
          })
          if (!hasRawLeafRenderPreparation(input)) {
            return yield* Effect.fail(invalidRequest("lcm_raw_leaf_render_preparation_missing"))
          }
          const renderPreparation = input.renderPreparation
          if (
            input.renderOptions.providerID !== renderPreparation.model.providerID ||
            input.renderOptions.modelID !== renderPreparation.model.id
          ) {
            return yield* Effect.fail(invalidRequest("lcm_raw_leaf_model_mismatch"))
          }
          const assemblyThreshold = input.threshold
          if (assemblyThreshold && assemblyThreshold.conversationID !== input.conversationID) {
            return {
              conversationID: input.conversationID,
              lifecycleState: "recovery_required",
              ok: false,
              contextItems: [],
              safeError: invalidRequest("lcm_provider_assembly_threshold_conversation_mismatch"),
            } satisfies LcmAssemblyResult
          }
          const assemblyDbStatus = yield* lcmDb.getStatus()
          const cached = assemblyThreshold ? thresholdAssemblyCache.get(assemblyThreshold) : undefined
          if (assemblyThreshold && !cached) {
            return {
              conversationID: input.conversationID,
              lifecycleState: "recovery_required",
              ok: false,
              contextItems: [],
              safeError: invalidRequest("lcm_provider_assembly_threshold_cache_missing"),
            } satisfies LcmAssemblyResult
          }
          if (
            assemblyThreshold &&
            cached &&
            (cached.conversationID !== input.conversationID ||
              cached.renderPreparation !== renderPreparation ||
              cached.thresholdDecisionHash !== stableHash(assemblyThreshold) ||
              cached.targetCurrentUserHash !== stableHash(input.targetCurrentUser) ||
              cached.renderOptionsHash !== stableHash(input.renderOptions))
          ) {
            return {
              conversationID: input.conversationID,
              lifecycleState: cached.lifecycleState,
              ok: false,
              contextItems: [...cached.contextItems],
              safeError: invalidRequest("lcm_provider_assembly_threshold_cache_mismatch"),
            } satisfies LcmAssemblyResult
          }
          if (assemblyThreshold && cached) {
            const requestSnapshotID = providerRequestSnapshotID()
            const validatedModelMessages = cached.prepared.modelMessages as LcmValidatedModelMessages
            const cachedRenderedSpans = [...cached.renderedSpans]
            yield* failIfOperationCanceled({
              abortSignal: input.abortSignal,
              operationID: input.targetCurrentUser.promptOperationID,
              diagnosticCode: "lcm_provider_assembly_canceled_before_cached_snapshot",
            })
            const cachedStateCommitted = yield* lcmDb.executeForeground({
              operationID: input.targetCurrentUser.promptOperationID,
              purpose: "assembly",
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              run: async (db, control) => {
                const typedDb = db as PGlite & Transactional
                return typedDb.transaction(async (tx) => {
                  const operationAbortSignal = control?.abortSignal ?? input.abortSignal
                  const checkCanceled = (diagnosticCode: string) =>
                    throwIfOperationCanceled({
                      abortSignal: operationAbortSignal,
                      operationID: input.targetCurrentUser.promptOperationID,
                      diagnosticCode,
                    })

                  checkCanceled("lcm_provider_assembly_canceled_before_cached_state_validation")
                  const currentConversation = await findConversation(tx, input.conversationID)
                  if (
                    !currentConversation ||
                    !validateBoundaryMetadataV1(jsonValue(currentConversation.boundary_metadata_json)).ok ||
                    conversationAuthorityHash(currentConversation) !== cached.conversationAuthorityHash
                  ) {
                    return { status: "authority_stale" } as const
                  }
                  if (
                    !["passive_synced", "lcm_active"].includes(currentConversation.lifecycle_state) ||
                    (input.renderOptions.taskCapabilityClass !== undefined &&
                      input.renderOptions.taskCapabilityClass !== currentConversation.capability_class)
                  ) {
                    return { status: "authority_stale" } as const
                  }
                  const rows = await loadContextRows(tx, input.conversationID)
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_context_reload")
                  if (contextRowsSemanticHash(rows) !== cached.contextStateHash)
                    return { status: "context_stale" } as const
                  const contextValidation = await validateContextRows({
                    db: tx,
                    conversationID: input.conversationID,
                    rows,
                    allowEmpty: true,
                    artifactRoot: artifactRootFromDataDir(assemblyDbStatus.dataDir),
                  })
                  if (!contextValidation.ok) return { status: "context_stale" } as const
                  const rawEntries = await loadRawLeafMessageEntries({
                    db: tx,
                    conversationID: input.conversationID,
                    contextItems: cached.contextItems,
                  })
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_raw_reload")
                  const markerModelMessages = await loadStandaloneLargeFileMarkerMessages({
                    db: tx,
                    conversationID: input.conversationID,
                    contextItems: cached.contextItems,
                  })
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_marker_reload")
                  if (
                    modelVisibleSourceStateHash({
                      rawMessages: rawEntries.map((entry) => entry.message),
                      markerModelMessages,
                    }) !== cached.modelVisibleSourceStateHash
                  )
                    return { status: "context_stale" } as const
                  // Cached rendering is never cached authorization or budget proof. Consumption and
                  // provider overhead can change without rewriting active rows, so re-read both at commit.
                  const currentConsumedMessageRowIDs = await loadConsumedRawMessageRowIDs(tx, input.conversationID)
                  const providerFamily = classifyLcmProviderFamily({
                    providerID: renderPreparation.model.providerID,
                    modelID: renderPreparation.model.id,
                    apiNpm: renderPreparation.model.api.npm,
                    apiID: renderPreparation.model.api.id,
                    interleaved: renderPreparation.model.capabilities?.interleaved === true,
                  })
                  const currentProviderTransformOverheadReserveTokens = await loadProviderTransformOverheadReserve({
                    db: tx,
                    providerID: input.renderOptions.providerID,
                    modelID: input.renderOptions.modelID,
                    providerFamily,
                    providerContextLimit: assemblyThreshold.providerContextLimit,
                  })
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_budget_reload")
                  if (
                    stableHash([...currentConsumedMessageRowIDs].sort()) !== cached.consumedSourceHash ||
                    currentProviderTransformOverheadReserveTokens !== cached.providerTransformOverheadReserveTokens
                  ) {
                    return { status: "budget_stale" } as const
                  }
                  if (assemblyThreshold.activeTokens !== cached.activeTokens) {
                    return { status: "active_tokens_mismatch" } as const
                  }

                  const now = Date.now()
                  const protection = await requestSnapshotProtectionForConversation({
                    db: tx,
                    conversationID: input.conversationID,
                    nowMs: now,
                  })
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_protection_reload")
                  const renderInputManifest = {
                    ...cached.renderInputManifest,
                    requestSnapshotProtectionHash: protection.requestSnapshotProtectionHash,
                  }
                  const aliasDiagnostic = validateRenderOptionAliases({
                    renderOptions: input.renderOptions,
                    manifest: renderInputManifest,
                  })
                  if (aliasDiagnostic) return { status: "invalid", diagnosticCode: aliasDiagnostic } as const
                  const preparedProviderPayload = {
                    operationID: input.targetCurrentUser.promptOperationID,
                    conversationID: input.conversationID,
                    providerRequestSnapshotID: requestSnapshotID,
                    providerID: input.renderOptions.providerID,
                    modelID: input.renderOptions.modelID,
                    systemPromptHash: renderInputManifest.systemPromptHash,
                    toolSchemaHash: renderInputManifest.toolSchemaHash,
                    ...(cached.prepared.toolChoice ? { toolChoiceHash: stableHash(cached.prepared.toolChoice) } : {}),
                    modelMessages: validatedModelMessages,
                    renderInputManifest,
                    renderedSpans: cachedRenderedSpans,
                    assemblyValidatorHash: renderInputManifest.assemblyValidatorHash,
                    system: cached.prepared.system,
                    tools: cached.prepared.tools,
                    ...(cached.prepared.toolChoice ? { toolChoice: cached.prepared.toolChoice } : {}),
                    format: cached.prepared.format,
                  } satisfies LcmRuntimePreparedProviderPayload
                  const validationDiagnostic = validateAssemblyPayload({
                    payload: preparedProviderPayload,
                    modelMessageCount: cached.prepared.modelMessages.length,
                    renderUnits: cached.renderUnits,
                  })
                  if (validationDiagnostic) return { status: "invalid", diagnosticCode: validationDiagnostic } as const

                  const providerSafe: ProviderSafeSnapshotEvidence = {
                    ...cached.providerSafe,
                    renderInputManifest,
                  }
                  checkCanceled("lcm_provider_assembly_canceled_before_cached_snapshot_write")
                  if (providerSafe.items.size === cached.contextItems.length) {
                    await writeContextSnapshot({
                      db: tx,
                      conversationID: input.conversationID,
                      strategy: assemblyThreshold.strategy,
                      reason: "assembly",
                      nowMs: now,
                      threshold: {
                        activeTokens: assemblyThreshold.activeTokens,
                        hardLimit: assemblyThreshold.hardLimit,
                        softThreshold: assemblyThreshold.softThreshold,
                        freshTailTokens: assemblyThreshold.freshTailTokens,
                        softBacklogTokens: assemblyThreshold.softBacklogTokens,
                        softBacklogItemCount: assemblyThreshold.softBacklogItemCount,
                        freshTailRawTokens: assemblyThreshold.freshTailRawTokens,
                        freshTailRawItemCount: assemblyThreshold.freshTailRawItemCount,
                        unconsumedRawTokens: assemblyThreshold.unconsumedRawTokens,
                        unconsumedRawItemCount: assemblyThreshold.unconsumedRawItemCount,
                        protectedTailRawTokens: assemblyThreshold.protectedTailRawTokens,
                        protectedTailRawItemCount: assemblyThreshold.protectedTailRawItemCount,
                        rawLaneTokens: assemblyThreshold.rawLaneTokens,
                        hardFillRatio: assemblyThreshold.hardFillRatio,
                        rawLaneRatio: assemblyThreshold.rawLaneRatio,
                        softBacklogRatio: assemblyThreshold.softBacklogRatio,
                        lanes: assemblyThreshold.lanes,
                        tokenCounterMode: assemblyThreshold.tokenCounterMode,
                        tokenCounterVersion: assemblyThreshold.tokenCounterVersion,
                        providerContextLimit: assemblyThreshold.providerContextLimit,
                        providerInputLimit: assemblyThreshold.providerInputLimit,
                        providerOutputLimit: assemblyThreshold.providerOutputLimit,
                        outputReserve: assemblyThreshold.outputReserve,
                      },
                      providerSafe,
                    })
                  }
                  checkCanceled("lcm_provider_assembly_canceled_before_cached_request_snapshot")
                  await createProviderRequestSnapshot({
                    db: tx,
                    requestSnapshotID,
                    operationID: input.targetCurrentUser.promptOperationID as OperationID,
                    conversationID: input.conversationID,
                    sourceSessionID: input.sessionID,
                    providerID: input.renderOptions.providerID,
                    modelID: input.renderOptions.modelID,
                    renderUnits: cached.renderUnits,
                    manifest: renderInputManifest,
                    nowMs: now,
                  })
                  checkCanceled("lcm_provider_assembly_canceled_after_cached_request_snapshot")
                  return { status: "committed", preparedProviderPayload, renderInputManifest } as const
                })
              },
            })
            if (cachedStateCommitted.status !== "committed") {
              return {
                conversationID: input.conversationID,
                lifecycleState: cached.lifecycleState,
                ok: false,
                contextItems: [...cached.contextItems],
                safeError: invalidRequest(
                  cachedStateCommitted.status === "context_stale"
                    ? "lcm_provider_assembly_threshold_context_stale"
                    : cachedStateCommitted.status === "authority_stale"
                      ? "lcm_provider_assembly_threshold_authority_stale"
                      : cachedStateCommitted.status === "active_tokens_mismatch"
                        ? "lcm_provider_assembly_threshold_active_tokens_mismatch"
                        : cachedStateCommitted.status === "budget_stale"
                          ? "lcm_provider_assembly_threshold_budget_stale"
                          : cachedStateCommitted.diagnosticCode,
                ),
              } satisfies LcmAssemblyResult
            }
            return {
              conversationID: input.conversationID,
              lifecycleState: cached.lifecycleState,
              ok: true,
              contextItems: [...cached.contextItems],
              modelMessages: validatedModelMessages,
              renderedSpans: cachedRenderedSpans,
              activeTokens: cached.activeTokens,
              preparedProviderPayload: cachedStateCommitted.preparedProviderPayload,
              providerRequestSnapshotID: requestSnapshotID,
              normalizedParityKey: rawLeafNormalizedParityKey({
                modelMessages: cached.prepared.modelMessages,
                renderInputManifest: cachedStateCommitted.renderInputManifest,
              }),
            } satisfies LcmAssemblyResult
          }

          const {
            contextItems,
            contextStateHash,
            authorityStateHash,
            capabilityClass,
            rawEntries,
            lifecycleState,
            summaryModelMessages,
            markerModelMessages,
            sourceStateHash,
            visibilityProvenance,
          } = yield* lcmDb.executeForeground({
            operationID: createOperationID(),
            purpose: "assembly",
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            run: async (db) => {
              const typedDb = db as PGlite
              const conversationID = input.conversationID as ConversationID
              const checkCanceled = (diagnosticCode: string) =>
                throwIfOperationCanceled({
                  abortSignal: input.abortSignal,
                  operationID: input.targetCurrentUser.promptOperationID,
                  diagnosticCode,
                })
              const conversation = await findConversation(typedDb, conversationID)
              if (!conversation) throw invalidRequest("lcm_raw_leaf_conversation_not_found")
              if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
                throw recoveryRequired("lcm_raw_leaf_boundary_invalid", conversationID)
              }
              const rows = await loadContextRows(typedDb, conversationID)
              const validation = await validateContextRows({
                db: typedDb,
                conversationID,
                rows,
                allowEmpty: true,
                artifactRoot: artifactRootFromDataDir(assemblyDbStatus.dataDir),
              })
              if (!validation.ok) {
                throw recoveryRequired(`lcm_context_invalid_${validation.reason ?? "unknown"}`, conversationID)
              }
              const contextItems = validation.items ?? []
              checkCanceled("lcm_provider_assembly_canceled_after_context_load")
              const summaryMessages = await loadSummaryWrapperMessages({
                db: typedDb,
                conversationID,
                contextItems,
              })
              checkCanceled("lcm_provider_assembly_canceled_after_summary_load")
              const markerMessages = await loadStandaloneLargeFileMarkerMessages({
                db: typedDb,
                conversationID,
                contextItems,
              })
              checkCanceled("lcm_provider_assembly_canceled_after_marker_load")
              const visibilityProvenance = await loadVisibilityProvenance({
                db: typedDb,
                conversationID,
                contextItems,
                hiddenSourceMessageIDs: renderPreparation.messageVisibility?.hiddenMessageIDs ?? [],
              })
              const loadedRawEntries = await loadRawLeafMessageEntries({
                db: typedDb,
                conversationID,
                contextItems,
              })
              checkCanceled("lcm_provider_assembly_canceled_after_source_load")
              return {
                contextItems,
                contextStateHash: contextRowsSemanticHash(rows),
                authorityStateHash: conversationAuthorityHash(conversation),
                capabilityClass: conversation.capability_class,
                lifecycleState: conversation.lifecycle_state as LcmLifecycleState,
                rawEntries: loadedRawEntries,
                summaryModelMessages: summaryMessages,
                markerModelMessages: markerMessages,
                sourceStateHash: modelVisibleSourceStateHash({
                  rawMessages: loadedRawEntries.map((entry) => entry.message),
                  markerModelMessages: markerMessages,
                }),
                visibilityProvenance,
              }
            },
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_source_load",
          })
          if (assemblyThreshold && cached && authorityStateHash !== cached.conversationAuthorityHash) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_threshold_authority_stale"),
            } satisfies LcmAssemblyResult
          }
          if (
            assemblyThreshold &&
            cached &&
            (contextStateHash !== cached.contextStateHash || sourceStateHash !== cached.modelVisibleSourceStateHash)
          ) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_threshold_context_stale"),
            } satisfies LcmAssemblyResult
          }
          if (
            !["passive_synced", "lcm_active"].includes(lifecycleState) ||
            (input.renderOptions.taskCapabilityClass !== undefined &&
              input.renderOptions.taskCapabilityClass !== capabilityClass)
          ) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest(
                assemblyThreshold
                  ? "lcm_provider_assembly_threshold_authority_stale"
                  : "lcm_provider_assembly_authority_stale",
              ),
            } satisfies LcmAssemblyResult
          }
          let renderUnits: LcmRenderUnit[]
          try {
            renderUnits = buildRenderUnits({
              conversationID: input.conversationID,
              contextItems,
              rawEntries,
              summaryModelMessages,
              markerModelMessages,
              visibilityProvenance,
              renderPreparation,
              targetCurrentUser: input.targetCurrentUser,
              abortSignal: input.abortSignal,
            })
            renderUnits = withRenderUnitOrigins(renderUnits)
          } catch (error) {
            const safeError = lcmSafeError(error)
            if (safeError?.code === "canceled") return yield* Effect.fail(safeError)
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: safeError ?? invalidRequest("lcm_provider_assembly_render_unit_build_failed"),
            } satisfies LcmAssemblyResult
          }
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_render_units",
          })
          const targetUnit = renderUnits.find((unit) => unit.source.kind === "target_current_user")
          if (!targetUnit || targetUnit.message.info.role !== "user") {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: missingSource("lcm_provider_assembly_target_current_user_missing", input.conversationID),
            } satisfies LcmAssemblyResult
          }
          const lastUser =
            renderPreparation.lastUser &&
            renderPreparation.lastUser.id === targetUnit.message.info.id &&
            renderPreparation.lastUser.sessionID === targetUnit.message.info.sessionID
              ? {
                  ...targetUnit.message.info,
                  editorContext: renderPreparation.lastUser.editorContext,
                }
              : targetUnit.message.info
          const prepared = yield* prepareKiloModelInput({
            ...renderPreparation,
            messages: renderUnits.map((unit) => unit.message),
            lastUser,
            operationID: input.targetCurrentUser.promptOperationID,
            lcmActive: true,
            stripMedia: input.renderOptions.stripMedia,
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_render_preparation",
          })
          const prefixCounts = yield* renderPrefixCounts({
            messages: prepared.messages,
            renderPreparation,
            stripMedia: input.renderOptions.stripMedia,
            expectedModelMessageCount: prepared.modelMessages.length,
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
          })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_after_prefix_counts",
          })
          const unitByMessageID = new Map(renderUnits.map((unit) => [unit.message.info.id, unit] as const))
          const spansByUnitID = new Map<string, LcmRenderedSpan>()
          const providerFamily = classifyLcmProviderFamily({
            providerID: renderPreparation.model.providerID,
            modelID: renderPreparation.model.id,
            apiNpm: renderPreparation.model.api.npm,
            apiID: renderPreparation.model.api.id,
            interleaved: renderPreparation.model.capabilities?.interleaved === true,
          })
          for (const [messageIndex, message] of prepared.messages.entries()) {
            const unit = unitByMessageID.get(message.info.id)
            if (!unit) {
              if (message.parts.length === 0) continue
              return {
                conversationID: input.conversationID,
                lifecycleState,
                ok: false,
                contextItems,
                safeError: invalidRequest("lcm_provider_assembly_untracked_prepared_message"),
              } satisfies LcmAssemblyResult
            }
            spansByUnitID.set(
              unit.renderUnitID,
              renderedSpanForUnit({
                unit,
                startIndex: prefixCounts[messageIndex] ?? 0,
                messageCount: (prefixCounts[messageIndex + 1] ?? 0) - (prefixCounts[messageIndex] ?? 0),
                providerFamily,
                providerTransformHash: prepared.renderInputManifest.providerTransformHash,
                renderPreparation,
              }),
            )
          }
          const missingSpanUnit = renderUnits.find((unit) => !spansByUnitID.has(unit.renderUnitID))
          if (missingSpanUnit) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_missing_rendered_span"),
            } satisfies LcmAssemblyResult
          }
          const renderedSpans = renderUnits.map((unit) => spansByUnitID.get(unit.renderUnitID)!)
          const baseRenderInputManifest = manifestWithAssemblyHashes({
            manifest: prepared.renderInputManifest,
            renderUnits,
            renderedSpans,
            providerTransformHash: prepared.renderInputManifest.providerTransformHash,
          })
          const requestSnapshotID = providerRequestSnapshotID()
          const validatedModelMessages = prepared.modelMessages as LcmValidatedModelMessages
          const activeTokens = countAssemblyActiveTokens({
            modelMessages: prepared.modelMessages,
            renderedSpans,
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
          })
          if (assemblyThreshold && assemblyThreshold.activeTokens !== activeTokens) {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest("lcm_provider_assembly_threshold_active_tokens_mismatch"),
            } satisfies LcmAssemblyResult
          }
          const providerSafeItems = renderUnitSnapshotItemsFromContextItems({ renderUnits, contextItems })
          yield* failIfOperationCanceled({
            abortSignal: input.abortSignal,
            operationID: input.targetCurrentUser.promptOperationID,
            diagnosticCode: "lcm_provider_assembly_canceled_before_final_commit",
          })
          const committed = yield* lcmDb.executeForeground({
            operationID: input.targetCurrentUser.promptOperationID,
            purpose: "assembly",
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            run: async (db, control) => {
              const typedDb = db as PGlite & Transactional
              return typedDb.transaction(async (tx) => {
                const operationAbortSignal = control?.abortSignal ?? input.abortSignal
                const checkCanceled = (diagnosticCode: string) =>
                  throwIfOperationCanceled({
                    abortSignal: operationAbortSignal,
                    operationID: input.targetCurrentUser.promptOperationID,
                    diagnosticCode,
                  })
                checkCanceled("lcm_provider_assembly_canceled_before_final_state_validation")
                const currentConversation = await findConversation(tx, input.conversationID)
                if (
                  !currentConversation ||
                  !validateBoundaryMetadataV1(jsonValue(currentConversation.boundary_metadata_json)).ok ||
                  conversationAuthorityHash(currentConversation) !== authorityStateHash
                ) {
                  return { status: "authority_stale" } as const
                }
                const currentRows = await loadContextRows(tx, input.conversationID)
                checkCanceled("lcm_provider_assembly_canceled_after_final_context_reload")
                if (contextRowsSemanticHash(currentRows) !== contextStateHash) {
                  return { status: "context_stale" } as const
                }
                const validation = await validateContextRows({
                  db: tx,
                  conversationID: input.conversationID,
                  rows: currentRows,
                  allowEmpty: true,
                  artifactRoot: artifactRootFromDataDir(assemblyDbStatus.dataDir),
                })
                if (!validation.ok) return { status: "context_stale" } as const
                const currentRawEntries = await loadRawLeafMessageEntries({
                  db: tx,
                  conversationID: input.conversationID,
                  contextItems,
                })
                checkCanceled("lcm_provider_assembly_canceled_after_final_raw_reload")
                const currentMarkerMessages = await loadStandaloneLargeFileMarkerMessages({
                  db: tx,
                  conversationID: input.conversationID,
                  contextItems,
                })
                checkCanceled("lcm_provider_assembly_canceled_after_final_marker_reload")
                if (
                  modelVisibleSourceStateHash({
                    rawMessages: currentRawEntries.map((entry) => entry.message),
                    markerModelMessages: currentMarkerMessages,
                  }) !== sourceStateHash
                ) {
                  return { status: "context_stale" } as const
                }

                const now = Date.now()
                const protection = await requestSnapshotProtectionForConversation({
                  db: tx,
                  conversationID: input.conversationID,
                  nowMs: now,
                })
                checkCanceled("lcm_provider_assembly_canceled_after_final_protection_reload")
                const renderInputManifest = {
                  ...baseRenderInputManifest,
                  requestSnapshotProtectionHash: protection.requestSnapshotProtectionHash,
                }
                const aliasDiagnostic = validateRenderOptionAliases({
                  renderOptions: input.renderOptions,
                  manifest: renderInputManifest,
                })
                if (aliasDiagnostic) return { status: "invalid", diagnosticCode: aliasDiagnostic } as const
                const preparedProviderPayload = {
                  operationID: input.targetCurrentUser.promptOperationID,
                  conversationID: input.conversationID,
                  providerRequestSnapshotID: requestSnapshotID,
                  providerID: input.renderOptions.providerID,
                  modelID: input.renderOptions.modelID,
                  systemPromptHash: renderInputManifest.systemPromptHash,
                  toolSchemaHash: renderInputManifest.toolSchemaHash,
                  ...(prepared.toolChoice ? { toolChoiceHash: stableHash(prepared.toolChoice) } : {}),
                  modelMessages: validatedModelMessages,
                  renderInputManifest,
                  renderedSpans,
                  assemblyValidatorHash: renderInputManifest.assemblyValidatorHash,
                  system: prepared.system,
                  tools: prepared.tools,
                  ...(prepared.toolChoice ? { toolChoice: prepared.toolChoice } : {}),
                  format: prepared.format,
                } satisfies LcmRuntimePreparedProviderPayload
                const validationDiagnostic = validateAssemblyPayload({
                  payload: preparedProviderPayload,
                  modelMessageCount: prepared.modelMessages.length,
                  renderUnits,
                })
                if (validationDiagnostic) return { status: "invalid", diagnosticCode: validationDiagnostic } as const

                const providerSafe: ProviderSafeSnapshotEvidence = {
                  renderInputManifest,
                  items: providerSafeItems,
                }
                checkCanceled("lcm_provider_assembly_canceled_before_final_snapshot_write")
                if (assemblyThreshold && providerSafe.items.size === contextItems.length) {
                  await writeContextSnapshot({
                    db: tx,
                    conversationID: input.conversationID,
                    strategy: assemblyThreshold.strategy,
                    reason: "assembly",
                    nowMs: now,
                    threshold: {
                      activeTokens: assemblyThreshold.activeTokens,
                      hardLimit: assemblyThreshold.hardLimit,
                      softThreshold: assemblyThreshold.softThreshold,
                      freshTailTokens: assemblyThreshold.freshTailTokens,
                      softBacklogTokens: assemblyThreshold.softBacklogTokens,
                      softBacklogItemCount: assemblyThreshold.softBacklogItemCount,
                      freshTailRawTokens: assemblyThreshold.freshTailRawTokens,
                      freshTailRawItemCount: assemblyThreshold.freshTailRawItemCount,
                      unconsumedRawTokens: assemblyThreshold.unconsumedRawTokens,
                      unconsumedRawItemCount: assemblyThreshold.unconsumedRawItemCount,
                      protectedTailRawTokens: assemblyThreshold.protectedTailRawTokens,
                      protectedTailRawItemCount: assemblyThreshold.protectedTailRawItemCount,
                      rawLaneTokens: assemblyThreshold.rawLaneTokens,
                      hardFillRatio: assemblyThreshold.hardFillRatio,
                      rawLaneRatio: assemblyThreshold.rawLaneRatio,
                      softBacklogRatio: assemblyThreshold.softBacklogRatio,
                      lanes: assemblyThreshold.lanes,
                      tokenCounterMode: assemblyThreshold.tokenCounterMode,
                      tokenCounterVersion: assemblyThreshold.tokenCounterVersion,
                      providerContextLimit: assemblyThreshold.providerContextLimit,
                      providerInputLimit: assemblyThreshold.providerInputLimit,
                      providerOutputLimit: assemblyThreshold.providerOutputLimit,
                      outputReserve: assemblyThreshold.outputReserve,
                    },
                    providerSafe,
                  })
                }
                checkCanceled("lcm_provider_assembly_canceled_before_final_request_snapshot")
                await createProviderRequestSnapshot({
                  db: tx,
                  requestSnapshotID,
                  operationID: input.targetCurrentUser.promptOperationID as OperationID,
                  conversationID: input.conversationID,
                  sourceSessionID: input.sessionID,
                  providerID: input.renderOptions.providerID,
                  modelID: input.renderOptions.modelID,
                  renderUnits,
                  manifest: renderInputManifest,
                  nowMs: now,
                })
                checkCanceled("lcm_provider_assembly_canceled_after_final_request_snapshot")
                return { status: "committed", preparedProviderPayload, renderInputManifest } as const
              })
            },
          })
          if (committed.status !== "committed") {
            return {
              conversationID: input.conversationID,
              lifecycleState,
              ok: false,
              contextItems,
              safeError: invalidRequest(
                committed.status === "context_stale"
                  ? assemblyThreshold
                    ? "lcm_provider_assembly_threshold_context_stale"
                    : "lcm_provider_assembly_context_stale"
                  : committed.status === "authority_stale"
                    ? assemblyThreshold
                      ? "lcm_provider_assembly_threshold_authority_stale"
                      : "lcm_provider_assembly_authority_stale"
                    : committed.diagnosticCode,
              ),
            } satisfies LcmAssemblyResult
          }
          return {
            conversationID: input.conversationID,
            lifecycleState,
            ok: true,
            contextItems,
            modelMessages: validatedModelMessages,
            renderedSpans,
            activeTokens,
            preparedProviderPayload: committed.preparedProviderPayload,
            providerRequestSnapshotID: requestSnapshotID,
            normalizedParityKey: rawLeafNormalizedParityKey({
              modelMessages: prepared.modelMessages,
              renderInputManifest: committed.renderInputManifest,
            }),
          } satisfies LcmAssemblyResult
        }),
      isOverThreshold,
      compactLeavesToSprig,
      compactUntilUnderHardLimit,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LcmDb.defaultLayer))

export * as LcmContext from "./context"
