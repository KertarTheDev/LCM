# Product contract

Status: normative v7.5.15 LCM contract.

Conversation Memory lets a Kilo session continue through repeated context pressure without rewriting the Kilo
transcript or silently discarding binding detail. It incrementally represents consumed finalized history as an
immutable summary tree. Exact source content remains recoverable from the retained Kilo SQLite conversation.

`experimental.conversation_memory` is the product gate. It currently defaults to `true`; only explicit `false`
disables LCM. The default is centralized so a later upstream pull request can make the feature opt-in without
changing either mode's behavior.

When disabled, Kilo uses the upstream v7.5.15 automatic, provider-overflow, and manual compaction paths, including
deferring threshold preflight while the current turn already contains a tool result. LCM performs
no projection, indexing, maintenance, model, tool, event, or sidecar work. An existing derived sidecar is preserved
unchanged and may be reused or rebuilt after re-enabling. When oversized legacy compaction uses temporary chunk and
reduction workers, their complete provider usage and cost are accumulated into the one retained summary message before
those temporary messages are removed.

When enabled, the active request has four conceptual lanes:

- stable summary roots;
- eligible consumed raw backlog;
- protected raw history (unconsumed current work plus the exact recent tail); and
- fixed upstream input such as system prompts and tool schemas.

Only the two raw-history lanes drive soft pressure. Summary roots and fixed upstream input do not repeatedly trigger
soft work. A source already covered by an active summary root is in the summary lane, not the raw backlog. The
complete final provider request still drives hard-limit safety.

A user turn may contain many provider steps separated by tool calls. Each successful parent provider step advances
durable consumption through the exact finalized sources it received, including bounded `lcm_query` results; one tool
call is not a separate user turn, and LCM does not wait for the whole turn to end. A failed or interrupted next step
leaves those new sources unconsumed. Isolated recovery prompts and primitive outputs belong to a separate child
session and never enter the parent lineage.

`conversation_memory.soft_threshold_percent` configures soft pressure and the hard-reset target. It defaults to 60%.
The exact recent tail defaults to 15% of usable input, clamped to 2,000–20,000 tokens;
`compaction.preserve_recent_tokens` is the explicit override. While LCM is enabled, `compaction.auto` controls only
the retained legacy subsystem and does not disable Conversation Memory. While LCM is disabled,
`compaction.auto` and `compaction.threshold_percent` regain their upstream meanings.

Advanced `conversation_memory.recovery.*` settings configure only isolated-worker resource budgets: parent queries per
turn, research provider steps, primitive calls, private semantic inferences, repair attempts, and phase timeouts. Their
defaults remain two, one, two, one, two, and 540/600/60 seconds respectively. Zero is supported for query, primitive,
semantic-inference, and repair allowances; a zero query allowance removes `lcm_query` without changing ordinary-agent
tool behavior. These settings never expose child-only tools, transcripts, or exact evidence to the parent and do not
relax the fixed bounded-answer and citation protocol. Independently of those configurable ceilings, two consecutive
schema-invalid private primitive calls end the research phase and hand its retained transcript to the bounded
tool-free finalizer. This circuit breaker prevents malformed provider output from consuming a deliberately generous
research budget and never guesses repaired semantic arguments.

Provider capacity is required for pressure and maintenance. Custom-provider models therefore persist positive context
and output token limits (plus an optional separate input limit). Missing capacity is reported as
`lcm_capacity_unknown` in status/activity and manual or hard maintenance stops explicitly instead of silently doing
nothing. Ordinary provider execution remains available below a known hard limit.

Conversation Memory begins a soft quantum as soon as raw pressure reaches the threshold. Work may overlap ordinary
agent activity. If a provider rejects concurrent work, that provider/model is treated as single-flight for the
process: maintenance becomes a barrier before the same session's next model request. One model call is dispatched per
soft quantum and sessions receive fair opportunities between quanta.

Hard maintenance runs when the complete outgoing request reaches usable input or after a provider overflow. It first
summarizes eligible raw backlog, then promotes complete active frontier levels until LCM-owned context reaches the
configured soft target when feasible. One stricter retry is allowed after a provider overflow only when maintenance
advanced the exact lineage and local measurement proves that the replacement request is smaller. The retry bypasses
the ordinary continuation pin and uses that new active revision. If no smaller request exists, or irreducible fixed or
protected input still cannot fit, the request fails closed with `lcm_hard_limit_unresolved`; legacy compaction is not
used as fallback.

Manual compaction buttons, `/compact`, TUI/remote commands, HTTP routes, and SDK responses remain compatible
affordances. With LCM enabled they request one forced full LCM maintenance cycle, create no compaction control part or
synthetic assistant summary message, and succeed as an observable no-op when nothing is eligible. With LCM disabled
they use upstream legacy manual compaction and its transcript summary turn.

Kilo continues to own prompts, tools, permissions, Project Memory, editor/media context, queues, remote sessions,
structured output, provider requests, retries, and timeouts. Conversation Memory never changes those lanes or creates
a second provider protocol. Legacy compaction remains compiled for upstream compatibility, including its own
percentage preflight and post-response scheduling, but those checks are unreachable from normal Conversation Memory
automatic and manual product flows.

The upstream compaction-model preference remains available while LCM is enabled because LCM transformations use that
same hidden compaction agent and its configured model. Upstream response completion repair, output-token caps,
editor-context cache stability, and session drain/cancellation lifecycle also remain on the ordinary provider path and
therefore apply to LCM-managed sessions without a parallel implementation.

When enabled, the supported ordinary model-facing recovery surface is exactly `lcm_query`. It creates a hidden,
read-only child session bound by trusted metadata to the calling parent and returns only a concise structured answer,
coverage, unresolved gaps, and at most six host-verified exact excerpts of at most 512 bytes each. The child privately
uses `lcm_grep`, `lcm_describe`, `lcm_expand_query`, `lcm_expand`, and `lcm_read`; those primitives and their outputs are
not exposed to the parent agent. Because both hidden recovery phases have no workspace-mutating tools, they skip
Kilo's workspace snapshot scan; ordinary sessions retain upstream snapshot and undo behavior. While global LCM stays
enabled and continues to keep legacy compaction unreachable, both hidden phases also bypass LCM capture, projection,
summary maintenance, and stale-tool payload pruning for their own short-lived transcripts. Their exact private research
therefore retains the parent-bound source namespace used by the recovery primitives. A hidden transcript that reaches
the provider limit fails that phase instead of compacting or projecting a child-owned memory frontier; the recovery
orchestrator may still use its bounded host-captured ledger in the separate finalizer. Trusted metadata retains
the parent's exact focused recovery question as semantic authority and the bounded current user task as context only.
The first question may recover a prerequisite not named in that task. Admission does not compare the first question's
vocabulary or criteria with the task. Retrieval ranking, structural selection, private inference, and citation
relevance use the focused question; evidence and nested tool arguments cannot rewrite it. Each question is independently admitted within the configured budget.
Subject to
the configured private semantic-inference allowance, unscoped,
summary-scoped, and complete single-unit exact `lcm_expand_query` calls may synthesize over selected excerpts. A
complete host-verified unit may use its complete exact ranges even when the preliminary evidence view is clipped; an
exact scope not proven to be one complete unit returns deterministic evidence when clipped. Clipped multi-unit
structural scopes are queried independently per exact unit before bounded aggregation. A copied single-unit
marker-inclusive `exactEnvelope` is recognized as the same trusted unit and canonicalized to its marker-interior
content ranges before private semantic inference. For a child scope that exactly matches a host-paired unit, the
private semantic inference receives that trusted unit index, treats every supplied range as a transport fragment of
that same unit, and answers the original semantic request once for the complete unit. A trusted system-level
cardinality contract makes that exactly one resolved unit value even when the original request asks for a cross-unit
list. For a long complete
unit and a first/last or bounded Nth-from-start/from-end request, a sufficiently large configured allowance may
atomically fund
dynamically sized chronological excerpt-only shard inferences targeting at most 20,000 UTF-8 bytes each plus one
bounded reducer; an edge shard returns up to three directionally ordered local proposals nearest the requested edge,
while an ordinal shard returns at most N ordered local events. The edge shortlist preserves a nearby alternative when
one semantically invalid late proposal would otherwise hide the qualifying event. The
host then runs one blind complete exact-unit audit without exposing the shard map or tentative reduction to that
independent pass. The child receives the bounded selected unit result and, when reducer and auditor disagree, both
bounded `independentCandidates` for reconciliation; raw intermediate contexts still remain private. A structurally
incomplete reducer or auditor may still contribute a host-verified exact quote as provisional private evidence without
becoming complete. If the reducer has no valid quoted proposal, the host-ordered shard aggregate and a valid auditor
result remain bounded disagreement candidates rather than losing either pass. More generally, reducer/auditor
disagreement returns the deterministic host-ordered shard aggregate as the partial top-level candidate when available
and retains every distinct bounded shard, reducer, and audit proposal for child reconciliation. This preference is
host-positional rather than model-semantic and cannot establish full coverage. Every nested call counts toward its
semantic budget and usage metrics. The host validates every successful shard result's schema, citation, exact quote,
and byte position before
reduction. If a shard has no valid structured result, the reducer instead receives that one host-bounded exact raw
shard as private fallback evidence so a formatting, incomplete-response, or provider failure cannot erase its source
bytes; this validation does not certify the proposal's subject, action, or event status, which the reducer must reapply
from its quote. Its failed status still prevents full coverage. When spare configured semantic allowance leaves two
calls available for reducer/auditor repair, LCM first retries malformed primary shards once at their original bounded
size because they otherwise have no local proposal set. Remaining allowance may replace the earliest
unconfirmed-negative or partial-positive primary shard encountered through the provisional requested ordinal with two
exact chronological repair segments. When no earlier uncertain shard exists, the first one beyond the provisional
target is one bounded sentinel against false-positive event proposals. The primary response is not supplied to those
independent scans because it cannot prove exhaustive local event coverage. The repair segments replace the primary
shard only as the non-overlapping reduction topology. Host-validated primary event proposals remain additive: each is
placed into the exact repair segment containing its source position, merged with independently verified segment events,
and deduplicated only when normalized values have overlapping exact quotes. An invalid segment can therefore carry a
retained primary event and its own smaller exact fallback while its failed status still prevents full coverage. The
unmodified primary and repair proposals also remain available as bounded private reconciliation evidence using their
already verified shard-local byte positions, without trying to resolve a repeated quote globally again. Repair is one
level, fully metered, and never weakens the reserved reducer/auditor or host validation.
After the reserved reducer and auditor both finish, LCM may also claim one remaining configured semantic slot per
invalid pass and retry each invalid pass once. The claim is atomic across the invalid set, so two failed passes are not
reduced to one-sided validation when only one slot remains. Each retry receives the unchanged authoritative question
and exact evidence plus a bounded host rejection category, never the rejected model output. It is fully metered,
non-recursive, and subject to the same host verification; evidence verified from either attempt may remain partial,
while only a valid selected replacement can participate in complete-coverage agreement. Complete unit
coverage requires every shard, the reducer, and the exact-unit
auditor to complete and validate, and also requires the host-ordered shard aggregate, reducer, and auditor to return
the same normalized answer with shared source provenance. A disagreement from any of those three independent views
remains partial even when the reducer and auditor both claim full coverage.
Reducer and audit prompts require one scalar event value, while an ordinal shard may return only its bounded local
list. Every event requires exact actor/entity attribution and an exact event quote rather than a nearby mention; an
otherwise nonconforming multi-value answer remains only a provisional disagreement candidate. For directional
reconciliation, the host combines primary, repair-segment, reducer, and auditor event proposals plus each pass's
separately host-verified scalar-answer evidence and orders them globally from the requested edge before applying the
child-visible bound, so a later or earlier qualifying event is not discarded merely because a model listed several
provisional events in the wrong answer shape. Scalar evidence is reconciliation material only and cannot replace the
required event map or certify coverage. Candidate neighborhoods that overlap are coalesced only when one exact
UTF-8-safe interval of at most 512 bytes retains every quoted span; their original proposal positions remain available
for ordinal-boundary selection, while disjoint or too-wide evidence remains separate.
The latest host-tracked semantic result for each exact structural unit also bounds the child's aggregate coverage. If
clipped initial evidence leaves a non-empty exact unit without a scoped semantic result, that unit starts incomplete;
lexical grep/read calls may locate evidence but cannot certify its boundary. If any requested unit still has partial,
conflicting, absent, or incomplete semantic coverage, a child submission claiming
`full` receives one tool-free evidence-led review and remains host-downgraded to `partial` with the affected unit
indices named unless a later complete exact-unit result already superseded that gap. A narrow lexical miss or partial
read cannot silently promote the aggregate to full coverage. A private structural semantic inference repeats its
mode-specific response schema after the inert evidence boundary and authoritative question, maps each proposed event
value to its cited exact quote in a bounded structured record, and may propose at most 12 such records from cited raw
ranges for internal validation and reduction. The host retains only quotes of at most 256 UTF-8 bytes
that resolve to one unique occurrence in the cited selected range, orders the surviving records by exact source
position, and derives the requested ordinal itself rather than trusting the model's scalar answer or prose list. It
expands each
to an exact UTF-8-safe source neighborhood of at most 512 bytes, and exposes at most three bounded `candidateEvidence`
intervals only to the hidden recovery child. Complete ordinal work, or incomplete work without a known successor,
retains an ordinal beyond the third with its two immediately preceding candidates from the requested edge. Incomplete
hierarchical work with a successor instead brackets the uncertain ordinal boundary with the predecessor, nominal
target, and successor. Invalid, ambiguous, summary-based, or out-of-range quotes are discarded
without weakening answer validation. Successful shard output reaches the reducer only as host-verified quote data;
failed-shard fallback remains exact, bounded to that shard, and private to the reducer, and any proposed quote from it
must pass the same host verification before reaching the child. The child may use a
decisive candidate interval in its ordinary bounded final citations. For a first/last/Nth request, each interval also
carries a copy-ready `boundaryScope` containing every remaining range beyond that candidate toward the requested edge,
so one transport source cannot be mistaken for the semantic boundary. It separately carries an `inwardScope` spanning
the exact gap from that candidate toward the next child-visible candidate, or to the opposite unit edge when no next
candidate is visible. The former detects an omitted edge event; the latter lets the child reject a semantically false
candidate without skipping an unproposed replacement between candidates. Neither raw semantic output nor the candidate
ledger reaches the parent. A resolved semantic scope and active revision are reserved once per child; equivalent
sequential or parallel calls are suppressed without spending another semantic allowance or replacing the first
result's coverage, while a
final provider error or cancellation permits an exact retry if lifetime capacity remains. The default allowance of one
preserves the single-pass path. Nested semantic and initial child prompts place
nonce-bounded inert historical evidence before their repeated authoritative question or workflow, so embedded
transcript instructions cannot become the final active request; the result echoes the unit association so later
same-session or repair-only aggregation cannot mistake several candidates from one unit for answers to several units.
First/last passage selection retains the requested edge or both edges, while a bounded ordinal is evaluated from its
requested edge. A distinct
tool-free phase in that same hidden transcript produces the bounded result when research ends without one; it cannot
restore a primitive and must use structured output. Its request includes a fairly bounded cumulative candidate ledger
as an immediate synthesis view while retaining the complete hidden transcript. The ledger labels every completed
primitive with its tool and any host-tracked exact structural-unit index before fair excerpting, preserving unit
association even when the serialized result body is clipped. The host preserves an already-valid
bounded answer and deterministically downgrades full to partial coverage when clipped, conflicting, or incomplete
evidence leaves a tracked gap; it does not ask another model step to recreate that answer. If the authoritative
request is first/last, ordinal, count, exhaustive-list, or otherwise completeness-sensitive, the parent-facing result
mechanically withholds that polished partial candidate, retains partial coverage and named gaps, and may retain bounded
citations. Ordinary non-exhaustive partial answers remain visible. The host accepts
the newest persisted terminal submission even
when the prompt API returned the preceding tool transition, rejects an overlong answer for isolated rewriting, bounds
gap strings, supplies a missing partial-coverage gap, and drops invalid
optional citations without rejecting the remaining answer. If the evidence-bearing child
does not produce a usable structured result, a fresh tool-free repair child receives only the bounded original request,
focused question, and a bounded host-captured evidence ledger. The focused question remains authoritative in both hidden
sessions and controls structural selection and within-record passage placement; the original task is context only. Configured repair attempts use structured output
except that the last of two or
more attempts is a tool-free plain fallback and can return only a bounded partial uncited answer. The host omits
invalid optional citations rather than copying them or discarding an otherwise supported answer. Citation validation
proves source-byte identity and bounds plus a conservative question-aware lexical anchor to the answer, not semantic
entailment, ordering, or completeness; parent guidance preserves
independently supported active-context facts when reconciling cited claims. A parent user turn
may start at most two hidden queries. The advanced
`conversation_memory.recovery.max_queries_per_turn` setting changes this allowance; zero hides `lcm_query`.
Each question is an independent focused assignment. Full, partial, empty, or failed earlier recovery does not
invalidate a different question, and independent parallel calls reserve the shared allowance synchronously.
The parent owns task decomposition; no lexical guard compares question criteria with the task or with another query.
An identical normalized question never starts another child or consumes another child slot. Every settled query
invocation, including invalid arguments and duplicate receipts, counts toward an attempt ceiling of twice the
configured child allowance. Exhaustion returns a bounded no-child result and never removes ordinary tools, changes
upstream tool choice, terminates the parent turn, or widens raw-memory access.

A subsequent child may receive the preceding bounded parent-visible result as inert provisional context, never its
private transcript. That result supplies neither semantic authority nor coverage for the new question. Each child
researches its own assignment; an earlier exact scope may be used again when a distinct question needs it, while
equivalent semantic scopes remain single-flight within one child. A narrower question is useful for an unresolved
gap, but is not a mandatory host admission rule.

For exact, exhaustive, count, first/last/Nth, or ordering work, a partial result cannot be presented as exact unless
independently visible active context closes every named gap; otherwise the parent uses its narrower follow-up before
finalizing. The host enforces that distinction at the isolation boundary by returning an empty answer and
`candidateAnswerWithheld: true` for a completeness-sensitive partial result, rather than relying only on parent prompt
compliance. A hidden child may use one materially narrower host-provided boundary for semantic verification when a
lexical miss or a single-range read cannot exclude omitted or paraphrased events. The configured parent-turn allowance is synchronously
enforced before child creation. Disabled registries expose no LCM tool.
