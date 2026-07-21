# Kilo LCM Maintainer Overview

Status date: 2026-07-20.

This overview describes the LCM integration relative to upstream Kilo Code `v7.4.13` (`7060f8cb21d79abf00f9c9d5df07f6e95e4956ec`).

## Executive Summary

LCM replaces routine lossy context compaction for LCM-managed conversations with a runtime-owned durable context system. It ingests finalized persisted Kilo messages and parts, derives a provider-safe active context, performs summary maintenance under explicit budgets, and exposes authorized retrieval/map tools for exact-detail recovery.

The v7.4.13 integration was designed on the clean upstream tag before LCM-owned modules were transplanted. It therefore builds on current Kilo memory work instead of replaying an old total replacement.

## Best-Of-Both-Worlds Boundary

The memory subsystems have distinct ownership:

| Concern | Owner |
|---|---|
| Repository/project facts and indexing | upstream `packages/kilo-memory` and `kilocode/memory` |
| `/memory` command and project-memory settings UI | upstream project memory |
| Prior-session recall | upstream recall |
| Current conversation-lineage context, maintenance, and retrieval | LCM |
| Final persisted ToolPart representation, including SWE pruning | upstream message/tool pipeline |
| Durable context source, active view, summaries, maps, and provenance | LCM |
| Legacy lossy compaction for non-LCM prompt paths | upstream `SessionCompaction` adapter |
| Active-LCM overflow/failure recovery | LCM only, fail closed |

Upstream project memory is injected into the normal system context before LCM provider assembly. It is complementary evidence, not a competing conversation-history store. Upstream recall remains available for prior sessions; current-session recall is rejected so that authorization and lineage semantics stay with LCM retrieval.

## Target-Release Integration Seams

`packages/core/src/session/context-engine.ts` adds a pluggable core runner seam and retains the upstream engine as the default. The current Kilo product still uses the V1 prompt service, so `packages/opencode/src/session/prompt.ts` is the narrow production adapter: non-LCM paths retain upstream filtering/compaction, while passive-synced and active conversations use LCM preflight and assembly.

`packages/opencode/src/effect/app-runtime.ts` installs one shared LCM runtime. It also retains `SessionCompaction.defaultLayer` because upstream non-LCM behavior and public compatibility events still depend on it. Every active-LCM legacy path is guarded, and an LCM failure never falls back to lossy pruning or compaction.

## Source Ingestion Compatibility

Source ingestion is final-only. Running tool parts and streaming deltas are not immutable LCM source. The sync boundary consumes sealed persisted MessageV2 parts, including upstream SWE-pruned tool output.

Truncation sidecars are validated as recovery/provenance evidence. LCM does not silently substitute their filesystem bytes for the persisted ToolPart. Full path-backed reads must pass explicit recorded-provenance checks. This preserves upstream message semantics and removes a merge-prone duplicate source-selection policy.

## Runtime Architecture

LCM runtime and DB ownership lives under `packages/opencode/src/session/lcm/`. The Effect service owns PGlite initialization, migrations, owner locking, family lineage, final-source sync, active-context state, maintenance, request snapshots, retrieval, file exploration, maps, usage, settings projection, and cleanup.

Lifecycle states gate all behavior:

- `passive_synced`: durable source exists but prompt-time proof/activation is still required;
- `lcm_active`: LCM is authoritative for the conversation;
- `legacy_read_only`, `recovery_required`, `recovery_failed`, `db_unavailable`: continuation fails closed when proof is unavailable.

Prompt preflight syncs finalized source, validates authority and lifecycle, runs blocking hard-limit maintenance if necessary, assembles the provider-safe request, and records a request snapshot. Provider overflow gets bounded LCM-only retries with tighter reserves, then a canonical `hard_limit_unresolved` error.

## Product Surface

Public settings are strategy (`upward` or `dolt`) and storage warning threshold. `kilo lcm settings show/set`, `/lcm`, and `/lcm-settings` expose conversation-context settings. `/memory` and the retained project-memory section continue to expose upstream project memory.

The VSCode extension bridge at `packages/kilo-vscode/src/kilo-provider/lcm-settings.ts` calls generated SDK settings methods only. `LcmContextSettings.tsx` renders the LCM card in the existing Context settings page, separately from project memory. The extension host never opens, migrates, repairs, or reads the LCM database.

## Public Contracts

LCM route schemas are isolated in `groups/lcm-contract.ts` and `groups/lcm.ts`, with session-scoped endpoints added through the existing session API group. OpenAPI and SDK files are generated from those schemas. LCM progress uses `lcm.maintenance.*`; upstream `session.compacted` remains in the SDK because non-LCM compaction compatibility is retained.

## High-Risk Review Points

- `packages/opencode/src/session/prompt.ts`: V1 dispatch, final-source checkpoints, fail-closed overflow, tool capability filtering.
- `packages/opencode/src/session/llm.ts`: final transformed provider-payload validation.
- `packages/opencode/src/effect/app-runtime.ts`: shared LCM lifetime and non-LCM compaction adapter.
- `packages/opencode/src/tool/recall.ts`: prior-session/current-lineage ownership split.
- `packages/opencode/src/session/lcm/source-sync.ts`: canonical final persisted source.
- server schemas/handlers and generated SDK artifacts.
- the thin VSCode settings bridge and context settings component.

Changes to these surfaces require the owning focused tests, annotation checks, generated-contract checks where applicable, package typechecks, and VSCode compile for release-facing integration.
