# Memory tools

Status: normative current-code tool contract.

When `experimental.conversation_memory` is absent or `true`, the ordinary model-facing recovery surface is exactly
`lcm_query`. Explicit `false` registers no LCM tool. Ask, Plan, Explore, Scout, Orchestrator, and other user-facing
agents may ask one focused question; ordinary permission precedence still applies, so an explicit deny removes
`lcm_query`. Raw recovery primitives are never advertised to those agents.

By default, one parent user turn may start at most two isolated child sessions: the focused question and, only when a
returned `partial` result names a blocking gap, one materially narrower follow-up. The advanced
`conversation_memory.recovery.max_queries_per_turn` setting changes that hard allowance; zero removes `lcm_query`
without changing other ordinary-agent tools. Every later question must still be materially narrower than a reported
gap rather than an attempt to page raw history. Parallel parent calls reserve the shared limit synchronously. Invalid
provider arguments and host-suppressed duplicates do not consume an actual-child slot. After the configured number of
started child calls complete or fail, the next parent provider step is answer-directed: ordinary tools are
absent and text responses use `toolChoice: none`, but `lcm_query` remains executable as a one-step settlement fallback
for a provider that ignores that choice and emits a stale call from the prior schema. The fallback returns the no-child
exhaustion sentinel as a normal completed tool result instead of an unavailable-tool error; synchronous reservation
prevents another child session. The host then runs one genuinely tool-free answer step. Providers that honor the choice
answer immediately without the sentinel step. A requested structured response also retains its required final-output
tool. An identical question, after whitespace and case normalization, returns the same sentinel without spending the
narrower-follow-up slot. The sentinel directs the parent to use the prior bounded result and not substitute cross-session
recall for its current-session query. Thus a tool-seeking model cannot reset the allowance through an external
continuation, repeat the settlement fallback even with malformed arguments, or transfer the loop to another recovery
tool.

`lcm_query` creates a hidden read-only child session on the active Kilo provider/model. Only trusted session metadata
binds that child to the calling parent session; neither the parent model nor the child can select another session. Its
research phase privately receives `lcm_grep`, `lcm_describe`, `lcm_expand_query`, `lcm_expand`, and `lcm_read`. Every
primitive refreshes the parent's finalized transcript, verifies its current lineage, and authorizes only prior-turn
parent sources and active summaries. Intermediate prompts, reasoning, searches, and exact text remain in the child
session.
While LCM is enabled, upstream `kilo_local_recall` excludes both hidden research/finalizer agents and the calling active
session from search candidates and direct reads. The parent therefore cannot bypass the bounded result by discovering
its child or reconstructing its own raw current-session transcript. Recall of other eligible project/worktree sessions
is unchanged; explicit `experimental.conversation_memory: false` restores upstream active-session recall behavior.

The hidden recovery operation owns all recovery inference. Before the child's first provider step, the host runs the
extractive half of `lcm_expand_query` and copies that bounded inert evidence only into the hidden transcript; this
prefetch itself makes no model call. It also pairs arbitrary exact raw opening/closing markers in prior-turn source
order. When the focused question names a matching structural label, or there is one unambiguous paired label for an
explicitly boundary-sensitive question, the child receives a bounded `hostStructuralScope` with exact ordinals and
UTF-8 offsets. The prefetch then selects only from the matching raw boundary envelope; overlapping summary labels and
claims cannot redefine that scope. The main session still receives none of this map or raw evidence. Retrieval uses
the exact trusted focused question plus at most 2,048 characters of the current non-synthetic user request for
candidate-record disambiguation. Only the focused question controls passage placement inside a candidate; it remains
the sole assignment and the broader request is explicitly not a second instruction. The initial pass, including its
structural map when present, may use one third of usable model input, capped at 32,000 tokens; later
optional deterministic child query results use at most one third of usable input and retain a separate 16,000-token
cap so both can coexist safely in the hidden context.
The child model synthesizes that evidence and may use scoped navigation or exact grep/read verification. An unscoped,
summary-scoped, or complete single-unit exact `lcm_expand_query` executed by a child may spend one atomically reserved
semantic-inference allowance: the existing LCM query runtime gives the active provider/model only the focused question
and selected excerpts in a fresh tool-free context, then returns a concise cited synthesis to the child. A clipped
exact scope returns deterministic bounded evidence instead. The allowance is configurable and applies atomically
across parallel calls. This avoids a mandatory provider round trip for easy questions, lets complete independent
units be interpreted without first combining a clipped multi-unit envelope, and keeps incomplete exact evidence in
the evidence-bearing child for final synthesis.

The public child operation has separately configurable research, finalization, and cleanup wall-clock limits, with
defaults of 540, 600, and 60 seconds. The complete limit is their sum; active work is interrupted before the cleanup
reserve. If provider teardown is still running at that boundary, its already-interrupted detached fiber may finish only
cleanup and accounting; it cannot resume model work or supply a late result to the parent. Expiry returns a normal
bounded `none` result naming the deadline as unresolved; it does not leave the parent tool pending until the outer
request is aborted. The host-prefetched semantic evidence base is bound to the exact focused question stored in trusted
child metadata. A child `lcm_expand_query` is optional, and the host replaces any recovery-model rewrite of its `query`
field with the trusted question. When `hostStructuralScope.exactEnvelope` is present, a boundary-sensitive refinement
uses its exact scope; an unscoped semantic query cannot replace it. If a clipped scope contains several matched units,
the child queries each represented unit independently through its `contentScope.sourceOrdinalSpan`, preferably in one
parallel batch. It preserves unit index and order and never submits the clipped combined envelope as one semantic
query. A complete single-unit scope may use a private semantic inference; a clipped unit returns deterministic evidence.
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
units. When research ends after a primitive call, the host starts a separately timed tool-free synthesis prompt in the
same hidden transcript. It requires `StructuredOutput`, so the child that actually inspected the evidence also
produces the bounded answer from the complete initial and recovered evidence instead of ending on uninterpreted tool
output. The request places the fairly bounded cumulative candidate ledger next to the synthesis instruction while the
complete hidden transcript remains available for provenance and conflict resolution. A direct full-coverage draft
that consumed a clipped primitive result receives this evidence-led review before acceptance. Its earlier draft is
excluded from the review ledger so an unsupported conclusion cannot anchor the correction. A recoverable
`StructuredOutput` failure, including output-length exhaustion before submission, still enters
this same-transcript synthesis phase; only a non-recoverable assistant/provider error bypasses it. Parallel siblings
reserve the shared primitive and semantic budgets synchronously.

The host validates the newest terminal structured submission persisted in the research child, including when the
prompt call returned an earlier tool-transition message. It rejects an overlong answer for isolated rewriting, bounds
gap strings, supplies a generic gap when partial coverage omitted one, and drops malformed, oversized, or excess
optional citations before exact lineage validation instead of discarding an otherwise usable answer. It then copies
only the bounded answer fields. This avoids a normal second model having to reinterpret a lossy natural-language
handoff while keeping the parent isolated from research messages and primitive outputs. Only when the evidence-bearing
child does not produce a usable structured submission
does the host start a fresh sibling hidden session locked to the repair finalizer. No LCM recovery primitive or ordinary
tool is available there. Its initial step receives only Kilo's structured-output finalizer, the exact focused question,
and a cumulative ledger of at most 65,536 characters. A matched host structural scope remains in the bounded initial
digest, while the research child's earlier model chatter and raw tool transcript are deliberately absent. If that
repair submission is unusable, configured repair attempts continue from that same cumulative ledger. Every attempt
uses structured output except the last of two or more attempts, which has no generated tool and may return only a
bounded natural-language answer; the host marks it `partial`, attaches no citations, and records the fallback in
isolation metadata. A zero repair allowance returns the primary synthesis failure directly. The prefetch retains a
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
The atomic per-child allowance prevents parallel or repeated semantic primitives from exceeding the configured work.
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
requirements when they matter. It contains only the question, never candidate answers, examples, evidence, or copied
raw history. The host repairs only an unambiguous bounded single-string wrapper produced by an OpenAI-compatible
endpoint; truncated JSON, oversized questions, and wider mutations remain invalid and leave the tool available for a
concise retry because no child was started. There is no model-controlled session selector, raw-output limit, or
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
current-turn, stale, missing, out-of-range, non-boundary, oversized, or empty intervals, and copies the exact persisted
bytes itself. Invalid optional citations are omitted. Their answer remains isolated and is downgraded from `full` to
`partial` with a named validation gap, so a citation defect cannot discard a useful synthesis or copy unvalidated text.
Source handles and retrieval `sourceRanges` returned by semantic recovery are provenance, not parent citation
intervals. The private tool result, final-step prompt, and structured schema direct the child to omit citations unless
`lcm_grep` or `lcm_read` already established exact offsets within the 512-byte bound.
An answer that exceeds the 1,024-character contract is invalid rather than clipped: the host keeps it inside the
hidden research handoff and invokes the isolated synthesis/repair path to rewrite all supported candidates within the
bound. This prevents a valuable item near the end of an exact list from being silently removed by transport bounding.
If the structured submission itself is unusable, the single tool-free correction may supply a bounded plain answer;
the host accepts it only as partial and uncited. Empty or errored corrections remain `none`.

The parent receives only the bounded direct answer, coverage, unresolved gaps, host-copied exact excerpts, and compact
isolation metrics. It never receives the child transcript or primitive outputs. That bounded result supplements rather
than replaces the parent's projected active context. Parent guidance requires the final answer to retain independently
supported facts already visible there even when a partial or empty recovery result omits them. When evidence conflicts,
it prefers exact claims supported by host-verified excerpts over unsupported inference. A full result directs the
parent to answer immediately. A partial result permits one materially narrower `lcm_query` only when the named gap
blocks the user answer. Provider cost incurred by the child is propagated to the calling parent assistant message.
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
`occurrencePage.lastOffset` to jump directly to the final retained page for a last-occurrence question. Regex work runs in a
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
Summary-scoped retrieval retains lexical ranking plus fair chronological fill within the same scaled bound. After the
wider host prefetch, an optional unscoped or summary-scoped `lcm_expand_query` result uses at most 20% of known usable
input capped at 16,000 tokens.
Exact range retrieval fairly represents every supplied range and uses up to 50% of known usable input capped at 64,000
tokens. The larger bounded budget preserves the complete caller-identified semantic unit when feasible while retaining
at least half of known usable input for the query envelope, output, and estimation margin. Unknown capacity uses a
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
transcript. Clipped exact source range and span scopes do not start the nested model; they perform bounded
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
read for the decisive candidate or boundary, then direct the caller to answer rather than scan cited sources page by
page. This remains guidance rather than a tool-call cap.
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
