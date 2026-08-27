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
- schema-v14/tree-v11 discard-and-rebuild of earlier derived caches without raw-body duplication or semantic migration;
- durable per-provider-step successful-request consumption, proof-based recovery after an unconsumed retry-suffix
  replacement, and protection after cancel/failure/overflow;
- sequential and parallel LCM recovery-tool results entering source lineage, becoming eligible after a later
  successful provider step, and remaining unconsumed after a failed later step;
- successful queued handoff records consumption and closes as `superseded`, while upstream steering runs before a
  dismissed blocking question resumes;
- 15%-clamped exact tail plus explicit override;
- incremental one-call soft quanta that leave raw history unchanged, apply bounded retry delay after model failure,
  use a non-reasoning transformation variant when available, and immediately release aborted queued model work;
  stable projection, multi-level hard convergence, and deterministic strict compression;
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
  compact nonduplicated grep previews with separate raw/summary totals and actionable regex guidance,
  packaged regex-worker availability, distinct startup/timeout/syntax failures, exact source byte-interval search,
  copy-ready final occurrence pages, unbounded transport-source warnings, chronological non-receipt neighbors,
  prior-identical-call diagnostics, current-turn exact-recovery escalation guidance without a hard call cap,
  page-size-independent continuation, cursor-bound read end offsets, ordered multi-source-range exact grep with
  deduplicated source totals, and one-logical-inference cited `lcm_expand_query` recovery with one transient-provider
  retry, exact ordered source-range scopes, a fixed-budget mixture of chronological and relevance-ranked excerpts,
  per-term match fairness, active-frontier sampling without lexical overlap, honest coverage after retrieval clipping,
  explicit relevant/selected/truncation reporting, and fallback;
- substantive, grounded exact-lineage summary citations, deterministic direct-child citation completion when otherwise
  useful output omits handles, receipt-body omission with preserved lineage, an authoritative handle allowlist, and
  rejection of invented, stale, protocol-only, protocol-contaminated, answer-wrapped, ungrounded, content-free, or
  non-`stop`/length-truncated model output; request-specific quoted source-data isolation, provisional treatment of
  in-progress hypotheses, event-status and nested-reference-goal preservation, pre-model removal of out-of-lineage
  historical handle references, fair full-body extractive fallback, and transformation caps enforced through the model
  rather than provider options;
  preservation of structural boundary/completeness evidence for reference data, an explicit lossy-summary recovery
  warning for exhaustive questions, a deterministic ordered boundary map with half-open UTF-8 byte ranges from every
  consumed exact source including
  the protected recent tail but excluding the current unconsumed turn,
  compact unscoped grep discovery with exact source-scoped paging, compact suppression of exact repeated grep/read
  payloads, and deterministic reduction over recovery-tool output containing cross-references;
- coherent enabled status lane/phase/frame fields including the protected recent-consumed/unconsumed split, disabled
  typed 409 responses, conditional UI/tool/TUI surfaces,
  reopened-session actions, frontier-only timeline events, export redaction/hashes plus sanitized summary-attempt
  provenance, and generated contract stability;
- unchanged v7.4.23 remote, Project Memory, structured output, request identity, skill, first-response-byte timeout,
  JSONC, and SQLite behavior outside the deliberate seams;
- the v7.4.23 prompt tool-service environment, GPT-5.6 OAuth capacity, raw SQLite WAL recovery, Ask-to-Code reminder,
  and TUI created-time chronology remain upstream-owned and reach LCM through the ordinary host paths; and
- the v7.4.23 read-only permission baseline treats all five recovery tools as safe ordinary tools while explicit user
  denies still win, and removed agent-requirement and SWE-Pruner surfaces remain absent.

An LCM fault below the hard limit preserves the upstream request. At hard pressure it may not fall through to an
oversized provider request or legacy compaction. Packaged verification runs against extracted CLI/VSIX artifacts from
the exact candidate SHA and confirms the absence of PGlite/maps assets.
