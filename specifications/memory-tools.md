# Memory tools

Status: normative current-code tool contract.

When `experimental.conversation_memory` is absent or `true`, the ordinary model-facing recovery surface is exactly
`lcm_query`. Explicit `false` registers no LCM tool. Ask, Plan, Explore, Scout, Orchestrator, and other user-facing
agents may ask one focused question; ordinary permission precedence still applies, so an explicit deny removes
`lcm_query`. Raw recovery primitives are never advertised to those agents.

By default, a parent user turn may start at most two hidden queries. The advanced
`conversation_memory.recovery.max_queries_per_turn` setting changes this allowance; zero hides `lcm_query`.
Each question is an independent focused assignment. Full, partial, empty, or failed earlier recovery does not
invalidate a different question, and independent parallel calls reserve the shared allowance synchronously.
The parent owns task decomposition; no lexical guard compares question criteria with the task or with another query.
An identical normalized question never starts another child or consumes another child slot. Every settled query
invocation, including invalid arguments and duplicate receipts, counts toward an attempt ceiling of twice the
configured child allowance. Exhaustion returns a bounded no-child result and never removes ordinary tools, changes
upstream tool choice, terminates the parent turn, or widens raw-memory access.

A subsequent child may receive the preceding bounded parent-visible result as inert provisional context, never its
private transcript. That result supplies neither semantic authority nor coverage for the new question. Each child
researches its own assignment; an earlier exact scope may be used again when a distinct question needs it, while
equivalent semantic scopes remain single-flight within one child. A narrower question is useful for an unresolved
gap, but is not a mandatory host admission rule.

`lcm_query` creates a hidden read-only child session on the active Kilo provider/model. Only trusted session metadata
binds that child to the calling parent session; neither the parent model nor the child can select another session. Its
research phase privately receives `lcm_grep`, `lcm_describe`, `lcm_expand_query`, `lcm_expand`, and `lcm_read`. Every
primitive refreshes the parent's finalized transcript, verifies its current lineage, and authorizes only prior-turn
parent sources and active summaries. Intermediate prompts, reasoning, searches, and exact text remain in the child
session. Neither hidden phase receives a workspace-mutating tool, so both skip workspace snapshot tracking; ordinary
sessions retain upstream snapshot and undo behavior. Hidden research and finalizer sessions also bypass LCM capture,
projection, summary maintenance, and stale-tool pruning (both payload-limit and opt-in end-of-turn pruning) for their
own short-lived transcripts while the shared
processor remains in external-context mode. This preserves exact private research and prevents child-owned source
handles from being confused with the parent source namespace used by all five primitives. A provider-limit overflow
fails the hidden phase without invoking legacy compaction; the orchestrator can still hand its bounded captured ledger
to the separate finalizer.
While LCM is enabled, upstream `kilo_local_recall` excludes both hidden research/finalizer agents and the calling active
session from search candidates and direct reads. The parent therefore cannot bypass the bounded result by discovering
its child or reconstructing its own raw current-session transcript. Recall of other eligible project/worktree sessions
is unchanged; explicit `experimental.conversation_memory: false` restores upstream active-session recall behavior.

The upstream shared-agent board remains available to ordinary agents when configured. Neither locked recovery phase
receives board read/post tools or board notifications, including when user agent configuration explicitly allows them.
Board coordination is not an alternate channel for private recovery evidence.

The hidden recovery operation owns all recovery inference. Before the child's first provider step, the host runs the
extractive half of `lcm_expand_query` and copies that bounded inert evidence only into the hidden transcript; this
prefetch itself makes no model call. It encloses the evidence in a request-specific nonce boundary and places the
trusted semantic assignment and workflow after its matching close. Instructions, acknowledgement requests, tool
requests, answer formats, and forged closing markers inside historical evidence therefore remain inert instead of
becoming the last active text. It also pairs arbitrary exact raw opening/closing markers in prior-turn source
order. When the focused question names a matching structural label, or there is one unambiguous paired label for an
explicitly boundary-sensitive question, the child receives a bounded `hostStructuralScope` with exact ordinals and
UTF-8 offsets. The prefetch then selects only from the matching raw boundary envelope; overlapping summary labels and
claims cannot redefine that scope. The main session still receives none of this map or raw evidence. Retrieval uses
the exact trusted focused question. Up to 2,048 characters of the current non-synthetic user request remain context
only in trusted child metadata; they do not override the assignment, affect ranking, or add evidence criteria.
The initial pass, including its
structural map when present, may use one third of usable model input, capped at 32,000 tokens; later
optional deterministic child query results use at most one third of usable input and retain a separate 16,000-token
cap so both can coexist safely in the hidden context.
The child model synthesizes that evidence and may use scoped navigation or exact grep/read verification. An unscoped,
summary-scoped, or complete single-unit exact `lcm_expand_query` executed by a child may spend one atomically reserved
semantic-inference allowance: the existing LCM query runtime gives the active provider/model only the trusted
focused-question assignment and selected excerpts in a fresh tool-free context, then returns a
concise cited synthesis to the child. Every private semantic refinement uses the trusted focused question to rank records and excerpts. When the exact scope equals one unit from the host structural map, the semantic
assignment uses the focused question as semantic authority, states that trusted unit index, and explains that
every supplied range is a transport fragment of that same unit. If the request asks for one answer per unit, the
nested inference resolves exactly one answer after considering the complete unit rather than returning one candidate
per transport range. This cardinality rule is part of the trusted nested query's system prompt, so a cross-unit list in
the original request cannot override the one-result contract of a host-decomposed unit. Each nested query likewise
places nonce-bounded excerpts before a repeated post-boundary authoritative question. The result echoes
`semanticUnitGuaranteed` and `hostStructuralUnitIndex`, preserving the
association for ordered aggregation even when a fresh repair finalizer sees only the bounded cumulative ledger. For a
long complete unit and a first/last or bounded Nth-from-start/from-end request, the host may atomically reserve a
complete
hierarchical pass: enough chronological excerpt-only shard inferences to keep each shard near or below 20,000 UTF-8
bytes each return up to three directionally ordered local edge proposals, or up to N ordered local events for a
bounded ordinal, as structured
`value`/`citation`/exact-`quote` records, one excerpt-only reduction inference selects the requested unit value and
returns the ordered prefix or suffix used to reach it, and one blind final audit independently reconstructs that same
bounded sequence while re-reading the complete exact unit without receiving the bounded map or tentative reduction.
Complete raw shards remain inside nested nonce boundaries and never enter the child transcript. The reducer normally
sees result JSON whose schema, citations, exact quotes, and byte positions are host-validated but whose semantic
qualification remains explicitly untrusted; it must reapply every subject, action, scope, and event-status criterion
and cannot let a later rejected proposal suppress an earlier qualifying one. When a shard has no valid structured result, it also receives that one
host-bounded exact raw shard as private fallback evidence, while the auditor sees only the exact unit and authoritative
question. Before reduction, LCM may claim one spare semantic call to retry each malformed primary shard at its original
bounded size, prioritizing these absent proposal sets before optional semantic subdivision. It may then atomically claim
remaining configured allowance to replace the earliest ordinal-relevant primary shard whose local coverage remains
uncertain—an unconfirmed `none` or a partial positive that can still have omitted qualifying events—with two exact
chronological repair segments. Shards
encountered from the requested edge through the provisional Nth event are eligible; when no earlier uncertainty exists,
the first uncertain shard beyond that target is one bounded sentinel against false-positive event proposals. Two
semantic slots remain available for a possible reducer/auditor repair. The selected primary response is not supplied
to either independent segment because it conveys no completeness evidence. Each segment is inferred independently
under the unchanged original criteria, and their exact byte ranges reassemble to the primary shard. Repair segments
replace the primary only as the non-overlapping reduction topology. Every host-validated primary event remains
additive and is merged into the exact segment containing its source position; overlapping normalized duplicates are
collapsed without collapsing distinct repeated events. An invalid repair segment can carry that retained structured
event together with its own smaller exact fallback, while the original primary and repair proposals remain separately
available for bounded private reconciliation at their already verified shard-local byte positions; a repeated phrase
elsewhere in the source cannot invalidate that position by forcing a second global quote lookup. No recursive
subdivision or unreserved provider call is allowed. A failed shard remains failed for coverage when it cannot be fully
repaired, even when its fallback yields a valid candidate. The host locates
every proposed quote in the exact source ranges, orders the records by verified byte position, and derives each pass's
Nth value from that order instead of trusting a model-written scalar or comma-separated list. Only the bounded audited
result and optional
host-verified candidate neighborhoods reach the
child. The host certifies full hierarchical coverage only when every shard completed and the host-ordered shard
aggregate plus the full-coverage reducer and auditor independently agree on their host-selected normalized answer with
shared source provenance; disagreement from any of those three views remains partial and
all bounded `independentCandidates` remain visible to the hidden child for reconciliation instead of silently
preferring either pass. When valid reducer and auditor answers do not normalize to the same value, the partial
top-level answer is the deterministic host-ordered shard aggregate when one exists; every distinct shard, reducer, and
auditor proposal remains visible in bounded `independentCandidates`. This does not certify a failed shard or full
coverage. That one shard-plus-reducer-plus-auditor reservation is the complete base charge for the
hierarchy; the host does not preclaim an additional single-pass inference before reserving it. After both base passes
finish, an
invalid reducer or auditor may receive exactly one bounded repair when the remaining configured semantic allowance can
fund every invalid pass atomically. If both are invalid and two slots are unavailable, neither is retried. A repair
receives the same exact evidence and authoritative question plus only the host validation category; the rejected model
text is not supplied and conveys no evidence. Every repair is separately metered, cannot recurse, and must pass the
same event, citation, exact-quote, ordinal, and coverage validation. Host-verified evidence from either attempt remains
available for partial reconciliation, but a repair does not make an incomplete base hierarchy complete unless its
validated replacement satisfies the ordinary reducer/auditor agreement rule.
The nested prompts require one scalar event value, exact actor/entity attribution, and a quote from the qualifying
event rather than a nearby mention. A nonconforming multi-value answer can remain only a provisional disagreement
candidate. Each private semantic pass may propose at most 12 cited exact raw substrings of at most 256 UTF-8 bytes for
internal validation and reduction.
The shard, reducer, and auditor prompts end with the same explicit mode-specific JSON schema. The host repeats that
schema after the inert evidence boundary and authoritative question so a large exact scope cannot separate it from
the response point. Its `events` array is required even when empty and is not replaced by the generic optional
`evidence` field. This final schema follows all general query rules so those rules cannot accidentally instruct a
provider to finish before writing the event map.
Positive hierarchical output without a valid event map remains incomplete rather than weakening host-side ordering.
LCM nevertheless retains exact quotes that pass host verification from an incomplete reducer or auditor as partial
private reconciliation evidence. The deterministic host-ordered shard aggregate and every distinct valid reducer or
blind-audit candidate remain visible as bounded disagreement candidates instead of silently preferring a semantic pass
or discarding the shard evidence. On disagreement, that aggregate is also the partial top-level candidate when
available. Neither path can certify full coverage.
The host resolves a quote only when it occurs exactly once in the cited selected raw range, derives an exact
UTF-8-safe source interval of at most 512 bytes around it, and discards ambiguous, invented, oversized,
summary-derived, or out-of-scope entries. Successful shard evidence reaches the reducer only after that validation;
failed-shard fallback quotes must pass the same validation before they can leave the reducer. A final
generated result exposes at most three of these small `candidateEvidence` neighborhoods to the recovery child so it
can inspect event status without guessing a lexical search term or paging the source. For directional work, verified
shard, reducer, and auditor proposals are combined with every pass's separately host-verified scalar-answer evidence,
deduplicated, and globally selected from the requested edge before applying that bound. Scalar evidence remains only a
candidate and cannot override the required event map or certify coverage, but a malformed or internally inconsistent
event map cannot erase the pass's exact supporting bytes from private reconciliation. Overlapping candidate
neighborhoods are coalesced only when one exact UTF-8-safe interval of at most 512 bytes can retain every underlying
quote. The merged neighborhood keeps the original ordered proposal positions for boundary selection; disjoint or
too-wide evidence remains separate. A complete pass, or an incomplete pass without a known successor, retains an
ordinal beyond the first three with its two immediate predecessors from that edge instead of returning only unrelated
opening candidates.
When hierarchical coverage is incomplete and an immediate successor exists, the three-item window instead brackets
the uncertain ordinal boundary with the predecessor, nominal target, and successor. Each exposed neighborhood carries
a copy-ready `boundaryScope` with every remaining raw range beyond it toward the requested edge in the exact semantic
unit. It also carries an `inwardScope` containing the exact gap from that candidate to the next child-visible candidate
inward, or to the opposite unit edge when no next candidate is visible. The child uses the boundary scope to exclude a
missed edge event and the inward scope when the candidate itself is rejected or ambiguous, copying all ranges from at
most one applicable scope into one grep or materially narrower semantic query. This keeps a semantically false proposal
from hiding an omitted replacement without treating one transport source as the unit boundary. Both scopes remain
inside the hidden transcript unless the child selects a decisive interval for its already bounded final citation list.
Hierarchy is used only when the configured per-child semantic budget can reserve the actual
shard-plus-reducer-plus-auditor cost fairly for every matched unit. The default allowance of one therefore retains the
single-pass path. A clipped exact scope not proven to be one complete host structural unit returns deterministic
bounded evidence instead; a complete host-verified unit may use all exact ranges even when its preliminary evidence
view is clipped. The allowance is configurable and applies atomically
across parallel calls. This avoids a mandatory provider round trip for easy questions, lets complete independent
units be interpreted without first combining a clipped multi-unit envelope, and keeps incomplete exact evidence in
the evidence-bearing child for final synthesis.

The public child operation has separately configurable research, finalization, and cleanup wall-clock limits, with
defaults of 540, 600, and 60 seconds. The complete limit is their sum; active work is interrupted before the cleanup
reserve. If provider teardown is still running at that boundary, its already-interrupted detached fiber may finish only
cleanup and accounting; it cannot resume model work or supply a late result to the parent. Expiry returns a normal
bounded `none` result naming the deadline as unresolved; it does not leave the parent tool pending until the outer
request is aborted. The host-prefetched semantic evidence base is bound to the focused question
stored in trusted child metadata. A child `lcm_expand_query` is optional: the host replaces any recovery-model rewrite
for deterministic selection with the trusted focus and gives a private semantic inference the trusted combined
assignment. When `hostStructuralScope.exactEnvelope` is present, a boundary-sensitive refinement
uses its exact scope; an unscoped semantic query cannot replace it. If a clipped scope contains several matched units,
the child queries each represented unit independently through its `contentScope.sourceOrdinalSpan`, preferably in one
parallel batch. It preserves unit index and order and never submits the clipped combined envelope as one semantic
query. When an exact envelope contains one matched unit, the host recognizes the copied marker-inclusive ranges as
that same trusted unit and canonicalizes private semantic inference to its marker-interior `contentScope`; copying the
host-authored envelope cannot accidentally lose the unit association. A complete host-matched single-unit scope uses
trusted structural narrowing for a private semantic inference; the child-controlled query text cannot change either
the focused question's semantic criteria or the unit association. A clipped unit that lacks that host completeness proof returns
deterministic evidence. Every non-empty exact structural unit whose initial evidence was clipped starts
with an incomplete host coverage status until a scoped `lcm_expand_query` result covers it; lexical grep/read calls can
locate candidates but cannot clear that status or certify a full boundary claim. Marker-only boundary records that
contribute no bytes inside a unit are omitted
from its `contentScope`; a wholly empty unit reports a null content scope and requires no semantic call.
When a focused question directly qualifies a repeated opening marker as the first, second through tenth, numeric
ordinal, or last marked unit, the host selects only that exact paired raw unit. Aggregate wording such as each, every,
or all retains every matching unit. Without a matched structural scope, a use may remain unscoped when broad
aggregation needs a fresh private semantic inference. Initial unscoped selection admits the active frontier before
adding overlapping lexical descendants, with a candidate cap that scales from eight to 32 as the private evidence
budget grows. It then balances bounded passage depth between frontier items and relevant raw descendants, because the
hidden child is recovering details that may be absent from the already-visible frontier.
Explicit handles retain highest priority and chronological fill uses remaining candidate slots. Truncation reports any
omitted in-scope memory record, not only omission from the smaller relevance-ranked subset. Evidence serialization
reserves its labels and separators and keeps the selector's allocation. The evidence-bearing child defaults to one
evidence-acquisition provider step and at most two completed primitive calls.
`conversation_memory.recovery.max_research_steps` and `conversation_memory.recovery.max_tool_calls` configure those
lifetime budgets, while `conversation_memory.recovery.max_semantic_inferences` configures the nested semantic
allowance. The child submits the bounded structured answer directly when the prefetched evidence is complete, or
issues independent known scopes in one parallel batch; otherwise it uses only the calls needed for unresolved units or
the most decisive refinement, navigation, grep, or read. A primitive and `StructuredOutput` must not be combined in
one batch. On later configured research steps it may consume completed results and either finish or resolve remaining
units. Two consecutive schema-invalid private primitive calls end evidence acquisition early; malformed JSON is not
semantically repaired, and the existing exact hidden transcript proceeds directly to bounded tool-free synthesis.
Operational failures and a later valid primitive reset this circuit breaker, so it is not a substitute for the
configurable provider-step, primitive-call, semantic, or time budgets. When research ends after a primitive call, the
host starts a separately timed tool-free synthesis prompt in the
same hidden transcript. It requires `StructuredOutput`, so the child that actually inspected the evidence also
produces the bounded answer from the complete initial and recovered evidence instead of ending on uninterpreted tool
output. The request places the fairly bounded cumulative candidate ledger next to the synthesis instruction while the
complete hidden transcript remains available for provenance and conflict resolution. Every completed primitive section
is labeled with its tool and, when present, its host-tracked exact structural-unit index before fair excerpting, so a
bounded finalizer cannot shift one unit's recovered value into another unit merely because the serialized result body
was clipped. If the evidence-bearing child
already submitted a valid bounded answer, the host preserves that answer instead of asking another model step to
recreate it. Incomplete, conflicting, clipped, or skipped structural evidence deterministically downgrades a claimed
full result to partial coverage and adds the host-tracked gaps. When the authoritative request requires a complete
first/last, bounded ordinal, count, exhaustive list, or per-item answer, that partial result does not expose its
polished candidate as an answer: the parent receives an empty answer, `candidateAnswerWithheld: true`, the named gaps,
and any independently bounded citations. Ordinary non-exhaustive partial fact recovery continues to return its
supported answer. A recoverable
`StructuredOutput` failure, including output-length exhaustion before submission, still enters
this same-transcript synthesis phase; only a non-recoverable assistant/provider error bypasses it. Parallel siblings
reserve the shared primitive and semantic budgets synchronously.

The host validates the newest terminal structured submission persisted in the research child, including when the
prompt call returned an earlier tool-transition message. It rejects an overlong answer for isolated rewriting, bounds
gap strings, supplies a generic gap when partial coverage omitted one, and drops malformed, oversized, or excess
optional citations before exact lineage validation instead of discarding an otherwise usable answer. It then copies
only the bounded answer fields. The trusted child assignment carries the focused question as semantic authority
and the surrounding task as context only. A valid terminal structured answer is therefore
accepted even when the two natural-language strings differ or its claimed coverage exceeds host-tracked evidence; the
host does not discard the evidence-bearing child's synthesis and ask a lossy reviewer to recreate it. A fresh sibling handles an absent or unusable
evidence-bearing submission. No LCM recovery primitive or ordinary
tool is available there. Its initial step receives only Kilo's structured-output finalizer, the bounded original
request as context only, the authoritative focused question, and a cumulative ledger of at most 65,536 characters. A matched host
structural scope remains in the bounded initial digest, while the research child's raw tool transcript is deliberately
absent and only bounded host-captured outputs and any recoverable synthesis enter the ledger. If that
repair submission is unusable, configured repair attempts continue from that same cumulative ledger. Every attempt
uses structured output except the last of two or more attempts, which has no generated tool and may return only a
bounded natural-language answer; the host marks it `partial`, attaches no citations, and records the fallback in
isolation metadata. A zero repair allowance still accepts a valid direct answer but returns a primary synthesis failure
when no usable evidence-bearing submission exists. The prefetch retains a
smaller candidate digest using the same relevance scoring and fair per-record allocation as the full evidence
envelope. For repair only, the host fairly allocates the
ledger across the at-most 32,768-character digest, every completed primitive output, and any research text so no single
long artifact can consume the handoff. This uses the same conservative four-characters-per-token planning envelope as
the existing 16,000-token maximum for one isolated evidence result while leaving ample room for finalizer instructions
and output. Exhaustive/list/count/order answers still deduplicate overlapping summaries and descendants before
reporting coverage. Primary synthesis and any fallback repair share the configured finalization cutoff instead of
inheriting only the remainder of evidence acquisition. The configured cleanup reserve is part of the complete bound.
The default common path performs at most two provider steps in one locked hidden transcript: one evidence-acquisition
step and one separately timed tool-free synthesis step. Configured unscoped, summary-scoped, or complete single-unit
exact `lcm_expand_query` calls can add bounded logical provider inferences with the ordinary single transient retry.
A configured hierarchical first/last/Nth pass counts every shard, reduction, and full-unit audit inference separately
against that same budget and reports every nested provider call and its token/cache usage. Host-only diagnostics retain
bounded result previews, validation states, citation handles, exact shard byte sizes, reducer status, and auditor
status without copying raw shard text into either the child or parent transcript.
Host-verified `candidateEvidence` is the sole exception to the child-side raw-text rule: at most three exact
512-byte source neighborhoods, prioritized from the requested directional edge when applicable, may accompany one
generated semantic result. Incomplete hierarchical ordinal work uses that same bound to include the immediate
successor when available, bracketing a possibly displaced target rather than hiding it just outside the window.
Metadata and the parent transcript remain bounded as before.
The atomic per-child allowance prevents parallel or repeated semantic primitives from exceeding the configured work.
For every nested inference, the host also canonicalizes the active revision and resolved unscoped, summary, or ordered
exact-range scope with its trusted structural-unit index and requested direction/rank. The first reservation wins
atomically; a sequential or sibling call for that same scope returns a compact suppression receipt, spends no semantic
allowance, does not displace prior unit-coverage state, and is omitted from the bounded finalizer ledger because the
original result remains in the private transcript. A partial, invalid, or incomplete provider response still completes
that semantic scope: recovery must inspect a materially narrower candidate or boundary rather than replaying the same
large inference. A final provider error or cancellation releases only the scope identity so an exact retry may run if
the configured lifetime allowance still has capacity; every already-started inference remains counted.
With defaults, repair can raise the transcript total to at most four steps across two hidden sessions. Cancellation
reaches every started session and their combined provider cost is propagated to the parent. Host-only result metadata
records the combined provider
calls and token/cache usage across both hidden sessions; a private semantic inference contributes its own reported
usage once while its already-propagated cost is not counted twice. Cleanup writes that metadata before a cancelled or
failed tool state is finalized, so already-started hidden work remains measurable. Cleanup phases are failure-contained:
an accounting or metadata-write failure is logged, later cleanup still runs, and it cannot replace an already accepted
bounded answer with `lcm_unavailable`. If neither the prefetch nor optional
research retrieved evidence, the host returns bounded `none` coverage without inviting unsupported synthesis.
Host-suppressed over-budget siblings do not count as completed internal recovery work.
Persisted child messages remain schema-valid after SQLite JSON hydration, including the structured-output format used
by the evidence-bearing child and fallback finalizer. Host lifecycle, cost, and authorized diagnostic reads therefore cannot fail merely because that
schema-class value crossed the storage boundary; this does not expose the child transcript to the parent model.
Isolation metadata distinguishes research, finalizer, and complete-child deadline expiry. The legacy aggregate
`deadlineExceeded` remains true only for finalizer or complete-child expiry, while `deadlinePhase` identifies the
furthest expired phase when more than one cutoff is observed. It also reports the active-work, cleanup, and complete
wall limits used by the host.

The advanced `conversation_memory.recovery` object exposes these operational budgets in `kilo.jsonc`:

- `conversation_memory.recovery.max_queries_per_turn` (default 2, non-negative);
- `conversation_memory.recovery.max_research_steps` (default 1, positive);
- `conversation_memory.recovery.max_tool_calls` (default 2, non-negative);
- `conversation_memory.recovery.max_semantic_inferences` (default 1, non-negative);
- `conversation_memory.recovery.max_repair_attempts` (default 2, non-negative);
- `conversation_memory.recovery.research_timeout_seconds` (default 540, positive);
- `conversation_memory.recovery.finalizer_timeout_seconds` (default 600, positive); and
- `conversation_memory.recovery.cleanup_timeout_seconds` (default 60, positive).

Changing them does not alter trusted parent binding, prior-turn scope, hidden tool permissions, answer length,
citation count/size, or the rule that only the bounded result reaches the parent.

## `lcm_query`

Ask one focused natural-language `question` about earlier current-session memory. The question must contain 1-1,024
characters and should state exactness, completeness, ordering, first/last, count, complete-list, or semantic-boundary
requirements when they are part of the user's requested criteria. Narrowing may reduce the entity, time, document, or
structural scope, but it must preserve the user's verb, qualifiers, inclusion and exclusion rules, event definition,
and evidence standard. In particular, the caller does not add stricter terms such as `explicit` or `exact` unless the
user requested them. The argument contains only the question, never candidate answers, examples, evidence, or copied
raw history. The host repairs only an unambiguous bounded single-string wrapper produced by an OpenAI-compatible
endpoint; truncated JSON, oversized questions, and wider mutations remain invalid and leave the tool available for a
concise retry because no child was started, subject to the bounded parent-attempt ceiling. There is no model-controlled
session selector, raw-output limit, or
provider option; worker budgets come only from trusted user configuration.

The evidence-bearing child's final step should finish through Kilo's ordinary structured-output tool with:

- `answer`: a direct answer of at most 1,024 characters, with the requested value, entity, or list first and no copied
  evidence or research narrative;
- `coverage`: `full`, `partial`, or `none`;
- `citations`: optionally, at most six exact raw-source byte intervals; and
- `unresolved`: at most four short gaps or ambiguities.

A supported `full` or `partial` answer may omit citations when a concise synthesis is sufficient. `none` requires an
empty answer and no citations. `full` requires no unresolved gap; `partial` requires at least one named unresolved gap
so the parent can decide whether the one narrower follow-up is justified. Each requested citation is one `src_` handle
and a half-open UTF-8 interval no larger than 512 bytes. The host reloads the parent's current lineage, rejects
current-turn, stale, missing, out-of-range, non-boundary, oversized, empty, or lexically answer-unrelated intervals,
and copies the exact persisted bytes itself. A citation must share an answer-specific multiword phrase, a distinctive
long answer word, or the sole remaining answer anchor. Repeating only an actor or context word already present in the
focused question is insufficient; numeric/computed answers remain unaffected. Invalid optional citations are omitted.
Their answer remains isolated and is downgraded from `full` to
`partial` with a named validation gap, so a citation defect cannot discard a useful synthesis or copy unvalidated text.
For host-matched exact structural units, the latest `lcm_expand_query` result for each unit is also a hard aggregate
coverage ceiling. If one or more units retain partial, conflicting, or incomplete semantic coverage, a child draft
claiming `full` is reviewed once in the same evidence-bearing transcript and is still host-downgraded to `partial`
with those unit indices named if the review repeats the unsupported claim. A later complete exact-unit semantic result
may supersede the earlier gap; lexical grep misses and partial reads alone cannot do so.
Citation verification proves only that the returned excerpt exactly matches bounded prior-turn source bytes and has a
conservative question-aware lexical anchor to the answer; it does not prove that the excerpt semantically entails a
claim or establishes ordering or completeness. Parent guidance
therefore reconciles cited claims with independently supported active-context facts instead of preferring a claim only
because it has a citation. Source handles and retrieval `sourceRanges` returned by semantic recovery are provenance,
not parent citation intervals. The private tool result, final-step prompt, and structured schema direct the child to
omit citations unless host-verified `candidateEvidence`, `lcm_grep`, or `lcm_read` already established exact offsets
within the 512-byte bound.
An answer that exceeds the 1,024-character contract is invalid rather than clipped: the host keeps it inside the
hidden research handoff and invokes the isolated synthesis/repair path to rewrite all supported candidates within the
bound. This prevents a valuable item near the end of an exact list from being silently removed by transport bounding.
If the structured submission itself is unusable, the single tool-free correction may supply a bounded plain answer;
the host accepts it only as partial and uncited. Empty or errored corrections remain `none`.

The parent receives only the bounded direct answer when safe, coverage, unresolved gaps, host-copied exact excerpts,
the optional host-owned `candidateAnswerWithheld` state, and compact isolation metrics. It never receives the child
transcript or primitive outputs. That bounded result supplements rather
than replaces the parent's projected active context. Parent guidance requires the final answer to retain independently
supported facts already visible there even when a partial or empty recovery result omits them. When evidence conflicts,
it prefers supported claims over unsupported inference without treating byte verification as proof of meaning.
Full coverage answers only the focused question, not necessarily the whole user task. Incomplete completeness-sensitive
candidates remain withheld; ordinary partial facts remain useful with their limits stated. A different question or
narrower gap may use remaining query allowance, including after a full result. Only the preceding bounded
parent-visible result may accompany a later child as optional inert context; no private transcript or primitive
output crosses between children or into the parent. Provider cost
incurred by the child is propagated to the calling parent assistant message.
Parent cancellation cancels the child.
After a process restart, an idle parent session terminalizes any persisted pending or running tool part as interrupted
before accepting the next prompt, so an abruptly stopped `lcm_query` cannot remain pending across later turns.

The remaining sections specify the hidden child-only primitives. They are implementation contracts and are not part
of the ordinary model-facing registry.

## `lcm_grep`

Search exact retained current-session raw source text and summary text. This is lexical discovery: a hit is a candidate,
not proof of the event status or interpretation in the user's question, and a miss excludes only that spelling rather
than paraphrases. Semantic interpretation and aggregation use `lcm_expand_query`. Inputs are `pattern`, optional mode
(`literal` or `regex`), `caseSensitive`, `summaryID`, `sourceID`, ordered `sourceRanges`, inclusive `sourceSpan`,
inclusive `sourceOrdinalSpan`, `startOffset`, `endOffset`, `occurrenceOffset`, `limit`, and opaque `cursor`.
`summaryID`, `sourceID`, `sourceRanges`, `sourceSpan`, and `sourceOrdinalSpan` are mutually exclusive.
Default record limit is 20; maximum is 50. A source scope accepts inclusive `startOffset` and exclusive
`endOffset` UTF-8 byte bounds. They let callers search only inside a structural unit that begins or ends within a
transport source; intervals are cursor-bound and returned character/byte ranges remain relative to the complete
source. An unbounded source scope explicitly reports that it covers one complete transport record, not a guaranteed
semantic unit, and warns against per-unit first/last/count conclusions until structural bounds are applied. Literal
mode treats regex syntax such as `|` as ordinary text; alternatives require regex mode. Literal
punctuation is entered without regex escaping (`[START]`, not `\[START\]`); escaped punctuation returns actionable
advice because the backslashes would otherwise be matched literally. A summary scope searches its cycle-safe descendant
closure; a source scope searches one exact current-lineage source. An ordered range scope accepts 1–32 chronological,
non-overlapping exact source intervals using the same UTF-8 byte contract as `lcm_expand_query`. It lets one exact
search or count cover a complete structurally bounded document, episode, section, or other semantic unit without one
tool call per transport record. Top-level source offsets and occurrence paging remain exclusive to a single `sourceID`.
An inclusive `sourceSpan` provides the same search behavior after resolving every current-lineage source between its
first and last handle, with optional endpoint offsets and the same 32-source bound.
`sourceOrdinalSpan` provides the same behavior for inclusive numeric structural-map ordinals.
Each returned record reports an exact `matchCount`, bounded character
`ranges`, matching UTF-8 `byteRanges`, and local `occurrences` (one compact preview per global record or all 20 retained
ranges for a source-scoped search) without duplicating that preview at the record level. Results also include an exact
occurrence-page offset/total/next offset, `rangesComplete`, `occurrencesComplete`,
and source records identify their `sourceKind`, so a range cap or assistant/tool record is never mistaken for
exhaustive user-source evidence. A range result identifies its effective interval and index. Literal complete-scope
totals include every supplied range even when occurrence excerpts are capped at 20 per range; matched-record totals
deduplicate intervals belonging to the same transport source. The caller can pass a
`byteRange.start` to `lcm_read.offset` to inspect exact source text around any retained match. If a source has more than
20 matches, repeat the source-scoped search with its `occurrencePage.nextOffset`, or copy
`occurrencePage.lastOffset` to jump directly to the final retained page for a last-occurrence question. An
`occurrenceOffset` is a zero-based match index, never a source byte offset; callers omit it on the first call and copy
only a returned page offset thereafter. If a requested occurrence page begins beyond the final match, the result still
reports the positive exact match count, an empty occurrence page, `hasEarlierOccurrences`, a usable `lastOffset`, and
explicit advice that the pattern is present. It never collapses that state into lexical absence. Regex work runs in a
cancellable isolated worker with bounded per-source and aggregate input, matching records, retained ranges per record,
and elapsed time. Oversized scopes fail explicitly
instead of silently omitting sources, so the caller can narrow the search to a summary or source, or use literal mode.
Regex patterns are capped at 512 characters. Worker startup has a separate 10,000 ms allowance; only after the embedded
worker reports ready does the 2,000 ms execution limit begin. Invalid syntax, over-512-character patterns, execution
timeout, and worker-unavailable failures are distinguished even when the Effect promise boundary wraps the worker's
specific error. Their guidance says not to repeat an unchanged failed call and explains whether to split or fix the
pattern, narrow the source byte interval, or switch to literal mode. A literal pattern containing common regex
operators returns actionable advice to select regex mode rather than silently implying that alternatives were absent.
Success, worker failure, cancellation, and timeout all terminate the worker and detach the request's abort listener.
Completed `lcm_grep` and `lcm_read` calls are deterministic for their reported current-session scope. Canonical repeat
identity normalizes execution-equivalent omitted and explicit defaults, including zero offsets, default modes, limits,
and page sizes. Calls emitted as siblings in one assistant response share a response-scoped canonical reservation, so
the frozen pre-response transcript cannot let simultaneous duplicates evade suppression. The first semantic repeat
returns compact facts from a prior completed result when available plus repeat guidance and
deliberately suppresses the duplicate evidence payload (including media attachments). The protected current-turn
or sibling result remains available; callers must not vary default fields or equivalent patterns merely to replay it,
and should request genuinely different evidence only when needed or answer.
Once five exact grep/read calls have completed after the current user message, later results advise the caller to avoid
an open-ended manual chain: use one focused semantic query when interpretation remains unresolved, answer from existing
evidence, or request another exact excerpt only for a specific unresolved candidate or boundary. Calls remain available;
this advisory does not impose a turn limit.
Every result reports separate source/summary record and occurrence totals for the returned page, plus complete-scope
totals when known. Literal search scans the whole bounded scope and therefore reports complete-scope totals on its
first page; regex reports them only after its bounded scan proves completion. Summaries can overlap their raw
descendants and must not be added to raw totals as independent evidence; tool output and descriptions say so explicitly.
Unscoped search excludes the current user turn and its later assistant/tool sources, which remain visible in protected
ordinary context; this prevents a recovery query from matching its own search terms. The same prior-turn boundary is
enforced for explicit `sourceID`, `sourceRanges`, and `summaryID` scopes, so a guessed or structurally supplied handle
cannot bypass isolation.
Record cursors bind the pattern, mode, case setting, scope, and occurrence offset; `limit` may change between pages.
Every successful search reports the number of prior completed calls with the same canonical input and states that the
result is deterministic for its scope. A suppressed repeat reports the prior compact counts, searched scope, and
continuation availability rather than misleading zero-result facts.

## `lcm_describe`

Describe one source or summary without dumping its full body. Results include stable identity, reachable `active`
state, direct `frontier` membership, excerpt,
size, covered ordinals, digest, and kind-specific provenance or navigation metadata.

## `lcm_expand`

List ordered immediate children of one active summary. Inputs are `summaryID`, optional `limit`, and opaque `cursor`.
Default limit is 10; maximum is 50. It never returns implicit grandchildren. The cursor binds the summary identity,
while `limit` may change between pages. Raw-source children retain their persisted `sourceKind`.

## `lcm_expand_query`

Provide the primary semantic recovery path for one focused question from current-lineage memory. Inputs are `query`,
optional `summaryID`, optional ordered `sourceRanges`, optional `sourceSpan`, optional `sourceOrdinalSpan`, and optional
`maxAnswerTokens` (default 1,000 for ordinary synthesis, 2,000 for each child-private semantic synthesis, and
up to 16,000 for exact-scoped or later deterministic child evidence; respective maxima are 2,000 and 16,000). All
scopes are mutually exclusive. A range scope contains 1–32 chronological, non-overlapping `sourceID` records with optional
inclusive `startOffset` and exclusive `endOffset` UTF-8 byte bounds. It is designed for an exact semantic unit copied
from the structural-anchor map: use the opening marker's byte end, every chronological intermediate source, and the
closing marker's byte start. Only bytes inside those ranges enter retrieval, ranges retain their supplied order, and
the result echoes the effective bounds, persisted raw `sourceKind`, and total scoped bytes.

`sourceSpan` is the concise equivalent for a contiguous known unit: it accepts inclusive `startSourceID` and
`endSourceID`, plus optional `startOffset` on the first source and `endOffset` on the last. The host resolves every
current-lineage source between those endpoints chronologically, enforces the same 32-source and prior-turn bounds, and
uses the resulting exact ranges for retrieval. This avoids spending model steps enumerating transport chunks when the
focused parent question already supplies the unit's endpoint handles.

`sourceOrdinalSpan` provides the same bounded resolution when the structural map, `hostStructuralScope`, or focused
question names numeric source ordinals instead of stable handles. It accepts inclusive `startOrdinal` and `endOrdinal` plus optional endpoint
byte offsets, requires both current-lineage endpoints to exist, and resolves at most 32 chronological sources. This
lets an optional scoped semantic refinement use the known scope directly instead of spending provider steps finding the
corresponding `src_` handles.

Ordinary unscoped retrieval ranks explicit stable handles, then represents the active frontier before overlapping
lexical descendants and fair chronological fill. Its candidate cap scales from eight to 32 with the available evidence
budget, so semantic recovery does not require literal overlap and generic terms cannot crowd older frontier units out.
If the exact explicit-handle and active-frontier text fits the envelope, ordinary retrieval preserves it in full before
descendant sampling. The host's wider isolated prefetch uses the same admission order but balances byte depth between
the frontier and lexically relevant raw descendants. This lets the child inspect details omitted from summaries without
discarding the frontier index. The final inert evidence uses a label-aware copy of the same allocation rather than a
second equal-share pass.
Every selected raw excerpt and deterministic fallback block is labeled with its persisted `sourceKind`; summary blocks
remain distinctly labeled summaries. Semantic inference can therefore distinguish user requests, assistant claims,
reasoning, tool results, media, and attachments instead of guessing provenance from nearby prose.
Summary-scoped retrieval first represents the selected summary and its immediate ordered children within the same
scaled candidate bound, then adds lexical descendant matches and fair chronological fill. Intermediate branch
summaries must not be crowded out by numerous overlapping raw matches when the overview fits. Summary omissions
never exclude descendant raw matches, and a bounded overview is not proof of complete subtree coverage. After the
wider host prefetch, an optional unscoped or summary-scoped `lcm_expand_query` result uses at most 20% of known usable
input capped at 16,000 tokens.
Exact range retrieval fairly represents every supplied range and uses up to two thirds of known usable input capped at
64,000 tokens. The usable-input calculation already excludes the model output allowance. The larger bounded budget
preserves a complete caller-identified semantic unit when feasible while retaining at least one third of usable input
for the query envelope, instructions, and estimation margin. Unknown capacity uses a
4,000-token retrieval budget. Fair allocation redistributes space unused by short records before clipping longer
records, so small receipt or metadata records cannot cause an otherwise fitting exact scope to report truncation. Long
records contribute a fixed-budget mixture of chronological samples and up to 64 windows ranked by local query-term
co-occurrence and rarity. Merged
windows expand into their reserved unused surrounding bytes so passage overlap cannot silently waste the budget.
Per-term candidate caps prevent frequent words from crowding rarer query evidence out. When no term occurs, uniform
chronological sampling exposes some paraphrased evidence beyond simple bookends.
The result distinguishes total relevant candidates from selected excerpts and reports truncation when any in-scope
candidate or range was omitted or clipped, even if every relevance-ranked candidate fit. The bounded extractive
fallback applies the same fair, match-centered allocation across candidate records instead of allowing the first
candidates to consume the answer budget. A summary
scope is limited to that summary and its cycle-safe descendants.

Outside the hidden recovery agent, the tool preempts same-session soft work, shares the LCM model-call queue, and makes
one logical inference through the active Kilo provider/model runtime with no tools. The ordinary runtime may retry that
inference once after a transient provider failure. It does not create a child session, second provider protocol, or
transcript turn. Inside the hidden recovery agent, an unscoped, summary-scoped, or complete single-unit exact
`lcm_expand_query` may atomically claim one of the child's configured semantic-inference allowances and use that same
excerpt-only runtime, capped at 2,000 output tokens. It returns only the concise cited synthesis to the child's private
transcript. An exact scope that matches one host-paired structural unit is labeled with its trusted unit index in both
the semantic assignment and result, so the nested model answers only that unit and later aggregation retains its
identity. Each focused query has a distinct locked semantic assignment, so a complete unit used by another child
remains eligible when the new question needs it. Identical normalized parent questions cannot start another child,
and an equivalent semantic scope cannot run
twice inside one child. When that complete unit exceeds 64,000 UTF-8 bytes and the original request asks for its first,
last, or a bounded Nth-from-start/from-end qualifying event, a sufficiently large configured allowance permits a
host-driven dynamic chronological shard map plus one bounded reduction and a final exact-unit audit. Edge shards return
up to three directionally ordered proposals nearest the requested edge; ordinal shards return at most N local events in
the requested order. This local edge redundancy gives the reducer a nearby fallback when a later proposal fails the
requested subject, action, or event-status criteria. The shard count is derived from
the complete unit size with a 20,000-byte target rather than a fixed count. The base hierarchical reservation is
all-or-none and replaces the single-pass slot; hierarchy is enabled only when the configured limit can afford the
actual
shard-plus-reducer-plus-auditor cost for every matched unit. Each shard preserves
exact source byte lineage and its complete text. The reducer sees bounded result JSON from every successful
chronological shard after the host validates its shape, citations, exact quotes, and byte positions. Those checks do
not prove semantic qualification, so the reducer rechecks every original criterion from each quote and discards
wrong-entity, mention-only, planned, rejected, or continuation proposals before ordering. If one shard has no valid
structured result, its exact raw shard is preserved once as
private reducer fallback, preventing a formatting, incomplete-response, or provider failure from deleting that
evidence between stages without treating the shard as complete. When unused configured semantic allowance leaves two
calls available for pass repair, malformed primary shards are retried once at their original size before optional
semantic subdivision. Remaining allowance can split the earliest unconfirmed-negative or partial positive primary
shard through the provisional requested ordinal once into two exact chronological repair segments. When no earlier
uncertainty exists, the first one just beyond that target is one bounded sentinel against
false-positive candidates. The primary result is not supplied to its repair because it cannot establish exhaustive
local coverage. Repair segments replace the primary only as the non-overlapping reduction topology; verified primary
events remain additive in the exact segment containing their source positions and in the bounded private
reconciliation ledger. Overlapping normalized duplicates collapse, but disjoint repeated events do not. A still-invalid
segment supplies its smaller exact reducer fallback even when it retains a valid primary event, and its status prevents
full coverage. These extra calls retain lifetime budget and usage accounting and never consume the reducer or auditor
reservation. The auditor then independently re-reads the
complete exact raw unit without receiving the map or
tentative reduction, preventing a mistaken navigation candidate from anchoring the audit. A shard-local `none`
classification is normalized to an empty answer and no citations, so
harmless explanatory no-result prose remains usable as a search hint, but it never proves absence by itself. The
auditor must independently verify event status and the requested boundary against the complete unit. Malformed
envelopes, invalid citation shapes, and out-of-scope citations remain invalid. Full unit coverage requires all shards,
the reducer, and a full-coverage auditor result to finish and validate, plus normalized shard-aggregate/reducer/auditor
answer agreement and at least one source citation shared by all three. Once both base passes finish, the host can
atomically spend spare configured
allowance on one clean retry for each invalid reducer or auditor. Each retry receives unchanged evidence and only its
host rejection category, never the rejected response, and undergoes identical validation. Bounded host-only
diagnostics record rejection categories, per-pass attempts, and auditor status without retaining raw rejected output.
When the reducer and auditor disagree, the host exposes each distinct bounded proposal and uses its deterministic
position-ordered shard aggregate as the partial top-level candidate when available; it never promotes that choice to
complete coverage. The tool reports
`semanticPass.strategy: chronological_shard_reduce`, the actual shard count, and whether that pass established complete
coverage. Clipped exact source range and span scopes that are not host-proven complete structural units do not start
the nested model; they perform bounded
deterministic selection so the evidence-bearing child remains the synthesis owner. Those scopes may return private
`research_evidence` capped at 16,000 tokens and at one third of known usable input so the initial evidence, result, and
final synthesis can coexist on smaller-context models.
Neither form enters the parent context; explicit smaller requests remain supported. The answer is
validated as `answer`, selected `citations`, and `coverage` (`full`, `partial`, or `none`), and its cost is added to the
calling assistant message. Its reported token/cache usage remains attached to the private tool result so the enclosing
isolated query can account for it without exposing evidence to the parent. A valid `none` response is reported as
`no_answer` and is not accepted as a blank generated
answer; eligible bounded evidence uses the extractive fallback instead. Provider failure after the retry or invalid
output is explicit. When the provider remains unavailable after its ordinary retry, guidance permits one retry of the
same exact semantic query before manual recovery; other incomplete responses require a genuinely refined query. A
bounded extractive
fallback is allowed for an exact `sourceRanges` scope, an explicit handle, or at least two useful query terms. Only a
normal provider `stop` can
produce a generated answer; a length-limited, filtered, errored, tool-call, unknown, or absent finish is reported as an
incomplete response and uses the same bounded fallback. The query output limit is enforced through a constrained model
copy rather than provider options. Query instructions prevent double-counting overlapping summary/raw evidence and
require partial coverage unless exact or exhaustive completeness is actually supported. LCM also downgrades a claimed
`full` answer to `partial` whenever retrieval omitted or clipped in-scope evidence. They make the output allowance
a ceiling rather than a target, preserve event modality instead of treating every mention as an occurrence, state that
missing wording is not proof that an action is absent, require concise numeric/count results, and prohibit copying
excerpts into a generated answer. First/last queries build an internal ordered event ledger and scan from the relevant
scope boundary before choosing an answer. A fallback is labeled `extractive_fallback` before its evidence and explicitly
says
it is not a computed answer.
Every accepted generated answer includes immediate recovery guidance. A full, unclipped synthesis directs the caller
to answer when the question is resolved instead of decomposing or paging the same scope. Full retrieved-scope coverage
is not presented as automatic proof of exact completeness outside explicit bounded ranges. If exact or exhaustive
verification remains necessary, full and partial results direct at most one bounded `sourceRanges` grep or targeted
read for a decisive named candidate. For a partial first/last/Nth/count/list result whose host-provided
`boundaryScope` may still contain a semantically distinct or paraphrased event, the child instead copies all of that
materially narrower boundary's ranges into one `lcm_expand_query`; it never treats a lexical miss or a prefix-only read
as proof of absence across the multi-range boundary and never reruns the same complete unit. If that bounded work still
cannot prove the requested boundary, the child returns partial coverage and names the gap. This remains guidance rather
than a tool-call cap.
Unscoped and explicit-summary retrieval use the same prior-turn boundary as `lcm_grep`; a current-lineage summary is
accepted only when every covered source precedes the parent turn cutoff.

## `lcm_read`

Read a digest-verified source from the persisted Kilo transcript. Text reads default to 8 KiB and are capped at
32 KiB. A non-negative UTF-8 byte `offset`, including a `lcm_grep` byte-range start or returned `nextOffset`, seeks
directly to relevant exact text. An optional exclusive UTF-8 `endOffset`, normally copied from a matching structural
closing marker, prevents every page from crossing the intended interval. An opaque cursor also continues
sequentially, and cursor and offset inputs are mutually exclusive. Reads preserve UTF-8 boundaries and bind cursors
to source ID, digest, and `endOffset`. Callers copy byte offsets from grep ranges, structural anchors, or read
continuations instead of calculating them from decoded content length. A caller may change `maxBytes` on the next page
without invalidating the continuation cursor, but retains the same `endOffset`. Every text result reports `complete`;
incomplete results provide both a numeric
`nextOffset` and opaque `nextCursor`, while complete results set both continuations to `null` and explicitly say the end
of the requested interval or transport source was reached. Unbounded source EOF is not necessarily semantic-unit EOF.
Results include the source kind and ordinal,
immediate chronological neighbors, and nearest prior/later non-receipt source. A verified unit that crosses a source
boundary therefore continues at offset zero in the reported later non-receipt source rather than scanning bytes before
an opening near the current source's end. A requested offset past the source end is clamped to a disclosed terminal
empty read rather than producing
a misleading UTF-8-boundary error. Descriptions and per-page advice forbid reusing the consumed cursor or offset and
direct aggregation/cross-source work to focused query or search rather than repeated maximum-size sequential reads.
As with grep, every successful read reports prior identical completed calls and tells the model not to repeat a
deterministic source read.
Source-scoped grep pages with additional occurrences similarly advise exhaustive pagination only when it is actually
necessary and otherwise direct the caller to a refined pattern or focused query. Immutable persisted media may be
returned through Kilo's normal attachment channel after digest verification. Current filesystem or remote URL bytes
are never substituted.

Cursors are signed, require one canonical base64url encoding, and bind semantic query or source identity while
permitting a different page-size limit. Changing any other bound field or the opaque cursor text invalidates it. All operations
consume Kilo's cancellation signal and run through ordinary permission requests.

Safe error codes are:

- `lcm_not_found`
- `lcm_stale_lineage`
- `lcm_invalid_cursor`
- `lcm_invalid_regex`
- `lcm_cancelled`
- `lcm_unavailable`

Errors do not reveal a database path, SQL, another session ID, or hidden content. Upstream tools, including `recall`
and `notify_user`, remain registered. With LCM enabled, recall retains its upstream cross-session behavior but excludes
the active current session and hidden recovery children; disabled mode restores upstream active-session behavior.
