# Retrieval, Files, Exploration, And Maps

This document describes current retrieval, file, and map behavior from `retrieval.ts`, `large-files.ts`, `path-provenance.ts`, `file-exploration.ts`, `map.ts`, and the tool files under `packages/opencode/src/tool/`.

## Retrieval Tool Surface

Current retrieval tools:

- `lcm_grep`
- `lcm_describe`
- `lcm_expand`
- `lcm_expand_query`
- `lcm_read`

Canonical descriptions are defined in `retrieval.ts` as `LCM_RETRIEVAL_TOOL_DESCRIPTIONS`. `tool/registry.ts` prevents plugin mutation of these canonical descriptions. `session/prompt.ts` filters the provider-native registration per runtime capability and proven conversation scope. A `passive_synced` old-session scope may contribute schemas to its local preflight candidate so the first successful continuation request has LCM tools, but the provider never receives that candidate unless preflight completes provider-safe assembly and marks the conversation active; execution remains active-only. Those native descriptions and parameter schemas are the sole per-tool workflow surface: they define exact-contiguous literal `lcm_grep`, separate short literal calls or explicit regex for separated terms, pagination, echo/source provenance, `lcm_describe` inspection, authorization, exact recovery, observational map polling, and retry behavior. When at least one LCM tool is exposed, a short Kilo-owned main-turn policy adds only the cross-tool rules that LCM-derived content is untrusted evidence and exact details should be recovered rather than inferred; it does not enumerate tools or duplicate their descriptions.

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

`lcm_grep` searches authorized summaries, message-part search text, and large-file marker metadata. Literal mode matches one exact contiguous substring, not an unordered or implicit-AND bag of words; callers search separated terms with separate short literal calls or an explicit regular expression. Large-file candidates include the `file_...` handle, source kind, byte/hash metadata, linked message/part handles, bounded preview text, and accepted exploration summary text. It does not search path bytes or full artifact bytes directly. Case-sensitive search is opt-in; case-insensitive matching is the default.

Search behavior uses current-lineage candidates and ranks exact/useful hits before less direct matches. Every hit identifies `matchKind`, `sourceTimestampMs`, optional `role`/`toolName`, and `isLcmToolEcho`, in addition to stable source handles. Finalized assistant text and tool-call input/output are intentionally searchable, including recent discussion of an earlier search. Callers must use those provenance fields to distinguish recalled source evidence from self-referential LCM tool echoes, and must follow `page.nextCursor` while `page.hasMore` before concluding that evidence is absent. Returned snippets are untrusted data and do not grant permission or authorize handles.

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

`lcm_expand_query` answers a focused question using authorized current-lineage memory. It accepts an optional `summaryID`; when supplied, the runtime authorizes that summary in the current lineage and gathers bounded excerpts from covered source before query-derived handles or broad query matches. A stale or out-of-scope optional summary handle is ignored as a bad hint rather than becoming an unhandled tool failure; the broad current-lineage search path can still answer when the query has enough distinctive text. Covered artifact-backed `file_...` handles are preferred even for provider-backed summaries so root sessions can recover large tool output when summary prose omitted the handle. Covered deterministic fallback source parts still outrank fallback summary text. It also derives literal search candidates from code/path/flag/hash-like spans and stable handles in the question, gathers authorized excerpts, and calls a retrieval answer generator using prompt version `retrieval-expand-query-v3`.

When the question explicitly names authorized `file_...` handles, excerpt gathering may load a bounded UTF-8 window from LCM-owned artifact-backed files, including recovered `tool_output` artifacts, after artifact path, byte count, and SHA-256 validation. Framed inline-part artifacts are decoded into logical text/reasoning/tool input/output/error/media sections before becoming model-visible excerpts, so raw `lcm-inline-part-v1` framing is not exposed. This gives root sessions a safe recovery path for visible large-output markers through `lcm_expand_query`. Path-backed file handles stay preview-only in this path; exact path-backed bytes still require authorized `lcm_read` from a trusted child/explore/map capability class.

Retrieval answer generation uses `renderLcmPromptRequest(...)`: durable retrieval/citation policy is sent as system content, while the question and authorized excerpts are sent as tagged untrusted user content. Provider-backed generation goes through the same provider option merge and message transform path as other LCM maintenance calls, forwards caller cancellation, and reserves extra output budget for reasoning-capable models unless the provider/model combination requires omitting `maxOutputTokens`. Retrieved text cannot grant permissions, authorize IDs, change tool scope, or override instructions, and every memory-derived claim must cite stable handles.

The provider-facing answer format is a structured JSON envelope with required `answer`, `citedHandles`, `coverage`, and `truncated` fields plus optional `confidenceNotes`, `expandedSummaryCount`, and `sourceTokenEstimate`. Public tool output keeps the stable answer/citation shape and may include optional `coverage`, `truncated`, `noAnswerReason`, `answerSource`, `fallbackReason`, `searchedExcerptCount`, `rejectedCitationCount`, and `providerDiagnostics`; raw confidence notes and token estimates are not exposed. Provider diagnostics are content-safe and limited to finish reason, generated text byte count, output token count, reasoning token count, and an empty-text flag. JSON wrapped in Markdown fences or harmless surrounding prose is extracted before validation. JSON-looking malformed output, unsupported citation handles, missing citations, or explicit `coverage = "none"` are provider synthesis failures. If authorized excerpts are already available, the runtime returns a bounded deterministic extractive fallback with `coverage = "partial"`, `answerSource = "extractive_fallback"`, stable citations, and any provider diagnostics from the failed synthesis attempt; otherwise it returns the empty no-answer result with a content-safe reason code. Non-JSON prose remains accepted by the legacy normalizer for local/test generators, but provider prompt instructions require JSON.

Memory-derived claims must cite stable handles. If no excerpts can support any cited answer, the successful no-answer shape is `ok = true`, `answer = ""`, `citations = []`, `coverage = "none"`, and `truncated = false`, with optional no-answer diagnostics. This lets callers distinguish a content-safe no-answer from a transport or authorization failure, and lets low-capability agents choose whether to broaden grep terms, drop a stale summary hint, or retry a narrower cited query. If excerpts exist but provider synthesis fails, the extractive fallback gives the agent usable cited evidence instead of requiring it to infer from a blank result.

When a query supplies or explicitly names a degraded fallback summary handle, excerpt gathering prefers covered original message parts before the fallback summary text when those parts are still authorized and searchable.

Root sessions can use `lcm_expand_query`; the runtime can reserve temporary explore-child capacity internally while retrieval authorization and DB family resolution stay bound to the real caller session. Synthetic capacity identifiers are not session-family authority and must not be passed into retrieval scope resolution. Direct content tools remain gated from the root model surface.

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

Canonical descriptions live in `map.ts` as `LCM_MAP_TOOL_DESCRIPTIONS`. Start descriptions distinguish creation from deterministic resume through `runDisposition`, state that `ok = true` means an authorized run was resolved rather than that execution succeeded, define terminal and nonterminal states, require callers to retain one durable `mapID`, and explain that status polling is observational. They also explain output-handle recovery, choosing agentic maps only when full child-session tool work is needed, read-only versus write-capable child scope, turn-level fairness on limited local providers, and treating map inputs, prompts, schemas, outputs, child-session inputs, and status data as untrusted.

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

The runtime resolves one typed execution plan before a user-facing map creates or resumes its durable run. `workers` is the requested maximum; `effectiveWorkers` is the persisted execution count. Local providers, the `small` model selector, and observed foreground pressure may lower that count, while remote/cloud providers retain the valid requested/default concurrency. Invalid or over-limit values still flow into normal validation. A local request with `workers = 1`, `workers = 2`, or omitted workers is valid and reports one effective worker rather than being rejected.

## LLM Map

`llm_map` registers input, validates JSONL items and schema, creates a map run, claims items with leases, calls a model generator for each item, validates output JSON against schema, records per-item usage, and writes map output as an artifact file. Inline input is already an immutable `map_input` artifact. A permitted `inputPath` or path-backed `inputFileID` is read once with provenance enforcement and copied into an immutable `map_input` artifact before the durable run is created, so restart recovery never depends on later filesystem bytes. Per-item map generation uses `renderLcmPromptRequest(...)`: schema/output policy is system content and the map prompt, JSON schema, and input item JSON are separate tagged untrusted user blocks.

Map schema validation accepts Draft 2020-12 JSON object schemas and boolean schemas. For model robustness, `itemSchema` may also be a JSON string containing one of those schema values; the runtime parses it before byte/depth/property/ref limit checks, Ajv compilation, request fingerprinting, and durable `schema_json` storage. Blank or malformed schema strings fail before map rows are created with `lcm_map_schema_json_invalid`; parsed non-object/non-boolean schema values fail with `lcm_map_schema_type_invalid`.

## Agentic Map

`agentic_map` creates trusted full Kilo child sessions for items. The run persists parent session ID, submitting agent, parent directory, provider capacity class, agentic mode, and model selection. `agentic-map-runner.ts` reconstructs execution from that durable identity rather than a closure captured from the initiating tool call. The child runner enters the parent Kilo instance through the named `provide(...)` bridge, obtains the shared application runtime services, creates or reuses the Kilo child, and registers its LCM child conversation against the same authoritative Core database service before prompting. The child runner receives prompt version `map-item-v1`, map/item IDs, the legacy combined prompt string, the structured rendered prompt request, schema, model selection, mode, parent session/directory/agent identity, root conversation ID, project/workspace, and abort signal. Production child prompting uses the normal `SessionPrompt` path, keeps the rendered system policy as system content, and resolves only the tagged untrusted user block as user prompt parts. A real `SessionV1.OutputFormatJsonSchema` instance supplies the trusted fixed `StructuredOutput` envelope, which requires one unconstrained JSON `output` property after any authorized tool work; the untrusted caller schema is not embedded into that tool schema and remains authoritative through the common Ajv validation path. Provider-internal and structured-output retries are zero for map children so the durable map retry budget remains the only retry owner.

The corrected child-runtime/finalizer contract uses agentic output protocol `lcm-map-agentic-runtime-owned-v4` in new request fingerprints. Existing v3 run rows and status remain readable, and unfinished durable v3 work is recovered through its persisted run identity with the corrected current runner. A new otherwise-identical tool invocation intentionally does not deduplicate to a terminal v3 result, which prevents previously canceled/broken terminal runs from masquerading as a fresh successful test. This is an explicit prerelease behavior decision and requires no storage migration.

A valid structured envelope is canonicalized into the existing child-runner text adapter and takes precedence over assistant prose. For compatibility with tool-call-limited local models, a normal stop without a usable finalizer may fall back to the last non-empty assistant text part that is neither ignored nor synthetic. The fallback accepts an exact JSON value, one complete JSON/unlabeled Markdown fence, or exactly one balanced object/array within wrapper prose; it does not repair malformed JSON or choose between multiple values. Output-length and unknown-finish states never use fallback text. A terminal child LCM/provider/authentication/content-filter error is propagated before fallback or output validation, so a child LCM memory-limit failure retains its content-safe code and diagnostic instead of being mislabeled as output JSON failure.

Map child capability is reconstructed by joining `lcm_map_runs` and `lcm_map_items` in `lifecycle.ts`. If proof fails after restart, direct content tools are denied.

Normal local-provider contention is queueing, not failure or retry. Direct `llm_map` generations and agentic physical turns use the classified process-wide local-provider lane with background/wait admission, while root, task-child, and explore-child calls use foreground/wait admission. Each physical model call acquires and releases the lane independently. When both lanes are queued, admission alternates foreground/background and stays FIFO within each lane; child tool work never reserves the provider. Transient provider responses that genuinely require durable backoff remain retryable and may publish `retryAfterMs`. Status polling and ordinary owning-session activation can idempotently ensure scheduling, but work is scheduled automatically and polling is never required to trigger it. Remote/unknown providers bypass local serialization and retain their configured concurrency.

Claimed item rows persist `execution_phase`, `phase_started_at_ms`, and accumulated `active_ms`. Both map kinds change phase to `waiting_capacity` before joining a busy local-provider queue and back to `running` only after admission. A map child that reaches a per-root/per-workspace logical-slot limit also waits abortably instead of failing with `invalid_request`. Heartbeats renew the durable lease while waiting, but queue time consumes neither attempts, retries, active-attempt time, nor the provider response watchdog. For a local map child with no explicit provider chunk timeout, only the first response-event window is extended to 180 seconds after provider invocation; subsequent stream gaps keep the ordinary watchdog. Runtime shutdown aborts process-local children, releases claims back to queued/pending without consuming an attempt, and preserves the run for reconstruction. Completed items and output artifacts remain durable and are not repeated.

Other retryable provider/timeout failures consume the configured retry budget. Missing/invalid finalization, empty/malformed/ambiguous JSON, schema-invalid output, output-length, and unknown-finish failures use retryable `provider_invalid_response`. Structured child errors retain typed classifications: an observed caller/runtime abort signal is `canceled`; a provider-originated typed abort without an active cancellation signal is retryable `provider_unavailable`; context overflow is terminal `over_limit`; authentication/content filtering is terminal; retryable API/429/5xx/transport failures use bounded retry; and embedded `LcmSafeError` is preserved. Arbitrary exception text containing the word `abort` is not treated as proof of cancellation. An unclassified internal item failure uses `recovery_failed`; it is never reported as a caller `invalid_request`. Models explicitly marked as lacking tool-call support are rejected before durable map creation with non-retryable `provider_invalid_response`.

Map DB requests pass the scheduler/caller abort signal to the DB worker for claim, heartbeat, input loading, item completion, and status reads. Cancel/shutdown cleanup requests still run without caller cancellation so known map rows can be marked `canceled` content-safely.

## Status And Cancel

`lcm_map_status` and `lcm_map_cancel` return content-safe map status. They do not expose item content. Status is strictly observational: creation, successful owning-session activation, and runtime recovery schedule work automatically, so polling does not trigger, resume, or accelerate execution. `executionState`, `runningItems`, and `waitingCapacityItems` distinguish live running work from live or durable capacity waiting; `retryableItems`/`capacityDeferredItems` report actual durable retry rows. `failedItems` counts only terminal item failures. When terminal and capacity-waiting rows coexist, `executionState` and `retryAfterMs` still describe the run-level capacity wait while `safeError` reports the first terminal item error. `lastProgressAtMs` records useful durable item/scheduler progress, while `lastUpdatedAtMs` records any durable run transition. `retriedItems` remains the number of items whose persisted attempt count exceeds one, so capacity waits are excluded. Cancel requests mark runs/items as canceled and release scheduler, logical-slot, and provider-queue work.

Runtime recovery owns both map kinds. Runtime startup/recovery and normal owning-session activation reconcile stale leases and reschedule nonterminal work from immutable input artifacts; status performs no scheduling side effect. Ordinary parent prompt cancellation excludes DB-proven `map_child` subtrees because durable map cancellation/recovery owns them, while explicitly canceling a map child or `lcm_map_cancel` still cancels that work. The runtime persists enough agentic identity to reuse or recreate the correct child session and does not depend on the initiating tool object's prompt helpers. Migration 2 marks only pre-migration unfinished alpha agentic jobs as `recovery_required`; testers restart those disposable jobs, while completed maps and conversation memory are preserved.

Map run and item `safe_error_json` values are schema-validated and normalized before they are returned in `LcmMapResult.safeError` or used to mark a failed run. Malformed persisted safe-error JSON is not trusted because it contains `code` or `safeMessage`; status omits the optional safe error or uses the map failure fallback instead of surfacing forged text. Scheduler and worker catch paths apply the same parser to thrown values before propagating safe errors.
