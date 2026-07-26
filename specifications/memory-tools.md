# Memory tools

Status: normative current-code tool contract.

Conversation Memory registers exactly four ordinary Kilo tools. The trusted tool context supplies the session ID;
model parameters cannot select a session. Each execution refreshes the finalized transcript, checks the derived
lineage, and authorizes only current-lineage sources and summaries.

## `lcm_grep`

Search retained current-session source excerpts and summary text. Inputs are `pattern`, optional `mode` (`literal` or
`regex`), `caseSensitive`, `summaryID`, `limit`, and opaque `cursor`. Default limit is 20; maximum is 50. A summary
scope searches its descendant closure. Regex work runs in a cancellable isolated worker with bounded per-source and
aggregate input, matches, and elapsed time. Oversized scopes fail explicitly instead of silently omitting sources, so
the caller can narrow the search to a summary or use literal mode.

## `lcm_describe`

Describe one source or summary without dumping its full body. Results include stable identity, active state, excerpt,
size, covered ordinals, digest, and kind-specific provenance or navigation metadata.

## `lcm_expand`

List ordered immediate children of one active summary. Inputs are `summaryID`, optional `limit`, and opaque `cursor`.
Default limit is 10; maximum is 50. It never returns implicit grandchildren.

## `lcm_read`

Read a digest-verified source from the persisted Kilo transcript. Text reads default to 8 KiB and are capped at
32 KiB; pagination preserves UTF-8 boundaries and binds the cursor to source ID, digest, and page size. Immutable
persisted media may be returned through Kilo's normal attachment channel after digest verification. Current filesystem
or remote URL bytes are never substituted.

Cursors are signed and bound to the complete query. Changing a query field invalidates a cursor. All operations
consume Kilo's cancellation signal and run through ordinary permission requests.

Safe error codes are:

- `lcm_not_ready`
- `lcm_not_found`
- `lcm_wrong_session`
- `lcm_stale_lineage`
- `lcm_invalid_cursor`
- `lcm_invalid_regex`
- `lcm_cancelled`
- `lcm_unavailable`

Errors do not reveal a database path, SQL, another session ID, or hidden content. Upstream tools, including `recall`
and `notify_user`, remain registered and follow their existing behavior.
