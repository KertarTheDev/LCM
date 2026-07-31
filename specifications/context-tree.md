# Context tree

Status: normative v7.4.17 tree and projection contract.

A source is one finalized model-visible transcript part. A summary is immutable text over ordered source or summary
children. A frontier revision is an exact, gap-free, non-overlapping cut through the current lineage. Every retained
source is covered exactly once by a frontier source or a reachable summary descendant.

The tree policy is `lcm-tree-v2`. This policy and derived schema intentionally invalidate the incorrect prerelease
cache; the sidecar is discarded and rebuilt without modifying the Kilo transcript.

Soft maintenance summarizes at most one eligible raw window per quantum. Leaf windows target 30% of usable input and
never exceed 20,000 estimated tokens. Existing roots remain stable. When more than eight roots exist, the oldest four
adjacent roots may be promoted as one complete group. Projection always uses the stable active roots; it never expands
children opportunistically to spend spare context.

Hard and manual maintenance summarize all eligible raw windows, then repeatedly promote bounded adjacent active
summary groups until the full LCM-owned frontier reaches
`floor(usable_input_tokens * soft_threshold_ratio)` when feasible. Each accepted promotion must strictly reduce token
count. Model generation is attempted in normal and aggressive modes, followed by a deterministic handle-preserving
fallback. This strict reduction rule makes reducible history converge.

Summary candidates must be non-empty, smaller than their children, within 115% of target, and contain no invented
`src_` or `sum_` handle. Rejected/failed attempts retain usage and error provenance. Summary calls have no tools, do
not recurse through LCM, and write no transcript message.

The exact recent tail defaults to 15% of usable input, clamped to 2,000–20,000 tokens. It and all unconsumed current
sources are protected. Only consumed sources older than that tail are eligible.

Projection replaces the eligible historical model-message range with one inert `<conversation-memory>` message
containing the active frontier's stable summaries and any not-yet-summarized eligible sources. The runtime derives the
first protected persisted message, independently converts that transformed suffix, and uses the cut only when it
matches the exact suffix of the finalized provider messages. The protected suffix is then copied by identity,
unchanged. If that boundary cannot be verified, LCM leaves the request unchanged below the hard limit and fails closed
at the hard limit. A projection is accepted only when it reduces the measured request, fits usable input, and belongs
to the exact current lineage.

Frontier reasons exposed to diagnostics are `soft_leaf`, `hard_level`, and `manual`; `append` is an internal exact
roll-forward revision. `lcm_describe.active` means reachable anywhere in the active tree. Its separate `frontier`
field means directly present in the current cut.
