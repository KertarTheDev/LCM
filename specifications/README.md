# LCM Current-Code Specifications

Status date: 2026-07-10.

These documents describe the LCM implementation on the current release-sync branch. Current code is the authority.

## Source Of Truth

- Implementation branch: `kilocode-lcm-v7.4.1`
- Upstream base: Kilo Code `v7.4.1` (`4ed43ab7c5309761276a0513fff99019df1d0570`)
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

Change statistics in this spec set compare tracked source and package paths from upstream tag `v7.4.1` to the current branch worktree, excluding installed dependencies, build output, local artifacts, and the specification files themselves. Scoped comparisons inspected:

- `packages/opencode/src`, `packages/opencode/test`, `packages/opencode/script`, and `packages/opencode/package.json`
- `packages/kilo-vscode/src`, `packages/kilo-vscode/webview-ui/src`, and `packages/kilo-vscode/package.json`
- generated SDK/docs, `.github`, package metadata, publishable guidance, and VSCode packaging scripts
- focused opencode typecheck configs and the generated-artifact drift gate

Within that scope the LCM branch now differs from upstream `v7.4.1` by 336 files with 113,883 insertions and 7,079 deletions. These raw numbers include generated OpenAPI/SDK artifacts and formatter normalization; they should not be read as pure hand-authored feature size.

## Upstream Reference Refresh

The LCM branch was replayed from the previous release-sync branch onto upstream `v7.4.1` on 2026-07-07 and audited through 2026-07-10. Notable upstream behavior retained in the new base includes:

- the `7.4.1` package versions and upstream SDK/OpenAPI/doc generator output;
- upstream VSCode packaging of the sandbox mutation worker and bidirectional prompt input;
- headless/daemon subagent permission handling that fails closed instead of waiting on an unavailable prompt;
- worktree reasoning/mode selection, persisted sandbox behavior, and provider-reported output-cap handling;
- upstream core memory/runtime and provider/model updates retained alongside the separate LCM ownership boundary.

## Current High-Level Behavior

LCM replaces routine lossy context compaction for active sessions with a persistent memory runtime. It records finalized Kilo messages and parts into a PGlite-backed family database, derives an active context view from immutable source rows, summarizes only as a maintenance operation, and registers scoped retrieval/map tools so the model can recover off-context memory through authorized stable handles.

The normal prompt path calls LCM preflight before a provider request. Preflight syncs finalized source, proves or activates the conversation, evaluates active-token thresholds, runs blocking hard-limit maintenance if required, assembles provider-safe model messages, and records a provider request snapshot. If LCM cannot prove safe continuation, the session fails closed with a content-safe `LcmSafeError`; it does not fall back to lossy legacy pruning for LCM-active sessions.

## Archive Rule

Historical milestone archives are intentionally not part of this public branch. If durable behavior changes again, update the current spec documents in this directory first.
