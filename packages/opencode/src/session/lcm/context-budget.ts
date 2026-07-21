// kilocode_change - extracted from the LCM context service
import { Effect } from "effect"
import { stableHash } from "./hash"
import { MessageV2 } from "../message-v2"
import { prepareKiloModelInput } from "./render-prep"
import { renderRetrievalCueModelText } from "./retrieval"
import { classifyLcmProviderFamily } from "./provider-protocol"
import { failIfOperationCanceled, throwIfOperationCanceled } from "./operation-control"
import { renderSummaryWrapper, renderArchiveStubWrapper } from "./summary"
import { validateBoundaryMetadataV1 } from "./validators"
import type {
  ContextItem,
  ContextItemID,
  ConversationID,
  LcmAssemblyInput,
  LcmLifecycleState,
  LcmRenderedSpan,
  LcmThresholdInput,
  MessageRowID,
  OperationID,
} from "./types"
import {
  LCM_TOKEN_BUDGET_CACHE_VERSION,
  createTokenCacheKey,
  deterministicFallbackTokenCount,
  renderManifestHash,
  stableTokenText,
  type LcmTokenCounter,
} from "./token-budget"
import {
  asNumber,
  type ContextRow,
  conversationAuthorityHash,
  contextRowsSemanticHash,
  hasRawLeafThresholdPreparation,
  invalidRequest,
  jsonValue,
  type LcmRawLeafRenderPreparationInput,
  type LcmRenderUnit,
  modelVisibleSourceStateHash,
  loadRawLeafMessageEntries,
  missingSource,
  normalizeModelMessagesForRawLeafParity,
  optionalNumber,
  type ProviderSafeSnapshotEvidence,
  type ProviderSafeSnapshotItem,
  type Queryable,
  recoveryRequired,
  rowCueID,
  rowCuePayload,
  rowToItem,
  type ThresholdAssemblyCache,
  type ThresholdContextItemCount,
  type ThresholdSource,
  validateRenderOptionAliases,
} from "./context-core"
import {
  buildRenderUnits,
  loadLargeFileMarkerText,
  loadRawFallbackText,
  loadStandaloneLargeFileMarkerMessages,
  loadSummaryMetadata,
  loadSummaryWrapperMessages,
  loadVisibilityProvenance,
  manifestWithAssemblyHashes,
  renderedSpanForUnit,
  renderPrefixCounts,
  withRenderUnitOrigins,
} from "./context-render"
import { findConversation, loadContextRows, validateContextRows } from "./context-state"

// Maintainer boundary: Threshold counting deliberately uses the same prepared render units as provider assembly. Cache identity must cover every model-visible transform or placement input.
export async function loadThresholdSource(input: {
  db: Queryable
  conversationID: ConversationID
  artifactRoot?: string
  includeRawMessages?: boolean
  hiddenSourceMessageIDs?: readonly string[]
}): Promise<ThresholdSource> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_threshold_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_threshold_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: true,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_threshold_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const contextItems = rows.map(rowToItem)
  const rawEntries = input.includeRawMessages
    ? await loadRawLeafMessageEntries({
        db: input.db,
        conversationID: input.conversationID,
        contextItems,
      })
    : []
  const rawMessages = rawEntries.map((entry) => entry.message)
  const summaryModelMessages = await loadSummaryWrapperMessages({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
  })
  const markerModelMessages = await loadStandaloneLargeFileMarkerMessages({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
  })
  const visibilityProvenance = await loadVisibilityProvenance({
    db: input.db,
    conversationID: input.conversationID,
    contextItems,
    hiddenSourceMessageIDs: input.hiddenSourceMessageIDs ?? [],
  })
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const rawFallbackText = await loadRawFallbackText(input.db, input.conversationID, rows)
  const largeFileText = await loadLargeFileMarkerText(input.db, input.conversationID, rows)
  const fallbackText = new Map<ContextItemID, string>()
  for (const row of rows) {
    if (row.item_type === "raw_message")
      fallbackText.set(row.context_item_id, rawFallbackText.get(row.message_row_id!) ?? "")
    else if (row.item_type === "summary") {
      const summary = summaryMetadata.get(row.summary_id!)
      fallbackText.set(
        row.context_item_id,
        renderSummaryWrapper({
          summaryID: row.summary_id!,
          contentText: summary?.text ?? "",
          parentSummaryIDs: summary?.parentSummaryIDs,
          objectiveStatus: summary?.objectiveStatus,
          fallbackMode: summary?.fallbackMode,
          sourceTokenCount: summary?.sourceTokenCount,
          summaryTokenCount: summary?.summaryTokenCount,
        }),
      )
    } else if (row.item_type === "archive_stub") {
      fallbackText.set(
        row.context_item_id,
        renderArchiveStubWrapper({ summaryID: row.summary_id!, pointerID: row.pointer_id! }),
      )
    } else if (row.item_type === "large_file_marker") {
      fallbackText.set(row.context_item_id, largeFileText.get(row.file_id!) ?? `file:${row.file_id}`)
    } else {
      const cue = rowCuePayload(row)
      fallbackText.set(row.context_item_id, cue ? renderRetrievalCueModelText(cue, rowCueID(row)) : "")
    }
  }
  return {
    conversation,
    rows,
    contextItems,
    rawEntries,
    rawMessages,
    summaryModelMessages,
    markerModelMessages,
    visibilityProvenance,
    summaryMetadata,
    fallbackText,
  }
}

export function thresholdSourceSemanticHash(source: ThresholdSource) {
  const entries = <K extends string, V>(values: ReadonlyMap<K, V>) =>
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right))
  return stableHash({
    namespace: "lcm-threshold-source-state-v1",
    rawMessages: source.rawMessages,
    summaryModelMessages: entries(source.summaryModelMessages),
    markerModelMessages: entries(source.markerModelMessages),
    summaryMetadata: entries(source.summaryMetadata),
    fallbackText: entries(source.fallbackText),
    hiddenContextItemIDs: [...source.visibilityProvenance.hiddenContextItemIDs].sort(),
    missingContextItemIDs: [...source.visibilityProvenance.missingContextItemIDs].sort(),
  })
}

function selectLastUser(input: {
  readonly messages: readonly MessageV2.WithParts[]
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}) {
  const lastUserMessageID = input.renderPreparation.lastUserMessageID ?? input.renderPreparation.lastUser?.id
  const reconstructed =
    lastUserMessageID === undefined
      ? input.messages.findLast((message) => message.info.role === "user")?.info
      : input.messages.find((message) => message.info.role === "user" && message.info.id === lastUserMessageID)?.info
  if (!reconstructed || reconstructed.role !== "user") throw invalidRequest("lcm_raw_leaf_last_user_not_found")
  if (!input.renderPreparation.lastUser) return reconstructed
  if (
    input.renderPreparation.lastUser.id !== reconstructed.id ||
    input.renderPreparation.lastUser.sessionID !== reconstructed.sessionID
  ) {
    throw invalidRequest("lcm_raw_leaf_last_user_mismatch")
  }
  return {
    ...reconstructed,
    editorContext: input.renderPreparation.lastUser.editorContext,
  }
}

function cacheKeyForRow(input: {
  readonly row: ContextRow
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly providerID: string
  readonly modelID: string
  readonly text: string
  readonly contentKind: "message" | "summary" | "marker" | "cue"
  readonly promptVersion?: string
}) {
  const contentID =
    input.row.item_type === "raw_message"
      ? input.row.message_row_id!
      : input.row.item_type === "summary" || input.row.item_type === "archive_stub"
        ? input.row.summary_id!
        : input.row.item_type === "large_file_marker"
          ? input.row.file_id!
          : rowCueID(input.row)
  return createTokenCacheKey({
    mode: input.counter.mode,
    version: input.counter.version,
    providerID: input.providerID,
    modelID: input.modelID,
    contentKind: input.contentKind,
    contentID,
    contentSha256: stableHash(input.text),
    renderManifestHash: input.renderHash,
    promptVersion: input.promptVersion,
    wrapperVersion: `lcm-context-wrapper-v${LCM_TOKEN_BUDGET_CACHE_VERSION}`,
  })
}

export function countContextItems(input: {
  readonly source: ThresholdSource
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly providerID: string
  readonly modelID: string
  readonly rawModelTexts: readonly string[]
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}): ThresholdContextItemCount[] {
  let rawIndex = 0
  const output: ThresholdContextItemCount[] = []
  for (const row of input.source.rows) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_threshold_canceled_while_counting_context",
    })
    const text =
      row.item_type === "raw_message"
        ? (input.rawModelTexts[rawIndex++] ?? input.source.fallbackText.get(row.context_item_id) ?? "")
        : (input.source.fallbackText.get(row.context_item_id) ?? "")
    const cacheKind =
      row.item_type === "raw_message"
        ? "message"
        : row.item_type === "summary" || row.item_type === "archive_stub"
          ? "summary"
          : row.item_type === "large_file_marker"
            ? "marker"
            : "cue"
    const cacheKey = cacheKeyForRow({
      row,
      counter: input.counter,
      renderHash: input.renderHash,
      providerID: input.providerID,
      modelID: input.modelID,
      text,
      contentKind: cacheKind,
      promptVersion:
        row.item_type === "summary" || row.item_type === "archive_stub"
          ? input.source.summaryMetadata.get(row.summary_id!)?.promptVersion
          : undefined,
    })
    const cached =
      row.cache_key === cacheKey && asNumber(row.cache_version) === LCM_TOKEN_BUDGET_CACHE_VERSION
        ? optionalNumber(row.token_count)
        : undefined
    const tokenCount = cached ?? input.counter.countText({ text, cacheKey })
    const summary = row.summary_id ? input.source.summaryMetadata.get(row.summary_id) : undefined
    output.push({
      row,
      tokenCount,
      cacheKey,
      lane: {
        itemType: row.item_type,
        tokenCount,
        summaryType: summary?.summaryType,
        summaryLevel: summary?.summaryLevel,
      },
    })
  }
  return output
}

function contextItemIDForRenderUnit(input: {
  readonly unit: LcmRenderUnit
  readonly rawRowByMessageID: ReadonlyMap<MessageRowID, ContextRow>
}) {
  if (
    input.unit.source.kind === "raw_message" ||
    input.unit.source.kind === "summary" ||
    input.unit.source.kind === "archive_stub" ||
    input.unit.source.kind === "large_file_marker" ||
    input.unit.source.kind === "retrieval_cue"
  ) {
    return input.unit.source.contextItemID
  }
  if (input.unit.source.kind === "target_current_user" && input.unit.source.messageRowID) {
    return input.rawRowByMessageID.get(input.unit.source.messageRowID)?.context_item_id
  }
  return undefined
}

function renderUnitSnapshotItems(input: {
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly rawRowByMessageID: ReadonlyMap<MessageRowID, ContextRow>
}) {
  const items = new Map<ContextItemID, ProviderSafeSnapshotItem>()
  for (const unit of input.renderUnits) {
    const contextItemID = contextItemIDForRenderUnit({ unit, rawRowByMessageID: input.rawRowByMessageID })
    if (!contextItemID) continue
    items.set(contextItemID, {
      contextItemID,
      renderUnitID: unit.renderUnitID,
      canonicalOrder: unit.canonicalOrder,
      effectiveOrder: unit.effectiveOrder,
      placementSlot: unit.placementSlot,
    })
  }
  return items
}

export function renderUnitSnapshotItemsFromContextItems(input: {
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly contextItems: readonly ContextItem[]
}) {
  const rawContextItemByMessageID = new Map(
    input.contextItems
      .filter((item): item is Extract<ContextItem, { itemType: "raw_message" }> => item.itemType === "raw_message")
      .map((item) => [item.messageRowID, item.contextItemID] as const),
  )
  const items = new Map<ContextItemID, ProviderSafeSnapshotItem>()
  for (const unit of input.renderUnits) {
    const contextItemID =
      unit.source.kind === "target_current_user" && unit.source.messageRowID
        ? rawContextItemByMessageID.get(unit.source.messageRowID)
        : "contextItemID" in unit.source
          ? unit.source.contextItemID
          : undefined
    if (!contextItemID) continue
    items.set(contextItemID, {
      contextItemID,
      renderUnitID: unit.renderUnitID,
      canonicalOrder: unit.canonicalOrder,
      effectiveOrder: unit.effectiveOrder,
      placementSlot: unit.placementSlot,
    })
  }
  return items
}

function targetCurrentUserForThreshold(input: {
  readonly source: ThresholdSource
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly thresholdInput: LcmThresholdInput
}) {
  const lastUser = selectLastUser({ messages: input.source.rawMessages, renderPreparation: input.renderPreparation })
  const entry = input.source.rawEntries.find(
    (candidate) =>
      candidate.sourceRow.source_session_id === lastUser.sessionID &&
      candidate.sourceRow.source_message_id === lastUser.id,
  )
  if (!entry)
    throw missingSource("lcm_threshold_target_current_user_unproven", input.source.conversation.conversation_id)
  const provided = input.thresholdInput.targetCurrentUser
  if (
    provided &&
    (provided.sourceSessionID !== lastUser.sessionID ||
      provided.sourceMessageID !== lastUser.id ||
      (provided.messageRowID !== undefined && provided.messageRowID !== entry.item.messageRowID))
  ) {
    throw invalidRequest("lcm_threshold_target_current_user_mismatch")
  }
  const promptOperationID =
    provided?.promptOperationID ??
    (`op_lcm_threshold_${stableHash({
      conversationID: input.source.conversation.conversation_id,
      sourceSessionID: lastUser.sessionID,
      sourceMessageID: lastUser.id,
      messageRowID: entry.item.messageRowID,
      visibilityHash: input.renderPreparation.messageVisibility?.hash,
    }).slice(0, 24)}` as OperationID)
  return {
    lastUser,
    targetCurrentUser: {
      sourceSessionID: lastUser.sessionID,
      sourceMessageID: lastUser.id,
      messageRowID: entry.item.messageRowID,
      promptOperationID,
      visibilityBaseMessageID: provided?.visibilityBaseMessageID || lastUser.id,
    } satisfies LcmAssemblyInput["targetCurrentUser"],
  }
}

export function targetMessageRowIDForSoftBacklog(input: {
  source: ThresholdSource
  thresholdInput: LcmThresholdInput
}) {
  if (input.thresholdInput.targetCurrentUser?.messageRowID) return input.thresholdInput.targetCurrentUser.messageRowID
  if (!hasRawLeafThresholdPreparation(input.thresholdInput) || !input.thresholdInput.renderPreparation) return undefined
  const renderPreparation = input.thresholdInput.renderPreparation
  const sourceMessageID = renderPreparation.lastUserMessageID ?? renderPreparation.lastUser?.id
  if (!sourceMessageID) return undefined
  return input.source.rawEntries.find((entry) => entry.sourceRow.source_message_id === sourceMessageID)?.item
    .messageRowID
}

function countContextItemsFromRenderUnits(input: {
  readonly source: ThresholdSource
  readonly counter: LcmTokenCounter
  readonly renderHash: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly modelMessages: readonly unknown[]
  readonly providerID: string
  readonly modelID: string
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  const rawRowByMessageID = new Map(
    input.source.rows
      .filter((row) => row.item_type === "raw_message" && row.message_row_id)
      .map((row) => [row.message_row_id!, row] as const),
  )
  const rowByContextItemID = new Map(input.source.rows.map((row) => [row.context_item_id, row] as const))
  const spanByRenderUnitID = new Map(input.renderedSpans.map((span) => [span.renderUnitID, span] as const))
  const output: ThresholdContextItemCount[] = []
  for (const unit of input.renderUnits) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_threshold_canceled_while_counting_render_units",
    })
    const contextItemID = contextItemIDForRenderUnit({ unit, rawRowByMessageID })
    if (!contextItemID) throw invalidRequest("lcm_threshold_render_unit_context_item_missing")
    const row = rowByContextItemID.get(contextItemID)
    if (!row) throw invalidRequest("lcm_threshold_render_unit_context_row_missing")
    const span = spanByRenderUnitID.get(unit.renderUnitID)
    if (!span) throw invalidRequest("lcm_threshold_render_unit_span_missing")
    const text =
      span.messageCount === 0
        ? ""
        : stableTokenText(
            normalizeModelMessagesForRawLeafParity(
              input.modelMessages.slice(span.startIndex, span.startIndex + span.messageCount),
            ),
          )
    const cacheKind =
      row.item_type === "raw_message"
        ? "message"
        : row.item_type === "summary" || row.item_type === "archive_stub"
          ? "summary"
          : row.item_type === "large_file_marker"
            ? "marker"
            : "cue"
    const cacheKey = cacheKeyForRow({
      row,
      counter: input.counter,
      renderHash: input.renderHash,
      providerID: input.providerID,
      modelID: input.modelID,
      text,
      contentKind: cacheKind,
      promptVersion:
        row.item_type === "summary" || row.item_type === "archive_stub"
          ? input.source.summaryMetadata.get(row.summary_id!)?.promptVersion
          : undefined,
    })
    const cached =
      row.cache_key === cacheKey && asNumber(row.cache_version) === LCM_TOKEN_BUDGET_CACHE_VERSION
        ? optionalNumber(row.token_count)
        : undefined
    const tokenCount = cached ?? input.counter.countText({ text, cacheKey })
    const summary = row.summary_id ? input.source.summaryMetadata.get(row.summary_id) : undefined
    output.push({
      row,
      tokenCount,
      cacheKey,
      lane: {
        itemType: row.item_type,
        tokenCount,
        summaryType: summary?.summaryType,
        summaryLevel: summary?.summaryLevel,
      },
    })
  }
  return output.sort((left, right) => asNumber(left.row.item_order) - asNumber(right.row.item_order))
}

export function countAssemblyActiveTokens(input: {
  readonly modelMessages: readonly unknown[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  let total = 0
  for (const span of input.renderedSpans) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_provider_assembly_canceled_while_counting_active_tokens",
    })
    if (span.messageCount === 0) continue
    const text = stableTokenText(
      normalizeModelMessagesForRawLeafParity(
        input.modelMessages.slice(span.startIndex, span.startIndex + span.messageCount),
      ),
    )
    total += deterministicFallbackTokenCount(text)
  }
  return total
}

// Threshold counting intentionally prepares the same provider payload as final
// assembly. Keep this path and assembleModelMessages in structural parity.
export function countThresholdFromAssembly(input: {
  readonly source: ThresholdSource
  readonly thresholdInput: LcmThresholdInput
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly renderOptions: LcmAssemblyInput["renderOptions"]
  readonly counter: LcmTokenCounter
  readonly abortSignal?: AbortSignal
  readonly consumedSourceHash: string
  readonly providerTransformOverheadReserveTokens: number
}) {
  return Effect.gen(function* () {
    const { lastUser, targetCurrentUser } = targetCurrentUserForThreshold({
      source: input.source,
      renderPreparation: input.renderPreparation,
      thresholdInput: input.thresholdInput,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_before_render_units",
    })
    const renderUnits = withRenderUnitOrigins(
      buildRenderUnits({
        conversationID: input.source.conversation.conversation_id,
        contextItems: input.source.contextItems,
        rawEntries: input.source.rawEntries,
        summaryModelMessages: input.source.summaryModelMessages,
        markerModelMessages: input.source.markerModelMessages,
        visibilityProvenance: input.source.visibilityProvenance,
        renderPreparation: input.renderPreparation,
        targetCurrentUser,
        abortSignal: input.abortSignal,
      }),
    )
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_render_units",
    })
    const prepared = yield* prepareKiloModelInput({
      ...input.renderPreparation,
      messages: renderUnits.map((unit) => unit.message),
      lastUser,
      lcmActive: true,
      stripMedia: input.renderOptions.stripMedia,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_render_preparation",
    })
    const prefixCounts = yield* renderPrefixCounts({
      messages: prepared.messages,
      renderPreparation: input.renderPreparation,
      stripMedia: input.renderOptions.stripMedia,
      expectedModelMessageCount: prepared.modelMessages.length,
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
    })
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_threshold_canceled_after_prefix_counts",
    })
    const providerFamily = classifyLcmProviderFamily({
      providerID: input.renderPreparation.model.providerID,
      modelID: input.renderPreparation.model.id,
      apiNpm: input.renderPreparation.model.api.npm,
      apiID: input.renderPreparation.model.api.id,
      interleaved: input.renderPreparation.model.capabilities?.interleaved === true,
    })
    const renderedSpans = renderUnits.map((unit, index) =>
      renderedSpanForUnit({
        unit,
        startIndex: prefixCounts[index] ?? 0,
        messageCount: (prefixCounts[index + 1] ?? 0) - (prefixCounts[index] ?? 0),
        providerFamily,
        providerTransformHash: prepared.renderInputManifest.providerTransformHash,
        renderPreparation: input.renderPreparation,
      }),
    )
    const renderInputManifest = manifestWithAssemblyHashes({
      manifest: prepared.renderInputManifest,
      renderUnits,
      renderedSpans,
      providerTransformHash: prepared.renderInputManifest.providerTransformHash,
    })
    const aliasDiagnostic = validateRenderOptionAliases({
      renderOptions: input.renderOptions,
      manifest: renderInputManifest,
    })
    if (aliasDiagnostic) throw invalidRequest(aliasDiagnostic)
    const renderHash = renderManifestHash(renderInputManifest)
    const rawRowByMessageID = new Map(
      input.source.rows
        .filter((row) => row.item_type === "raw_message" && row.message_row_id)
        .map((row) => [row.message_row_id!, row] as const),
    )
    const activeTokens = countAssemblyActiveTokens({
      modelMessages: prepared.modelMessages,
      renderedSpans,
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
    })
    return {
      counted: countContextItemsFromRenderUnits({
        source: input.source,
        counter: input.counter,
        renderHash,
        renderUnits,
        renderedSpans,
        modelMessages: prepared.modelMessages,
        providerID: input.renderOptions.providerID,
        modelID: input.renderOptions.modelID,
        abortSignal: input.abortSignal,
        operationID: targetCurrentUser.promptOperationID,
      }),
      systemText: stableTokenText(prepared.system),
      toolText: stableTokenText(prepared.tools),
      renderHash,
      providerSafe: {
        renderInputManifest,
        items: renderUnitSnapshotItems({ renderUnits, rawRowByMessageID }),
      } satisfies ProviderSafeSnapshotEvidence,
      assemblyCache: {
        conversationID: input.source.conversation.conversation_id,
        lifecycleState: input.source.conversation.lifecycle_state as LcmLifecycleState,
        conversationAuthorityHash: conversationAuthorityHash(input.source.conversation),
        renderPreparation: input.renderPreparation,
        contextItems: input.source.contextItems,
        contextStateHash: contextRowsSemanticHash(input.source.rows),
        modelVisibleSourceStateHash: modelVisibleSourceStateHash({
          rawMessages: input.source.rawMessages,
          markerModelMessages: input.source.markerModelMessages,
        }),
        consumedSourceHash: input.consumedSourceHash,
        providerTransformOverheadReserveTokens: input.providerTransformOverheadReserveTokens,
        targetCurrentUserHash: stableHash(input.thresholdInput.targetCurrentUser ?? targetCurrentUser),
        renderOptionsHash: stableHash(input.renderOptions),
        renderUnits,
        prepared,
        renderedSpans,
        renderInputManifest,
        activeTokens,
        providerSafe: {
          renderInputManifest,
          items: renderUnitSnapshotItems({ renderUnits, rawRowByMessageID }),
        },
      } satisfies ThresholdAssemblyCache,
    }
  })
}

export function overheadCacheKey(input: {
  readonly counter: LcmTokenCounter
  readonly providerID: string
  readonly modelID: string
  readonly renderHash: string
  readonly contentKind: "prompt" | "tool_schema"
  readonly text: string
}) {
  return createTokenCacheKey({
    mode: input.counter.mode,
    version: input.counter.version,
    providerID: input.providerID,
    modelID: input.modelID,
    contentKind: input.contentKind,
    contentSha256: stableHash(input.text),
    renderManifestHash: input.renderHash,
  })
}
