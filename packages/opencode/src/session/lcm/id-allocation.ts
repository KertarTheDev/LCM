// kilocode_change - new file
import { randomBytes } from "node:crypto"
import { createOperationID } from "./id"
import { createLcmSafeError, type ContextItemID, type SummaryID } from "./types"

export interface LcmIdAllocationQueryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export type LcmUsageRecordID = `usage_${string}`
export type LcmSummaryLineagePointerID = `ptr_${string}`
export type LcmContextSnapshotID = `snapshot_${string}`

function pending(diagnosticCode: string) {
  return createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: false },
    retryable: false,
    diagnosticCode,
  })
}

function countValue(value: number | string | bigint | null | undefined) {
  return Number(value ?? 0)
}

async function count(db: LcmIdAllocationQueryable, sql: string, params: unknown[]) {
  const row = (await db.query<{ count: number | string | bigint }>(sql, params)).rows[0]
  return countValue(row?.count)
}

export async function allocateContextItemID(db: LcmIdAllocationQueryable): Promise<ContextItemID> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = `ctx_${createOperationID().slice(3)}` as ContextItemID
    const exists = await count(db, "SELECT count(*)::int AS count FROM lcm_context_items WHERE context_item_id = $1", [
      id,
    ])
    if (exists === 0) return id
  }
  throw pending("lcm_context_item_id_collision_exhausted")
}

export async function allocateSummaryID(db: LcmIdAllocationQueryable): Promise<SummaryID> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = `sum_${createOperationID().slice(3)}` as SummaryID
    const exists = await count(db, "SELECT count(*)::int AS count FROM lcm_summaries WHERE summary_id = $1", [id])
    if (exists === 0) return id
  }
  throw pending("lcm_summary_id_collision_exhausted")
}

export async function allocateUsageRecordID(db: LcmIdAllocationQueryable): Promise<LcmUsageRecordID> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = `usage_${createOperationID().slice(3)}` as LcmUsageRecordID
    const exists = await count(db, "SELECT count(*)::int AS count FROM lcm_usage_records WHERE usage_record_id = $1", [
      id,
    ])
    if (exists === 0) return id
  }
  throw pending("lcm_usage_record_id_collision_exhausted")
}

export async function allocateSummaryLineagePointerID(
  db: LcmIdAllocationQueryable,
): Promise<LcmSummaryLineagePointerID> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = `ptr_${randomBytes(16).toString("hex")}` as LcmSummaryLineagePointerID
    const exists = await count(
      db,
      "SELECT count(*)::int AS count FROM lcm_summary_lineage_pointers WHERE pointer_id = $1",
      [id],
    )
    if (exists === 0) return id
  }
  throw pending("lcm_summary_lineage_pointer_id_collision_exhausted")
}

export async function allocateSnapshotID(db: LcmIdAllocationQueryable): Promise<LcmContextSnapshotID> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = `snapshot_${createOperationID().slice(3)}` as LcmContextSnapshotID
    const exists = await count(db, "SELECT count(*)::int AS count FROM lcm_context_snapshots WHERE snapshot_id = $1", [
      id,
    ])
    if (exists === 0) return id
  }
  throw pending("lcm_context_snapshot_id_collision_exhausted")
}
