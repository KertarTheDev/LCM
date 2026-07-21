# LCM Current-Code Verification

Status date: 2026-07-20.

This document records the verification surface for `kilocode-lcm-v7.4.13`.

## Selection Rule

Run the smallest suite that owns the touched behavior. Use broad package/compiler/build gates only for cross-package integration, dependency/config changes, generated SDK changes, or release packaging. Do not run root `bun test`.

On the constrained maintainer VPS, use the parent-workspace `support/vps-verify.ts` helper for supported CPU-heavy gates. If a helper selector names a compiler config that does not exist on this upstream tag, record that mismatch and run the real package gate rather than adding a fake project config.

## Required Cross-Package Gates

For the v7.4.13 integration represented by this branch:

- generated LCM contract: `bun run --cwd packages/opencode lcm:contracts:check`
- generated OpenAPI/SDK: `bun run script/generate.ts` after public API changes, followed by a clean diff check
- opencode typecheck: `bun run --cwd packages/opencode typecheck`
- annotation check: `bun run script/check-opencode-annotations.ts`
- VSCode marker check: `bun run --cwd packages/kilo-vscode check-kilocode-change`
- VSCode compile: `bun run --cwd packages/kilo-vscode compile`
- snapshot: `bun run --cwd packages/kilo-vscode snapshot:build`

The focused `typecheck:lcm` project is useful for the LCM-owned tree, but it does not replace the package gate after prompt/server/CLI integration changes.

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
- `lcm:path-provenance`, `lcm:large-file`, `lcm:explorer-safety`, `lcm:regex-safety`
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

Stable release approval additionally requires the exact candidate VSIX to pass installed-editor validation on the supported VSCodium/Nobara and VSCode/macOS targets.
