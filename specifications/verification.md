# LCM Current-Code Verification

Status date: 2026-06-20.

This document records the verification surface for the LCM implementation on the `kilocode-lcm` branch. It is descriptive of the current code and package scripts.

## Verification Principle

Run the smallest script that owns the subsystem being changed, then run the package typecheck and VSCode compile path before packaging. Do not run root `bun test`; the workspace intentionally does not use it as the LCM gate.

All commands below are intended to run from the repository root unless a package path is included in the command.

Active deterministic test fixtures live under `specifications/fixtures/`.

Local resource-constrained machines may set temp directories explicitly without affecting normal checkouts:

```sh
mkdir -p tmp
env TMPDIR="$PWD/tmp" BUN_TMPDIR="$PWD/tmp" bun run --cwd packages/opencode <script>
```

## Local Throttling

Normal checkouts should run the documented `bun` commands directly. If a developer is working on a CPU-limited VPS or another constrained machine, CPU throttling/resume wrappers should live outside this repository and call the same package scripts. Public scripts may honor optional environment variables such as `TMPDIR`, `BUN_TMPDIR`, `LCM_WORKSPACE_TMP`, and `KILO_VSCODE_SNAPSHOT_DIR`, but they must not require machine-specific paths.

## Required Build Gates

- Runtime typecheck: `bun run --cwd packages/opencode typecheck`
- VSCode extension compile: `bun run --cwd packages/kilo-vscode compile`
- VSIX snapshot build: `bun run --cwd packages/kilo-vscode snapshot:build`
- Generated LCM contract check: `bun run --cwd packages/opencode lcm:contracts:check`
- Prompt/runtime static unresolved-symbol check: `bun run --cwd packages/opencode lcm:prompt-static`
- First-message prompt smoke: `bun run --cwd packages/opencode lcm:prompt-first-message`
- MCP prompt schema smoke: `bun run --cwd packages/opencode lcm:prompt-mcp-schema`

Run `bun run --cwd packages/opencode lcm:contracts:generate` before the contract check whenever public LCM routes, DTOs, safe-error literals, SDK payloads, or webview payloads change. Commit the generated artifact with the route or DTO change.

## Runtime And Storage Suites

- `lcm:migration:smoke`: PGlite migration smoke coverage for the current schema.
- `lcm:db:support`: runtime DB support smoke coverage, including owner-lock support-command behavior, PGlite gate checks, and content-safe diagnose checks for migration registry, search/index readiness, deferred jobs, large-payload markers, path provenance, map rows, and artifact cleanup queue readability.
- DB worker focused file: `bun run --cwd packages/opencode test test/lcm/db-worker.test.ts` covers owner-lock heartbeat, stale takeover, lock conflict, post-startup lock-loss fail-closed behavior, DB queue bounds, queue metrics, queued cancellation, prompt-critical request timeout defaults, active request timeout, and shutdown abort/drain behavior.
- `lcm:family-runtime`: family runtime ownership, lifecycle, and conversation family behavior.
- `lcm:activation`: lifecycle, legacy-marker continuity, passive-runtime activation behavior, and preflight safe-action normalization, including source-sync invalid-shape guidance.
- Passive runtime focused file: `bun run --cwd packages/opencode test test/lcm/passive-runtime.test.ts` covers preflight activation, prompt-preflight phase status updates and blocked-result cleanup, hard-limit maintenance progress labels, post-turn soft-maintenance retry policy, one-shot stale-threshold-context rebuild, after-turn raw-counter threshold refresh without durable no-op attempt spam, runtime-restart resume of deferred soft maintenance with protected-current-user payload preservation, bounded shutdown handling for already-running deferred retries, and blocking maintenance status cleanup.
- `lcm:crash-reopen`: representative recovery coverage across summary, hard-limit, and map paths.
- `lcm:scheduler`: foreground/background scheduling fairness, workspace-scoped soft-maintenance caps, provider capacity, local endpoint deferral, soft-sweep iteration/elapsed budget helpers, and route-level summary failure cooldown/backoff helpers.
- `lcm:cutover-quarantine`: current cutover and quarantine behavior, including LCM-managed prompt history selection, between-step soft-maintenance queueing in the prompt loop, default runtime exclusion of legacy `SessionCompaction`, summarize-route delegation to LCM maintenance, VSCode compatibility-transport memory-maintenance copy, bundled webview locale exclusion for stale compact/summarize labels, and public OpenAPI/SDK exclusion of stale `session.compacted` and `lcm.compaction.*` events.
- `lcm:status-events`: content-safe LCM event/status behavior, including canonical safe-error templates from the shared safe-error schema, schema rejection of malformed safe-error-shaped values, safe-error normalization before output, public `lcm.maintenance.*` maintenance progress event names, soft-pressure/lane-latch diagnostics, queued deferred soft-maintenance debt in metrics events, and soft-sweep/backoff telemetry in maintenance events.
- LCM ID allocation focused file: `bun run --cwd packages/opencode test test/lcm/id-allocation.test.ts` covers DB-backed ID uniqueness checks and bounded content-safe collision failures for derived context, summary, usage, lineage pointer, and context snapshot IDs.
- LCM hash helper focused file: `bun run --cwd packages/opencode test test/lcm/hash.test.ts` covers raw SHA-256, stable canonical JSON hashing, and namespace-separated hash identities used by context/provider/deferred-job code.

## Ingestion, Assembly, And Provider Suites

- Finalized source sync: `bun run --cwd packages/opencode lcm:finalized-sync` covers source ingestion, current-user raw-context re-pin when an existing sealed source row is missing from active context, cooperative cancellation, benign assistant accounting metadata drift, rebuild-safe source-drift repair, fail-closed unsafe source drift recovery actions, and post-turn sync warning/retry behavior, including persisted retry recovery after runtime restart.
- `lcm:render-prep`: render-unit preparation and protected span handling.
- `lcm:raw-leaf-parity`: raw leaf reconstruction through the shared MessageV2 renderer.
- Prompt/runtime static unresolved-symbol check: `bun run --cwd packages/opencode lcm:prompt-static` covers missing value/type bindings in the prompt path and adjacent runtime entrypoints that package transpilation can miss before runtime.
- First-message prompt smoke: `bun run --cwd packages/opencode lcm:prompt-first-message` covers a new plan-session prompt entering the LCM render-preparation path with Kilo render-only reminders before the first LLM stream request.
- MCP prompt schema smoke: `bun run --cwd packages/opencode lcm:prompt-mcp-schema` covers first-prompt tool resolution with an MCP tool input schema before the first LLM stream request.
- Prompt render-prep integration: `bun run --cwd packages/opencode test test/session/prompt-effect.test.ts` covers LCM-active prompt render-preparation safe-error handling before provider calls.
- LCM soft-maintenance prompt scheduling: `bun run --cwd packages/opencode test test/kilocode/lcm-soft-maintenance-prompt.test.ts` covers finalized prompt checkpoints queueing soft-maintenance checks before the prompt loop continues without duplicating the after-turn fallback, and defers pre-cleanup checkpoint sync until assistant `time.completed` is sealed so immutable source drift is not created.
- LCM processor checkpoints: `bun run --cwd packages/opencode test test/kilocode/session-processor-lcm-checkpoint.test.ts` covers non-tool `finish-step` checkpoints and completed tool-result checkpoints while pending `tool-calls` finishes remain unsummarized until tool output is durable.
- Assistant message safe errors: `bun run --cwd packages/opencode test test/session/message-v2.test.ts` covers `LcmMemoryError` assistant serialization through the shared safe-error schema.
- `lcm:provider-assembly`: provider-safe assembly output, cooperative assembly cancellation before request snapshots, and runtime prepared-payload guard behavior.
- `lcm:provider-protocol`: final provider payload protocol validation.
- `lcm:provider-overflow`: provider context overflow decision classification, retries, progressively tighter recovery budgets, prompt-time memory-preparation phase status, and fail-closed behavior without automatic legacy compaction.
- `lcm:assembly-token-budget`: assembly token budget, threshold render-prep cancellation, and reserve behavior.
- `lcm:token-budget`: token budget formulas, provider model-limit fallback/clamping, below-soft raw-backlog pressure, lane-latch enter/stay/exit/clear behavior, and threshold behavior.
- `lcm:summary`: summary generation, acceptance, provider-backed compressed-details footer persistence, rendered system/user prompt-request boundaries, prompt abort-signal propagation, non-cooperative provider cancellation, and extractive deterministic fallback behavior.
- `lcm:soft-backlog`: raw backlog soft-maintenance scheduling, configurable whole-message fresh-tail selection, protected current-user/newer-row selection, resolved-provider-request consumption of post-current rows, unproven-boundary skips, soft summary objective deferral, and largest eligible raw-source snapshot metrics.
- `lcm:maintenance-summary-quality`: summary quality bounds for maintenance, compressed-details footer acceptance only with continuity anchors, deterministic fallback sizing and footer-shaped source neutralization, and schema-normalized canceled summary generation propagation without retry/fallback conversion.
- `lcm:hard-limit`: blocking hard-limit maintenance before provider calls, including elapsed caps, caller operation-ID preservation, cooperative and non-cooperative cancellation across leaf and condense summary paths, adaptive raw-leaf hard-pressure summarization that excludes the protected current user row, unresolved-blocker diagnostics, and separation from soft-maintenance cooldown policy.
- `lcm:prompt-boundary`: summary, hard-limit, retrieval behavior, rendered system/user prompt-request boundaries, tagged untrusted source/input blocks, injection-shaped source fixture coverage, and LCM system tool guidance at prompt boundaries.
- `lcm:non-model-leak`: ensures internal/model-visible content is not exposed through non-model surfaces.

## Retrieval, Files, And Maps

- `lcm:retrieval-tools`: `lcm_grep`, `lcm_describe`, `lcm_expand`, `lcm_expand_query`, and `lcm_read` behavior, including canonical retrieval workflow descriptions, exact-detail recovery guidance for compressed summaries, searchable large-file marker handles without full-artifact grep, root-safe `summaryID` large-output recovery through `lcm_expand_query`, memory-cue cancellation, tagged retrieval answer prompt requests, internal structured expand-query answer envelope parsing, fail-closed unsupported/malformed citations, and degraded fallback-summary source preference.
- LCM system tool guide focused file: `bun run --cwd packages/opencode test test/lcm/system-tool-guide.test.ts` covers the model-visible instructions for every retrieval and map tool exposed by the prompt path, including grep/describe/expand/read ordering and exact-detail recovery guidance.
- `lcm:retrieval-auth`: current-lineage authorization, forged-ID rejection, child scope behavior, and the current no-explicit-grants decision that keeps direct expansion/read authorization on trusted lineage plus capability proof.
- `lcm:path-provenance`: path-backed file registration, cancellation, and stale-source proof.
- `lcm:regex-safety`: regex isolation, cancellation, pagination, and safe errors.
- `lcm:large-file`: large source payload storage, previews, prompt path admission policy, runtime marker admission before prompt payload injection, image attachment preservation, external attachment read-path fallback, path-backed reads, safe-error normalization on read failure paths, and read cancellation.
- `lcm:explorer-safety`: file exploration summaries, tagged rendered file-summary prompt requests, safe-error normalization for unavailable/canceled paths, provider/helper timeout and cancellation abort-signal propagation, non-cooperative provider cancellation, and safe fallback behavior.
- `lcm:map`: `llm_map`, `agentic_map`, status, cancel, JSONL, schema, artifact behavior, tagged rendered map-item prompt requests, malformed persisted map safe-error rejection, legacy-normalized continuation into map preparation, and dynamic map worker policy.
- `lcm:sub-agent-scope`: trusted capability metadata and child-session scope reconstruction.

## Settings And VSCode Suites

- Runtime settings: `bun run --cwd packages/opencode lcm:settings`
- Cost/status usage: `bun run --cwd packages/opencode lcm:cost` covers usage cost aggregation, metrics snapshot storage/threshold/status fields, queued deferred soft-maintenance debt fields, and safe cost metadata.
- Recursive LCM cleanup: `bun run --cwd packages/opencode lcm:recursive-cleanup`
- Prompt export focused file: `bun run --cwd packages/opencode test test/lcm/prompt-export.test.ts` covers workspace-local Markdown export from a migrated family DB, including active-context reconstruction with terminal tool input/output content hidden from the normal chat UI.
- VSCode settings/webview unit tests: `bun run --cwd packages/kilo-vscode lcm:settings-ui`
- VSCode transcript export focused unit test: `bun test packages/kilo-vscode/tests/unit/export-transcript.test.ts` covers cursor-paged transcript export and readable tool input/output/error preview rendering with large-output sidecar metadata.
- VSCode LCM prewarm tests: `bun run --cwd packages/kilo-vscode lcm:prewarm` covers coalesced advisory prewarm, retry invalidation, bounded retry logging noise, timeout diagnostics that do not block prompt sends, prompt-send independence from prewarm failures, explicit readiness probe safe-error preservation, malformed safe-error-shaped payload rejection, and rejected capability route errors.
- VSCode provider utility tests: `bun test packages/kilo-vscode/tests/unit/kilo-provider-utils.test.ts` covers SSE-to-webview session status forwarding for retry, busy memory-progress messages, and offline recovery messages.
- VSCode network event tests: `bun test packages/kilo-vscode/tests/unit/connection-utils.test.ts packages/kilo-vscode/tests/unit/network-handler.test.ts` covers typed `session.network.*` session resolution and network-restore auto-reply cleanup.
- VSCode context UI tests: `bun run --cwd packages/kilo-vscode lcm:context-ui`

Settings tests must verify that sessionless LCM settings calls do not open PGlite, do not fabricate a session, and do not return `lifecycleState` or `dbStatus`, while session-scoped settings calls report runtime-owned `lifecycleState` and `dbStatus` for the active family. They must cover the writable `strategy`, `freshTailTokens`, and `storageWarningThresholdBytes` fields, including the 20,000-token fresh-tail default. They must also verify that malformed runtime safe-error-shaped responses are not forwarded to the webview, and that session DB diagnosis/rebuild/prompt-export derives its family from trusted session state rather than caller-supplied data directories. `lcm:db:support` owns the content-safe DB smoke/diagnose/rebuild report shape, including owner-lock/layout, migration registry, search/index, deferred-job, large-payload marker, path-provenance, map-row, and artifact-cleanup health checks. Rebuild tests must cover dry-run preview defaults, forged body rejection, and healthy-family apply refusal. VSCode tests must keep the Memory settings page free of an LCM enable/disable switch, raw memory export, raw memory browse, and LCM-only delete controls, and must cover request-ID handling so stale Memory settings responses cannot overwrite newer state. Safe-action tests must prove only supported actions become buttons, including contact-support links, read-only DB diagnostics, guided DB repair preview/apply, and prompt export through runtime-owned routes while arbitrary DB reset, raw inspection, and extension-host DB ownership remain absent from the webview. Memory state tests must keep `Export prompts` visible but disabled with a content-safe status for session-backed non-ready DB states, and enabled only when DB status is ready. Memory state tests must also cover inline maintenance progress details for active/deferred maintenance, waiting-checkpoint status under over-soft raw pressure, and separate raw-lane pressure from soft-backlog, fresh-tail, and unconsumed-row pressure. Context UI tests must verify that `lcm.metrics.updated` events are keyed by current session and all conversation identifiers, and that active-budget pressure comes from current-session LCM metrics rather than provider token fallback.

## Performance And Release Evidence

- Below-soft latency: `bun run --cwd packages/opencode lcm:perf:below-soft`
- Scale path: `bun run --cwd packages/opencode lcm:perf:scale`
- Local release report helper: `bun run --cwd packages/opencode lcm:release-long-context`
- Strict stable release gate: `bun run --cwd packages/opencode lcm:release-long-context:strict`
- Platform packaged-runtime evidence collector: `bun run --cwd packages/opencode lcm:platform-runtime-smoke -- --runtime-path <packaged-kilo> --snapshot-path <candidate.vsix> --out-dir <evidence-dir>`
- Full-scale local report used in recent evidence: `bun run --cwd packages/opencode script/lcm-release-long-context.ts --allow-pending-manual --full-scale --skip-runtime-smoke`
- Context regression: `bun run --cwd packages/opencode lcm:context-regression`

Release evidence is not complete with compile-only or package-only checks. It needs a VSIX snapshot, packaged-runtime DB smoke from the bundled binary, deterministic LCM suites, scripted long-context behavior, retrieval/file/map demonstrations, and installed-editor transcripts for the target platforms. A prerelease VSIX gate must also extract the candidate artifact and inspect the bundled webview/runtime for the required diagnostics: visible `Export prompts`, disabled-export DB-not-ready copy, `Memory active budget`, raw-lane pressure labels, LCM metrics handling, generic LCM event forwarding, generated session settings SDK support, and session LCM settings route/runtime smoke support. The non-strict helper may report `blocked` with exit code 0 while external/manual evidence is missing; stable release approval must use the strict gate. Release-helper child commands for VSIX install/listing, packaged-runtime smoke, and local scenario scripts are time-bounded; timeout is recorded as a failed evidence row rather than leaving the report generation process hung.

The release report script records deterministic local evidence for LCM-active new-session/preflight behavior through `lcm:activation`, small-threshold soft summaries through `lcm:soft-backlog` plus `lcm:maintenance-summary-quality`, blocking hard-limit maintenance through `lcm:hard-limit` plus `lcm:status-events`, off-context retrieval through `lcm:retrieval-tools` plus `lcm:retrieval-auth`, large-file indirection through `lcm:large-file` plus `lcm:path-provenance`, map JSONL/status behavior through `lcm:map`, cost/status aggregation through `lcm:cost`, legacy-compaction quarantine through `lcm:cutover-quarantine`, DB lock/corrupt/preflight support through `lcm:db:support` and `lcm:activation`, pre-beta schema rebaseline through `lcm:migration:smoke`, recursive LCM-owned cleanup through `lcm:recursive-cleanup`, VSCode inline memory status through `packages/kilo-vscode` `lcm:context-ui` plus `lcm:settings-ui`, and VSCode transport/status/map regression evidence through `packages/kilo-vscode` `lcm:settings-ui` plus `lcm:prewarm` with `lcm:map`, `lcm:large-file`, and `lcm:status-events`. These checks can satisfy the corresponding local scenario rows, but they do not replace packaged-runtime, installed-editor, or external platform evidence.

Platform evidence must record the exact command, date, platform, VSIX path or hash, data directory, bundled runtime path, result, and any report artifacts. Platform packaged-runtime evidence supplied through `--platform-evidence-dir` must use the `lcm-platform-packaged-runtime-smoke-v1` JSON schema generated by `lcm:platform-runtime-smoke`; filename-only evidence is rejected. When the release helper receives `--snapshot-path`, each required platform JSON must include a matching candidate VSIX SHA-256, matching recorded OS/architecture, and a passed `debug lcm-db-smoke` report.
