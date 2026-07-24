# LCM CI And Drift Gates

Status date: 2026-07-22.

This document defines the upstream ownership checks for LCM-sensitive changes.

## Required Local Scripts

For runtime LCM changes, run the focused owning suite and then:

```sh
bun run --cwd packages/opencode lcm:contracts:check
bun run --cwd packages/opencode lcm:prompt-static
bun run --cwd packages/opencode lcm:system-context
bun run --cwd packages/opencode lcm:provider-overflow
bun run --cwd packages/opencode typecheck:lcm
bun run --cwd packages/kilo-vscode compile
```

Use the full opencode package typecheck when shared prompt/server/CLI integration or release packaging changes. Project-memory/context-engine changes also run the upstream memory package and focused Kilo integration suites.

For release approval, use the strict release script:

```sh
bun run --cwd packages/opencode lcm:release-long-context:strict
```

The non-strict `lcm:release-long-context` script remains a permissive local report helper. It allows pending manual evidence and skips bundled-runtime smoke, so it must not be treated as stable release approval.

## CI Workflow

`.github/workflows/lcm-required-checks.yml` runs on LCM-sensitive PR paths and covers:

- generated LCM contract check
- migration smoke
- activation and raw-leaf parity
- finalized-source sync and active-context rebuild
- provider-safe assembly, exact assembly-token-budget binding, provider protocol, and bounded overflow recovery
- retrieval authorization, retrieval tools, and path provenance
- hard-limit and cutover-quarantine behavior
- prompt/runtime static unresolved-symbol check
- system-context composition
- upstream project-memory, prior-session recall, SWE-pruning, and context-engine seam compatibility
- runtime typecheck
- VSCode LCM settings and context UI tests
- VSCode compile

The trigger paths include upstream context-engine/epoch code, `packages/kilo-memory/**`, Kilo memory/recall/SWE-pruner integrations, generated SDK/OpenAPI output under `packages/sdk/**`, both opencode build entrypoints, debug command registration, the VSCode bundler entrypoint `packages/kilo-vscode/esbuild.js`, and extension packaging helpers under `packages/kilo-vscode/script/**`. Changes to any of these surfaces must run the owning runtime or VSCode job; the obsolete `sdks/**` path is not a valid generated-SDK trigger.

`.github/workflows/lcm-macos-platform-smoke.yml` remains the manual macOS packaged-runtime smoke workflow for Darwin VSIX/runtime evidence.

On `kilocode-lcm-prerelease`, `node --test script/lcm-prerelease-release.test.mjs` is the release-workflow sentinel. It must cover release-ID-bound create/upload/validate/publish/cleanup behavior, the exact 20-asset manifest, archive-only CLI construction, and the LCM VSIX step's package working directory.

`.github/workflows/workflow-validation.yml` runs when GitHub Actions workflows or their checker change. The canonical
`bun run script/check-workflows.ts` gate checks both the explicit workflow allowlist and every active workflow with
checksum-pinned actionlint. It must fail before a push is accepted when YAML mapping keys are duplicated or GitHub
Actions expressions, runner labels, job dependencies, or workflow structure are invalid.

## Drift Checklist

The following upstream changes require an LCM review before merge:

- `MessageV2` role, part, tool-state, file-source, or persisted metadata shape changes.
- Renderer changes in `prepareKiloModelInput`, `MessageV2.toModelMessagesEffect`, plugin message transforms, media fallback, or dynamic prompt injection.
- Provider SDK, provider transform, provider family classification, or tool-call protocol changes.
- Tool registry changes that can alter canonical LCM tool descriptions or model-visible registration.
- Public route, DTO, safe-error, generated SDK, or webview message changes.
- PGlite version, asset loading, migration, owner-lock, packaged-runtime, or filesystem data-root changes.
- Upstream project-memory storage/injection, prior-session recall, SWE-pruned ToolPart persistence, V2 context epochs, or automatic compaction changes.
- CLI build entrypoints, worker-path defines, `debug lcm-db-smoke` registration, or bundled-resource copy changes.
- VSCode package identity, extension storage namespace, or installed-editor packaging changes.
- VSCode esbuild entrypoint or packaging-script changes that alter the bundled runtime, workers, or VSIX layout.
- Prerelease workflow changes that alter release identity, tag resolution, or the expected CLI/VSIX asset manifest.

## Sentinel Expectations

When one of the drift surfaces changes, maintainers should add or update focused coverage for:

- `MESSAGE_V2_SYNC_TAXONOMY`
- raw-leaf renderer parity
- provider family classification and final provider protocol validation
- generated contract artifact drift
- canonical LCM tool-description protection
- settings route/sessionless behavior
- path-backed provenance and stale-source checks
- distinct `/memory` project-memory and `/lcm` conversation-context ownership
- one physical LCM overflow retry followed by fail-closed exhaustion
- compiled PGlite and retrieval regex worker availability through extracted-VSIX smoke
- exact release ID, target SHA, resolved tag SHA, prerelease flags, and 12-CLI/8-VSIX asset manifest
- prerelease VSIX construction through `bun script/build.ts` with `packages/kilo-vscode` as the step working directory

The current specs must be updated in the same change when behavior intentionally changes.
