# Product contract

Status: normative current-code contract.

Conversation Memory helps small-context models continue one Kilo session through repeated context pressure without
silently losing binding details. It automatically represents older finalized history as a durable summary tree while
keeping exact source content recoverable from Kilo's retained transcript.

The product follows these rules:

- Kilo continues to own prompts, tools, permissions, Project Memory, editor context, attachments, queues, remote
  sessions, provider behavior, structured output, and compaction.
- Conversation Memory may replace only an eligible finalized historical prefix.
- The current user turn, active assistant/tool continuation, recent raw tail, system input, tool schemas, and all
  other upstream-prepared lanes remain intact.
- Failures return the unchanged Kilo request path. Existing overflow handling remains available.
- There is one automatic behavior with no Conversation Memory administration screen or algorithm selector.
- The user sees pressure, composition, interventions, health, memory-work usage, and a diagnostic export—not storage
  machinery.
- `compaction.auto` retains its upstream meaning. It does not disable memory preparation or ready projections.
- Manual compaction and summarization remain supported upstream capabilities.

The raw Kilo conversation is authoritative. Derived state may be deleted and rebuilt without deleting or rewriting the
conversation. Summary generation uses the configured compaction agent through the ordinary model service, records its
own usage, writes no synthetic transcript turn, and has bounded cancellation-aware execution.

The supported recovery surface is exactly `lcm_grep`, `lcm_describe`, `lcm_expand`, and `lcm_read`. They use trusted
current-session context and Kilo's ordinary tool filtering and permission flow.
