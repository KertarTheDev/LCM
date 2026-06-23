# Retrieval, Files, Exploration, And Maps

This document describes current retrieval, file, and map behavior from `retrieval.ts`, `large-files.ts`, `path-provenance.ts`, `file-exploration.ts`, `map.ts`, and the tool files under `packages/opencode/src/tool/`.

## Retrieval Tool Surface

Current retrieval tools:

- `lcm_grep`
- `lcm_describe`
- `lcm_expand`
- `lcm_expand_query`
- `lcm_read`

Canonical descriptions are defined in `retrieval.ts` as `LCM_RETRIEVAL_TOOL_DESCRIPTIONS`. `tool/registry.ts` prevents plugin mutation of these canonical descriptions. `session/prompt.ts` filters the model-visible registration per runtime capability and conversation scope and adds an LCM system guide that tells the model when to use each available retrieval or map tool. The retrieval guide recommends broad, short, distinctive literal `lcm_grep` queries first, reserves regex mode for actual regex syntax, uses `lcm_describe` for handle lineage/metadata inspection before expensive recovery, and directs exact commands, timestamps, root-cause chains, file changes, config values, raw tool JSON, diffs, and full errors through `lcm_expand_query`, `lcm_expand`, or `lcm_read` rather than inferred from summaries alone.

Root/main sessions may receive:

- `lcm_grep`
- `lcm_describe`
- `lcm_expand_query`

Direct `lcm_expand` and `lcm_read` are reserved for trusted child/explore/map capability classes as proven by `lifecycle.ts`.

## Lineage Authorization

Retrieval scope is derived from the current session by `getConversationScope(...)`; it is not taken from model-supplied IDs. Allowed conversations are the current conversation and authorized ancestors inside the same project/workspace/session boundary.

The runtime rejects unrelated, sibling, descendant, cross-workspace, malformed parent-link, or forged-ID access before returning content or metadata.

Explicit expansion/read grant records are not adopted in the current code. Direct expansion and direct file reads remain authorized by trusted runtime lineage, capability proof, `directContentToolsAllowed`, and per-handle resolution inside `allowedConversationIDs`. A separate persisted or model-visible grant layer would duplicate those checks without adding TTL, token-cap, or source-handle guarantees today, and could create a weaker authority if retrieved/model-visible content were ever able to mint or quote grants. Future grants must be derived only from trusted runtime operation records, must re-check current lineage at use time, and must not replace the existing lineage and capability gates.

## Cursors And Paging

Retrieval cursors are runtime-issued opaque strings. `retrieval.ts` encodes cursor payloads with version, tool, limit, offset, request signature, and expiry. Invalid cursors reject before data reads.

Default page limit: `50`.

Max page limit: `100`.

Tool result byte cap: `40,000`.

Snippet cap: `1,000` bytes.

## Grep

`lcm_grep` searches authorized summaries, message-part search text, and large-file marker metadata. Large-file candidates include the `file_...` handle, source kind, byte/hash metadata, linked message/part handles, bounded preview text, and accepted exploration summary text. It does not search path bytes or full artifact bytes directly. Case-sensitive search is opt-in; case-insensitive matching is the default.

Search behavior uses current-lineage candidates and ranks exact/useful hits before less direct matches. Returned snippets are untrusted data and do not grant permission or authorize handles.

Deterministic fallback summaries are degraded memory. New fallback rows use `extractive_key_points`; older compatible rows may still report `truncated_prefix`. Matching source message parts rank ahead of matching fallback summaries, and fallback summary hits carry `summaryDegraded`, `summaryObjectiveStatus`, and `summaryFallbackMode` metadata in tool results.

Provider-backed summaries can include a final `Compressed details:` affordance line with bounded class labels. Retrieval treats that line as a cue to recover exact values through `lcm_grep`, `lcm_expand_query`, `lcm_expand`, or `lcm_read`; it is not itself evidence for exact commands, timestamps, root-cause chains, diffs, raw JSON, config values, or full errors.

Regex execution is isolated through `retrieval-regex.ts` and `retrieval-regex.worker.ts`, with statement timeout and cancellation behavior configured in `config.ts`.

Retrieval DB requests carry caller abort signals into the DB worker. Queued retrieval work is removed on abort, and active retrieval queries receive the worker request control signal so timeout or caller cancellation can stop cooperative regex/search work without exposing raw query text through status surfaces.

## Describe

`lcm_describe` returns metadata for authorized summary or file handles.

Summary describe can report summary type, token counts, created time, fallback/degraded metadata, and bounded preview metadata. File describe can report stored metadata and bounded preview text already present in the row.

Describe does not read full artifact/path bytes and does not refresh previews.

## Expand

`lcm_expand` expands an authorized summary for trusted child/explore/map contexts. It is denied to root/main sessions before content lookup.

Expansion returns paged source items and summary content derived from authorized lineage only. Fallback summary items are marked with degraded metadata so child/explore callers know the content is deterministic fallback material rather than a semantic provider summary.

## Expand Query

`lcm_expand_query` answers a focused question using authorized current-lineage memory. It accepts an optional `summaryID`; when supplied, the runtime authorizes that summary in the current lineage and gathers bounded excerpts from covered source before query-derived handles or broad query matches. Covered artifact-backed `file_...` handles are preferred even for provider-backed summaries so root sessions can recover large tool output when summary prose omitted the handle. Covered deterministic fallback source parts still outrank fallback summary text. It also derives literal search candidates from code/path/flag/hash-like spans and stable handles in the question, gathers authorized excerpts, and calls a retrieval answer generator using prompt version `retrieval-expand-query-v3`.

When the question explicitly names authorized `file_...` handles, excerpt gathering may load a bounded UTF-8 window from LCM-owned artifact-backed files, including recovered `tool_output` artifacts, after artifact path, byte count, and SHA-256 validation. Framed inline-part artifacts are decoded into logical text/reasoning/tool input/output/error/media sections before becoming model-visible excerpts, so raw `lcm-inline-part-v1` framing is not exposed. This gives root sessions a safe recovery path for visible large-output markers through `lcm_expand_query`. Path-backed file handles stay preview-only in this path; exact path-backed bytes still require authorized `lcm_read` from a trusted child/explore/map capability class.

Retrieval answer generation uses `renderLcmPromptRequest(...)`: durable retrieval/citation policy is sent as system content, while the question and authorized excerpts are sent as tagged untrusted user content. Retrieved text cannot grant permissions, authorize IDs, change tool scope, or override instructions, and every memory-derived claim must cite stable handles.

The provider-facing answer format is a structured JSON envelope with required `answer`, `citedHandles`, `coverage`, and `truncated` fields plus optional `confidenceNotes`, `expandedSummaryCount`, and `sourceTokenEstimate`. Public tool output keeps the stable answer/citation shape and may include optional `coverage` and `truncated` diagnostics from a valid structured envelope; raw confidence notes and token estimates are not exposed. JSON-looking malformed output, unsupported citation handles, missing citations, or answers that do not visibly contain the cited handles fail closed to the empty no-answer result. Non-JSON prose remains accepted by the legacy normalizer for local/test generators, but provider prompt instructions require JSON.

Memory-derived claims must cite stable handles. If no supported answer exists, the successful no-answer shape is `ok = true`, `answer = ""`, and `citations = []`.

When a query supplies or explicitly names a degraded fallback summary handle, excerpt gathering prefers covered original message parts before the fallback summary text when those parts are still authorized and searchable.

Root sessions can use `lcm_expand_query`; the runtime can create temporary explore-child capacity internally while still gating direct content tools from the root model surface.

## Memory Cues

Memory cues are deterministic active-context retrieval hints generated from current-lineage candidates. They carry:

- query text
- cue text
- summary IDs
- file IDs
- message row IDs
- part row IDs
- token count

Limits from `config.ts`:

- max cues per turn: `3`
- max cue tokens: `400`
- max total cue tokens: `1200`

Cue text is model-visible active-context data. It is not for non-model logs or status payloads.

## File Records

`large-files.ts` handles file rows and byte-window reads. File source kinds include:

- `path`
- `inline`
- `image`
- `tool_output`
- `map_input`
- `map_output`

Path-backed files must be registered with complete provenance and boundary metadata. Reads revalidate canonical path, observed size/mtime/hash, boundary metadata, stale-source state, and permission. Exact matching external path-backed sources proceed to Kilo permission checks when outside the recorded boundary.

Prompt-time oversized full-file non-image `file://` parts use the same path-backed registration path before active-context admission. The runtime records provenance, creates a `large_file_marker` context item, and returns model-visible marker text rather than allowing the full Read payload into the prompt. Ranged text reads stay on the bounded Read path, and supported image attachments stay on the normal image/provider-media path. If registration rejects an out-of-boundary user-selected attachment, prompt handling falls back to the existing trusted Read path for that attachment; stale path drift, missing provenance, cancellation, and other permission/admission failures use the same content-safe file errors as ordinary path-backed reads.

Artifact-backed files validate artifact path, byte count, and SHA-256 before reads.

Read windows return UTF-8 content when valid for text-like sources; otherwise they return base64.

Large-file DB lookups and file byte-window helpers are cancel-aware. Path-backed registration and reads check caller cancellation between metadata, permission, hashing, row lookup, artifact validation, and final insert/read boundaries and return content-safe canceled errors. Runtime file exploration passes caller abort signals to the initial file lookup and byte/helper work where cancellation should stop the user-visible operation, while content-safe status writes still complete after an exploration result is known.

File read and exploration error paths treat safe-error-shaped values as untrusted until they pass the shared LCM safe-error schema. Accepted errors are normalized to canonical safe messages and action values before they are rethrown or mapped to file status. Rejected values fall back to the closest content-safe stale, canceled, timeout, or failed status and never expose raw file bytes, helper output, prompts, or arbitrary exception text. File-exploration timeouts and caller cancellation race the user-visible result against helper/provider work and pass the runtime abort signal into provider-backed exploration generators so a non-cooperative generator cannot keep the session waiting for status.

## File Exploration

`file-exploration.ts` stores exploration status and optional summary text on `lcm_large_files`. Prompt version: `file-exploration-summary-v2`. Provider-backed file exploration uses `renderLcmPromptRequest(...)` so file-summary policy is system content and the sampled file data is a separate tagged untrusted user block.

Exploration limits from `config.ts`:

- exploration enabled: true
- sample bytes: `204,800`
- max full load bytes: `52,428,800`
- helper output max bytes: `1,048,576`
- max output tokens: `2,200`

Exploration statuses include not started, queued, running, completed, sampled, unavailable, unsafe, corrupt, timeout, over limit, canceled, and failed.

Exploration summaries are model-visible metadata when rendered as markers or cues; describe/retrieval does not use them as raw source content.

## Map Tool Surface

Current map tools:

- `llm_map`
- `agentic_map`
- `lcm_map_status`
- `lcm_map_cancel`

Canonical descriptions live in `map.ts` as `LCM_MAP_TOOL_DESCRIPTIONS`. Tool descriptions emphasize polling with `lcm_map_status`, choosing agentic maps only when child-session tool work is needed, and treating map inputs, prompts, schemas, outputs, child-session inputs, and status data as untrusted.

Root active sessions can receive map tools. Child/session details are owned by trusted runtime orchestration.

## Map Limits

Current map limits in `map.ts`:

- prompt bytes: `65,536`
- input JSONL bytes: `52,428,800`
- line bytes: `1,048,576`
- item count: `100,000`
- schema bytes: `262,144`
- schema depth: `64`
- schema properties: `4,096`
- schema refs: `8,192`

Worker defaults from `config.ts`:

- `llm_map` workers: `16`
- `agentic_map` workers: `8`
- runtime local-provider map workers: `1`
- runtime small-model `llm_map` workers: `4`
- runtime small-model `agentic_map` workers: `2`
- runtime foreground-provider-pressure workers: `1`
- max retries: `2`
- max retry limit: `5`
- item lease: `600,000` ms
- claim heartbeat: `30,000` ms

The lower runtime worker counts are effective caps applied before a user-facing runtime map creates or resumes its durable run. They apply when the selected provider is classified as local, when the map uses the `small` model selector, or when provider-capacity state shows active/queued foreground work for the selected endpoint. Invalid or over-limit worker requests still flow into normal map validation so callers get the existing content-safe validation errors instead of silent acceptance.

## LLM Map

`llm_map` registers path-backed or artifact input, validates JSONL items and schema, creates a map run, claims items with leases, calls a model generator for each item, validates output JSON against schema, records per-item usage, and writes map output as an artifact file. Per-item map generation uses `renderLcmPromptRequest(...)`: schema/output policy is system content and the map prompt, JSON schema, and input item JSON are separate tagged untrusted user blocks.

## Agentic Map

`agentic_map` creates trusted child sessions for items. The child runner receives prompt version `map-item-v1`, map/item IDs, the legacy combined prompt string, the structured rendered prompt request, schema, model selection, mode, parent session ID, root conversation ID, project/workspace, and abort signal.

Map child capability is reconstructed by joining `lcm_map_runs` and `lcm_map_items` in `lifecycle.ts`. If proof fails after restart, direct content tools are denied.

Map DB requests pass the scheduler/caller abort signal to the DB worker for claim, heartbeat, input loading, item completion, and status reads. Cancel/shutdown cleanup requests still run without caller cancellation so known map rows can be marked `canceled` content-safely.

## Status And Cancel

`lcm_map_status` and `lcm_map_cancel` return content-safe map status. They do not expose item content. Cancel requests mark runs/items as canceled and release scheduler work through the map scheduler.

Map run and item `safe_error_json` values are schema-validated and normalized before they are returned in `LcmMapResult.safeError` or used to mark a failed run. Malformed persisted safe-error JSON is not trusted because it contains `code` or `safeMessage`; status omits the optional safe error or uses the map failure fallback instead of surfacing forged text. Scheduler and worker catch paths apply the same parser to thrown values before propagating safe errors.
