# LCM CI And Drift Gates

Status date: 2026-06-15.

This document defines the upstream ownership checks for LCM-sensitive changes.

## Required Local Scripts

For runtime LCM changes, run the focused owning suite and then:

```sh
bun run --cwd packages/opencode lcm:contracts:check
bun run --cwd packages/opencode lcm:prompt-static
bun run --cwd packages/opencode lcm:prompt-first-message
bun run --cwd packages/opencode lcm:prompt-mcp-schema
bun run --cwd packages/opencode typecheck
bun run --cwd packages/kilo-vscode compile
```

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
- provider-safe assembly and provider protocol
- retrieval authorization and path provenance
- hard-limit and prompt-boundary behavior
- prompt/runtime static unresolved-symbol check
- first-message prompt smoke
- MCP prompt schema smoke
- runtime typecheck
- VSCode LCM settings UI tests
- VSCode compile

`.github/workflows/lcm-macos-platform-smoke.yml` remains the manual macOS packaged-runtime smoke workflow for Darwin VSIX/runtime evidence.

## Drift Checklist

The following upstream changes require an LCM review before merge:

- `MessageV2` role, part, tool-state, file-source, or persisted metadata shape changes.
- Renderer changes in `prepareKiloModelInput`, `MessageV2.toModelMessagesEffect`, plugin message transforms, media fallback, or dynamic prompt injection.
- Provider SDK, provider transform, provider family classification, or tool-call protocol changes.
- Tool registry changes that can alter canonical LCM tool descriptions or model-visible registration.
- Public route, DTO, safe-error, generated SDK, or webview message changes.
- PGlite version, asset loading, migration, owner-lock, packaged-runtime, or filesystem data-root changes.
- VSCode package identity, extension storage namespace, or installed-editor packaging changes.

## Sentinel Expectations

When one of the drift surfaces changes, maintainers should add or update focused coverage for:

- `MESSAGE_V2_SYNC_TAXONOMY`
- raw-leaf renderer parity
- provider family classification and final provider protocol validation
- generated contract artifact drift
- canonical LCM tool-description protection
- settings route/sessionless behavior
- path-backed provenance and stale-source checks

The current specs must be updated in the same change when behavior intentionally changes.
