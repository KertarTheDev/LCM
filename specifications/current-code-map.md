# Current Code Map And Change Statistics

This document maps the current release-sync LCM branch against upstream release `v7.4.1` (`4ed43ab7c5309761276a0513fff99019df1d0570`). The numbers below come from scoped `git diff v7.4.1` comparisons of tracked source/package paths and from direct line counts of the LCM runtime tree on 2026-07-10.

The raw diff includes LCM implementation work, generated artifacts, and formatter normalization. Use these figures for drift/rebase sizing, not as pure hand-authored feature-size accounting.

## Top-Level Change Summary

| Area | Files changed | Insertions | Deletions | Notes |
| --- | ---: | ---: | ---: | --- |
| `packages/opencode/src` | 131 | 48,766 | 587 | LCM runtime plus prompt/server/tool integration |
| `packages/opencode/test` | 75 | 32,177 | 370 | LCM suites plus focused upstream compatibility tests |
| `packages/opencode/script` | 10 | 3,464 | 65 | LCM release/contract/platform helpers |
| `packages/kilo-vscode/src` | 20 | 2,190 | 254 | Extension backend/status transport and settings bridge |
| `packages/kilo-vscode/webview-ui/src` | 51 | 3,338 | 600 | Memory UI, context status, webview messages, and locale cleanup |
| `packages/kilo-vscode/tests` | 22 | 3,825 | 43 | LCM unit coverage |
| `packages/sdk/js/src` | 3 | 2,830 | 18 | Generated SDK surface |
| `packages/sdk/openapi.json` | 1 | 16,600 | 5,069 | Generated OpenAPI route/event contract |
| `.github` | 2 | 195 | 0 | LCM workflows |
| package metadata and lockfile | 4 | 95 | 3 | LCM package metadata and lock changes |
| `script/check-workflows.ts` | 1 | 2 | 0 | Workflow allowlist drift gate |
| `packages/kilo-docs` | 3 | 130 | 13 | Generated CLI/source-link docs |
| `packages/ui/src/components/markdown.tsx` | 1 | 1 | 2 | Shared markdown rendering compatibility |
| publishable guidance and VSCode scripts | 6 | 115 | 50 | Repo guidance, install notes, bundler, and extension script updates |
| typecheck configs and generated-artifact drift gate | 6 | 155 | 5 | Focused compiler slices and generated-artifact ownership |

Scoped total: 336 changed files, 113,883 insertions, and 7,079 deletions. Installed `node_modules`, generated build output, local artifacts, and these specification files are excluded.

## Runtime Core

Primary directory: `packages/opencode/src/session/lcm/`

Current size: 71 files, 44,348 lines including the migration SQL and generated contract artifact.

Key files:

- `runtime.ts`: process-facing `LcmRuntime` Effect service facade and core preflight/orchestration flow.
- `runtime-interface.ts`, `runtime-support.ts`, `runtime-provider.ts`, and `runtime-maintenance.ts`: service contract, shared state/support actions, provider-backed generation/capacity/map-model selection, and maintenance/deferred-job orchestration extracted behind the preserved runtime facade.
- `events.ts`: content-safe LCM event envelope schemas and bus definitions, including public `lcm.maintenance.*` progress events for background/blocking memory maintenance.
- `settings-state.ts`: config-backed LCM settings scope resolution, update validation, Config patch/state projection, and settings-unavailable safe errors.
- `maintenance-results.ts`: content-safe maintenance result construction and soft-maintenance retry decisions/delays.
- `safe-error-schema.ts`: shared zod schemas for LCM safe-error code/action/template payloads used by events, routes, and assistant-message error serialization.
- `operation-control.ts`: shared content-safe operation timeout and cancellation helpers for prompt-critical context work.
- `hash.ts`: canonical SHA-256, stable JSON hash, and namespace-separated hash helpers shared by context, provider protocol, and deferred-job identifiers.
- `db-support-actions.ts`: runtime-owned DB diagnose, owner-lock recovery, and rebuild support orchestration, trusted session-family resolution, live-owner/healthy-state repair refusal, and active-session resync after guided recovery or repair.
- `deferred-jobs.ts`: runtime-owned persistence helpers for deferred soft-maintenance retries that must survive runtime restart without storing raw conversation content, including the content-safe protected-current-user boundary.
- `lifecycle.ts`: family DB readiness, conversation creation, lifecycle states, boundary metadata, capability-class proof, session deletion cleanup, source coverage counts, and usage records.
- `source-sync.ts`: finalized MessageV2 ingestion into immutable `lcm_messages`, `lcm_message_parts`, and large-file artifact rows.
- `source-drift-repair.ts`: rebuild-safe source-drift detection support, derived/source row reset, and repair envelope checks.
- `finalized-sync-retry.ts`: prompt-side warning and retry controller for post-turn finalized-source sync failures.
- `context.ts`: public `LcmContext` service facade and shared orchestration entrypoints.
- `context-core.ts`, `context-render.ts`, `context-budget.ts`, `context-state.ts`, and `context-maintenance.ts`: shared DB/summary helpers, source rendering, provider-aware budget preparation, active-context/snapshot ownership, and maintenance selection/commit/usage/archive helpers. Soft/hard orchestration remains in the preserved `context.ts` facade.
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
- `packages/opencode/src/server/routes/instance/httpapi/groups/lcm.ts`, `handlers/lcm.ts`, `groups/session.ts`, and `handlers/session.ts`: LCM settings, capabilities, runtime-owned maintenance, and summarize compatibility route behavior without legacy `SessionCompaction` turns.
- `packages/opencode/src/cli/cmd/lcm.ts` and `debug/lcm-db.ts`: user/debug CLI for LCM settings and family DB inspection/smoke/owner-lock-recovery/rebuild commands.

## Model-Visible Tools

Primary directory: `packages/opencode/src/tool/`

New LCM/map tool and wrapper files: 10 files, 721 lines.

Registered tools:

- `lcm-grep.ts`
- `lcm-describe.ts`
- `lcm-expand.ts`
- `lcm-expand-query.ts`
- `lcm-read.ts`
- `llm-map.ts`
- `agentic-map.ts`
- `lcm-map-status.ts`
- `lcm-map-cancel.ts`

`lcm-tool-error.ts` is the shared model-visible error wrapper used by these tools; it is not a separately registered tool. `tool/registry.ts` registers the nine canonical LCM/map tools and prevents plugin mutation of their descriptions. `session/prompt.ts` then filters them per session based on runtime capabilities and trusted conversation scope.

## Tests And Evidence Scripts

LCM test directory: `packages/opencode/test/lcm/`

Current size: 51 files, 29,798 lines.

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
- `packages/kilo-vscode/webview-ui/src/components/settings/LcmMemoryTab.tsx`: user-facing Memory settings tab for strategy, storage warning threshold/status, cleanup guidance, and cost totals; fresh-tail values remain runtime-owned metrics rather than writable settings.
- `packages/kilo-vscode/webview-ui/src/components/settings/lcm-memory-state.ts`: content-safe status and formatting helpers; explicitly excludes enable/disable, raw export/view, and LCM-only deletion controls.
- `packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx` and `TaskHeader.tsx`: context/status presentation for LCM-active budgets.
- `packages/kilo-vscode/package.json`: upstream extension identity, LCM validation metadata, and package scripts.

## Public Contract Artifacts

The current generated contract artifact is `packages/opencode/src/session/lcm/contracts/lcm-api-contract.generated.json`. Contract generation/check scripts live in `packages/opencode/script/lcm-contracts.ts` and are exposed as `lcm:contracts:generate` and `lcm:contracts:check`.

## Packaging And CI

The current code adds `.github/workflows/lcm-macos-platform-smoke.yml` and `.github/workflows/lcm-required-checks.yml` for platform smoke and required LCM check coverage, plus package scripts for VSCode compile/snapshot builds. Local release evidence is collected by `packages/opencode/script/lcm-release-long-context.ts`, `packages/opencode/script/lcm-context-regression.ts`, and the focused provider-safe report helpers.
