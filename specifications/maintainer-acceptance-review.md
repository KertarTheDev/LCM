# Kilo LCM Maintainer Acceptance Review

Review date: 2026-07-10.

Reviewer stance: Kilo Code maintainer evaluating the current `kilocode-lcm-v7.4.1` branch for continued beta and eventual default integration.

## Scope

This review treats current code and the current specs as authority. It covers:

- the LCM runtime and context ownership boundaries under `packages/opencode/src/session/lcm/`;
- prompt, provider, retrieval, map, settings, server, generated SDK, and VSCode integration;
- focused LCM tests and release helpers;
- CI trigger coverage and external candidate-VSIX evidence requirements.

## Assessment

LCM provides a defensible replacement for routine lossy context compaction. It persists finalized source, derives rebuildable active context, validates provider-bound payloads, fails closed when continuation proof is unavailable, and exposes authorized retrieval, large-file, exploration, and map workflows without giving the VSCode extension host database ownership.

The v7.4.1 architecture audit reduced the largest ownership modules without changing their public service facades. Context behavior is split across `context-core.ts`, `context-render.ts`, `context-budget.ts`, `context-state.ts`, and `context-maintenance.ts`. Runtime orchestration is split across `runtime-interface.ts`, `runtime-support.ts`, `runtime-provider.ts`, and `runtime-maintenance.ts`. Every TypeScript module under `src/session/lcm/` is now below 3,000 lines.

The audit also closed two public/release contract defects:

- `freshTailTokens` is no longer a writable public config, API, CLI, TUI, or VSCode setting. The 20,000-token default remains internal threshold and metrics evidence.
- Required-check paths now cover `packages/sdk/**`, `packages/kilo-vscode/esbuild.js`, and `packages/kilo-vscode/script/**`.

The generated LCM contract, OpenAPI document, SDK types, CLI documentation, and current specs must stay synchronized with these boundaries.

## Maintainer Conditions

The following invariants are release-critical:

- finalized source is immutable and terminal-only;
- summarized raw rows are not resurrected by later sync, except for the continuation-critical current-user re-pin;
- passive activation does not generate fresh retrieval cues until the conversation was already active;
- ordinary prompts use preflight as the authoritative sync boundary instead of an eager pre-loop sync;
- terminal maintenance publishes refreshed metrics before its terminal event, and clients reject older metric snapshots by `updatedAt`;
- active sessions never fall back to lossy legacy compaction after an LCM failure;
- retrieval and direct-read authority comes from trusted current-lineage runtime state;
- path-backed reads prove recorded provenance before using current filesystem bytes.
- durable rebuild validates the complete summary graph rather than accepting a valid root beside unreachable or cyclic stored lineage;
- threshold-to-assembly reuse remains bound to the same authority, render preparation, decision, source, consumption, and provider-overhead evidence, with snapshot writes rolled back on cancellation or drift.

Contract changes require regeneration and drift checks. Shared prompt/provider/server changes require the focused owning LCM suite, annotation checks, and the relevant compiler slices. VSCode transport or packaging changes require settings UI coverage, extension compile, and candidate VSIX validation.

## Open Items

No known local correctness defect from this audit blocks continued beta work. Two items remain before default-mainline acceptance:

- Collect installed-editor evidence from the exact candidate VSIX on Nobara/VSCodium and macOS/VSCode, including packaged-runtime DB smoke and a strict long-context report.
- Prove the required LCM workflow and owner-review policy are enforced by branch protection in the target repository.

`lcm_grep` full-candidate materialization before pagination remains a scalability investigation for very large family databases. It is not currently classified as an authorization or correctness defect.

## Recommendation

Accept the current branch for continued beta and release-candidate hardening. Do not declare stable/default integration until the external candidate-VSIX evidence and repository enforcement items are complete.
