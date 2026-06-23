# Source Ingestion And Context Assembly

This document describes the current ingestion and active-context assembly path in `source-sync.ts`, `source-drift-repair.ts`, `context.ts`, `provider-payload.ts`, `render-prep.ts`, `token-budget.ts`, `summary.ts`, and prompt integration.

## Finalized Source Ingestion

`source-sync.ts` maps finalized Kilo MessageV2 rows into LCM source rows. It does not treat streaming deltas as immutable source.

The current taxonomy is exported as `MESSAGE_V2_SYNC_TAXONOMY`:

- roles: `user`, `assistant`
- part kinds: `text`, `reasoning`, `file`, `tool`, `step-start`, `step-finish`, `snapshot`, `patch`, `agent`, `retry`, `compaction`, `subtask`
- tool states: `pending`, `running`, `completed`, `error`
- terminal tool states: `completed`, `error`
- file source kinds: `file`, `symbol`, `resource`
- part render flags: `ignored`, `synthetic`, `compatibility`

Assistant messages are ingested only when sealed. Tool parts are ingested only when terminal. Unsealed source increments skipped counters and can produce a `missing_source` safe error in the sync result.

Superseded assistant residue is treated differently from missing committed source. If an unsealed assistant row contains only non-terminal streamed/tool state and a later durable user message exists, sync skips that residue without returning a safe error. If a sealed assistant row contains terminal content plus leftover non-terminal parts and a later durable user message exists, sync ingests the terminal parts and ignores only the superseded residue. This keeps canceled or crashed assistant turns from blocking the next user prompt while preserving finalized user input and terminal assistant content.

## Idempotence And Drift Detection

Source sync is idempotent by source session/message and deterministic source-part key. `source-sync.ts` compares existing rows against newly mapped rows and raises `lcm_source_drift_*` recovery-required safe errors with `action = "start_new_thread"` if immutable source would change. Drift comparison ignores non-source bookkeeping that Kilo can fill in later, including user summary metadata, assistant summary flags, assistant cost, assistant token counts, generated large-file render metadata, and legacy compacted timing markers. If drift appears before the conversation has child conversations, map runs, in-flight provider snapshots, large payload rows, or standalone large-file markers, sync can delete that conversation's derived/source rows and rebuild from durable Kilo messages. Drift outside that rebuild-safe envelope still fails closed.

Plan follow-up handoff preserves the same immutable-source rule. Starting a new follow-up session may create/select the empty target session immediately so the client can switch tabs, but it persists the follow-up user message only after the handover text is final. The plan prompt part is not inserted early and then mutated after it could be ingested as source.

Raw context items are attached idempotently when source rows or finalized parts are newly synced. This includes messages whose metadata row was inserted earlier without parts, then later receives finalized parts. Prompt preflight also treats its `upToMessageID` user message as continuation-critical: if that sealed user source row already exists but its raw context item is missing because the active context was summarized, rebuilt, or otherwise repaired, sync re-pins that one user row as raw context without resurrecting older summarized history. A sync that performs only this raw-context repair reports `idempotent = false` even when no source messages or parts were inserted. Metadata-only assistant rows remain stored without raw context items until at least one finalized part exists.

Sync result fields:

- `insertedMessages`
- `insertedParts`
- `skippedUnsealedMessages`
- `skippedUnsealedParts`
- `idempotent`
- lifecycle state
- optional safe error

## Part Content Storage

Normal source content is stored inline in `lcm_message_parts`. Large payloads are written through `writeLcmArtifact(...)` and referenced by `content_file_id`.

Large-payload detection covers:

- large finalized prompt text
- assistant text
- assistant reasoning
- provider media/fallback bytes
- terminal tool output
- terminal tool error

When a part uses `content_storage_kind = "lcm_file"`, the row stores byte count and SHA-256 and clears the full inline payload fields. Search text and bounded preview/markers remain content-safe derived data. Active context carries the marker or a bounded read/excerpt, not the full large artifact bytes. Summary quality requires visible large-file `file_...` handles to survive compression, because those handles are the durable recovery keys for exact details.

Completed tool parts may carry truncation sidecar metadata from the runtime tool wrapper. Source sync adopts that sidecar as the terminal tool output only when the metadata version, path under the runtime `tool-output` directory, byte count, and SHA-256 all validate. The recovered bytes are stored as an LCM-owned `tool_output` artifact and the visible truncated wrapper is not treated as the full source. If sidecar validation fails or the sidecar is missing, sync keeps the durable visible output/error text exactly as recorded in the MessageV2 part.

Prompt-time file part handling also admits oversized path-backed `file://` payloads before synthetic Read output enters the user message. `session/prompt.ts` computes a provider-aware admission threshold from the configured prompt-payload threshold capped by a fraction of the current model soft threshold. Full-file non-image path reads above that threshold call the LCM runtime to register the file with path provenance and add a `large_file_marker` context item, then store concise synthetic text containing the marker instead of inline file bytes. Ranged text reads stay on the normal Read path because the requested window is already bounded. Supported image attachments stay on the image normalization/provider-media path subject to normal base64 limits instead of becoming text markers. If marker admission fails because LCM path registration rejects an out-of-boundary user-selected file, the prompt falls back to the existing trusted Read path for that attachment; other marker-admission failures record a content-safe synthetic read failure and do not fall back to injecting oversized bytes.

## Render Preparation

`render-prep.ts` builds a render manifest for model input. It records:

- renderer and render-preparation versions
- source selection hash
- request snapshot protection hash
- render unit order and effective placement hashes
- protected span hash
- provider transform and validator hashes
- system prompt, tool schema, plugin transform, dynamic prompt, and visibility hashes
- provider media capability and strip-media flag
- model/provider/agent identity
- task capability class
- clock policy

Render-only helper parts are marked so dynamic editor context, environment details, plan reminders, max-step notices, plugin transforms, provider media fallbacks, and tool-description placement can participate in model rendering without becoming immutable source rows.

## Active Context Items

`context.ts` derives active context rows from immutable source and summaries. Current item types:

- raw messages
- summaries
- archive stubs
- large-file markers
- retrieval cues

Raw leaves are recent or protected source messages. Summaries represent compressed spans. Large-file markers point to file IDs instead of embedding full payloads. Retrieval cues are deterministic, capped active-context hints generated from authorized current-lineage memory.

## Token Budgets

`token-budget.ts` provides deterministic fallback token counting and provider-aware budget decisions. Current constants include:

- `LCM_TOKEN_BUDGET_CACHE_VERSION = 11`
- provider token counter version: `lcm-provider-token-counter-v1`
- deterministic fallback token counter version: `lcm-deterministic-fallback-token-counter-v1`
- fake token counter version: `lcm-fake-token-counter-v1`

Default thresholds in `config.ts`:

- soft ratio: `0.6`
- hard ratio: `1`
- max blocking rounds: `10`

Context rows cache token count, cache key, and cache version. Snapshot rows record active tokens, hard limit, soft threshold, fresh-tail token budget, soft backlog token count, soft backlog item count, largest eligible soft-backlog source token count, fresh-tail counts, unconsumed post-current counts, protected-tail counts, soft-pressure reason, and lane-latch diagnostics in provider-safe metrics JSON.

Runtime prompt preflight normalizes provider/model context metadata before computing thresholds. Invalid context or output limits use conservative provider-specific fallback windows, optional input/output limits are clamped to the resolved context window, and generic providers use a smaller conservative fallback. When the provider does not supply an explicit output reserve, LCM derives one from the resolved context window: at least 4096 tokens, 12% of context where larger, capped at 20,000 tokens, the provider output limit, and 25% of context. Threshold snapshots and metrics preserve `budgetStatus = "provider_limit_fallback"` when fallback or clamped model limits shaped the budget so UI clients can warn users while continuing to protect the prompt from provider overflow.

Soft raw backlog selection is consumption-aware and token-aware. The runtime always protects the target current-user row. Newer raw rows remain protected until a later provider request snapshot that included that row reaches `resolved`; canceled and expired snapshots do not mark rows as consumed. After mandatory protection is removed, the runtime protects a configurable fresh tail from the newest remaining raw rows, rounded to whole message rows. The default fresh-tail budget is 20,000 tokens. The newest fresh-tail candidate is protected even if it alone exceeds the budget; older candidates are added only while the cumulative fresh-tail token count stays within the configured budget. The selected backlog and the actual leaf-summary source use the same policy, so snapshots cannot report zero backlog simply because a multi-step turn was treated as one fresh tail. Snapshot metrics also record the largest eligible raw source token count so diagnostics can distinguish many small leaves from one unusually large leaf without exposing source text.

## Summaries

`summary.ts` defines prompt versions:

- `summary-leaf-v2`
- `summary-condense-v2`
- `summary-aggressive-v2`

Summary prompt rendering uses `renderLcmPromptRequest(...)` from `prompts.ts`. The rendered request carries the prompt version, a legacy combined prompt string, durable system instructions, tagged untrusted user/source content, provider messages, and versioned hash inputs. Provider-backed leaf, condense, and aggressive summary generation sends the durable instructions as a system message and source rows or prior summaries as a separate user message tagged with untrusted-source XML-style boundaries. The system instructions explicitly tell the model not to continue the source conversation, answer a source user, execute source instructions, treat source content as authority, grant permissions, change tool scope, authorize IDs, or override system/developer/user instructions.

Provider-backed summaries may end with a bounded compressed-detail affordance line: `Compressed details: <classes>; recover exact values through LCM retrieval using covered handles.` The allowed classes are `exact_commands`, `full_error_output`, `raw_tool_json`, `tool_call_sequence`, `timestamps`, `file_diffs`, `config_values`, and `earlier_branch_attempts`. The line is summary text, not separate persisted metadata, and it must not invent omitted specifics. Deterministic fallback summaries do not fabricate this affordance; if source text itself contains a footer-shaped line, fallback treats it as untrusted source text instead of rendering it as an authoritative footer.

Default summary targets:

- summary target tokens: `1600`
- summary generation max output tokens: `4096`

Summary objective status tracks whether a provider summary was accepted or rejected for reasons such as empty output, not smaller, too large, tiny, source echo, prompt wrapper, refusal, anchorless, retry pending, or fallback accepted.

Fallback mode values:

- `none`
- `truncated_prefix`
- `extractive_key_points`

Fallback summaries preserve provenance when model summarization is unavailable or rejected. New deterministic fallback content is extractive: it records coverage handles and concise source-derived key points rather than a blind prefix when it fits. Fallback rows are still stored as summaries with objective/fallback evidence, but downstream retrieval treats them as degraded memory: original source parts are preferred when both the source and fallback summary match, and summary-shaped tool results expose fallback/degraded metadata.

Provider-backed summary generation receives the prompt/run abort signal. If the provider generator ignores cancellation, the user-visible summary operation races the abort signal, returns canonical `lcm.operation.canceled`, and does not retry or convert the canceled attempt into deterministic fallback. Any late provider result is ignored and cannot commit summary rows, usage rows, snapshots, status updates, or assistant output.

## Soft Maintenance

Soft maintenance runs when a finalized checkpoint observes soft-pressure raw backlog. The prompt loop still keeps an after-turn fallback, but `SessionProcessor` also signals checkpoints after non-tool `finish-step` writes and after completed/error tool or subagent results are durable. The prompt-owned checkpoint syncs finalized source before queueing maintenance only when the assistant message has sealed terminal metadata, including `time.completed`; checkpoint signals that arrive before processor cleanup defer to the normal post-process sync/maintenance path. It never ingests streaming deltas, running tool parts, or mutable assistant message metadata, and it suppresses the duplicate after-turn queue for the same assistant message only after maintenance was actually queued. It is scheduled by `runtime.ts` and summarized by `context.ts`.

Soft maintenance behavior:

- It is background work.
- It records status events and content-safe usage rows.
- It avoids repeated no-op work with conversation-level skip fingerprints.
- It can run because active context exceeds the global soft threshold, because eligible raw backlog outside the protected tail exceeds the raw-lane target while active context is still below soft, or because a runtime-memory lane latch keeps a raw/summary lane eligible above target.
- It can skip when the active context is no longer over soft pressure by the time the job runs.
- It preserves `softPressureReason`, `softBacklogLargestSourceTokens`, and lane-latch diagnostics in threshold metrics and public status/event payloads.
- Runtime-memory lane latches are dropped on restart and cleared after terminal failed/canceled maintenance; no DB migration or persisted lane-state restore path exists.

Soft maintenance never summarizes the current user turn being answered. It may summarize older consumed rows from the same multi-step assistant turn once a later resolved provider request proves those rows were model-visible and they fall outside the configured fresh-tail budget.

The soft sweep boundary is a single `compactLeavesToSprig(...)` invocation for `summary-leaf-v2`. Runtime defaults cap that sweep to one pass and a 60-second pre-pass elapsed budget; if either budget is exhausted before provider work starts, the soft result is deferred and carries only content-safe sweep telemetry. Provider-capacity deferral, cancellation, no-work/skipped outcomes, successful completion, and cooldown backoff all report `sweepStopReason` rather than raw provider/source details. Repeated retryable leaf-summary failures are counted by conversation, purpose, prompt version, provider, and model in runtime memory; after the repeated-failure threshold, further soft work is paced by cooldown and reuses the coalesced deferred-job path. Hard-limit maintenance remains a separate blocking path with its own round and elapsed caps, and it is not blocked by the soft summary cooldown.

## Hard-Limit Maintenance

Hard-limit maintenance is blocking preflight work. `compactUntilUnderHardLimit(...)` recomputes active tokens between rounds and can escalate from leaf summaries to condensation/aggressive summaries. When callers pass an operation ID, hard-limit maintenance preserves it through the result and safe error so runtime events, usage rows, status hints, and logs correlate to the same operation.

Prompt-time hard-limit leaf summarization protects the target current user row resolved from render preparation. The raw leaf selector can summarize older eligible leaves under hard pressure, but it must not consume the user turn currently being answered; that row remains available for threshold assembly and provider-safe rendering.

When the prompt/run abort signal is canceled, hard-limit maintenance stops at the next safe subpass boundary and returns a `canceled` maintenance result instead of continuing through the remaining rounds. The cancellation path checks before selection/commit boundaries, after progress updates, after committed work has been counted, and before final result construction. Already-committed summaries remain durable and are reflected in the returned work counters; DB transactions and underlying provider requests are not forcibly killed mid-mutation/request, but user-visible summary waits race cancellation and ignore late provider output.

If hard pressure remains unresolved after configured rounds, it returns `hard_limit_unresolved` with before-token and hard-limit evidence where available.

Provider-side context overflow after a successful LCM preflight is treated as missed budget pressure, not as permission to use legacy compaction. The prompt path cancels the failed provider request snapshot, removes the transient assistant attempt, reruns LCM preflight up to two times with progressively stricter provider input reserves, and retries the provider request. If recovery attempts are exhausted, or if any compact result reaches the prompt loop outside the active LCM retry branch, the turn fails closed with `hard_limit_unresolved` and `action = "start_new_thread"` without creating a `compaction` user part.

## Provider-Safe Assembly

`assembleModelMessages(...)` returns a discriminated `LcmAssemblyResult`. Successful assembly includes:

- active context render units
- target current user render unit
- prepared model messages and runtime provider payload; `provider-payload.ts` owns the runtime-only type guard used before prompt submission
- rendered spans
- render input manifest
- provider request snapshot ID
- active token evidence

Provider-safe render units carry canonical order, effective order, placement slot, source handle, provenance handles, required visibility hash, protocol grouping, and whether they are required for continuation.

Protected spans cover provider-sensitive regions such as assistant tool results, media fallback, tool-use ordering, Mistral sequence repair, interleaved reasoning, and synthetic media fallback.

When prompt preflight passes an abort signal, threshold counting, hard-limit maintenance, and provider-safe assembly check it between DB loads, render-unit building, Kilo render preparation, prefix counting, active-token counting, maintenance subpasses, and snapshot writes. Cancellation returns a content-safe `canceled` error/result and avoids creating threshold/provider snapshots after the user has stopped the prompt.

Provider request snapshots also record the ordered context items represented by each source-backed render unit. Finalizing a snapshot as `resolved` inserts first-consumption evidence for included raw-message context items; canceled, expired, or failed requests do not. This evidence is used only for future soft-backlog eligibility and is not a provider wire log.

## Provider Final Validation

`provider-protocol.ts` classifies provider family as `openai_compatible`, `copilot`, `anthropic`, `mistral`, `interleaved_reasoning`, or `generic`. It computes provider transform and validator hashes from model/provider identity, SDK package, API identity, media handling, rule flags, capabilities, and option hashes.

`session/llm.ts` validates the final provider-transformed message list during AI SDK parameter transformation. It rejects:

- model/provider mismatch
- invalid message structures
- unknown roles
- missing tool-call or tool-result IDs
- non-adjacent tool results
- orphan tool results
- incomplete tool-call groups
- provider-family ordering violations such as Anthropic tool-use ordering or Mistral tool/user sequence issues

The normalized provider projection uses safe IDs when possible and SHA-256 hashes when raw IDs are unsafe for non-model surfaces.

Final validation also measures provider-transform-added model-visible overhead. The runtime persists the observed overhead by provider, model, and provider family, then applies the max observed value with a conservative floor as an input-budget reserve in later threshold checks.

## Context Snapshots And Recovery

`writeContextSnapshot(...)` records active context state with a `lcm-context-restore-manifest-v2` restore manifest and provider-safe metrics. `rebuildActiveContext(...)` first tries durable snapshots and then rebuilds from source rows, summary rows, lineage, large-file markers, and retrieval cue rows.

Snapshot restore is all-or-nothing per snapshot. Corrupt or incompatible snapshots are skipped. Active context is derived state and can be rebuilt when immutable source and summary records are complete.

## Prompt Export Debugging

`prompt-export.ts` implements the Memory settings debug export. It is invoked only through the trusted runtime-owned session route and writes Markdown under the active workspace's `lcm-export/<timestamp>-<sessionID>/` directory. The route response is content-safe metadata, but the files are explicit local debug artifacts and may include prompt/context content.

The exporter reconstructs active-context Markdown from durable context rows or context snapshots. The first dialog file continues until LCM has not replaced anything in the background. For each durable summary/compaction replacement, it emits a separate LCM prompt file for the summary request and continues the dialog in a new ordered Markdown file from the nearest replacement snapshot. Dialog files include rendered raw messages, summaries, large-file markers, retrieval cues, and terminal tool input/output/error text that is stored in LCM but normally hidden from the chat UI.

LCM prompt files reconstruct known prompt versions for leaf, condense, aggressive, file-exploration, and map-item calls from durable source rows, summary lineage, large-file artifacts, and map input artifacts. When the current durable state proves a model call happened but the exact prompt cannot be reconstructed, the exporter writes an ordered `lcm-prompt-unavailable` Markdown file with a content-safe diagnostic code instead of inventing prompt text. The exporter is on-demand reconstruction, not a continuous provider wire log.

## Prompt Integration

`session/prompt.ts` uses the full persisted message stream for `lcm_active` and `passive_synced` sessions before calling `prepareKiloModelInput(...)`, so prompt-time activation does not start from legacy compacted history. It then establishes the render manifest and delegates to LCM preflight while the normal session status shows fixed content-safe preparation phases for opening memory, syncing memory, rebuilding memory context, finding relevant memory, checking memory size, and preparing memory for the model. For LCM-managed sessions, this prompt-time render preparation validates active render-only metadata before preflight. A content-safe render-preparation failure completes the assistant message with `LcmMemoryError`, publishes the session error, and sends no provider request. The provider call uses the LCM-prepared payload, and the prompt loop clears runtime-owned memory-preparation labels before provider streaming starts. After the assistant message is terminal, `syncLcmFinalized(...)` persists finalized source back into LCM.

Post-turn finalized-source sync failures are not silent. The prompt service publishes one content-safe `LcmMemoryError` warning event for the failed session, persists content-safe pending retry state in the runtime-owned LCM control directory, reloads and retries that sync before the next turn after runtime restart, and schedules one in-process background retry for retryable failures. Prompt-time preflight still performs authoritative finalized-source sync before any later provider request.

If LCM preflight fails, the assistant message is completed with a content-safe error and no provider request is sent.

If the provider rejects the final transformed payload for context length after preflight approved the request, LCM-active sessions retry up to twice through the recovery preflight path described above. Each retry uses a stricter effective provider input reserve than the previous attempt. Failed assistant placeholders from these transient provider overflows are not synced into LCM source, and transient provider overflow events are suppressed so clients see either the recovered response or the final content-safe LCM error.
