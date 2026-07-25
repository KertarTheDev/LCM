import path from "node:path"
import { chmodSync, existsSync } from "node:fs"
import { open } from "#lcm-db"
import { LCM_SCHEMA_VERSION } from "./types"
import type {
  ActivityRecord,
  ContextFrame,
  ConversationMemoryStore,
  FinalSource,
  FrontierItem,
  FrontierRevision,
  MemoryState,
  SummaryAttempt,
  SummaryChild,
  SummaryNode,
  TranscriptLineage,
} from "./types"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lcm_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lcm_session (
  session_id TEXT PRIMARY KEY,
  lineage_digest TEXT NOT NULL,
  indexed_through INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  state TEXT NOT NULL,
  health TEXT NOT NULL,
  issue_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lcm_source (
  source_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  excerpt TEXT NOT NULL,
  media_type TEXT,
  filename TEXT,
  UNIQUE(session_id, ordinal),
  UNIQUE(session_id, message_id, part_id)
);
CREATE INDEX IF NOT EXISTS lcm_source_session_idx ON lcm_source(session_id, ordinal);
CREATE TABLE IF NOT EXISTS lcm_summary (
  summary_id TEXT PRIMARY KEY,
  node_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  digest TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  first_ordinal INTEGER NOT NULL,
  last_ordinal INTEGER NOT NULL,
  generation_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, node_key, digest)
);
CREATE INDEX IF NOT EXISTS lcm_summary_session_idx ON lcm_summary(session_id, first_ordinal, last_ordinal);
CREATE TABLE IF NOT EXISTS lcm_summary_edge (
  parent_summary_id TEXT NOT NULL,
  child_kind TEXT NOT NULL,
  child_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(parent_summary_id, ordinal),
  UNIQUE(parent_summary_id, child_kind, child_id),
  FOREIGN KEY(parent_summary_id) REFERENCES lcm_summary(summary_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lcm_summary_attempt (
  attempt_id TEXT PRIMARY KEY,
  node_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  variant TEXT,
  mode TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  finish TEXT,
  error_code TEXT,
  request_id TEXT,
  generation_id TEXT,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lcm_frontier_revision (
  revision_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lineage_digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lcm_frontier_revision_session_idx
  ON lcm_frontier_revision(session_id, lineage_digest, created_at DESC, revision_id DESC);
CREATE TABLE IF NOT EXISTS lcm_frontier_item (
  revision_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY(revision_id, ordinal),
  FOREIGN KEY(revision_id) REFERENCES lcm_frontier_revision(revision_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lcm_activity (
  activity_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  pressure_before REAL,
  pressure_after REAL,
  raw_tokens INTEGER,
  summary_tokens INTEGER,
  summary_ids_json TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, sequence)
);
CREATE INDEX IF NOT EXISTS lcm_activity_session_idx ON lcm_activity(session_id, sequence DESC);
CREATE TABLE IF NOT EXISTS lcm_context_frame (
  frame_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  request_id TEXT,
  revision_id TEXT,
  lineage_digest TEXT NOT NULL,
  active INTEGER NOT NULL,
  reason TEXT NOT NULL,
  pre_json TEXT NOT NULL,
  post_json TEXT NOT NULL,
  pressure_before REAL,
  pressure_after REAL,
  raw_tokens INTEGER NOT NULL,
  summary_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lcm_context_frame_session_idx ON lcm_context_frame(session_id, created_at, frame_id);
CREATE TABLE IF NOT EXISTS lcm_lease (
  lease_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`

type SessionRow = {
  session_id: string
  lineage_digest: string
  indexed_through: number
  source_count: number
  state: MemoryState["state"]
  health: MemoryState["health"]
  issue_json: string | null
}

type SourceRow = {
  source_id: string
  session_id: string
  message_id: string
  part_id: string
  ordinal: number
  kind: FinalSource["kind"]
  digest: string
  token_count: number
  byte_count: number
  excerpt: string
  media_type: string | null
  filename: string | null
}

type SummaryRow = {
  summary_id: string
  node_key: string
  session_id: string
  level: number
  text: string
  digest: string
  source_digest: string
  token_count: number
  byte_count: number
  first_ordinal: number
  last_ordinal: number
  generation_mode: SummaryNode["generationMode"]
  created_at: number
}

type EdgeRow = {
  parent_summary_id: string
  child_kind: SummaryChild["kind"]
  child_id: string
  ordinal: number
}

type RevisionRow = {
  revision_id: string
  session_id: string
  lineage_digest: string
  reason: FrontierRevision["reason"]
  created_at: number
}

type FrontierRow = {
  item_kind: FrontierItem["kind"]
  item_id: string
  ordinal: number
}

type ActivityRow = {
  activity_id: string
  session_id: string
  sequence: number
  kind: ActivityRecord["kind"]
  pressure_before: number | null
  pressure_after: number | null
  raw_tokens: number | null
  summary_tokens: number | null
  summary_ids_json: string | null
  message: string
  created_at: number
}

type FrameRow = {
  frame_id: string
  session_id: string
  request_id: string | null
  revision_id: string | null
  lineage_digest: string
  active: number
  reason: ContextFrame["reason"]
  pre_json: string
  post_json: string
  pressure_before: number | null
  pressure_after: number | null
  raw_tokens: number
  summary_tokens: number
  created_at: number
}

export function sidecarPath(databasePath: string) {
  if (databasePath === ":memory:") return ":memory:"
  const extension = path.extname(databasePath)
  if (!extension) return `${databasePath}.lcm`
  return `${databasePath.slice(0, -extension.length)}.lcm${extension}`
}

function source(row: SourceRow): FinalSource {
  return {
    id: row.source_id,
    sessionID: row.session_id,
    messageID: row.message_id,
    partID: row.part_id,
    ordinal: row.ordinal,
    kind: row.kind,
    digest: row.digest,
    tokens: row.token_count,
    bytes: row.byte_count,
    excerpt: row.excerpt,
    ...(row.media_type ? { mediaType: row.media_type } : {}),
    ...(row.filename ? { filename: row.filename } : {}),
  }
}

function summary(row: SummaryRow): SummaryNode {
  return {
    id: row.summary_id,
    nodeKey: row.node_key,
    sessionID: row.session_id,
    level: row.level,
    text: row.text,
    digest: row.digest,
    sourceDigest: row.source_digest,
    tokens: row.token_count,
    bytes: row.byte_count,
    firstOrdinal: row.first_ordinal,
    lastOrdinal: row.last_ordinal,
    generationMode: row.generation_mode,
    createdAt: row.created_at,
  }
}

function activity(row: ActivityRow): ActivityRecord {
  return {
    id: row.activity_id,
    sessionID: row.session_id,
    sequence: row.sequence,
    kind: row.kind,
    ...(row.pressure_before === null ? {} : { pressureBefore: row.pressure_before }),
    ...(row.pressure_after === null ? {} : { pressureAfter: row.pressure_after }),
    ...(row.raw_tokens === null ? {} : { rawTokens: row.raw_tokens }),
    ...(row.summary_tokens === null ? {} : { summaryTokens: row.summary_tokens }),
    ...(row.summary_ids_json ? { summaryIDs: JSON.parse(row.summary_ids_json) as string[] } : {}),
    message: row.message,
    createdAt: row.created_at,
  }
}

export class SqliteConversationMemoryStore implements ConversationMemoryStore {
  private constructor(
    private readonly client: ReturnType<typeof open>,
    readonly path: string,
  ) {}

  static open(input: { databasePath: string; derivedPath?: string }) {
    const target = input.derivedPath ?? sidecarPath(input.databasePath)
    const existed = target === ":memory:" || existsSync(target)
    const client = open(target)
    client.exec("PRAGMA journal_mode = WAL")
    client.exec("PRAGMA synchronous = NORMAL")
    client.exec("PRAGMA busy_timeout = 250")
    client.exec("PRAGMA foreign_keys = ON")
    client.exec(SCHEMA)
    const version = client.get<{ value: string }>("SELECT value FROM lcm_meta WHERE key = 'schema_version'")
    if (version && Number(version.value) !== LCM_SCHEMA_VERSION) {
      client.close()
      throw new Error("lcm_schema_incompatible")
    }
    client.run("INSERT OR IGNORE INTO lcm_meta(key, value) VALUES ('schema_version', ?)", [String(LCM_SCHEMA_VERSION)])
    if (target !== ":memory:" && !existed) chmodSync(target, 0o600)
    return new SqliteConversationMemoryStore(client, target)
  }

  async inspect(sessionID: string): Promise<MemoryState> {
    const row = this.client.get<SessionRow>("SELECT * FROM lcm_session WHERE session_id = ?", [sessionID])
    if (!row)
      return {
        sessionID,
        sourceCount: 0,
        pendingSources: 0,
        state: "raw",
        health: "ok",
      }
    return {
      sessionID,
      lineageDigest: row.lineage_digest,
      indexedThrough: row.indexed_through,
      sourceCount: row.source_count,
      pendingSources: 0,
      state: row.state,
      health: row.health,
      ...(row.issue_json ? { issue: JSON.parse(row.issue_json) as NonNullable<MemoryState["issue"]> } : {}),
    }
  }

  async replaceSources(input: {
    sessionID: string
    lineage: TranscriptLineage
    sources: FinalSource[]
  }): Promise<void> {
    this.client.transaction(() => {
      this.client.run("DELETE FROM lcm_source WHERE session_id = ?", [input.sessionID])
      for (const item of input.sources) {
        this.client.run(
          `INSERT INTO lcm_source(
            source_id, session_id, message_id, part_id, ordinal, kind, digest, token_count, byte_count, excerpt,
            media_type, filename
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.sessionID,
            item.messageID,
            item.partID,
            item.ordinal,
            item.kind,
            item.digest,
            item.tokens,
            item.bytes,
            item.excerpt,
            item.mediaType ?? null,
            item.filename ?? null,
          ],
        )
      }
      this.client.run(
        `INSERT INTO lcm_session(
          session_id, lineage_digest, indexed_through, source_count, state, health, issue_json, updated_at
        ) VALUES (?, ?, ?, ?, 'raw', 'ok', NULL, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          lineage_digest = excluded.lineage_digest,
          indexed_through = excluded.indexed_through,
          source_count = excluded.source_count,
          state = CASE WHEN lcm_session.lineage_digest = excluded.lineage_digest THEN lcm_session.state ELSE 'raw' END,
          health = 'ok',
          issue_json = NULL,
          updated_at = excluded.updated_at`,
        [input.sessionID, input.lineage.digest, input.sources.at(-1)?.ordinal ?? -1, input.sources.length, Date.now()],
      )
    })
  }

  async listSources(sessionID: string): Promise<FinalSource[]> {
    return this.client
      .all<SourceRow>("SELECT * FROM lcm_source WHERE session_id = ? ORDER BY ordinal, source_id", [sessionID])
      .map(source)
  }

  async getSource(sessionID: string, sourceID: string): Promise<FinalSource | undefined> {
    const row = this.client.get<SourceRow>("SELECT * FROM lcm_source WHERE session_id = ? AND source_id = ?", [
      sessionID,
      sourceID,
    ])
    return row ? source(row) : undefined
  }

  async commitSummary(input: {
    summary: SummaryNode
    children: SummaryChild[]
    attempt?: SummaryAttempt
  }): Promise<void> {
    this.client.transaction(() => {
      const state = this.client.get<SessionRow>("SELECT * FROM lcm_session WHERE session_id = ?", [
        input.summary.sessionID,
      ])
      if (!state) throw new Error("lcm_not_ready")
      this.client.run(
        `INSERT OR IGNORE INTO lcm_summary(
          summary_id, node_key, session_id, level, text, digest, source_digest, token_count, byte_count,
          first_ordinal, last_ordinal, generation_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.summary.id,
          input.summary.nodeKey,
          input.summary.sessionID,
          input.summary.level,
          input.summary.text,
          input.summary.digest,
          input.summary.sourceDigest,
          input.summary.tokens,
          input.summary.bytes,
          input.summary.firstOrdinal,
          input.summary.lastOrdinal,
          input.summary.generationMode,
          input.summary.createdAt,
        ],
      )
      for (const child of input.children) {
        this.client.run(
          "INSERT OR IGNORE INTO lcm_summary_edge(parent_summary_id, child_kind, child_id, ordinal) VALUES (?, ?, ?, ?)",
          [child.summaryID, child.kind, child.id, child.ordinal],
        )
      }
      if (input.attempt) this.insertAttempt(input.attempt)
      this.client.run("UPDATE lcm_session SET state = 'preparing', updated_at = ? WHERE session_id = ?", [
        Date.now(),
        input.summary.sessionID,
      ])
    })
  }

  private insertAttempt(attempt: SummaryAttempt) {
    this.client.run(
      `INSERT OR IGNORE INTO lcm_summary_attempt(
        attempt_id, node_key, session_id, provider_id, model_id, variant, mode, input_tokens, output_tokens,
        reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, finish, error_code, request_id,
        generation_id, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.id,
        attempt.nodeKey,
        attempt.sessionID,
        attempt.providerID ?? null,
        attempt.modelID ?? null,
        attempt.variant ?? null,
        attempt.mode,
        attempt.inputTokens,
        attempt.outputTokens,
        attempt.reasoningTokens,
        attempt.cacheReadTokens,
        attempt.cacheWriteTokens,
        attempt.cost,
        attempt.finish ?? null,
        attempt.errorCode ?? null,
        attempt.requestID ?? null,
        attempt.generationID ?? null,
        attempt.durationMs,
        attempt.createdAt,
      ],
    )
  }

  async getSummary(sessionID: string, summaryID: string): Promise<SummaryNode | undefined> {
    const row = this.client.get<SummaryRow>("SELECT * FROM lcm_summary WHERE session_id = ? AND summary_id = ?", [
      sessionID,
      summaryID,
    ])
    return row ? summary(row) : undefined
  }

  async findSummary(sessionID: string, nodeKey: string): Promise<SummaryNode | undefined> {
    const row = this.client.get<SummaryRow>(
      "SELECT * FROM lcm_summary WHERE session_id = ? AND node_key = ? ORDER BY created_at DESC LIMIT 1",
      [sessionID, nodeKey],
    )
    return row ? summary(row) : undefined
  }

  async listSummaries(sessionID: string): Promise<SummaryNode[]> {
    return this.client
      .all<SummaryRow>("SELECT * FROM lcm_summary WHERE session_id = ? ORDER BY first_ordinal, level, summary_id", [
        sessionID,
      ])
      .map(summary)
  }

  async listChildren(sessionID: string, summaryID: string): Promise<SummaryChild[]> {
    return this.client
      .all<EdgeRow>(
        `SELECT edge.* FROM lcm_summary_edge edge
         JOIN lcm_summary parent ON parent.summary_id = edge.parent_summary_id
         WHERE parent.session_id = ? AND edge.parent_summary_id = ?
         ORDER BY edge.ordinal`,
        [sessionID, summaryID],
      )
      .map((row) => ({
        summaryID: row.parent_summary_id,
        kind: row.child_kind,
        id: row.child_id,
        ordinal: row.ordinal,
      }))
  }

  async commitRevision(revision: FrontierRevision): Promise<void> {
    this.client.transaction(() => {
      const state = this.client.get<SessionRow>("SELECT * FROM lcm_session WHERE session_id = ?", [revision.sessionID])
      if (!state || state.lineage_digest !== revision.lineageDigest) throw new Error("lcm_stale_lineage")
      for (const item of revision.items) {
        const table = item.kind === "source" ? "lcm_source" : "lcm_summary"
        const id = item.kind === "source" ? "source_id" : "summary_id"
        const exists = this.client.get<{ found: number }>(
          `SELECT 1 AS found FROM ${table} WHERE session_id = ? AND ${id} = ?`,
          [revision.sessionID, item.id],
        )
        if (!exists) throw new Error("lcm_not_found")
      }
      this.client.run(
        "INSERT INTO lcm_frontier_revision(revision_id, session_id, lineage_digest, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        [revision.id, revision.sessionID, revision.lineageDigest, revision.reason, revision.createdAt],
      )
      for (const item of revision.items) {
        this.client.run("INSERT INTO lcm_frontier_item(revision_id, ordinal, item_kind, item_id) VALUES (?, ?, ?, ?)", [
          revision.id,
          item.ordinal,
          item.kind,
          item.id,
        ])
      }
      this.client.run("UPDATE lcm_session SET state = 'summarized', updated_at = ? WHERE session_id = ?", [
        Date.now(),
        revision.sessionID,
      ])
    })
  }

  async activeRevision(sessionID: string, lineageDigest: string): Promise<FrontierRevision | undefined> {
    const row = this.client.get<RevisionRow>(
      `SELECT * FROM lcm_frontier_revision
       WHERE session_id = ? AND lineage_digest = ?
       ORDER BY created_at DESC, revision_id DESC LIMIT 1`,
      [sessionID, lineageDigest],
    )
    if (!row) return
    const items = this.client
      .all<FrontierRow>("SELECT * FROM lcm_frontier_item WHERE revision_id = ? ORDER BY ordinal", [row.revision_id])
      .map((item) => ({ kind: item.item_kind, id: item.item_id, ordinal: item.ordinal }))
    return {
      id: row.revision_id,
      sessionID: row.session_id,
      lineageDigest: row.lineage_digest,
      reason: row.reason,
      items,
      createdAt: row.created_at,
    }
  }

  async appendActivity(record: ActivityRecord): Promise<ActivityRecord> {
    return this.client.transaction(() => {
      const row = this.client.get<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM lcm_activity WHERE session_id = ?",
        [record.sessionID],
      )
      const sequence = record.sequence ?? row?.sequence ?? 1
      this.client.run(
        `INSERT INTO lcm_activity(
          activity_id, session_id, sequence, kind, pressure_before, pressure_after, raw_tokens, summary_tokens,
          summary_ids_json, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.sessionID,
          sequence,
          record.kind,
          record.pressureBefore ?? null,
          record.pressureAfter ?? null,
          record.rawTokens ?? null,
          record.summaryTokens ?? null,
          record.summaryIDs ? JSON.stringify(record.summaryIDs) : null,
          record.message,
          record.createdAt,
        ],
      )
      return { ...record, sequence }
    })
  }

  async listActivity(sessionID: string, input: { before?: number; limit?: number } = {}): Promise<ActivityRecord[]> {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50))
    const rows =
      input.before === undefined
        ? this.client.all<ActivityRow>(
            "SELECT * FROM lcm_activity WHERE session_id = ? ORDER BY sequence DESC LIMIT ?",
            [sessionID, limit],
          )
        : this.client.all<ActivityRow>(
            "SELECT * FROM lcm_activity WHERE session_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?",
            [sessionID, input.before, limit],
          )
    return rows.map(activity)
  }

  async recordFrame(frame: ContextFrame): Promise<void> {
    this.client.transaction(() => {
      if (frame.active) {
        this.client.run("UPDATE lcm_context_frame SET active = 0 WHERE session_id = ?", [frame.sessionID])
      }
      this.client.run(
        `INSERT INTO lcm_context_frame(
          frame_id, session_id, request_id, revision_id, lineage_digest, active, reason, pre_json, post_json,
          pressure_before, pressure_after, raw_tokens, summary_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          frame.id,
          frame.sessionID,
          frame.requestID ?? null,
          frame.revisionID ?? null,
          frame.lineageDigest,
          frame.active ? 1 : 0,
          frame.reason,
          JSON.stringify(frame.pre),
          JSON.stringify(frame.post),
          frame.pressureBefore ?? null,
          frame.pressureAfter ?? null,
          frame.rawTokens,
          frame.summaryTokens,
          frame.createdAt,
        ],
      )
    })
  }

  async listFrames(sessionID: string): Promise<ContextFrame[]> {
    return this.client
      .all<FrameRow>("SELECT * FROM lcm_context_frame WHERE session_id = ? ORDER BY created_at, frame_id", [sessionID])
      .map((row) => ({
        id: row.frame_id,
        sessionID: row.session_id,
        ...(row.request_id ? { requestID: row.request_id } : {}),
        ...(row.revision_id ? { revisionID: row.revision_id } : {}),
        lineageDigest: row.lineage_digest,
        active: row.active === 1,
        reason: row.reason,
        pre: JSON.parse(row.pre_json) as ContextFrame["pre"],
        post: JSON.parse(row.post_json) as ContextFrame["post"],
        ...(row.pressure_before === null ? {} : { pressureBefore: row.pressure_before }),
        ...(row.pressure_after === null ? {} : { pressureAfter: row.pressure_after }),
        rawTokens: row.raw_tokens,
        summaryTokens: row.summary_tokens,
        createdAt: row.created_at,
      }))
  }

  async acquireLease(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<boolean> {
    return this.client.transaction(() => {
      const row = this.client.get<{ owner: string; expires_at: number }>(
        "SELECT owner, expires_at FROM lcm_lease WHERE lease_key = ?",
        [input.key],
      )
      if (row && row.owner !== input.owner && row.expires_at > input.now) return false
      this.client.run(
        `INSERT INTO lcm_lease(lease_key, owner, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(lease_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at`,
        [input.key, input.owner, input.expiresAt],
      )
      return true
    })
  }

  async releaseLease(input: { key: string; owner: string }): Promise<void> {
    this.client.run("DELETE FROM lcm_lease WHERE lease_key = ? AND owner = ?", [input.key, input.owner])
  }

  async deleteSession(sessionID: string): Promise<void> {
    this.client.transaction(() => {
      const summaries = this.client.all<{ summary_id: string }>(
        "SELECT summary_id FROM lcm_summary WHERE session_id = ?",
        [sessionID],
      )
      const revisions = this.client.all<{ revision_id: string }>(
        "SELECT revision_id FROM lcm_frontier_revision WHERE session_id = ?",
        [sessionID],
      )
      for (const row of revisions)
        this.client.run("DELETE FROM lcm_frontier_item WHERE revision_id = ?", [row.revision_id])
      for (const row of summaries)
        this.client.run("DELETE FROM lcm_summary_edge WHERE parent_summary_id = ?", [row.summary_id])
      this.client.run("DELETE FROM lcm_context_frame WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_activity WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_frontier_revision WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_summary_attempt WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_summary WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_source WHERE session_id = ?", [sessionID])
      this.client.run("DELETE FROM lcm_session WHERE session_id = ?", [sessionID])
    })
  }

  close() {
    this.client.close()
  }
}
