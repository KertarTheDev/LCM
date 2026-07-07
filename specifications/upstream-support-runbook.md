# LCM Upstream Support Runbook

Status date: 2026-06-23.

This runbook records local operational guidance for maintaining and supporting LCM after upstream integration. It does not replace external installed-editor release evidence.

## Release Branch Policy

LCM release syncs are maintained as clean branches on top of a specific upstream Kilo release tag. For a new upstream release, create a fresh `kilocode-lcm-v<upstream-release>` branch from that tag, replay or squash-merge the current LCM delta with explicit conflict review, update these current-code specs to the new base, then rebase prerelease-only release workflow/README changes on top of the corrected branch.

The current release-sync branch is `kilocode-lcm-v3.7.54`, based on upstream `v7.3.54`. The older rolling `kilocode-lcm` branch is no longer the default source for release validation once a release-specific branch exists; use it only as a previous LCM source for comparison or cherry-picking.

## Current Upstream Package Policy

The upstream-aligned VSCode package uses the normal Kilo extension identity:

- package name: `kilo-code`
- publisher: `kilocode`
- extension ID: `kilocode.kilo-code`
- display name: `Kilo Code: AI Coding Agent, Copilot, and Autocomplete`

Validation VSIX builds should be installed in an isolated editor profile or in a profile where the marketplace Kilo extension is disabled or uninstalled. Current LCM builds intentionally use normal Kilo command, view, settings, and storage namespaces.

## Existing Session Policy

Current LCM does not import legacy compacted source into lossless memory. Existing sessions are handled by lifecycle proof:

- New or one-message sessions start `lcm_active`.
- Existing sessions, including sessions with legacy compaction markers, start `passive_synced` and can continue only after prompt-time proof from finalized source, complete boundary metadata, valid artifacts, and rebuildable active context.
- Any old `legacy_read_only` conversation row is normalized back to the normal `lcm_active` or `passive_synced` initial state on access.
- Failed proof keeps history readable where possible and blocks only continuation or retrieval paths that require missing source.

Support messaging should state that older compacted sessions continue with the persisted source that remains; content already removed by old compaction cannot be recreated unless a future implementation adds and verifies a separate conversion/import path.

## Data Roots

LCM memory is family-scoped under the normal Kilo data root:

```text
<kilo-data-dir>/lcm/families/<family-id>
```

Common editor data roots:

- VSCode on Linux: `~/.config/Code/User/globalStorage/kilocode.kilo-code`
- VSCode on macOS: `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code`
- VSCode on Windows: `%APPDATA%\\Code\\User\\globalStorage\\kilocode.kilo-code`
- VSCodium Flatpak on Linux: `~/.var/app/com.vscodium.codium/data/kilo`

Always confirm the runtime-reported data root when collecting evidence. Flatpak, Cursor, remote development, and custom profile setups can change the effective path.

## User Settings Commands

Public LCM settings are strategy, fresh-tail token budget, and storage warning threshold:

```sh
kilo lcm settings show
kilo lcm settings set --strategy upward
kilo lcm settings set --strategy dolt
kilo lcm settings set --fresh-tail-tokens 20000
kilo lcm settings set --storage-warning-threshold-bytes 10737418240
```

There is no LCM enable/disable setting.

## Debug Commands

Debug DB commands operate on an explicit family root:

```sh
kilo debug lcm-db-smoke --data-dir <kilo-data-dir>/lcm/families/<family-id> --json
kilo debug lcm-db-diagnose --data-dir <kilo-data-dir>/lcm/families/<family-id> --json
kilo debug lcm-db-rebuild --data-dir <kilo-data-dir>/lcm/families/<family-id> --json
```

For packaged-runtime evidence, run these commands from the `extension/bin/kilo` binary extracted from the VSIX, not from the source tree.

## Operator Diagnostics

Use metrics/status events first for threshold and tuning triage. `lcm.metrics.updated` is content-safe and reports active tokens, hard limit, soft threshold, provider context/input/output limits, output reserve, system/tool overhead tokens, fresh-tail budget/counts, unconsumed post-current raw counts, protected-tail raw tokens/items, soft backlog tokens/items, raw lane tokens, lane counts, lane-latch diagnostics, budget status, storage warning state, last maintenance status, and queued deferred soft-maintenance debt.

Interpret `budgetStatus = "provider_limit_fallback"` as a provider metadata limitation or clamp: LCM is using conservative normalized limits rather than raw provider values. Interpret `storageWarning = true` as pressure above the configured warning threshold, not as automatic cleanup or deletion. Interpret `deferredSoftMaintenanceQueued = true` as retry debt already coalesced for the conversation; use its attempt count and next-run timestamp instead of reading `lcm_deferred_jobs` directly.

Use `kilo debug lcm-db-diagnose --data-dir <family-root> --json` for storage/index health. The report checks owner-lock/layout presence, migration registry readability, search extension/index readiness, deferred-job queue readability, large-payload marker readability, path-provenance row readability, map status row readability, and artifact cleanup queue readability. It intentionally does not export message text, summaries, raw file content, map payloads, prompt text, or provider output.

For long-context tuning, prefer `upward` unless deliberately testing Dolt-style summary hierarchy behavior. Adjust `freshTailTokens` only to change how many newest whole raw-message rows remain verbatim after mandatory current-turn protection; the default is 20,000 tokens. Increase `storageWarningThresholdBytes` only to adjust support warnings for local disk policy; it is not a cap and does not prune memory. Large files should enter memory through path/artifact-backed markers and be recovered through authorized read/retrieval paths. Local Ollama or local OpenAI-compatible endpoints may defer background maintenance, maps, or child-session admission while foreground work is active; wait for the queued retry or reduce concurrent background work instead of bypassing LCM.

## Safe Error Triage

Common user-facing LCM safe-error families:

- `db_unavailable`, `db_migration_failed`, `db_locked`, `db_corrupt`: memory backend cannot currently prove safe continuation. Ask for debug smoke/diagnose evidence and avoid provider calls that require LCM state.
- `legacy_read_only`: unsupported read-only state after a failed or stale proof. Current marker-bearing sessions should normally be normalized back to LCM activation; collect lifecycle/status evidence if this state appears.
- `missing_source`: source required for lossless continuation was never durably captured. Ask the user to repeat the missing input/action or start a new thread.
- `stale_source`, `permission_denied`: path-backed file provenance or permission failed. Re-register or re-read the current file after permission/provenance is valid.
- `hard_limit_unresolved`: blocking maintenance could not produce a provider-safe request under the hard limit. Start a new thread and attach the needed source explicitly.
- `provider_capacity_deferred`: local provider endpoint is busy. Retry after foreground work completes.

Safe errors should not expose raw prompt, file, tool output, summary, or provider payload content.

## Deletion And Storage

Normal Kilo session deletion is the cleanup path for LCM family memory. Deleting a session should cascade LCM conversation rows, derived rows, inline payloads, map records, and LCM-owned artifacts for the conversation tree.

Path-backed workspace/source files are external observations and must not be deleted by LCM cleanup. Storage pressure is warning-only by default; do not delete LCM memory for visible sessions outside normal session deletion.

## Installed-Editor Evidence Checklist

Before stable release, collect installed-editor evidence that includes:

- exact OS/editor/version and architecture
- VSIX path and SHA-256
- extension ID/version from `--list-extensions --show-versions`
- Kilo data root and LCM family root
- packaged-runtime DB smoke from extracted VSIX
- prompt-time LCM activation
- soft maintenance
- hard-limit maintenance
- retrieval through LCM tools
- large-file/path-backed behavior
- map behavior
- normal Kilo workflow smoke
