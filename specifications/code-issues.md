# LCM Current-Code Issues

Status date: 2026-07-10.

This document records code issues noticed during the current-code specification rebaseline that appear to need fixes for LCM to work correctly.

## Resolved In The v7.4.1 Audit

The architecture/current-state audit found and corrected two release-facing drift issues:

- `freshTailTokens` had escaped into public config, settings DTOs, API routes, generated SDK/OpenAPI, CLI/TUI, and VSCode Memory settings even though the supported public controls are only strategy and storage warning threshold. It is now runtime-owned internal threshold/metrics evidence with the existing 20,000-token default; public attempts to write it are rejected.
- `.github/workflows/lcm-required-checks.yml` watched nonexistent `sdks/**` instead of `packages/sdk/**` and did not include the VSCode esbuild or packaging-script surfaces. The trigger now covers generated SDK/OpenAPI output, `packages/kilo-vscode/esbuild.js`, and `packages/kilo-vscode/script/**`.

The audit also restored current behavioral documentation for passive activation without fresh retrieval cues, ordinary prompts avoiding an eager pre-loop source sync, terminal metrics publication before terminal maintenance events with monotonic client acceptance, and non-resurrection of summarized raw source rows.

The implementation review then corrected runtime/context integrity defects:

- context and runtime service files were split into semantic modules below 3,000 lines while preserving their public facades;
- durable rebuild now ignores finalized metadata-only messages, activates only complete summary-lineage roots, validates the whole same-conversation summary graph for direct provenance, reachability, cycles, and bounded depth, requires an exact current durable snapshot projection, and prevents recursively covered source from reappearing as raw context;
- cached threshold assembly binds the exact render preparation and decision hash, revalidates conversation authority, active rows, model-visible raw/file-marker state, consumption, and provider-overhead reserve, and rolls threshold/provider writes back on stale state or cancellation;
- cached threshold assembly rejects initially invalid lifecycle/capability authority, binds the caller target identity while preserving its resolved durable row evidence, and rejects consumption or provider-overhead drift after threshold persistence;
- provider snapshot headers and ordered item evidence are inserted atomically, including zero-item snapshots;
- unused soft-skip fingerprints were removed because no runtime suppression path stored or consulted them; current threshold/lane checks and deferred retry backoff own no-op pacing;
- provider snapshot item IDs remain immutable across active-context rewrites, and resolved terminalization plus first-consumption insertion is atomic and retryable after failure;
- session deletion cancels delayed/running map and deferred-maintenance work across the trusted descendant tree, canceled hard-limit maintenance blocks preflight, and manual maintenance preserves caller reason through early recovery outcomes;
- retrieval cursors are size/TTL bounded, and local provider capacity evicts idle lanes without allocating state for already-aborted work.

## Remaining Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before applying cursor pagination, and later pages rerun that search/ranking work. This is not a known correctness or authorization defect, but it remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation behavior.

Runtime retrieval cursors are now capped as well as TTL-bound, and idle local provider-capacity state is evicted; those audit findings are no longer open.

## Evidence Gaps

The remaining release gap is external evidence, not a known code defect:

- Installed-editor evidence from the exact candidate VSIX still has to be collected on the Nobara/VSCodium and macOS/VSCode beta targets.
- Strict long-context release approval requires packaged-runtime DB smoke and any required external/manual evidence; source-tree checks alone are not enough.

The broader maintainer acceptance review records release gates, migration policy documentation, maintainability hardening, and CI/drift ownership. The remaining hard blocker is external installed-editor and packaged-runtime evidence.

Do not treat historical issue notes or archived milestone findings as active defects unless they reproduce against `kilocode-lcm-v7.4.1`.
