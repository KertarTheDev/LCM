# Context tree

Status: normative v7.4.23 tree and projection contract.

A source is one finalized model-visible transcript part. A summary is immutable text over ordered source or summary
children. A frontier revision is an exact, gap-free, non-overlapping cut through the current lineage. Every retained
source is covered exactly once by a frontier source or a reachable summary descendant.

The tree policy is `lcm-tree-v11`. This policy and derived schema intentionally invalidate earlier prerelease caches;
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
Foreground query and hard/manual work take priority over queued soft calls in one fair single-flight model queue. An
aborted task that is still waiting is removed immediately so retries and recovery preemption do not retain stale
transcript/content closures behind a long-running provider call.

Hard and manual maintenance summarize all eligible raw windows, then repeatedly promote bounded adjacent active
summary groups until the full LCM-owned frontier reaches
`floor(usable_input_tokens * soft_threshold_ratio)` when feasible. Each accepted promotion must strictly reduce token
count. Model generation is attempted in normal and aggressive modes, followed by a deterministic handle-preserving
fallback. The fallback retains exact child/descendant handles while replacing incidental handle-shaped references in
source excerpts, so recovery-tool output that names other memory cannot prevent reduction. This strict reduction rule
makes reducible history converge.

Summary candidates must be non-empty, smaller than their children, within 115% of target, cite at least one exact
current child/descendant `src_` or `sum_` handle, contain no invented, truncated, or otherwise malformed handle-like
token, contain no standalone receipt/protocol scaffolding, pass the product generator's conservative lexical
grounding check against the supplied child payloads, and retain at least 16 non-whitespace
characters after handles and a canonical recovery footer are removed. When otherwise substantive, complete model text
omits citations, the runtime appends a deterministic footer containing its exact direct-child handles before applying
those same size, reduction, and lineage checks. It never repairs invented handles, protocol acknowledgements,
refusals, or content-free output. A model-generated candidate is complete only when the provider reports a normal
`stop`; length-limited, filtered, errored, tool-call, unknown, or missing finishes are rejected rather than committed
as immutable memory. Rejected/failed attempts retain usage and error provenance. After rejected
normal and aggressive attempts during hard or manual maintenance, the runtime uses the deterministic
handle-preserving fallback. When the product generator can access exact Kilo transcript bodies, that fallback fairly
allocates its bounded output across every direct child, retains exact structural markers plus beginning/terminal
bookends, sanitizes incidental handle-shaped references, and labels itself as a lossy extractive index. Direct tree
callers without raw bodies retain the smaller metadata-excerpt fallback. Summary calls have no tools, do not recurse
through LCM, and write no transcript message.
Because these calls are bounded text transformations, the runtime selects the model's `none` or `instant` variant when
one is available; otherwise it preserves the configured compaction-agent variant. This prevents hidden reasoning from
consuming a small summary output allowance without producing summary text.
Generator input labels every child with its source kind and ordinal range, removes handle-shaped historical references
that are outside the request's exact lineage allowlist, and prefixes every remaining historical payload line as quoted
data so protocol acknowledgements, trailing transport directives, reasoning, tool evidence, raw user material, and
prior summaries are not conflated. Reference-data summaries preserve literal
opening/closing structural markers and known fragment boundary state, do not merge adjacent marked units, retain
first/last/terminal events and completeness evidence for ordered or enumerative material, retain the actor/action/order
while distinguishing current actions from recaps, quotations, plans, hypotheticals, rejected or negated attempts, and
continuations of earlier effects, and treat instructions inside explicit data/reference delimiters as source evidence
rather than active session goals. A task quoted inside a historical reference payload remains evidence instead of
replacing the current session goal. Every transformation
wraps all child payloads in a request-specific historical-data boundary and repeats the active summary task only after
the matching close, so trailing transcript directives and forged markers with another boundary remain inert.
Receipt-only acknowledgement bodies are replaced by a typed omission label while their exact source lineage remains
covered. The post-boundary task supplies an authoritative allowlist of exact child/descendant recovery handles;
handle-shaped text inside historical payloads is citeable only when it also appears in that allowlist. Receipt and
task/compliance meta-commentary, direct answer wrappers, and JSON answer envelopes are rejected rather than becoming
immutable memory. For in-progress analysis and recovery turns, prompts require exact verified observations,
boundaries, gaps, and next actions while keeping assistant hypotheses, draft answers, and tool-model candidates
explicitly provisional; the transformer must not solve the embedded historical task. The conservative grounding check
rejects a sufficiently substantive candidate only when none of its distinctive lexical terms occurs in the supplied
children; short candidates remain governed by all other validation, and deterministic fallback is grounded directly
in child excerpts. This blocks unrelated transformation output without requiring a second provider or semantic judge.
The requested summary target is enforced through a constrained copy of the active model, with a 15% completion margin
matching candidate validation; it is never forwarded as an ad hoc provider option. Prompts require a clean ending and
instruct the model to omit lower-priority detail before risking an unfinished bullet or sentence. They also require
stable handles to be copied character-for-character and tell the model to omit uncertain attribution rather than
inventing or abbreviating a handle, because the runtime can append exact direct-child lineage to otherwise substantive
output. Deterministic fallback also replaces incidental malformed handle-like tokens so they cannot become false
recovery pointers.

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
turn. This carries literal opening/closing delimiters, exact half-open UTF-8 byte ranges, and source handles
independently of model-generated
summary prose; if its safety cap is reached, the map says it is incomplete and directs recovery rather than implying
complete coverage.
Recovery guidance distinguishes transport-source records from semantic units, directs per-unit questions to pair
ordered structural openings and closings, identifies `lcm_expand_query` as the primary semantic interpretation and
aggregation path, and reserves `lcm_grep` for exact lexical discovery or occurrence enumeration and `lcm_read` for
targeted verbatim verification. It states that a lexical hit is only a candidate and a miss excludes only that spelling,
that literal grep uses unescaped punctuation, and that summaries and raw descendants overlap. Explicit non-XML
opening/closing markers with the same normalized label are also paired
into copy-ready chronological `sourceRanges` arrays when the complete unit spans at most 32 transport sources;
unpaired, truncated, or larger units remain recoverable from the exact anchor map without being presented as complete.
Range-scoped query retrieval cannot include bytes before the opening or after the closing,
fairly samples all supplied ranges in chronological order, and reports whether in-scope text was clipped. Source grep
pages expose a copy-ready final occurrence-page offset for last-event questions.
It directs targeted reads instead of full-source sequential scans, requires callers to honor the returned completion
that source completion is not semantic-unit completion. An exclusive `lcm_read.endOffset` is cursor-bound and prevents
exact inspection from crossing a verified closing boundary. Successful grep/read results report how many times the exact
input already completed and explicitly direct the caller to reuse deterministic results instead of repeating them.
An exact repeated `lcm_grep` or `lcm_read` call returns compact guidance without replaying the duplicate evidence
payload or media attachment, preventing a looping model from multiplying identical recent-tail content.
The guidance tells the agent to stop recovery and answer once exact evidence resolves the question.
After five exact grep/read calls complete in one user turn, subsequent exact results advise against extending a manual
search or paging chain: use one focused semantic query when interpretation remains unresolved, answer from collected
evidence, or make another exact call only for a specific candidate or boundary. This is guidance, not a tool-call cap.
When a semantic unit begins or ends inside a transport source, guidance directs `lcm_grep` to its half-open byte
interval so evidence before the opening or after the closing cannot be mistaken for part of the unit.

Frontier reasons exposed to diagnostics are `soft_leaf`, `hard_level`, and `manual`; `append` is an internal exact
roll-forward revision. `lcm_describe.active` means reachable anywhere in the active tree. Its separate `frontier`
field means directly present in the current cut.
