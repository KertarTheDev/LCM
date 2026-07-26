# Verification and upstream compatibility

Status: normative current-code acceptance contract.

The focused package gates are:

- `lcm:store`
- `lcm:tree`
- `lcm:projection`
- `lcm:tools`
- `lcm:api`
- `lcm:export`
- `lcm:upstream-compat`
- `lcm:long-context`
- `lcm:packaged-smoke`
- VS Code `lcm:ui`
- `lcm:contracts:check`
- `lcm:docs:check`

The repository root test command is not an LCM gate. Run owning package suites, then the affected compiler, SDK,
extension, annotation, formatting, and packaging gates selected by changed paths.

Storage tests cover sidecar naming, first open/reopen, transactions, current-lineage replacement, digest metadata,
leases, deletion, corruption/schema recovery, restrictive permissions, and absence of duplicated raw bodies.

Tree/projection tests cover deterministic IDs, bounded roots, multi-level condensation, invalid model output,
protected tail, continuation pinning, pressure no-op, fail-open behavior, and the two narrow shared prompt seams.

Tool tests freeze the four names, query-bound cursors, UTF-8 paging, worker regex behavior, current-session
authorization, cancellation, stale digests, and ordinary tool registration. API/export tests freeze paths, DTOs,
events, pagination, safe errors, normalization, archive hashes, sensitive transport exclusions, and atomic private
writes.

Compatibility gates keep upstream manual compaction, overflow fallback, queue behavior, Project Memory, `recall`,
`notify_user`, remote/session behavior, structured output, permissions, request identity, and provider behavior
available. The LCM seam may not add a custom provider payload or stream timeout.

The upstream-compatibility script runs 23 of the 24 v7.4.16 prompt-queue tests. It excludes exactly
`cancel drops queued prompts and resets internal state`: under Bun 1.3.14 that test reproducibly ends with an
interrupted Effect fiber on an unmodified `v7.4.16` worktree as well as on this branch. This is an inherited baseline
defect, not an LCM allowance. Keep the exact upstream reproduction in release evidence, continue to run every other
queue test, and remove the exclusion when upstream makes the case deterministic.

`specifications/fixtures/binding-state.json` is deterministic and must prove every binding fact is present or
recoverable through at most three memory-tool calls after multiple summary levels, with no invented identity or
revived rejected decision.

Packaged acceptance runs only against an actual compiled CLI or VSIX. It verifies artifact identity, command discovery,
absence of retired assets, and hashes. Release evidence additionally exercises all four tools, status/activity/events,
export, cache deletion/rebuild, an injected store failure, and manual compaction from the extracted runtime.
