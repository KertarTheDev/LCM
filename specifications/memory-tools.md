# Memory tools

Status: normative current-code tool contract.

When `experimental.conversation_memory` is absent or `true`, Conversation Memory registers exactly five ordinary Kilo
tools. Explicit `false` registers none of them. The trusted tool context supplies the session ID; model parameters
cannot select a session. Each enabled execution refreshes the finalized transcript, checks the derived lineage, and
authorizes only current-lineage sources and summaries.

## `lcm_grep`

Search retained current-session source excerpts and summary text. Inputs are `pattern`, optional `mode` (`literal` or
`regex`), `caseSensitive`, `summaryID`, `limit`, and opaque `cursor`. Default limit is 20; maximum is 50. A summary
scope searches its cycle-safe descendant closure. Regex work runs in a cancellable isolated worker with bounded
per-source and aggregate input, matching records, ranges per record, and elapsed time. Oversized scopes fail
explicitly instead of silently omitting sources, so the caller can narrow the search to a summary or use literal mode.

## `lcm_describe`

Describe one source or summary without dumping its full body. Results include stable identity, reachable `active`
state, direct `frontier` membership, excerpt,
size, covered ordinals, digest, and kind-specific provenance or navigation metadata.

## `lcm_expand`

List ordered immediate children of one active summary. Inputs are `summaryID`, optional `limit`, and opaque `cursor`.
Default limit is 10; maximum is 50. It never returns implicit grandchildren.

## `lcm_expand_query`

Answer one focused question from current-lineage memory. Inputs are `query`, optional `summaryID`, and optional
`maxAnswerTokens` (default 1,000; maximum 2,000). Retrieval ranks explicit stable handles and lexical evidence, selects
at most eight excerpts, and uses at most 20% of known usable input capped at 16,000 tokens; unknown capacity uses a
4,000-token retrieval budget. A summary scope is limited to that summary and its cycle-safe descendants.

The tool preempts same-session soft work, shares the LCM model-call queue, and makes at most one call through the active
Kilo provider/model runtime with no tools. It does not create a child session, second provider protocol, or transcript
turn. The answer is validated as `answer`, selected `citations`, and `coverage` (`full`, `partial`, or `none`), and its
cost is added to the calling assistant message. Provider failure or invalid output is explicit. A bounded extractive
fallback is allowed only for an explicit handle or at least two useful query terms.

## `lcm_read`

Read a digest-verified source from the persisted Kilo transcript. Text reads default to 8 KiB and are capped at
32 KiB; pagination preserves UTF-8 boundaries and binds the cursor to source ID, digest, and page size. Immutable
persisted media may be returned through Kilo's normal attachment channel after digest verification. Current filesystem
or remote URL bytes are never substituted.

Cursors are signed and bound to the complete query. Changing a query field invalidates a cursor. All operations
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
