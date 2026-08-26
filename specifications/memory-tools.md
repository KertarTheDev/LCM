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

Search exact retained current-session raw source text and summary text. Inputs are `pattern`, optional mode (`literal`
or `regex`), `caseSensitive`, `summaryID`, `sourceID`, `occurrenceOffset`, `limit`, and opaque `cursor`. Default record
limit is 20; maximum is 50. Literal mode treats regex syntax such as `|` as ordinary text; alternatives require regex
mode. A summary scope
searches its cycle-safe descendant closure; a source scope searches one exact current-lineage source, and both scopes
may be combined. Each returned record reports an exact `matchCount`, bounded character
`ranges`, matching UTF-8 `byteRanges`, local `occurrences` (one compact preview per global record or all 20 retained ranges for
a source-scoped search), an exact occurrence-page offset/total/next offset, `rangesComplete`, `occurrencesComplete`,
and source records identify their `sourceKind`, so a range cap or assistant/tool record is never mistaken for
exhaustive user-source evidence. The caller can pass a
`byteRange.start` to `lcm_read.offset` to inspect exact source text around any retained match. If a source has more than
20 matches, repeat the source-scoped search with its `occurrencePage.nextOffset`. Regex work runs in a
cancellable isolated worker with bounded per-source and aggregate input, matching records, retained ranges per record,
and elapsed time. Oversized scopes fail explicitly
instead of silently omitting sources, so the caller can narrow the search to a summary or source, or use literal mode.
Regex patterns are capped at 512 characters and isolated work has a 2,000 ms safety limit. Limit failures explain
whether to shorten the pattern, narrow the scope, or switch to literal mode. A literal pattern containing common regex
operators returns actionable advice to select regex mode rather than silently implying that alternatives were absent.
Every result reports separate source/summary record and occurrence totals for the returned page, plus complete-scope
totals when known. Summaries can overlap their raw descendants and must not be added to raw totals as independent
evidence; tool output and descriptions say so explicitly.
Unscoped search excludes the current user turn and its later assistant/tool sources, which remain visible in protected
ordinary context; this prevents a recovery query from matching its own search terms. An explicit `sourceID` or
`summaryID` can still address any trusted current-lineage item.
Record cursors bind the pattern, mode, case setting, scope, and occurrence offset; `limit` may change between pages.

## `lcm_describe`

Describe one source or summary without dumping its full body. Results include stable identity, reachable `active`
state, direct `frontier` membership, excerpt,
size, covered ordinals, digest, and kind-specific provenance or navigation metadata.

## `lcm_expand`

List ordered immediate children of one active summary. Inputs are `summaryID`, optional `limit`, and opaque `cursor`.
Default limit is 10; maximum is 50. It never returns implicit grandchildren. The cursor binds the summary identity,
while `limit` may change between pages.

## `lcm_expand_query`

Answer one focused question from current-lineage memory. Inputs are `query`, optional `summaryID`, and optional
`maxAnswerTokens` (default 1,000; maximum 2,000). Retrieval ranks explicit stable handles and lexical evidence, selects
at most eight excerpts, and uses at most 20% of known usable input capped at 16,000 tokens; unknown capacity uses a
4,000-token retrieval budget. The budget is divided fairly across selected records. Long records contribute bounded
windows around the first and last useful term occurrences rather than an unrelated prefix, with bounded bookends when
only an explicit handle is available. A summary scope is limited to that summary and its cycle-safe descendants.

The tool preempts same-session soft work, shares the LCM model-call queue, and makes at most one call through the active
Kilo provider/model runtime with no tools. It does not create a child session, second provider protocol, or transcript
turn. The answer is validated as `answer`, selected `citations`, and `coverage` (`full`, `partial`, or `none`), and its
cost is added to the calling assistant message. Provider failure or invalid output is explicit. A bounded extractive
fallback is allowed only for an explicit handle or at least two useful query terms. Only a normal provider `stop` can
produce a generated answer; a length-limited, filtered, errored, tool-call, unknown, or absent finish is reported as an
incomplete response and uses the same bounded fallback. The query output limit is enforced through a constrained model
copy rather than provider options. Query instructions prevent double-counting overlapping summary/raw evidence and
require partial coverage unless exact or exhaustive completeness is actually supported.
Unscoped retrieval uses the same prior-turn boundary as `lcm_grep`; an explicit summary scope may address a trusted
current-lineage summary beyond that boundary.

## `lcm_read`

Read a digest-verified source from the persisted Kilo transcript. Text reads default to 8 KiB and are capped at
32 KiB. A non-negative UTF-8 byte `offset`, including a `lcm_grep` byte-range start, seeks directly to relevant exact
text; an opaque cursor continues sequentially, and the two inputs are mutually exclusive. Reads preserve UTF-8
boundaries and bind cursors to source ID and digest. A caller may change `maxBytes` on the next page without invalidating
the continuation cursor. Immutable persisted media may be returned through
Kilo's normal attachment channel after digest verification. Current filesystem or remote URL bytes are never
substituted.

Cursors are signed and bind semantic query or source identity while permitting a different page-size limit. Changing
any other bound field invalidates a cursor. All operations
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
