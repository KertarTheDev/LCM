# API, UI, and export

Status: normative v7.5.9 product-surface contract.

The authorized instance API retains:

- `GET /session/:sessionID/lcm/status`
- `GET /session/:sessionID/lcm/activity`
- `POST /session/:sessionID/lcm/context/export`

When `experimental.conversation_memory` is explicitly `false`, all three routes return typed `409 Conflict` with
`Conversation Memory is disabled. Enable experimental.conversation_memory to use this feature.` before accessing
the sidecar. Enabled success DTOs remain unchanged.

Status includes usable/active/full capacity plus `softThresholdTokens`, `rawLaneTokens`, `rawLaneRatio`, and
`fixedInputTokens`. Composition separately reports eligible-backlog and protected-raw token/item counts alongside
active summary/raw composition. Protected raw is split into mutually exclusive recent-consumed and not-yet-consumed
token/item counts; those two values sum to the protected total. Maintenance phase is one of `idle`, `soft_queued`,
`soft_running`, `hard_running`, `manual_running`, or `constrained`.
When usable capacity is zero or absent, `capacity.known` is false and issue code `lcm_capacity_unknown` explains the
required model configuration.

Activity is newest-first and records frontier advancement, interventions/no-ops, degraded fallback below hard
pressure, and cache rebuild. Frontier activity identifies the direct summary roots and whether the cause was
`soft_leaf`, `hard_level`, or `manual`. Reusing an existing summary frontier for an ordinary provider request is a
diagnostic frame, not timeline activity.

When LCM is enabled, VS Code shows lane pressure, composition, health, and maintenance phase in the task context
header and Context preferences. The old Auto Compaction toggle/limit is not presented as the active control. Context
preferences expose the LCM soft threshold, default 60%; legacy tool-output pruning remains separate. TUI/CLI
`/lcm status` shows the same lane and phase fields. Expanded task stats remain visible without timeline activity or
known capacity, and route failures are displayed instead of being converted into an empty status.
Timeline and export actions use the local session identity carried by the displayed status, so a reopened session's
controls remain available even when the transient compose-session signal is absent.

When disabled, VS Code stops LCM polling and hides its telemetry/export/threshold surfaces, while restoring upstream
Auto Compaction, Auto Compaction Limit, and pruning controls. The TUI palette hides `/lcm`; direct CLI/TUI/API use
reports the stable disabled error. Manual compact/summarize affordances retain their request and success contracts,
using forced LCM maintenance when enabled and upstream legacy compaction when disabled.

Export remains a private atomic ZIP containing normalized pre/post frames, current and retained diagnostic revisions,
summary relationships, sanitized summary-attempt provenance and usage, source metadata, activity, the exact current
upstream base identity (`v7.5.9`), and hashes. It excludes summary prompts and responses, executable functions,
credentials, provider headers/options/wire bodies, and raw inline binary bytes.
Frame `summaryTokens` counts only active summary-node estimates, consistent with status composition; it does not
mislabel the entire projected memory message, which may also contain eligible raw roots and rendering overhead.
