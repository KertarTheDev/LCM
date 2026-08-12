# Product contract

Status: normative v7.4.21 LCM contract.

Conversation Memory lets a Kilo session continue through repeated context pressure without rewriting the Kilo
transcript or silently discarding binding detail. It incrementally represents consumed finalized history as an
immutable summary tree. Exact source content remains recoverable from the retained Kilo SQLite conversation.

`experimental.conversation_memory` is the product gate. It currently defaults to `true`; only explicit `false`
disables LCM. The default is centralized so a later upstream pull request can make the feature opt-in without
changing either mode's behavior.

When disabled, Kilo uses the upstream v7.4.21 automatic, provider-overflow, and manual compaction paths, including
deferring threshold preflight while the current turn already contains a tool result. LCM performs
no projection, indexing, maintenance, model, tool, event, or sidecar work. An existing derived sidecar is preserved
unchanged and may be reused or rebuilt after re-enabling.

When enabled, the active request has four conceptual lanes:

- stable summary roots;
- eligible consumed raw backlog;
- protected raw history (unconsumed current work plus the exact recent tail); and
- fixed upstream input such as system prompts and tool schemas.

Only the two raw-history lanes drive soft pressure. Summary roots and fixed upstream input do not repeatedly trigger
soft work. A source already covered by an active summary root is in the summary lane, not the raw backlog. The
complete final provider request still drives hard-limit safety.

A user turn may contain many provider steps separated by tool calls. Each successful provider step advances durable
consumption through the exact finalized sources it received, including outputs from the five LCM recovery tools; one
tool call is not a separate user turn, and LCM does not wait for the whole turn to end. A failed or interrupted next
step leaves those new sources unconsumed.

`conversation_memory.soft_threshold_percent` configures soft pressure and the hard-reset target. It defaults to 40%.
The exact recent tail defaults to 15% of usable input, clamped to 2,000–20,000 tokens;
`compaction.preserve_recent_tokens` is the explicit override. While LCM is enabled, `compaction.auto` controls only
the retained legacy subsystem and does not disable Conversation Memory. While LCM is disabled,
`compaction.auto` and `compaction.threshold_percent` regain their upstream meanings.

Provider capacity is required for pressure and maintenance. Custom-provider models therefore persist positive context
and output token limits (plus an optional separate input limit). Missing capacity is reported as
`lcm_capacity_unknown` in status/activity and manual or hard maintenance stops explicitly instead of silently doing
nothing. Ordinary provider execution remains available below a known hard limit.

Conversation Memory begins a soft quantum as soon as raw pressure reaches the threshold. Work may overlap ordinary
agent activity. If a provider rejects concurrent work, that provider/model is treated as single-flight for the
process: maintenance becomes a barrier before the same session's next model request. One model call is dispatched per
soft quantum and sessions receive fair opportunities between quanta.

Hard maintenance runs when the complete outgoing request reaches usable input or after a provider overflow. It first
summarizes eligible raw backlog, then promotes complete active frontier levels until LCM-owned context reaches the
configured soft target when feasible. One stricter retry is allowed after a provider overflow only when maintenance
advanced the exact lineage and local measurement proves that the replacement request is smaller. The retry bypasses
the ordinary continuation pin and uses that new active revision. If no smaller request exists, or irreducible fixed or
protected input still cannot fit, the request fails closed with `lcm_hard_limit_unresolved`; legacy compaction is not
used as fallback.

Manual compaction buttons, `/compact`, TUI/remote commands, HTTP routes, and SDK responses remain compatible
affordances. With LCM enabled they request one forced full LCM maintenance cycle, create no compaction control part or
synthetic assistant summary message, and succeed as an observable no-op when nothing is eligible. With LCM disabled
they use upstream legacy manual compaction and its transcript summary turn.

Kilo continues to own prompts, tools, permissions, Project Memory, editor/media context, queues, remote sessions,
structured output, provider requests, retries, and timeouts. Conversation Memory never changes those lanes or creates
a second provider protocol. Legacy compaction remains compiled for upstream compatibility, including its own
percentage preflight and post-response scheduling, but those checks are unreachable from normal Conversation Memory
automatic and manual product flows.

When enabled, the supported recovery surface is exactly `lcm_grep`, `lcm_describe`, `lcm_expand_query`,
`lcm_expand`, and `lcm_read`. They use trusted current-session context and Kilo's ordinary filtering and permission
flow. Disabled registries expose none of these tools.
