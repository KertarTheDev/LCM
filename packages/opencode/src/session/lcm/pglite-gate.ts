// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"

export interface LcmPGliteGateScale {
  readonly messageParts: number
  readonly summaries: number
  readonly largeFiles: number
  readonly mapItems: number
}

export interface LcmPGliteGateProbeResult {
  readonly requiredIndexesPresent: boolean
  readonly literalSearchPassed: boolean
  readonly regexSearchPassed: boolean
  readonly summarySearchPassed: boolean
  readonly largeFileLookupPassed: boolean
  readonly archiveLookupPassed: boolean
  readonly mapClaimPassed: boolean
  readonly mapLeaseRecoveryPassed: boolean
  readonly trigramPlanUsesIndex: boolean
  readonly planEvidence: string[]
}

export const LCM_PGLITE_GATE_RELEASE_SCALE: LcmPGliteGateScale = {
  messageParts: 10_000,
  summaries: 1_000,
  largeFiles: 1_000,
  mapItems: 10_000,
}

export const LCM_PGLITE_GATE_TEST_SCALE: LcmPGliteGateScale = {
  messageParts: 250,
  summaries: 50,
  largeFiles: 50,
  mapItems: 250,
}

const specificMessageFixtures = [
  {
    id: "part_code_identifier",
    searchText: "code identifier fixture foo_bar_baz rust::Result parse_http_response",
  },
  {
    id: "part_cli_log",
    searchText: "cli log fixture level=ERROR path=/workspace/src/main.ts flag=--dry-run sha256=abc123def456",
  },
  {
    id: "part_tool_input",
    searchText: `tool input fixture ${canonicalJson({
      alpha: { beta: "needle" },
      path: "/workspace/src/main.ts",
      zed: false,
    })}`,
  },
  {
    id: "part_file_metadata",
    searchText: "file metadata fixture file_url=file:///workspace/README.md media_mime=text/plain media_name=README.md",
  },
  {
    id: "part_multilingual",
    searchText: "multilingual fixture Привет мир こんにちは mundo cafe",
  },
]

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

async function resetProbeSchema(db: PGlite) {
  await db.exec(`
    DROP SCHEMA IF EXISTS lcm_probe_m03 CASCADE;
    CREATE SCHEMA lcm_probe_m03;

    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TABLE lcm_probe_m03.lcm_probe_message_parts (
      part_row_id text PRIMARY KEY,
      conversation_id text NOT NULL,
      source_kind text NOT NULL,
      search_text text NOT NULL,
      tool_input_json jsonb
    );

    CREATE INDEX lcm_message_parts_search_text_trgm_gin
      ON lcm_probe_m03.lcm_probe_message_parts
      USING gin (search_text gin_trgm_ops);

    CREATE INDEX lcm_probe_message_parts_conversation_part_idx
      ON lcm_probe_m03.lcm_probe_message_parts (conversation_id, part_row_id);

    CREATE TABLE lcm_probe_m03.lcm_probe_summaries (
      summary_id text PRIMARY KEY,
      conversation_id text NOT NULL,
      content_text text NOT NULL
    );

    CREATE INDEX lcm_summaries_content_text_trgm_gin
      ON lcm_probe_m03.lcm_probe_summaries
      USING gin (content_text gin_trgm_ops);

    CREATE TABLE lcm_probe_m03.lcm_probe_large_files (
      file_id text PRIMARY KEY,
      content_sha256 text NOT NULL,
      status text NOT NULL,
      byte_count bigint NOT NULL,
      source_kind text NOT NULL
    );

    CREATE INDEX lcm_probe_large_files_fingerprint_status_idx
      ON lcm_probe_m03.lcm_probe_large_files (content_sha256, status, file_id);

    CREATE TABLE lcm_probe_m03.lcm_probe_archive_stubs (
      pointer_id text PRIMARY KEY,
      summary_id text NOT NULL,
      target_summary_id text NOT NULL
    );

    CREATE INDEX lcm_probe_archive_stubs_summary_idx
      ON lcm_probe_m03.lcm_probe_archive_stubs (summary_id, pointer_id);

    CREATE TABLE lcm_probe_m03.lcm_probe_map_items (
      map_id text NOT NULL,
      item_index integer NOT NULL,
      status text NOT NULL,
      lease_owner text,
      leased_until_ms bigint,
      attempts integer NOT NULL DEFAULT 0,
      PRIMARY KEY (map_id, item_index)
    );

    CREATE INDEX lcm_probe_map_items_claim_idx
      ON lcm_probe_m03.lcm_probe_map_items (map_id, status, item_index);

    CREATE INDEX lcm_probe_map_items_lease_recovery_idx
      ON lcm_probe_m03.lcm_probe_map_items (map_id, status, leased_until_ms);
  `)
}

async function insertProbeRows(db: PGlite, scale: LcmPGliteGateScale) {
  await db.transaction(async (tx) => {
    for (const item of specificMessageFixtures) {
      await tx.query(
        `
          INSERT INTO lcm_probe_m03.lcm_probe_message_parts (part_row_id, conversation_id, source_kind, search_text, tool_input_json)
          VALUES ($1, 'conv_probe', 'message_part', $2, $3::jsonb)
        `,
        [item.id, item.searchText, canonicalJson({ fixture: item.id })],
      )
    }
  })

  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_message_parts (part_row_id, conversation_id, source_kind, search_text)
      SELECT
        'part_bulk_' || i,
        'conv_probe',
        'message_part',
        CASE WHEN i = $1 THEN 'bulk unique lcm_bulk_needle_xyz search fixture' ELSE 'bulk filler row ' || i END
      FROM generate_series(1, $2) AS s(i)
    `,
    [Math.max(1, Math.floor(scale.messageParts / 2)), scale.messageParts],
  )
  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_summaries (summary_id, conversation_id, content_text)
      SELECT
        'sum_bulk_' || i,
        'conv_probe',
        CASE WHEN i = $1 THEN 'summary unique lcm_summary_needle_xyz fixture' ELSE 'summary filler row ' || i END
      FROM generate_series(1, $2) AS s(i)
    `,
    [Math.max(1, Math.floor(scale.summaries / 2)), scale.summaries],
  )
  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_large_files (file_id, content_sha256, status, byte_count, source_kind)
      SELECT
        'file_bulk_' || i,
        lpad(i::text, 64, '0'),
        CASE WHEN i = $1 THEN 'ready' ELSE 'archived' END,
        1024 + i,
        'lcm_file'
      FROM generate_series(1, $2) AS s(i)
    `,
    [Math.max(1, Math.floor(scale.largeFiles / 2)), scale.largeFiles],
  )
  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_archive_stubs (pointer_id, summary_id, target_summary_id)
      VALUES ('ptr_probe_1', 'sum_bulk_1', 'sum_bulk_2')
    `,
  )
  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_map_items (map_id, item_index, status)
      SELECT 'map_probe', i, 'pending'
      FROM generate_series(1, $1) AS s(i)
    `,
    [scale.mapItems],
  )
  await db.query(
    `
      INSERT INTO lcm_probe_m03.lcm_probe_map_items (map_id, item_index, status, lease_owner, leased_until_ms)
      VALUES ('map_probe', 0, 'leased', 'owner_expired', 1)
      ON CONFLICT (map_id, item_index) DO UPDATE SET
        status = excluded.status,
        lease_owner = excluded.lease_owner,
        leased_until_ms = excluded.leased_until_ms
    `,
  )
  await db.exec("ANALYZE lcm_probe_m03.lcm_probe_message_parts; ANALYZE lcm_probe_m03.lcm_probe_summaries;")
}

async function requiredIndexesPresent(db: PGlite) {
  const rows = (
    await db.query<{ indexname: string }>(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'lcm_probe_m03'
          AND indexname = ANY($1)
        ORDER BY indexname
      `,
      [
        [
          "lcm_message_parts_search_text_trgm_gin",
          "lcm_summaries_content_text_trgm_gin",
          "lcm_probe_large_files_fingerprint_status_idx",
          "lcm_probe_map_items_claim_idx",
          "lcm_probe_map_items_lease_recovery_idx",
        ],
      ],
    )
  ).rows.map((row) => row.indexname)
  return [
    "lcm_message_parts_search_text_trgm_gin",
    "lcm_summaries_content_text_trgm_gin",
    "lcm_probe_large_files_fingerprint_status_idx",
    "lcm_probe_map_items_claim_idx",
    "lcm_probe_map_items_lease_recovery_idx",
  ].every((index) => rows.includes(index))
}

async function hasRows(db: PGlite, query: string, params: unknown[]) {
  return (await db.query(query, params)).rows.length > 0
}

async function claimMapItem(db: PGlite, nowMs: number) {
  const rows = (
    await db.query<{ item_index: number }>(
      `
        WITH candidate AS (
          SELECT map_id, item_index
          FROM lcm_probe_m03.lcm_probe_map_items
          WHERE map_id = 'map_probe'
            AND status = 'pending'
          ORDER BY item_index
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE lcm_probe_m03.lcm_probe_map_items item
        SET status = 'leased',
          lease_owner = 'owner_probe',
          leased_until_ms = $1,
          attempts = attempts + 1
        FROM candidate
        WHERE item.map_id = candidate.map_id
          AND item.item_index = candidate.item_index
        RETURNING item.item_index
      `,
      [nowMs + 60_000],
    )
  ).rows
  return rows.length === 1 && rows[0]?.item_index === 1
}

async function recoverExpiredLease(db: PGlite) {
  const rows = (
    await db.query<{ item_index: number }>(
      `
        UPDATE lcm_probe_m03.lcm_probe_map_items
        SET status = 'pending',
          lease_owner = NULL,
          leased_until_ms = NULL
        WHERE map_id = 'map_probe'
          AND status = 'leased'
          AND leased_until_ms < $1
        RETURNING item_index
      `,
      [Date.now()],
    )
  ).rows
  return rows.some((row) => row.item_index === 0)
}

async function trigramPlanEvidence(db: PGlite) {
  await db.exec("SET enable_seqscan = off;")
  try {
    const rows = (
      await db.query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ILIKE '%lcm_bulk_needle_xyz%'",
      )
    ).rows.map((row) => row["QUERY PLAN"])
    return {
      planEvidence: rows,
      usesIndex: rows.some((line) => line.includes("lcm_message_parts_search_text_trgm_gin")),
    }
  } finally {
    await db.exec("RESET enable_seqscan;")
  }
}

export async function runPgliteGateProbe(
  db: PGlite,
  input: { scale?: Partial<LcmPGliteGateScale> } = {},
): Promise<LcmPGliteGateProbeResult> {
  const scale = { ...LCM_PGLITE_GATE_RELEASE_SCALE, ...input.scale }
  await resetProbeSchema(db)
  await insertProbeRows(db, scale)

  const literalSearchPassed =
    (await hasRows(db, "SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ILIKE $1", [
      "%foo_bar_baz%",
    ])) &&
    (await hasRows(db, "SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ILIKE $1", [
      "%--dry-run%",
    ])) &&
    (await hasRows(db, "SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ILIKE $1", [
      '%"alpha":{"beta":"needle"}%',
    ])) &&
    (await hasRows(db, "SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ILIKE $1", [
      "%README.md%",
    ]))
  const regexSearchPassed = await hasRows(
    db,
    "SELECT part_row_id FROM lcm_probe_m03.lcm_probe_message_parts WHERE search_text ~* $1",
    ["(Привет|こんにちは|parse_http_response)"],
  )
  const summarySearchPassed = await hasRows(
    db,
    "SELECT summary_id FROM lcm_probe_m03.lcm_probe_summaries WHERE content_text ILIKE $1",
    ["%lcm_summary_needle_xyz%"],
  )
  const largeFileLookupPassed = await hasRows(
    db,
    "SELECT file_id FROM lcm_probe_m03.lcm_probe_large_files WHERE content_sha256 = $1 AND status = 'ready'",
    [String(Math.max(1, Math.floor(scale.largeFiles / 2))).padStart(64, "0")],
  )
  const archiveLookupPassed = await hasRows(
    db,
    "SELECT pointer_id FROM lcm_probe_m03.lcm_probe_archive_stubs WHERE summary_id = 'sum_bulk_1'",
    [],
  )
  const plan = await trigramPlanEvidence(db)

  return {
    requiredIndexesPresent: await requiredIndexesPresent(db),
    literalSearchPassed,
    regexSearchPassed,
    summarySearchPassed,
    largeFileLookupPassed,
    archiveLookupPassed,
    mapClaimPassed: await claimMapItem(db, Date.now()),
    mapLeaseRecoveryPassed: await recoverExpiredLease(db),
    trigramPlanUsesIndex: plan.usesIndex,
    planEvidence: plan.planEvidence,
  }
}
