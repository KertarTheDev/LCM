# LCM Current-Code Verification

Status date: 2026-07-21.

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
- `lcm:hard-limit`, `lcm:soft-backlog`, `lcm:maintenance-summary-quality`: blocking and deferred maintenance behavior.
- `lcm:system-context`: LCM policy plus preserved upstream project memory/environment context.

## Runtime And Storage Gates

- `lcm:migration:smoke`
- `lcm:db:support`
- `lcm:family-runtime`
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
- focused server/API typecheck through the opencode package gate.
- VSCode extension and webview typechecks cover the generated-SDK bridge and `LcmContextSettings` component.

Settings verification must prove that sessionless calls do not require a conversation or PGlite, session-scoped calls derive family identity from trusted runtime state, unsupported fields are rejected, and bridge fallbacks obey canonical safe-error templates.

## Release Evidence

- non-strict beta helper: `bun run --cwd packages/opencode lcm:release-long-context`
- stable approval: `bun run --cwd packages/opencode lcm:release-long-context:strict`
- packaged runtime: `bun run --cwd packages/opencode lcm:platform-runtime-smoke -- --runtime-path <packaged-kilo> --snapshot-path <candidate.vsix> --out-dir <evidence-dir>`

Release evidence must start from a clean committed worktree and bind the source commit, release target, resolved tag commit, VSIX SHA-256, bundled runtime identity, and asset manifest. Development snapshot names are derived from committed `HEAD` even when the worktree contains uncommitted bytes, so a dirty snapshot name is not exact-SHA evidence. Commands that change working directory with `--cwd` must receive workspace-absolute artifact paths.

The compiled CLI and extracted-VSIX smoke must execute the registered `debug lcm-db-smoke` command and prove both `pglite-regex.worker.ts` and `retrieval-regex.worker.ts` through their compiled path defines. Source tests, typecheck, or bundle creation alone do not prove those assets are present.

The completed `v7.4.13-lcm.1` prerelease targeted `cbd5d6dbb2bfca3c887fd5847744638b1ffdb59a`. Workflow run `29844020302` passed the release-critical gates, built 12 CLI archives and 8 VSIX assets, and passed the packaged Linux x64 runtime smoke. This is prerelease automation evidence, not stable approval.

Stable release approval additionally requires the strict long-context gate and exact-candidate installed-editor validation on the supported VSCodium/Nobara and VSCode/macOS targets.
