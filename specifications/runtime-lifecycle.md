# Runtime, Lifecycle, And Maintenance

This document describes the current `LcmRuntime` behavior observed in `runtime.ts`, `lifecycle.ts`, `context.ts`, and their prompt/API integrations.

## Runtime Services

The main runtime service is `LcmRuntime.Service` in `packages/opencode/src/session/lcm/runtime.ts`. It is an Effect service with these primary operations:

- `getCapabilities`
- `getOrCreateConversation`
- `getOrCreateChildConversation`
- `acquireChildSessionSlot`
- `syncFinalizedMessages`
- `preflightBeforeModel`
- `queueSoftMaintenanceAfterTurn`
- `cancelDeferredMaintenance`
- `runManualMaintenance`
- `finalizeProviderRequestSnapshot`
- `recordProviderRequestSnapshotFinalValidation`
- settings read/update
- session deletion cleanup
- usage record writes
- retrieval, file exploration, and map tool dispatch

`LcmContext.Service` in `context.ts` owns active context assembly and maintenance. `LcmDb.Service` owns family DB startup and foreground/background DB execution.

## Lifecycle States

Current lifecycle states in `types.ts`:

- `passive_synced`
- `lcm_active`
- `legacy_read_only`
- `recovery_required`
- `recovery_failed`
- `db_unavailable`

Initial conversation state is computed by `lifecycle.ts`:

- Sessions with zero or one Kilo messages start as `lcm_active`.
- Other sessions, including sessions that contain old Kilo compaction markers, start as `passive_synced` until prompt-time activation proves finalized source and rebuildable active context.
- Existing `legacy_read_only` rows are normalized back to the same `lcm_active` or `passive_synced` initial state on access. The runtime continues from the persisted history that remains instead of invoking old lossy pruning.

## Capabilities

`getCapabilities({ sessionID })` returns:

- session and optional conversation IDs
- lifecycle state
- strategy
- DB readiness and optional DB status
- booleans for `lcmActive`, `canAssemble`, `canMaintain`, and `canRetrieve`
- optional safe error

`lcmActive` is true only for `lcm_active`. Prompt history selection treats both `lcm_active` and `passive_synced` as LCM-managed states and uses the full persisted message stream before preflight finishes prompt-time activation. Legacy compacted-history filtering is reserved for unavailable, recovery, or unsupported states that will not proceed to a normal provider request. Retrieval requires the active lifecycle state plus valid boundary metadata and valid capability metadata. Malformed child capability metadata makes retrieval unavailable even if a conversation row exists.

## Boundary And Capability Proof

`lifecycle.ts` records boundary metadata for each conversation and validates it before scope-sensitive operations. Conversation scope includes:

- current conversation
- authorized ancestors
- project/workspace/session/worktree boundary data
- capability class
- whether capability proof succeeded
- whether direct content tools are allowed
- source coverage counts

Child classes are trusted only when reconstructable from runtime metadata:

- `root`: ordinary session, no parent.
- `task_child`: child created by Kilo task orchestration. Direct expansion is available; direct reads require read-capable metadata.
- `explore_child`: exploration child. Direct expansion and reads are allowed within provenance and permission limits.
- `map_child`: agentic map child. Capability proof checks the owning map run/item and agentic mode.

Model-supplied capability class or conversation IDs are not trusted by retrieval or map operations.

## Prompt-Time Preflight

The normal provider path in `session/prompt.ts` prepares prompt render inputs, validates active render-only metadata for LCM-active sessions, and calls `preflightBeforeModel(...)` before streaming to the model. If prompt-time render preparation returns `LcmSafeError`, the assistant message is completed with a content-safe `LcmMemoryError`, the session error event is published, and no provider request is sent.

After a terminal assistant response, prompt-side finalized-source sync uses `finalized-sync-retry.ts`. A failed post-turn sync logs a content-safe diagnostic, publishes one `LcmMemoryError` warning event, persists content-safe pending retry state under the runtime-owned LCM control directory, retries before the next turn even after runtime restart, and schedules one in-process background retry when the safe error is retryable. A later preflight sync remains the authoritative gate before any provider request.

Preflight currently performs these steps:

1. Resolve model/provider/strategy settings and DB readiness.
2. Get or create the LCM conversation.
3. Sync finalized MessageV2 rows up to the prompt-time visibility boundary.
4. Reject recovery, DB, missing-source, and malformed capability states with `canProceed = false`.
5. For `passive_synced`, prove activation from finalized source and rebuildable active context before updating the lifecycle to `lcm_active`.
6. Prepare active context and retrieval cues, then compute token thresholds.
7. Run blocking hard-limit maintenance when active tokens exceed the hard limit.
8. Assemble provider-safe model messages and record provider request snapshots.
9. Return `canProceed = true` with conversation ID, threshold decision, and assembly result.

If any required proof fails, preflight returns a blocked result with `safeError`. LCM-active sessions do not fall back to legacy context pruning. Preflight normalizes safe errors that reach this boundary so retryable storage/provider/internal preparation failures carry `action = "retry"`, owner locks carry `close_other_owner`, missing current-turn proof or missing finalized-sync boundaries carry `repeat_input`, unrecoverable hard-limit/legacy continuation carries `start_new_thread`, and corruption, unsupported source shapes, large-payload integrity failures, or missing runtime services carry `contact_support`. The catch-all preflight failure path preserves an existing `LcmSafeError` when one reached the runtime boundary and derives lifecycle from the observed capabilities or the safe-error class; it reports `db_unavailable` only for DB-class safe errors.

## Provider Execution

When preflight succeeds, `session/prompt.ts` uses the `preparedProviderPayload` from LCM assembly rather than re-rendering legacy history. The payload contains:

- system messages
- model messages
- tools
- optional tool choice
- output format
- render/provenance metadata carried inside `LcmPreparedProviderPayload`

`session/llm.ts` wraps the provider language model and validates the final provider-transformed message payload through `validateLcmFinalProviderPayload(...)`. If validation fails, it throws `LcmSafeErrorFailure`. If validation succeeds, it records the final provider validator hash and provider-transform overhead observation back through the provider request snapshot path.

`session/prompt.ts` finalizes request snapshots as `resolved` on successful exit and `canceled` on failure/interruption. When a snapshot resolves, the runtime records which raw context items were included in that provider request. Soft backlog selection treats a post-current raw row as consumed only after such a resolved snapshot; canceled, expired, or failed requests do not prove consumption.

## Maintenance Modes

Maintenance uses `LcmContext.compactLeavesToSprig(...)` and `LcmContext.compactUntilUnderHardLimit(...)`.

Modes:

- Soft maintenance: checked after every successful LCM-managed assistant step. The prompt loop still runs the after-turn check after a terminal assistant response, and `SessionProcessor` also signals safe checkpoints as soon as a non-tool assistant step is finalized or a tool/subagent result is persisted as completed/error. The prompt-owned checkpoint syncs finalized source before queueing maintenance only after the assistant message has sealed terminal metadata, including `time.completed`; earlier checkpoint signals defer to the post-process sync path so mutable assistant metadata is not ingested as immutable source. The checkpoint path skips running/streaming parts and suppresses the duplicate after-turn queue for the same assistant message only when it actually queued maintenance. For the first release, provider-backed over-soft maintenance is awaited before the next model step and uses foreground provider/DB priority so local provider foreground traffic cannot starve memory maintenance. The check recomputes and persists the current threshold snapshot so `rawLaneTokens`/soft-pressure metrics advance after finalized source sync. Provider-backed maintenance runs only when that fresh threshold is over soft and useful raw backlog exists; over-soft can be caused by global soft-threshold pressure, below-soft raw-backlog debt, or an active lane latch. Below-soft raw-backlog debt requires active tokens to remain at or below the global soft threshold while eligible raw backlog outside mandatory protection and the configured fresh tail exceeds the raw-lane target and has at least the minimum summarizable message count. Routine below-soft checks that do not meet those bounds refresh metrics without recording durable no-op maintenance attempts.
- Blocking hard-limit maintenance: runs before the provider call when the active context is over the hard threshold.
- Manual/repair maintenance: available through runtime/API semantics, but not presented as a routine active-session user workflow in the VSCode settings UI.

Soft maintenance receives the finalized current user identity from the prompt loop and resolves it to a raw `lcm_messages` user row. That current-user row is always mandatory. Newer raw rows are mandatory only until a later resolved provider request snapshot proves the model consumed them. After mandatory rows are removed from consideration, the runtime protects a configurable whole-message fresh tail from the newest remaining raw rows; the default fresh-tail budget is 20,000 tokens, and the newest candidate stays protected even when it alone exceeds the budget. If the current-user boundary cannot be proven as an active raw memory row, the maintenance pass returns a content-safe `skipped` result before provider work. If threshold recomputation reports stale active-context order for that boundary, the runtime rebuilds active context once and retries the threshold check before deciding whether to defer or fail.

The legacy-compatible `POST /:sessionID/summarize` route remains for existing clients, but it no longer creates `compaction` user parts or calls the legacy prompt loop. The route initializes the session conversation when needed, syncs finalized durable Kilo messages into LCM source rows, and delegates to `runManualMaintenance(...)`. It preserves the existing boolean success response for compatibility and converts any returned `LcmSafeError` into the normal content-safe LCM route error response.

Session DB diagnosis is a read-only runtime-owned support action. `diagnoseDb(...)` derives the family root from trusted session lineage, uses the existing runtime DB worker when the family is already open, and otherwise runs the same content-safe diagnose path used by the debug CLI. It reports check names/statuses, schema version, operation ID, selected family data directory, safe errors, and quarantine recommendation only. Diagnose checks include owner-lock/layout presence, migration registry readability, FTS/search extension and retrieval index readiness, deferred maintenance queue readability, large-payload marker readability, path-provenance row readability, map status row readability, and artifact cleanup queue readability. It does not browse, export, or directly expose memory rows.

Session DB rebuild is a guided runtime-owned support action. `rebuildDb(...)` derives the family root from trusted session lineage and defaults to dry-run preview. Apply mode refuses healthy or otherwise non-repairable family state, only proceeds for corruption/unavailable diagnoses, closes the runtime-owned family worker before mutation when present, quarantines the family `pglite/` directory, initializes a fresh family DB, and then resyncs the active session from finalized durable Kilo messages. Reports are content-safe counts and safe errors only; arbitrary data-directory repair and extension-host DB ownership are not supported.

Status labels in `events.ts` are content-safe:

- Blocking: `Preparing memory for this response...`, with hard-limit subpass labels `Summarizing older memory...`, `Merging memory summaries...`, and `Archiving older memory...`
- Prompt preflight: `Opening memory...`, `Syncing memory...`, `Rebuilding memory context...`, `Finding relevant memory...`, `Checking memory size...`, and `Preparing memory for the model...`
- Background pending: `Memory maintenance scheduled.`
- Background running: `Summarizing memory in background...`
- Awaited first-release soft maintenance uses the normal blocking memory labels while it is preparing/summarizing memory between finalized model steps.

Soft maintenance is capped by scheduler settings:

- one soft-maintenance pass per conversation at a time
- two background maintenance model jobs per resolved workspace/project key
- child-session caps of eight per root and sixteen per workspace

The soft-maintenance cap is enforced from explicit session family scope: workspace ID when present, otherwise project ID, with the family ID only as a debug/test fallback. This prevents one workspace's background memory work from consuming another workspace's cap.

A queued soft-maintenance sweep is one runtime invocation of `compactLeavesToSprig(...)` for the `leaf_summary` route. Internal defaults cap each sweep to one provider-backed pass and 60 seconds of pre-pass elapsed time before another retry must be scheduled. If the pass or elapsed budget is exhausted before provider work starts, the result is content-safe `deferred` maintenance with `sweepStopReason = "iteration_cap"` or `sweepStopReason = "elapsed_cap"`; elapsed-cap stops use retryable `timeout`. Terminal soft results carry optional sweep telemetry (`sweepPassesCompleted`, `sweepMaxPasses`, `sweepElapsedMs`, `sweepMaxElapsedMs`, `sweepStopReason`) so UI/status consumers can distinguish completed, no-work, canceled, provider-capacity, and backoff outcomes without inspecting raw source or provider output.

Soft-pressure diagnostics are content-safe. Threshold snapshots, metrics events, context-updated events, and maintenance events may include `freshTailTokens`, fresh-tail raw counts, unconsumed post-current raw counts, `softBacklogLargestSourceTokens`, `softPressureReason`, and `laneLatchDiagnostics`. `softPressureReason` distinguishes `global_soft_threshold`, `below_soft_raw_backlog`, and `lane_latch`; latch diagnostics expose only lane keys, token pressures, target tokens, reasons, timestamps, phases, and next actions. Metrics snapshots also expose active tokens, soft/hard thresholds, output reserve, provider context/input/output limits, system/tool overhead tokens, protected-tail raw counts, raw backlog, lane token counts, context item counts, provider budget fallback status, storage warning status, and queued deferred soft-maintenance debt (`deferredSoftMaintenanceQueued`, queued count, max attempt count, and next run timestamp). These fields are counts, enums, timers, and normalized limits only.

Lane latching is runtime-memory state, not persisted DB schema. Raw leaves, sprigs, and bindles enter a latch when threshold policy selects a useful maintenance action above that lane's target, including hard-limit bypass decisions. A latch keeps the lane eligible while observed pressure remains above target and eligible items still exist; it exits at or below target, when no eligible items remain, or when the strategy changes. Failed, canceled, or safe-error terminal maintenance clears the active latches named by that threshold decision so a hidden in-memory latch cannot survive a failed pass. Runtime restart naturally drops latch state; no migration or storage-schema row is required.

Deferred soft-threshold maintenance is retried by the runtime with capped exponential backoff. Retries are coalesced per conversation, written to the family DB in `lcm_deferred_jobs`, and rerun through the normal `queueSoftMaintenanceAfterTurn(...)` path. `getCapabilities(...)` rehydrates queued soft-maintenance jobs for active sessions after runtime restart; the persisted payload stores provider/model/render metadata and the content-safe protected-current-user identity, but not raw memory content or per-turn abort signals. `cancelDeferredMaintenance(...)` is the runtime-owned user cancel path for queued soft-maintenance retries: it clears any in-process timer, terminalizes only `queued` persisted jobs as `canceled`, records a content-safe maintenance attempt, and publishes metrics/events for the active session. It does not stop already-running maintenance and does not by itself cancel blocking hard-limit maintenance; prompt/run cancellation uses the separate runtime abort-signal path. Runtime shutdown cancels queued deferred retry timers, but gives already-running deferred retry work a bounded grace period to record its terminal state before closing the family DB. Retryable soft-maintenance failures such as provider unavailable, DB unavailable/busy, timeout, and soft leaf-summary objective rejection use the same retry path so local model or storage pressure can clear before the next hard-limit prompt. Retryable DB lock errors that require the user-facing `close_other_owner` action are not auto-retried by this soft-maintenance helper.

Soft summary-route failures are counted in runtime memory by conversation, maintenance purpose, prompt version, provider ID, and model ID. After repeated retryable leaf-summary failures, `queueSoftMaintenanceAfterTurn(...)` returns a content-safe deferred result with `sweepStopReason = "backoff"` until the cooldown expires. A soft leaf-summary output rejected by objective checks returns `deferred` without exposing the rejected text and enters the same deferred-job retry path. The result/event may include `summaryPromptVersion`, `summaryBackoffPurpose`, `summaryBackoffFailureCount`, `summaryBackoffDelayMs`, and `summaryBackoffRemainingMs`; these are counters/timers only and do not include provider error text. The deferred job retry delay honors the larger of the normal capped retry delay and the remaining cooldown, and the persisted deferred-job row remains coalesced by conversation so repeated turns do not accumulate duplicate work for the same soft debt. Successful, no-op, skipped, or otherwise non-retryable soft outcomes clear the runtime-memory backoff state. Blocking hard-limit maintenance does not consult this soft backoff map and can still run when soft maintenance is cooling down.

Hard-limit maintenance can run multiple rounds up to `RUNTIME_DEFAULTS.thresholds.maxBlockingRounds = 10`. Under hard pressure, eligible raw leaves can be summarized even when they are below the normal soft-maintenance leaf chunk target; the blocking path uses an adaptive source budget based on current hard-limit excess so small-provider windows can still make progress. If maintenance cannot reduce active context below the hard limit, the runtime returns `hard_limit_unresolved` with a diagnostic that distinguishes no compressible items from unresolved pressure after maintenance work.

For prompt preflight, the current user source row resolved from render preparation is excluded from hard-limit leaf summarization. If finalized-source sync discovers that this user row already exists but is no longer present as a raw active-context item, sync re-pins that single row before budget checks so threshold counting and provider assembly can prove the target turn instead of failing with a missing raw leaf.

Hard-limit maintenance is also elapsed-time bounded. If the elapsed cap is hit first, the runtime returns a retryable `timeout` safe error rather than a generic unresolved hard-limit error. The failed maintenance result preserves durable partial work evidence such as `summariesCreated`, `contextItemsReplaced`, and `afterTokens`, so the next retry can continue from any summaries already committed.

Hard-limit maintenance cooperatively honors the prompt/run abort signal between safe subpass boundaries. The loop checks cancellation before and after progress updates, before summary selection/commit boundaries, after committed work has been counted, between condensation/archive attempts, and before returning the final result. Cancellation returns a `canceled` maintenance result with a content-safe safe error and preserves already-committed work counters. It does not interrupt an owned DB transaction or provider call mid-mutation; those complete or roll back before the next cancellation checkpoint.

Prompt-time preflight updates the normal session status with the fixed prompt-preflight labels while it opens memory storage, syncs finalized source, rebuilds active context, refreshes retrieval cues, checks the active budget, runs blocking hard-limit subpasses, and assembles the provider payload. Blocked or interrupted preflight clears runtime-owned memory preparation labels before returning a content-safe result. Blocking hard-limit preflight and manual hard-limit maintenance set the session status to `Preparing memory for this response...` while they run, then report content-safe subpass labels as raw leaves are summarized, summary lanes are merged, or older memory is archived. Both paths restore runtime-owned memory preparation labels through guaranteed cleanup even when maintenance startup, status event publishing, or metrics publishing fails.

LCM DB shutdown rejects queued work immediately, aborts the active request through the worker's cooperative request control, cancels queued deferred soft-maintenance timers, and waits only bounded intervals for active DB requests and already-running deferred soft-maintenance retries to drain before provider snapshot cleanup, DB close, and owner-lock release. This prevents extension/runtime shutdown from hanging indefinitely on foreground or background memory work while still allowing normal active requests and in-flight retry terminalization to finish when they drain promptly.

Foreground DB work keeps priority for normal chat responsiveness, but the worker admits one queued background request after a bounded foreground burst when background work is waiting. This prevents repeated foreground traffic from starving scheduled memory maintenance indefinitely.

The DB worker has bounded foreground/background queues. Queue-full failures return retryable, content-safe `db_unavailable` errors instead of accepting unbounded memory work. `LcmDbStatus.queue` reports only counts, limits, active lane/purpose enums, and aggregate rejected/canceled/timed-out counters. Prompt-critical sync, token-budget, assembly, and maintenance DB requests use bounded request timeouts by default, as do retrieval, large-file, and map requests. Runtime prompt-preflight creates a scoped `AbortSignal`; source sync, memory-cue retrieval, context rebuild/cue/threshold/assembly DB requests, threshold render-preparation/counting phases, provider assembly render-preparation/counting phases, provider-backed hard-limit summary generation, and blocking hard-limit subpass loops pass or check that signal so user cancellation can stop queued, active, or CPU/render-prep work before provider/request snapshots are written. Provider-backed summary waits also race cancellation, so a non-cooperative provider generator cannot keep the prompt-visible memory operation busy and late summary output is ignored. Large-file path registration and read helpers check caller cancellation around metadata, permission, hashing, row lookup, artifact validation, and final insert/read boundaries. File-exploration helper/provider summaries receive a runtime abort signal and the status path races timeout/cancel outcomes against non-cooperative work so the user-visible exploration status can finish as `timeout` or `canceled`. Finalized-source sync checks the active worker signal while loading, mapping, and committing message rows so cancellation does not wait for the whole sync batch to finish. Memory-cue retrieval checks active cancellation between current-turn load, query matching, file-handle lookup, and cue capping so canceled prompt preflight does not keep doing retrieval work after the user stops the turn.

If the owner lock is lost after startup, heartbeat/request verification downgrades the DB worker to `locked` or `unavailable` with a content-safe safe error. Queued and future work is rejected instead of continuing against a DB handle that no longer owns the family.

## Strategies

Public strategy values:

- `upward`
- `dolt`

Default strategy: `upward`.

Current strategy controls compaction selection, summary fanout, fresh-tail preservation, and archive-stub behavior. Strategy is stored in normal Kilo config, not in a per-session LCM switch.

## Settings Runtime

Public settings in `config.ts`:

- `strategy`
- `freshTailTokens`
- `storage.warningThresholdBytes`

Default fresh-tail budget: `20,000` tokens.

Default storage warning threshold: `10,737,418,240` bytes.

Primary `/lcm/settings` reads/writes use normal Kilo config through `Config.Service` and do not open PGlite. `settings-state.ts` resolves trusted session/project/workspace scope, validates public update fields, and projects config into effective scope `workspace`, `project`, or `default`; `runtime.ts` performs the Config.Service orchestration.

Session-scoped settings routes resolve the same writable config state from the trusted session path, then attach runtime-owned capability state for that session when available. This is how Memory prefs receive `lifecycleState`, `dbStatus`, and any capability safe error for the active conversation. These fields are derived diagnostics only: they are not writable settings, they do not create a per-session config row, and they do not give VSCode or webview code direct DB ownership.

Invalid settings input returns content-safe `invalid_request` safe errors. Config-store failures return `settings_unavailable`.

## Local Provider Capacity

`provider-capacity.ts` classifies provider endpoints and gates local Ollama/OpenAI-compatible capacity. Child-session admission and background model jobs can return `provider_capacity_deferred` with safe hashed endpoint identity, capacity class, retryable guidance, and action `retry`.

The runtime records endpoint/capacity metadata without raw URLs. Runtime map dispatch also lowers effective map worker counts before durable run creation for local endpoints, small-model map selectors, or observed foreground provider pressure, so background map throughput does not overwhelm normal chat or maintenance provider calls.

## Failure Modes

LCM failure surfaces use `LcmSafeError` from `types.ts`. Current safe error codes include DB failures, settings failures, not found, unauthorized, invalid request, over limit, timeout, canceled, recovery required/failed, missing source, stale source, permission denied, provider unavailable, hard-limit unresolved, legacy read-only, and provider capacity deferred.

Safe errors carry:

- safe template key and message
- retryable flag
- optional operation, conversation, summary, or file IDs
- optional action such as `retry`, `repeat_input`, `start_new_thread`, `re_register_file`, `delete_session`, `close_other_owner`, or `contact_support`
- diagnostic code for developer evidence

Runtime catch boundaries and persisted safe-error fields validate safe-error-like values through the shared schema before treating them as trusted `LcmSafeError` payloads. This includes lifecycle capability proof, family resolution, retrieval and file helpers, active-context/token-budget/maintenance failures, provider-backed summary cancellation, assistant-message serialization, event normalization, and map status snapshots. Accepted values are normalized to canonical template messages and action consistency; malformed values fall back to the subsystem's content-safe error or are omitted when the DTO field is optional.

## Legacy Compaction Behavior

Legacy compaction markers are persisted-history compatibility data, not a runtime context-management mode. `lifecycle.ts` no longer creates `legacy_read_only` for marker-bearing sessions, and existing `legacy_read_only` conversation rows are moved back to normal LCM activation on access.

`session/prompt.ts` no longer imports `SessionCompaction`, no longer calls `SessionCompaction.process(...)` to continue legacy read-only sessions, and no longer enqueues automatic legacy compaction turns after provider overflow. The default app runtime also does not install `SessionCompaction.defaultLayer`; legacy lossy compaction is not part of normal LCM runtime wiring. Provider overflow after LCM preflight is classified by an explicit LCM-only decision helper, gets up to two LCM recovery retries with progressively stricter provider input reserves, and converts any remaining compact result into a `hard_limit_unresolved` safe error instead of treating it as valid context management.
