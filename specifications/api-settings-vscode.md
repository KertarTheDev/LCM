# API, Settings, VSCode, And Packaging

This document describes the current public route and VSCode/webview integration for LCM on the v7.4.11 base.

## Route Surface

LCM route schemas and handlers are implemented in:

- `packages/opencode/src/server/routes/instance/httpapi/groups/lcm-contract.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/lcm.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/lcm.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`

Sessionless settings routes:

- `GET /lcm/settings`
- `PATCH /lcm/settings`

Session-scoped routes:

- `GET /session/:sessionID/lcm/capabilities`
- `GET /session/:sessionID/lcm/settings`
- `PATCH /session/:sessionID/lcm/settings`
- `POST /session/:sessionID/lcm/maintenance/cancel`
- `POST /session/:sessionID/lcm/db/diagnose`
- `POST /session/:sessionID/lcm/db/recover-lock`
- `POST /session/:sessionID/lcm/db/rebuild`
- `POST /session/:sessionID/lcm/prompts/export`
- the existing summarize route, now backed by LCM final-source sync and manual maintenance

Route errors are normalized through `lcmRouteErrorResponse(...)` and `lcmRouteHttpStatus(...)`. Recovery and rebuild raw handlers reject unknown fields before schema decoding. Trusted project, workspace, session, and family identity comes from route/runtime state rather than caller-supplied storage paths.

## Generated Contracts

Public HTTP schemas generate:

- `packages/sdk/openapi.json`
- `packages/sdk/js/src/v2/gen/types.gen.ts`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`

The LCM-specific generated artifact is `packages/opencode/src/session/lcm/contracts/lcm-api-contract.generated.json`. Run:

```sh
bun run script/generate.ts
bun run --cwd packages/opencode lcm:contracts:generate
bun run --cwd packages/opencode lcm:contracts:check
```

after changing routes, DTOs, safe-error literals, SDK payloads, or webview payloads.

## Settings Contract

Public writable settings are intentionally narrow:

- `strategy`: `upward` or `dolt`
- `storageWarningThresholdBytes`: a positive integer

They are persisted through normal Kilo config under `lcm.strategy` and `lcm.storage.warningThresholdBytes`. `freshTailTokens` remains runtime-owned and is not writable.

`LcmSettingsState` reports the effective scope, storage bytes/warning state, and optional session-specific lifecycle, DB, safe-error, and aggregate cost status. Sessionless routes are config-only and work before a conversation exists. Session-scoped routes attach runtime status for the trusted session/family.

Unsupported fields, nulls, invalid values, and mismatched project/workspace/session assertions fail as canonical `invalid_request` safe errors.

## CLI And TUI

`packages/opencode/src/cli/cmd/lcm.ts` implements:

- `kilo lcm settings show`
- `kilo lcm settings set --strategy upward|dolt`
- `kilo lcm settings set --storage-warning-threshold-bytes <bytes>`

In the interactive TUI, `/lcm` opens the LCM conversation-context dialog and `/lcm-settings` is an alias. Upstream `/memory` remains the project-memory command. The two namespaces are intentionally complementary.

## VSCode Bridge

`packages/kilo-vscode/src/kilo-provider/lcm-settings.ts` is a thin transport bridge. It handles only:

- `requestLcmSettings`
- `updateLcmSettings`
- the corresponding `.result` responses

When a local session is selected it calls the generated session-scoped SDK methods; otherwise it calls the generated sessionless settings methods. Directory/workspace selectors are transport context only. Runtime safe errors are validated before forwarding, and bridge-generated fallbacks use the canonical safe-error message for their template key.

The extension host does not open, migrate, inspect, repair, or delete the LCM PGlite database. DB support actions remain available through the runtime-owned public routes for CLI/support consumers, but are not duplicated as extension-host storage logic.

## VSCode Settings UI

`packages/kilo-vscode/webview-ui/src/components/settings/LcmContextSettings.tsx` renders:

- strategy selection;
- storage warning threshold editing;
- current storage size;
- optional lifecycle/DB status;
- explicit refresh and content-safe errors.

`ContextTab.tsx` places this LCM conversation-context card before the retained upstream project-memory section. The upstream memory section and its indexing controls remain owned by Kilo project memory. Misleading legacy compaction/prune settings are not shown as the LCM context-management controls.

There is no LCM enable/disable switch, raw memory browser, extension-host DB repair, or LCM-only deletion control. Normal session deletion remains the product cleanup boundary.

## Upstream Compatibility

The public SDK continues to contain upstream `session.compacted` types/events because upstream `SessionCompaction` remains a supported non-LCM adapter. LCM event names use `lcm.maintenance.*`; there is no parallel `lcm.compaction.*` namespace.

Upstream project-memory events and settings remain present. LCM settings and events describe durable conversation context, not repository/project memory.

## Packaging Verification

For release-facing changes run the generated-contract checks, extension/webview typechecks, VSCode compile, and snapshot build. The packaged runtime, not the extension host, must pass the LCM DB smoke. External installed-editor evidence remains required for stable release approval.
