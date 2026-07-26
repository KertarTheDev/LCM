# Architecture and lifecycle

Status: normative current-code architecture.

Conversation Memory is a projection service inside the core CLI/runtime. The extension host, webview, TUI, and API
consume runtime services; they never open the derived database.

```text
persisted final Kilo transcript
             |
             v
  source metadata + summary tree
             |
             v
final upstream-prepared model messages -- eligible-prefix projection --> ordinary Kilo model path
```

Runtime ownership is concentrated in `packages/opencode/src/kilocode/session/lcm/`. Tools are registered in the normal
Kilo tool registry. The instance HTTP API composes the three observability/export routes. VS Code consumes generated
SDK DTOs and events.

On each request, Kilo first completes its ordinary message filtering, payload pruning, model-message conversion,
system/Project Memory assembly, tool resolution, and structured-output preparation. Conversation Memory then measures
that final input. At or above the effective threshold it asks the projector for a verified current-lineage revision.
Only `projected` changes the messages passed to the existing processor. Below hard pressure, `unchanged` and
`unavailable` retain the upstream messages. At hard pressure, either outcome enters Kilo's existing compaction path
instead of sending an oversized raw request when upstream automatic compaction is enabled. If the user disabled
upstream automatic compaction, the unchanged upstream behavior remains in control.

Before upstream schedules automatic overflow compaction, the runtime gives Conversation Memory one bounded readiness
opportunity. A ready revision continues into normal request assembly and projection. Any other outcome follows the
existing compaction path exactly once.

Only persisted terminal message parts become sources. Streaming deltas and running tool parts are excluded. Indexing
is safe to repeat. When a lineage is a strict append, the runtime immediately rolls the prior valid frontier forward
with the new exact sources, then rebalances it in the background at pressure; this avoids a one-request projection gap
after every turn. Summary work is coalesced per session, protected by an expiring lease, serialized across model calls,
and cancelled on shutdown. Background work never owns the prompt queue.

Session deletion removes derived session data. A rewritten, reverted, or imported lineage deactivates old frames and
frontiers for projection while preserving retained diagnostic evidence. Tools always rebuild and validate a view for
the trusted execution session and its current lineage.

Every public prompt-path entrypoint is best effort. Database, transcript, model, validation, frame, activity, and event
failures are converted to safe degraded state where possible and never replace an otherwise valid upstream error.
