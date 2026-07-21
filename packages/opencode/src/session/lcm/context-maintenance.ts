// kilocode_change - extracted from the LCM context service
import { resolveLcmDbLayout } from "./db-layout"
import { RUNTIME_DEFAULTS } from "./config"
import {
  allocateContextItemID,
  allocateSummaryID,
  allocateSummaryLineagePointerID,
  allocateUsageRecordID,
} from "./id-allocation"
import {
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
  LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  renderSummaryWrapper,
  renderArchiveStubWrapper,
  runCondenseSummaryGeneration,
  runLeafSummaryGeneration,
  type LcmCondenseSummarySourceItem,
  type LcmLeafSummarySourceItem,
  type LcmSummaryAttemptEvidence,
} from "./summary"
import { validateBoundaryMetadataV1 } from "./validators"
import type {
  ConversationID,
  LcmLeafCompactionInput,
  LcmProtectedCurrentUserInput,
  LcmRecoveryResult,
  LcmStrategy,
  LcmUsageMode,
  MessageRowID,
  OperationID,
  SessionID,
  SummaryID,
} from "./types"
import type { LcmTokenCounter } from "./token-budget"
import {
  asNumber,
  type ContextRow,
  type ConversationRow,
  invalidRequest,
  jsonValue,
  optionalNumber,
  type Queryable,
  recoveryRequired,
  type SummaryCondensePromptVersion,
  type SummaryMetadata,
  type Transactional,
} from "./context-core"
import { loadRawFallbackText, loadSummaryMetadata, selectSoftBacklogRows } from "./context-render"
import {
  count,
  findConversation,
  insertContextRow,
  loadConsumedRawMessageRowIDs,
  loadContextRows,
  validateContextRows,
  writeContextSnapshot,
} from "./context-state"

// Maintainer boundary: Maintenance selects against a validated snapshot, performs provider work outside mutations, then revalidates selection inside the commit transaction. Do not weaken that optimistic concurrency boundary.
interface LeafSummarySelection {
  readonly conversation: ConversationRow
  readonly rows: ContextRow[]
  readonly sourceItems: LcmLeafSummarySourceItem[]
  readonly protectedTailCount: number
  readonly strategy: LcmStrategy
}

interface LeafSummarySkippedSelection {
  readonly skipped: true
  readonly candidateTokens: number
  readonly candidateItemCount: number
  readonly safeMessage?: string
}

export function isLeafSummarySkippedSelection(
  selection: LeafSummarySelection | LeafSummarySkippedSelection | undefined,
): selection is LeafSummarySkippedSelection {
  return !!selection && "skipped" in selection && selection.skipped === true
}

function leafSummaryProtectedTailCount(input: { strategy: LcmStrategy; reason: LcmLeafCompactionInput["reason"] }) {
  if (input.reason === "soft_threshold") {
    return RUNTIME_DEFAULTS.performance.minProtectedTailLeaves
  }
  return RUNTIME_DEFAULTS.performance.minProtectedTailLeaves
}

async function resolveProtectedCurrentUserMessageRowID(input: {
  db: Queryable
  conversationID: ConversationID
  protectedCurrentUser?: LcmProtectedCurrentUserInput
}) {
  const protectedCurrentUser = input.protectedCurrentUser
  if (!protectedCurrentUser) return undefined
  const rows = (
    await input.db.query<{ message_row_id: MessageRowID }>(
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
            input.conversationID,
            protectedCurrentUser.sourceSessionID,
            protectedCurrentUser.sourceMessageID,
            protectedCurrentUser.messageRowID,
          ]
        : [input.conversationID, protectedCurrentUser.sourceSessionID, protectedCurrentUser.sourceMessageID],
    )
  ).rows
  return rows[0]?.message_row_id
}

function protectedCurrentUserSkipSelection(input: { protectedCurrentUser: LcmProtectedCurrentUserInput }) {
  return {
    skipped: true,
    candidateTokens: 0,
    candidateItemCount: 0,
    safeMessage:
      "Memory maintenance was skipped because the current user boundary is not available as a raw memory row.",
  } satisfies LeafSummarySkippedSelection
}

// Selection is optimistic: commitLeafSummary must re-check the selected rows
// after provider work because active context may change in the meantime.
export async function selectLeafSummarySource(input: {
  db: Queryable
  conversationID: ConversationID
  reason: LcmLeafCompactionInput["reason"]
  maintenanceInputBudget?: number
  maxSourceTokens?: number
  counter: LcmTokenCounter
  protectedMessageRowIDs?: readonly MessageRowID[]
  protectedCurrentUser?: LcmProtectedCurrentUserInput
  softThreshold?: number
  freshTailTokens?: number
  artifactRoot?: string
}): Promise<LeafSummarySelection | LeafSummarySkippedSelection | undefined> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_leaf_summary_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_leaf_summary_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_leaf_summary_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const strategy = conversation.strategy ?? "upward"
  const protectedTailCount = leafSummaryProtectedTailCount({ strategy, reason: input.reason })
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const defaultLeafBudget =
    strategy === "dolt" ? RUNTIME_DEFAULTS.dolt.leaves.target : RUNTIME_DEFAULTS.upward.leafChunkTokens
  const protectedCurrentUserMessageRowID = await resolveProtectedCurrentUserMessageRowID({
    db: input.db,
    conversationID: input.conversationID,
    protectedCurrentUser: input.protectedCurrentUser,
  })
  if (input.reason === "soft_threshold" && input.protectedCurrentUser) {
    const protectedCurrentUserActive =
      protectedCurrentUserMessageRowID !== undefined &&
      rows.some((row) => row.item_type === "raw_message" && row.message_row_id === protectedCurrentUserMessageRowID)
    if (!protectedCurrentUserActive) {
      return protectedCurrentUserSkipSelection({
        protectedCurrentUser: input.protectedCurrentUser,
      })
    }
  }
  const protectedMessageRowIDs = new Set(input.protectedMessageRowIDs ?? [])
  if (protectedCurrentUserMessageRowID) protectedMessageRowIDs.add(protectedCurrentUserMessageRowID)
  const isUnprotectedRawRow = (row: ContextRow) =>
    row.item_type === "raw_message" && row.message_row_id && !protectedMessageRowIDs.has(row.message_row_id)
  const rawRows = rows.filter(isUnprotectedRawRow)
  const consumedMessageRowIDs =
    input.reason === "soft_threshold"
      ? await loadConsumedRawMessageRowIDs(input.db, input.conversationID)
      : new Set<MessageRowID>()
  const eligibleRows =
    input.reason === "soft_threshold"
      ? selectSoftBacklogRows({
          rows,
          summaryMetadata,
          strategy,
          targetMessageRowID: protectedCurrentUserMessageRowID,
          freshTailTokens: input.freshTailTokens,
          consumedMessageRowIDs,
        }).filter(isUnprotectedRawRow)
      : rawRows.slice(0, Math.max(0, rawRows.length - protectedTailCount))
  if (eligibleRows.length < RUNTIME_DEFAULTS.performance.minMessagesToSummarize) {
    if (input.reason !== "soft_threshold") return undefined
    return {
      skipped: true,
      candidateTokens: 0,
      candidateItemCount: eligibleRows.length,
    }
  }

  const rawFallbackText = await loadRawFallbackText(input.db, input.conversationID, eligibleRows)
  const sourceItems: LcmLeafSummarySourceItem[] = []
  const targetTokens = input.maintenanceInputBudget ?? input.maxSourceTokens ?? defaultLeafBudget
  let tokenTotal = 0
  for (const row of eligibleRows) {
    const text = rawFallbackText.get(row.message_row_id!) ?? ""
    const tokenCount = optionalNumber(row.token_count) ?? input.counter.countText({ text })
    if (tokenCount <= 0) continue
    if (input.reason === "soft_threshold" && tokenTotal + tokenCount > targetTokens) break
    sourceItems.push({
      messageRowID: row.message_row_id!,
      text,
      tokenCount,
    })
    tokenTotal += tokenCount
    if (
      input.reason !== "soft_threshold" &&
      sourceItems.length >= RUNTIME_DEFAULTS.upward.leafMinFanout &&
      tokenTotal >= targetTokens
    )
      break
  }

  if (sourceItems.length < RUNTIME_DEFAULTS.performance.minMessagesToSummarize || tokenTotal <= 1) {
    if (input.reason !== "soft_threshold") return undefined
    return {
      skipped: true,
      candidateTokens: tokenTotal,
      candidateItemCount: sourceItems.length,
    }
  }
  return {
    conversation,
    rows,
    sourceItems,
    protectedTailCount,
    strategy,
  }
}

export function usageModeForLeafSummary(input: LcmLeafCompactionInput): LcmUsageMode {
  return input.blocking ? "blocking" : "background"
}

async function insertLeafSummaryUsageRecord(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  evidence: LcmSummaryAttemptEvidence
  purpose?: "leaf_summary" | "condensation" | "hard_limit_maintenance"
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const usageRecordID = await allocateUsageRecordID(input.db)
  const usage = input.evidence.usage
  await input.db.query(
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
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        cost_amount,
        cost_currency,
        cost_status,
        summary_target_tokens,
        summary_generation_max_output_tokens,
        maintenance_input_budget,
        summary_source_tokens,
        candidate_summary_tokens,
        accepted_summary_tokens,
        summary_objective_status,
        summary_fallback_mode,
        summary_reasoning_policy,
        summary_retry_attempt,
        created_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26
      )
    `,
    [
      usageRecordID,
      input.conversationID,
      input.sessionID,
      input.operationID,
      input.purpose ?? "leaf_summary",
      input.mode,
      usage?.providerID ?? input.providerID ?? null,
      usage?.modelID ?? input.modelID ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.cacheReadTokens ?? null,
      usage?.cacheWriteTokens ?? null,
      usage?.costAmount ?? null,
      usage?.costCurrency ?? null,
      usage?.costStatus ?? (input.evidence.providerBacked ? "unknown" : "not_applicable"),
      input.evidence.summaryTargetTokens,
      input.evidence.summaryGenerationMaxOutputTokens,
      input.evidence.maintenanceInputBudget,
      input.evidence.summarySourceTokens,
      input.evidence.candidateSummaryTokens ?? null,
      input.evidence.acceptedSummaryTokens ?? null,
      input.evidence.summaryObjectiveStatus,
      input.evidence.summaryFallbackMode,
      input.evidence.summaryReasoningPolicy,
      input.evidence.summaryRetryAttempt,
      input.nowMs,
    ],
  )
  return usageRecordID
}

export async function insertMaintenanceUsageEvidence(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  purpose: "leaf_summary" | "condensation" | "hard_limit_maintenance"
  evidence: readonly LcmSummaryAttemptEvidence[]
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  let committedUsageRecordID: string | undefined
  for (const evidence of input.evidence) {
    const usageRecordID = await insertLeafSummaryUsageRecord({
      ...input,
      evidence,
    })
    if (
      evidence.summaryObjectiveStatus === "provider_accepted" ||
      evidence.summaryObjectiveStatus === "fallback_accepted"
    ) {
      committedUsageRecordID = usageRecordID
    }
  }
  return committedUsageRecordID
}

// Keep summary, lineage, usage, active-row replacement, and snapshot writes in
// this transaction so a failed commit cannot expose a partial derived state.
export async function commitLeafSummary(input: {
  db: Transactional
  conversationID: ConversationID
  operationID: OperationID
  selection: LeafSummarySelection
  summary: Awaited<ReturnType<typeof runLeafSummaryGeneration>>
  blocking: boolean
  reason: LcmLeafCompactionInput["reason"]
  sessionID?: SessionID
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const selectedMessageIDs = new Set(input.selection.sourceItems.map((item) => item.messageRowID))
  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selectedRows = currentRows.filter(
      (row) => row.item_type === "raw_message" && selectedMessageIDs.has(row.message_row_id!),
    )
    if (selectedRows.length !== input.selection.sourceItems.length) {
      throw recoveryRequired("lcm_leaf_summary_context_changed", input.conversationID)
    }
    const selectedContextIDs = new Set(selectedRows.map((row) => row.context_item_id))
    const summaryID = await allocateSummaryID(tx)
    const summaryContextID = await allocateContextItemID(tx)
    const usageRecordID = input.sessionID
      ? await insertMaintenanceUsageEvidence({
          db: tx,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          mode: usageModeForLeafSummary({
            conversationID: input.conversationID,
            reason: input.reason,
            blocking: input.blocking,
          }),
          purpose: "leaf_summary",
          evidence: input.summary.usageEvidence,
          providerID: input.providerID,
          modelID: input.modelID,
          nowMs: input.nowMs,
        })
      : undefined

    await tx.query(
      `
        INSERT INTO lcm_summaries (
          summary_id,
          conversation_id,
          summary_type,
          content_text,
          source_token_count,
          summary_token_count,
          summary_level,
          prompt_version,
          strategy,
          provider_id,
          model_id,
          usage_record_id,
          objective_status,
          fallback_mode,
          created_at_ms
        )
        VALUES ($1, $2, 'sprig', $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        summaryID,
        input.conversationID,
        input.summary.contentText,
        input.summary.sourceTokenCount,
        input.summary.summaryTokenCount,
        LCM_LEAF_SUMMARY_PROMPT_VERSION,
        input.selection.strategy,
        input.summary.usage?.providerID ?? input.providerID ?? null,
        input.summary.usage?.modelID ?? input.modelID ?? null,
        usageRecordID ?? null,
        input.summary.objectiveStatus,
        input.summary.fallbackMode,
        input.nowMs,
      ],
    )

    for (const [index, item] of input.selection.sourceItems.entries()) {
      await tx.query(
        `
          INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order)
          VALUES ($1, $2, $3)
        `,
        [summaryID, item.messageRowID, index + 1],
      )
    }

    const summaryRow: ContextRow = {
      context_item_id: summaryContextID,
      conversation_id: input.conversationID,
      item_order: 0,
      item_type: "summary",
      message_row_id: null,
      summary_id: summaryID,
      pointer_id: null,
      file_id: null,
      cue_payload_json: null,
      token_count: input.summary.summaryTokenCount,
      cache_key: null,
      cache_version: null,
      created_at_ms: input.nowMs,
      updated_at_ms: input.nowMs,
    }

    const nextRows: ContextRow[] = []
    let insertedSummary = false
    for (const row of currentRows) {
      if (selectedContextIDs.has(row.context_item_id)) {
        if (!insertedSummary) {
          nextRows.push(summaryRow)
          insertedSummary = true
        }
        continue
      }
      nextRows.push(row)
    }
    if (!insertedSummary) nextRows.push(summaryRow)

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === summaryContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await tx.query(
      `
        UPDATE lcm_conversations
        SET updated_at_ms = $2
        WHERE conversation_id = $1
      `,
      [input.conversationID, input.nowMs],
    )

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.selection.strategy,
      reason: "leaf_summary",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(`lcm_leaf_summary_commit_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

    return {
      summaryID,
      contextItemsReplaced: selectedRows.length,
      afterContextItems: validation.items ?? [],
    }
  })
}

interface SummaryCondenseSelection {
  readonly conversation: ConversationRow
  readonly rows: ContextRow[]
  readonly selectedRows: ContextRow[]
  readonly sourceItems: LcmCondenseSummarySourceItem[]
  readonly strategy: LcmStrategy
  readonly targetLane: "sprigs" | "bindles"
}

function summaryLane(metadata: SummaryMetadata | undefined): "sprigs" | "bindles" | undefined {
  if (metadata?.summaryType === "sprig") return "sprigs"
  if (metadata?.summaryType === "bindle") return "bindles"
  return undefined
}

function condenseMinFanout(input: { strategy: LcmStrategy; targetLane: "sprigs" | "bindles"; hardPressure: boolean }) {
  if (input.strategy === "dolt") {
    if (input.targetLane === "sprigs") {
      return input.hardPressure ? RUNTIME_DEFAULTS.dolt.sprigs.hardMinFanout : RUNTIME_DEFAULTS.dolt.sprigs.minFanout
    }
    return input.hardPressure ? 2 : 2
  }
  return input.hardPressure
    ? RUNTIME_DEFAULTS.upward.condensedMinFanoutHard
    : RUNTIME_DEFAULTS.upward.condensedMinFanout
}

function condenseTargetTokens(input: { strategy: LcmStrategy; targetLane: "sprigs" | "bindles" }) {
  if (input.strategy === "dolt") {
    return input.targetLane === "sprigs" ? RUNTIME_DEFAULTS.dolt.sprigs.target : RUNTIME_DEFAULTS.dolt.bindles.target
  }
  return RUNTIME_DEFAULTS.upward.condensedTargetTokens
}

function sameOrderRows(left: ContextRow, right: ContextRow) {
  return asNumber(right.item_order) === asNumber(left.item_order) + 1
}

function candidateSourceItems(input: {
  rows: readonly ContextRow[]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  counter: LcmTokenCounter
  minFanout: number
  targetTokens: number
}) {
  const sourceItems: LcmCondenseSummarySourceItem[] = []
  const selectedRows: ContextRow[] = []
  let tokenTotal = 0
  for (const row of input.rows) {
    const summary = input.metadata.get(row.summary_id!)
    if (!summary) return undefined
    const text = renderSummaryWrapper({
      summaryID: row.summary_id!,
      contentText: summary.text,
      parentSummaryIDs: summary.parentSummaryIDs,
      objectiveStatus: summary.objectiveStatus,
      fallbackMode: summary.fallbackMode,
      sourceTokenCount: summary.sourceTokenCount,
      summaryTokenCount: summary.summaryTokenCount,
    })
    const tokenCount = optionalNumber(row.token_count) ?? input.counter.countText({ text })
    if (tokenCount <= 0) continue
    selectedRows.push(row)
    sourceItems.push({
      summaryID: row.summary_id!,
      text,
      tokenCount,
      summaryLevel: summary.summaryLevel,
    })
    tokenTotal += tokenCount
    if (selectedRows.length >= input.minFanout && tokenTotal >= input.targetTokens) break
  }
  if (selectedRows.length < input.minFanout || tokenTotal <= 1) return undefined
  return { selectedRows, sourceItems }
}

function contiguousSummaryRuns(input: {
  rows: readonly ContextRow[]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  targetLane: "sprigs" | "bindles"
}) {
  const runs: ContextRow[][] = []
  let current: ContextRow[] = []
  for (const row of input.rows) {
    const lane = row.item_type === "summary" ? summaryLane(input.metadata.get(row.summary_id!)) : undefined
    const canJoin =
      lane === input.targetLane && (current.length === 0 || sameOrderRows(current[current.length - 1]!, row))
    if (canJoin) {
      current.push(row)
      continue
    }
    if (current.length > 0) runs.push(current)
    current = lane === input.targetLane ? [row] : []
  }
  if (current.length > 0) runs.push(current)
  return runs
}

function selectFromRuns(input: {
  runs: readonly ContextRow[][]
  metadata: ReadonlyMap<SummaryID, SummaryMetadata>
  counter: LcmTokenCounter
  minFanout: number
  targetTokens: number
}) {
  for (const run of input.runs) {
    let start = 0
    while (start < run.length) {
      const startLevel = input.metadata.get(run[start]!.summary_id!)?.summaryLevel
      let end = start + 1
      while (end < run.length && input.metadata.get(run[end]!.summary_id!)?.summaryLevel === startLevel) end++
      const sameLevel = run.slice(start, end)
      const selected = candidateSourceItems({
        rows: sameLevel,
        metadata: input.metadata,
        counter: input.counter,
        minFanout: input.minFanout,
        targetTokens: input.targetTokens,
      })
      if (selected) return selected
      start = end
    }
  }
  for (const run of input.runs) {
    const selected = candidateSourceItems({
      rows: run,
      metadata: input.metadata,
      counter: input.counter,
      minFanout: input.minFanout,
      targetTokens: input.targetTokens,
    })
    if (selected) return selected
  }
  return undefined
}

export async function selectSummaryCondenseSource(input: {
  db: Queryable
  conversationID: ConversationID
  targetLane: "sprigs" | "bindles"
  hardPressure: boolean
  counter: LcmTokenCounter
  artifactRoot?: string
}): Promise<SummaryCondenseSelection | undefined> {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_summary_condense_conversation_not_found")
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_summary_condense_boundary_invalid", input.conversationID)
  }

  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(
      `lcm_summary_condense_context_invalid_${validation.reason ?? "unknown"}`,
      input.conversationID,
    )

  const strategy = conversation.strategy ?? "upward"
  const metadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const minFanout = condenseMinFanout({ strategy, targetLane: input.targetLane, hardPressure: input.hardPressure })
  const targetTokens = condenseTargetTokens({ strategy, targetLane: input.targetLane })
  const selected = selectFromRuns({
    runs: contiguousSummaryRuns({ rows, metadata, targetLane: input.targetLane }),
    metadata,
    counter: input.counter,
    minFanout,
    targetTokens,
  })
  if (!selected) return undefined
  return {
    conversation,
    rows,
    selectedRows: selected.selectedRows,
    sourceItems: selected.sourceItems,
    strategy,
    targetLane: input.targetLane,
  }
}

export function usagePurposeForSummary(promptVersion: SummaryCondensePromptVersion) {
  return promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION ? "hard_limit_maintenance" : "condensation"
}

export async function insertSummaryMaintenanceUsageRecord(input: {
  db: Queryable
  sessionID: SessionID
  conversationID: ConversationID
  operationID: OperationID
  mode: LcmUsageMode
  purpose: "condensation" | "hard_limit_maintenance"
  evidence: readonly LcmSummaryAttemptEvidence[]
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  return insertMaintenanceUsageEvidence({
    db: input.db,
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    operationID: input.operationID,
    mode: input.mode,
    purpose: input.purpose,
    evidence: input.evidence,
    providerID: input.providerID,
    modelID: input.modelID,
    nowMs: input.nowMs,
  })
}

// Parent edges are durable retrieval lineage even after their active rows are
// replaced; recovery code must distinguish lineage children from active roots.
export async function commitSummaryCondensation(input: {
  db: Transactional
  conversationID: ConversationID
  operationID: OperationID
  selection: SummaryCondenseSelection
  summary: Awaited<ReturnType<typeof runCondenseSummaryGeneration>>
  blocking: boolean
  promptVersion: SummaryCondensePromptVersion
  sessionID?: SessionID
  providerID?: string
  modelID?: string
  nowMs: number
}) {
  const selectedSummaryIDs = input.selection.sourceItems.map((item) => item.summaryID)
  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selectedRows = currentRows.filter(
      (row) => row.item_type === "summary" && selectedSummaryIDs.includes(row.summary_id!),
    )
    if (
      selectedRows.length !== selectedSummaryIDs.length ||
      !selectedRows.every((row, index) => row.summary_id === selectedSummaryIDs[index]) ||
      !selectedRows.every((row, index) => index === 0 || sameOrderRows(selectedRows[index - 1]!, row))
    ) {
      throw recoveryRequired("lcm_summary_condense_context_changed", input.conversationID)
    }

    const selectedContextIDs = new Set(selectedRows.map((row) => row.context_item_id))
    const summaryID = await allocateSummaryID(tx)
    const summaryContextID = await allocateContextItemID(tx)
    const summaryLevel = 1 + Math.max(...input.selection.sourceItems.map((item) => item.summaryLevel))
    const usageRecordID = input.sessionID
      ? await insertSummaryMaintenanceUsageRecord({
          db: tx,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          operationID: input.operationID,
          mode: input.blocking ? "blocking" : "background",
          purpose: usagePurposeForSummary(input.promptVersion),
          evidence: input.summary.usageEvidence,
          providerID: input.providerID,
          modelID: input.modelID,
          nowMs: input.nowMs,
        })
      : undefined

    await tx.query(
      `
        INSERT INTO lcm_summaries (
          summary_id,
          conversation_id,
          summary_type,
          content_text,
          source_token_count,
          summary_token_count,
          summary_level,
          prompt_version,
          strategy,
          provider_id,
          model_id,
          usage_record_id,
          objective_status,
          fallback_mode,
          created_at_ms
        )
        VALUES ($1, $2, 'bindle', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        summaryID,
        input.conversationID,
        input.summary.contentText,
        input.summary.sourceTokenCount,
        input.summary.summaryTokenCount,
        summaryLevel,
        input.promptVersion,
        input.selection.strategy,
        input.summary.usage?.providerID ?? input.providerID ?? null,
        input.summary.usage?.modelID ?? input.modelID ?? null,
        usageRecordID ?? null,
        input.summary.objectiveStatus,
        input.summary.fallbackMode,
        input.nowMs,
      ],
    )

    for (const [index, item] of input.selection.sourceItems.entries()) {
      await tx.query(
        `
          INSERT INTO lcm_summary_parents (summary_id, parent_summary_id, parent_order)
          VALUES ($1, $2, $3)
        `,
        [summaryID, item.summaryID, index + 1],
      )
    }

    const summaryRow: ContextRow = {
      context_item_id: summaryContextID,
      conversation_id: input.conversationID,
      item_order: 0,
      item_type: "summary",
      message_row_id: null,
      summary_id: summaryID,
      pointer_id: null,
      file_id: null,
      cue_payload_json: null,
      token_count: input.summary.summaryTokenCount,
      cache_key: null,
      cache_version: null,
      created_at_ms: input.nowMs,
      updated_at_ms: input.nowMs,
    }

    const nextRows: ContextRow[] = []
    let insertedSummary = false
    for (const row of currentRows) {
      if (selectedContextIDs.has(row.context_item_id)) {
        if (!insertedSummary) {
          nextRows.push(summaryRow)
          insertedSummary = true
        }
        continue
      }
      nextRows.push(row)
    }
    if (!insertedSummary) nextRows.push(summaryRow)

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === summaryContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await tx.query(
      `
        UPDATE lcm_conversations
        SET updated_at_ms = $2
        WHERE conversation_id = $1
      `,
      [input.conversationID, input.nowMs],
    )

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.selection.strategy,
      reason: input.promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION ? "hard_limit" : "condensation",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(
        `lcm_summary_condense_commit_invalid_${validation.reason ?? "unknown"}`,
        input.conversationID,
      )

    return {
      summaryID,
      contextItemsReplaced: selectedRows.length,
      afterContextItems: validation.items ?? [],
    }
  })
}

async function selectArchiveStubCandidate(input: {
  db: Queryable
  conversationID: ConversationID
  counter: LcmTokenCounter
  artifactRoot?: string
}) {
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_archive_stub_conversation_not_found")
  if ((conversation.strategy ?? "upward") !== "dolt") return undefined
  if (!validateBoundaryMetadataV1(jsonValue(conversation.boundary_metadata_json)).ok) {
    throw recoveryRequired("lcm_archive_stub_boundary_invalid", input.conversationID)
  }
  const rows = await loadContextRows(input.db, input.conversationID)
  const validation = await validateContextRows({
    db: input.db,
    conversationID: input.conversationID,
    rows,
    allowEmpty: false,
    artifactRoot: input.artifactRoot,
  })
  if (!validation.ok)
    throw recoveryRequired(`lcm_archive_stub_context_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

  const metadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const protectedStart = Math.max(0, rows.length - RUNTIME_DEFAULTS.performance.minProtectedTailLeaves)
  for (const [index, row] of rows.entries()) {
    if (index >= protectedStart) break
    if (row.item_type !== "summary" || !row.summary_id) continue
    const summary = metadata.get(row.summary_id)
    if (summary?.summaryType !== "bindle") continue
    const parentCount = await count(
      input.db,
      "SELECT count(*)::int AS count FROM lcm_summary_parents WHERE summary_id = $1",
      [row.summary_id],
    )
    if (parentCount <= 0) continue
    const existingStub = await count(
      input.db,
      `
        SELECT count(*)::int AS count
        FROM lcm_context_items
        WHERE conversation_id = $1 AND item_type = 'archive_stub' AND summary_id = $2
      `,
      [input.conversationID, row.summary_id],
    )
    if (existingStub > 0) continue
    const pointerID = await allocateSummaryLineagePointerID(input.db)
    const text = renderArchiveStubWrapper({ summaryID: row.summary_id, pointerID })
    const tokenCount = input.counter.countText({ text })
    return {
      conversation,
      rows,
      row,
      pointerID,
      tokenCount,
      rootSummaryID: row.summary_id,
      strategy: conversation.strategy ?? "dolt",
    }
  }
  return undefined
}

export async function createArchiveStub(input: {
  db: Transactional
  conversationID: ConversationID
  counter: LcmTokenCounter
  nowMs: number
  artifactRoot?: string
}) {
  const candidate = await selectArchiveStubCandidate({
    db: input.db,
    conversationID: input.conversationID,
    counter: input.counter,
    artifactRoot: input.artifactRoot,
  })
  if (!candidate) return undefined

  return input.db.transaction(async (tx) => {
    const currentRows = await loadContextRows(tx, input.conversationID)
    const selected = currentRows.find((row) => row.context_item_id === candidate.row.context_item_id)
    if (!selected || selected.item_type !== "summary" || selected.summary_id !== candidate.row.summary_id) {
      throw recoveryRequired("lcm_archive_stub_context_changed", input.conversationID)
    }
    const archiveContextID = await allocateContextItemID(tx)
    await tx.query(
      `
        INSERT INTO lcm_summary_lineage_pointers (
          pointer_id,
          conversation_id,
          summary_id,
          root_summary_id,
          pointer_kind,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, 'archive_stub', $5)
      `,
      [candidate.pointerID, input.conversationID, selected.summary_id, candidate.rootSummaryID, input.nowMs],
    )

    const nextRows = currentRows.map((row): ContextRow => {
      if (row.context_item_id !== selected.context_item_id) return row
      return {
        context_item_id: archiveContextID,
        conversation_id: input.conversationID,
        item_order: row.item_order,
        item_type: "archive_stub",
        message_row_id: null,
        summary_id: selected.summary_id,
        pointer_id: candidate.pointerID,
        file_id: null,
        cue_payload_json: null,
        token_count: candidate.tokenCount,
        cache_key: null,
        cache_version: null,
        created_at_ms: input.nowMs,
        updated_at_ms: input.nowMs,
      }
    })

    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, row] of nextRows.entries()) {
      await insertContextRow(tx, {
        ...row,
        item_order: index + 1,
        updated_at_ms:
          row.context_item_id === archiveContextID || asNumber(row.item_order) !== index + 1
            ? input.nowMs
            : row.updated_at_ms,
      })
    }

    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: candidate.strategy,
      reason: "archive_stub",
      nowMs: input.nowMs,
    })

    const validation = await validateContextRows({
      db: tx,
      conversationID: input.conversationID,
      rows: await loadContextRows(tx, input.conversationID),
      allowEmpty: false,
    })
    if (!validation.ok)
      throw recoveryRequired(`lcm_archive_stub_commit_invalid_${validation.reason ?? "unknown"}`, input.conversationID)

    return {
      beforeTokens: optionalNumber(selected.token_count) ?? candidate.tokenCount,
      afterTokens: candidate.tokenCount,
      summariesCreated: 0,
      contextItemsReplaced: 1,
    }
  })
}

export async function markRecoveryFailed(db: Queryable, result: LcmRecoveryResult) {
  if (result.status !== "failed") return result
  await db.query(
    `
      UPDATE lcm_conversations
      SET lifecycle_state = 'recovery_failed',
          last_error_code = $2,
          last_safe_message = $3,
          updated_at_ms = $4
      WHERE conversation_id = $1
    `,
    [
      result.conversationID,
      result.safeError?.code ?? "recovery_failed",
      result.safeError?.safeMessage ?? null,
      Date.now(),
    ],
  )
  return result
}

export function artifactRootFromDataDir(dataDir: string | undefined) {
  if (!dataDir) return undefined
  return resolveLcmDbLayout(dataDir).artifactsDir
}
