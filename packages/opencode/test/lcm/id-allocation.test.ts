// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import {
  allocateContextItemID,
  allocateSnapshotID,
  allocateSummaryID,
  allocateSummaryLineagePointerID,
  allocateUsageRecordID,
  type LcmIdAllocationQueryable,
} from "../../src/session/lcm/id-allocation"

function fakeDb(counts: Array<number | string | bigint>) {
  const queries: Array<{ sql: string; params?: unknown[] }> = []
  const db: LcmIdAllocationQueryable = {
    async query<T>(sql: string, params?: unknown[]) {
      queries.push({ sql, params })
      const count = counts.shift() ?? 0
      return { rows: [{ count } as T] }
    },
  }
  return { db, queries }
}

describe("LCM id allocation", () => {
  test("allocates prefixed IDs after proving table uniqueness", async () => {
    const context = fakeDb([0])
    expect((await allocateContextItemID(context.db)).startsWith("ctx_")).toBe(true)
    expect(context.queries[0]?.sql).toContain("lcm_context_items")

    const summary = fakeDb([0])
    expect((await allocateSummaryID(summary.db)).startsWith("sum_")).toBe(true)
    expect(summary.queries[0]?.sql).toContain("lcm_summaries")

    const usage = fakeDb([0])
    expect((await allocateUsageRecordID(usage.db)).startsWith("usage_")).toBe(true)
    expect(usage.queries[0]?.sql).toContain("lcm_usage_records")

    const pointer = fakeDb([0])
    expect(await allocateSummaryLineagePointerID(pointer.db)).toMatch(/^ptr_[0-9a-f]{32}$/)
    expect(pointer.queries[0]?.sql).toContain("lcm_summary_lineage_pointers")

    const snapshot = fakeDb([0])
    expect((await allocateSnapshotID(snapshot.db)).startsWith("snapshot_")).toBe(true)
    expect(snapshot.queries[0]?.sql).toContain("lcm_context_snapshots")
  })

  test("returns content-safe DB errors after bounded collision retries", async () => {
    await expect(allocateContextItemID(fakeDb([1, 1, 1]).db)).rejects.toMatchObject({
      code: "db_unavailable",
      diagnosticCode: "lcm_context_item_id_collision_exhausted",
    })

    await expect(allocateSummaryID(fakeDb([1, 1, 1]).db)).rejects.toMatchObject({
      code: "db_unavailable",
      diagnosticCode: "lcm_summary_id_collision_exhausted",
    })

    await expect(allocateUsageRecordID(fakeDb([1, 1, 1]).db)).rejects.toMatchObject({
      code: "db_unavailable",
      diagnosticCode: "lcm_usage_record_id_collision_exhausted",
    })

    await expect(allocateSummaryLineagePointerID(fakeDb([1, 1, 1]).db)).rejects.toMatchObject({
      code: "db_unavailable",
      diagnosticCode: "lcm_summary_lineage_pointer_id_collision_exhausted",
    })

    await expect(allocateSnapshotID(fakeDb([1, 1, 1]).db)).rejects.toMatchObject({
      code: "db_unavailable",
      diagnosticCode: "lcm_context_snapshot_id_collision_exhausted",
    })
  })
})
