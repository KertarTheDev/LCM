# Current Code Map And Change Statistics

This document maps the current release-sync LCM branch against upstream release `v7.3.54` (`0f55066dc71254967b97de287bbf58541d42e577`). The numbers below come from scoped `git diff v7.3.54` comparisons of tracked source/package paths and from direct line counts of the LCM runtime tree.

The raw diff includes LCM implementation work, generated artifacts, and formatter normalization. Use these figures for drift/rebase sizing, not as pure hand-authored feature-size accounting.

## Top-Level Change Summary

| Area | Files changed | Insertions | Deletions | Notes |
| --- | ---: | ---: | ---: | --- |
| `packages/opencode/src` | 117 | 45,516 | 528 | LCM runtime plus prompt/server/tool integration |
| `packages/opencode/test` | 69 | 28,689 | 146 | LCM suites plus focused upstream compatibility tests |
| `packages/opencode/script` | 10 | 3,467 | 64 | LCM release/contract/platform helpers |
| `packages/kilo-vscode/src` | 19 | 1,663 | 271 | Extension backend/status transport and settings bridge |
| `packages/kilo-vscode/webview-ui/src` | 46 | 2,734 | 383 | Memory UI, context status, webview messages, and locale cleanup |
| `packages/kilo-vscode/tests` | 21 | 3,458 | 41 | LCM unit coverage |
| `packages/sdk/js/src` | 3 | 2,706 | 18 | Generated SDK surface |
| `packages/sdk/openapi.json` | 1 | 23,025 | 11,854 | Generated OpenAPI route/event contract |
| `.github` | 2 | 186 | 0 | LCM workflows |
| package metadata and lockfile | 3 | 83 | 3 | LCM package metadata and lock changes |
| `script/check-workflows.ts` | 1 | 2 | 0 | Workflow allowlist drift gate |
| `packages/kilo-docs` | 3 | 115 | 13 | Generated CLI/source-link docs |
| `packages/ui/src/components/markdown.tsx` | 1 | 1 | 2 | Shared markdown rendering compatibility |
| publishable guidance and VSCode scripts | 4 | 95 | 18 | Repo guidance, install notes, and extension script updates |

Scoped total: 300 changed files, 111,740 insertions, and 13,341 deletions. Installed `node_modules`, generated build output, and local artifacts are excluded.

## Runtime Core

Primary directory: `packages/opencode/src/session/lcm/`

Current size: 61 files, 41,423 lines including the generated contract artifact.

Key files:

- `runtime.ts`: process-facing `LcmRuntime` Effect service. Owns capabilities, sync, preflight, soft and manual maintenance, retrieval/map dispatch, settings orchestration, event emission, local provider capacity, and cleanup.
- `events.ts`: content-safe LCM event envelope schemas and bus definitions, including public `lcm.maintenance.*` progress events for background/blocking memory maintenance.
- `settings-state.ts`: config-backed LCM settings scope resolution, update validation, Config patch/state projection, and settings-unavailable safe errors.
- `maintenance-results.ts`: content-safe maintenance result construction and soft-maintenance retry decisions/delays.
- `safe-error-schema.ts`: shared zod schemas for LCM safe-error code/action/template payloads used by events, routes, and assistant-message error serialization.
- `operation-control.ts`: shared content-safe operation timeout and cancellation helpers for prompt-critical context work.
- `hash.ts`: canonical SHA-256, stable JSON hash, and namespace-separated hash helpers shared by context, provider protocol, and deferred-job identifiers.
- `db-support-actions.ts`: runtime-owned DB diagnose/rebuild support orchestration, trusted session-family resolution, healthy-state repair refusal, and active-session resync after guided repair.
- `deferred-jobs.ts`: runtime-owned persistence helpers for deferred soft-maintenance retries that must survive runtime restart without storing raw conversation content, including the content-safe protected-current-user boundary.
- `lifecycle.ts`: family DB readiness, conversation creation, lifecycle states, boundary metadata, capability-class proof, session deletion cleanup, source coverage counts, and usage records.
- `source-sync.ts`: finalized MessageV2 ingestion into immutable `lcm_messages`, `lcm_message_parts`, and large-file artifact rows.
- `source-drift-repair.ts`: rebuild-safe source-drift detection support, derived/source row reset, and repair envelope checks.
- `finalized-sync-retry.ts`: prompt-side warning and retry controller for post-turn finalized-source sync failures.
- `context.ts`: active context rebuild, context item rendering, token budgets, protected soft-backlog selection, summary creation, hard-limit convergence, provider-safe render units, provider request snapshots, retrieval cue replacement, and context snapshots.
- `id-allocation.ts`: DB-backed collision-bounded allocation for derived context, summary, usage, lineage-pointer, and snapshot IDs.
- `db.ts`, `db-worker.ts`, `owner-lock.ts`, `migrations.ts`, `pglite-assets.ts`, `pglite-gate.ts`: PGlite startup, schema migration, packaging/runtime gate checks, owner lock, and worker execution lanes.
- `large-files.ts`, `path-provenance.ts`, `artifacts.ts`, `file-exploration.ts`: artifact storage, path-backed provenance, byte-window reads, previews, exploration status, and file summaries.
- `retrieval.ts`, `retrieval-regex.ts`, `retrieval-regex.worker.ts`: lineage-scoped search, describe, expand, expand-query, read, memory cues, cursor handling, and regex cancellation.
- `map.ts`: `llm_map`, `agentic_map`, map status/cancel, JSONL input validation, map run/item persistence, leases, retry, and output artifacts.
- `provider-protocol.ts`, `provider-capacity.ts`, `provider-overhead.ts`, `model-limits.ts`, `preflight-errors.ts`, `render-prep.ts`, `token-budget.ts`, `summary.ts`: provider transform/protocol validation, local endpoint concurrency, provider-transform overhead reserve sizing, model-limit fallback/recovery windows, preflight safe-action classification, render manifests, deterministic token counting, and summary quality/fallback behavior.
- `types.ts`: shared runtime DTOs, safe-error enums/templates, lifecycle enums, settings state, preflight result union, retrieval/map DTOs, event payloads, and tool result shapes.

## Runtime Integration

Important changed files outside `src/session/lcm/`:

- `packages/opencode/src/session/prompt.ts`: switches active sessions from legacy compacted history to LCM preflight and provider-safe assembly; validates prompt-time render preparation as content-safe LCM errors for active sessions; gates LCM tools by capability; finalizes provider request snapshots; syncs finalized messages after prompt/tool turns with warning/retry handling; rejects provider compact results without automatic legacy compaction.
- `packages/opencode/src/effect/app-runtime.ts`: composes the normal runtime layers without installing legacy `SessionCompaction`, keeping lossy compaction outside the default LCM runtime wiring.
- `packages/opencode/src/session/llm.ts`: validates final provider-transformed payloads before stream execution, records final provider validator hashes, and reports provider-transform overhead observations.
- `packages/opencode/src/session/message-v2.ts`: maps LCM safe errors into assistant message errors.
- `packages/opencode/src/session/llm.ts`, `session.ts`, `processor.ts`, `status.ts`, `system.ts`: smaller integration points for provider execution, session behavior, and status surfaces.
- `packages/opencode/src/server/routes/instance/index.ts` and `session.ts`: LCM settings, capabilities, runtime-owned maintenance, and summarize compatibility route behavior without legacy `SessionCompaction` turns.
- `packages/opencode/src/cli/cmd/lcm.ts` and `debug/lcm-db.ts`: user/debug CLI for LCM settings and family DB inspection/smoke/rebuild commands.

## Model-Visible Tools

Primary directory: `packages/opencode/src/tool/`

New LCM/map tool files: 9 files, 614 lines.

Tools:

- `lcm-grep.ts`
- `lcm-describe.ts`
- `lcm-expand.ts`
- `lcm-expand-query.ts`
- `lcm-read.ts`
- `llm-map.ts`
- `agentic-map.ts`
- `lcm-map-status.ts`
- `lcm-map-cancel.ts`

`tool/registry.ts` registers these tools as canonical LCM tools and prevents plugin mutation of their descriptions. `session/prompt.ts` then filters them per session based on runtime capabilities and trusted conversation scope.

## Tests And Evidence Scripts

LCM test directory: `packages/opencode/test/lcm/`

Current size: 50 files, 26,572 lines.

Test themes:

- DB migration, worker, smoke, owner/runtime support
- lifecycle activation, passive runtime, family runtime, child/session scope
- finalized sync and post-turn sync retry, large files, path provenance, retrieval tools, retrieval auth, regex safety
- render prep, provider assembly, provider protocol, provider overflow retry, assembly token budget, non-model leak
- soft backlog, scheduler, hard limit, summary quality, raw leaf parity, active context, recovery
- settings, cost, status events, map, release, and context regression paths

Package scripts in `packages/opencode/package.json` expose these suites with `lcm:*` names. Release-support scripts include `lcm-context-regression.ts`, `lcm-contracts.ts`, `lcm-family-adaptation.ts`, `lcm-provider-safe-report.ts`, and `lcm-release-long-context.ts`.

## VSCode And Webview

Primary files:

- `packages/kilo-vscode/src/kilo-provider/lcm-webview.ts`: webview request bridge for LCM settings.
- `packages/kilo-vscode/webview-ui/src/components/settings/LcmMemoryTab.tsx`: user-facing Memory settings tab for strategy, fresh-tail budget, storage warning threshold/status, cleanup guidance, and cost totals.
- `packages/kilo-vscode/webview-ui/src/components/settings/lcm-memory-state.ts`: content-safe status and formatting helpers; explicitly excludes enable/disable, raw export/view, and LCM-only deletion controls.
- `packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx` and `TaskHeader.tsx`: context/status presentation for LCM-active budgets.
- `packages/kilo-vscode/package.json`: upstream extension identity, LCM validation metadata, and package scripts.

## Public Contract Artifacts

The current generated contract artifact is `packages/opencode/src/session/lcm/contracts/lcm-api-contract.generated.json`. Contract generation/check scripts live in `packages/opencode/script/lcm-contracts.ts` and are exposed as `lcm:contracts:generate` and `lcm:contracts:check`.

## Packaging And CI

The current code adds `.github/workflows/lcm-macos-platform-smoke.yml` and `.github/workflows/lcm-required-checks.yml` for platform smoke and required LCM check coverage, plus package scripts for VSCode compile/snapshot builds. Local release evidence is collected by `packages/opencode/script/lcm-release-long-context.ts`, `packages/opencode/script/lcm-context-regression.ts`, and the focused provider-safe report helpers.
