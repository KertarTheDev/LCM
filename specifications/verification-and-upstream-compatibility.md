# Verification and upstream compatibility

Status: normative v7.5.9 acceptance contract.

Focused gates remain `lcm:store`, `lcm:tree`, `lcm:projection`, `lcm:tools`, `lcm:api`, `lcm:export`,
`lcm:upstream-compat`, `lcm:long-context`, `lcm:packaged-smoke`, VS Code `lcm:ui`, `lcm:contracts:check`, and
`lcm:docs:check`. Never substitute the repository-root test command.

Acceptance must prove:

- absent/`true` default-on feature resolution, explicit-`false` opt-out, and invalid non-boolean rejection;
- disabled mode matches upstream v7.5.9 automatic, provider-overflow, `compaction.auto=false`, threshold, current-tool
  preflight deferral, and manual compaction behavior;
- disabled prompt, idle, deletion, API, CLI, and tool paths neither create nor mutate a sidecar, while re-enable
  reuses or rebuilds retained state;
- newest-first stream normalization and stable chronology for new, legacy, imported, and 100+ source sessions;
- schema-v14/tree-v11 discard-and-rebuild of earlier derived caches without raw-body duplication or semantic migration;
- durable per-provider-step successful-request consumption, proof-based recovery after an unconsumed retry-suffix
  replacement, and protection after cancel/failure/overflow;
- bounded `lcm_query` results entering the parent source lineage, becoming eligible after a later successful provider
  step, and remaining unconsumed after a failed later step, while isolated child prompts and primitive outputs never
  enter that parent lineage;
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
- one ordinary model-facing `lcm_query`, five hidden child-only primitive handlers, parent cancellation and child-cost
  propagation, trusted parent-session and exact-question binding, current-lineage/prior-turn isolation, exact
  structured-output capture, host-prefetched frontier-first candidate admission with recovery-balanced byte depth in a
  one-third/32,000-token initial envelope, focused-question passage placement distinct from broader-request candidate
  disambiguation, honest truncation whenever any in-scope record is omitted, up to 64 diverse per-record windows with
  merged-window budget refill, explicit-handle priority, label-aware serialization, and separately bounded later tool
  results, atomically configured private semantic inference over selected excerpts with deterministic clipped-scope
  fallback, direct structured reconciliation by the same evidence-bearing hidden child including terminal submissions
  persisted after a returned tool-transition message, bounded answer/gap normalization, missing-partial-gap repair,
  invalid-optional-citation omission, plus repair-only reconciliation
  in a fresh tool-free hidden finalizer session that receives only the exact focused question and a 65,536-character
  cumulative ledger fairly retaining a 32,768-character initial selected-evidence digest and completed primitive
  outputs without silently losing supported list items, bounded current-user-request
  disambiguation that never becomes a second assignment, configurable host-enforced evidence-acquisition step,
  primitive-call, semantic-inference, repair, and phase-time budgets with unchanged conservative defaults, a separately
  timed tool-free synthesis step in the same hidden transcript with structured output required instead of uninterpreted tool
  output, including after recoverable structured-output or output-length failure, and no contradictory ordinary
  last-step reminder, cancellation, cost propagation, and
  non-duplicated provider/token/cache accounting across every started hidden session and nested semantic inference,
  including finalized error metadata after cancellation, a
  repair-only tool-free structured finalizer with bounded configured attempts and an optional final no-tool
  answer-first fallback, a 1,024-character direct-answer bound, citation-backed
  parent conflict guidance, safe omission/downgrade for invalid optional citations, an independent finalization phase
  shared by primary synthesis and repair, a complete-child deadline with a distinct cleanup reserve, deterministic
  strict parent settlement even when interrupted cleanup remains slow, deterministic parallel reservations,
  phase-specific deadline observability with the legacy aggregate signal, and zero to six
  host-verified 512-byte UTF-8
  citations; multi-unit exact-scope decomposition, complete single-unit semantic recovery, and first/last/both-edge
  excerpt retention; supplemental parent synthesis that preserves independently supported projected-context facts when a
  bounded child result is partial or empty; a configurable parent-turn cap including deterministic parallel
  reservations, a no-child completed exhaustion sentinel for stale or repeated provider calls, an answer-directed
  transition after the configured number of real queries, one executable sentinel fallback when a provider ignores
  `toolChoice: none`, and exactly one subsequent genuinely tool-free answer
  step when that fallback is used, including a hard one-attempt bound for malformed fallback calls;
  no raw primitive result or finalizer transcript may enter the parent transcript;
- hidden primitive cancellation/cursors, reachable `active`, direct `frontier`,
  compact nonduplicated grep previews with separate raw/summary totals and actionable regex guidance,
  packaged regex-worker availability, distinct startup/timeout/syntax failures, exact source byte-interval search,
  copy-ready final occurrence pages, unbounded transport-source warnings, chronological non-receipt neighbors,
  prior-identical-call diagnostics, current-turn exact-recovery escalation guidance without a hard call cap,
  page-size-independent continuation, cursor-bound read end offsets, ordered multi-source-range exact grep with
  deduplicated source totals, and configured-inference cited `lcm_expand_query` recovery with one transient-provider
  retry, exact ordered source-range scopes, a fixed-budget mixture of chronological and relevance-ranked excerpts,
  per-term match fairness, active-frontier sampling without lexical overlap, non-wasteful merged-window expansion,
  honest coverage after retrieval clipping or candidate-cap omission,
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
- unchanged v7.5.9 remote, Project Memory, structured output, request identity, skill, first-response-byte timeout,
  JSONC, and SQLite behavior outside the deliberate seams;
- the upstream compaction-model selector remains visible while LCM is enabled and selects the hidden compaction agent
  model used for LCM transformations; ordinary and hidden calls retain upstream reasoning-only incomplete-response
  repair and output-token caps;
- per-user editor context and its creation time remain protected through final projection for provider-cache stability,
  while session drain, cancellation, background-job settlement, disabled-mode compaction replay, and synthetic empty
  task results retain the v7.5.9 lifecycle;
- the v7.5.9 prompt tool-service environment, GPT-5.6 OAuth capacity, raw SQLite WAL recovery, Ask-to-Code reminder,
  and TUI created-time chronology remain upstream-owned and reach LCM through the ordinary host paths; and
- the v7.5.9 read-only permission baseline exposes only `lcm_query` to ordinary agents while explicit user denies still
  win, locks the hidden recovery agent to only its five private primitives, and keeps removed agent-requirement and
  SWE-Pruner surfaces absent.

An LCM fault below the hard limit preserves the upstream request. At hard pressure it may not fall through to an
oversized provider request or legacy compaction. Packaged verification runs against extracted CLI/VSIX artifacts from
the exact candidate SHA and confirms the absence of PGlite/maps assets.
