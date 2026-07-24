ALTER TABLE lcm_map_runs
  ADD COLUMN parent_session_id text,
  ADD COLUMN submitting_agent text,
  ADD COLUMN parent_directory text,
  ADD COLUMN provider_capacity_class text
    CHECK (
      provider_capacity_class IS NULL OR
      provider_capacity_class IN ('remote_or_unknown', 'local_ollama', 'local_openai_compatible')
    ),
  ADD COLUMN started_at_ms bigint,
  ADD COLUMN last_progress_at_ms bigint;

ALTER TABLE lcm_map_items
  ADD COLUMN execution_phase text
    CHECK (
      execution_phase IS NULL OR
      execution_phase IN ('queued', 'running', 'waiting_capacity', 'retry_delay', 'terminal')
    ),
  ADD COLUMN phase_started_at_ms bigint,
  ADD COLUMN active_ms bigint NOT NULL DEFAULT 0 CHECK (active_ms >= 0);

UPDATE lcm_map_runs run
SET parent_session_id = conversation.source_session_id,
    started_at_ms = CASE WHEN run.status = 'queued' THEN NULL ELSE run.created_at_ms END,
    last_progress_at_ms = run.updated_at_ms
FROM lcm_conversations conversation
WHERE conversation.conversation_id = run.conversation_id;

UPDATE lcm_map_items
SET execution_phase = CASE
      WHEN status = 'running' THEN 'running'
      WHEN status = 'retryable' THEN 'retry_delay'
      WHEN status IN ('completed', 'failed', 'canceled') THEN 'terminal'
      ELSE 'queued'
    END,
    phase_started_at_ms = updated_at_ms;

UPDATE lcm_map_items item
SET status = 'failed',
    execution_phase = 'terminal',
    owner_id = NULL,
    lease_expires_at_ms = NULL,
    lease_heartbeat_at_ms = NULL,
    error_code = 'recovery_required',
    safe_error_json = '{
      "code":"recovery_required",
      "templateKey":"lcm.recovery.missing_source",
      "safeParams":{"action":"repeat_input"},
      "safeMessage":"Some required source was not saved. Repeat the missing input or action.",
      "action":"repeat_input",
      "retryable":false,
      "diagnosticCode":"lcm_map_alpha_restart_required"
    }'::jsonb
FROM lcm_map_runs run
WHERE item.map_id = run.map_id
  AND run.tool_kind = 'agentic_map'
  AND run.status IN ('queued', 'running')
  AND item.status IN ('pending', 'running', 'retryable');

UPDATE lcm_map_runs
SET status = 'failed',
    owner_id = NULL,
    lease_expires_at_ms = NULL,
    lease_heartbeat_at_ms = NULL,
    safe_error_json = '{
      "code":"recovery_required",
      "templateKey":"lcm.recovery.missing_source",
      "safeParams":{"action":"repeat_input"},
      "safeMessage":"Some required source was not saved. Repeat the missing input or action.",
      "action":"repeat_input",
      "retryable":false,
      "diagnosticCode":"lcm_map_alpha_restart_required"
    }'::jsonb,
    last_progress_at_ms = updated_at_ms
WHERE tool_kind = 'agentic_map'
  AND status IN ('queued', 'running');

CREATE INDEX lcm_map_runs_parent_status_idx
  ON lcm_map_runs (parent_session_id, status);

CREATE INDEX lcm_map_items_phase_idx
  ON lcm_map_items (map_id, execution_phase, item_index);
