# Verification and upstream compatibility

Status: normative v7.4.16 acceptance contract.

Focused gates remain `lcm:store`, `lcm:tree`, `lcm:projection`, `lcm:tools`, `lcm:api`, `lcm:export`,
`lcm:upstream-compat`, `lcm:long-context`, `lcm:packaged-smoke`, VS Code `lcm:ui`, `lcm:contracts:check`, and
`lcm:docs:check`. Never substitute the repository-root test command.

Acceptance must prove:

- newest-first stream normalization and stable chronology for new, legacy, imported, and 100+ source sessions;
- schema-v5/tree-v2 discard-and-rebuild without raw-body duplication;
- durable successful-request consumption and protection after cancel/failure/overflow;
- 15%-clamped exact tail plus explicit override;
- incremental one-quantum soft work, stable projection, multi-level hard convergence, and deterministic strict
  compression;
- optimistic provider overlap, observed single-flight blocking, fair session quanta, and hard/manual priority;
- irreducible constrained state and fail-closed `lcm_hard_limit_unresolved`;
- no legacy automatic compaction scheduling in normal product flow;
- VS Code, `/compact`, TUI, remote, HTTP, and SDK manual affordances each invoke exactly one LCM cycle and create no
  compaction/summary transcript turn;
- all four real tool handlers, cancellation/cursors/current-session isolation, reachable `active`, and direct
  `frontier`;
- status lane/phase fields, UI rendering, events, export redaction/hashes, and generated contract stability; and
- unchanged v7.4.16 queue, remote, Project Memory, permissions, structured output, request identity, skill, timeout,
  JSONC, and SQLite behavior outside the deliberate seams.

An LCM fault below the hard limit preserves the upstream request. At hard pressure it may not fall through to an
oversized provider request or legacy compaction. Packaged verification runs against extracted CLI/VSIX artifacts from
the exact candidate SHA and confirms the absence of PGlite/maps assets.
