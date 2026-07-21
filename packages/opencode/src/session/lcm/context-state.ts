// kilocode_change - new file; extracted from the LCM context service
import { readAndValidateLcmArtifact } from "./artifacts"
import { namespacedHash, stableHash } from "./hash"
import { createOperationID } from "./id"
import { RUNTIME_DEFAULTS } from "./config"
import { LCM_PROVIDER_VALIDATOR_NAMESPACE } from "./provider-protocol"
import { allocateContextItemID, allocateSnapshotID } from "./id-allocation"
import { clampProviderTransformOverhead } from "./provider-overhead"
import { isCompleteBoundaryMetadataV1, validateArtifactPath, validateContextItemReference } from "./validators"
import type {
  ContextItem,
  ContextItemID,
  ContextItemType,
  ConversationID,
  LcmFileID,
  LcmProviderRequestSnapshotTerminalStatus,
  LcmRecoveryResult,
  LcmRenderedSpanProviderFamily,
  LcmRenderInputManifestV1,
  LcmRetrievalCueLifecycleState,
  LcmRetrievalCuePayload,
  LcmStrategy,
  LcmSafeError,
  LcmThresholdDecision,
  LcmTokenCounterMode,
  MessageRowID,
  OperationID,
  SummaryID,
} from "./types"
import { LCM_TOKEN_BUDGET_CACHE_VERSION, type LcmTokenCounter } from "./token-budget"
import {
  asNumber,
  type ContextCandidate,
  type ContextRow,
  type ConversationRow,
  type FileRow,
  invalidRequest,
  isObject,
  isRetrievalCuePayload,
  jsonValue,
  LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE,
  LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION,
  LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
  LCM_PROVIDER_REQUEST_SNAPSHOT_TTL_MS,
  LCM_PROVIDER_VALIDATOR_PENDING_M39,
  type LcmAssemblyPlacementSlot,
  type LcmContextRestoreManifest,
  type LcmContextRestoreManifestItem,
  type LcmContextRestoreManifestItemV2,
  type LcmContextRestoreManifestV2,
  type LcmRenderUnit,
  missingSource,
  optionalNumber,
  type ProviderRequestSnapshotRow,
  providerSafeIdentityFromManifest,
  recoveryRequired,
  type ProviderSafeSnapshotEvidence,
  type ProviderSafeSnapshotItem,
  type Queryable,
  rowCueID,
  rowCuePayload,
  rowToItem,
  type SnapshotRow,
  staleFile,
  type ThresholdContextItemCount,
  type Transactional,
  type ValidationResult,
} from "./context-core"
import { computeSoftBacklogFromRows, loadSummaryMetadata } from "./context-render"

// Maintainer boundary: Active context and snapshots are derived state over immutable source and summary lineage. Keep rewrites transactional and preserve in-flight request evidence when changing row lifecycle.
export async function persistThresholdCounts(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly counted: readonly ThresholdContextItemCount[]
  readonly decision: LcmThresholdDecision
  readonly counter: LcmTokenCounter
  readonly providerSafe?: ProviderSafeSnapshotEvidence
  readonly providerContextLimit: number
  readonly providerInputLimit?: number
  readonly providerOutputLimit?: number
  readonly providerTransformOverheadReserveTokens?: number
  readonly outputReserve: number
  readonly writeSnapshot?: boolean
}) {
  const now = Date.now()
  const changed = input.counted.filter(
    (item) =>
      optionalNumber(item.row.token_count) !== item.tokenCount ||
      item.row.cache_key !== item.cacheKey ||
      optionalNumber(item.row.cache_version) !== LCM_TOKEN_BUDGET_CACHE_VERSION,
  )
  if (changed.length > 0) {
    const values: string[] = []
    const params: unknown[] = []
    for (const item of changed) {
      const offset = params.length
      values.push(
        `($${offset + 1}::text, $${offset + 2}::integer, $${offset + 3}::text, ` +
          `$${offset + 4}::integer, $${offset + 5}::double precision)`,
      )
      params.push(item.row.context_item_id, item.tokenCount, item.cacheKey, LCM_TOKEN_BUDGET_CACHE_VERSION, now)
    }
    await input.db.query(
      `
        UPDATE lcm_context_items AS item
        SET token_count = counted.token_count,
            cache_key = counted.cache_key,
            cache_version = counted.cache_version,
            updated_at_ms = counted.updated_at_ms
        FROM (VALUES ${values.join(",")}) AS counted(
          context_item_id,
          token_count,
          cache_key,
          cache_version,
          updated_at_ms
        )
        WHERE item.context_item_id = counted.context_item_id
          AND (
            item.token_count IS DISTINCT FROM counted.token_count
            OR item.cache_key IS DISTINCT FROM counted.cache_key
            OR item.cache_version IS DISTINCT FROM counted.cache_version
          )
      `,
      params,
    )
  }
  if (input.writeSnapshot === false) return
  await writeContextSnapshot({
    db: input.db,
    conversationID: input.conversationID,
    strategy: input.decision.strategy,
    reason: "threshold",
    nowMs: now,
    threshold: {
      activeTokens: input.decision.activeTokens,
      hardLimit: input.decision.hardLimit,
      softThreshold: input.decision.softThreshold,
      freshTailTokens: input.decision.freshTailTokens,
      softBacklogTokens: input.decision.softBacklogTokens,
      softBacklogItemCount: input.decision.softBacklogItemCount,
      softBacklogLargestSourceTokens: input.decision.softBacklogLargestSourceTokens,
      freshTailRawTokens: input.decision.freshTailRawTokens,
      freshTailRawItemCount: input.decision.freshTailRawItemCount,
      unconsumedRawTokens: input.decision.unconsumedRawTokens,
      unconsumedRawItemCount: input.decision.unconsumedRawItemCount,
      protectedTailRawTokens: input.decision.protectedTailRawTokens,
      protectedTailRawItemCount: input.decision.protectedTailRawItemCount,
      rawLaneTokens: input.decision.rawLaneTokens,
      hardFillRatio: input.decision.hardFillRatio,
      rawLaneRatio: input.decision.rawLaneRatio,
      softBacklogRatio: input.decision.softBacklogRatio,
      softPressureReason: input.decision.softPressureReason,
      laneLatchDiagnostics: input.decision.laneLatchDiagnostics,
      lanes: input.decision.lanes,
      tokenCounterMode: input.counter.mode,
      tokenCounterVersion: input.counter.version,
      providerContextLimit: input.providerContextLimit,
      providerInputLimit: input.providerInputLimit,
      providerOutputLimit: input.providerOutputLimit,
      outputReserve: input.outputReserve,
      budgetStatus: input.decision.budgetStatus,
      providerTransformOverheadReserveTokens: input.providerTransformOverheadReserveTokens,
    },
    providerSafe: input.providerSafe,
  })
}

export async function count(db: Queryable, sql: string, params: unknown[]) {
  const row = (await db.query<{ count: number | string | bigint }>(sql, params)).rows[0]
  return asNumber(row?.count)
}

export async function loadConsumedRawMessageRowIDs(db: Queryable, conversationID: ConversationID) {
  const rows = (
    await db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_context_item_consumption
        WHERE conversation_id = $1
      `,
      [conversationID],
    )
  ).rows
  return new Set(rows.map((row) => row.message_row_id))
}

export async function findConversation(db: Queryable, conversationID: ConversationID) {
  return (
    await db.query<ConversationRow>(
      `
        SELECT c.conversation_id,
               c.source_session_id,
               c.parent_conversation_id,
               c.root_conversation_id,
               c.project_id,
               c.workspace_id,
               c.session_directory,
               c.worktree_path,
               c.capability_class,
               c.lifecycle_state,
               c.boundary_metadata_json,
               COALESCE(
                 (
                   SELECT snapshot.strategy
                   FROM lcm_context_snapshots snapshot
                   WHERE snapshot.conversation_id = c.conversation_id
                   ORDER BY snapshot.created_at_ms DESC, snapshot.snapshot_id DESC
                   LIMIT 1
                 ),
                 (
                   SELECT summary.strategy
                   FROM lcm_summaries summary
                   WHERE summary.conversation_id = c.conversation_id
                   ORDER BY summary.created_at_ms DESC, summary.summary_id DESC
                   LIMIT 1
                 ),
                 'upward'
               ) AS strategy
        FROM lcm_conversations c
        WHERE c.conversation_id = $1
      `,
      [conversationID],
    )
  ).rows[0]
}

export async function findSourceMessageRowID(input: {
  db: Queryable
  conversationID: ConversationID
  sourceSessionID?: string
  sourceMessageID: string
}) {
  return (
    await input.db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_messages
        WHERE conversation_id = $1
          AND source_message_id = $2
          AND ($3::text IS NULL OR source_session_id = $3)
        LIMIT 1
      `,
      [input.conversationID, input.sourceMessageID, input.sourceSessionID ?? null],
    )
  ).rows[0]?.message_row_id
}

export async function loadContextRows(
  db: Queryable,
  conversationID: ConversationID,
  options?: { readonly includeInactiveCues?: boolean },
) {
  return (
    await db.query<ContextRow>(
      `
        SELECT *
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND (
            $2::boolean
            OR item_type <> 'retrieval_cue'
            OR cue_lifecycle_state = 'active'
          )
        ORDER BY item_order, context_item_id
      `,
      [conversationID, options?.includeInactiveCues === true],
    )
  ).rows
}

function validateOrder(rows: readonly ContextRow[]) {
  const seen = new Set<number>()
  for (let index = 0; index < rows.length; index++) {
    const order = asNumber(rows[index]!.item_order)
    if (order !== index + 1 || seen.has(order)) return false
    seen.add(order)
  }
  return true
}

async function validateSummaryReference(db: Queryable, conversationID: ConversationID, summaryID: SummaryID) {
  const summaryRows = (
    await db.query<{ summary_id: SummaryID }>(
      "SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1 AND summary_id = $2",
      [conversationID, summaryID],
    )
  ).rows
  if (summaryRows.length !== 1) return false
  const provenanceCount = await count(
    db,
    `
      SELECT (
        (SELECT count(*) FROM lcm_summary_messages WHERE summary_id = $1) +
        (SELECT count(*) FROM lcm_summary_parents WHERE summary_id = $1)
      )::int AS count
    `,
    [summaryID],
  )
  return provenanceCount > 0
}

async function loadCoveredMessageRowIDsForSummaries(
  db: Queryable,
  conversationID: ConversationID,
  summaryIDs: readonly SummaryID[],
) {
  if (summaryIDs.length === 0) return new Set<MessageRowID>()
  const rows = (
    await db.query<{ message_row_id: MessageRowID }>(
      `
        WITH RECURSIVE summary_lineage(summary_id) AS (
          SELECT summary.summary_id
          FROM lcm_summaries summary
          WHERE summary.conversation_id = $1
            AND summary.summary_id = ANY($2::text[])
          UNION
          SELECT edge.parent_summary_id
          FROM lcm_summary_parents edge
          JOIN summary_lineage current ON current.summary_id = edge.summary_id
          JOIN lcm_summaries parent
            ON parent.summary_id = edge.parent_summary_id
           AND parent.conversation_id = $1
        )
        SELECT DISTINCT source.message_row_id
        FROM summary_lineage lineage
        JOIN lcm_summary_messages source ON source.summary_id = lineage.summary_id
        JOIN lcm_messages message
          ON message.message_row_id = source.message_row_id
         AND message.conversation_id = $1
      `,
      [conversationID, summaryIDs],
    )
  ).rows
  return new Set(rows.map((row) => row.message_row_id))
}

async function loadSummaryRootChronology(
  db: Queryable,
  conversationID: ConversationID,
  summaryIDs: readonly SummaryID[],
) {
  if (summaryIDs.length === 0) return new Map<SummaryID, number>()
  const rows = (
    await db.query<{ root_summary_id: SummaryID; source_order: number | string | bigint }>(
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
        SELECT lineage.root_summary_id, max(message.message_order)::bigint AS source_order
        FROM summary_lineage lineage
        JOIN lcm_summary_messages source ON source.summary_id = lineage.summary_id
        JOIN lcm_messages message
          ON message.message_row_id = source.message_row_id
         AND message.conversation_id = $1
        GROUP BY lineage.root_summary_id
      `,
      [conversationID, summaryIDs],
    )
  ).rows
  return new Map(rows.map((row) => [row.root_summary_id, asNumber(row.source_order)] as const))
}

const LCM_CONTEXT_SUMMARY_LINEAGE_MAX_DEPTH = 256

// Recovery must validate the whole stored graph, not only the roots it happens
// to project. Otherwise an unreachable cycle can be silently left behind and a
// cycle below a valid root can make recursive coverage ambiguous.
async function validateSummaryLineageProjection(input: {
  db: Queryable
  conversationID: ConversationID
  rootSummaryIDs: readonly SummaryID[]
}) {
  const summaries = (
    await input.db.query<{ summary_id: SummaryID }>(
      "SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1 ORDER BY summary_id",
      [input.conversationID],
    )
  ).rows
  const summaryIDs = new Set(summaries.map((row) => row.summary_id))
  if (summaryIDs.size === 0) return input.rootSummaryIDs.length === 0
  if (input.rootSummaryIDs.length === 0 || new Set(input.rootSummaryIDs).size !== input.rootSummaryIDs.length) {
    return false
  }
  if (input.rootSummaryIDs.some((summaryID) => !summaryIDs.has(summaryID))) return false

  const parentRows = (
    await input.db.query<{ summary_id: SummaryID; parent_summary_id: SummaryID }>(
      `
        SELECT edge.summary_id, edge.parent_summary_id
        FROM lcm_summary_parents edge
        JOIN lcm_summaries summary ON summary.summary_id = edge.summary_id
        WHERE summary.conversation_id = $1
        ORDER BY edge.summary_id, edge.parent_order, edge.parent_summary_id
      `,
      [input.conversationID],
    )
  ).rows
  const parentsBySummary = new Map<SummaryID, SummaryID[]>()
  for (const row of parentRows) {
    if (!summaryIDs.has(row.parent_summary_id)) return false
    const parents = parentsBySummary.get(row.summary_id) ?? []
    parents.push(row.parent_summary_id)
    parentsBySummary.set(row.summary_id, parents)
  }

  const messageRows = (
    await input.db.query<{ summary_id: SummaryID; message_conversation_id: ConversationID }>(
      `
        SELECT source.summary_id, message.conversation_id AS message_conversation_id
        FROM lcm_summary_messages source
        JOIN lcm_summaries summary ON summary.summary_id = source.summary_id
        JOIN lcm_messages message ON message.message_row_id = source.message_row_id
        WHERE summary.conversation_id = $1
        ORDER BY source.summary_id, source.source_order, source.message_row_id
      `,
      [input.conversationID],
    )
  ).rows
  const summariesWithMessages = new Set<SummaryID>()
  for (const row of messageRows) {
    if (row.message_conversation_id !== input.conversationID) return false
    summariesWithMessages.add(row.summary_id)
  }
  for (const summaryID of summaryIDs) {
    if (!summariesWithMessages.has(summaryID) && (parentsBySummary.get(summaryID)?.length ?? 0) === 0) return false
  }

  const state = new Map<SummaryID, "visiting" | "visited">()
  const reached = new Set<SummaryID>()
  const visit = (summaryID: SummaryID, depth: number): boolean => {
    if (depth > LCM_CONTEXT_SUMMARY_LINEAGE_MAX_DEPTH) return false
    const current = state.get(summaryID)
    if (current === "visiting") return false
    if (current === "visited") return true
    state.set(summaryID, "visiting")
    reached.add(summaryID)
    for (const parentSummaryID of parentsBySummary.get(summaryID) ?? []) {
      if (!visit(parentSummaryID, depth + 1)) return false
    }
    state.set(summaryID, "visited")
    return true
  }
  for (const rootSummaryID of input.rootSummaryIDs) {
    if (!visit(rootSummaryID, 0)) return false
  }
  return reached.size === summaryIDs.size
}

async function validateRawMessageReference(input: {
  db: Queryable
  conversationID: ConversationID
  messageRowID: MessageRowID
  artifactRoot?: string
}) {
  const messageCount = await count(
    input.db,
    "SELECT count(*)::int AS count FROM lcm_messages WHERE conversation_id = $1 AND message_row_id = $2",
    [input.conversationID, input.messageRowID],
  )
  if (messageCount !== 1) return false
  const partCount = await count(
    input.db,
    "SELECT count(*)::int AS count FROM lcm_message_parts WHERE conversation_id = $1 AND message_row_id = $2",
    [input.conversationID, input.messageRowID],
  )
  if (partCount <= 0) return false
  const lcmFileParts = (
    await input.db.query<{ content_file_id: LcmFileID }>(
      `
        SELECT content_file_id
        FROM lcm_message_parts
        WHERE conversation_id = $1
          AND message_row_id = $2
          AND content_storage_kind = 'lcm_file'
          AND content_file_id IS NOT NULL
      `,
      [input.conversationID, input.messageRowID],
    )
  ).rows
  for (const part of lcmFileParts) {
    const file = await validateFileReference({
      db: input.db,
      conversationID: input.conversationID,
      fileID: part.content_file_id,
      artifactRoot: input.artifactRoot,
    })
    if (!file.ok) return false
  }
  return true
}

async function validateFileReference(input: {
  db: Queryable
  conversationID: ConversationID
  fileID: LcmFileID
  artifactRoot?: string
}) {
  const row = (
    await input.db.query<FileRow>(
      `
        SELECT file_id, conversation_id, source_kind, boundary_metadata_json, artifact_storage_kind,
               artifact_path, artifact_byte_count, artifact_content_sha256
        FROM lcm_large_files
        WHERE conversation_id = $1 AND file_id = $2
      `,
      [input.conversationID, input.fileID],
    )
  ).rows[0]
  if (!row) return { ok: false, reason: "file_missing" }

  if (row.source_kind === "path" && !isCompleteBoundaryMetadataV1(jsonValue(row.boundary_metadata_json))) {
    return { ok: false, reason: "file_boundary_incomplete" }
  }

  if (row.artifact_storage_kind === "none") return { ok: true }
  if (!row.artifact_path || !row.artifact_content_sha256) return { ok: false, reason: "artifact_metadata_incomplete" }
  const pathValidation = validateArtifactPath(row.artifact_path)
  if (!pathValidation.ok) return { ok: false, reason: pathValidation.reason ?? "artifact_path_invalid" }
  if (!input.artifactRoot) return { ok: true }

  const artifact = await readAndValidateLcmArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath: row.artifact_path,
    byteCount: asNumber(row.artifact_byte_count),
    sha256: row.artifact_content_sha256,
  })
  return artifact.ok ? { ok: true } : { ok: false, reason: artifact.reason }
}

async function cueAllowedConversationIDs(db: Queryable, conversationID: ConversationID) {
  const rows = (
    await db.query<{
      conversation_id: ConversationID
      parent_conversation_id: ConversationID | null
      cycle: boolean
      depth: number | string | bigint
    }>(
      `
        WITH RECURSIVE lineage(conversation_id, parent_conversation_id, path, cycle, depth) AS (
          SELECT conversation_id,
                 parent_conversation_id,
                 ARRAY[conversation_id]::text[],
                 false,
                 1
          FROM lcm_conversations
          WHERE conversation_id = $1
          UNION ALL
          SELECT parent.conversation_id,
                 parent.parent_conversation_id,
                 current.path || parent.conversation_id,
                 parent.conversation_id = ANY(current.path),
                 current.depth + 1
          FROM lcm_conversations parent
          JOIN lineage current ON current.parent_conversation_id = parent.conversation_id
          WHERE NOT current.cycle
            AND current.depth < 256
        )
        SELECT conversation_id, parent_conversation_id, cycle, depth
        FROM lineage
      `,
      [conversationID],
    )
  ).rows
  if (rows.some((row) => row.cycle)) throw invalidRequest("lcm_retrieval_cue_ancestor_cycle")
  if (rows.some((row) => asNumber(row.depth) >= 256 && row.parent_conversation_id)) {
    throw invalidRequest("lcm_retrieval_cue_ancestor_depth")
  }
  return [...new Set(rows.map((row) => row.conversation_id))]
}

async function validateCueReferences(db: Queryable, conversationID: ConversationID, payload: LcmRetrievalCuePayload) {
  const allowed = await cueAllowedConversationIDs(db, conversationID)
  if (allowed.length === 0) return false
  const allowedSql = allowed.map((_, index) => `$${index + 1}`).join(", ")
  for (const summaryID of payload.summaryIDs) {
    const summaryCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_summaries WHERE conversation_id IN (${allowedSql}) AND summary_id = $${allowed.length + 1}`,
      [...allowed, summaryID],
    )
    if (summaryCount !== 1) return false
  }
  for (const fileID of payload.fileIDs) {
    const fileCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_large_files WHERE conversation_id IN (${allowedSql}) AND file_id = $${allowed.length + 1}`,
      [...allowed, fileID],
    )
    if (fileCount !== 1) return false
  }
  for (const messageRowID of payload.messageRowIDs) {
    const messageCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_messages WHERE conversation_id IN (${allowedSql}) AND message_row_id = $${allowed.length + 1}`,
      [...allowed, messageRowID],
    )
    if (messageCount !== 1) return false
  }
  for (const partRowID of payload.partRowIDs) {
    const partCount = await count(
      db,
      `SELECT count(*)::int AS count FROM lcm_message_parts WHERE conversation_id IN (${allowedSql}) AND part_row_id = $${allowed.length + 1}`,
      [...allowed, partRowID],
    )
    if (partCount !== 1) return false
  }
  return true
}

function sortedUniqueStrings(values: Iterable<string>) {
  return [...new Set([...values].filter((value) => typeof value === "string" && value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function jsonStringArray(value: unknown) {
  const parsed = jsonValue(value)
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
}

function providerRequestSnapshotProtectionHash(input: {
  readonly snapshots: readonly Pick<ProviderRequestSnapshotRow, "request_snapshot_id" | "cue_ids_json">[]
  readonly protectedCueIDs: readonly string[]
}) {
  return stableHash({
    namespace: "lcm-request-snapshot-protection-v1",
    snapshots: input.snapshots.map((snapshot) => ({
      requestSnapshotID: snapshot.request_snapshot_id,
      cueIDs: sortedUniqueStrings(jsonStringArray(snapshot.cue_ids_json)),
    })),
    protectedCueIDs: sortedUniqueStrings(input.protectedCueIDs),
  })
}

async function expireStaleProviderRequestSnapshots(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly nowMs: number
}) {
  await input.db.query(
    `
      UPDATE lcm_provider_request_snapshots
      SET status = 'expired',
          terminal_at_ms = $2
      WHERE conversation_id = $1
        AND status = 'in_flight'
        AND expires_at_ms <= $2
    `,
    [input.conversationID, input.nowMs],
  )
}

async function loadInFlightProviderRequestSnapshots(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
}) {
  return (
    await input.db.query<ProviderRequestSnapshotRow>(
      `
        SELECT *
        FROM lcm_provider_request_snapshots
        WHERE conversation_id = $1
          AND status = 'in_flight'
        ORDER BY request_snapshot_id
      `,
      [input.conversationID],
    )
  ).rows
}

export async function requestSnapshotProtectionForConversation(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly nowMs: number
}) {
  await expireStaleProviderRequestSnapshots(input)
  const snapshots = await loadInFlightProviderRequestSnapshots(input)
  const protectedCueIDs = sortedUniqueStrings(snapshots.flatMap((snapshot) => jsonStringArray(snapshot.cue_ids_json)))
  return {
    snapshots,
    protectedCueIDs,
    requestSnapshotProtectionHash: providerRequestSnapshotProtectionHash({ snapshots, protectedCueIDs }),
  }
}

export function providerRequestSnapshotID() {
  return `reqsnap_${createOperationID().slice(3)}`
}

export function cueGenerationID() {
  return `cuegen_${createOperationID().slice(3)}`
}

export function cueRowID() {
  return `cue_${createOperationID().slice(3)}`
}

function selectedCueIDs(renderUnits: readonly LcmRenderUnit[]) {
  return sortedUniqueStrings(
    renderUnits.flatMap((unit) =>
      unit.source.kind === "retrieval_cue" && unit.source.cueLifecycleState === "active" ? [unit.source.cueID] : [],
    ),
  )
}

function selectedRenderUnitIDs(renderUnits: readonly LcmRenderUnit[]) {
  const seen = new Set<string>()
  const ordered = [...renderUnits].sort((left, right) => {
    if (left.effectiveOrder !== right.effectiveOrder) return left.effectiveOrder - right.effectiveOrder
    if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
    return left.renderUnitID.localeCompare(right.renderUnitID)
  })
  const output: string[] = []
  for (const unit of ordered) {
    if (seen.has(unit.renderUnitID)) continue
    seen.add(unit.renderUnitID)
    output.push(unit.renderUnitID)
  }
  return output
}

function providerRequestSnapshotItems(renderUnits: readonly LcmRenderUnit[]) {
  const seen = new Set<string>()
  const ordered = [...renderUnits].sort((left, right) => {
    if (left.effectiveOrder !== right.effectiveOrder) return left.effectiveOrder - right.effectiveOrder
    if (left.canonicalOrder !== right.canonicalOrder) return left.canonicalOrder - right.canonicalOrder
    return left.renderUnitID.localeCompare(right.renderUnitID)
  })
  const output: Array<{
    renderUnitID: string
    contextItemID: ContextItemID
    itemType: ContextItemType
    messageRowID?: MessageRowID
    sourceKind: string
    itemOrder: number
  }> = []
  for (const unit of ordered) {
    if (seen.has(unit.renderUnitID) || !("contextItemID" in unit.source)) continue
    seen.add(unit.renderUnitID)
    output.push({
      renderUnitID: unit.renderUnitID,
      contextItemID: unit.source.contextItemID,
      itemType: unit.source.kind,
      ...(unit.source.kind === "raw_message" ? { messageRowID: unit.source.messageRowID } : {}),
      sourceKind: unit.sourceKind,
      itemOrder: output.length,
    })
  }
  return output
}

export async function createProviderRequestSnapshot(input: {
  readonly db: Queryable
  readonly requestSnapshotID?: string
  readonly operationID: OperationID
  readonly conversationID: ConversationID
  readonly sourceSessionID: string
  readonly providerID: string
  readonly modelID: string
  readonly renderUnits: readonly LcmRenderUnit[]
  readonly manifest: LcmRenderInputManifestV1
  readonly nowMs: number
}) {
  const requestSnapshotID = input.requestSnapshotID ?? providerRequestSnapshotID()
  const items = providerRequestSnapshotItems(input.renderUnits)
  const params: unknown[] = [
    requestSnapshotID,
    input.operationID,
    input.conversationID,
    input.sourceSessionID,
    input.providerID,
    input.modelID,
    JSON.stringify(selectedCueIDs(input.renderUnits)),
    JSON.stringify(selectedRenderUnitIDs(input.renderUnits)),
    input.manifest.sourceSelectionHash,
    input.manifest.requestSnapshotProtectionHash,
    input.manifest.messageVisibilityHash,
    input.manifest.protectedSpanHash,
    input.manifest.providerTransformHash,
    input.nowMs,
    input.nowMs + LCM_PROVIDER_REQUEST_SNAPSHOT_TTL_MS,
    JSON.stringify(items),
  ]

  // Header and ordered evidence are one statement so an item constraint or
  // provenance failure cannot leave a cue-protecting header with no evidence.
  const result = await input.db.query<{ request_snapshot_id: string }>(
    `
      WITH inserted_snapshot AS (
        INSERT INTO lcm_provider_request_snapshots (
          request_snapshot_id,
          operation_id,
          conversation_id,
          source_session_id,
          provider_id,
          model_id,
          status,
          cue_ids_json,
          render_unit_ids_json,
          source_selection_hash,
          request_snapshot_protection_hash,
          visibility_hash,
          protected_span_hash,
          provider_transform_hash,
          provider_validator_hash,
          created_at_ms,
          expires_at_ms,
          terminal_at_ms
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'in_flight',
          $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, NULL, $14, $15, NULL
        )
        RETURNING request_snapshot_id, conversation_id
      ), inserted_items AS (
        INSERT INTO lcm_provider_request_snapshot_items (
          request_snapshot_id,
          conversation_id,
          render_unit_id,
          context_item_id,
          item_type,
          message_row_id,
          source_kind,
          item_order
        )
        SELECT inserted_snapshot.request_snapshot_id,
               inserted_snapshot.conversation_id,
               item."renderUnitID",
               item."contextItemID",
               item."itemType",
               item."messageRowID",
               item."sourceKind",
               item."itemOrder"
        FROM inserted_snapshot
        CROSS JOIN jsonb_to_recordset($16::jsonb) AS item(
          "renderUnitID" text,
          "contextItemID" text,
          "itemType" text,
          "messageRowID" text,
          "sourceKind" text,
          "itemOrder" integer
        )
        RETURNING request_snapshot_id
      )
      SELECT inserted_snapshot.request_snapshot_id
      FROM inserted_snapshot
      CROSS JOIN (SELECT count(*) AS item_count FROM inserted_items) inserted_item_count
    `,
    params,
  )
  if (result.rows.length !== 1) throw invalidRequest("lcm_provider_request_snapshot_creation_unavailable")
  return requestSnapshotID
}

// Terminal status and first-consumption evidence must commit as one statement.
// Callers may retry only while the snapshot remains in flight, so never split these writes or swallow a failure.
export async function finalizeProviderRequestSnapshotRow(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshotID: string
  readonly status: LcmProviderRequestSnapshotTerminalStatus
  readonly conversationID?: ConversationID
  readonly nowMs?: number
}) {
  const now = input.nowMs ?? Date.now()
  const result = await input.db.query<{ request_snapshot_id: string }>(
    `
      WITH terminalized AS (
        UPDATE lcm_provider_request_snapshots
        SET status = $2,
            terminal_at_ms = $3
        WHERE request_snapshot_id = $1
          AND status = 'in_flight'
          AND ($4::text IS NULL OR conversation_id = $4)
        RETURNING request_snapshot_id, operation_id
      ),
      consumed AS (
        INSERT INTO lcm_context_item_consumption (
          conversation_id,
          context_item_id,
          message_row_id,
          first_request_snapshot_id,
          first_operation_id,
          first_consumed_at_ms
        )
        SELECT item.conversation_id,
               live.context_item_id,
               item.message_row_id,
               terminalized.request_snapshot_id,
               terminalized.operation_id,
               $3
        FROM terminalized
        JOIN lcm_provider_request_snapshot_items item
          ON item.request_snapshot_id = terminalized.request_snapshot_id
        LEFT JOIN lcm_context_items live
          ON live.conversation_id = item.conversation_id
         AND live.context_item_id = item.context_item_id
        WHERE $2 = 'resolved'
          AND item.item_type = 'raw_message'
          AND item.message_row_id IS NOT NULL
        ON CONFLICT (conversation_id, message_row_id) DO NOTHING
        RETURNING message_row_id
      ),
      consumption_write AS (
        SELECT count(*) AS count FROM consumed
      )
      SELECT terminalized.request_snapshot_id
      FROM terminalized
      CROSS JOIN consumption_write
    `,
    [input.requestSnapshotID, input.status, now, input.conversationID ?? null],
  )
  if (result.rows.length !== 1) {
    throw invalidRequest("lcm_provider_request_snapshot_terminalization_unavailable")
  }
}

export async function recordProviderRequestSnapshotFinalValidationRow(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshotID: string
  readonly providerValidatorHash: string
  readonly providerFamily?: LcmRenderedSpanProviderFamily
  readonly providerTransformOverheadTokenCount?: number
  readonly conversationID?: ConversationID
}) {
  const result = await input.db.query<ProviderRequestSnapshotRow>(
    `
      UPDATE lcm_provider_request_snapshots
      SET provider_validator_hash = $2
      WHERE request_snapshot_id = $1
        AND status = 'in_flight'
        AND ($3::text IS NULL OR conversation_id = $3)
      RETURNING *
    `,
    [input.requestSnapshotID, input.providerValidatorHash, input.conversationID ?? null],
  )
  if (result.rows.length !== 1) {
    throw invalidRequest("lcm_provider_request_snapshot_final_validation_unavailable")
  }
  if (input.providerFamily && input.providerTransformOverheadTokenCount !== undefined) {
    const requestSnapshot = result.rows[0]!
    const observedTokens = clampProviderTransformOverhead({
      providerContextLimit: Number.MAX_SAFE_INTEGER,
      tokens: input.providerTransformOverheadTokenCount,
    })
    await input.db.query(
      `
        INSERT INTO lcm_provider_transform_overheads (
          provider_id,
          model_id,
          provider_family,
          max_observed_tokens,
          last_observed_tokens,
          sample_count,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $4, 1, $5, $5)
        ON CONFLICT (provider_id, model_id, provider_family)
        DO UPDATE SET
          max_observed_tokens = GREATEST(lcm_provider_transform_overheads.max_observed_tokens, EXCLUDED.max_observed_tokens),
          last_observed_tokens = EXCLUDED.last_observed_tokens,
          sample_count = lcm_provider_transform_overheads.sample_count + 1,
          updated_at_ms = EXCLUDED.updated_at_ms
      `,
      [requestSnapshot.provider_id, requestSnapshot.model_id, input.providerFamily, observedTokens, Date.now()],
    )
  }
  await upgradeProviderSafeSnapshotFinalValidationEvidence({
    db: input.db,
    requestSnapshot: result.rows[0]!,
    providerValidatorHash: input.providerValidatorHash,
  })
}

function clearManifestItemCacheFields(value: unknown) {
  if (!isObject(value)) return value
  const { cacheKey: _cacheKey, cacheVersion: _cacheVersion, ...withoutCache } = value
  return withoutCache
}

function snapshotMatchesFinalValidationRequest(input: {
  readonly requestSnapshot: ProviderRequestSnapshotRow
  readonly manifest: Record<string, unknown>
  readonly providerSafe: Record<string, unknown>
}) {
  const pairs: Array<readonly [unknown, unknown]> = [
    [input.manifest.sourceSelectionHash, input.requestSnapshot.source_selection_hash],
    [input.manifest.requestSnapshotProtectionHash, input.requestSnapshot.request_snapshot_protection_hash],
    [input.manifest.visibilityHash, input.requestSnapshot.visibility_hash],
    [input.manifest.protectedSpanHash, input.requestSnapshot.protected_span_hash],
    [input.manifest.providerTransformHash, input.requestSnapshot.provider_transform_hash],
    [input.providerSafe.sourceSelectionHash, input.requestSnapshot.source_selection_hash],
    [input.providerSafe.requestSnapshotProtectionHash, input.requestSnapshot.request_snapshot_protection_hash],
    [input.providerSafe.visibilityHash, input.requestSnapshot.visibility_hash],
    [input.providerSafe.protectedSpanHash, input.requestSnapshot.protected_span_hash],
    [input.providerSafe.providerTransformHash, input.requestSnapshot.provider_transform_hash],
  ]
  return pairs.every(([left, right]) => left === right)
}

async function upgradeProviderSafeSnapshotFinalValidationEvidence(input: {
  readonly db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
  readonly requestSnapshot: ProviderRequestSnapshotRow
  readonly providerValidatorHash: string
}) {
  if (input.providerValidatorHash === LCM_PROVIDER_VALIDATOR_PENDING_M39) return
  const snapshots = (
    await input.db.query<{ snapshot_id: string; restore_manifest_json: unknown; metrics_json: unknown }>(
      `
        SELECT snapshot_id, restore_manifest_json, metrics_json
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
          AND restore_manifest_json->>'schemaVersion' = $2
          AND restore_manifest_json->>'providerValidatorHash' = $3
          AND restore_manifest_json->>'sourceSelectionHash' = $4
          AND restore_manifest_json->>'requestSnapshotProtectionHash' = $5
          AND restore_manifest_json->>'visibilityHash' = $6
          AND restore_manifest_json->>'protectedSpanHash' = $7
          AND restore_manifest_json->>'providerTransformHash' = $8
        ORDER BY created_at_ms DESC, snapshot_id DESC
      `,
      [
        input.requestSnapshot.conversation_id,
        LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
        LCM_PROVIDER_VALIDATOR_PENDING_M39,
        input.requestSnapshot.source_selection_hash,
        input.requestSnapshot.request_snapshot_protection_hash,
        input.requestSnapshot.visibility_hash,
        input.requestSnapshot.protected_span_hash,
        input.requestSnapshot.provider_transform_hash,
      ],
    )
  ).rows

  let upgraded = false
  for (const snapshot of snapshots) {
    const manifest = jsonValue(snapshot.restore_manifest_json)
    const metrics = jsonValue(snapshot.metrics_json)
    if (!isObject(manifest) || !isObject(metrics)) continue
    const providerSafe = jsonValue(metrics.providerSafe)
    if (
      !isObject(providerSafe) ||
      providerSafe.schemaVersion !== "lcm-provider-safe-snapshot-identity-v1" ||
      providerSafe.providerValidatorHash !== LCM_PROVIDER_VALIDATOR_PENDING_M39 ||
      !snapshotMatchesFinalValidationRequest({
        requestSnapshot: input.requestSnapshot,
        manifest,
        providerSafe,
      })
    ) {
      continue
    }

    const updatedManifest = {
      ...manifest,
      providerValidatorHash: input.providerValidatorHash,
      items: Array.isArray(manifest.items)
        ? manifest.items.map((item) => clearManifestItemCacheFields(item))
        : manifest.items,
    }
    const updatedMetrics = {
      ...metrics,
      providerSafe: {
        ...providerSafe,
        providerValidatorHash: input.providerValidatorHash,
      },
    }
    const result = await input.db.query<{ snapshot_id: string }>(
      `
        UPDATE lcm_context_snapshots
        SET restore_manifest_json = $2::jsonb,
            metrics_json = $3::jsonb
        WHERE snapshot_id = $1
          AND restore_manifest_json->>'providerValidatorHash' = $4
        RETURNING snapshot_id
      `,
      [
        snapshot.snapshot_id,
        JSON.stringify(updatedManifest),
        JSON.stringify(updatedMetrics),
        LCM_PROVIDER_VALIDATOR_PENDING_M39,
      ],
    )
    if (result.rows.length > 0) upgraded = true
  }

  if (upgraded) {
    await input.db.query(
      `
        UPDATE lcm_context_items
        SET cache_key = NULL,
            cache_version = NULL,
            updated_at_ms = $2
        WHERE conversation_id = $1
          AND (cache_key IS NOT NULL OR cache_version IS NOT NULL)
      `,
      [input.requestSnapshot.conversation_id, Date.now()],
    )
  }
}

export async function validateContextRows(input: {
  db: Queryable
  conversationID: ConversationID
  rows: ContextRow[]
  allowEmpty: boolean
  allowInactiveCues?: boolean
  artifactRoot?: string
}): Promise<ValidationResult> {
  if (input.rows.length === 0)
    return input.allowEmpty ? { ok: true, rows: [], items: [] } : { ok: false, reason: "empty" }
  if (!validateOrder(input.rows)) return { ok: false, reason: "order" }

  const rawMessageIDs = [
    ...new Set(input.rows.filter((row) => row.item_type === "raw_message").map((row) => row.message_row_id!)),
  ]
  const existingRawMessageIDs = new Set<MessageRowID>()
  const rawPartCounts = new Map<MessageRowID, number>()
  const rawFileParts = new Map<MessageRowID, LcmFileID[]>()
  if (rawMessageIDs.length > 0) {
    const messages = (
      await input.db.query<{ message_row_id: MessageRowID }>(
        `
          SELECT message_row_id
          FROM lcm_messages
          WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const message of messages) existingRawMessageIDs.add(message.message_row_id)

    const partCounts = (
      await input.db.query<{ message_row_id: MessageRowID; count: number | string | bigint }>(
        `
          SELECT message_row_id, count(*)::int AS count
          FROM lcm_message_parts
          WHERE conversation_id = $1 AND message_row_id = ANY($2::text[])
          GROUP BY message_row_id
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const partCount of partCounts) rawPartCounts.set(partCount.message_row_id, asNumber(partCount.count))

    const lcmFileParts = (
      await input.db.query<{ message_row_id: MessageRowID; content_file_id: LcmFileID }>(
        `
          SELECT message_row_id, content_file_id
          FROM lcm_message_parts
          WHERE conversation_id = $1
            AND message_row_id = ANY($2::text[])
            AND content_storage_kind = 'lcm_file'
            AND content_file_id IS NOT NULL
        `,
        [input.conversationID, rawMessageIDs],
      )
    ).rows
    for (const part of lcmFileParts) {
      const existing = rawFileParts.get(part.message_row_id) ?? []
      existing.push(part.content_file_id)
      rawFileParts.set(part.message_row_id, existing)
    }
  }

  const items: ContextItem[] = []
  for (const row of input.rows) {
    const reference = validateContextItemReference({
      itemType: row.item_type,
      messageRowID: row.message_row_id,
      summaryID: row.summary_id,
      pointerID: row.pointer_id,
      fileID: row.file_id,
      cueID: row.cue_id,
      cuePayload: row.cue_payload_json,
      cueLifecycleState: row.cue_lifecycle_state,
      cueTargetSourceMessageID: row.cue_target_source_message_id,
      cueGenerationID: row.cue_generation_id,
    })
    if (!reference.ok) return { ok: false, reason: reference.reason ?? "reference" }

    if (row.item_type === "raw_message") {
      if (!existingRawMessageIDs.has(row.message_row_id!) || (rawPartCounts.get(row.message_row_id!) ?? 0) <= 0) {
        return { ok: false, reason: "raw_message" }
      }
      for (const fileID of rawFileParts.get(row.message_row_id!) ?? []) {
        const file = await validateFileReference({
          db: input.db,
          conversationID: input.conversationID,
          fileID,
          artifactRoot: input.artifactRoot,
        })
        if (!file.ok) return { ok: false, reason: "raw_message" }
      }
    } else if (row.item_type === "summary") {
      if (!(await validateSummaryReference(input.db, input.conversationID, row.summary_id!))) {
        return { ok: false, reason: "summary" }
      }
    } else if (row.item_type === "archive_stub") {
      const pointerCount = await count(
        input.db,
        `
          SELECT count(*)::int AS count
          FROM lcm_summary_lineage_pointers
          WHERE conversation_id = $1 AND pointer_id = $2 AND summary_id = $3
        `,
        [input.conversationID, row.pointer_id, row.summary_id],
      )
      if (pointerCount !== 1 || !(await validateSummaryReference(input.db, input.conversationID, row.summary_id!))) {
        return { ok: false, reason: "archive_stub" }
      }
    } else if (row.item_type === "large_file_marker") {
      const file = await validateFileReference({
        db: input.db,
        conversationID: input.conversationID,
        fileID: row.file_id!,
        artifactRoot: input.artifactRoot,
      })
      if (!file.ok) return { ok: false, reason: file.reason ?? "file" }
    } else if (row.item_type === "retrieval_cue") {
      const payload = rowCuePayload(row)
      if (
        !row.cue_id ||
        !row.cue_lifecycle_state ||
        !row.cue_target_source_message_id ||
        !row.cue_generation_id ||
        (!input.allowInactiveCues && row.cue_lifecycle_state !== "active")
      ) {
        return { ok: false, reason: "cue_lifecycle" }
      }
      if (row.cue_superseded_by_id) {
        const successorCount = await count(
          input.db,
          `
            SELECT count(*)::int AS count
            FROM lcm_context_items
            WHERE conversation_id = $1
              AND cue_id = $2
          `,
          [input.conversationID, row.cue_superseded_by_id],
        )
        if (successorCount !== 1) return { ok: false, reason: "cue_successor" }
      }
      if (row.cue_superseded_by_generation_id) {
        const successorGenerationCount = await count(
          input.db,
          `
            SELECT count(*)::int AS count
            FROM lcm_context_items
            WHERE conversation_id = $1
              AND cue_generation_id = $2
          `,
          [input.conversationID, row.cue_superseded_by_generation_id],
        )
        if (successorGenerationCount < 1) return { ok: false, reason: "cue_successor_generation" }
      }
      if (!payload || !(await validateCueReferences(input.db, input.conversationID, payload))) {
        return { ok: false, reason: "cue" }
      }
    }

    items.push(rowToItem(row))
  }

  return { ok: true, rows: input.rows, items }
}

function contextItemCounts(rows: readonly ContextRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.item_type]++
      return counts
    },
    {
      raw_message: 0,
      summary: 0,
      archive_stub: 0,
      large_file_marker: 0,
      retrieval_cue: 0,
    } satisfies Record<ContextItemType, number>,
  )
}

function laneCountsFromItems(rows: readonly ContextRow[]) {
  const sumTokens = (itemType: ContextItemType) =>
    rows.reduce((total, row) => total + (row.item_type === itemType ? (optionalNumber(row.token_count) ?? 0) : 0), 0)
  return {
    raw_leaves: sumTokens("raw_message"),
    sprigs: sumTokens("summary"),
    bindles: 0,
    archive_stubs: sumTokens("archive_stub"),
    large_file_markers: sumTokens("large_file_marker"),
    retrieval_cues: sumTokens("retrieval_cue"),
  }
}

function tokenLaneCountsFromDecision(decision?: { lanes: LcmThresholdDecision["lanes"] }) {
  if (!decision) return undefined
  return {
    raw_leaves: decision.lanes.rawLeaves.tokens,
    sprigs: decision.lanes.sprigs.tokens,
    bindles: decision.lanes.bindles.tokens,
    archive_stubs: decision.lanes.archiveStubs.tokens,
    large_file_markers: decision.lanes.largeFileMarkers.tokens,
    retrieval_cues: decision.lanes.retrievalCues.tokens,
  }
}

function rowToManifestItem(row: ContextRow): LcmContextRestoreManifestItem {
  const base = {
    contextItemID: row.context_item_id,
    conversationID: row.conversation_id,
    itemOrder: asNumber(row.item_order),
    itemType: row.item_type,
    ...(row.token_count === null ? {} : { tokenCount: asNumber(row.token_count) }),
    ...(row.cache_key ? { cacheKey: row.cache_key } : {}),
    ...(row.cache_version === null ? {} : { cacheVersion: asNumber(row.cache_version) }),
    createdAtMs: asNumber(row.created_at_ms),
    updatedAtMs: asNumber(row.updated_at_ms),
  }
  if (row.item_type === "raw_message") return { ...base, itemType: "raw_message", messageRowID: row.message_row_id! }
  if (row.item_type === "summary") return { ...base, itemType: "summary", summaryID: row.summary_id! }
  if (row.item_type === "archive_stub")
    return { ...base, itemType: "archive_stub", summaryID: row.summary_id!, pointerID: row.pointer_id! }
  if (row.item_type === "large_file_marker") return { ...base, itemType: "large_file_marker", fileID: row.file_id! }
  const cuePayload = rowCuePayload(row)
  if (!cuePayload) throw invalidRequest("lcm_snapshot_cue_payload_invalid")
  if (!row.cue_lifecycle_state || !row.cue_target_source_message_id || !row.cue_generation_id) {
    throw invalidRequest("lcm_snapshot_cue_lifecycle_invalid")
  }
  return {
    ...base,
    itemType: "retrieval_cue",
    cueID: rowCueID(row),
    cuePayload,
    cueLifecycleState: row.cue_lifecycle_state,
    cueTargetSourceMessageID: row.cue_target_source_message_id,
    cueGenerationID: row.cue_generation_id,
    ...(row.cue_superseded_by_id ? { cueSupersededByID: row.cue_superseded_by_id } : {}),
    ...(row.cue_superseded_by_generation_id
      ? { cueSupersededByGenerationID: row.cue_superseded_by_generation_id }
      : {}),
  }
}

function rowToManifestItemV2(
  row: ContextRow,
  providerSafe: ProviderSafeSnapshotEvidence,
): LcmContextRestoreManifestItemV2 {
  const item = rowToManifestItem(row)
  const renderUnit = providerSafe.items.get(row.context_item_id)
  if (!renderUnit) throw invalidRequest("lcm_context_snapshot_v2_render_unit_missing")
  return {
    ...item,
    renderUnitID: renderUnit.renderUnitID,
    canonicalOrder: renderUnit.canonicalOrder,
    effectiveOrder: renderUnit.effectiveOrder,
    placementSlot: renderUnit.placementSlot,
  }
}

function fallbackProviderSafeSnapshotEvidence(rows: readonly ContextRow[]): ProviderSafeSnapshotEvidence {
  const fingerprint = rows.map((row) => ({
    contextItemID: row.context_item_id,
    itemOrder: row.item_order,
    itemType: row.item_type,
    messageRowID: row.message_row_id,
    summaryID: row.summary_id,
    pointerID: row.pointer_id,
    fileID: row.file_id,
    cueID: row.cue_id,
    cacheKey: row.cache_key,
    tokenCount: optionalNumber(row.token_count),
    updatedAtMs: asNumber(row.updated_at_ms),
  }))
  const hash = (name: string) => namespacedHash(`lcm-current-snapshot-${name}-v1`, fingerprint)
  return {
    renderInputManifest: {
      version: 1,
      rendererVersion: "lcm-current-snapshot-rebaseline-v1",
      renderPreparationVersion: "lcm-current-snapshot-rebaseline-v1",
      sourceSelectionHash: hash("source-selection"),
      requestSnapshotProtectionHash: hash("request-snapshot-protection"),
      renderUnitOrderHash: hash("render-unit-order"),
      effectivePlacementHash: hash("effective-placement"),
      protectedSpanHash: hash("protected-span"),
      providerTransformHash: hash("provider-transform"),
      providerValidatorHash: hash("provider-validator"),
      assemblyValidatorHash: hash("assembly-validator"),
      systemPromptVersion: "lcm-current-snapshot-rebaseline-v1",
      systemPromptHash: hash("system-prompt"),
      toolSchemaVersion: "lcm-current-snapshot-rebaseline-v1",
      toolSchemaHash: hash("tool-schema"),
      pluginTransformVersion: "lcm-current-snapshot-rebaseline-v1",
      pluginTransformHash: hash("plugin-transform"),
      dynamicPromptVersion: "lcm-current-snapshot-rebaseline-v1",
      dynamicPromptHash: hash("dynamic-prompt"),
      messageVisibilityVersion: "lcm-current-snapshot-rebaseline-v1",
      messageVisibilityHash: hash("message-visibility"),
      providerMediaCapability: "unknown",
      stripMedia: false,
      modelID: "lcm-current-snapshot",
      providerID: "lcm-internal",
      taskCapabilityClass: "root",
      clockPolicy: "runtime_per_preparation",
    },
    items: new Map(
      rows.map((row) => {
        const itemOrder = asNumber(row.item_order)
        return [
          row.context_item_id,
          {
            contextItemID: row.context_item_id,
            renderUnitID: namespacedHash("lcm-current-snapshot-render-unit-v1", {
              contextItemID: row.context_item_id,
              itemOrder,
              itemType: row.item_type,
            }),
            canonicalOrder: itemOrder,
            effectiveOrder: itemOrder,
            placementSlot: row.item_type === "retrieval_cue" ? "before_current_user" : "history",
          } satisfies ProviderSafeSnapshotItem,
        ]
      }),
    ),
  }
}

// Provider-safe evidence must cover the exact current row set; otherwise a
// restore manifest could claim hashes or placement from a different payload.
export async function writeContextSnapshot(input: {
  db: Queryable
  conversationID: ConversationID
  strategy?: LcmStrategy
  reason: string
  nowMs?: number
  threshold?: Pick<
    LcmThresholdDecision,
    | "activeTokens"
    | "hardLimit"
    | "softThreshold"
    | "freshTailTokens"
    | "softBacklogTokens"
    | "softBacklogItemCount"
    | "softBacklogLargestSourceTokens"
    | "freshTailRawTokens"
    | "freshTailRawItemCount"
    | "unconsumedRawTokens"
    | "unconsumedRawItemCount"
    | "protectedTailRawTokens"
    | "protectedTailRawItemCount"
    | "rawLaneTokens"
    | "rawLaneRatio"
    | "softBacklogRatio"
    | "hardFillRatio"
    | "softPressureReason"
    | "laneLatchDiagnostics"
    | "lanes"
  > & {
    tokenCounterMode?: LcmTokenCounterMode
    tokenCounterVersion?: string
    providerContextLimit?: number
    providerInputLimit?: number
    providerOutputLimit?: number
    outputReserve?: number
    budgetStatus?: LcmThresholdDecision["budgetStatus"]
    providerTransformOverheadReserveTokens?: number
  }
  providerSafe?: ProviderSafeSnapshotEvidence
}) {
  const rows = await loadContextRows(input.db, input.conversationID)
  const now = input.nowMs ?? Date.now()
  const snapshotID = await allocateSnapshotID(input.db)
  const activeTokens =
    input.threshold?.activeTokens ?? rows.reduce((total, row) => total + (optionalNumber(row.token_count) ?? 0), 0)
  const strategy = input.strategy ?? "upward"
  const hardLimit = input.threshold?.hardLimit ?? 0
  const softThreshold = input.threshold?.softThreshold ?? 0
  const freshTailTokens = input.threshold?.freshTailTokens ?? RUNTIME_DEFAULTS.performance.freshTailTokens
  const tokenCounterMode = input.threshold?.tokenCounterMode ?? LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE
  const tokenCounterVersion = input.threshold?.tokenCounterVersion ?? LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION
  const summaryMetadata = await loadSummaryMetadata(input.db, input.conversationID, rows)
  const computedSoftBacklog =
    input.threshold?.softBacklogTokens === undefined || input.threshold?.softBacklogItemCount === undefined
      ? computeSoftBacklogFromRows({
          rows,
          summaryMetadata,
          strategy,
          freshTailTokens,
        })
      : undefined
  const softBacklogTokens = input.threshold?.softBacklogTokens ?? computedSoftBacklog?.tokens ?? 0
  const softBacklogItemCount = input.threshold?.softBacklogItemCount ?? computedSoftBacklog?.itemCount ?? 0
  const softBacklogLargestSourceTokens =
    input.threshold?.softBacklogLargestSourceTokens ?? computedSoftBacklog?.largestSourceTokens ?? 0
  const freshTailRawTokens = input.threshold?.freshTailRawTokens ?? computedSoftBacklog?.freshTailTokens ?? 0
  const freshTailRawItemCount = input.threshold?.freshTailRawItemCount ?? computedSoftBacklog?.freshTailItemCount ?? 0
  const unconsumedRawTokens = input.threshold?.unconsumedRawTokens ?? computedSoftBacklog?.unconsumedTokens ?? 0
  const unconsumedRawItemCount =
    input.threshold?.unconsumedRawItemCount ?? computedSoftBacklog?.unconsumedItemCount ?? 0
  const protectedTailRawTokens =
    input.threshold?.protectedTailRawTokens ?? computedSoftBacklog?.protectedTailTokens ?? 0
  const protectedTailRawItemCount =
    input.threshold?.protectedTailRawItemCount ?? computedSoftBacklog?.protectedTailItemCount ?? 0
  const rawLaneTokens = input.threshold?.rawLaneTokens ?? softBacklogTokens + protectedTailRawTokens
  const laneCounts = tokenLaneCountsFromDecision(input.threshold) ?? laneCountsFromItems(rows)
  const budgetStatus = input.threshold?.budgetStatus ?? (input.threshold ? "budgeted" : "unavailable")
  const providerSafe = input.providerSafe ?? fallbackProviderSafeSnapshotEvidence(rows)
  const providerSafeIdentity = providerSafeIdentityFromManifest(providerSafe.renderInputManifest)
  if (providerSafe.items.size !== rows.length) {
    throw invalidRequest("lcm_context_snapshot_v2_render_unit_count_mismatch")
  }
  const manifest: LcmContextRestoreManifest = {
    schemaVersion: LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
    snapshotID,
    conversationID: input.conversationID,
    createdAtMs: now,
    strategy,
    activeTokens,
    hardLimit,
    softThreshold,
    freshTailTokens,
    softBacklogTokens,
    softBacklogItemCount,
    contextItemCount: rows.length,
    tokenCounterMode,
    tokenCounterVersion,
    ...providerSafeIdentity,
    items: rows.map((row) => rowToManifestItemV2(row, providerSafe)),
  }
  const metrics = {
    schemaVersion: "lcm-context-metrics-v2",
    reason: input.reason,
    activeTokens,
    hardLimit,
    softThreshold,
    softBacklogTokens,
    softBacklogItemCount,
    softBacklogLargestSourceTokens,
    freshTailTokens,
    freshTailRawTokens,
    freshTailRawItemCount,
    unconsumedRawTokens,
    unconsumedRawItemCount,
    protectedTailRawTokens,
    protectedTailRawItemCount,
    rawLaneTokens,
    budgetStatus,
    hardFillRatio: input.threshold?.hardFillRatio,
    rawLaneRatio: input.threshold?.rawLaneRatio,
    softBacklogRatio: input.threshold?.softBacklogRatio,
    softPressureReason: input.threshold?.softPressureReason,
    laneLatchDiagnostics: input.threshold?.laneLatchDiagnostics,
    contextItemCounts: contextItemCounts(rows),
    laneTokens: laneCounts,
    tokenCounterMode,
    tokenCounterVersion,
    providerContextLimit: input.threshold?.providerContextLimit,
    providerInputLimit: input.threshold?.providerInputLimit,
    providerOutputLimit: input.threshold?.providerOutputLimit,
    outputReserve: input.threshold?.outputReserve,
    providerTransformOverheadReserveTokens: input.threshold?.providerTransformOverheadReserveTokens,
    providerSafe: {
      schemaVersion: "lcm-provider-safe-snapshot-identity-v1",
      ...providerSafeIdentity,
      providerTransformOverheadTokenCount: providerSafe.providerTransformOverheadTokenCount ?? 0,
    },
  }

  await input.db.query(
    `
      INSERT INTO lcm_context_snapshots (
        snapshot_id,
        conversation_id,
        created_at_ms,
        strategy,
        active_tokens,
        hard_limit,
        soft_threshold,
        soft_backlog_tokens,
        soft_backlog_item_count,
        context_item_count,
        token_counter_mode,
        token_counter_version,
        lane_counts_json,
        metrics_json,
        restore_manifest_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb)
    `,
    [
      snapshotID,
      input.conversationID,
      now,
      strategy,
      activeTokens,
      hardLimit,
      softThreshold,
      softBacklogTokens,
      softBacklogItemCount,
      rows.length,
      tokenCounterMode,
      tokenCounterVersion,
      JSON.stringify(laneCounts),
      JSON.stringify(metrics),
      JSON.stringify(manifest),
    ],
  )
  return manifest
}

// Source sync normally calls this inside its transaction. New callers should
// preserve that atomicity because row appends and the derived snapshot belong together.
export async function appendRawMessageContextItems(input: {
  db: Queryable
  conversationID: ConversationID
  messageRowIDs: MessageRowID[]
  strategy?: LcmStrategy
  nowMs?: number
}) {
  if (input.messageRowIDs.length === 0) return 0
  const existing = (
    await input.db.query<{ message_row_id: MessageRowID }>(
      `
        SELECT message_row_id
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND item_type = 'raw_message'
          AND message_row_id = ANY($2::text[])
      `,
      [input.conversationID, input.messageRowIDs],
    )
  ).rows
  const existingIDs = new Set(existing.map((row) => row.message_row_id))
  const activeSummaryIDs = (
    await input.db.query<{ summary_id: SummaryID }>(
      `
        SELECT DISTINCT summary_id
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND item_type IN ('summary', 'archive_stub')
          AND summary_id IS NOT NULL
      `,
      [input.conversationID],
    )
  ).rows.map((row) => row.summary_id)
  const coveredIDs = await loadCoveredMessageRowIDsForSummaries(input.db, input.conversationID, activeSummaryIDs)
  for (const messageRowID of coveredIDs) existingIDs.add(messageRowID)
  const missing = input.messageRowIDs.filter((id) => !existingIDs.has(id))
  if (missing.length === 0) return 0

  let maxOrder = await count(
    input.db,
    "SELECT coalesce(max(item_order), 0)::int AS count FROM lcm_context_items WHERE conversation_id = $1",
    [input.conversationID],
  )
  const now = input.nowMs ?? Date.now()
  let inserted = 0
  for (const messageRowID of missing) {
    if (!(await validateRawMessageReference({ db: input.db, conversationID: input.conversationID, messageRowID }))) {
      throw missingSource("lcm_context_append_missing_source", input.conversationID)
    }
    maxOrder++
    await input.db.query(
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          message_row_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, 'raw_message', $4, $5, $5)
      `,
      [await allocateContextItemID(input.db), input.conversationID, maxOrder, messageRowID, now],
    )
    inserted++
  }

  await writeContextSnapshot({
    db: input.db,
    conversationID: input.conversationID,
    strategy: input.strategy,
    reason: "sync",
    nowMs: now,
  })
  return inserted
}

function manifestValue(value: unknown): unknown {
  return jsonValue(value)
}

function manifestItemTokenFieldsValid(item: Record<string, unknown>) {
  if (item.tokenCount !== undefined && (!Number.isInteger(item.tokenCount) || (item.tokenCount as number) < 0))
    return false
  if (item.cacheKey !== undefined && typeof item.cacheKey !== "string") return false
  if (item.cacheVersion !== undefined && !Number.isInteger(item.cacheVersion)) return false
  return true
}

function manifestItemToRow(item: LcmContextRestoreManifestItem, clearTokenCache: boolean): ContextRow {
  return {
    context_item_id: item.contextItemID,
    conversation_id: item.conversationID,
    item_order: item.itemOrder,
    item_type: item.itemType,
    message_row_id: item.itemType === "raw_message" ? item.messageRowID : null,
    summary_id: item.itemType === "summary" || item.itemType === "archive_stub" ? item.summaryID : null,
    pointer_id: item.itemType === "archive_stub" ? item.pointerID : null,
    file_id: item.itemType === "large_file_marker" ? item.fileID : null,
    cue_id: item.itemType === "retrieval_cue" ? item.cueID : null,
    cue_payload_json: item.itemType === "retrieval_cue" ? item.cuePayload : null,
    cue_lifecycle_state: item.itemType === "retrieval_cue" ? (item.cueLifecycleState ?? "active") : null,
    cue_superseded_by_id: item.itemType === "retrieval_cue" ? (item.cueSupersededByID ?? null) : null,
    cue_superseded_by_generation_id:
      item.itemType === "retrieval_cue" ? (item.cueSupersededByGenerationID ?? null) : null,
    cue_target_source_message_id:
      item.itemType === "retrieval_cue"
        ? (item.cueTargetSourceMessageID ?? `legacy_unknown_${item.contextItemID}`)
        : null,
    cue_generation_id:
      item.itemType === "retrieval_cue" ? (item.cueGenerationID ?? `cuegen_legacy_${item.contextItemID}`) : null,
    token_count: clearTokenCache ? null : (item.tokenCount ?? null),
    cache_key: clearTokenCache ? null : (item.cacheKey ?? null),
    cache_version: clearTokenCache ? null : (item.cacheVersion ?? null),
    created_at_ms: item.createdAtMs,
    updated_at_ms: item.updatedAtMs,
  }
}

function parseManifestItem(value: unknown, conversationID: ConversationID): LcmContextRestoreManifestItem | undefined {
  if (!isObject(value)) return undefined
  if (
    typeof value.contextItemID !== "string" ||
    value.conversationID !== conversationID ||
    typeof value.itemOrder !== "number" ||
    !Number.isInteger(value.itemOrder) ||
    value.itemOrder <= 0 ||
    typeof value.itemType !== "string" ||
    !Number.isInteger(value.createdAtMs) ||
    !Number.isInteger(value.updatedAtMs) ||
    !manifestItemTokenFieldsValid(value)
  ) {
    return undefined
  }
  const itemOrder = value.itemOrder as number
  const createdAtMs = value.createdAtMs as number
  const updatedAtMs = value.updatedAtMs as number
  const base = {
    contextItemID: value.contextItemID as ContextItemID,
    conversationID,
    itemOrder,
    itemType: value.itemType as ContextItemType,
    ...(value.tokenCount === undefined ? {} : { tokenCount: value.tokenCount as number }),
    ...(value.cacheKey === undefined ? {} : { cacheKey: value.cacheKey as string }),
    ...(value.cacheVersion === undefined ? {} : { cacheVersion: value.cacheVersion as number }),
    createdAtMs,
    updatedAtMs,
  }

  if (value.itemType === "raw_message" && typeof value.messageRowID === "string") {
    return { ...base, itemType: "raw_message", messageRowID: value.messageRowID as MessageRowID }
  }
  if (value.itemType === "summary" && typeof value.summaryID === "string") {
    return { ...base, itemType: "summary", summaryID: value.summaryID as SummaryID }
  }
  if (value.itemType === "archive_stub" && typeof value.summaryID === "string" && typeof value.pointerID === "string") {
    return { ...base, itemType: "archive_stub", summaryID: value.summaryID as SummaryID, pointerID: value.pointerID }
  }
  if (value.itemType === "large_file_marker" && typeof value.fileID === "string") {
    return { ...base, itemType: "large_file_marker", fileID: value.fileID as LcmFileID }
  }
  if (
    value.itemType === "retrieval_cue" &&
    typeof value.cueID === "string" &&
    isRetrievalCuePayload(value.cuePayload)
  ) {
    if (
      value.cueLifecycleState !== undefined &&
      !["active", "superseded", "tombstoned"].includes(String(value.cueLifecycleState))
    ) {
      return undefined
    }
    if (value.cueTargetSourceMessageID !== undefined && typeof value.cueTargetSourceMessageID !== "string")
      return undefined
    if (value.cueGenerationID !== undefined && typeof value.cueGenerationID !== "string") return undefined
    if (value.cueSupersededByID !== undefined && typeof value.cueSupersededByID !== "string") return undefined
    if (value.cueSupersededByGenerationID !== undefined && typeof value.cueSupersededByGenerationID !== "string") {
      return undefined
    }
    return {
      ...base,
      itemType: "retrieval_cue",
      cueID: value.cueID,
      cuePayload: value.cuePayload,
      ...(value.cueLifecycleState === undefined
        ? {}
        : { cueLifecycleState: value.cueLifecycleState as LcmRetrievalCueLifecycleState }),
      ...(value.cueTargetSourceMessageID === undefined
        ? {}
        : { cueTargetSourceMessageID: value.cueTargetSourceMessageID }),
      ...(value.cueGenerationID === undefined ? {} : { cueGenerationID: value.cueGenerationID }),
      ...(value.cueSupersededByID === undefined ? {} : { cueSupersededByID: value.cueSupersededByID }),
      ...(value.cueSupersededByGenerationID === undefined
        ? {}
        : { cueSupersededByGenerationID: value.cueSupersededByGenerationID }),
    }
  }
  return undefined
}

function parseManifestItemV2(
  value: unknown,
  conversationID: ConversationID,
): LcmContextRestoreManifestItemV2 | undefined {
  const item = parseManifestItem(value, conversationID)
  if (!item || !isObject(value)) return undefined
  const canonicalOrder = value.canonicalOrder
  const effectiveOrder = value.effectiveOrder
  const placementSlot = value.placementSlot
  if (
    typeof value.renderUnitID !== "string" ||
    value.renderUnitID.length === 0 ||
    typeof canonicalOrder !== "number" ||
    typeof effectiveOrder !== "number" ||
    !Number.isInteger(canonicalOrder) ||
    !Number.isInteger(effectiveOrder) ||
    canonicalOrder <= 0 ||
    effectiveOrder <= 0 ||
    !["history", "before_current_user", "current_user", "after_current_user", "provider_tail"].includes(
      String(placementSlot),
    )
  ) {
    return undefined
  }
  return {
    ...item,
    renderUnitID: value.renderUnitID,
    canonicalOrder,
    effectiveOrder,
    placementSlot: placementSlot as LcmAssemblyPlacementSlot,
  }
}

function parseProviderSafeMetrics(snapshot: SnapshotRow) {
  const metrics = jsonValue(snapshot.metrics_json)
  if (!isObject(metrics)) return undefined
  const providerSafe = jsonValue(metrics.providerSafe)
  if (!isObject(providerSafe) || providerSafe.schemaVersion !== "lcm-provider-safe-snapshot-identity-v1")
    return undefined
  const identity = {
    renderUnitOrderHash: providerSafe.renderUnitOrderHash,
    effectivePlacementHash: providerSafe.effectivePlacementHash,
    sourceSelectionHash: providerSafe.sourceSelectionHash,
    requestSnapshotProtectionHash: providerSafe.requestSnapshotProtectionHash,
    visibilityHash: providerSafe.visibilityHash,
    protectedSpanHash: providerSafe.protectedSpanHash,
    providerTransformHash: providerSafe.providerTransformHash,
    providerValidatorHash: providerSafe.providerValidatorHash,
    assemblyValidatorHash: providerSafe.assemblyValidatorHash,
  }
  return Object.values(identity).every((value) => typeof value === "string" && value.length > 0) ? identity : undefined
}

function providerSafeManifestMatchesMetrics(manifest: LcmContextRestoreManifestV2, snapshot: SnapshotRow) {
  const metrics = parseProviderSafeMetrics(snapshot)
  if (!metrics) return false
  const identity = {
    renderUnitOrderHash: manifest.renderUnitOrderHash,
    effectivePlacementHash: manifest.effectivePlacementHash,
    sourceSelectionHash: manifest.sourceSelectionHash,
    requestSnapshotProtectionHash: manifest.requestSnapshotProtectionHash,
    visibilityHash: manifest.visibilityHash,
    protectedSpanHash: manifest.protectedSpanHash,
    providerTransformHash: manifest.providerTransformHash,
    providerValidatorHash: manifest.providerValidatorHash,
    assemblyValidatorHash: manifest.assemblyValidatorHash,
  }
  return (Object.keys(identity) as (keyof typeof identity)[]).every((key) => identity[key] === metrics[key])
}

function parseAndValidateManifest(snapshot: SnapshotRow): LcmContextRestoreManifest | undefined {
  const manifest = manifestValue(snapshot.restore_manifest_json)
  if (!isObject(manifest)) return undefined
  const snapshotSoftBacklogTokens = optionalNumber(snapshot.soft_backlog_tokens)
  const snapshotSoftBacklogItemCount = optionalNumber(snapshot.soft_backlog_item_count)
  if (
    manifest.snapshotID !== snapshot.snapshot_id ||
    manifest.conversationID !== snapshot.conversation_id ||
    manifest.createdAtMs !== asNumber(snapshot.created_at_ms) ||
    manifest.strategy !== snapshot.strategy ||
    manifest.activeTokens !== asNumber(snapshot.active_tokens) ||
    manifest.hardLimit !== asNumber(snapshot.hard_limit) ||
    manifest.softThreshold !== asNumber(snapshot.soft_threshold) ||
    typeof manifest.freshTailTokens !== "number" ||
    !Number.isInteger(manifest.freshTailTokens) ||
    manifest.freshTailTokens <= 0 ||
    manifest.contextItemCount !== asNumber(snapshot.context_item_count) ||
    manifest.tokenCounterMode !== snapshot.token_counter_mode ||
    manifest.tokenCounterVersion !== snapshot.token_counter_version ||
    !Array.isArray(manifest.items) ||
    manifest.items.length !== asNumber(snapshot.context_item_count) ||
    manifest.schemaVersion !== LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION
  ) {
    return undefined
  }
  if (
    snapshotSoftBacklogTokens === undefined ||
    snapshotSoftBacklogItemCount === undefined ||
    manifest.softBacklogTokens !== snapshotSoftBacklogTokens ||
    manifest.softBacklogItemCount !== snapshotSoftBacklogItemCount
  ) {
    return undefined
  }

  const orders = new Set<number>()
  const ids = new Set<string>()
  const v2Items: LcmContextRestoreManifestItemV2[] = []
  for (const value of manifest.items) {
    const item = parseManifestItemV2(value, snapshot.conversation_id)
    if (!item) return undefined
    if (orders.has(item.itemOrder) || ids.has(item.contextItemID)) return undefined
    orders.add(item.itemOrder)
    ids.add(item.contextItemID)
    v2Items.push(item)
  }
  v2Items.sort((left, right) => left.itemOrder - right.itemOrder)
  for (let index = 0; index < v2Items.length; index++) {
    if (v2Items[index]!.itemOrder !== index + 1) return undefined
  }

  const base = {
    snapshotID: snapshot.snapshot_id,
    conversationID: snapshot.conversation_id,
    createdAtMs: asNumber(snapshot.created_at_ms),
    strategy: snapshot.strategy,
    activeTokens: asNumber(snapshot.active_tokens),
    hardLimit: asNumber(snapshot.hard_limit),
    softThreshold: asNumber(snapshot.soft_threshold),
    freshTailTokens: manifest.freshTailTokens,
    ...(snapshotSoftBacklogTokens === undefined ? {} : { softBacklogTokens: snapshotSoftBacklogTokens }),
    ...(snapshotSoftBacklogItemCount === undefined ? {} : { softBacklogItemCount: snapshotSoftBacklogItemCount }),
    contextItemCount: asNumber(snapshot.context_item_count),
    tokenCounterMode: snapshot.token_counter_mode,
    tokenCounterVersion: snapshot.token_counter_version,
  }

  const providerSafeFields = {
    renderUnitOrderHash: manifest.renderUnitOrderHash,
    effectivePlacementHash: manifest.effectivePlacementHash,
    sourceSelectionHash: manifest.sourceSelectionHash,
    requestSnapshotProtectionHash: manifest.requestSnapshotProtectionHash,
    visibilityHash: manifest.visibilityHash,
    protectedSpanHash: manifest.protectedSpanHash,
    providerTransformHash: manifest.providerTransformHash,
    providerValidatorHash: manifest.providerValidatorHash,
    assemblyValidatorHash: manifest.assemblyValidatorHash,
  }
  if (!Object.values(providerSafeFields).every((value) => typeof value === "string" && value.length > 0))
    return undefined
  const typedProviderSafeFields = providerSafeFields as {
    renderUnitOrderHash: string
    effectivePlacementHash: string
    sourceSelectionHash: string
    requestSnapshotProtectionHash: string
    visibilityHash: string
    protectedSpanHash: string
    providerTransformHash: string
    providerValidatorHash: string
    assemblyValidatorHash: string
  }
  const v2 = {
    ...base,
    schemaVersion: LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION,
    softBacklogTokens: snapshotSoftBacklogTokens!,
    softBacklogItemCount: snapshotSoftBacklogItemCount!,
    ...typedProviderSafeFields,
    items: v2Items,
  } satisfies LcmContextRestoreManifestV2
  if (!providerSafeManifestMatchesMetrics(v2, snapshot)) return undefined
  return v2
}

function restoreCanKeepTokenCache(manifest: LcmContextRestoreManifest) {
  if (manifest.schemaVersion !== LCM_CONTEXT_RESTORE_MANIFEST_V2_VERSION) return false
  const hasFinalProviderValidator = manifest.providerValidatorHash.startsWith(`${LCM_PROVIDER_VALIDATOR_NAMESPACE}:`)
  return (
    manifest.tokenCounterMode === LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_MODE &&
    manifest.tokenCounterVersion === LCM_CONTEXT_DEFAULT_TOKEN_COUNTER_VERSION &&
    hasFinalProviderValidator
  )
}

export async function insertContextRow(db: Queryable, row: ContextRow) {
  await db.query(
    `
      INSERT INTO lcm_context_items (
        context_item_id,
        conversation_id,
        item_order,
        item_type,
        message_row_id,
        summary_id,
        pointer_id,
        file_id,
        cue_id,
        cue_payload_json,
        cue_lifecycle_state,
        cue_superseded_by_id,
        cue_superseded_by_generation_id,
        cue_target_source_message_id,
        cue_generation_id,
        token_count,
        cache_key,
        cache_version,
        created_at_ms,
        updated_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10::jsonb, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20
      )
    `,
    [
      row.context_item_id,
      row.conversation_id,
      asNumber(row.item_order),
      row.item_type,
      row.message_row_id,
      row.summary_id,
      row.pointer_id,
      row.file_id,
      row.cue_id ?? null,
      row.cue_payload_json === null ? null : JSON.stringify(row.cue_payload_json),
      row.cue_lifecycle_state ?? null,
      row.cue_superseded_by_id ?? null,
      row.cue_superseded_by_generation_id ?? null,
      row.cue_target_source_message_id ?? null,
      row.cue_generation_id ?? null,
      row.token_count,
      row.cache_key,
      row.cache_version,
      asNumber(row.created_at_ms),
      asNumber(row.updated_at_ms),
    ],
  )
}

// Snapshot restore is all-or-nothing per manifest. Changes to eligibility must
// also prove the snapshot still covers the current durable source/summary roots.
export async function restoreFromSnapshots(input: {
  db: Transactional
  conversationID: ConversationID
  strategy: LcmStrategy
  reason: string
  artifactRoot?: string
}) {
  const snapshots = (
    await input.db.query<SnapshotRow>(
      `
        SELECT *
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
        ORDER BY created_at_ms DESC, snapshot_id DESC
      `,
      [input.conversationID],
    )
  ).rows

  for (const snapshot of snapshots) {
    const manifest = parseAndValidateManifest(snapshot)
    if (!manifest) continue
    const clearTokenCache = !restoreCanKeepTokenCache(manifest)
    const rows = manifest.items.map((item) => manifestItemToRow(item, clearTokenCache))
    const validation = await validateContextRows({
      db: input.db,
      conversationID: input.conversationID,
      rows,
      allowEmpty: true,
      artifactRoot: input.artifactRoot,
    })
    if (!validation.ok) continue
    if (
      !(await validateDurableContextCompleteness({
        db: input.db,
        conversationID: input.conversationID,
        rows,
        artifactRoot: input.artifactRoot,
      }))
    ) {
      continue
    }

    await input.db.transaction(async (tx) => {
      await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
      for (const row of rows) await insertContextRow(tx, row)
    })
    return { restored: true, count: rows.length }
  }

  return { restored: false, count: 0 }
}

async function existingOrderMap(db: Queryable, conversationID: ConversationID) {
  const rows = await loadContextRows(db, conversationID)
  const byKey = new Map<string, number>()
  for (const row of rows) {
    if (row.item_type === "raw_message" && row.message_row_id)
      byKey.set(`raw:${row.message_row_id}`, asNumber(row.item_order))
    if (row.item_type === "summary" && row.summary_id) byKey.set(`summary:${row.summary_id}`, asNumber(row.item_order))
    if (row.item_type === "archive_stub" && row.summary_id && row.pointer_id)
      byKey.set(`archive:${row.summary_id}:${row.pointer_id}`, asNumber(row.item_order))
    if (row.item_type === "large_file_marker" && row.file_id) byKey.set(`file:${row.file_id}`, asNumber(row.item_order))
  }
  return byKey
}

type DurableContextCandidatesResult =
  | { readonly ok: true; readonly candidates: ContextCandidate[] }
  | { readonly ok: false; readonly safeError: LcmSafeError }

function contextCandidateKey(candidate: ContextCandidate) {
  if (candidate.itemType === "raw_message") return `raw:${candidate.messageRowID}`
  if (candidate.itemType === "summary") return `summary:${candidate.summaryID}`
  if (candidate.itemType === "archive_stub") return `archive:${candidate.summaryID}:${candidate.pointerID}`
  if (candidate.itemType === "large_file_marker") return `file:${candidate.fileID}`
  return undefined
}

function contextRowDurableKey(row: ContextRow) {
  if (row.item_type === "raw_message" && row.message_row_id) return `raw:${row.message_row_id}`
  if (row.item_type === "summary" && row.summary_id) return `summary:${row.summary_id}`
  if (row.item_type === "archive_stub" && row.summary_id && row.pointer_id)
    return `archive:${row.summary_id}:${row.pointer_id}`
  if (row.item_type === "large_file_marker" && row.file_id) return `file:${row.file_id}`
  return undefined
}

function sortDurableContextCandidates(candidates: ContextCandidate[]) {
  candidates.sort((left, right) => {
    if (left.originalOrder !== right.originalOrder) return left.originalOrder - right.originalOrder
    const leftGroup =
      left.itemType === "summary"
        ? 1
        : left.itemType === "archive_stub"
          ? 2
          : left.itemType === "large_file_marker"
            ? 3
            : 4
    const rightGroup =
      right.itemType === "summary"
        ? 1
        : right.itemType === "archive_stub"
          ? 2
          : right.itemType === "large_file_marker"
            ? 3
            : 4
    return leftGroup - rightGroup || left.createdAtMs - right.createdAtMs || left.stableID.localeCompare(right.stableID)
  })
}

async function loadDurableContextCandidates(input: {
  db: Queryable
  conversationID: ConversationID
  originalOrders: ReadonlyMap<string, number>
  artifactRoot?: string
}): Promise<DurableContextCandidatesResult> {
  const candidates: ContextCandidate[] = []
  const summaryRoots = (
    await input.db.query<{ summary_id: SummaryID; created_at_ms: number | string | bigint }>(
      `
        SELECT summary.summary_id, summary.created_at_ms
        FROM lcm_summaries summary
        WHERE summary.conversation_id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM lcm_summary_parents edge
            JOIN lcm_summaries condensed
              ON condensed.summary_id = edge.summary_id
             AND condensed.conversation_id = summary.conversation_id
            WHERE edge.parent_summary_id = summary.summary_id
          )
        ORDER BY summary.created_at_ms, summary.summary_id
      `,
      [input.conversationID],
    )
  ).rows
  const summaryCount = await count(
    input.db,
    "SELECT count(*)::int AS count FROM lcm_summaries WHERE conversation_id = $1",
    [input.conversationID],
  )
  if (summaryCount > 0 && summaryRoots.length === 0) {
    return {
      ok: false,
      safeError: recoveryRequired("lcm_context_rebuild_summary_roots_missing", input.conversationID),
    }
  }
  const validRoots: typeof summaryRoots = []
  for (const summary of summaryRoots) {
    if (await validateSummaryReference(input.db, input.conversationID, summary.summary_id)) validRoots.push(summary)
  }
  if (validRoots.length !== summaryRoots.length) {
    return {
      ok: false,
      safeError: recoveryRequired("lcm_context_rebuild_summary_roots_invalid", input.conversationID),
    }
  }
  if (
    !(await validateSummaryLineageProjection({
      db: input.db,
      conversationID: input.conversationID,
      rootSummaryIDs: validRoots.map((summary) => summary.summary_id),
    }))
  ) {
    return {
      ok: false,
      safeError: recoveryRequired("lcm_context_rebuild_summary_lineage_invalid", input.conversationID),
    }
  }
  const rootIDs = validRoots.map((summary) => summary.summary_id)
  const rootChronology = await loadSummaryRootChronology(input.db, input.conversationID, rootIDs)
  const archives =
    rootIDs.length === 0
      ? []
      : (
          await input.db.query<{
            summary_id: SummaryID
            pointer_id: string
            created_at_ms: number | string | bigint
          }>(
            `
              SELECT DISTINCT ON (pointer.summary_id)
                     pointer.summary_id, pointer.pointer_id, pointer.created_at_ms
              FROM lcm_summary_lineage_pointers pointer
              WHERE pointer.conversation_id = $1
                AND pointer.pointer_kind = 'archive_stub'
                AND pointer.summary_id = ANY($2::text[])
              ORDER BY pointer.summary_id, pointer.created_at_ms DESC, pointer.pointer_id DESC
            `,
            [input.conversationID, rootIDs],
          )
        ).rows
  const archiveBySummary = new Map(archives.map((archive) => [archive.summary_id, archive] as const))
  for (const summary of validRoots) {
    const archive = archiveBySummary.get(summary.summary_id)
    if (archive) {
      candidates.push({
        itemType: "archive_stub",
        summaryID: summary.summary_id,
        pointerID: archive.pointer_id,
        originalOrder:
          input.originalOrders.get(`archive:${summary.summary_id}:${archive.pointer_id}`) ??
          rootChronology.get(summary.summary_id) ??
          Number.POSITIVE_INFINITY,
        createdAtMs: asNumber(archive.created_at_ms),
        stableID: `${summary.summary_id}:${archive.pointer_id}`,
      })
      continue
    }
    candidates.push({
      itemType: "summary",
      summaryID: summary.summary_id,
      originalOrder:
        input.originalOrders.get(`summary:${summary.summary_id}`) ??
        rootChronology.get(summary.summary_id) ??
        Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(summary.created_at_ms),
      stableID: summary.summary_id,
    })
  }

  const coveredMessages = await loadCoveredMessageRowIDsForSummaries(input.db, input.conversationID, rootIDs)
  const fileRows = (
    await input.db.query<{ file_id: LcmFileID; created_at_ms: number | string | bigint }>(
      `
        SELECT file.file_id, file.created_at_ms
        FROM lcm_large_files file
        WHERE file.conversation_id = $1
          AND file.source_kind IN ('path', 'inline', 'image')
          AND NOT EXISTS (
            SELECT 1
            FROM lcm_message_parts part
            WHERE part.conversation_id = file.conversation_id
              AND part.content_file_id = file.file_id
          )
        ORDER BY file.created_at_ms, file.file_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const fileRow of fileRows) {
    const validation = await validateFileReference({
      db: input.db,
      conversationID: input.conversationID,
      fileID: fileRow.file_id,
      artifactRoot: input.artifactRoot,
    })
    if (!validation.ok) {
      return {
        ok: false,
        safeError: staleFile(`lcm_context_rebuild_${validation.reason ?? "artifact_invalid"}`, fileRow.file_id),
      }
    }
    candidates.push({
      itemType: "large_file_marker",
      fileID: fileRow.file_id,
      originalOrder: input.originalOrders.get(`file:${fileRow.file_id}`) ?? Number.POSITIVE_INFINITY,
      createdAtMs: asNumber(fileRow.created_at_ms),
      stableID: fileRow.file_id,
    })
  }

  const messages = (
    await input.db.query<{
      message_row_id: MessageRowID
      message_order: number | string | bigint
      created_at_ms: number | string | bigint
    }>(
      `
        SELECT message_row_id, message_order, created_at_ms
        FROM lcm_messages message
        WHERE conversation_id = $1
          AND EXISTS (
            SELECT 1
            FROM lcm_message_parts part
            WHERE part.conversation_id = message.conversation_id
              AND part.message_row_id = message.message_row_id
          )
        ORDER BY message_order, message_row_id
      `,
      [input.conversationID],
    )
  ).rows
  for (const message of messages) {
    if (coveredMessages.has(message.message_row_id)) continue
    if (
      !(await validateRawMessageReference({
        db: input.db,
        conversationID: input.conversationID,
        messageRowID: message.message_row_id,
        artifactRoot: input.artifactRoot,
      }))
    ) {
      return {
        ok: false,
        safeError: missingSource("lcm_context_rebuild_missing_message_part", input.conversationID),
      }
    }
    candidates.push({
      itemType: "raw_message",
      messageRowID: message.message_row_id,
      originalOrder: input.originalOrders.get(`raw:${message.message_row_id}`) ?? asNumber(message.message_order),
      createdAtMs: asNumber(message.created_at_ms),
      stableID: message.message_row_id,
    })
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      safeError: missingSource("lcm_context_rebuild_no_provable_source", input.conversationID),
    }
  }
  sortDurableContextCandidates(candidates)
  return { ok: true, candidates }
}

export async function validateDurableContextCompleteness(input: {
  db: Queryable
  conversationID: ConversationID
  rows: readonly ContextRow[]
  artifactRoot?: string
}) {
  const projection = await loadDurableContextCandidates({
    db: input.db,
    conversationID: input.conversationID,
    originalOrders: new Map(),
    artifactRoot: input.artifactRoot,
  })
  if (!projection.ok) return false
  const expected = projection.candidates.flatMap((candidate) => {
    const key = contextCandidateKey(candidate)
    return key ? [key] : []
  })
  const actual = input.rows.flatMap((row) => {
    const key = contextRowDurableKey(row)
    return key ? [key] : []
  })
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length) return false
  const actualSet = new Set(actual)
  return expected.length === actual.length && expected.every((key) => actualSet.has(key))
}

export async function durableRebuild(input: {
  db: Transactional
  conversationID: ConversationID
  strategy: LcmStrategy
  reason: string
  artifactRoot?: string
}): Promise<LcmRecoveryResult> {
  const originalOrders = await existingOrderMap(input.db, input.conversationID)
  const projection = await loadDurableContextCandidates({
    db: input.db,
    conversationID: input.conversationID,
    originalOrders,
    artifactRoot: input.artifactRoot,
  })
  if (!projection.ok) {
    return {
      conversationID: input.conversationID,
      status: "failed",
      itemsRebuilt: 0,
      lifecycleState: "recovery_failed",
      safeError: projection.safeError,
    }
  }
  const candidates = projection.candidates

  await input.db.transaction(async (tx) => {
    const now = Date.now()
    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [input.conversationID])
    for (const [index, candidate] of candidates.entries()) {
      const row: ContextRow = {
        context_item_id: await allocateContextItemID(tx),
        conversation_id: input.conversationID,
        item_order: index + 1,
        item_type: candidate.itemType,
        message_row_id: candidate.messageRowID ?? null,
        summary_id: candidate.summaryID ?? null,
        pointer_id: candidate.pointerID ?? null,
        file_id: candidate.fileID ?? null,
        cue_payload_json: candidate.cuePayload ?? null,
        token_count: null,
        cache_key: null,
        cache_version: null,
        created_at_ms: now,
        updated_at_ms: now,
      }
      await insertContextRow(tx, row)
    }
    await writeContextSnapshot({
      db: tx,
      conversationID: input.conversationID,
      strategy: input.strategy,
      reason: input.reason,
      nowMs: now,
    })
  })

  return {
    conversationID: input.conversationID,
    status: "rebuilt",
    itemsRebuilt: candidates.length,
    lifecycleState: "passive_synced",
  }
}
