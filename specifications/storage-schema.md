# Storage, Schema, And Persistence

This document describes the current PGlite-backed LCM storage implementation in `packages/opencode/src/session/lcm/`.

## Storage Ownership

LCM data is stored in family-scoped PGlite databases resolved by `family.ts`, `db-layout.ts`, and `lifecycle.ts`. Runtime startup uses `LcmDb.initializeFamily(...)` through `ensureLcmDbReady(...)` and resolves the family target from the Kilo session unless a direct test/debug data directory is supplied.

Single-owner safety is enforced by `owner-lock.ts`. The owner lock records versioned owner metadata, heartbeat timing, stale thresholds, and PID checks. DB startup failures are represented through content-safe `LcmDbStatus` and `LcmSafeError` values rather than raw filesystem or database details.

The DB worker treats owner-lock loss as a runtime state transition. Heartbeat and request-time owner verification remember a lost lock, downgrade the worker to `locked` or `unavailable`, reject queued and future DB work, and avoid removing a replacement owner's lock during shutdown.

The runtime-owned LCM control data root also stores small content-safe sidecar state that must survive runtime restart but does not belong in a family PGlite database. `control/finalized-sync-pending/` stores one hashed-file JSON record per session for post-turn finalized-source sync retry state. The payload contains session ID, upper message boundary, attempt count, and a content-safe `LcmSafeError`; it does not store conversation text, tool output, model prompts, or raw memory content.

Important owner-lock constants:

- `LCM_OWNER_LOCK_VERSION = 1`
- `LCM_OWNER_LOCK_HEARTBEAT_MS = 5000`
- `LCM_OWNER_LOCK_STALE_MS = 20000`
- `LCM_OWNER_LOCK_DEAD_PID_GRACE_MS = 2000`
- `LCM_OWNER_LOCK_LIVE_PID_STALE_VETO_MS = 45000`

## Schema Baseline

Current migration file: `packages/opencode/src/session/lcm/migrations/0001_initial_schema.sql`.

The baseline creates `pg_trgm`, 21 LCM tables, and 62 indexes. This is the only current schema baseline in the code inspected for this rebaseline.

Tables:

- `lcm_migrations`
- `lcm_conversations`
- `lcm_usage_records`
- `lcm_deferred_jobs`
- `lcm_messages`
- `lcm_large_files`
- `lcm_artifact_cleanup_queue`
- `lcm_message_parts`
- `lcm_summaries`
- `lcm_summary_messages`
- `lcm_summary_parents`
- `lcm_summary_lineage_pointers`
- `lcm_context_items`
- `lcm_provider_request_snapshots`
- `lcm_provider_request_snapshot_items`
- `lcm_context_item_consumption`
- `lcm_provider_transform_overheads`
- `lcm_context_snapshots`
- `lcm_id_aliases`
- `lcm_map_runs`
- `lcm_map_items`

Trigram indexes exist for source part `search_text` and summary `content_text`, supporting retrieval search without scanning unrelated content in application code.

## Conversation Rows

`lcm_conversations` is the root table for a session's LCM family entry. It stores:

- `conversation_id`, `source_session_id`, parent/root conversation links, and parent session linkage.
- `project_id`, optional `workspace_id`, `session_directory`, optional `worktree_path`, and boundary metadata.
- `capability_class`: `root`, `task_child`, `explore_child`, or `map_child`.
- `orchestration_metadata_json`, used to prove trusted child capability class after restart.
- `lifecycle_state`: `passive_synced`, `lcm_active`, `legacy_read_only`, `recovery_required`, `recovery_failed`, or `db_unavailable`.
- schema/feature versions and safe last-error fields.

The source session ID is unique. Parent/root foreign keys cascade on delete, so normal recursive cleanup can delete a full conversation tree.

## Source Tables

`lcm_messages` and `lcm_message_parts` are immutable source tables populated from finalized Kilo MessageV2 rows by `source-sync.ts`.

`lcm_messages` records role, source ordering, timestamps, provider/model/agent metadata, and render flags. `lcm_message_parts` records part-level source IDs or deterministic source-part keys, part kind/order, terminal tool state, inline content fields, file/media metadata, provider/render metadata, authoritative content storage, search text, and content hash fields.

Source rows are not rewritten when only non-source Kilo bookkeeping changes later. Idempotent source sync tolerates assistant summary, cost, and token-count drift, while content, terminal error details, model/provider identity, ordering, timestamps, and part payload fields remain immutable. When immutable source drift is detected before LCM has child conversations, map runs, in-flight provider snapshots, large payload rows, or standalone large-file markers for the conversation, source sync can discard the conversation's derived/source rows and rebuild them from durable Kilo messages. Drift outside that rebuild-safe envelope fails closed as a content-safe recovery-required error that directs the user to start a new thread instead of silently mutating stored memory.

Authoritative content storage is explicit:

- `content_storage_kind = "inline"` stores source content in the part row.
- `content_storage_kind = "lcm_file"` requires `content_file_id`, `content_byte_count`, and `content_sha256`, and the large payload is stored as an LCM large-file artifact instead of duplicated inline.

The storage check constraint rejects `lcm_file` rows that still keep full text/reasoning/tool-output/tool-error inline.

## Large Files And Artifacts

`lcm_large_files` stores path-backed records, inline large payloads, media, tool outputs, map inputs, and map outputs. `large-files.ts`, `path-provenance.ts`, and `artifacts.ts` own this behavior.

Path-backed rows require a complete observed provenance record:

- original and canonical paths
- observed size and mtime
- full SHA-256 content hash
- `path_hash_mode = "full"`
- non-empty boundary metadata
- no artifact storage for path-backed rows

Artifact-backed rows use `artifact_storage_kind = "file"` with artifact path, byte count, and content SHA-256. Reads validate artifacts before returning byte windows.

Large payload thresholds in `config.ts`:

- prompt payload threshold: 40,000 bytes
- tool output threshold: 40,000 bytes
- large payload token threshold: 10,000 tokens
- preview size: 4,000 bytes
- default read max bytes: 100,000
- absolute read max bytes: 1,000,000

## Summaries And Lineage

`lcm_summaries` stores sprigs, bindles, and archive stubs. It records prompt version, strategy, provider/model, usage record linkage, objective status, fallback mode, source token count, summary token count, and summary level. The schema currently accepts fallback modes `none`, `truncated_prefix`, and `extractive_key_points`; new deterministic fallback rows use `extractive_key_points` unless only the last-resort raw-prefix fallback can fit.

Lineage is split across:

- `lcm_summary_messages`: summary-to-source-message edges.
- `lcm_summary_parents`: summary-to-parent-summary edges.
- `lcm_summary_lineage_pointers`: archive stub and repair pointers.

Summaries are derived state. They do not delete source message or part rows.

## Active Context

`lcm_context_items` stores the active context view. Supported item types:

- `raw_message`
- `summary`
- `archive_stub`
- `large_file_marker`
- `retrieval_cue`

The table enforces that each item type references only the columns that make sense for that type. Retrieval cues have first-class IDs, lifecycle state, target source message ID, generation IDs, and JSON payload.

Context item order is unique per conversation. Token cache fields include token count, cache key, and cache version.

## Provider Request Snapshots

`lcm_provider_request_snapshots` records in-flight provider request protection data:

- operation ID, conversation/source session, provider/model
- status: `in_flight`, `resolved`, `canceled`, or `expired`
- cue IDs and render unit IDs
- source selection, request-snapshot protection, visibility, protected span, provider transform, and provider validator hashes
- creation, expiry, and terminal timestamps

`context.ts` creates snapshots during assembly, finalizes them after provider execution, and records final validation hashes through the LLM provider transform middleware.

`lcm_provider_request_snapshot_items` records the ordered context items represented by each request snapshot. It stores render-unit IDs, context item IDs, item type, optional message row ID, source kind, and provider-snapshot order without storing raw text or provider payload content.

`lcm_context_item_consumption` records the first resolved provider request that consumed a raw source message row. `message_row_id` is the durable key so consumption survives active-context item replacement; `context_item_id` is nullable provenance for the active item that was rendered at request time. Only snapshots finalized as `resolved` insert consumption rows; canceled, expired, or failed provider requests leave their raw rows unconsumed for future soft-backlog protection. Soft backlog selection uses this table to keep post-current rows mandatory until a later resolved request proves the model had a chance to see them.

`lcm_provider_transform_overheads` records content-safe provider/model/family token overhead observations from final provider validation. Threshold checks use the max observed overhead, with a conservative floor for unknown providers, as an internal input-budget reserve.

## Context Snapshots

`lcm_context_snapshots` records durable recovery snapshots. Each row includes strategy, active tokens, hard/soft thresholds, fresh-tail and soft-backlog counts, lane/metrics JSON, and `restore_manifest_json`.

Current restore manifest version: `lcm-context-restore-manifest-v2`.

`context.ts` validates snapshots newest-to-oldest. Snapshot restore requires manifest fields to match row fields, token counter identity, provider-safe metrics, render unit identity, and current manifest schema. Invalid or historical snapshots are skipped rather than partially restored.

## Usage Records

`lcm_usage_records` stores content-safe cost/usage/maintenance evidence. Allowed purposes:

- `leaf_summary`
- `condensation`
- `hard_limit_maintenance`
- `retrieval_expand_query`
- `file_exploration`
- `llm_map`

Allowed modes:

- `background`
- `blocking`
- `explicit_retrieval`
- `explicit_exploration`
- `map_item`

`lifecycle.ts` rejects usage records containing forbidden content-bearing keys such as prompts, raw content, tool output, stdout, stderr, query, answer, or inline payloads.

## Deferred Jobs

`lcm_deferred_jobs` stores runtime-owned retry state for soft maintenance that could not run immediately because another maintenance job, local provider capacity, or another transient retryable failure deferred it. The row is keyed per conversation/job kind, stores only content-safe metadata and render provenance, and is resumed through the normal `queueSoftMaintenanceAfterTurn(...)` path after runtime restart.

The persisted soft-maintenance payload includes session ID, provider/model IDs, render options, and the protected-current-user identity (`sourceSessionID`, `sourceMessageID`, optional `messageRowID`). It intentionally does not persist per-turn abort signal IDs or conversation text. Terminal results update the row to `completed`, `failed`, or `canceled` with safe code/message fields and `completed_at_ms`.

## Map Tables

`lcm_map_runs` stores one asynchronous map request. It records tool kind, status, input/output file IDs, prompt and schema hashes, model selection, worker/retry configuration, agentic mode, safe error JSON, owner, lease, and timestamps.

`lcm_map_items` stores per-item status, attempts, owner/lease, safe error, output JSON, and timestamps. Indexes support item claiming and lease recovery.

## Cleanup

Normal session deletion calls LCM cleanup through `LcmRuntime.handleSessionDeleted(...)` and `lifecycle.ts`. Recursive deletion is the normal product path because conversation trees can have child conversations. Runtime cleanup also removes the deleted session's finalized-sync pending sidecar, when present. Artifact cleanup uses `lcm_artifact_cleanup_queue` for durable retryable artifact cleanup bookkeeping.

Settings reads and writes are config-backed and do not require opening the PGlite family DB.
