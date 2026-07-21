# LCM Current-Code Specifications

Status date: 2026-07-21.

These documents describe the LCM implementation on the current release-sync branch. Current code is the authority.

## Source Of Truth

- Implementation branch: `kilocode-lcm-v7.4.13`
- Upstream base: Kilo Code `v7.4.13` (`7060f8cb21d79abf00f9c9d5df07f6e95e4956ec`)
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

Compatibility review and change inspection compare the implementation to upstream tag `v7.4.13`, excluding installed dependencies, build output, local artifacts, and the specification files themselves. Scoped comparisons inspect:

- `packages/opencode/src`, `packages/opencode/test`, `packages/opencode/script`, and `packages/opencode/package.json`
- `packages/kilo-vscode/src`, `packages/kilo-vscode/webview-ui/src`, and `packages/kilo-vscode/package.json`
- generated SDK/docs, `.github`, package metadata, publishable guidance, and VSCode packaging scripts
- focused opencode typecheck configs and the generated-artifact drift gate

The generated OpenAPI/SDK artifacts dominate raw line statistics, so this spec set does not use a worktree line count as an architecture metric. Review the isolated LCM-owned directories and the narrow adapters listed in `current-code-map.md` instead.

## Upstream Reference Refresh

The LCM subsystem was transplanted onto a clean upstream `v7.4.13` base after first designing and validating the integration seams on that target. The older LCM tree was used only as a source of isolated LCM-owned modules and tests. Notable upstream behavior retained in the new base includes:

- upstream project memory under `packages/kilo-memory` and `packages/opencode/src/kilocode/memory`, with its own files, index, digests, lifecycle, `/memory` command, and settings surface outside the LCM family database;
- upstream prior-session recall, while LCM owns recall and retrieval for the current conversation lineage;
- upstream SWE-pruned finalized tool parts as canonical persisted source; truncation sidecars are validated recovery evidence and are not silently substituted for the persisted tool result;
- upstream V2 context-engine dispatch, context epochs, automatic non-LCM compaction, and bounded recovery, plus the retained V1 prompt path used by the current product;
- upstream `SessionCompaction` and its public events as a non-LCM compatibility adapter, never as an active-LCM fallback;
- current provider, permission, sandbox, worktree, SDK, packaging, and VSCode behavior.

## Current High-Level Behavior

LCM replaces routine lossy context compaction for active sessions with a persistent memory runtime. It records finalized Kilo messages and parts into a PGlite-backed family database, derives an active context view from immutable source rows, summarizes only as a maintenance operation, and registers scoped retrieval/map tools so the model can recover off-context memory through authorized stable handles.

The normal prompt path calls LCM preflight before a provider request. Preflight syncs finalized source, proves or activates the conversation, evaluates active-token thresholds, runs blocking hard-limit maintenance if required, assembles provider-safe model messages, and records a provider request snapshot. If LCM cannot prove safe continuation, the session fails closed with a content-safe `LcmSafeError`; it does not fall back to lossy legacy pruning for LCM-active sessions.

## Archive Rule

Historical milestone archives are intentionally not part of this public branch. If durable behavior changes again, update the current spec documents in this directory first.
