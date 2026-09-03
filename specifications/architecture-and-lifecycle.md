# Architecture and lifecycle

Status: normative v7.5.9 LCM architecture.

Conversation Memory is an active-context service in the core runtime. Kilo SQLite is the sole raw conversation source
of truth. A separate rebuildable SQLite sidecar holds source metadata, consumption progress, immutable summaries,
frontier revisions, activity, and normalized diagnostic frames.

Every prompt-loop iteration snapshots `experimental.conversation_memory`; absent or `true` selects LCM and explicit
`false` selects upstream legacy compaction. Disabling cancels background maintenance, closes the sidecar, and makes
the service defensively inert. Session-idle, session-deletion, API, CLI, and tool paths cannot open the sidecar while
disabled. Re-enabling resumes lazy sidecar initialization; no mode switch rewrites the Kilo transcript.

`MessageV2.stream()` is newest-first. LCM normalizes it once at the transcript-source boundary before assigning source
ordinals, computing lineage, selecting recent history, or building trees. Strict appends roll the existing frontier
forward with exact new sources. Revert, rewrite, and import invalidate the active lineage and rebuild from Kilo
SQLite.

A persisted source becomes eligible only after a later successful terminal provider response proves that the request
containing it was consumed. A user turn may contain many provider steps separated by sequential or parallel tool
calls; consumption advances at each successful provider step, not only when the whole user turn ends. This applies
equally to ordinary tool results and bounded parent-facing `lcm_query` results. Hidden recovery-child prompts and
primitive results remain in the child lineage. Failed, cancelled, overflowed, and
interrupted requests do not advance durable consumption. When a sidecar is first created or rebuilt, retained
successful non-summary assistant responses provide the same durable proof for messages that precede them; the proving
response's own parts remain protected. Newly finalized assistant and tool results therefore remain protected until a
later successful provider step. Recovery that replaces only a failed or unconsumed request suffix invalidates the old
lineage, then re-bootstraps only the prefix proven by retained successful responses; the replacement suffix remains
protected.
A successful provider step that hands off to an already queued prompt records consumption before the turn closes with
upstream reason `superseded`; it is not an interrupted or failed request.

Immediately before the ordinary processor/provider call, after upstream transformations and model-message
conversion, LCM:

1. measures fixed input and raw conversation pressure separately;
2. syncs the current chronological source lineage and records the request's consumption candidate;
3. derives and independently verifies the exact transformed provider-message suffix that must remain raw;
4. starts or joins the appropriate soft/hard maintenance work;
5. projects one stable exact-lineage frontier without opportunistic expansion; and
6. passes the result through the ordinary upstream processor/provider path.

Soft checkpoints occur after successful provider steps and terminal tool-result steps in a long turn. Maintenance is
dispatched before the next model step. Optimistic overlap is used first. An observed concurrency/busy rejection
latches blocking scheduling for that provider/model. Silently serializing
providers naturally execute the already-dispatched maintenance request first.
Provider request deadlines, including the first-response-byte deadline, remain upstream-owned.

Hard and manual maintenance pre-empt queued soft work. Hard maintenance is blocking and convergent for reducible
history. If the configured target is impossible but the complete request fits, status becomes `constrained`; if the
complete request cannot fit, the provider call is not sent.

Foreground maintenance returns its before/after LCM-owned token counts, target, lineage, revision, target completion,
and whether a strict reduction occurred. Status combines a frontier only with a matching-lineage frame; after
maintenance and before the next projection it recomputes active composition instead of joining a new revision to old
pressure.

All sidecar/model/tree boundaries are cancellation-aware and typed. An LCM fault below the hard limit leaves the
ordinary request unchanged and records degraded health. At the hard limit it must fail closed rather than silently
send an oversized request or create a legacy compaction turn. These fail-closed rules apply only to enabled LCM;
disabled mode follows the upstream v7.5.9 overflow and compaction contract, including threshold-preflight deferral
after a current-turn tool result.

LCM does not define a second processor result protocol. The processor retains upstream `compact`, `stop`, and
`continue` results plus upstream request settlement. A generic `contextManagement` mode suppresses only upstream's
automatic threshold checks while an external manager owns the request context; a real provider overflow still returns
the ordinary `compact` result. The Kilo-owned prompt adapter then performs one strict LCM recovery or routes the same
result to legacy compaction when LCM is disabled. Manual maintenance and LCM tool registration are likewise selected
behind Kilo-owned adapters, so provider requests, queues, interruption, resume state, and legacy compaction retain one
upstream implementation.
