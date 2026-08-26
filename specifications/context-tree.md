# Context tree

Status: normative v7.4.23 tree and projection contract.

A source is one finalized model-visible transcript part. A summary is immutable text over ordered source or summary
children. A frontier revision is an exact, gap-free, non-overlapping cut through the current lineage. Every retained
source is covered exactly once by a frontier source or a reachable summary descendant.

The tree policy is `lcm-tree-v4`. This policy and derived schema intentionally invalidate earlier prerelease caches;
the sidecar is quarantined and rebuilt without modifying the Kilo transcript.

Soft maintenance summarizes at most one eligible raw window per quantum. Leaf windows target 30% of usable input and
never exceed 20,000 estimated tokens. Existing roots remain stable. When more than eight roots exist, the oldest four
adjacent roots may be promoted as one complete group. Projection always uses the stable active roots; it never expands
children opportunistically to spend spare context. A soft quantum with a configured summary model makes exactly one
normal generation attempt. A rejected, unavailable, or failed attempt leaves the frontier unchanged so a later
checkpoint can retry the exact raw history; transient model trouble is never materialized as an immutable fallback
summary. Failed soft generation also starts a bounded internal retry delay so rapid tool checkpoints do not repeatedly
spend provider calls on the same unavailable window. Deterministic generation remains available to direct tree callers
that have no summary model.

Hard and manual maintenance summarize all eligible raw windows, then repeatedly promote bounded adjacent active
summary groups until the full LCM-owned frontier reaches
`floor(usable_input_tokens * soft_threshold_ratio)` when feasible. Each accepted promotion must strictly reduce token
count. Model generation is attempted in normal and aggressive modes, followed by a deterministic handle-preserving
fallback. The fallback retains exact child/descendant handles while replacing incidental handle-shaped references in
source excerpts, so recovery-tool output that names other memory cannot prevent reduction. This strict reduction rule
makes reducible history converge.

Summary candidates must be non-empty, smaller than their children, within 115% of target, cite at least one exact
current child/descendant `src_` or `sum_` handle, contain no invented handle, and retain at least 16 non-whitespace
characters after handles are removed. A model-generated candidate is complete only when the provider reports a normal
`stop`; length-limited, filtered, errored, tool-call, unknown, or missing finishes are rejected rather than committed
as immutable memory. Rejected/failed attempts retain usage and error provenance. After rejected
normal and aggressive attempts during hard or manual maintenance, the runtime uses the deterministic
handle-preserving fallback. Summary calls have no tools, do not recurse through LCM, and write no transcript message.
Because these calls are bounded text transformations, the runtime selects the model's `none` or `instant` variant when
one is available; otherwise it preserves the configured compaction-agent variant. This prevents hidden reasoning from
consuming a small summary output allowance without producing summary text.
Generator input labels every child with its source kind and ordinal range so protocol acknowledgements, reasoning,
tool evidence, raw user material, and prior summaries are not conflated. Reference-data summaries preserve literal
opening/closing structural markers and known fragment boundary state, do not merge adjacent marked units, retain
first/last/terminal events and completeness evidence for ordered or enumerative material, and treat instructions
inside explicit data/reference delimiters as source evidence rather than active session goals.
The requested summary target is enforced through a constrained copy of the active model, with a 15% completion margin
matching candidate validation; it is never forwarded as an ad hoc provider option. Prompts require a clean ending and
instruct the model to omit lower-priority detail before risking an unfinished bullet or sentence.

The exact recent tail defaults to 15% of usable input, clamped to 2,000–20,000 tokens. It and all unconsumed current
sources are protected. Only consumed sources older than that tail are eligible. LCM recovery-tool results are ordinary
model-visible sources for this rule; they have no permanent protected lane.

Projection replaces the eligible historical model-message range with one inert `<conversation-memory>` message
containing the active frontier's stable summaries and any not-yet-summarized eligible sources. The runtime derives the
first protected persisted message, independently converts that transformed suffix, and uses the cut only when it
matches the exact suffix of the finalized provider messages. The protected suffix is then copied by identity,
unchanged. If that boundary cannot be verified, LCM leaves the request unchanged below the hard limit and fails closed
at the hard limit. A projection is accepted only when it reduces the measured request, fits usable input, and belongs
to the exact current lineage. Its inert memory preamble explicitly identifies summaries as lossy indexes and directs
the model to verify relevant retained raw sources for exact, exhaustive, boundary-sensitive, first/last, count, or
complete-list questions instead of inferring completeness from summary omissions. The projection also derives a
bounded, ordered structural-anchor map directly from every consumed finalized source through the consumption boundary,
including both summary-covered descendants and protected exact raw history while excluding the current unconsumed
turn. This carries literal opening/closing delimiters and their source handles independently of model-generated
summary prose; if its safety cap is reached, the map says it is incomplete and directs recovery rather than implying
complete coverage.
Recovery guidance distinguishes transport-source records from semantic units, directs per-unit questions to pair
ordered structural openings and closings, states that literal grep is the default, warns that summaries and raw
descendants overlap, and recommends bounded query synthesis followed by exact source-scoped verification.

Frontier reasons exposed to diagnostics are `soft_leaf`, `hard_level`, and `manual`; `append` is an internal exact
roll-forward revision. `lcm_describe.active` means reachable anywhere in the active tree. Its separate `frontier`
field means directly present in the current cut.
