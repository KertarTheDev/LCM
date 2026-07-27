# Architecture and lifecycle

Status: normative v7.4.16 LCM architecture.

Conversation Memory is an active-context service in the core runtime. Kilo SQLite is the sole raw conversation source
of truth. A separate rebuildable SQLite sidecar holds source metadata, consumption progress, immutable summaries,
frontier revisions, activity, and normalized diagnostic frames.

`MessageV2.stream()` is newest-first. LCM normalizes it once at the transcript-source boundary before assigning source
ordinals, computing lineage, selecting recent history, or building trees. Strict appends roll the existing frontier
forward with exact new sources. Revert, rewrite, and import invalidate the active lineage and rebuild from Kilo
SQLite.

A persisted source becomes eligible only after a later successful terminal provider response proves that the request
containing it was consumed. Failed, cancelled, overflowed, and interrupted requests do not advance durable
consumption. When a sidecar is first created or rebuilt, retained successful non-summary assistant responses provide
the same durable proof for messages that precede them; the proving response's own parts remain protected. Newly
finalized assistant and tool results therefore remain protected until a later successful provider step.

Immediately before the ordinary processor/provider call, after upstream transformations and model-message
conversion, LCM:

1. measures fixed input and raw conversation pressure separately;
2. syncs the current chronological source lineage and records the request's consumption candidate;
3. derives and independently verifies the exact transformed provider-message suffix that must remain raw;
4. starts or joins the appropriate soft/hard maintenance work;
5. projects one stable exact-lineage frontier without opportunistic expansion; and
6. passes the result through the unchanged processor/provider path.

Soft checkpoints occur after successful provider steps and terminal tool-result steps in a long turn. Maintenance is
dispatched before the next model step. Optimistic overlap is used first. An observed concurrency/busy rejection
latches blocking scheduling for that provider/model. Silently serializing
providers naturally execute the already-dispatched maintenance request first.

Hard and manual maintenance pre-empt queued soft work. Hard maintenance is blocking and convergent for reducible
history. If the configured target is impossible but the complete request fits, status becomes `constrained`; if the
complete request cannot fit, the provider call is not sent.

All sidecar/model/tree boundaries are cancellation-aware and typed. An LCM fault below the hard limit leaves the
ordinary request unchanged and records degraded health. At the hard limit it must fail closed rather than silently
send an oversized request or create a legacy compaction turn.
