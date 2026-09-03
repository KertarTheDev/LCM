# Context tree

Status: normative v7.5.9 tree and projection contract.

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
Parent recovery guidance directs one focused `lcm_query`, requires the question to state semantic scope and any exact,
exhaustive, first/last, count, or complete-list requirement, and prohibits copying candidate answers, evidence, or raw
history into the argument. The hidden child distinguishes transport records
from semantic units, pairs structural openings and closings, uses `lcm_expand_query` for interpretation and aggregation,
`lcm_grep` for lexical discovery or exact occurrence enumeration, and `lcm_read` only for decisive verbatim
verification. A lexical hit remains a candidate and a miss excludes only that spelling; summaries and raw descendants
remain overlapping evidence. Every hidden primitive preserves raw source-kind provenance so the child can distinguish
user text, assistant text, reasoning, and tool results while interpreting otherwise similar excerpts.

Explicit non-XML opening/closing markers with the same normalized label are paired into bounded chronological units
when the complete unit spans at most 32 transport sources. Range-scoped internal query and grep cannot cross those
half-open bounds. Repeated deterministic internal grep/read calls suppress duplicate payloads, and parallel primitive
calls share synchronous reservations keyed to the trusted hidden child session rather than transient message-array
identity or provider-supplied tool-call IDs. Every optional host execution consumes one reservation. Before the first
child provider step, the host binds the exact focused question to one bounded semantic evidence pass and copies that
inert evidence only into the hidden transcript, so a recovery-model rewrite cannot drift the initial retrieval scope.
The selector may also use at most 2,048 characters of the current non-synthetic user request to rank candidate records
for disambiguation, but only the exact focused question controls passage placement inside those records and remains the
child's sole assignment. Initial evidence may use one third of usable child input up to 32,000 tokens; later optional
query results keep their separate 16,000-token cap so both fit in the hidden context. The isolated prefetch admits the
active frontier before overlapping lexical descendants can consume its bounded candidate allowance, then fairly
balances passage depth between frontier items and relevant raw descendants instead of spending the envelope on a
frontier the parent already sees. Its candidate cap scales from eight to 32 with the private evidence budget, so a
broad query can retain every frontier item when the bound permits while smaller contexts remain compact. Explicit
handles remain highest priority and fair chronological fill covers unused candidate slots. Any omitted in-scope memory
record makes truncation explicit even when the smaller relevance-ranked subset fits the cap. Long records use up to 64
bounded relevance and chronology windows, and merged windows expand into their reserved unused surrounding bytes so
the selector does not silently waste evidence capacity. The inert-evidence serializer reserves handle-label and
separator bytes before reusing that same allocation. During the configured evidence-acquisition provider steps, the
child either submits `StructuredOutput` when the prefetched evidence is complete or uses only the configured primitive
calls needed for unresolved evidence. Independent known scopes may run in one parallel batch, but a primitive and
`StructuredOutput` cannot be combined. A clipped multi-unit structural envelope is decomposed into one exact scoped
query per represented unit, preserving unit order; first/last questions reserve the requested edge or both edges in
bounded excerpts. When research ends after a primitive call, the host starts a separately timed tool-free synthesis
prompt in the same hidden transcript, with every recovery primitive disabled and `StructuredOutput` required. The same
hidden child that inspected the evidence therefore reconciles the full initial selection and completed results
directly into the bounded answer. A fairly bounded cumulative candidate ledger is placed immediately beside that
synthesis instruction, while the complete transcript remains available for provenance and conflicts. A direct
full-coverage draft that consumed clipped primitive evidence is reviewed through this path without seeding its
unsupported draft into the ledger. Unscoped, summary-scoped, and complete single-unit exact `lcm_expand_query` calls may
atomically reserve from the configured private logical-inference budget over only the focused question and selected
excerpts; clipped exact scopes return deterministic evidence. This makes hard aggregation use clean bounded contexts
without exposing another inference surface to the parent or exceeding the atomic child budget. The host reads the
newest persisted terminal structured answer even when the prompt call returned the preceding tool-transition message,
rejects an overlong answer for isolated rewriting, bounds gap strings, supplies a missing partial gap, and drops
invalid optional citations without rejecting the remaining answer. No ordinary second model therefore has to
reinterpret a lossy prose handoff.
With defaults this keeps the two-step common transcript path while preserving every research message and primitive
output outside the parent context. Evidence acquisition defaults to one provider step and 540 seconds. Primary
same-transcript synthesis and repair share an independent 600-second finalization phase. Only when that structured
submission is absent or invalid does the host start a fresh locked hidden repair-finalizer session. Independently of
any model-authored research text, the host retains a 32,768-character
digest from the initial selector and captures each completed primitive output. It fairly combines those artifacts into
an at-most 65,536-character cumulative repair ledger. The repair session receives only the focused question and that
ledger, never the research child's earlier model chatter or raw tool transcript. It gets the configured number of
repair attempts. Those attempts use structured output except that the last of two or more has no generated tool and
may return only a bounded natural-language answer, which the host marks partial and uncited. The finalizer cannot
restore a primitive. The defaults retain the four-step complete-recovery bound and a 20-minute wall: 540 seconds for
evidence acquisition, an independent 600 seconds shared by primary synthesis and repair, and 60 seconds reserved for
cleanup. `conversation_memory.recovery.*` may change those resource budgets without changing isolation. Cancellation
covers every started hidden session and their combined cost is propagated to the parent. Active work is interrupted
before the configured cleanup reserve; slower provider teardown remains detached for cleanup/accounting only and
cannot produce a late answer. Returned recovery-call observability is capped by the atomic session ledger even if a
provider/tool-state transition loses the suppression marker on an over-budget attempt. These are host-enforced
child-worker limits, not advice to the parent. The ordinary upstream last-step reminder is not injected into either
locked hidden phase because it would contradict the research tool call or structured answer; the next step is still
stopped by the host bound. Returned isolation metadata distinguishes research, finalizer, and complete child expiry
while retaining the legacy aggregate deadline signal.

The child returns only a direct answer of at most 1,024 characters, coverage, unresolved gaps, and optional exact
citation ranges. The requested value, entity, or list comes first rather than being buried in a research report. The
host accepts at most six prior-turn raw-source citations of at most 512 bytes each, reloads the current lineage, and
copies only validated exact bytes. An invalid optional citation is omitted and downgrades full coverage to partial; it
never enters the parent context. A tool-free plain correction is always partial and uncited. No internal search result,
read page, reasoning, or nested semantic-query output enters the parent context. A full result tells the parent to answer
immediately; a partial result permits a narrower `lcm_query` only when its named gap blocks the user answer. The host
instructs the parent to combine bounded recovery with its projected active context; recovery supplements rather than
replaces independently supported visible facts, including when a partial or empty child answer omits them. The host
enforces the configured actual-child allowance per parent user turn, defaulting to two, including synchronous
reservation across parallel calls. After that many started calls, the next parent provider step is answer-directed
with `toolChoice: none`; ordinary tools are removed, but `lcm_query` remains executable as a one-step settlement
fallback for providers that ignore the choice and emit a
stale call from the prior schema. Such a call returns the no-child exhaustion sentinel with answer-now guidance instead
of an unavailable-tool error, never creates another child, and is followed by one genuinely tool-free answer step.
Providers that honor the choice answer immediately without that sentinel step. Structured output also retains its
required final-output tool. A repeated normalized question returns the same sentinel without spending the
narrower-follow-up slot and says not to substitute cross-session recall. The host ends the completed answer step, so
the settlement fallback itself runs at most once even if its arguments are malformed; neither path can loop or reset
the allowance through an external continuation. Invalid provider arguments do not spend an
actual-child slot. Hidden research and repair-finalizer sessions and the active parent session are excluded from upstream recall
search and direct reads while LCM is enabled, so only the bounded host-validated result crosses back to the parent.
Disabled mode retains upstream active-session recall.

Frontier reasons exposed to diagnostics are `soft_leaf`, `hard_level`, and `manual`; `append` is an internal exact
roll-forward revision. `lcm_describe.active` means reachable anywhere in the active tree. Its separate `frontier`
field means directly present in the current cut.
