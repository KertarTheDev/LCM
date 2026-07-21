# Current Code Map And Change Statistics

This document maps the current release-sync LCM branch against upstream release `v7.4.13` (`7060f8cb21d79abf00f9c9d5df07f6e95e4956ec`). It describes the ownership boundaries after the LCM subsystem was transplanted onto seams designed on the target release.

Generated OpenAPI/SDK artifacts dominate raw line counts, so ownership boundaries and focused adapter review are more useful than aggregate diff size.

## Top-Level Ownership Summary

| Area | Ownership | Notes |
|---|---|---|
| `packages/opencode/src/session/lcm/` | LCM | Runtime, storage, lifecycle, context, retrieval, maps, and contracts |
| `packages/opencode/test/lcm/` | LCM | Deterministic subsystem and compatibility coverage |
| `packages/opencode/src/tool/lcm-*` and map tools | LCM | Capability-filtered model-visible recovery operations |
| `packages/core/src/session/context-engine.ts` | Upstream seam | Retains the default V2 epoch/compaction engine and permits an authoritative adapter |
| `packages/opencode/src/session/prompt.ts` | Upstream adapter | Retains V1 prompt behavior and delegates active conversations to LCM |
| `packages/opencode/src/session/llm.ts` | Upstream adapter | Final provider-payload validation and snapshot accounting |
| `packages/opencode/src/effect/app-runtime.ts` | Upstream adapter | Installs one shared LCM runtime while retaining non-LCM compaction support |
| `packages/opencode/src/server/**` | Mixed | Isolated LCM groups plus narrow public-API adapters |
| `packages/kilo-vscode/src/kilo-provider/lcm-settings.ts` | Kilo/LCM bridge | Transport-only settings bridge; no DB ownership |
| `packages/kilo-vscode/webview-ui/src/components/settings/LcmContextSettings.tsx` | Kilo/LCM UI | Conversation-context settings alongside upstream project memory |
| generated SDK/OpenAPI files | Generated | Public LCM routes and DTOs |

## Runtime Core

Primary directory: `packages/opencode/src/session/lcm/`

The directory contains the transplanted LCM-owned modules, migration SQL, and generated contract artifact. File and line counts are intentionally not normative.

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
- `db.ts`, `db-worker.ts`, `owner-lock.ts`, `migrations.ts`, `pglite-assets.ts`, `pglite-gate.ts`, and `pglite-regex.worker.ts`: PGlite startup, schema migration, packaging/runtime gate checks, owner lock, worker execution lanes, and cancellable database regex work.
- `large-files.ts`, `path-provenance.ts`, `artifacts.ts`, `file-exploration.ts`: artifact storage, path-backed provenance, byte-window reads, previews, exploration status, and file summaries.
- `retrieval.ts`, `retrieval-regex.ts`, `retrieval-regex.worker.ts`: lineage-scoped search, describe, expand, expand-query, read, memory cues, cursor handling, and isolated regex execution/cancellation. Both regex workers are compiled entrypoints and must survive CLI and VSIX packaging.
- `map.ts`: `llm_map`, `agentic_map`, map status/cancel, JSONL input validation, map run/item persistence, leases, retry, and output artifacts.
- `provider-protocol.ts`, `provider-capacity.ts`, `provider-overhead.ts`, `model-limits.ts`, `preflight-errors.ts`, `render-prep.ts`, `token-budget.ts`, `summary.ts`: provider transform/protocol validation, local endpoint concurrency, provider-transform overhead reserve sizing, model-limit fallback/recovery windows, preflight safe-action classification, render manifests, deterministic token counting, and summary quality/fallback behavior.
- `types.ts`: shared runtime DTOs, safe-error enums/templates, lifecycle enums, settings state, preflight result union, retrieval/map DTOs, event payloads, and tool result shapes.

## Runtime Integration

Important changed files outside `src/session/lcm/`:

- `packages/core/src/session/context-engine.ts`, `context-epoch.ts`, and related runner/LLM transport files: target-release context-engine dispatch seam. It proves that LCM can be selected without replacing the upstream engine; upstream V2 epoch/automatic-compaction behavior remains the default, while the current Kilo product still reaches the retained V1 prompt adapter below.
- `packages/opencode/src/session/prompt.ts`: switches active sessions from legacy compacted history to LCM preflight and provider-safe assembly; validates prompt-time render preparation as content-safe LCM errors for active sessions; gates LCM tools by capability; finalizes provider request snapshots; syncs finalized messages after prompt/tool turns with warning/retry handling; rejects provider compact results without automatic legacy compaction.
- `packages/opencode/src/effect/app-runtime.ts`: installs one shared LCM runtime and retains upstream `SessionCompaction` only for non-LCM prompt paths. Active LCM paths never call it as a fallback.
- `packages/opencode/src/session/llm.ts`: validates final provider-transformed payloads before stream execution, records final provider validator hashes, and reports provider-transform overhead observations.
- `packages/opencode/src/session/message-v2.ts`: maps LCM safe errors into assistant message errors.
- `packages/opencode/src/tool/recall.ts`: retains upstream prior-session recall but rejects current-session recall, which is owned by lineage-scoped LCM retrieval.
- `packages/opencode/src/tool/tool.ts`, `shell.ts`, `truncate.ts`, and `truncation-dir.ts`: carry validated truncation metadata through upstream tool execution. Final persisted SWE-pruned ToolParts remain canonical LCM source; sidecars are recovery evidence only.
- `packages/opencode/src/session/llm.ts`, `session.ts`, `processor.ts`, `status.ts`, `system.ts`: smaller integration points for provider execution, session behavior, and status surfaces.
- `packages/opencode/src/server/routes/instance/httpapi/groups/lcm-contract.ts`, `groups/lcm.ts`, `handlers/lcm.ts`, `groups/session.ts`, and `handlers/session.ts`: isolated LCM schemas, settings, capabilities, runtime-owned maintenance, and summarize compatibility behavior without constructing legacy compaction turns.
- `packages/opencode/src/cli/cmd/lcm.ts`: `kilo lcm settings show/set`. In the TUI, `/lcm` and `/lcm-settings` open conversation-context settings; upstream `/memory` continues to own project memory.

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

The suite is organized by owning runtime behavior rather than by an aggregate line-count target.

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

- `packages/kilo-vscode/src/kilo-provider/lcm-settings.ts`: thin generated-SDK bridge for LCM settings and content-safe errors.
- `packages/kilo-vscode/webview-ui/src/components/settings/LcmContextSettings.tsx`: strategy, storage threshold, and runtime status for conversation context.
- `packages/kilo-vscode/webview-ui/src/components/settings/ContextTab.tsx`: places LCM conversation context next to, but separate from, upstream project memory and removes misleading legacy-compaction configuration controls.
- `packages/kilo-vscode/src/KiloProvider.ts` and webview message unions: narrow transport integration. The extension host does not open, migrate, or inspect the family DB.

## Public Contract Artifacts

The current generated contract artifact is `packages/opencode/src/session/lcm/contracts/lcm-api-contract.generated.json`. Contract generation/check scripts live in `packages/opencode/script/lcm-contracts.ts` and are exposed as `lcm:contracts:generate` and `lcm:contracts:check`.

## Packaging And CI

The current code adds `.github/workflows/lcm-macos-platform-smoke.yml` and `.github/workflows/lcm-required-checks.yml` for platform smoke and required LCM check coverage, plus package scripts for VSCode compile/snapshot builds. Required-check triggers cover upstream project memory, context-engine/epoch seams, SWE pruning, recall ownership, LCM runtime, both regex-worker build entrypoints, debug commands, and VSIX packaging. Local release evidence is collected by `packages/opencode/script/lcm-release-long-context.ts`, `packages/opencode/script/lcm-context-regression.ts`, and the focused provider-safe report helpers.
