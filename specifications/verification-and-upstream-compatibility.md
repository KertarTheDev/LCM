# Verification and upstream compatibility

Status: normative v7.4.23 acceptance contract.

Focused gates remain `lcm:store`, `lcm:tree`, `lcm:projection`, `lcm:tools`, `lcm:api`, `lcm:export`,
`lcm:upstream-compat`, `lcm:long-context`, `lcm:packaged-smoke`, VS Code `lcm:ui`, `lcm:contracts:check`, and
`lcm:docs:check`. Never substitute the repository-root test command.

Acceptance must prove:

- absent/`true` default-on feature resolution, explicit-`false` opt-out, and invalid non-boolean rejection;
- disabled mode matches upstream v7.4.23 automatic, provider-overflow, `compaction.auto=false`, threshold, current-tool
  preflight deferral, and manual compaction behavior;
- disabled prompt, idle, deletion, API, CLI, and tool paths neither create nor mutate a sidecar, while re-enable
  reuses or rebuilds retained state;
- newest-first stream normalization and stable chronology for new, legacy, imported, and 100+ source sessions;
- schema-v6/tree-v3 discard-and-rebuild without raw-body duplication or derived-cache migration;
- durable per-provider-step successful-request consumption and protection after cancel/failure/overflow;
- sequential and parallel LCM recovery-tool results entering source lineage, becoming eligible after a later
  successful provider step, and remaining unconsumed after a failed later step;
- successful queued handoff records consumption and closes as `superseded`, while upstream steering runs before a
  dismissed blocking question resumes;
- 15%-clamped exact tail plus explicit override;
- incremental one-quantum soft work, stable projection, multi-level hard convergence, and deterministic strict
  compression;
- optimistic provider overlap, observed single-flight blocking, fair session quanta, and hard/manual priority;
- irreducible constrained state and fail-closed `lcm_hard_limit_unresolved`;
- no legacy threshold preflight or post-success automatic compaction scheduling in enabled LCM flow for every
  `compaction.auto`/`threshold_percent` combination;
- the processor retaining its upstream `compact | stop | continue` result protocol in both modes, with provider
  overflow maintenance selecting the new exact-lineage revision, a locally verified smaller one-shot retry,
  and rejection before an identical retry can be sent;
- explicit unknown-capacity status/activity/manual behavior plus persisted custom-model context/output limits;
- VS Code, `/compact`, TUI, remote, HTTP, and SDK manual affordances invoke exactly one LCM cycle without a transcript
  summary when enabled and the upstream legacy cycle when disabled;
- all five real tool handlers, cancellation/cursors/current-session isolation, reachable `active`, direct `frontier`,
  and one-call cited `lcm_expand_query` recovery;
- substantive, exact-lineage summary citations with rejection of missing, invented, stale, or content-free handles,
  while deterministic reduction still converges over recovery-tool output containing cross-references;
- coherent enabled status lane/phase/frame fields including the protected recent-consumed/unconsumed split, disabled
  typed 409 responses, conditional UI/tool/TUI surfaces,
  reopened-session actions, frontier-only timeline events, export redaction/hashes, and generated contract stability;
- unchanged v7.4.23 remote, Project Memory, structured output, request identity, skill, first-response-byte timeout,
  JSONC, and SQLite behavior outside the deliberate seams;
- the v7.4.23 prompt tool-service environment, GPT-5.6 OAuth capacity, raw SQLite WAL recovery, Ask-to-Code reminder,
  and TUI created-time chronology remain upstream-owned and reach LCM through the ordinary host paths; and
- the v7.4.23 read-only permission baseline treats all five recovery tools as safe ordinary tools while explicit user
  denies still win, and removed agent-requirement and SWE-Pruner surfaces remain absent.

An LCM fault below the hard limit preserves the upstream request. At hard pressure it may not fall through to an
oversized provider request or legacy compaction. Packaged verification runs against extracted CLI/VSIX artifacts from
the exact candidate SHA and confirms the absence of PGlite/maps assets.
