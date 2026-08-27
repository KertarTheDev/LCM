# Memory tools

Status: normative current-code tool contract.

When `experimental.conversation_memory` is absent or `true`, Conversation Memory registers exactly five ordinary Kilo
tools. Explicit `false` registers none of them. The trusted tool context supplies the session ID; model parameters
cannot select a session. Each enabled execution refreshes the finalized transcript, checks the derived lineage, and
authorizes only current-lineage sources and summaries.

The five tools remain available in Kilo's built-in Ask, Plan, Explore, Scout, and Orchestrator allowlists so every
user-facing agent that may need older current-session detail can recover it. Ordinary permission precedence still
applies: explicit global or per-agent denies remove a tool, and hidden system utility agents expose none of them.

## `lcm_grep`

Search exact retained current-session raw source text and summary text. This is lexical discovery: a hit is a candidate,
not proof of the event status or interpretation in the user's question, and a miss excludes only that spelling rather
than paraphrases. Semantic interpretation and aggregation use `lcm_expand_query`. Inputs are `pattern`, optional mode
(`literal` or `regex`), `caseSensitive`, `summaryID`, `sourceID`, ordered `sourceRanges`, `startOffset`, `endOffset`,
`occurrenceOffset`, `limit`, and opaque `cursor`. `summaryID`, `sourceID`, and `sourceRanges` are mutually exclusive.
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
and page sizes. The first semantic repeat returns compact facts from the prior result plus repeat guidance and
deliberately suppresses the duplicate evidence payload (including media attachments). The protected current-turn
result remains available; callers must not vary default fields or equivalent patterns merely to replay it, and should
request genuinely different evidence only when needed or answer.
Once five exact grep/read calls have completed after the current user message, later results advise the caller to avoid
an open-ended manual chain: use one focused semantic query when interpretation remains unresolved, answer from existing
evidence, or request another exact excerpt only for a specific unresolved candidate or boundary. Calls remain available;
this advisory does not impose a turn limit.
Every result reports separate source/summary record and occurrence totals for the returned page, plus complete-scope
totals when known. Literal search scans the whole bounded scope and therefore reports complete-scope totals on its
first page; regex reports them only after its bounded scan proves completion. Summaries can overlap their raw
descendants and must not be added to raw totals as independent evidence; tool output and descriptions say so explicitly.
Unscoped search excludes the current user turn and its later assistant/tool sources, which remain visible in protected
ordinary context; this prevents a recovery query from matching its own search terms. An explicit `sourceID`,
`sourceRanges`, or `summaryID` can still address any trusted current-lineage item.
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
while `limit` may change between pages.

## `lcm_expand_query`

Provide the primary semantic recovery path for one focused question from current-lineage memory. Inputs are `query`, optional `summaryID`, optional ordered
`sourceRanges`, and optional `maxAnswerTokens` (default 1,000; maximum 2,000). `summaryID` and `sourceRanges` are
mutually exclusive. A range scope contains 1–32 chronological, non-overlapping `sourceID` records with optional
inclusive `startOffset` and exclusive `endOffset` UTF-8 byte bounds. It is designed for an exact semantic unit copied
from the structural-anchor map: use the opening marker's byte end, every chronological intermediate source, and the
closing marker's byte start. Only bytes inside those ranges enter retrieval, ranges retain their supplied order, and
the result echoes the effective bounds and total scoped bytes.

Unscoped or summary-scoped retrieval ranks explicit stable handles and lexical evidence and selects at most eight
excerpts, filling unused slots with a fair chronological sample of the active frontier or requested summary scope so
semantic recovery does not require literal overlap. It uses at most 20% of known usable input capped at 16,000 tokens.
Exact range retrieval fairly represents every supplied range and uses up to 50% of known usable input capped at 64,000
tokens. The larger bounded budget preserves the complete caller-identified semantic unit when feasible while retaining
at least half of known usable input for the query envelope, output, and estimation margin. Unknown capacity uses a
4,000-token retrieval budget. Fair allocation redistributes space unused by short records before clipping longer
records, so small receipt or metadata records cannot cause an otherwise fitting exact scope to report truncation. Long
records contribute a fixed-budget
mixture of chronological samples and windows ranked by local query-term co-occurrence and rarity. Per-term candidate
caps prevent frequent words from crowding rarer query evidence out. When no term occurs, uniform chronological sampling
exposes some paraphrased evidence beyond simple bookends.
The result distinguishes total relevant candidates from selected excerpts and reports truncation when a candidate or
in-scope range was omitted or clipped. The bounded extractive fallback applies the same fair, match-centered
allocation across candidate records instead of allowing the first candidates to consume the answer budget. A summary
scope is limited to that summary and its cycle-safe descendants.

The tool preempts same-session soft work, shares the LCM model-call queue, and makes one logical inference through the
active Kilo provider/model runtime with no tools. The ordinary runtime may retry that inference once after a transient
provider failure. It does not create a child session, second provider protocol, or transcript turn. The answer is
validated as `answer`, selected `citations`, and `coverage` (`full`, `partial`, or `none`), and its cost is added to the
calling assistant message. A valid `none` response is reported as `no_answer` and is not accepted as a blank generated
answer; eligible bounded evidence uses the extractive fallback instead. Provider failure after the retry or invalid
output is explicit. A bounded extractive
fallback is allowed for an exact `sourceRanges` scope, an explicit handle, or at least two useful query terms. Only a
normal provider `stop` can
produce a generated answer; a length-limited, filtered, errored, tool-call, unknown, or absent finish is reported as an
incomplete response and uses the same bounded fallback. The query output limit is enforced through a constrained model
copy rather than provider options. Query instructions prevent double-counting overlapping summary/raw evidence and
require partial coverage unless exact or exhaustive completeness is actually supported. LCM also downgrades a claimed
`full` answer to `partial` whenever retrieval omitted or clipped in-scope evidence. They make the output allowance
a ceiling rather than a target, preserve event modality instead of treating every mention as an occurrence, state that
missing wording is not proof that an action is absent, require concise numeric/count results, and prohibit copying
excerpts into a generated answer. A fallback is labeled `extractive_fallback` before its evidence and explicitly says
it is not a computed answer.
Unscoped retrieval uses the same prior-turn boundary as `lcm_grep`; an explicit summary scope may address a trusted
current-lineage summary beyond that boundary.

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
Results include the source ordinal,
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
and `notify_user`, remain registered and follow their existing behavior.
