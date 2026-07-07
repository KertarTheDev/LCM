# Kilo LCM Maintainer Overview

Status date: 2026-06-23.

This overview explains what the current release-sync LCM branch changes relative to upstream Kilo Code release `v7.3.54` (`0f55066dc71254967b97de287bbf58541d42e577`). The current code is the source of truth; earlier milestone documents are historical material.

## Executive Summary

Kilo LCM replaces routine lossy context compaction with a local, runtime-owned memory system. Finalized Kilo messages and parts are written into a PGlite-backed family database, and the prompt path derives a provider-safe active context from that durable source. Summaries, retrieval cues, large-file markers, and map artifacts become model-visible handles into preserved memory rather than destructive replacements for prior context.

The VSCode extension stays a client of the packaged runtime. It exposes Memory settings, status, and installed-editor validation guidance, but it does not own the LCM database. Public user controls are deliberately narrow: strategy selection (`upward` or `dolt`), fresh-tail token budget, and storage warning threshold. There is no LCM enable/disable switch, raw memory browser, raw memory export, or LCM-only delete UI.

## Size Of The Change

Scoped comparison against clean Kilo `v7.3.54`, excluding dependencies, build output, and local artifacts. These raw numbers include LCM work, generated artifacts, and formatter normalization:

| Area | Changed files | Insertions | Deletions | Notes |
| --- | ---: | ---: | ---: | --- |
| `packages/opencode/src` | 117 | 45,516 | 528 | LCM runtime plus prompt/server/tool integration |
| `packages/opencode/test` | 69 | 28,689 | 146 | LCM suites plus focused upstream compatibility tests |
| `packages/opencode/script` | 10 | 3,467 | 64 | LCM release/contract/platform helpers |
| `packages/kilo-vscode/src` | 19 | 1,663 | 271 | Extension backend/status transport and settings bridge |
| `packages/kilo-vscode/webview-ui/src` | 46 | 2,734 | 383 | Memory UI, context status, webview messages, and locale cleanup |
| `packages/kilo-vscode/tests` | 21 | 3,458 | 41 | LCM unit coverage |
| `packages/sdk/js/src` | 3 | 2,706 | 18 | Generated SDK surface |
| `packages/sdk/openapi.json` | 1 | 23,025 | 11,854 | Generated OpenAPI contract |
| `.github` | 2 | 186 | 0 | LCM workflows |
| Package metadata and lockfile | 3 | 83 | 3 | LCM package metadata and lock changes |
| `script/check-workflows.ts` | 1 | 2 | 0 | Workflow allowlist drift gate |
| `packages/kilo-docs` | 3 | 115 | 13 | Generated CLI/source-link docs |
| `packages/ui/src/components/markdown.tsx` | 1 | 1 | 2 | Shared markdown rendering compatibility |
| Publishable guidance and VSCode scripts | 4 | 95 | 18 | Repo guidance, install notes, and extension script updates |

Total scoped source/package delta: 300 changed files, 111,740 insertions, and 13,341 deletions.

Inside the new runtime, `packages/opencode/src/session/lcm/` contains 61 files and about 41,423 lines including the generated contract artifact. The colocated `packages/opencode/test/lcm/` suite contains 50 files and about 26,572 lines. New LCM and map tools add 9 files and about 623 lines.

## Upstream Since The Original Baseline

The branch was replayed over `v7.3.54` on 2026-06-23 as a release-specific LCM branch. The latest upstream release line is now part of the base; remaining differences in this overview are the LCM implementation, generated contract/SDK/docs artifacts, and the small compatibility fixes needed for the new base.

The `v7.3.54` base brings upstream ACP service extraction, background task auto-injection with `task_status` removal, local recall/session search, primary worktree support, session metadata migration, OpenAI websocket transport, TUI workspace/session switching, and core config/plugin service refactors. LCM keeps these upstream changes by preserving the new ACP service structure, mapping the legacy `/compact` ACP compatibility path to runtime-owned `session.summarize`, carrying LCM child-session scope/admission through the new task flow, keeping upstream SDK/OpenAPI regeneration, and using the new core service-use import path.

## Core Runtime Architecture

The runtime owns PGlite database initialization, migrations, owner locks, artifact directories, and per-family conversation state. A family is a root conversation and its trusted child conversations. Runtime ownership is intentionally kept inside `packages/opencode`; VSCode extension host code must not open or migrate the LCM database directly.

The central service is `LcmRuntime.Service` in `packages/opencode/src/session/lcm/runtime.ts`. It provides conversation creation, child conversation creation, final source sync, prompt-time preflight, maintenance queues, provider snapshot lifecycle, retrieval, file exploration, map runs, usage reporting, settings, and cleanup.

Lifecycle state gates behavior:

- `lcm_active`: normal LCM source sync, active context assembly, maintenance, retrieval, and map behavior.
- `passive_synced`: pre-existing sessions, including old sessions with Kilo compaction markers, that may be activated only if prompt-time proof succeeds.
- `legacy_read_only`: retained as a safe error/lifecycle enum for unsupported read-only rows, but current marker-bearing sessions are normalized back to normal LCM activation instead of staying on a legacy pruning path.
- `recovery_required`, `recovery_failed`, and `db_unavailable`: state is readable only where safe; continuation paths fail closed when LCM proof is required.

## Prompt Path Changes

The prompt path now asks LCM for capabilities, syncs finalized source, runs preflight, assembles provider-safe messages, records a provider request snapshot, and validates the final provider-transformed payload before the model call. Legacy `SessionCompaction.prune`, automatic `SessionCompaction.create`, and old tool-result clearing are not used as the LCM-active context-management mechanism, and `SessionCompaction.defaultLayer` is not installed in the default app runtime.

The existing summarize compatibility route is also routed through LCM: it initializes/syncs the conversation and calls runtime-owned manual maintenance while preserving the old boolean response shape. It no longer constructs a legacy `compaction` turn or re-enters the legacy prompt loop.

Provider validation is a major addition. The AI SDK middleware checks the final provider payload after provider transforms and before request dispatch. It validates tool-call/tool-result adjacency and family-specific protocol rules for OpenAI-compatible, Copilot, Anthropic, Mistral, interleaved reasoning, and generic providers. Invalid payloads fail closed as content-safe LCM errors instead of sending a broken request.

When a provider still reports context overflow after LCM preflight succeeded, LCM-active prompting gets up to two recovery retries. Each failed provider snapshot is canceled, the transient assistant attempt is removed from normal history/LCM source sync, preflight reruns with a progressively tighter provider input budget, and the provider request is retried. A remaining overflow fails closed as `hard_limit_unresolved`; it does not enter legacy lossy compaction.

## Data Model

The current schema baseline has 19 tables and 58 indexes. Important table families include:

- Conversations and conversation lineage.
- Immutable source messages and source parts.
- Large files, artifacts, and path-backed provenance records.
- Summaries and summary lineage.
- Active context items and context snapshots.
- Provider request snapshots and retrieval cue lifecycle.
- Provider-transform overhead observations used as future input-budget reserve.
- Usage/cost rows.
- Deferred soft-maintenance retry jobs.
- Map runs and map items.

LCM stores authoritative source, not already-rendered prompt strings. Large finalized source payloads are stored through `lcm_large_files` and stable file IDs rather than duplicated in inline message-part rows. Idempotent source sync tolerates late assistant accounting metadata such as summary flags, cost, and token counts without rewriting source rows, while real content/provenance drift still fails closed with a `start_new_thread` recovery action. Path-backed file records prove canonical path, boundary metadata, size, mtime, and SHA-256 before reads rely on them.

## Retrieval And Maps

The model receives LCM tools only when the trusted runtime scope allows them. Root sessions can use scoped recall tools such as `lcm_grep`, `lcm_describe`, and `lcm_expand_query`; direct expansion and full reads are reserved for trusted child scopes. The prompt path also injects an LCM system guide listing the exact available retrieval and map tools, including how to recover details from fallback/degraded summaries with `summaryID`. Authorization is derived from the current session and conversation lineage, not from model-supplied IDs.

`llm_map` and `agentic_map` implement durable async map runs. The model supplies input, prompt/schema, and options; the runtime owns worker claims, retries, validation, output files, status, cancellation, and usage. This moves common long-context batch loops out of stochastic model code and into deterministic runtime behavior.

## VSCode And Product Surface

The VSCode package is upstream-aligned as the normal `kilocode.kilo-code` extension and includes a bundled runtime. `kilo-provider/lcm-webview.ts` bridges settings/status calls through generated SDK methods, including sessionless settings calls. The webview UI adds a Memory settings tab for strategy, fresh-tail budget, storage warning threshold, storage status, and cleanup guidance through normal session deletion. Primary `/lcm/settings` calls remain config-only and work before a chat session exists; session-scoped Memory settings use the active or inherited local session to report runtime-owned lifecycle and DB status diagnostics, including a visible but disabled `Export prompts` action until the family DB is ready.

Routine extension-host CLI backend and SSE trace logs are off by default and can be enabled with `kilo-code.new.debugBackendLogs` or `KILO_VSCODE_DEBUG_LOGS=1`. Warnings and errors remain visible.

LCM runtime lifecycle events are surfaced in the chat task header as memory hints. First-release soft-threshold work that is needed between finalized agent steps is awaited and shown through the normal memory-preparation labels; deferred/nonblocking soft work can still appear as pending/running/completed background maintenance. Prompt-time LCM preflight and hard-limit maintenance are shown as memory preparation for the current response, and DB/provider/hard-limit safe errors are reduced to content-safe recovery labels with code, retryability, and action details in the tooltip. The chat header and context progress read active-budget pressure from current-session LCM metrics keyed by session/conversation identifiers, not from provider-token fallback totals. The Memory settings status grid also renders content-safe maintenance detail inline, such as active-token progress and soft-backlog pressure, so long maintenance is visible without exposing raw conversation memory. Safe support actions can open the Kilo support URL. DB diagnosis and guided repair go through runtime-owned session routes: repair starts with a dry-run preview, refuses healthy family state, quarantines repairable PGlite state only in apply mode, and resyncs the active session from finalized Kilo messages. Arbitrary DB reset, raw memory browsing, and extension-host DB ownership are not exposed.

The extension prewarms session LCM health through the generated `session.lcm.capabilities` SDK path after backend connection, session registration/creation, session load/focus, and child-session sync. Calls are coalesced per session/directory/workspace and only touch the runtime-owned capabilities route, so DB startup, lock acquisition, and migration warnings can surface before the first large prompt while keeping storage ownership in the CLI runtime. Prompt and command sends start advisory prewarm for the resolved session/directory but do not await extension-side readiness before submission; runtime prompt preflight remains the authoritative point that blocks, repairs, or safely fails before provider dispatch. Retryable route failures and retryable safe status responses get bounded backoff retries without warning on intermediate scheduled attempts; terminal or non-retryable readiness failures still log once for support diagnosis. Connection changes, global config/settings updates, and DB status events invalidate cached readiness.

Blocking hard-limit maintenance distinguishes unresolved capacity from elapsed-time timeout. Timeout results are retryable and preserve partial maintenance counters; DB shutdown also bounds active queue drain before lock release so a stuck foreground DB request cannot keep the plugin process open forever.

Deferred background maintenance does not wait for a future hard-limit prompt to recover. The runtime schedules capped, coalesced soft-maintenance retries per conversation for queue-cap deferrals and provider-capacity deferrals. Queued retries are persisted in the family DB with content-safe metadata, rehydrated from `getCapabilities(...)` after runtime restart, and terminalized when maintenance later completes, fails, or is canceled.

The Memory UI intentionally avoids making LCM a user-disableable feature. Routine manual compact is not the expected LCM-active workflow; automatic maintenance is surfaced as inline busy/status behavior.

## Maintainer Integration Notes

Most LCM behavior is concentrated in `packages/opencode/src/session/lcm/`, but the highest-risk integration points are outside that directory:

- `packages/opencode/src/session/prompt.ts`: prompt-time lifecycle, tool registration, preflight, provider snapshot lifecycle, and post-response source sync.
- `packages/opencode/src/session/llm.ts`: final provider payload validation middleware.
- `packages/opencode/src/tool/registry.ts`: canonical LCM tool-description protection.
- `packages/opencode/src/server/*` and generated SDK contracts: public LCM route/DTO stability.
- `packages/kilo-vscode/src/kilo-provider/lcm-webview.ts`: webview transport and content-safe safe-error normalization.
- `packages/kilo-vscode/webview-ui/src/components/settings/LcmMemoryTab.tsx`: the public Memory settings surface.

When changing any of these surfaces, run the focused owning LCM suite plus typecheck and VSCode compile. API or DTO changes also require contract generation/check.
