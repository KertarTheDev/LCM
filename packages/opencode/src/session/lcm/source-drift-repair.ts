// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { isLcmSafeError } from "./db-errors"
import { createLcmSafeError, type ConversationID, type LcmSafeError } from "./types"

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

function sourceDrift(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "recovery_required",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode,
  })
}

export function isSourceDriftError(error: unknown): error is LcmSafeError {
  return (
    isLcmSafeError(error) &&
    error.code === "recovery_required" &&
    typeof error.diagnosticCode === "string" &&
    error.diagnosticCode.startsWith("lcm_source_drift_")
  )
}

async function canAutoRebuildAfterSourceDrift(db: Queryable, conversationID: ConversationID) {
  const rows = (
    await db.query<{
      child_conversations: number | string | bigint
      map_runs: number | string | bigint
      in_flight_snapshots: number | string | bigint
      large_files: number | string | bigint
      large_file_markers: number | string | bigint
    }>(
      `
        SELECT
          (SELECT count(*) FROM lcm_conversations WHERE parent_conversation_id = $1)::int AS child_conversations,
          (SELECT count(*) FROM lcm_map_runs WHERE conversation_id = $1)::int AS map_runs,
          (
            SELECT count(*)
            FROM lcm_provider_request_snapshots
            WHERE conversation_id = $1 AND status = 'in_flight'
          )::int AS in_flight_snapshots,
          (SELECT count(*) FROM lcm_large_files WHERE conversation_id = $1)::int AS large_files,
          (
            SELECT count(*)
            FROM lcm_context_items
            WHERE conversation_id = $1 AND item_type = 'large_file_marker'
          )::int AS large_file_markers
      `,
      [conversationID],
    )
  ).rows[0]
  return (
    Number(rows?.child_conversations ?? 0) === 0 &&
    Number(rows?.map_runs ?? 0) === 0 &&
    Number(rows?.in_flight_snapshots ?? 0) === 0 &&
    Number(rows?.large_files ?? 0) === 0 &&
    Number(rows?.large_file_markers ?? 0) === 0
  )
}

export async function resetConversationSourceAfterDrift(db: PGlite, conversationID: ConversationID) {
  await db.transaction(async (tx) => {
    const rebuildable = await canAutoRebuildAfterSourceDrift(tx, conversationID)
    if (!rebuildable) throw sourceDrift("lcm_source_drift_rebuild_blocked")
    const summaryIDs = (
      await tx.query<{ summary_id: string }>("SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1", [
        conversationID,
      ])
    ).rows.map((row) => row.summary_id)

    await tx.query("DELETE FROM lcm_deferred_jobs WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_provider_request_snapshots WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_context_snapshots WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_id_aliases WHERE conversation_id = $1", [conversationID])

    if (summaryIDs.length > 0) {
      const placeholders = summaryIDs.map((_, index) => `$${index + 1}`).join(",")
      await tx.query(
        `DELETE FROM lcm_summary_lineage_pointers WHERE summary_id IN (${placeholders}) OR root_summary_id IN (${placeholders})`,
        summaryIDs,
      )
      await tx.query(
        `DELETE FROM lcm_summary_parents WHERE summary_id IN (${placeholders}) OR parent_summary_id IN (${placeholders})`,
        summaryIDs,
      )
      await tx.query(`DELETE FROM lcm_summary_messages WHERE summary_id IN (${placeholders})`, summaryIDs)
    }

    await tx.query("DELETE FROM lcm_summaries WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_message_parts WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_messages WHERE conversation_id = $1", [conversationID])
    await tx.query("DELETE FROM lcm_large_files WHERE conversation_id = $1", [conversationID])
    await tx.query(
      `
        UPDATE lcm_conversations
        SET updated_at_ms = $2,
            last_error_code = NULL,
            last_safe_message = NULL
        WHERE conversation_id = $1
      `,
      [conversationID, Date.now()],
    )
  })
}
