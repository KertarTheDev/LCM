CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE lcm_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at_ms bigint NOT NULL,
  checksum text NOT NULL
);

CREATE TABLE lcm_conversations (
  conversation_id text PRIMARY KEY,
  source_session_id text NOT NULL,
  parent_session_id text,
  parent_conversation_id text REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  root_conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  project_id text NOT NULL,
  workspace_id text,
  session_directory text NOT NULL,
  worktree_path text,
  boundary_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_class text NOT NULL DEFAULT 'root' CHECK (capability_class IN ('root', 'task_child', 'explore_child', 'map_child')),
  orchestration_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN (
      'passive_synced',
      'lcm_active',
      'legacy_read_only',
      'recovery_required',
      'recovery_failed',
      'db_unavailable'
    )
  ),
  schema_version integer NOT NULL,
  feature_version integer NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  last_error_code text,
  last_safe_message text
);

CREATE UNIQUE INDEX lcm_conversations_source_session_id_unique
  ON lcm_conversations (source_session_id);
CREATE INDEX lcm_conversations_parent_conversation_id_idx
  ON lcm_conversations (parent_conversation_id);
CREATE INDEX lcm_conversations_root_conversation_id_idx
  ON lcm_conversations (root_conversation_id);
CREATE INDEX lcm_conversations_scope_idx
  ON lcm_conversations (project_id, workspace_id, session_directory, worktree_path);
CREATE INDEX lcm_conversations_lifecycle_updated_idx
  ON lcm_conversations (lifecycle_state, updated_at_ms);

CREATE TABLE lcm_usage_records (
  usage_record_id text PRIMARY KEY,
  conversation_id text REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_session_id text NOT NULL,
  job_id text,
  purpose text NOT NULL CHECK (
    purpose IN (
      'leaf_summary',
      'condensation',
      'hard_limit_maintenance',
      'retrieval_expand_query',
      'file_exploration',
      'llm_map'
    )
  ),
  mode text NOT NULL CHECK (
    mode IN (
      'background',
      'blocking',
      'explicit_retrieval',
      'explicit_exploration',
      'map_item'
    )
  ),
  provider_id text,
  model_id text,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_amount numeric,
  cost_currency text,
  cost_status text NOT NULL CHECK (cost_status IN ('provider_reported', 'unknown', 'not_applicable')),
  summary_target_tokens integer,
  summary_generation_max_output_tokens integer,
  maintenance_input_budget integer,
  summary_source_tokens integer,
  candidate_summary_tokens integer,
  accepted_summary_tokens integer,
  summary_objective_status text,
  summary_fallback_mode text,
  summary_reasoning_policy text,
  summary_retry_attempt integer,
  maintenance_status text CHECK (
    maintenance_status IS NULL OR maintenance_status IN (
      'scheduled',
      'completed',
      'no_op',
      'deferred',
      'skipped',
      'failed',
      'canceled',
      'recovery_required'
    )
  ),
  maintenance_safe_code text,
  maintenance_diagnostic_code text,
  maintenance_safe_message text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX lcm_usage_records_conversation_created_idx
  ON lcm_usage_records (conversation_id, created_at_ms);
CREATE INDEX lcm_usage_records_session_purpose_created_idx
  ON lcm_usage_records (source_session_id, purpose, created_at_ms);
CREATE INDEX lcm_usage_records_job_idx
  ON lcm_usage_records (job_id);

CREATE TABLE lcm_deferred_jobs (
  job_id text PRIMARY KEY,
  job_kind text NOT NULL CHECK (job_kind IN ('soft_maintenance')),
  conversation_id text REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_session_id text NOT NULL,
  provider_id text,
  model_id text,
  payload_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_run_at_ms bigint NOT NULL,
  last_safe_code text,
  last_diagnostic_code text,
  last_safe_message text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  completed_at_ms bigint
);

CREATE INDEX lcm_deferred_jobs_session_status_next_idx
  ON lcm_deferred_jobs (source_session_id, status, next_run_at_ms);
CREATE INDEX lcm_deferred_jobs_conversation_status_idx
  ON lcm_deferred_jobs (conversation_id, status);

CREATE TABLE lcm_messages (
  message_row_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_session_id text NOT NULL,
  source_message_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message_order integer NOT NULL,
  created_at_ms bigint NOT NULL,
  completed_at_ms bigint,
  provider_id text,
  model_id text,
  agent_name text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ignored boolean NOT NULL DEFAULT false,
  synthetic boolean NOT NULL DEFAULT false,
  compatibility boolean NOT NULL DEFAULT false,
  source_version integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX lcm_messages_conversation_source_message_unique
  ON lcm_messages (conversation_id, source_message_id);
CREATE INDEX lcm_messages_conversation_order_idx
  ON lcm_messages (conversation_id, message_order, message_row_id);
CREATE INDEX lcm_messages_source_session_message_idx
  ON lcm_messages (source_session_id, source_message_id);

CREATE TABLE lcm_large_files (
  file_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('path', 'inline', 'image', 'tool_output', 'map_input', 'map_output')),
  original_path text,
  canonical_path text,
  path_size_bytes bigint,
  path_mtime_ms bigint,
  path_content_sha256 text,
  path_hash_mode text NOT NULL DEFAULT 'not_computed' CHECK (path_hash_mode IN ('full', 'not_computed')),
  boundary_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  mime_type text,
  token_estimate integer,
  token_estimate_mode text,
  token_estimate_version text,
  preview_text text,
  exploration_summary_text text,
  exploration_status text NOT NULL DEFAULT 'not_started' CHECK (
    exploration_status IN (
      'not_started',
      'queued',
      'running',
      'completed',
      'sampled',
      'unavailable',
      'unsafe',
      'corrupt',
      'timeout',
      'over_limit',
      'canceled',
      'failed'
    )
  ),
  exploration_kind text NOT NULL DEFAULT 'none' CHECK (
    exploration_kind IN ('none', 'text', 'html', 'pdf', 'image', 'sqlite', 'unknown')
  ),
  exploration_safe_reason text CHECK (
    exploration_safe_reason IS NULL
    OR exploration_safe_reason IN (
      'none',
      'sampled',
      'unsupported_type',
      'missing_helper',
      'unsafe_active_content',
      'corrupt_input',
      'timeout',
      'over_limit',
      'canceled',
      'helper_failed',
      'stale_source',
      'permission_denied',
      'artifact_invalid'
    )
  ),
  exploration_sampled boolean NOT NULL DEFAULT false,
  exploration_sample_bytes bigint NOT NULL DEFAULT 0,
  exploration_updated_at_ms bigint,
  exploration_prompt_version text CHECK (
    exploration_prompt_version IS NULL
    OR exploration_prompt_version = 'file-exploration-summary-v2'
  ),
  exploration_usage_record_id text REFERENCES lcm_usage_records(usage_record_id) ON DELETE SET NULL,
  artifact_storage_kind text NOT NULL DEFAULT 'none' CHECK (artifact_storage_kind IN ('none', 'file')),
  artifact_path text,
  artifact_byte_count bigint NOT NULL DEFAULT 0,
  artifact_content_sha256 text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  CONSTRAINT lcm_large_files_file_conversation_idx UNIQUE (file_id, conversation_id),
  CONSTRAINT lcm_large_files_path_required_check CHECK (
    source_kind <> 'path'
    OR (
      original_path IS NOT NULL
      AND canonical_path IS NOT NULL
      AND path_size_bytes IS NOT NULL
      AND path_mtime_ms IS NOT NULL
      AND path_content_sha256 IS NOT NULL
      AND path_hash_mode = 'full'
      AND boundary_metadata_json <> '{}'::jsonb
      AND artifact_storage_kind = 'none'
    )
  ),
  CONSTRAINT lcm_large_files_artifact_storage_check CHECK (
    (
      artifact_storage_kind = 'none'
      AND artifact_path IS NULL
      AND artifact_byte_count = 0
      AND artifact_content_sha256 IS NULL
    )
    OR (
      artifact_storage_kind = 'file'
      AND artifact_path IS NOT NULL
      AND artifact_byte_count > 0
      AND artifact_content_sha256 IS NOT NULL
    )
  )
);

CREATE INDEX lcm_large_files_conversation_source_created_idx
  ON lcm_large_files (conversation_id, source_kind, created_at_ms);
CREATE INDEX lcm_large_files_path_fingerprint_idx
  ON lcm_large_files (canonical_path, path_size_bytes, path_mtime_ms, path_content_sha256);
CREATE INDEX lcm_large_files_artifact_created_idx
  ON lcm_large_files (conversation_id, artifact_storage_kind, created_at_ms);
CREATE INDEX lcm_large_files_exploration_status_idx
  ON lcm_large_files (conversation_id, exploration_status, updated_at_ms);

CREATE TABLE lcm_artifact_cleanup_queue (
  cleanup_id text PRIMARY KEY,
  artifact_path text NOT NULL,
  first_seen_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text
);

CREATE UNIQUE INDEX lcm_artifact_cleanup_queue_path_unique
  ON lcm_artifact_cleanup_queue (artifact_path);
CREATE INDEX lcm_artifact_cleanup_queue_updated_idx
  ON lcm_artifact_cleanup_queue (updated_at_ms);

CREATE TABLE lcm_message_parts (
  part_row_id text PRIMARY KEY,
  message_row_id text NOT NULL REFERENCES lcm_messages(message_row_id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_part_id text,
  source_part_key text NOT NULL,
  part_order integer NOT NULL,
  part_kind text NOT NULL CHECK (
    part_kind IN (
      'text',
      'reasoning',
      'file',
      'tool',
      'step-start',
      'step-finish',
      'snapshot',
      'patch',
      'agent',
      'retry',
      'compaction',
      'subtask'
    )
  ),
  ignored boolean NOT NULL DEFAULT false,
  synthetic boolean NOT NULL DEFAULT false,
  compatibility boolean NOT NULL DEFAULT false,
  terminal_state text CHECK (terminal_state IS NULL OR terminal_state IN ('completed', 'error')),
  text_content text,
  reasoning_content text,
  tool_call_id text,
  tool_name text,
  tool_input_json jsonb,
  tool_output_text text,
  tool_error_text text,
  file_url text,
  media_mime text,
  media_name text,
  provider_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  render_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_storage_kind text NOT NULL DEFAULT 'inline' CHECK (content_storage_kind IN ('inline', 'lcm_file')),
  content_file_id text,
  content_byte_count bigint,
  content_sha256 text,
  search_text text NOT NULL DEFAULT '',
  created_at_ms bigint NOT NULL,
  completed_at_ms bigint,
  CONSTRAINT lcm_message_parts_content_file_conversation_fk
    FOREIGN KEY (content_file_id, conversation_id)
    REFERENCES lcm_large_files(file_id, conversation_id),
  CONSTRAINT lcm_message_parts_content_storage_check CHECK (
    (
      content_storage_kind = 'inline'
      AND content_file_id IS NULL
    )
    OR (
      content_storage_kind = 'lcm_file'
      AND content_file_id IS NOT NULL
      AND content_byte_count IS NOT NULL
      AND content_sha256 IS NOT NULL
      AND text_content IS NULL
      AND reasoning_content IS NULL
      AND tool_output_text IS NULL
      AND tool_error_text IS NULL
    )
  )
);

CREATE UNIQUE INDEX lcm_message_parts_source_part_key_unique
  ON lcm_message_parts (message_row_id, source_part_key);
CREATE UNIQUE INDEX lcm_message_parts_source_part_id_unique
  ON lcm_message_parts (message_row_id, source_part_id)
  WHERE source_part_id IS NOT NULL;
CREATE INDEX lcm_message_parts_order_idx
  ON lcm_message_parts (conversation_id, message_row_id, part_order, part_row_id);
CREATE INDEX lcm_message_parts_content_file_id_idx
  ON lcm_message_parts (content_file_id);
CREATE INDEX lcm_message_parts_search_text_trgm_gin
  ON lcm_message_parts USING gin (search_text gin_trgm_ops);

CREATE TABLE lcm_summaries (
  summary_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  summary_type text NOT NULL CHECK (summary_type IN ('sprig', 'bindle', 'archive_stub')),
  content_text text NOT NULL,
  source_token_count integer NOT NULL,
  summary_token_count integer NOT NULL,
  summary_level integer NOT NULL DEFAULT 0,
  prompt_version text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('upward', 'dolt')),
  provider_id text,
  model_id text,
  usage_record_id text REFERENCES lcm_usage_records(usage_record_id) ON DELETE SET NULL,
  objective_status text NOT NULL,
  fallback_mode text NOT NULL CHECK (fallback_mode IN ('none', 'truncated_prefix', 'extractive_key_points')),
  created_at_ms bigint NOT NULL
);

CREATE INDEX lcm_summaries_conversation_type_created_idx
  ON lcm_summaries (conversation_id, summary_type, created_at_ms, summary_id);
CREATE INDEX lcm_summaries_conversation_type_level_created_idx
  ON lcm_summaries (conversation_id, summary_type, summary_level, created_at_ms, summary_id);
CREATE INDEX lcm_summaries_content_text_trgm_gin
  ON lcm_summaries USING gin (content_text gin_trgm_ops);

CREATE TABLE lcm_summary_messages (
  summary_id text NOT NULL REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  message_row_id text NOT NULL REFERENCES lcm_messages(message_row_id) ON DELETE CASCADE,
  source_order integer NOT NULL,
  PRIMARY KEY (summary_id, message_row_id)
);

CREATE INDEX lcm_summary_messages_message_idx
  ON lcm_summary_messages (message_row_id);
CREATE INDEX lcm_summary_messages_summary_order_idx
  ON lcm_summary_messages (summary_id, source_order);

CREATE TABLE lcm_summary_parents (
  summary_id text NOT NULL REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  parent_summary_id text NOT NULL REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  parent_order integer NOT NULL,
  PRIMARY KEY (summary_id, parent_summary_id)
);

CREATE INDEX lcm_summary_parents_parent_idx
  ON lcm_summary_parents (parent_summary_id);
CREATE INDEX lcm_summary_parents_summary_order_idx
  ON lcm_summary_parents (summary_id, parent_order);

CREATE TABLE lcm_summary_lineage_pointers (
  pointer_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  summary_id text NOT NULL REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  root_summary_id text NOT NULL REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  pointer_kind text NOT NULL CHECK (pointer_kind IN ('archive_stub', 'repair')),
  created_at_ms bigint NOT NULL
);

CREATE INDEX lcm_summary_lineage_pointers_conversation_summary_idx
  ON lcm_summary_lineage_pointers (conversation_id, summary_id);
CREATE INDEX lcm_summary_lineage_pointers_root_idx
  ON lcm_summary_lineage_pointers (root_summary_id);

CREATE TABLE lcm_context_items (
  context_item_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  item_order integer NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('raw_message', 'summary', 'archive_stub', 'large_file_marker', 'retrieval_cue')),
  message_row_id text REFERENCES lcm_messages(message_row_id) ON DELETE CASCADE,
  summary_id text REFERENCES lcm_summaries(summary_id) ON DELETE CASCADE,
  pointer_id text REFERENCES lcm_summary_lineage_pointers(pointer_id) ON DELETE CASCADE,
  file_id text REFERENCES lcm_large_files(file_id) ON DELETE CASCADE,
  cue_payload_json jsonb,
  cue_id text,
  cue_lifecycle_state text,
  cue_superseded_by_id text,
  cue_superseded_by_generation_id text,
  cue_target_source_message_id text,
  cue_generation_id text,
  token_count integer,
  cache_key text,
  cache_version integer,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  CONSTRAINT lcm_context_items_reference_check CHECK (
    (
      item_type = 'raw_message'
      AND message_row_id IS NOT NULL
      AND summary_id IS NULL
      AND pointer_id IS NULL
      AND file_id IS NULL
      AND cue_payload_json IS NULL
    )
    OR (
      item_type = 'summary'
      AND message_row_id IS NULL
      AND summary_id IS NOT NULL
      AND pointer_id IS NULL
      AND file_id IS NULL
      AND cue_payload_json IS NULL
    )
    OR (
      item_type = 'archive_stub'
      AND message_row_id IS NULL
      AND summary_id IS NOT NULL
      AND pointer_id IS NOT NULL
      AND file_id IS NULL
      AND cue_payload_json IS NULL
    )
    OR (
      item_type = 'large_file_marker'
      AND message_row_id IS NULL
      AND summary_id IS NULL
      AND pointer_id IS NULL
      AND file_id IS NOT NULL
      AND cue_payload_json IS NULL
    )
    OR (
      item_type = 'retrieval_cue'
      AND message_row_id IS NULL
      AND summary_id IS NULL
      AND pointer_id IS NULL
      AND file_id IS NULL
      AND cue_payload_json IS NOT NULL
    )
  )
  ,
  CONSTRAINT lcm_context_items_cue_lifecycle_check CHECK (
    (
      item_type = 'retrieval_cue'
      AND cue_id IS NOT NULL
      AND cue_payload_json IS NOT NULL
      AND cue_lifecycle_state IN ('active', 'superseded', 'tombstoned')
      AND cue_target_source_message_id IS NOT NULL
      AND cue_generation_id IS NOT NULL
    )
    OR (
      item_type <> 'retrieval_cue'
      AND cue_id IS NULL
      AND cue_payload_json IS NULL
      AND cue_lifecycle_state IS NULL
      AND cue_superseded_by_id IS NULL
      AND cue_superseded_by_generation_id IS NULL
      AND cue_target_source_message_id IS NULL
      AND cue_generation_id IS NULL
    )
  )
);

CREATE UNIQUE INDEX lcm_context_items_conversation_order_unique
  ON lcm_context_items (conversation_id, item_order);
CREATE INDEX lcm_context_items_type_order_idx
  ON lcm_context_items (conversation_id, item_type, item_order);
CREATE INDEX lcm_context_items_message_idx
  ON lcm_context_items (message_row_id);
CREATE INDEX lcm_context_items_summary_idx
  ON lcm_context_items (summary_id);
CREATE INDEX lcm_context_items_pointer_idx
  ON lcm_context_items (pointer_id);
CREATE INDEX lcm_context_items_file_idx
  ON lcm_context_items (file_id);
CREATE UNIQUE INDEX lcm_context_items_conversation_cue_unique
  ON lcm_context_items (conversation_id, cue_id);
CREATE INDEX lcm_context_items_active_cue_target_idx
  ON lcm_context_items (conversation_id, item_type, cue_lifecycle_state, cue_target_source_message_id);
CREATE INDEX lcm_context_items_cue_generation_idx
  ON lcm_context_items (conversation_id, cue_generation_id);
CREATE INDEX lcm_context_items_cue_superseded_generation_idx
  ON lcm_context_items (conversation_id, cue_superseded_by_generation_id);
CREATE INDEX lcm_context_items_cue_id_idx
  ON lcm_context_items (cue_id);

CREATE TABLE lcm_provider_request_snapshots (
  request_snapshot_id text PRIMARY KEY,
  operation_id text NOT NULL,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  source_session_id text NOT NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_flight', 'resolved', 'canceled', 'expired')),
  cue_ids_json jsonb NOT NULL,
  render_unit_ids_json jsonb NOT NULL,
  source_selection_hash text NOT NULL,
  request_snapshot_protection_hash text NOT NULL,
  visibility_hash text NOT NULL,
  protected_span_hash text NOT NULL,
  provider_transform_hash text NOT NULL,
  provider_validator_hash text,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  terminal_at_ms bigint,
  CONSTRAINT lcm_provider_request_snapshots_terminal_check CHECK (
    (status = 'in_flight' AND terminal_at_ms IS NULL)
    OR (status IN ('resolved', 'canceled', 'expired') AND terminal_at_ms IS NOT NULL)
  ),
  CONSTRAINT lcm_provider_request_snapshots_expiry_check CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX lcm_provider_request_snapshots_conversation_status_expiry_idx
  ON lcm_provider_request_snapshots (conversation_id, status, expires_at_ms);
CREATE INDEX lcm_provider_request_snapshots_operation_idx
  ON lcm_provider_request_snapshots (operation_id);
CREATE INDEX lcm_provider_request_snapshots_cue_ids_gin_idx
  ON lcm_provider_request_snapshots USING gin (cue_ids_json);

CREATE TABLE lcm_provider_request_snapshot_items (
  request_snapshot_id text NOT NULL REFERENCES lcm_provider_request_snapshots(request_snapshot_id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  render_unit_id text NOT NULL,
  context_item_id text REFERENCES lcm_context_items(context_item_id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (
    item_type IN ('raw_message', 'summary', 'archive_stub', 'large_file_marker', 'retrieval_cue')
  ),
  message_row_id text REFERENCES lcm_messages(message_row_id) ON DELETE SET NULL,
  source_kind text NOT NULL,
  item_order integer NOT NULL CHECK (item_order >= 0),
  PRIMARY KEY (request_snapshot_id, render_unit_id)
);

CREATE INDEX lcm_provider_request_snapshot_items_context_idx
  ON lcm_provider_request_snapshot_items (conversation_id, context_item_id);
CREATE INDEX lcm_provider_request_snapshot_items_message_idx
  ON lcm_provider_request_snapshot_items (message_row_id);

CREATE TABLE lcm_context_item_consumption (
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  context_item_id text REFERENCES lcm_context_items(context_item_id) ON DELETE SET NULL,
  message_row_id text NOT NULL REFERENCES lcm_messages(message_row_id) ON DELETE CASCADE,
  first_request_snapshot_id text NOT NULL REFERENCES lcm_provider_request_snapshots(request_snapshot_id)
    ON DELETE CASCADE,
  first_operation_id text NOT NULL,
  first_consumed_at_ms bigint NOT NULL,
  PRIMARY KEY (conversation_id, message_row_id)
);

CREATE INDEX lcm_context_item_consumption_message_idx
  ON lcm_context_item_consumption (message_row_id);
CREATE INDEX lcm_context_item_consumption_snapshot_idx
  ON lcm_context_item_consumption (first_request_snapshot_id);

CREATE TABLE lcm_provider_transform_overheads (
  provider_id text NOT NULL,
  model_id text NOT NULL,
  provider_family text NOT NULL CHECK (
    provider_family IN (
      'openai_compatible',
      'copilot',
      'anthropic',
      'mistral',
      'interleaved_reasoning',
      'generic'
    )
  ),
  max_observed_tokens integer NOT NULL CHECK (max_observed_tokens >= 0),
  last_observed_tokens integer NOT NULL CHECK (last_observed_tokens >= 0),
  sample_count integer NOT NULL CHECK (sample_count >= 1),
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (provider_id, model_id, provider_family)
);

CREATE INDEX lcm_provider_transform_overheads_updated_idx
  ON lcm_provider_transform_overheads (updated_at_ms);

CREATE TABLE lcm_context_snapshots (
  snapshot_id text PRIMARY KEY,
  conversation_id text REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  created_at_ms bigint NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('upward', 'dolt')),
  active_tokens integer NOT NULL,
  hard_limit integer NOT NULL,
  soft_threshold integer NOT NULL,
  soft_backlog_tokens integer,
  soft_backlog_item_count integer,
  context_item_count integer NOT NULL,
  token_counter_mode text NOT NULL CHECK (token_counter_mode IN ('provider', 'deterministic_fallback', 'fake')),
  token_counter_version text NOT NULL,
  lane_counts_json jsonb NOT NULL,
  metrics_json jsonb NOT NULL,
  restore_manifest_json jsonb NOT NULL
);

CREATE INDEX lcm_context_snapshots_conversation_created_idx
  ON lcm_context_snapshots (conversation_id, created_at_ms);

CREATE TABLE lcm_id_aliases (
  alias_id text PRIMARY KEY,
  canonical_id text NOT NULL,
  id_kind text NOT NULL CHECK (id_kind IN ('summary', 'file')),
  conversation_id text NOT NULL REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  created_at_ms bigint NOT NULL
);

CREATE INDEX lcm_id_aliases_canonical_idx
  ON lcm_id_aliases (canonical_id);
CREATE INDEX lcm_id_aliases_conversation_kind_idx
  ON lcm_id_aliases (conversation_id, id_kind);

CREATE TABLE lcm_map_runs (
  map_id text PRIMARY KEY,
  conversation_id text REFERENCES lcm_conversations(conversation_id) ON DELETE CASCADE,
  tool_kind text NOT NULL CHECK (tool_kind IN ('llm_map', 'agentic_map')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  source_tool_call_id text,
  request_fingerprint text NOT NULL,
  input_file_id text NOT NULL REFERENCES lcm_large_files(file_id),
  output_file_id text REFERENCES lcm_large_files(file_id),
  worker_count integer NOT NULL CHECK (worker_count > 0),
  max_retries integer NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 5),
  prompt_text text NOT NULL,
  prompt_sha256 text NOT NULL,
  model_selection_json jsonb NOT NULL,
  agentic_mode text CHECK (agentic_mode IS NULL OR agentic_mode IN ('read_only', 'write_capable')),
  schema_json jsonb NOT NULL,
  schema_sha256 text NOT NULL,
  safe_error_json jsonb,
  owner_id text,
  lease_expires_at_ms bigint,
  lease_heartbeat_at_ms bigint,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX lcm_map_runs_conversation_created_idx
  ON lcm_map_runs (conversation_id, created_at_ms);
CREATE INDEX lcm_map_runs_tool_call_idx
  ON lcm_map_runs (conversation_id, tool_kind, source_tool_call_id)
  WHERE source_tool_call_id IS NOT NULL;
CREATE INDEX lcm_map_runs_request_fingerprint_idx
  ON lcm_map_runs (conversation_id, request_fingerprint);
CREATE INDEX lcm_map_runs_status_lease_idx
  ON lcm_map_runs (status, lease_expires_at_ms);

CREATE TABLE lcm_map_items (
  map_id text REFERENCES lcm_map_runs(map_id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'retryable', 'failed', 'canceled')),
  attempts integer NOT NULL CHECK (attempts >= 0),
  owner_id text,
  lease_expires_at_ms bigint,
  lease_heartbeat_at_ms bigint,
  error_code text,
  safe_error_json jsonb,
  output_json jsonb,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (map_id, item_index)
);

CREATE INDEX lcm_map_items_claim_idx
  ON lcm_map_items (map_id, status, item_index);
CREATE INDEX lcm_map_items_status_lease_idx
  ON lcm_map_items (status, lease_expires_at_ms);
