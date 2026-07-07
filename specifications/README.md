# LCM Current-Code Specifications

Status date: 2026-06-23.

These documents describe the LCM implementation on the current release-sync branch. Current code is the authority.

## Source Of Truth

- Implementation branch: `kilocode-lcm-v3.7.54`
- Upstream base: Kilo Code `v7.3.54` (`0f55066dc71254967b97de287bbf58541d42e577`)
- Current code and the current spec files in this directory are normative.
- Branch model: release-sync branches are named for the upstream release they carry. Future syncs should create a new clean `kilocode-lcm-v<upstream-release>` branch from the upstream tag, replay the LCM delta there, then rebase prerelease-only changes on top.

## Current Spec Set

- `current-code-map.md`: module ownership, current file surfaces, and change statistics.
- `storage-schema.md`: PGlite layout, family storage, owner lock, schema tables, large files, snapshots, and cleanup.
- `runtime-lifecycle.md`: runtime services, lifecycle states, activation, preflight, settings, maintenance, and failure modes.
- `ingestion-and-context-assembly.md`: final-only source ingestion, context items, summaries, token budgets, provider-safe render units, and snapshots.
- `retrieval-files-maps.md`: LCM retrieval tools, lineage authorization, path-backed/file artifacts, file exploration, and map tools.
- `api-contracts.md`: normative DTO, route, tool, event, safe-error, and generated-contract source.
- `api-settings-vscode.md`: public routes, generated contract surface, SDK/webview messages, VSCode settings UI, status events, and packaging hooks.
- `verification.md`: focused test suites, release evidence, build commands, and known verification gaps.
- `ci-and-drift-gates.md`: required CI checks, strict release gate, and upstream drift checklist.
- `upstream-support-runbook.md`: package policy, existing-session support, data roots, debug commands, safe-error triage, cleanup, and installed-editor evidence checklist.
- `maintainer-overview.md`: high-level maintainer summary and module statistics.
- `maintainer-acceptance-review.md`: maintainer-style value, quality, documentation, maintainability, recommendation, and issue assessment.
- `code-issues.md`: current code issues or evidence gaps noticed during this rebaseline.
- `fixtures/`: active deterministic fixtures used by current LCM tests and release-support scripts.

## Comparison Scope

Change statistics in this spec set compare tracked source and package paths from upstream tag `v7.3.54` to this branch, excluding installed dependencies, build output, and local artifacts. Scoped comparisons inspected:

- `packages/opencode/src`, `packages/opencode/test`, `packages/opencode/script`, and `packages/opencode/package.json`
- `packages/kilo-vscode/src`, `packages/kilo-vscode/webview-ui/src`, and `packages/kilo-vscode/package.json`
- `packages/app/src`, `.github`, and `bun.lock`

Within that scope the LCM branch now differs from upstream `v7.3.54` by 300 files with 111,740 insertions and 13,341 deletions. These raw numbers include generated OpenAPI/SDK artifacts and formatter normalization; they should not be read as pure hand-authored feature size.

## Upstream Reference Refresh

The LCM branch was replayed from the previous `v7.3.50` release base onto upstream `v7.3.54` on 2026-06-23. Notable upstream behavior retained in the new base includes:

- the `7.3.54` package versions and upstream SDK/OpenAPI/doc generator output;
- upstream ACP service extraction, with the LCM manual-memory compatibility hook kept in the new ACP service layer;
- upstream background task auto-injection and removal of `task_status`, with LCM child-session scope and local-provider admission preserved in the new task flow;
- local recall/session search, primary worktree, session metadata, OpenAI websocket transport, and TUI workspace/session switcher updates;
- upstream config/plugin/core service refactors, including the `@opencode-ai/core/effect/service-use` import path.

## Current High-Level Behavior

LCM replaces routine lossy context compaction for active sessions with a persistent memory runtime. It records finalized Kilo messages and parts into a PGlite-backed family database, derives an active context view from immutable source rows, summarizes only as a maintenance operation, and registers scoped retrieval/map tools so the model can recover off-context memory through authorized stable handles.

The normal prompt path calls LCM preflight before a provider request. Preflight syncs finalized source, proves or activates the conversation, evaluates active-token thresholds, runs blocking hard-limit maintenance if required, assembles provider-safe model messages, and records a provider request snapshot. If LCM cannot prove safe continuation, the session fails closed with a content-safe `LcmSafeError`; it does not fall back to lossy legacy pruning for LCM-active sessions.

## Archive Rule

Historical milestone archives are intentionally not part of this public branch. If durable behavior changes again, update the current spec documents in this directory first.
