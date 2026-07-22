# LCM Current-Code Verification

Status date: 2026-07-22.

This document records the verification surface for `kilocode-lcm-v7.4.13`.

## Selection Rule

Run the smallest suite that owns the touched behavior. Use broad package/compiler/build gates only for cross-package integration, dependency/config changes, generated SDK changes, or release packaging. Do not run root `bun test`.

Environment-specific wrappers may select focused compiler slices, but they are not release evidence by themselves. Record any skipped or unavailable non-release probe explicitly and require the production CLI/VSIX build path to pass.

## Required Cross-Package Gates

For the v7.4.13 integration represented by this branch:

- generated LCM contract: `bun run --cwd packages/opencode lcm:contracts:check`
- generated OpenAPI/SDK: `bun run script/generate.ts` after public API changes, followed by a clean diff check
- LCM-owned typecheck: `bun run --cwd packages/opencode typecheck:lcm`
- full opencode typecheck for shared prompt/server/CLI integration or release packaging: `bun run --cwd packages/opencode typecheck`
- SDK typecheck after generated API changes: `bun run --cwd packages/sdk/js typecheck`
- annotation check: `bun run script/check-opencode-annotations.ts`
- VSCode marker check: `bun run --cwd packages/kilo-vscode check-kilocode-change`
- VSCode compile: `bun run --cwd packages/kilo-vscode compile`
- snapshot: `bun run --cwd packages/kilo-vscode snapshot:build`

The focused `typecheck:lcm` project owns the LCM tree. It does not replace the package gate after shared prompt/server/CLI integration changes, but a repeatedly resource-killed local broad check is not a reason to add publishable bypasses: record the local limitation and require the corresponding production CI build to pass.

## Compatibility/Cutover Gate

`bun run --cwd packages/opencode lcm:cutover-quarantine` proves:

- `/memory` and upstream project-memory handlers remain present;
- `/lcm` and `/lcm-settings` own conversation-context settings;
- upstream `SessionCompaction` remains installed only as a non-LCM adapter;
- product `SessionCompaction.defaultLayer` and `.node` are fail-closed LCM guards, while legacy construction requires an explicitly named upstream adapter;
- active/passive LCM prompt branches use LCM preflight, maintenance, bounded overflow recovery, and fail-closed errors;
- summarize delegates to LCM and does not construct a legacy compaction turn;
- OpenAPI/SDK retain upstream `session.compacted` compatibility events while LCM uses `lcm.maintenance.*` rather than `lcm.compaction.*`;
- the VSCode bridge is transport-only.

The core context-engine seam is covered by:

- `packages/core/test/session-runner.test.ts`
- `packages/llm/test/adapter.test.ts`
- `packages/opencode/test/session/llm.test.ts`

## Ingestion And Provider Gates

- `lcm:finalized-sync`: terminal-only immutable source, retry state, source drift, and canonical persisted ToolPart behavior. Validated truncation sidecars must not replace the finalized SWE-pruned ToolPart.
- `lcm:render-prep`: protected render units and provenance.
- `lcm:raw-leaf-parity`: shared MessageV2 reconstruction.
- `lcm:provider-assembly`: provider-safe message assembly and request snapshots.
- `lcm:provider-protocol`: final transformed provider payload rules.
- `lcm:provider-overflow`: one bounded active-LCM rebuild followed by fail-closed exhaustion; inactive LCM never retries.
- `lcm:assembly-token-budget`, `lcm:token-budget`: threshold/budget binding and reserves.
- `lcm:output-reserve`: the final provider allowance cannot exceed the output reserve admitted by LCM.
- `lcm:hard-limit`, `lcm:soft-backlog`, `lcm:maintenance-summary-quality`: blocking and deferred maintenance behavior.
- `lcm:system-context`: LCM policy plus preserved upstream project memory/environment context.

## Runtime And Storage Gates

- `lcm:migration:smoke`
- `lcm:db:support`
- `lcm:family-runtime`
- `lcm:activity`
- `lcm:activation`
- `lcm:active-context:test`
- `lcm:crash-reopen`
- `lcm:scheduler`
- `lcm:status-events`
- focused `test/lcm/db-worker.test.ts`, `id-allocation.test.ts`, and `hash.test.ts`

## Retrieval, Files, And Maps

- `lcm:retrieval-auth`: current-lineage authorization and forged-handle rejection.
- `lcm:retrieval-tools`: LCM grep/describe/expand/query/read behavior.
- upstream recall tests plus the LCM cutover gate: prior-session recall remains upstream-owned; current-session recall is rejected in favor of lineage-scoped LCM retrieval.
- `lcm:path-provenance`, `lcm:large-file`, `lcm:explorer-safety`, `lcm:regex-safety`. Regex cases must set `mode: "regex"`; omitted mode intentionally exercises the literal default.
- `lcm:map`, `lcm:sub-agent-scope`

## Settings And API

- `lcm:settings`: config-backed project/workspace scope and supported public fields.
- `lcm:contracts:check`: route/DTO/safe-error drift.
- `lcm:cost`, `lcm:status-events`: content-safe aggregate status.
- `lcm:activity`: bounded per-request usage projection and CLI status/activity formatting.
- `lcm:remote-maintenance`: compatibility `/compact` dispatch reaches LCM maintenance without creating a legacy turn.
- focused server/API typecheck through the opencode package gate.
- VSCode extension and webview typechecks cover the generated-SDK bridge and `LcmContextSettings` component.

Settings verification must prove that sessionless calls do not require a conversation or PGlite, session-scoped calls derive family identity from trusted runtime state, unsupported fields are rejected, and bridge fallbacks obey canonical safe-error templates.

VSCode focused verification must also prove that the Memory card exposes hard/raw/backlog, paid-token activity, runtime-owned support actions, and prompt export; that activity route limits use the generated SDK query type; that stale request IDs cannot overwrite a newly focused session; that LCM timeline bars are timestamp-merged without transcript highlight targets; and that routine bundled-runtime/SSE `console.log` calls remain behind `debugLog`.

## Required Live Demonstration Matrix

Tests and typechecks are prerequisites, not completion evidence. The release scenario has five evidence-backed steps that focused suites cannot mark passed: `old-session-family-continuation`, `output-reserve-enforcement`, `cli-vscode-memory-observability`, `live-tool-matrix-local-qwen`, and `live-tool-matrix-zai`. Supply one content-safe `.json`, `.txt`, or `.md` capture per step through `lcm:release-long-context:strict --manual-evidence-dir <dir>`.

Use one exact committed candidate and record its SHA, VSIX SHA-256, installed extension version, bundled CLI identity, provider/model ID, session IDs, OS/architecture, and timestamps. Do not record credentials, raw provider headers, or private prompt/file content.

For macOS arm64 VSCode with the configured local Qwen provider:

1. Install the exact snapshot VSIX and enable `kilo-code.new.debugBackendLogs` only for the diagnostic capture.
2. Continue representative pre-existing root and child sessions, including one containing legacy compaction markers. Capture the absence of catch-all `lcm_family_resolution_failed`, the session-specific diagnostic if continuation is legitimately blocked, and `kilo lcm status --session <id> --json` from the bundled CLI.
3. Run a new long session until raw rows become summaries and at least one hard or soft maintenance request occurs. Capture the Memory card's hard/raw/backlog values, prompt-export folder/file count, and matching CLI `status`/`activity` JSON.
4. Near the model context boundary, capture `outputReserve` and the final request output cap from debug logs. The cap must be no larger than the reserve. A genuine output-length finish may remain incomplete but must not schedule legacy compaction or post-response hard input maintenance.
5. Capture the task timeline after maintenance, `lcm_expand_query`, file exploration, and `llm_map`; each provider-backed request must appear in `kilo lcm activity` with provider/model, token or unknown-usage evidence, and cost status.

Run the same nine-tool matrix first with local Qwen and then from the authenticated CLI z.ai subscription:

| Tool | Required live proof |
|---|---|
| `lcm_grep` | Root session returns authorized literal/regex matches and stable handles. |
| `lcm_describe` | Root session returns bounded metadata for an authorized `sum_...` or `file_...` handle. |
| `lcm_expand` | Root denial occurs before content access; a trusted child/explore/map scope expands an authorized summary. |
| `lcm_expand_query` | Root session returns a cited answer or the specified successful no-answer shape; activity records provider usage. |
| `lcm_read` | Root denial occurs before bytes/provenance access; a trusted read-capable child reads a bounded authorized file window. |
| `llm_map` | An authorized JSONL run is created and returns a durable `map_...` status. |
| `agentic_map` | An authorized read-only or write-capable child run is created without duplicate LCM usage accounting. |
| `lcm_map_status` | Polling returns the latest authorized run counts/output handle without item content. |
| `lcm_map_cancel` | A deliberately still-running map accepts cancellation and later status reports the terminal or cancel-requested state. |

Each provider run must also prove that the same root/child sessions resolve to one trusted family lineage, `contextItemCounts`/raw/backlog metrics change as tree construction and maintenance proceed, paid-token activity increases only for provider-backed LCM requests, and no product code constructs `upstreamV1DefaultLayer`, `upstreamV1Node`, or `SessionCompaction.layer`.

## Release Evidence

- non-strict beta helper: `bun run --cwd packages/opencode lcm:release-long-context`
- stable approval: `bun run --cwd packages/opencode lcm:release-long-context:strict`
- packaged runtime: `bun run --cwd packages/opencode lcm:platform-runtime-smoke -- --runtime-path <packaged-kilo> --snapshot-path <candidate.vsix> --out-dir <evidence-dir>`

Release evidence must start from a clean committed worktree and bind the source commit, release target, resolved tag commit, VSIX SHA-256, bundled runtime identity, and asset manifest. Development snapshot names are derived from committed `HEAD` even when the worktree contains uncommitted bytes, so a dirty snapshot name is not exact-SHA evidence. Commands that change working directory with `--cwd` must receive workspace-absolute artifact paths.

The compiled CLI and extracted-VSIX smoke must execute the registered `debug lcm-db-smoke` command and prove both `pglite-regex.worker.ts` and `retrieval-regex.worker.ts` through their compiled path defines. Source tests, typecheck, or bundle creation alone do not prove those assets are present.

The completed `v7.4.13-lcm.1` prerelease targeted `cbd5d6dbb2bfca3c887fd5847744638b1ffdb59a`. Workflow run `29844020302` passed the release-critical gates, built 12 CLI archives and 8 VSIX assets, and passed the packaged Linux x64 runtime smoke. This is prerelease automation evidence, not stable approval.

Stable release approval additionally requires the strict long-context gate and exact-candidate installed-editor validation on the supported VSCodium/Nobara and VSCode/macOS targets.
