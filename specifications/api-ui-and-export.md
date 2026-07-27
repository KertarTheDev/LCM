# API, UI, and export

Status: normative v7.4.16 product-surface contract.

The authorized instance API retains:

- `GET /session/:sessionID/lcm/status`
- `GET /session/:sessionID/lcm/activity`
- `POST /session/:sessionID/lcm/context/export`

Status includes usable/active/full capacity plus `softThresholdTokens`, `rawLaneTokens`, `rawLaneRatio`, and
`fixedInputTokens`. Composition separately reports eligible-backlog and protected-raw token/item counts alongside
active summary/raw composition. Maintenance phase is one of `idle`, `soft_queued`, `soft_running`, `hard_running`,
`manual_running`, or `constrained`.
When usable capacity is zero or absent, `capacity.known` is false and issue code `lcm_capacity_unknown` explains the
required model configuration.

Activity is newest-first and records frontier advancement, interventions/no-ops, degraded fallback below hard
pressure, and cache rebuild. Frontier activity identifies the direct summary roots and whether the cause was
`soft_leaf`, `hard_level`, or `manual`.

VS Code shows lane pressure, composition, health, and maintenance phase in the task context header and Context
preferences. The old Auto Compaction toggle/limit is not presented as the active control. Context preferences expose
the LCM soft threshold, default 40%; legacy tool-output pruning remains separate. TUI/CLI `/lcm status` shows the same
lane and phase fields. Expanded task stats remain visible without timeline activity or known capacity, and route
failures are displayed instead of being converted into an empty status.

All existing manual compact/summarize affordances retain their request and success contracts but invoke forced manual
LCM maintenance. A no-op is successful and observable.

Export remains a private atomic ZIP containing normalized pre/post frames, current and retained diagnostic revisions,
summary relationships, source metadata, activity, product/upstream identity, and hashes. It excludes executable
functions, credentials, provider headers/options/wire bodies, and raw inline binary bytes.
