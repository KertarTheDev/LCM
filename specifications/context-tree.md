# Context tree

Status: normative current-code tree and projection contract.

A source is one finalized model-visible transcript part. A summary is immutable text over ordered source or summary
children. A frontier revision is an ordered set of summary roots followed by protected recent raw sources for one
exact transcript lineage.

Leaf windows target 30% of usable input and never exceed 20,000 estimated tokens. The current implementation retains
two recent turns by default, adjusted by upstream tail configuration. A frontier contains at most eight summary roots;
when wider, it condenses the oldest four adjacent roots and repeats until bounded.

Summary target size is:

```text
max(256, floor(min(1600, 15% of source tokens, 10% of usable input)))
```

The configured compaction agent is tried in normal mode and then aggressive mode. Calls have no tools, do not recurse
through Conversation Memory, and do not write transcript messages. Background attempts time out after 180 seconds;
foreground hard-readiness attempts after 60 seconds. Only one model call runs at a time.

A candidate must be non-empty, smaller than its source, within 115% of target, and contain no invented `src_` or
`sum_` handle. Rejected and failed attempts retain usage/error provenance. If both model attempts fail validation, a
bounded deterministic source-handle index is used when it still achieves real compression.

Request pressure is measured from the final upstream-prepared system, messages, and tools against model-aware usable
input. The soft threshold is upstream `compaction.threshold_percent`, otherwise 60%. Below it the projector is a
no-op. At pressure it may replace only the eligible old message prefix with a clearly delimited memory message,
followed by the untouched protected tail.

A projection is accepted only when it lowers measured pressure, references a complete current-lineage revision, and
keeps protected content unchanged. Starting from the coarsest revision roots, the projector expands child summaries
and then exact source content while the measured request retains a 10% capacity reserve and remains smaller than the
raw request. This per-request cut restores more detail for larger contexts without mutating the durable tree. A
revision is pinned for an assistant/tool continuation ID. If no fitting revision exists or any validation/storage
step fails, the original messages are returned.

The deterministic `binding-state.json` fixture proves multi-level construction, stable authorization relationships,
and exact recovery. Binding facts must remain visible in active memory or be recoverable by search plus source read
without guessing.
