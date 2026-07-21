// kilocode_change - new file; extracted from the LCM context service
import { Effect } from "effect"
import { namespacedHash, stableHash } from "./hash"
import { RUNTIME_DEFAULTS } from "./config"
import { MessageV2 } from "../message-v2"
import type { ModelID, ProviderID } from "./provider-ids"
import { attachLcmRenderOriginToMessage } from "./render-prep"
import { renderRetrievalCueModelText } from "./retrieval"
import { failIfOperationCanceled, throwIfOperationCanceled } from "./operation-control"
import { renderSummaryWrapper, renderArchiveStubWrapper } from "./summary"
import type {
  ContextItem,
  ContextItemID,
  ConversationID,
  LcmAssemblyInput,
  LcmPreparedProviderPayload,
  LcmRenderedSpan,
  LcmRenderedSpanProtectedReason,
  LcmRenderedSpanProviderFamily,
  LcmRenderInputManifestV1,
  LcmSummaryFallbackMode,
  LcmSummaryObjectiveStatus,
  LcmStrategy,
  MessageRowID,
  OperationID,
  SummaryID,
} from "./types"
import {
  asNumber,
  type ContextRow,
  invalidRequest,
  isObject,
  LCM_PROVIDER_VALIDATOR_PENDING_M39,
  type LcmAssemblyPlacementSlot,
  type LcmRawLeafRenderPreparationInput,
  type LcmRenderUnit,
  type LcmRenderUnitSource,
  lcmSyntheticMessageID,
  lcmSyntheticPartID,
  type LcmVisibilityProvenance,
  loadLargeFileMarkerTextByIDs,
  missingSource,
  optionalNumber,
  protocolSpanID,
  type Queryable,
  type RawLeafMessageEntry,
  renderedSpanHash,
  renderUnitID,
  renderUnitSourceHandle,
  sourcePartProvenance,
  type SummaryMetadata,
  type ThresholdContextItemCount,
} from "./context-core"

// Maintainer boundary: This module turns active context into provider-safe render units. Ordering, visibility provenance, protected spans, and manifest hashes are one invariant and must change together.
export async function loadSummaryMetadata(db: Queryable, conversationID: ConversationID, rows: readonly ContextRow[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.summary_id ? [row.summary_id] : [])))]
  const metadata = new Map<SummaryID, SummaryMetadata>()
  if (ids.length === 0) return metadata
  const summaries = (
    await db.query<{
      summary_id: SummaryID
      summary_type: "sprig" | "bindle" | "archive_stub"
      summary_level: number | string | bigint
      content_text: string
      prompt_version: string
      objective_status: LcmSummaryObjectiveStatus
      fallback_mode: LcmSummaryFallbackMode
      source_token_count: number | string | bigint
      summary_token_count: number | string | bigint
    }>(
      `
        SELECT summary_id, summary_type, summary_level, content_text, prompt_version,
               objective_status, fallback_mode, source_token_count, summary_token_count
        FROM lcm_summaries
        WHERE conversation_id = $1 AND summary_id = ANY($2::text[])
      `,
      [conversationID, ids],
    )
  ).rows
  const parentRows = (
    await db.query<{
      summary_id: SummaryID
      parent_summary_id: SummaryID
      parent_order: number | string | bigint
    }>(
      `
        SELECT summary_id, parent_summary_id, parent_order
        FROM lcm_summary_parents
        WHERE summary_id = ANY($1::text[])
        ORDER BY summary_id, parent_order, parent_summary_id
      `,
      [ids],
    )
  ).rows
  const coverageRows = (
    await db.query<{
      summary_id: SummaryID
      message_row_id: MessageRowID
      message_order: number | string | bigint
    }>(
      `
        WITH RECURSIVE summary_lineage(root_summary_id, summary_id) AS (
          SELECT summary.summary_id, summary.summary_id
          FROM lcm_summaries summary
          WHERE summary.conversation_id = $2
            AND summary.summary_id = ANY($1::text[])
          UNION
          SELECT current.root_summary_id, edge.parent_summary_id
          FROM summary_lineage current
          JOIN lcm_summary_parents edge ON edge.summary_id = current.summary_id
          JOIN lcm_summaries parent
            ON parent.summary_id = edge.parent_summary_id
           AND parent.conversation_id = $2
        )
        SELECT lineage.root_summary_id AS summary_id, source.message_row_id, message.message_order
        FROM summary_lineage lineage
        JOIN lcm_summary_messages source ON source.summary_id = lineage.summary_id
        JOIN lcm_messages message ON message.message_row_id = source.message_row_id
        WHERE message.conversation_id = $2
        ORDER BY lineage.root_summary_id, message.message_order, source.message_row_id
      `,
      [ids, conversationID],
    )
  ).rows
  const parentIDsBySummary = new Map<SummaryID, SummaryID[]>()
  for (const parent of parentRows) {
    const existing = parentIDsBySummary.get(parent.summary_id) ?? []
    existing.push(parent.parent_summary_id)
    parentIDsBySummary.set(parent.summary_id, existing)
  }
  const coveredIDsBySummary = new Map<SummaryID, Set<MessageRowID>>()
  const coveredChronologyBySummary = new Map<SummaryID, number>()
  for (const coverage of coverageRows) {
    const covered = coveredIDsBySummary.get(coverage.summary_id) ?? new Set<MessageRowID>()
    covered.add(coverage.message_row_id)
    coveredIDsBySummary.set(coverage.summary_id, covered)
    coveredChronologyBySummary.set(
      coverage.summary_id,
      Math.max(coveredChronologyBySummary.get(coverage.summary_id) ?? 0, asNumber(coverage.message_order)),
    )
  }
  for (const summary of summaries) {
    metadata.set(summary.summary_id, {
      summaryType: summary.summary_type,
      summaryLevel: asNumber(summary.summary_level),
      text: summary.content_text,
      promptVersion: summary.prompt_version,
      objectiveStatus: summary.objective_status,
      fallbackMode: summary.fallback_mode,
      sourceTokenCount: asNumber(summary.source_token_count),
      summaryTokenCount: asNumber(summary.summary_token_count),
      parentSummaryIDs: parentIDsBySummary.get(summary.summary_id) ?? [],
      coveredMessageRowIDs: coveredIDsBySummary.get(summary.summary_id) ?? new Set<MessageRowID>(),
      coveredSourceChronology: coveredChronologyBySummary.get(summary.summary_id) ?? 0,
    })
  }
  return metadata
}

function contextOrder(row: ContextRow) {
  return asNumber(row.item_order)
}

function newestActiveSprigBoundary(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
}) {
  let selected:
    | {
        row: ContextRow
        order: number
        coveredSourceChronology: number
        stableID: string
      }
    | undefined
  for (const row of input.rows) {
    if (row.item_type !== "summary" || !row.summary_id) continue
    const summary = input.summaryMetadata.get(row.summary_id)
    if (summary?.summaryType !== "sprig") continue
    const candidate = {
      row,
      order: contextOrder(row),
      coveredSourceChronology: summary.coveredSourceChronology,
      stableID: `${row.summary_id}:${row.context_item_id}`,
    }
    if (
      !selected ||
      candidate.order > selected.order ||
      (candidate.order === selected.order &&
        (candidate.coveredSourceChronology > selected.coveredSourceChronology ||
          (candidate.coveredSourceChronology === selected.coveredSourceChronology &&
            candidate.stableID > selected.stableID)))
    ) {
      selected = candidate
    }
  }
  return selected
}

function activeSummaryCoveredMessages(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
}) {
  const covered = new Set<MessageRowID>()
  for (const row of input.rows) {
    if ((row.item_type !== "summary" && row.item_type !== "archive_stub") || !row.summary_id) continue
    const summary = input.summaryMetadata.get(row.summary_id)
    if (!summary) continue
    for (const messageRowID of summary.coveredMessageRowIDs) covered.add(messageRowID)
  }
  return covered
}

function selectSoftRawLaneRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
  tokenCountForRow?: (row: ContextRow) => number
}) {
  const rows = [...input.rows].sort((left, right) => contextOrder(left) - contextOrder(right))
  const boundary = newestActiveSprigBoundary({ rows, summaryMetadata: input.summaryMetadata })
  const boundaryOrder = boundary?.order ?? 0
  const coveredMessages = activeSummaryCoveredMessages({ rows, summaryMetadata: input.summaryMetadata })
  const rawRows = rows.filter(
    (row) =>
      row.item_type === "raw_message" &&
      row.message_row_id &&
      contextOrder(row) > boundaryOrder &&
      !coveredMessages.has(row.message_row_id),
  )
  const targetRow =
    input.targetMessageRowID === undefined
      ? undefined
      : rawRows.find((row) => row.message_row_id === input.targetMessageRowID)
  const targetOrder = targetRow ? contextOrder(targetRow) : Number.POSITIVE_INFINITY
  const tokenCountForRow = input.tokenCountForRow ?? ((row: ContextRow) => optionalNumber(row.token_count) ?? 0)
  const consumedMessageRowIDs = input.consumedMessageRowIDs ?? new Set<MessageRowID>()
  const mandatoryIDs = new Set<ContextItemID>()
  const unconsumedIDs = new Set<ContextItemID>()
  if (targetRow) mandatoryIDs.add(targetRow.context_item_id)
  if (targetOrder !== Number.POSITIVE_INFINITY) {
    for (const row of rawRows) {
      if (contextOrder(row) <= targetOrder) continue
      if (row.message_row_id && consumedMessageRowIDs.has(row.message_row_id)) continue
      mandatoryIDs.add(row.context_item_id)
      unconsumedIDs.add(row.context_item_id)
    }
  }
  const candidateRows = rawRows.filter((row) => !mandatoryIDs.has(row.context_item_id))
  const freshTailTokenBudget = Math.max(
    1,
    Math.floor(input.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens),
  )
  const freshTailIDs = new Set<ContextItemID>()
  let freshTailTokens = 0
  let freshTailCount = 0
  for (let index = candidateRows.length - 1; index >= 0; index--) {
    const row = candidateRows[index]!
    const tokenCount = Math.max(0, tokenCountForRow(row))
    if (freshTailCount > 0 && freshTailTokens + tokenCount > freshTailTokenBudget) break
    freshTailIDs.add(row.context_item_id)
    freshTailTokens += tokenCount
    freshTailCount++
  }
  const eligibleRows = candidateRows.filter((row) => !freshTailIDs.has(row.context_item_id))
  const freshTailRows = candidateRows.filter((row) => freshTailIDs.has(row.context_item_id))
  const unconsumedRows = rawRows.filter((row) => unconsumedIDs.has(row.context_item_id))
  const protectedRows = rawRows.filter(
    (row) => mandatoryIDs.has(row.context_item_id) || freshTailIDs.has(row.context_item_id),
  )
  return { eligibleRows, protectedRows, freshTailRows, unconsumedRows }
}

export function selectSoftBacklogRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
  tokenCountForRow?: (row: ContextRow) => number
}) {
  return selectSoftRawLaneRows(input).eligibleRows
}

export function computeSoftBacklogFromCounted(input: {
  counted: readonly ThresholdContextItemCount[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
}) {
  const tokenByContextID = new Map(input.counted.map((item) => [item.row.context_item_id, item.tokenCount] as const))
  const selected = selectSoftRawLaneRows({
    rows: input.counted.map((item) => item.row),
    summaryMetadata: input.summaryMetadata,
    strategy: input.strategy,
    targetMessageRowID: input.targetMessageRowID,
    freshTailTokens: input.freshTailTokens,
    consumedMessageRowIDs: input.consumedMessageRowIDs,
    tokenCountForRow: (row) => tokenByContextID.get(row.context_item_id) ?? 0,
  })
  const rows = selected.eligibleRows
  const rowTokenCount = (row: ContextRow) => tokenByContextID.get(row.context_item_id) ?? 0
  return {
    rows,
    tokens: rows.reduce((total, row) => total + rowTokenCount(row), 0),
    itemCount: rows.length,
    largestSourceTokens: rows.reduce((largest, row) => Math.max(largest, rowTokenCount(row)), 0),
    freshTailTokens: selected.freshTailRows.reduce((total, row) => total + rowTokenCount(row), 0),
    freshTailItemCount: selected.freshTailRows.length,
    unconsumedTokens: selected.unconsumedRows.reduce((total, row) => total + rowTokenCount(row), 0),
    unconsumedItemCount: selected.unconsumedRows.length,
    protectedTailTokens: selected.protectedRows.reduce(
      (total, row) => total + (tokenByContextID.get(row.context_item_id) ?? 0),
      0,
    ),
    protectedTailItemCount: selected.protectedRows.length,
  }
}

export function computeSoftBacklogFromRows(input: {
  rows: readonly ContextRow[]
  summaryMetadata: ReadonlyMap<SummaryID, SummaryMetadata>
  strategy: LcmStrategy
  targetMessageRowID?: MessageRowID
  freshTailTokens?: number
  consumedMessageRowIDs?: ReadonlySet<MessageRowID>
}) {
  const selected = selectSoftRawLaneRows(input)
  const rows = selected.eligibleRows
  const rowTokenCount = (row: ContextRow) => optionalNumber(row.token_count) ?? 0
  return {
    rows,
    tokens: rows.reduce((total, row) => total + rowTokenCount(row), 0),
    itemCount: rows.length,
    largestSourceTokens: rows.reduce((largest, row) => Math.max(largest, rowTokenCount(row)), 0),
    freshTailTokens: selected.freshTailRows.reduce((total, row) => total + rowTokenCount(row), 0),
    freshTailItemCount: selected.freshTailRows.length,
    unconsumedTokens: selected.unconsumedRows.reduce((total, row) => total + rowTokenCount(row), 0),
    unconsumedItemCount: selected.unconsumedRows.length,
    protectedTailTokens: selected.protectedRows.reduce(
      (total, row) => total + (optionalNumber(row.token_count) ?? 0),
      0,
    ),
    protectedTailItemCount: selected.protectedRows.length,
  }
}

export async function loadRawFallbackText(db: Queryable, conversationID: ConversationID, rows: readonly ContextRow[]) {
  const ids = rows.filter((row) => row.item_type === "raw_message").map((row) => row.message_row_id!)
  const text = new Map<MessageRowID, string>()
  if (ids.length === 0) return text
  const parts = (
    await db.query<{
      message_row_id: MessageRowID
      role: string
      part_order: number | string | bigint
      part_kind: string
      search_text: string
    }>(
      `
        SELECT p.message_row_id, m.role, p.part_order, p.part_kind, p.search_text
        FROM lcm_message_parts p
        JOIN lcm_messages m ON m.message_row_id = p.message_row_id
        WHERE p.conversation_id = $1 AND p.message_row_id = ANY($2::text[])
        ORDER BY m.message_order, p.part_order, p.part_row_id
      `,
      [conversationID, ids],
    )
  ).rows
  for (const part of parts) {
    const existing = text.get(part.message_row_id) ?? `${part.role}\n`
    text.set(part.message_row_id, `${existing}${part.part_kind}\n${part.search_text}\n`)
  }
  return text
}

export async function loadSummaryWrapperMessages(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
}) {
  const summaryItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "summary" | "archive_stub" }> =>
      item.itemType === "summary" || item.itemType === "archive_stub",
  )
  const messages = new Map<ContextItemID, unknown>()
  if (summaryItems.length === 0) return messages

  const ids = [...new Set(summaryItems.map((item) => item.summaryID))]
  const summaries = (
    await input.db.query<{
      summary_id: SummaryID
      content_text: string
      objective_status: LcmSummaryObjectiveStatus
      fallback_mode: LcmSummaryFallbackMode
      source_token_count: number | string | bigint
      summary_token_count: number | string | bigint
    }>(
      `
        SELECT summary_id, content_text, objective_status, fallback_mode, source_token_count, summary_token_count
        FROM lcm_summaries
        WHERE conversation_id = $1 AND summary_id = ANY($2::text[])
      `,
      [input.conversationID, ids],
    )
  ).rows
  const summaryByID = new Map(summaries.map((summary) => [summary.summary_id, summary] as const))
  const parentRows = (
    await input.db.query<{
      summary_id: SummaryID
      parent_summary_id: SummaryID
    }>(
      `
        SELECT summary_id, parent_summary_id
        FROM lcm_summary_parents
        WHERE summary_id = ANY($1::text[])
        ORDER BY summary_id, parent_order, parent_summary_id
      `,
      [ids],
    )
  ).rows
  const parentIDsBySummary = new Map<SummaryID, SummaryID[]>()
  for (const parent of parentRows) {
    const existing = parentIDsBySummary.get(parent.summary_id) ?? []
    existing.push(parent.parent_summary_id)
    parentIDsBySummary.set(parent.summary_id, existing)
  }

  for (const item of summaryItems) {
    if (item.itemType === "archive_stub") {
      messages.set(item.contextItemID, {
        role: "user",
        content: renderArchiveStubWrapper({ summaryID: item.summaryID, pointerID: item.pointerID }),
      })
      continue
    }
    const summary = summaryByID.get(item.summaryID)
    if (!summary) throw missingSource("lcm_summary_wrapper_missing_summary", input.conversationID)
    messages.set(item.contextItemID, {
      role: "user",
      content: renderSummaryWrapper({
        summaryID: item.summaryID,
        contentText: summary.content_text,
        parentSummaryIDs: parentIDsBySummary.get(item.summaryID) ?? [],
        objectiveStatus: summary.objective_status,
        fallbackMode: summary.fallback_mode,
        sourceTokenCount: asNumber(summary.source_token_count),
        summaryTokenCount: asNumber(summary.summary_token_count),
      }),
    })
  }
  return messages
}

export async function loadLargeFileMarkerText(
  db: Queryable,
  conversationID: ConversationID,
  rows: readonly ContextRow[],
) {
  return loadLargeFileMarkerTextByIDs(
    db,
    conversationID,
    rows.filter((row) => row.item_type === "large_file_marker").map((row) => row.file_id!),
  )
}

export async function loadStandaloneLargeFileMarkerMessages(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
}) {
  const markerItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "large_file_marker" }> => item.itemType === "large_file_marker",
  )
  const messages = new Map<ContextItemID, unknown>()
  if (markerItems.length === 0) return messages
  const markerText = await loadLargeFileMarkerTextByIDs(
    input.db,
    input.conversationID,
    markerItems.map((item) => item.fileID),
  )
  for (const item of markerItems) {
    const content = markerText.get(item.fileID)
    if (!content) throw missingSource("lcm_large_file_marker_missing_file", input.conversationID)
    messages.set(item.contextItemID, {
      role: "user",
      content,
    })
  }
  return messages
}

export async function loadVisibilityProvenance(input: {
  db: Queryable
  conversationID: ConversationID
  contextItems: readonly ContextItem[]
  hiddenSourceMessageIDs: readonly string[]
}): Promise<LcmVisibilityProvenance> {
  const hiddenSourceIDs = new Set(input.hiddenSourceMessageIDs)
  const hiddenContextItemIDs = new Set<ContextItemID>()
  const missingContextItemIDs = new Set<ContextItemID>()
  if (hiddenSourceIDs.size === 0) {
    return { hiddenContextItemIDs, missingContextItemIDs }
  }

  const summaryItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "summary" | "archive_stub" }> =>
      item.itemType === "summary" || item.itemType === "archive_stub",
  )
  if (summaryItems.length > 0) {
    const summaryIDs = [...new Set(summaryItems.map((item) => item.summaryID))]
    const sourceRows = (
      await input.db.query<{
        summary_id: SummaryID
        source_message_id: string
      }>(
        `
          WITH RECURSIVE summary_lineage(root_summary_id, summary_id) AS (
            SELECT summary.summary_id, summary.summary_id
            FROM lcm_summaries summary
            WHERE summary.conversation_id = $1
              AND summary.summary_id = ANY($2::text[])
            UNION
            SELECT current.root_summary_id, edge.parent_summary_id
            FROM summary_lineage current
            JOIN lcm_summary_parents edge ON edge.summary_id = current.summary_id
            JOIN lcm_summaries parent
              ON parent.summary_id = edge.parent_summary_id
             AND parent.conversation_id = $1
          )
          SELECT lineage.root_summary_id AS summary_id, message.source_message_id
          FROM summary_lineage lineage
          JOIN lcm_summary_messages source ON source.summary_id = lineage.summary_id
          JOIN lcm_messages message ON message.message_row_id = source.message_row_id
          WHERE message.conversation_id = $1
        `,
        [input.conversationID, summaryIDs],
      )
    ).rows
    const sourceIDsBySummary = new Map<SummaryID, Set<string>>()
    for (const row of sourceRows) {
      const existing = sourceIDsBySummary.get(row.summary_id) ?? new Set<string>()
      existing.add(row.source_message_id)
      sourceIDsBySummary.set(row.summary_id, existing)
    }
    for (const item of summaryItems) {
      const sourceIDs = sourceIDsBySummary.get(item.summaryID)
      if (!sourceIDs || sourceIDs.size === 0) {
        missingContextItemIDs.add(item.contextItemID)
        continue
      }
      if ([...sourceIDs].some((id) => hiddenSourceIDs.has(id))) hiddenContextItemIDs.add(item.contextItemID)
    }
  }

  const cueItems = input.contextItems.filter(
    (item): item is Extract<ContextItem, { itemType: "retrieval_cue" }> => item.itemType === "retrieval_cue",
  )
  for (const item of cueItems) {
    const messageRowIDs = [...item.cuePayload.messageRowIDs]
    const partRowIDs = [...item.cuePayload.partRowIDs]
    const sourceIDs = new Set<string>()
    if (messageRowIDs.length > 0) {
      const rows = (
        await input.db.query<{ source_message_id: string }>(
          `
            SELECT source_message_id
            FROM lcm_messages
            WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
          `,
          [input.conversationID, messageRowIDs],
        )
      ).rows
      for (const row of rows) sourceIDs.add(row.source_message_id)
      if (rows.length !== messageRowIDs.length) missingContextItemIDs.add(item.contextItemID)
    }
    if (partRowIDs.length > 0) {
      const rows = (
        await input.db.query<{ source_message_id: string }>(
          `
            SELECT m.source_message_id
            FROM lcm_message_parts p
            JOIN lcm_messages m ON m.message_row_id = p.message_row_id
            WHERE p.conversation_id = $1 AND p.part_row_id = ANY($2::text[])
          `,
          [input.conversationID, partRowIDs],
        )
      ).rows
      for (const row of rows) sourceIDs.add(row.source_message_id)
      if (rows.length !== partRowIDs.length) missingContextItemIDs.add(item.contextItemID)
    }
    if ([...sourceIDs].some((id) => hiddenSourceIDs.has(id))) hiddenContextItemIDs.add(item.contextItemID)
  }

  return { hiddenContextItemIDs, missingContextItemIDs }
}

function syntheticTextFromMessageMap(value: unknown, diagnosticCode: string) {
  if (!isObject(value) || value.role !== "user" || typeof value.content !== "string")
    throw invalidRequest(diagnosticCode)
  return value.content
}

function syntheticTextMessage(input: {
  readonly seed: string
  readonly sessionID: MessageV2.User["sessionID"]
  readonly agentName: string
  readonly providerID: ProviderID
  readonly modelID: ModelID
  readonly createdAtMs: number
  readonly text: string
}): MessageV2.WithParts {
  const messageID = lcmSyntheticMessageID(`${input.seed}:message`)
  const info: MessageV2.User & { readonly synthetic: true } = {
    id: messageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.createdAtMs },
    agent: input.agentName,
    model: {
      providerID: input.providerID,
      modelID: input.modelID,
    },
    synthetic: true,
  }
  const part: MessageV2.TextPart = {
    id: lcmSyntheticPartID(`${input.seed}:part`),
    sessionID: input.sessionID,
    messageID,
    type: "text",
    text: input.text,
    synthetic: true,
  }
  return {
    info,
    parts: [part],
  }
}

function isTargetRawEntry(input: { entry: RawLeafMessageEntry; target: LcmAssemblyInput["targetCurrentUser"] }) {
  if (input.target.messageRowID && input.entry.item.messageRowID === input.target.messageRowID) return true
  return (
    input.entry.sourceRow.source_session_id === input.target.sourceSessionID &&
    input.entry.sourceRow.source_message_id === input.target.sourceMessageID
  )
}

function rawEntryProvenance(entry: RawLeafMessageEntry) {
  return [
    `message:${entry.sourceRow.message_row_id}:version:${asNumber(entry.sourceRow.source_version)}`,
    `source:${entry.sourceRow.source_session_id}:${entry.sourceRow.source_message_id}`,
    ...entry.partRows.map((row) => `part:${stableHash(sourcePartProvenance(row))}`),
  ]
}

function rawRenderUnit(input: {
  readonly conversationID: ConversationID
  readonly entry: RawLeafMessageEntry
  readonly target?: LcmAssemblyInput["targetCurrentUser"]
  readonly placementSlot?: LcmAssemblyPlacementSlot
  readonly visibilityHash?: string
}): LcmRenderUnit {
  const sourceChronologicalOrder = asNumber(input.entry.sourceRow.message_order)
  const source: LcmRenderUnitSource = input.target
    ? {
        kind: "target_current_user",
        sourceSessionID: input.target.sourceSessionID,
        sourceMessageID: input.target.sourceMessageID,
        messageRowID: input.entry.item.messageRowID,
        promptOperationID: input.target.promptOperationID,
        visibilityBaseMessageID: input.target.visibilityBaseMessageID,
        sourceChronologicalOrder,
      }
    : {
        kind: "raw_message",
        contextItemID: input.entry.item.contextItemID,
        messageRowID: input.entry.item.messageRowID,
        sourceVersion: asNumber(input.entry.sourceRow.source_version),
      }
  const provenanceHandles = rawEntryProvenance(input.entry)
  const sourceHandle = renderUnitSourceHandle(source)
  return {
    renderUnitID: renderUnitID({
      conversationID: input.conversationID,
      source,
      sourceHandle,
      provenanceHandles,
    }),
    conversationID: input.conversationID,
    source,
    sourceKind: input.target ? "target_current_user" : "raw_message",
    sourceHandle,
    provenanceHandles,
    canonicalOrder: input.entry.item.itemOrder,
    effectiveOrder: 0,
    placementSlot: input.placementSlot ?? (input.target ? "current_user" : "history"),
    requiredVisibilityHash: input.visibilityHash,
    requiredForContinuation: input.target !== undefined,
    message: input.entry.message,
  }
}

function derivedRenderUnit(input: {
  readonly conversationID: ConversationID
  readonly item: Exclude<ContextItem, Extract<ContextItem, { itemType: "raw_message" }>>
  readonly text: string
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly targetCurrentUser: LcmAssemblyInput["targetCurrentUser"]
}): LcmRenderUnit {
  const source: LcmRenderUnitSource =
    input.item.itemType === "summary"
      ? { kind: "summary", contextItemID: input.item.contextItemID, summaryID: input.item.summaryID }
      : input.item.itemType === "archive_stub"
        ? {
            kind: "archive_stub",
            contextItemID: input.item.contextItemID,
            summaryID: input.item.summaryID,
            pointerID: input.item.pointerID,
          }
        : input.item.itemType === "large_file_marker"
          ? { kind: "large_file_marker", contextItemID: input.item.contextItemID, fileID: input.item.fileID }
          : {
              kind: "retrieval_cue",
              contextItemID: input.item.contextItemID,
              cueID: input.item.cueID,
              cueLifecycleState: input.item.cueLifecycleState,
              cueTargetSourceMessageID: input.item.cueTargetSourceMessageID,
              cueGenerationID: input.item.cueGenerationID,
              placementSlot: "before_current_user",
            }
  const sourceHandle = renderUnitSourceHandle(source)
  const provenanceHandles = [`${source.kind}:${sourceHandle}`]
  return {
    renderUnitID: renderUnitID({
      conversationID: input.conversationID,
      source,
      sourceHandle,
      provenanceHandles,
    }),
    conversationID: input.conversationID,
    source,
    sourceKind: input.item.itemType,
    sourceHandle,
    provenanceHandles,
    canonicalOrder: input.item.itemOrder,
    effectiveOrder: 0,
    placementSlot: input.item.itemType === "retrieval_cue" ? "before_current_user" : "history",
    requiredVisibilityHash: input.renderPreparation.messageVisibility?.hash,
    requiredForContinuation: false,
    message: syntheticTextMessage({
      seed: `${input.conversationID}:${input.item.contextItemID}:${input.item.itemType}`,
      sessionID: input.renderPreparation.sessionID,
      agentName: input.renderPreparation.agent.name,
      providerID: input.renderPreparation.model.providerID,
      modelID: input.renderPreparation.model.id,
      createdAtMs: Date.parse(input.item.createdAt) || 0,
      text: input.text,
    }),
  }
}

function renderUnitPlacementRank(slot: LcmAssemblyPlacementSlot) {
  if (slot === "history") return 0
  if (slot === "before_current_user") return 1
  if (slot === "current_user") return 2
  if (slot === "after_current_user") return 3
  return 4
}

function orderRenderUnits(units: readonly LcmRenderUnit[]) {
  return [...units]
    .sort((left, right) => {
      const slot = renderUnitPlacementRank(left.placementSlot) - renderUnitPlacementRank(right.placementSlot)
      if (slot !== 0) return slot
      if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
      const leftSourceOrder = left.source.kind === "target_current_user" ? left.source.sourceChronologicalOrder : 0
      const rightSourceOrder = right.source.kind === "target_current_user" ? right.source.sourceChronologicalOrder : 0
      if (leftSourceOrder !== rightSourceOrder) return leftSourceOrder - rightSourceOrder
      return left.renderUnitID.localeCompare(right.renderUnitID)
    })
    .map((unit, index) => ({ ...unit, effectiveOrder: index + 1 }))
}

export function withRenderUnitOrigins(units: readonly LcmRenderUnit[]) {
  return units.map((unit) => ({
    ...unit,
    message: attachLcmRenderOriginToMessage(structuredClone(unit.message), {
      renderUnitID: unit.renderUnitID,
      sourceKind: unit.sourceKind,
      sourceHandle: unit.sourceHandle,
    }),
  }))
}

// This is the canonical placement boundary: exactly one proven current user
// must survive visibility filtering, and every derived unit needs provenance.
export function buildRenderUnits(input: {
  readonly conversationID: ConversationID
  readonly contextItems: readonly ContextItem[]
  readonly rawEntries: readonly RawLeafMessageEntry[]
  readonly summaryModelMessages: ReadonlyMap<ContextItemID, unknown>
  readonly markerModelMessages: ReadonlyMap<ContextItemID, unknown>
  readonly visibilityProvenance: LcmVisibilityProvenance
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly targetCurrentUser: LcmAssemblyInput["targetCurrentUser"]
  readonly abortSignal?: AbortSignal
}) {
  throwIfOperationCanceled({
    abortSignal: input.abortSignal,
    operationID: input.targetCurrentUser.promptOperationID,
    diagnosticCode: "lcm_provider_assembly_canceled_before_render_units",
  })
  const rawByContextItemID = new Map(input.rawEntries.map((entry) => [entry.item.contextItemID, entry] as const))
  const hiddenSourceMessageIDs = new Set(input.renderPreparation.messageVisibility?.hiddenMessageIDs ?? [])
  let targetCurrentUser = input.targetCurrentUser
  let matchingTargets = input.rawEntries.filter((entry) => isTargetRawEntry({ entry, target: targetCurrentUser }))
  if (matchingTargets.length === 0 && input.renderPreparation.lastUser) {
    const lastUser = input.renderPreparation.lastUser
    matchingTargets = input.rawEntries.filter(
      (entry) =>
        entry.sourceRow.source_session_id === lastUser.sessionID && entry.sourceRow.source_message_id === lastUser.id,
    )
    if (matchingTargets.length === 1) {
      targetCurrentUser = {
        ...input.targetCurrentUser,
        sourceSessionID: lastUser.sessionID,
        sourceMessageID: lastUser.id,
        messageRowID: matchingTargets[0]!.item.messageRowID,
        visibilityBaseMessageID: input.targetCurrentUser.visibilityBaseMessageID || lastUser.id,
      }
    }
  }
  if (matchingTargets.length !== 1) {
    throw missingSource("lcm_provider_assembly_target_current_user_unproven", input.conversationID)
  }
  const targetEntry = matchingTargets[0]!
  if (targetEntry.message.info.role !== "user") {
    throw invalidRequest("lcm_provider_assembly_target_current_user_not_user")
  }

  const units: LcmRenderUnit[] = []
  for (const item of input.contextItems) {
    throwIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: targetCurrentUser.promptOperationID,
      diagnosticCode: "lcm_provider_assembly_canceled_while_building_render_units",
    })
    if (
      item.itemType === "retrieval_cue" &&
      (item.cueLifecycleState !== "active" || item.cueTargetSourceMessageID !== targetCurrentUser.sourceMessageID)
    ) {
      continue
    }
    if (item.itemType === "raw_message") {
      const entry = rawByContextItemID.get(item.contextItemID)
      if (!entry) throw missingSource("lcm_provider_assembly_missing_raw_entry", input.conversationID)
      if (hiddenSourceMessageIDs.has(entry.sourceRow.source_message_id)) {
        if (entry === targetEntry)
          throw missingSource("lcm_provider_assembly_target_current_user_hidden", input.conversationID)
        continue
      }
      units.push(
        rawRenderUnit({
          conversationID: input.conversationID,
          entry,
          target: entry === targetEntry ? targetCurrentUser : undefined,
          placementSlot:
            entry !== targetEntry && entry.item.itemOrder > targetEntry.item.itemOrder ? "provider_tail" : undefined,
          visibilityHash: input.renderPreparation.messageVisibility?.hash,
        }),
      )
      continue
    }
    if (input.visibilityProvenance.missingContextItemIDs.has(item.contextItemID)) {
      throw missingSource("lcm_provider_assembly_derived_provenance_missing", input.conversationID)
    }
    if (input.visibilityProvenance.hiddenContextItemIDs.has(item.contextItemID)) {
      if (item.itemType === "retrieval_cue") {
        throw missingSource("lcm_provider_assembly_retrieval_cue_hidden_source", input.conversationID)
      }
      continue
    }

    const text =
      item.itemType === "summary" || item.itemType === "archive_stub"
        ? syntheticTextFromMessageMap(
            input.summaryModelMessages.get(item.contextItemID),
            "lcm_provider_assembly_missing_summary_text",
          )
        : item.itemType === "large_file_marker"
          ? syntheticTextFromMessageMap(
              input.markerModelMessages.get(item.contextItemID),
              "lcm_provider_assembly_missing_marker_text",
            )
          : renderRetrievalCueModelText(item.cuePayload, item.cueID)
    units.push(
      derivedRenderUnit({
        conversationID: input.conversationID,
        item,
        text,
        renderPreparation: input.renderPreparation,
        targetCurrentUser,
      }),
    )
  }

  const targetCount = units.filter((unit) => unit.source.kind === "target_current_user").length
  if (targetCount !== 1)
    throw missingSource("lcm_provider_assembly_target_current_user_not_rendered", input.conversationID)
  return orderRenderUnits(units)
}

function modelSupportsMediaInToolResults(model: LcmRawLeafRenderPreparationInput["model"]) {
  const npm = model.api.npm
  if (npm === "@ai-sdk/anthropic") return true
  if (npm === "@ai-sdk/openai") return true
  if (npm === "@ai-sdk/amazon-bedrock") return true
  if (npm === "@ai-sdk/google-vertex/anthropic") return true
  if (npm === "@ai-sdk/google") {
    const id = model.api.id.toLowerCase()
    return id.includes("gemini-3") && !id.includes("gemini-2")
  }
  return false
}

function unitProtectedReason(input: {
  readonly unit: LcmRenderUnit
  readonly messageCount: number
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}): LcmRenderedSpanProtectedReason | undefined {
  if (input.messageCount === 0) return undefined
  if (input.unit.message.info.role !== "assistant") return undefined
  const toolParts = input.unit.message.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool")
  if (toolParts.length === 0) return undefined
  const hasMediaAttachment = toolParts.some(
    (part) =>
      part.state.status === "completed" &&
      (part.state.attachments ?? []).some((attachment) => MessageV2.isMedia(attachment.mime)),
  )
  if (hasMediaAttachment && !modelSupportsMediaInToolResults(input.renderPreparation.model))
    return "synthetic_media_fallback"
  return "assistant_tool_results"
}

export function renderedSpanForUnit(input: {
  readonly unit: LcmRenderUnit
  readonly startIndex: number
  readonly messageCount: number
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly providerTransformHash: string
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
}): LcmRenderedSpan {
  const protectedReason = unitProtectedReason({
    unit: input.unit,
    messageCount: input.messageCount,
    renderPreparation: input.renderPreparation,
  })
  if (protectedReason) {
    const withoutHash = {
      renderUnitID: input.unit.renderUnitID,
      sourceKind: input.unit.sourceKind,
      sourceHandle: input.unit.sourceHandle,
      canonicalOrder: input.unit.canonicalOrder,
      effectiveOrder: input.unit.effectiveOrder,
      placementSlot: input.unit.placementSlot,
      startIndex: input.startIndex,
      messageCount: input.messageCount,
      providerFamily: input.providerFamily,
      transformStage: "rendered" as const,
      protected: true as const,
      protectedReason,
      protocolSpanID: protocolSpanID({
        providerFamily: input.providerFamily,
        protocolGroupKind: protectedReason,
        protocolGroupID: input.unit.protocolGroupID ?? input.unit.renderUnitID,
        contributingRenderUnitIDs: [input.unit.renderUnitID],
        startIndex: input.startIndex,
        messageCount: input.messageCount,
        transformStage: "rendered",
      }),
    }
    return {
      ...withoutHash,
      spanHash: renderedSpanHash(withoutHash, input.providerTransformHash),
    }
  }

  const withoutHash = {
    renderUnitID: input.unit.renderUnitID,
    sourceKind: input.unit.sourceKind,
    sourceHandle: input.unit.sourceHandle,
    canonicalOrder: input.unit.canonicalOrder,
    effectiveOrder: input.unit.effectiveOrder,
    placementSlot: input.unit.placementSlot,
    startIndex: input.startIndex,
    messageCount: input.messageCount,
    providerFamily: input.providerFamily,
    transformStage: "rendered" as const,
    protected: false as const,
  }
  return {
    ...withoutHash,
    spanHash: renderedSpanHash(withoutHash, input.providerTransformHash),
  }
}

function validateRenderedSpans(input: {
  readonly spans: readonly LcmRenderedSpan[]
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly modelMessageCount: number
  readonly providerTransformHash: string
}) {
  if (input.renderUnits.length !== input.spans.length) return "lcm_provider_assembly_span_count_mismatch"
  const unitIDs = new Set(input.renderUnits.map((unit) => unit.renderUnitID))
  const seen = new Set<string>()
  for (const span of input.spans) {
    if (!unitIDs.has(span.renderUnitID)) return "lcm_provider_assembly_span_unknown_unit"
    if (seen.has(span.renderUnitID)) return "lcm_provider_assembly_span_duplicate_unit"
    seen.add(span.renderUnitID)
    if (span.startIndex < 0 || span.messageCount < 0) return "lcm_provider_assembly_span_negative_range"
    if (span.startIndex + span.messageCount > input.modelMessageCount) return "lcm_provider_assembly_span_out_of_range"
    if (span.messageCount === 0 && span.protected) return "lcm_provider_assembly_zero_span_protected"
    if (span.protected) {
      if (!span.protectedReason || !span.protocolSpanID) return "lcm_provider_assembly_protected_metadata_missing"
    } else if ("protectedReason" in span || "protocolSpanID" in span) {
      return "lcm_provider_assembly_unprotected_metadata_present"
    }
    const { spanHash: _spanHash, ...withoutHash } = span
    if (span.spanHash !== renderedSpanHash(withoutHash, input.providerTransformHash)) {
      return "lcm_provider_assembly_span_hash_mismatch"
    }
  }

  const protocolGroups = new Map<string, LcmRenderedSpan[]>()
  for (const span of input.spans) {
    if (!span.protected) continue
    const group = protocolGroups.get(span.protocolSpanID) ?? []
    group.push(span)
    protocolGroups.set(span.protocolSpanID, group)
  }
  for (const group of protocolGroups.values()) {
    const sorted = [...group].sort((left, right) => left.startIndex - right.startIndex)
    let cursor = sorted[0]!.startIndex
    const end = Math.max(...sorted.map((span) => span.startIndex + span.messageCount))
    for (const span of sorted) {
      if (span.startIndex !== cursor) return "lcm_provider_assembly_protocol_span_gap"
      cursor = span.startIndex + span.messageCount
    }
    if (cursor !== end) return "lcm_provider_assembly_protocol_span_incomplete"
    for (const span of input.spans) {
      if (group.includes(span)) continue
      if (span.messageCount === 0) continue
      const spanEnd = span.startIndex + span.messageCount
      if (span.startIndex < end && spanEnd > sorted[0]!.startIndex) {
        return "lcm_provider_assembly_protocol_span_interleaved"
      }
    }
  }
  return undefined
}

export function validateAssemblyPayload(input: {
  readonly payload: LcmPreparedProviderPayload
  readonly modelMessageCount: number
  readonly renderUnits: readonly LcmRenderUnit[]
}) {
  if (!Array.isArray(input.payload.modelMessages)) return "lcm_provider_assembly_model_messages_unbranded"
  if (input.modelMessageCount > 0 && input.payload.renderedSpans.length === 0) {
    return "lcm_provider_assembly_empty_spans"
  }
  if (input.payload.assemblyValidatorHash !== input.payload.renderInputManifest.assemblyValidatorHash) {
    return "lcm_provider_assembly_validator_hash_mismatch"
  }
  return validateRenderedSpans({
    spans: input.payload.renderedSpans,
    renderUnits: input.renderUnits,
    modelMessageCount: input.modelMessageCount,
    providerTransformHash: input.payload.renderInputManifest.providerTransformHash,
  })
}

export function validateLcmPreparedProviderPayloadForAssembly(input: {
  readonly payload: LcmPreparedProviderPayload
  readonly renderedMessageCount?: number
  readonly expectedRenderUnitIDs?: readonly string[]
}) {
  const modelMessageCount = input.renderedMessageCount ?? input.payload.modelMessages.length
  if (modelMessageCount > 0 && input.payload.renderedSpans.length === 0) {
    return invalidRequest("lcm_provider_assembly_empty_spans")
  }
  if (input.payload.assemblyValidatorHash !== input.payload.renderInputManifest.assemblyValidatorHash) {
    return invalidRequest("lcm_provider_assembly_validator_hash_mismatch")
  }
  if (input.expectedRenderUnitIDs) {
    const expected = new Set(input.expectedRenderUnitIDs)
    for (const span of input.payload.renderedSpans) {
      if (!expected.has(span.renderUnitID)) return invalidRequest("lcm_provider_assembly_span_unknown_unit")
    }
  }
  return undefined
}

export function renderPrefixCounts(input: {
  readonly messages: readonly MessageV2.WithParts[]
  readonly renderPreparation: LcmRawLeafRenderPreparationInput
  readonly stripMedia: boolean
  readonly expectedModelMessageCount?: number
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  return Effect.gen(function* () {
    yield* failIfOperationCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_render_prefix_counts_canceled_before_fast_count",
    })
    const counts = [0]
    let total = 0
    for (const message of input.messages) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_render_prefix_counts_canceled_while_counting",
      })
      total += modelMessageCountForPreparedMessage({
        message,
        model: input.renderPreparation.model,
        stripMedia: input.stripMedia,
      })
      counts.push(total)
    }
    if (input.expectedModelMessageCount === undefined || total === input.expectedModelMessageCount) return counts

    const fallback = [0]
    for (let index = 1; index <= input.messages.length; index++) {
      yield* failIfOperationCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_render_prefix_counts_canceled_while_fallback_counting",
      })
      const rendered = yield* MessageV2.toModelMessagesEffect(
        input.messages.slice(0, index),
        input.renderPreparation.model,
        {
          stripMedia: input.stripMedia,
        },
      )
      fallback.push(rendered.length)
    }
    return fallback
  })
}

function modelMessageCountForPreparedMessage(input: {
  readonly message: MessageV2.WithParts
  readonly model: LcmRawLeafRenderPreparationInput["model"]
  readonly stripMedia: boolean
}) {
  if (input.message.parts.length === 0) return 0
  if (input.message.info.role === "user") {
    return input.message.parts.some((part) => {
      if (part.type === "text") return !part.ignored
      if (part.type === "file") return part.mime !== "text/plain" && part.mime !== "application/x-directory"
      return part.type === "compaction" || part.type === "subtask"
    })
      ? 1
      : 0
  }

  const info = input.message.info
  if (
    info.error &&
    !(
      MessageV2.AbortedError.isInstance(info.error) &&
      input.message.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
    )
  ) {
    return 0
  }

  let hasAssistantModelPart = false
  let needsMediaFallback = false
  const supportsMediaInToolResults = modelSupportsMediaInToolResults(input.model)
  for (const part of input.message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      hasAssistantModelPart = true
      continue
    }
    if (part.type !== "tool") continue
    hasAssistantModelPart = true
    if (part.state.status !== "completed" || supportsMediaInToolResults || input.stripMedia) continue
    needsMediaFallback ||= (part.state.attachments ?? []).some((attachment) => MessageV2.isMedia(attachment.mime))
  }
  return hasAssistantModelPart ? 1 + (needsMediaFallback ? 1 : 0) : 0
}

export function manifestWithAssemblyHashes(input: {
  readonly manifest: LcmRenderInputManifestV1
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly renderedSpans: readonly LcmRenderedSpan[]
  readonly providerTransformHash: string
}) {
  const renderUnitProjection = input.renderUnits.map((unit) => ({
    renderUnitID: unit.renderUnitID,
    sourceKind: unit.sourceKind,
    sourceHandle: unit.sourceHandle,
    canonicalOrder: unit.canonicalOrder,
    effectiveOrder: unit.effectiveOrder,
    placementSlot: unit.placementSlot,
    requiredVisibilityHash: unit.requiredVisibilityHash,
    requiredForContinuation: unit.requiredForContinuation,
    provenanceHash: stableHash(unit.provenanceHandles),
  }))
  const protectedSpans = input.renderedSpans
    .filter((span) => span.protected)
    .map((span) => ({
      renderUnitID: span.renderUnitID,
      protocolSpanID: span.protocolSpanID,
      protectedReason: span.protectedReason,
      startIndex: span.startIndex,
      messageCount: span.messageCount,
      spanHash: span.spanHash,
    }))
  const assemblyValidatorHash = namespacedHash("lcm-assembly-validator-v1", {
    rendererVersion: input.manifest.rendererVersion,
    renderPreparationVersion: input.manifest.renderPreparationVersion,
    ruleVersion: "m35-render-unit-assembly-core",
  })
  return {
    ...input.manifest,
    sourceSelectionHash: namespacedHash("lcm-source-selection-v1", {
      renderUnits: renderUnitProjection,
      targetCurrentUser: input.renderUnits.find((unit) => unit.source.kind === "target_current_user")?.renderUnitID,
      protectedSpans,
      providerTransformHash: input.providerTransformHash,
      providerValidatorHash: input.manifest.providerValidatorHash,
    }),
    renderUnitOrderHash: namespacedHash(
      "lcm-render-unit-order-v1",
      input.renderUnits.map((unit) => unit.renderUnitID),
    ),
    effectivePlacementHash: namespacedHash(
      "lcm-effective-placement-v1",
      input.renderUnits.map((unit) => ({
        renderUnitID: unit.renderUnitID,
        effectiveOrder: unit.effectiveOrder,
        placementSlot: unit.placementSlot,
      })),
    ),
    protectedSpanHash: namespacedHash("lcm-protected-span-v1", protectedSpans),
    providerTransformHash: input.providerTransformHash,
    providerValidatorHash: input.manifest.providerValidatorHash || LCM_PROVIDER_VALIDATOR_PENDING_M39,
    assemblyValidatorHash,
  } satisfies LcmRenderInputManifestV1
}
