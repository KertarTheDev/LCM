# Kilo LCM Maintainer Acceptance Review

Review date: 2026-07-21.

Reviewer stance: Kilo Code maintainer evaluating `kilocode-lcm-v7.4.13` for demonstrable beta use and eventual low-conflict upstream integration.

## Assessment

The architecture is now based on the current upstream release rather than an old LCM implementation shape. The initial target-release seam keeps the upstream context engine as the default. LCM-owned runtime/storage/retrieval modules are then attached through narrow V1 prompt, provider, tool, server, CLI, and VSCode adapters.

This is the correct compatibility direction:

- upstream project memory and `/memory` remain intact;
- upstream recall owns prior sessions, while LCM owns current-lineage retrieval;
- upstream final SWE-pruned ToolParts remain canonical ingestion source;
- upstream compaction remains available for non-LCM prompt paths and public compatibility surfaces;
- active LCM conversations use LCM maintenance and fail closed without a legacy-compaction fallback;
- the VSCode extension remains a transport client rather than a second DB owner.

LCM remains valuable as the authoritative active-conversation system: it preserves finalized source in a family database, derives rebuildable active context, validates provider-bound payloads, performs durable maintenance and maps, and exposes scoped exact-detail retrieval.

## Release-Critical Invariants

- finalized persisted source is terminal-only and immutable;
- persisted SWE-pruned tool output is canonical; sidecars cannot silently replace it;
- summarized raw rows are not resurrected by later sync except the explicit continuation-critical current-user re-pin;
- active sessions never fall back to lossy legacy compaction after an LCM failure;
- provider overflow gets one physical LCM recovery retry, then a canonical fail-closed error;
- retrieval/direct-read authority comes from trusted current-lineage runtime state;
- upstream prior-session recall does not become an alternate current-lineage read path;
- path-backed reads prove recorded provenance before current filesystem bytes are used;
- project memory remains separately available in system context and product UI;
- the extension host never owns PGlite lifecycle.

## Merge-Conflict Posture

Most implementation resides in `packages/opencode/src/session/lcm/`, colocated LCM tests, isolated server contract modules, and Kilo-owned UI/bridge paths. Shared upstream files contain small marked adapters. The target-first core seam and compatibility quarantine test make the dispatch intent explicit.

The largest remaining conflict surface is `session/prompt.ts`, because the current product still uses the V1 prompt implementation. Future upstream migration to the core context-engine dispatch should move more of this adapter behind the engine interface instead of replaying prompt-loop code.

## Conditions Before Stable Release

- the completed `v7.4.13-lcm.1` workflow is accepted as prerelease automation evidence: it targeted `cbd5d6dbb2bfca3c887fd5847744638b1ffdb59a`, produced 12 CLI archives and 8 VSIX assets, and passed packaged Linux x64 runtime smoke;
- all focused compatibility, ingestion, provider, settings, contract, annotation, and compiler gates must still pass for the exact stable candidate;
- the exact stable candidate VSIX compile/snapshot and packaged-runtime DB smoke must pass;
- installed-editor evidence is collected from the exact candidate on supported Nobara/VSCodium and macOS/VSCode targets;
- the strict long-context release gate passes.

## Recommendation

Accept this design for continued implementation and beta demonstration on v7.4.13. Do not declare stable/default integration until the verification and external candidate evidence above are complete.
