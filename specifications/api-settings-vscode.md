# API, Settings, VSCode, And Packaging

This document describes the current public route and VSCode/webview integration for LCM.

## Route Surface

LCM routes are implemented in:

- `packages/opencode/src/server/routes/instance/index.ts`
- `packages/opencode/src/server/routes/instance/session.ts`

Sessionless settings routes:

- `GET /lcm/settings`
- `PATCH /lcm/settings`

Session-scoped routes include:

- `GET /:sessionID/lcm/capabilities`
- `GET /:sessionID/lcm/settings`
- `PATCH /:sessionID/lcm/settings`
- `POST /:sessionID/lcm/maintenance/cancel`
- `POST /:sessionID/lcm/db/diagnose`
- `POST /:sessionID/lcm/db/rebuild`
- `POST /:sessionID/lcm/prompts/export`
- existing summarize/compact-compatible route behavior backed by LCM-owned maintenance, not legacy lossy compaction

Route errors are normalized through `lcmRouteErrorResponse(...)` and `lcmRouteHttpStatus(...)` from `route-errors.ts`.

## Generated Contract

Generated contract artifact:

- `packages/opencode/src/session/lcm/contracts/lcm-api-contract.generated.json`

Contract helper:

- `packages/opencode/script/lcm-contracts.ts`

Package scripts:

- `bun run --cwd packages/opencode lcm:contracts:generate`
- `bun run --cwd packages/opencode lcm:contracts:check`

The contract artifact includes safe-error shapes, DTO exposure policy, and canonical tool descriptions.
The normative source for those generated shapes is `api-contracts.md`.

## Settings DTO

`LcmSettingsState` reports:

- strategy
- fresh-tail token budget
- storage warning threshold
- current storage bytes
- storage warning boolean
- effective scope
- optional lifecycle state
- optional DB status
- optional safe error
- optional aggregate cost totals for maintenance, retrieval recall, file exploration, and map operations

The primary `/lcm/settings` routes return config-backed state only. The session-scoped
`/session/:sessionID/lcm/settings` routes return the same writable settings plus runtime-owned
`lifecycleState`, `dbStatus`, and `safeError` when the active session/family can report them.

Settings writes accept only:

- `strategy`
- `freshTailTokens`
- `storageWarningThresholdBytes`
- optional route/transport scope assertions

Unsupported fields, null fields, invalid strategies, invalid thresholds, mismatched session IDs, and mismatched project/workspace assertions return `invalid_request`.

## Settings Persistence

Public settings are config-backed through normal Kilo config:

- `lcm.strategy`
- `lcm.freshTailTokens`
- `lcm.storage.warningThresholdBytes`

`runtime.ts` uses `Config.Service`, and `settings-state.ts` resolves scope from trusted session/project/workspace state. Primary `/lcm/settings` reads and writes do not open PGlite and are not blocked by family DB lock/corruption/migration failure. Session-scoped settings routes first resolve scope from the trusted path session, then attach the same runtime-owned capability status used by the active session so Memory prefs can show `lifecycleState`, `dbStatus`, and safe recovery details. The extension host still receives this as route state; it does not open or migrate family storage.

Effective scope is `default` until an explicit project/workspace config value exists.

## VSCode Webview Bridge

Bridge file:

- `packages/kilo-vscode/src/kilo-provider/lcm-webview.ts`

Webview messages:

- `requestLcmSettings`
- `updateLcmSettings`
- `cancelLcmMaintenance`
- `diagnoseLcmDb`
- `rebuildLcmDb`
- `exportLcmPrompts`
- corresponding `.result` responses

The bridge uses generated SDK methods:

- `client.lcm.settings.get(...)`
- `client.lcm.settings.update(...)`
- `client.session.lcm.settings.get(...)`
- `client.session.lcm.settings.update(...)`
- `client.session.lcm.maintenance.cancel(...)`
- `client.session.lcm.db.diagnose(...)`
- `client.session.lcm.db.rebuild(...)`
- `client.session.lcm.prompts.export(...)`

When a current session is available, the bridge uses the session-scoped settings route so returned lifecycle, DB status, and effective scope are tied to the active conversation. Without a current session it uses the sessionless route and does not fabricate one. Both paths send directory/workspace transport selectors where available, validate SDK-shaped runtime safe errors before forwarding them, and convert malformed safe-error-shaped transport/backend failures into a generic content-safe `LcmSafeError`.

Settings request, update, queued-maintenance cancel, DB diagnose, DB rebuild, and prompt-export envelopes carry webview-generated `requestID` values. The Memory settings tab tracks the current pending read, write, cancel, diagnose, rebuild, and export request IDs and ignores stale or out-of-order `.result` messages. Starting a settings update or prompt export invalidates any in-flight read. Maintenance cancel, DB diagnosis, DB rebuild, and prompt export block concurrent settings reads/writes until the result arrives. Metrics-driven refreshes do not start while a DB-backed write/cancel/diagnose/rebuild/export is pending, and a session switch resets pending request state before loading the newly focused session.

When the Memory settings tab has a selected local Kilo session, its request envelopes include that `sessionID` so session-scoped actions target the visible task instead of relying on extension-host fallback state. Empty selections and synthetic `cloud:*` preview IDs are omitted. Sessionless settings reads and writes remain valid before a chat session exists. Standalone Settings panels inherit the current local session and resolved directory from the sidebar or tab that opened them; if the panel's own webview session store is empty, the extension-host LCM bridge uses that inherited context for session-scoped Memory actions. Already-open Settings panels also receive later local-session selection changes from normal sidebar/editor chat providers, refresh guarded Memory state, and use the latest inherited local session for session-scoped actions. Reopening an existing Settings panel replaces stale inherited context and notifies the Memory tab to refresh guarded settings state.

## Memory Settings UI

Main UI file:

- `packages/kilo-vscode/webview-ui/src/components/settings/LcmMemoryTab.tsx`

The tab currently provides:

- status card with lifecycle/DB status
- strategy selector for `upward` or `dolt`
- fresh-tail token input with tokens explained in the description and debounced autosave
- storage warning threshold input with GiB explained in the description and debounced autosave
- cleanup guidance through normal Kilo session deletion
- content-safe aggregate cost totals
- request-ID guarded refresh/autosave state so stale settings responses cannot overwrite newer user-visible state
- safe action buttons for supported actions: retry/check-again refreshes, queued maintenance retry cancellation, read-only DB diagnostics for DB lock/corruption/unavailable states, guided DB repair preview/apply for corrupt or unavailable diagnostics, new-task recovery, and contact-support links. Guided repair uses only the runtime-owned session route, starts with a dry-run preview, refuses healthy family state, and does not expose raw memory or direct database ownership in the webview.
- prompt export action for session-backed Memory settings. It is enabled only for ready DB-backed sessions. For a selected/inherited local session whose DB status is not ready, the button remains visible but disabled with a content-safe status/tooltip explaining why export is unavailable. It is not rendered for purely sessionless state. The action calls only the runtime-owned session prompt export route for the selected or inherited local session, including idle/non-running sessions, then renders the local export folder path, file count, and first warning code if present. It is a content-bearing local debug artifact request, not raw memory browsing, and the extension host still does not open family storage directly.
- inline content-safe maintenance detail under the maintenance status, including active-token progress, raw-lane pressure, protected-tail raw tokens, fresh-tail tokens, unconsumed post-current raw tokens, and soft-backlog pressure when reported by runtime events or metrics. If raw/backlog pressure is over the soft threshold and there is no active/deferred maintenance event, the status shows that memory is waiting for the next finalized checkpoint.

The ordinary VSCode session transcript export is separate from LCM prompt export. It pages session message history through the cursor API instead of requesting an unbounded message list, and includes readable tool call details: tool name, status, call ID, JSON input, bounded output/error previews, and truncation sidecar metadata when the runtime stored large tool output externally. It remains a chat transcript export, not a raw memory browsing surface.

Explicitly excluded controls are listed in `lcm-memory-state.ts`:

- `Disable LCM`
- `Enable LCM`
- `Reset memory`
- `Delete LCM memory`
- `Export raw memory`
- `View raw memory`

The UI refreshes settings on mount, session change, and `lcm.metrics.updated` events.

## Context Status UI

Changed webview files include:

- `components/chat/ContextProgress.tsx`
- `components/chat/TaskHeader.tsx`
- `styles/task-header.css`
- message type definitions under `types/messages/`

The UI distinguishes `lcm_active_budget` from ordinary provider input/output context accounting, treating provider output separately where needed. `ContextProgress` and `TaskHeader` use current-session LCM metrics for active memory pressure and do not fall back to the last assistant provider-token totals as memory pressure. Provider token accounting remains available as separate cost/context information where explicitly labeled. Metrics events are keyed by every trusted identifier present in the event envelope and payload (`sessionID`, envelope `conversationID`, payload `conversationID`) so a current sidebar session can resolve the snapshot even when the runtime payload is conversation keyed. The chat context detail labels hard-limit fill as `Hard`, raw-lane soft pressure as `Raw`, and the summarizable eligible subset as `Backlog`; raw/backlog percentages may exceed 100% as real pressure values while visual progress fill remains bounded. The Memory settings status grid shows raw-lane pressure separately from soft backlog, fresh tail, and unconsumed post-current rows so protected growth is not misread as a zero raw counter.

## Events

`events.ts` defines content-safe LCM events for DB status, context updates, file status, metrics updates, and compaction/maintenance started, ended, or failed. Runtime code publishes these events via the app bus where available.

Event labels are safe status text, not raw memory content.

## CLI

Current CLI additions:

- `packages/opencode/src/cli/cmd/lcm.ts`
- `packages/opencode/src/cli/cmd/debug/lcm-db.ts`

Settings CLI supports showing and setting LCM strategy, fresh-tail token budget, and storage warning threshold. Debug DB commands support smoke/diagnose/rebuild flows against explicit LCM family roots.

## Package Scripts

Important LCM package scripts in `packages/opencode/package.json`:

- `lcm:contracts:generate`
- `lcm:contracts:check`
- `lcm:migration:smoke`
- `lcm:large-file`
- `lcm:explorer-safety`
- `lcm:map`
- `lcm:db:support`
- `lcm:harness:test`
- `lcm:recovery:test`
- `lcm:active-context:test`
- `lcm:perf:scale`
- `lcm:render-prep`
- `lcm:raw-leaf-parity`
- `lcm:provider-assembly`
- `lcm:provider-protocol`
- `lcm:assembly-token-budget`
- `lcm:non-model-leak`
- `lcm:status-events`
- `lcm:cutover-quarantine`
- `lcm:release-long-context`
- `lcm:release-long-context:strict`
- `lcm:cost`
- `lcm:settings`
- `lcm:activation`
- `lcm:family-runtime`
- `lcm:family-adaptation`
- `lcm:context-regression`
- `lcm:sub-agent-scope`
- `lcm:retrieval-auth`
- `lcm:retrieval-tools`
- `lcm:path-provenance`
- `lcm:regex-safety`
- `lcm:soft-backlog`
- `lcm:maintenance-summary-quality`
- `lcm:token-budget`
- `lcm:scheduler`
- `lcm:perf:below-soft`
- `lcm:summary`
- `lcm:hard-limit`
- `lcm:crash-reopen`
- `lcm:prompt-boundary`

VSCode package scripts include compile and snapshot build paths used by validation packaging.

Routine extension-host backend logs for CLI startup, child-process stdout, SSE connection state, heartbeat reconnects, and per-event traces are gated behind `kilo-code.new.debugBackendLogs` or `KILO_VSCODE_DEBUG_LOGS=1`. Warnings and errors remain visible without debug logging.

The webview forwards LCM lifecycle events into the normal task header instead of using modal prompts. Nonblocking soft-threshold maintenance appears as transient pending/running/completed/canceled hints; first-release over-soft maintenance that runs between finalized agent steps uses the normal active memory-preparation labels because the next model step waits for it. Prompt-time LCM preflight appears as fixed content-safe active preparation phases for opening memory, syncing memory, rebuilding memory context, finding relevant memory, checking memory size, and preparing memory for the model; blocking hard-limit maintenance appears as active memory preparation for the current response. The prompt loop clears runtime-owned memory labels before provider streaming starts, and blocked or interrupted runtime preflight clears those labels before surfacing a content-safe result. DB lock, corruption, unavailable, provider-capacity, timeout, cancellation, and hard-limit failure safe errors remain visible as memory recovery hints until a later lifecycle event reports recovery or replaces the state, with the safe code, retryability, and action in the tooltip. The Memory settings tab also shows a compact runtime status area for the active session: last memory sync, current maintenance state, inline maintenance progress details, active budget, soft backlog, fresh-tail/unconsumed counters, storage pressure, degraded token counting or provider model-limit estimates, and safe next-step labels. When runtime events or metrics show a retryable queued background maintenance retry, the Memory settings tab exposes `Cancel retry`, which calls the runtime-owned session maintenance cancel route and never opens or mutates the DB from the extension host. For DB lock/corruption/unavailable states, the tab can call the runtime-owned session DB diagnose route and render only the content-safe report status, check counts, first safe error, quarantine recommendation, and operation ID. For corrupt or unavailable diagnostics, the tab offers a dry-run repair preview and then an apply action only after the preview reports `would_rebuild`; both calls go through the runtime-owned session DB rebuild route. For ready DB-backed sessions, the tab exposes `Export prompts`, which writes Markdown under the workspace `lcm-export/` directory through the runtime-owned session export route and shows only the returned folder path, file count, and warning code. Safe `contact_support` actions open the Kilo support URL; arbitrary DB reset, raw DB browsing, and extension-host DB ownership remain outside the webview.

On backend connection and session open/focus paths, the extension prewarms LCM by calling the generated session capabilities route for the active session. The prewarm is coalesced per session/directory/workspace and uses the runtime-owned LCM DB path; the extension host never opens storage directly. Prompt and command sends start advisory prewarm for the resolved session/directory, then immediately call the normal prompt or command route. Extension-side capabilities readiness must not block prompt submission, set a synthetic busy composer state, or restore drafts through `sendMessageFailed`; runtime prompt preflight is the authoritative blocking/recovery boundary before any provider request. The advisory prewarm still uses bounded capability-request timeouts and bounded retry backoff for retryable route failures or retryable capabilities safe-status responses, but terminal prewarm failures are support diagnostics rather than prompt-send failures. Malformed safe-error-shaped capability payloads fall back to generic memory-readiness copy for diagnostics. Connection changes, global config/settings updates, and `lcm.db.status` events clear affected cached readiness and cancel stale scheduled retries. Any DB lock, migration, corruption, or unavailable state is surfaced through the same `lcm.db.status` event flow used by normal runtime operations and through runtime preflight if the next prompt cannot safely proceed.

## Packaging And CI

The VSCode package metadata currently identifies the extension with the upstream Kilo identity: display name `Kilo Code: AI Coding Agent, Copilot, and Autocomplete`, publisher `kilocode`, and extension ID `kilocode.kilo-code`.

CI additions:

- `.github/workflows/lcm-macos-platform-smoke.yml`
- `.github/workflows/lcm-required-checks.yml`

Release support scripts produce provider-safe reports, context regression reports, and release long-context evidence under package artifact directories or caller-selected temporary paths. A release-candidate VSIX gate must extract the packaged artifact and prove the bundled webview contains the Memory diagnostics that are required for prerelease use: visible `Export prompts` copy, the disabled-export DB-not-ready status, `Memory active budget`, raw-lane pressure labels, and LCM metrics handling. The same gate must inspect the bundled extension/runtime for the generic `lcmEvent` forwarding path, generated session settings SDK operation, session LCM settings route, and packaged `debug lcm-db-smoke` support, then run the smoke command from the extracted `extension/bin/kilo`.
