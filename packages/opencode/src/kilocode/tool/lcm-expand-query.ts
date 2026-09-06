import { Database } from "@opencode-ai/core/database/database"
import { Buffer } from "node:buffer"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import {
  ConversationMemory,
  QUERY_EVIDENCE_PROPOSAL_LIMIT,
  STRUCTURAL_EDGE_EVENT_PROPOSAL_LIMIT,
  type QueryAnswerMode,
} from "@/kilocode/session/lcm/service"
import type { SourceKind } from "@/kilocode/session/lcm/types"
import { KiloCostPropagation } from "@/kilocode/session/cost-propagation"
import {
  exactStructuralAnchorOccurrences,
  pairedStructuralUnits,
  structuralBoundaryIdentity,
} from "@/kilocode/session/lcm/projector"
import {
  LCM_RECOVERY_AGENT,
  LCM_RECOVERY_FINALIZER_AGENT,
  LCM_RECOVERY_INITIAL_LEDGER_CHARS,
  lcmRecoveryBudgetStats,
  lcmRecoveryLimits,
  lcmRecoveryParentRequest,
  lcmRecoveryQuestion,
  lcmRecoveryRetrievalQuestion,
  lcmRecoverySemanticQuestion,
  releaseLcmRecoverySemanticScope,
  reserveLcmRecoverySemanticInferences,
  reserveLcmRecoverySemanticScope,
} from "@/kilocode/session/lcm/recovery-contract"
import {
  inertOutput,
  isolatedRecoveryPriorTurnCutoff,
  lcmMemorySessionID,
  LcmToolError,
  loadMemory,
  priorTurnSourceCutoff,
  requireIsolatedRecoverySource,
  requireIsolatedRecoverySummary,
  requireSummary,
  type MemoryView,
} from "./lcm-common"
import {
  LcmSourceRange,
  LcmSourceOrdinalSpan,
  LcmSourceSpan,
  resolveSourceOrdinalSpan,
  resolveSourceRanges,
  resolveSourceSpan,
  type ResolvedSourceRange,
} from "./lcm-source-range"

export { resolveSourceOrdinalSpan, resolveSourceRanges, resolveSourceSpan } from "./lcm-source-range"

const MIN_QUERY_EXCERPTS = 8
const MAX_QUERY_EXCERPTS = 32
const TARGET_QUERY_EXCERPT_CHARS = 1_000
const MAX_QUERY_ANSWER_TOKENS = 2_000
export const MAX_ISOLATED_QUERY_EVIDENCE_TOKENS = 16_000
export const MAX_ISOLATED_QUERY_PREFETCH_TOKENS = 32_000
const DEFAULT_QUERY_INPUT_BUDGET = 4_000
const UNSCOPED_QUERY_INPUT_RATIO = 0.2
const UNSCOPED_QUERY_INPUT_CAP = 16_000
const ISOLATED_QUERY_PREFETCH_INPUT_RATIO = 1 / 3
const EXACT_RANGE_QUERY_INPUT_RATIO = 2 / 3
const EXACT_RANGE_QUERY_INPUT_CAP = 64_000
const MAX_STRUCTURAL_RECOVERY_UNITS = 32
const SEMANTIC_UNIT_SHARD_TRIGGER_BYTES = 64_000
export const SEMANTIC_UNIT_SHARD_TARGET_BYTES = 20_000
export const SEMANTIC_SHARD_REPAIR_PARTS = 2
const SEMANTIC_PASS_REPAIR_HEADROOM = 2
const SEMANTIC_PASS_DIAGNOSTIC_ANSWER_CHARS = 256
const MAX_SEMANTIC_EVIDENCE_QUOTES = 3
const MAX_SEMANTIC_EVIDENCE_QUOTE_BYTES = 256
const MAX_SEMANTIC_EVIDENCE_WINDOW_BYTES = 512
const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Question about earlier content in the current session (1-4096 characters).",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description:
      "Optional active sum_ handle whose descendants bound the search. Mutually exclusive with every other scope.",
  }),
  sourceRanges: Schema.optional(Schema.Array(LcmSourceRange)).annotate({
    description:
      "Optional ordered semantic scope of 1-32 exact source byte ranges. Use the structural-anchor map: start after an opening marker, include chronological intermediate sources, and end before the matching closing marker. Mutually exclusive with summaryID.",
  }),
  sourceSpan: Schema.optional(LcmSourceSpan).annotate({
    description:
      "Optional inclusive chronological span from startSourceID through endSourceID, with optional endpoint byte bounds. Use it when the focused question already names the first and last src_ handles. Mutually exclusive with summaryID and sourceRanges.",
  }),
  sourceOrdinalSpan: Schema.optional(LcmSourceOrdinalSpan).annotate({
    description:
      "Optional inclusive chronological span using source ordinals from the structural map, with optional endpoint byte bounds. Use it when the focused question or hostStructuralScope supplies source numbers rather than src_ handles. Mutually exclusive with every other scope.",
  }),
  maxAnswerTokens: Schema.optional(Schema.Number).annotate({
    description:
      "Maximum generated answer or private research-evidence size in tokens. Generated synthesis is capped at 2000; deterministic isolated evidence is capped at 16000.",
  }),
})

const STOP_WORDS = new Set([
  "and",
  "about",
  "across",
  "after",
  "again",
  "answer",
  "character",
  "comma",
  "could",
  "did",
  "each",
  "earlier",
  "earliest",
  "final",
  "first",
  "from",
  "have",
  "into",
  "list",
  "last",
  "latest",
  "only",
  "return",
  "recent",
  "separated",
  "session",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
])

interface Candidate {
  key: string
  id: string
  kind: "source" | "summary"
  ordinal: number
  lastOrdinal: number
  text: string
  score: number
  priority?: number
  sourceKind?: SourceKind
  sourceRange?: ResolvedSourceRange
  summaryNavigation?: { level: number; childCount: number; firstOrdinal: number; lastOrdinal: number }
}

export interface QueryEvidenceQuote {
  citation: string
  quote: string
}

export interface QueryEventProposal extends QueryEvidenceQuote {
  value: string
}

export interface QueryAnswer {
  answer: string
  citations: string[]
  coverage: "full" | "partial" | "none"
  evidence?: QueryEvidenceQuote[]
  events?: QueryEventProposal[]
}

type QueryResponseRejection =
  | "missing_json_object"
  | "malformed_json"
  | "invalid_json_object"
  | "invalid_answer"
  | "invalid_citations"
  | "citation_out_of_scope"
  | "invalid_coverage"
  | "empty_answer"
  | "missing_citation"
  | "missing_structured_events"

type StructuralPassRepairReason =
  | QueryResponseRejection
  | "provider_error"
  | "incomplete_response"
  | "invalid_no_answer"
  | "invalid_response"

type StructuralShardRepairReason = "invalid_response" | "unconfirmed_none" | "unconfirmed_partial"

type QueryResponseParse =
  | { answer: QueryAnswer; rejection?: never }
  | { answer?: never; rejection: QueryResponseRejection }

type QuerySelectionPolicy = "complete_frontier" | "balanced_recovery"
type QueryDirection = "first" | "last" | "both"

type QueryMemoryView = Pick<MemoryView, "sources" | "summaries" | "children" | "content"> & {
  revision?: MemoryView["revision"]
}

function scope(summaryID: string, view: Pick<MemoryView, "children">) {
  const ids = new Set([summaryID])
  const visit = (id: string) => {
    for (const child of view.children.get(id) ?? []) {
      if (ids.has(child.id)) continue
      ids.add(child.id)
      if (child.kind === "summary") visit(child.id)
    }
  }
  visit(summaryID)
  return ids
}

export function queryParts(query: string) {
  const handles = [...new Set(query.match(/\b(?:src|sum)_[A-Za-z0-9_-]+\b/g) ?? [])]
  const terms = [
    ...new Set(
      query
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu)
        ?.filter((term) => !STOP_WORDS.has(term) && !term.startsWith("src_") && !term.startsWith("sum_")) ?? [],
    ),
  ]
  return { handles, terms }
}

export function queryDirection(query: string): QueryDirection | undefined {
  const normalized = query.normalize("NFKC").toLocaleLowerCase()
  const first = /\b(?:earliest|first|initial)\b/u.test(normalized)
  const last = /\b(?:final|last|latest|most\s+recent)\b/u.test(normalized)
  if (first && last) return "both"
  return first ? "first" : last ? "last" : undefined
}

const QUERY_ORDINAL_RANKS = new Map<string, number>([
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
  ["eleventh", 11],
  ["twelfth", 12],
])

export function queryOrdinalRank(query: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase()
  const matches = [
    ...normalized.matchAll(
      /(?:^|[^\p{L}\p{N}])(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th))(?=[^\p{L}\p{N}]|$)/gu,
    ),
  ].filter((match) => {
    if (match.index === undefined) return false
    const tail = normalized.slice(match.index + match[0].length, match.index + match[0].length + 80)
    // An ordering key describes how to sort events, not which event was requested.
    // Keep standalone requests for a first occurrence as genuine rank-one queries.
    const head = normalized.slice(0, match.index).trimEnd()
    if (/\b(?:order\s+of|by)$/u.test(head) && /^\s+(?:appearance|occurrence|mention)\b/u.test(tail)) return false
    return !/^\s*(?:(?:of\s+(?:the|these|those)\s+)|(?:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\s+){0,2})(?:\[(?:start|begin)\b|episodes?\b|transcripts?\b|documents?\b|sections?\b|units?\b|windows?\b|records?\b|chapters?\b|files?\b|parts?\b|blocks?\b|runs?\b)/u.test(
      tail,
    )
  })
  const word = matches.at(-1)?.[1]
  if (!word) return
  const named = QUERY_ORDINAL_RANKS.get(word)
  if (named !== undefined) return named
  const numeric = Number.parseInt(word, 10)
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= QUERY_EVIDENCE_PROPOSAL_LIMIT ? numeric : undefined
}

export function querySemanticOrder(query: string) {
  const rank = queryOrdinalRank(query) ?? 1
  if (rank > 1) {
    const normalized = query.normalize("NFKC").toLocaleLowerCase()
    const fromLast =
      /\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:nd|rd|th))(?:\s+from\s+(?:the\s+)?last|\s*-?to-?\s*(?:the\s+)?last|\s+(?:the\s+)?last)\b/u.test(
        normalized,
      )
    return { direction: fromLast ? ("last" as const) : ("first" as const), rank }
  }
  const direction = queryDirection(query)
  return direction === "first" || direction === "last" ? { direction, rank } : undefined
}

export function recoverySemanticScopeKey(input: {
  revisionID?: string
  summaryID?: string
  sourceRanges?: readonly Pick<ResolvedSourceRange, "sourceID" | "startOffset" | "endOffset">[]
  semanticUnitIndex?: number
  direction?: "first" | "last"
  rank: number
}) {
  const scope = input.sourceRanges
    ? ["ranges", ...input.sourceRanges.map((range) => [range.sourceID, range.startOffset, range.endOffset] as const)]
    : input.summaryID
      ? ["summary", input.summaryID]
      : ["unscoped"]
  return JSON.stringify([
    input.revisionID ?? null,
    scope,
    input.semanticUnitIndex ?? null,
    input.direction ?? null,
    input.rank,
  ])
}

function bookends(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  const marker = "\n[… omitted …]\n"
  if (maxChars <= marker.length + 2) return text.slice(0, maxChars)
  const available = maxChars - marker.length
  const head = Math.ceil(available / 2)
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (available - head))}`
}

function evenlySpaced<T>(items: readonly T[], limit: number) {
  if (items.length <= limit) return [...items]
  if (limit <= 0) return []
  if (limit === 1) return [items.at(-1)!]
  return Array.from({ length: limit }, (_, index) => items[Math.round((index * (items.length - 1)) / (limit - 1))]!)
}

const STRUCTURAL_QUESTION = /\b(?:between|boundary|boundaries|bounded|delimiter|delimited|inside|marked|within)\b/iu
const STRUCTURAL_UNIT_ORDINALS = new Map<string, number | "last">([
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
  ["last", "last"],
])

function structuralUnitOrdinal(query: string, openingMarker: string) {
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase()
  const normalizedMarker = openingMarker.normalize("NFKC").toLocaleLowerCase()
  const markerAt = normalizedQuery.indexOf(normalizedMarker)
  if (markerAt < 0) return
  const prefix = normalizedQuery.slice(Math.max(0, markerAt - 96), markerAt)
  const matches = [
    ...prefix.matchAll(
      /(?:^|[^\p{L}\p{N}])(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th))(?=[^\p{L}\p{N}]|$)/gu,
    ),
  ]
  const match = matches.at(-1)
  if (!match || match.index === undefined) return
  const tail = prefix.slice(match.index + match[0].length)
  if (tail.length > 64 || /\b(?:all|each|every)\b/iu.test(tail)) return
  const word = match[1]!
  const named = STRUCTURAL_UNIT_ORDINALS.get(word)
  if (named !== undefined) return named
  const numeric = Number.parseInt(word, 10)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined
}

function structuralUnitContentScope(
  view: Pick<QueryMemoryView, "sources" | "content">,
  unit: ReturnType<typeof pairedStructuralUnits>["units"][number],
) {
  const ranges = unit.sourceRanges.flatMap((range) => {
    const source = view.sources.get(range.sourceID)
    const content = view.content.get(range.sourceID)?.content
    if (!source || content === undefined) return []
    const totalBytes = Buffer.byteLength(content)
    const startOffset = range.startOffset ?? 0
    const endOffset = range.endOffset ?? totalBytes
    return endOffset > startOffset ? [{ ordinal: source.ordinal, startOffset, endOffset }] : []
  })
  const first = ranges[0]
  const last = ranges.at(-1)
  if (!first || !last) return null
  return {
    sourceOrdinalSpan: {
      startOrdinal: first.ordinal,
      endOrdinal: last.ordinal,
      startOffset: first.startOffset,
      endOffset: last.endOffset,
    },
  }
}

export function structuralRecoveryScope(
  view: Pick<QueryMemoryView, "sources" | "content">,
  query: string,
  maxOrdinal: number,
) {
  const sources = [...view.sources.values()]
    .filter((source) => source.ordinal <= maxOrdinal)
    .toSorted((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
  const anchors = sources.flatMap((source) =>
    exactStructuralAnchorOccurrences(view.content.get(source.id)?.content ?? "").map((anchor) => ({
      sourceID: source.id,
      ordinal: source.ordinal,
      ...anchor,
    })),
  )
  if (anchors.length === 0) return
  const paired = pairedStructuralUnits({
    anchors,
    total: anchors.length,
    sources: sources.map((source) => ({ sourceID: source.id, ordinal: source.ordinal })),
  })
  if (paired.units.length === 0) return

  const queryTerms = new Set(queryParts(query).terms)
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase()
  const keyed = paired.units.flatMap((unit) => {
    const boundary = structuralBoundaryIdentity(unit.opening.marker)
    return boundary ? [{ unit, key: boundary.key }] : []
  })
  const scored = keyed.map(({ unit, key }) => {
    const keyTerms = queryParts(key).terms
    const exactKey = key.length >= 2 && key !== "unlabelled-unit" && normalizedQuery.includes(key)
    const score =
      keyTerms.reduce((total, term) => total + (queryTerms.has(term) ? 1 : 0), 0) + (exactKey ? keyTerms.length + 1 : 0)
    return { unit, key, score }
  })
  const bestScore = Math.max(...scored.map(({ score }) => score))
  const matching = bestScore > 0 ? scored.filter(({ score }) => score === bestScore) : []
  const distinctKeys = new Set(keyed.map(({ key }) => key))
  const relevant =
    matching.length > 0 ? matching : STRUCTURAL_QUESTION.test(query) && distinctKeys.size === 1 ? keyed : []
  if (relevant.length === 0) return

  const ordered = relevant.toSorted(
    (left, right) =>
      left.unit.opening.ordinal - right.unit.opening.ordinal ||
      left.unit.opening.byteStart - right.unit.opening.byteStart ||
      left.unit.closing.ordinal - right.unit.closing.ordinal ||
      left.unit.closing.byteEnd - right.unit.closing.byteEnd,
  )
  const indexedAll = ordered.map((value, index) => ({ ...value, matchedIndex: index + 1 }))
  const ordinal = indexedAll[0] ? structuralUnitOrdinal(query, indexedAll[0].unit.opening.marker) : undefined
  const indexed =
    ordinal === "last"
      ? indexedAll.slice(-1)
      : typeof ordinal === "number" && ordinal <= indexedAll.length
        ? indexedAll.slice(ordinal - 1, ordinal)
        : indexedAll
  const represented =
    indexed.length <= MAX_STRUCTURAL_RECOVERY_UNITS ? indexed : evenlySpaced(indexed, MAX_STRUCTURAL_RECOVERY_UNITS)
  const exactRangeInputs = indexed.flatMap(({ unit }) =>
    unit.sourceRanges.map((range, index) => ({
      ...range,
      ...(index === 0 ? { startOffset: unit.opening.byteStart } : {}),
      ...(index === unit.sourceRanges.length - 1 ? { endOffset: unit.closing.byteEnd } : {}),
    })),
  )
  let sourceRanges: ResolvedSourceRange[] | undefined
  let envelopeUnavailable: string | undefined
  try {
    sourceRanges = resolveSourceRanges(view, exactRangeInputs)
  } catch (error) {
    if (!(error instanceof LcmToolError)) throw error
    envelopeUnavailable = "The matching boundary envelope exceeds the bounded exact-source scope."
  }

  const index = {
    authority:
      "Host-derived exact prior-turn raw-source order. Summary labels and summary claims cannot redefine these boundaries.",
    matchedUnits: indexed.length,
    representedUnits: represented.length,
    truncated: represented.length < indexed.length,
    units: represented.map(({ unit, matchedIndex }) => ({
      index: matchedIndex,
      opening: {
        marker: unit.opening.marker,
        sourceID: unit.opening.sourceID,
        ordinal: unit.opening.ordinal,
        startOffset: unit.opening.byteStart,
        endOffset: unit.opening.byteEnd,
      },
      closing: {
        marker: unit.closing.marker,
        sourceID: unit.closing.sourceID,
        ordinal: unit.closing.ordinal,
        startOffset: unit.closing.byteStart,
        endOffset: unit.closing.byteEnd,
      },
      contentScope: structuralUnitContentScope(view, unit),
    })),
    exactEnvelope: sourceRanges
      ? {
          toolArguments: {
            sourceRanges: sourceRanges.map(({ sourceID, startOffset, endOffset }) => ({
              sourceID,
              startOffset,
              endOffset,
            })),
          },
          instruction:
            "For one question spanning these matched units, copy toolArguments into one scoped lcm_expand_query. The ordered ranges include each unit's boundary markers but exclude bytes between units, so the semantic pass can preserve unit order without contamination. Do not use an unscoped semantic query for this boundary-sensitive scope.",
        }
      : null,
    ...(envelopeUnavailable ? { envelopeUnavailable } : {}),
  }
  return { index, sourceRanges }
}

function sameResolvedScope(left: readonly ResolvedSourceRange[], right: readonly ResolvedSourceRange[]) {
  return (
    left.length === right.length &&
    left.every(
      (range, index) =>
        range.sourceID === right[index]?.sourceID &&
        range.startOffset === right[index]?.startOffset &&
        range.endOffset === right[index]?.endOffset,
    )
  )
}

export function trustedStructuralSemanticUnit(input: {
  view: Pick<QueryMemoryView, "sources" | "content">
  query: string
  maxOrdinal: number
  sourceRanges?: readonly ResolvedSourceRange[]
}) {
  if (!input.sourceRanges) return
  const structural = structuralRecoveryScope(input.view, input.query, input.maxOrdinal)
  if (!structural) return
  for (const unit of structural.index.units) {
    if (!unit.contentScope) continue
    try {
      const unitRanges = resolveSourceOrdinalSpan(input.view, unit.contentScope.sourceOrdinalSpan)
      const contentScopeMatches = sameResolvedScope(input.sourceRanges, unitRanges)
      const singleUnitEnvelopeMatches =
        structural.index.matchedUnits === 1 &&
        structural.sourceRanges !== undefined &&
        sameResolvedScope(input.sourceRanges, structural.sourceRanges)
      if (contentScopeMatches || singleUnitEnvelopeMatches)
        return {
          ...unit,
          matchedUnits: structural.index.matchedUnits,
          semanticRanges: unitRanges,
          semanticInferenceRequirement: structuralSemanticInferenceRequirement(input.view, structural),
        }
    } catch (error) {
      if (!(error instanceof LcmToolError)) throw error
    }
  }
}

function structuralSemanticInferenceRequirement(
  view: Pick<QueryMemoryView, "sources" | "content">,
  structural: NonNullable<ReturnType<typeof structuralRecoveryScope>>,
) {
  // A truncated structural index cannot prove that the configured allowance funds every matching unit.
  if (structural.index.truncated) return
  let total = 0
  for (const unit of structural.index.units) {
    if (!unit.contentScope) return
    let ranges: ResolvedSourceRange[]
    try {
      ranges = resolveSourceOrdinalSpan(view, unit.contentScope.sourceOrdinalSpan)
    } catch (error) {
      if (error instanceof LcmToolError) return
      throw error
    }
    total += semanticRangesInferenceCount(ranges)
  }
  return total
}

export function trustedStructuralSemanticQuestion(question: string, unitIndex: number) {
  return [
    question,
    `Trusted structural narrowing for this private inference: the supplied excerpts are exactly host-matched structural unit index ${unitIndex}. Every supplied source range is a consecutive transport fragment of this one semantic unit, not a separate document or unit. Answer the original request only for this one unit, applying every original semantic criterion. When the original asks for one value per unit, return exactly one resolved value for this unit after evaluating the complete supplied scope; do not return one value per source range. Return no values for any other unit; the hidden researcher owns ordered cross-unit aggregation.`,
  ].join("\n")
}

export function trustedStructuralShardQuestion(input: {
  question: string
  unitIndex: number
  shardIndex: number
  shardCount: number
  direction: "first" | "last"
  rank?: number
}) {
  const rank = Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank ?? 1)))
  return [
    input.question,
    `Trusted hierarchical narrowing: the supplied excerpts are chronological shard ${input.shardIndex} of ${input.shardCount} from host-matched structural unit index ${input.unitIndex}.`,
    rank === 1
      ? `Exhaustively scan this entire shard for qualifying events before returning a bounded shortlist of up to ${STRUCTURAL_EDGE_EVENT_PROPOSAL_LIMIT} plausible qualifying events nearest the ${input.direction === "first" ? "opening" : "closing"} edge, ordered from that edge inward. Do not decide the unit-level boundary here. After finding one candidate, continue scanning inward until you have ${STRUCTURAL_EDGE_EVENT_PROPOSAL_LIMIT} distinct plausible qualifying events or reach the opposite shard edge; retain alternatives even when one seems stronger. Put the strongest edge candidate first and set answer to that first value. Reapply every original subject, actor, action, scope, and event-status criterion to each exact quote. This shard cannot establish completeness for the whole unit, so use partial coverage for supported proposals and none when no qualifying event is supported.`
      : `Find up to the ${rank} ${input.direction === "first" ? "earliest" : "latest"} qualifying events in this shard and return them in the required events array in exact ${input.direction === "first" ? "chronological" : "reverse-chronological"} order. This bounded local list exists only so the reducer can resolve the requested ordinal; do not include more than ${rank} events. This shard cannot establish completeness for the whole unit, so use partial coverage when at least one event is supported and none when no qualifying event is supported.`,
  ].join("\n")
}

export function trustedStructuralShardRepairQuestion(input: {
  question: string
  unitIndex: number
  shardIndex: number
  shardCount: number
  repairIndex: number
  repairCount: number
  direction: "first" | "last"
  rank?: number
  reason?: StructuralShardRepairReason
}) {
  return [
    trustedStructuralShardQuestion(input),
    input.reason === "unconfirmed_none"
      ? `Bounded negative-shard verification: the primary shard reported no supported event, but that negative is only a navigation hint and could change the requested ordinal. The supplied excerpts are exact chronological verification segment ${input.repairIndex} of ${input.repairCount} for that shard. Independently re-scan only this smaller segment under the unchanged original criteria; the primary response is not supplied and conveys no evidence.`
      : input.reason === "unconfirmed_partial"
        ? `Bounded partial-shard completeness verification: the primary shard returned supported local events, but that partial result cannot prove that no additional qualifying event was omitted before or between them. Such an omission could change the requested ordinal. The supplied excerpts are exact chronological verification segment ${input.repairIndex} of ${input.repairCount} for that shard. Independently re-scan only this smaller segment under the unchanged original criteria; the primary response is not supplied and conveys no completeness evidence.`
        : `Bounded shard repair: the original shard response did not yield a valid structured result. The supplied excerpts are exact chronological repair segment ${input.repairIndex} of ${input.repairCount} for that shard. Resolve only this smaller segment under the unchanged original criteria; do not infer anything from the failed response.`,
  ].join("\n")
}

export function trustedStructuralReductionQuestion(input: {
  question: string
  unitIndex: number
  shardCount: number
  direction: "first" | "last"
  rank?: number
}) {
  const rank = Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank ?? 1)))
  return [
    trustedStructuralSemanticQuestion(input.question, input.unitIndex),
    rank === 1
      ? `Trusted hierarchical reduction: the supplied evidence contains bounded byte-verified but semantically untrusted local proposals from each of ${input.shardCount} chronological shards of this unit, in shard order. Reapply every original subject, actor, action, scope, and event-status criterion to each exact quote, discard every nonqualifying proposal, then resolve exactly one unit-level value by choosing the ${input.direction === "first" ? "earliest" : "latest"} remaining event. Return that event in the required events array. Do not concatenate shard candidates in answer. A proposal from another actor, or a later mention, recap, plan, rejected attempt, or continuation, must not suppress an earlier qualifying event.`
      : `Trusted hierarchical reduction: the supplied evidence contains up to ${rank} bounded local events from each of ${input.shardCount} chronological shards of this unit, in shard order. Preserve each local list's declared order and resolve exactly the ${rank}${rank === 2 ? "nd" : rank === 3 ? "rd" : "th"} qualifying event from the ${input.direction === "first" ? "opening" : "closing"} edge, scanning shard objects from that edge as well. Return the ordered ${input.direction === "first" ? "prefix" : "suffix"} through that event in the required events array. A mention, recap, plan, rejected attempt, or continuation is not a new event.`,
  ].join("\n")
}

export function trustedStructuralVerificationQuestion(input: {
  question: string
  unitIndex: number
  direction: "first" | "last"
  rank?: number
}) {
  const rank = Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank ?? 1)))
  return [
    trustedStructuralSemanticQuestion(input.question, input.unitIndex),
    `Trusted blind hierarchical audit: re-scan the supplied complete exact raw unit ${input.direction === "first" ? "from the opening toward the close" : "from the close toward the opening"}. No shard candidate or tentative reduction is supplied to this independent pass. Return the ${rank === 1 ? "one qualifying unit-level value" : `${rank}${rank === 2 ? "nd" : rank === 3 ? "rd" : "th"} qualifying unit-level value`} only after checking actual event status and every ${input.direction === "first" ? "earlier" : "later"} candidate. Include the ordered ${input.direction === "first" ? "prefix" : "suffix"} through that value in the required events array.`,
  ].join("\n")
}

export function trustedStructuralPassRepairQuestion(input: {
  question: string
  pass: "reduction" | "blind_audit"
  reason: StructuralPassRepairReason
}) {
  return [
    input.question,
    `Bounded ${input.pass === "reduction" ? "hierarchical reduction" : "blind hierarchical audit"} repair: the preceding attempt failed host validation (${input.reason}). That failed response is not supplied and conveys no evidence. Re-read the unchanged exact evidence, apply the unchanged original criteria, and return one fresh response in the required structured events format.`,
  ].join("\n")
}

export function hierarchicalSemanticPassRepairPlan(input: {
  reductionAccepted: boolean
  verificationAccepted: boolean
}) {
  return [
    ...(input.reductionAccepted ? [] : (["reduction"] as const)),
    ...(input.verificationAccepted ? [] : (["blind_audit"] as const)),
  ]
}

export function hierarchicalSemanticShardRepairPlan(input: {
  shards: readonly { parsed?: Pick<QueryAnswer, "coverage" | "events"> }[]
  direction: "first" | "last"
  rank: number
  availableInferences: number
  repairParts?: number
}) {
  const rank = Number.isFinite(input.rank)
    ? Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank)))
    : 1
  const requestedRepairParts = input.repairParts ?? SEMANTIC_SHARD_REPAIR_PARTS
  const repairParts = Number.isFinite(requestedRepairParts) ? Math.max(1, Math.floor(requestedRepairParts)) : 1
  const availableInferences = Number.isFinite(input.availableInferences)
    ? Math.max(0, Math.floor(input.availableInferences))
    : 0
  let remaining = Math.max(0, availableInferences - SEMANTIC_PASS_REPAIR_HEADROOM)
  if (remaining <= 0) return []
  const order = input.shards.map((_, index) => index)
  if (input.direction === "last") order.reverse()
  const result: { index: number; reason: StructuralShardRepairReason; parts: number }[] = []
  // A malformed response erases the only bounded proposal set for its shard. Retry it once at the same size before
  // spending optional calls subdividing semantically uncertain but structurally valid responses.
  for (const index of order) {
    if (input.shards[index]?.parsed || remaining < 1) continue
    result.push({ index, reason: "invalid_response", parts: 1 })
    remaining--
  }
  let verifiedEvents = 0
  for (const index of order) {
    const parsed = input.shards[index]?.parsed
    if (!parsed) continue
    let reason: StructuralShardRepairReason | undefined
    if (parsed.coverage === "none") reason = "unconfirmed_none"
    else {
      verifiedEvents += parsed.events?.length ?? 0
      if (parsed.coverage === "partial") reason = "unconfirmed_partial"
    }
    if (reason && remaining >= repairParts) {
      result.push({ index, reason, parts: repairParts })
      remaining -= repairParts
    }
    if (result.length > 0 && verifiedEvents >= rank) break
  }
  return result
}

function semanticShardEnd(buffer: Buffer, start: number, requestedEnd: number) {
  const requested = Math.min(buffer.byteLength, requestedEnd)
  let end = requested
  if (end < buffer.byteLength) {
    const newline = buffer.lastIndexOf(0x0a, end - 1)
    if (newline >= start && newline >= end - 1_024) end = newline + 1
    while (end > start && (buffer[end]! & 0xc0) === 0x80) end--
  }
  if (end > start) return end
  end = requested
  while (end < buffer.byteLength && (buffer[end]! & 0xc0) === 0x80) end++
  return end
}

function utf8SequenceBytes(byte: number) {
  if ((byte & 0x80) === 0) return 1
  if ((byte & 0xe0) === 0xc0) return 2
  if ((byte & 0xf0) === 0xe0) return 3
  if ((byte & 0xf8) === 0xf0) return 4
  return 1
}

export function semanticUnitShardCount(totalBytes: number, targetBytes = SEMANTIC_UNIT_SHARD_TARGET_BYTES) {
  if (!Number.isFinite(totalBytes) || !Number.isFinite(targetBytes) || targetBytes <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, totalBytes) / targetBytes))
}

export function semanticQueryShards(selected: readonly Candidate[], shardCount?: number) {
  const totalBytes = selected.reduce((total, item) => total + Buffer.byteLength(item.text), 0)
  const fixedCount = shardCount !== undefined
  const count = shardCount ?? semanticUnitShardCount(totalBytes)
  if (count <= 1 || selected.some((item) => !item.sourceRange)) return [selected.map((item) => ({ ...item }))]
  const targetBytes = fixedCount ? Math.max(1, Math.ceil(totalBytes / count)) : SEMANTIC_UNIT_SHARD_TARGET_BYTES
  const shards: Candidate[][] = []
  let current: Candidate[] = []
  let currentBytes = 0
  const finish = () => {
    if (current.length === 0) return
    shards.push(current)
    current = []
    currentBytes = 0
  }
  for (const item of selected) {
    const buffer = Buffer.from(item.text)
    let localStart = 0
    while (localStart < buffer.byteLength) {
      const finalShard = fixedCount && shards.length >= count - 1
      if (!finalShard && currentBytes > 0 && utf8SequenceBytes(buffer[localStart]!) > targetBytes - currentBytes) {
        finish()
        continue
      }
      const available = finalShard ? buffer.byteLength - localStart : Math.max(1, targetBytes - currentBytes)
      const localEnd = semanticShardEnd(buffer, localStart, localStart + available)
      const text = buffer.subarray(localStart, localEnd).toString("utf8")
      const sourceRange = item.sourceRange!
      current.push({
        ...item,
        key: `${item.key}:semantic-shard:${sourceRange.startOffset + localStart}-${sourceRange.startOffset + localEnd}`,
        text,
        sourceRange: {
          ...sourceRange,
          startOffset: sourceRange.startOffset + localStart,
          endOffset: sourceRange.startOffset + localEnd,
          text,
        },
      })
      currentBytes += localEnd - localStart
      localStart = localEnd
      if (!finalShard && currentBytes >= targetBytes) finish()
    }
  }
  finish()
  return shards
}

export function semanticRangeCandidates(sourceRanges: readonly ResolvedSourceRange[]) {
  return sourceRanges.map(
    (range, index): Candidate => ({
      key: `${index}:${range.sourceID}:${range.startOffset}-${range.endOffset}`,
      id: range.sourceID,
      kind: "source",
      ordinal: range.ordinal,
      lastOrdinal: range.ordinal,
      text: range.text,
      score: 1,
      sourceKind: range.sourceKind,
      sourceRange: range,
    }),
  )
}

export function hierarchicalSemanticPlan(input: {
  trustedStructuralUnit: boolean
  direction?: QueryDirection
  sourceRanges?: readonly ResolvedSourceRange[]
  selected: readonly Candidate[]
}) {
  if (!input.trustedStructuralUnit || (input.direction !== "first" && input.direction !== "last")) return
  const candidates = input.sourceRanges ? semanticRangeCandidates(input.sourceRanges) : [...input.selected]
  const bytes = candidates.reduce((total, item) => total + Buffer.byteLength(item.text), 0)
  if (bytes <= SEMANTIC_UNIT_SHARD_TRIGGER_BYTES) return
  const shards = semanticQueryShards(candidates)
  return shards.length > 1 ? { candidates, shards } : undefined
}

export function semanticRangesInferenceCount(ranges: readonly ResolvedSourceRange[]) {
  const bytes = ranges.reduce((total, range) => total + range.endOffset - range.startOffset, 0)
  if (bytes <= SEMANTIC_UNIT_SHARD_TRIGGER_BYTES) return 1
  const selected = semanticRangeCandidates(ranges)
  return hierarchicalSemanticInferenceCount(semanticQueryShards(selected).length)
}

export function hierarchicalSemanticInferenceCount(shardCount: number) {
  return shardCount + 2
}

export function semanticQueryExcerpts(selected: readonly Candidate[], scope: "unit" | "shard" | "unscoped" = "unit") {
  return [
    ...(scope === "unit"
      ? [
          "[Exact ordered source byte-range scope. Only the labeled half-open ranges belong to the requested semantic unit. Preserve range order; omission markers denote unseen in-scope text.]",
        ]
      : scope === "shard"
        ? [
            "[Exact chronological shard of one host-verified semantic unit. Only the labeled half-open ranges belong to this shard. Preserve range order.]",
          ]
        : []),
    ...selected.map((item) =>
      [
        item.sourceRange
          ? `[${item.id} | source | ${item.sourceKind ?? "unknown"} | ordinal ${item.ordinal} | bytes ${item.sourceRange.startOffset}-${item.sourceRange.endOffset}]`
          : `[${item.id} | ${item.kind}${item.sourceKind ? ` | ${item.sourceKind}` : ""} | ${
              item.ordinal === item.lastOrdinal
                ? `ordinal ${item.ordinal}`
                : `ordinals ${item.ordinal}-${item.lastOrdinal}`
            }]`,
        item.text,
      ].join("\n"),
    ),
  ].join("\n\n")
}

function boundedStructuralScope(structural: NonNullable<ReturnType<typeof structuralRecoveryScope>>, maxChars: number) {
  const available = Math.max(0, Math.floor(maxChars))
  for (let limit = structural.index.units.length; limit >= 0; limit--) {
    const units = evenlySpaced(structural.index.units, limit)
    const index = {
      ...structural.index,
      representedUnits: units.length,
      truncated: structural.index.truncated || units.length < structural.index.units.length,
      units,
    }
    const text = JSON.stringify({ hostStructuralScope: index }, null, 2)
    if (text.length <= available) return { index, text }
  }
}

function fairLengthLimits(lengths: readonly number[], maxChars: number) {
  const limits = Array.from({ length: lengths.length }, () => 0)
  let remaining = Math.max(0, Math.floor(maxChars))
  let unresolved = lengths.map((_, index) => index)
  while (unresolved.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / unresolved.length)
    const fitting = unresolved.filter((index) => lengths[index]! <= share)
    if (fitting.length === 0) {
      for (const [position, index] of unresolved.entries()) {
        const limit = Math.floor(remaining / (unresolved.length - position))
        limits[index] = limit
        remaining -= limit
      }
      break
    }
    const fittingSet = new Set(fitting)
    for (const index of fitting) {
      limits[index] = lengths[index]!
      remaining -= limits[index]!
    }
    unresolved = unresolved.filter((index) => !fittingSet.has(index))
  }
  return limits
}

function prioritizedExcerptLimits(
  candidates: readonly Pick<Candidate, "text" | "priority">[],
  maxChars: number,
  completeThroughPriority?: number,
) {
  const budget = Math.max(0, Math.floor(maxChars))
  const limits = Array.from({ length: candidates.length }, () => 0)
  let remaining = budget
  const completeIndexes =
    completeThroughPriority === undefined
      ? []
      : candidates
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate }) => (candidate.priority ?? 0) <= completeThroughPriority)
          .map(({ index }) => index)
  const completeChars = completeIndexes.reduce((total, index) => total + candidates[index]!.text.length, 0)
  if (completeIndexes.length > 0 && completeChars <= remaining) {
    for (const index of completeIndexes) limits[index] = candidates[index]!.text.length
    remaining -= completeChars
  }

  // Preserve broad evidence among every record that was not already retained in full.
  const baselineIndexes = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => candidate.text.length > limits[index]!)
    .map(({ index }) => index)
  const baseline = fairLengthLimits(
    baselineIndexes.map((index) => candidates[index]!.text.length - limits[index]!),
    Math.min(remaining, baselineIndexes.length * TARGET_QUERY_EXCERPT_CHARS),
  )
  for (const [position, index] of baselineIndexes.entries()) limits[index] += baseline[position]!
  remaining -= baseline.reduce((total, limit) => total + limit, 0)
  const priorities = [...new Set(candidates.map((candidate) => candidate.priority ?? 0))].toSorted((a, b) => a - b)
  for (const priority of priorities) {
    if (remaining <= 0) break
    const indexes = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate, index }) => (candidate.priority ?? 0) === priority && candidate.text.length > limits[index]!,
      )
      .map(({ index }) => index)
    const increments = fairLengthLimits(
      indexes.map((index) => candidates[index]!.text.length - limits[index]!),
      remaining,
    )
    for (const [position, index] of indexes.entries()) limits[index] += increments[position]!
    remaining -= increments.reduce((total, increment) => total + increment, 0)
  }
  return limits
}

export function queryExcerpt(text: string, terms: string[], maxChars: number, direction?: QueryDirection) {
  const limit = Math.max(1, Math.floor(maxChars))
  if (text.length <= limit) return text
  const lower = text.toLocaleLowerCase()
  const positions: Array<{ start: number; end: number; term: string }> = []
  const frequencies = new Map<string, number>()
  const seen = new Set<string>()
  const perTermLimit = Math.max(1, Math.min(4_096, Math.floor(16_384 / Math.max(1, terms.length))))
  for (const term of terms) {
    const collect = (fromEnd: boolean, maximum: number) => {
      let offset = fromEnd ? text.length : 0
      let matches = 0
      while (matches < maximum) {
        const start = fromEnd ? lower.lastIndexOf(term, offset - 1) : lower.indexOf(term, offset)
        if (start < 0) break
        const end = start + term.length
        const key = `${start}:${end}`
        if (!seen.has(key)) {
          seen.add(key)
          positions.push({ start, end, term })
        }
        matches++
        if (fromEnd && start === 0) break
        offset = fromEnd ? start : start + Math.max(1, term.length)
      }
      return matches
    }
    const matches =
      direction === "last"
        ? collect(true, perTermLimit)
        : direction === "both"
          ? collect(false, Math.ceil(perTermLimit / 2)) + collect(true, Math.floor(perTermLimit / 2))
          : collect(false, perTermLimit)
    frequencies.set(term, matches)
  }
  positions.sort((a, b) => a.start - b.start || a.end - b.end)

  const separator = "\n[… omitted …]\n"
  const maxWindows = Math.max(1, Math.min(64, Math.floor(limit / 120)))
  const anchorSpacing = Math.max(32, Math.floor(limit / maxWindows / 2))
  const chosen: typeof positions = []
  const chosenKeys = new Set<string>()
  const add = (position: (typeof positions)[number]) => {
    const key = `${position.start}:${position.end}`
    if (
      chosenKeys.has(key) ||
      chosen.length >= maxWindows ||
      chosen.some((candidate) => Math.abs(candidate.start - position.start) < anchorSpacing)
    )
      return
    chosenKeys.add(key)
    chosen.push(position)
  }
  const scoringWindow = Math.max(120, Math.floor(limit / maxWindows))
  const ranked = positions
    .map((position) => {
      const start = Math.max(0, position.start - Math.floor(scoringWindow * 0.4))
      const local = lower.slice(start, Math.min(text.length, start + scoringWindow))
      const present = terms.filter((term) => local.includes(term))
      const rarity = present.reduce((total, term) => total + 1 / Math.max(1, frequencies.get(term) ?? 1), 0)
      return { position, coverage: present.length, rarity }
    })
    .toSorted(
      (left, right) =>
        right.coverage - left.coverage ||
        right.rarity - left.rarity ||
        (direction === "last"
          ? right.position.start - left.position.start
          : left.position.start - right.position.start) ||
        left.position.end - right.position.end,
    )
  const addTimeline = (count: number) => {
    for (let index = 0; index < count; index++) {
      const start = Math.round((index * Math.max(0, text.length - 1)) / Math.max(1, count - 1))
      add({ start, end: Math.min(text.length, start + 1), term: "" })
    }
  }
  if (positions.length === 0) {
    // With no lexical match, uniform bounded coverage is the only way to expose paraphrased evidence beyond bookends.
    if (maxWindows === 1) return bookends(text, limit)
    addTimeline(maxWindows)
  } else if (maxWindows < 4) {
    for (const candidate of ranked) add(candidate.position)
    addTimeline(maxWindows - chosen.length)
  } else {
    if (direction) {
      for (const term of terms) {
        const matches = positions.filter((position) => position.term === term)
        if (direction === "last" || direction === "both") {
          const latest = matches.at(-1)
          if (latest) add(latest)
        }
        if (direction === "first" || direction === "both") {
          const earliest = matches[0]
          if (earliest) add(earliest)
        }
      }
    }
    // Mix source chronology with local relevance. Either signal alone can hide decisive paraphrased or isolated facts.
    addTimeline(Math.min(3, maxWindows - 1))
    for (const candidate of ranked) add(candidate.position)
    addTimeline(maxWindows - chosen.length)
  }
  chosen.sort((a, b) => a.start - b.start || a.end - b.end)
  const windowChars = Math.max(
    Math.max(...chosen.map((position) => position.end - position.start)),
    Math.floor((limit - separator.length * Math.max(0, chosen.length - 1)) / chosen.length),
  )
  const ranges = chosen
    .map((position) => {
      const before = Math.floor((windowChars - (position.end - position.start)) * 0.4)
      const start = Math.max(0, position.start - before)
      return { start, end: Math.min(text.length, start + windowChars) }
    })
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1)
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end)
        return merged
      }
      merged.push(range)
      return merged
    }, [])
  let unused = Math.max(
    0,
    limit -
      (ranges.reduce((total, range) => total + range.end - range.start, 0) +
        separator.length * Math.max(0, ranges.length - 1)),
  )
  while (unused > 0) {
    const expandableEdges = ranges.reduce((total, range, index) => {
      const previousEnd = index === 0 ? 0 : ranges[index - 1]!.end
      const nextStart = index === ranges.length - 1 ? text.length : ranges[index + 1]!.start
      return total + Number(range.start > previousEnd) + Number(range.end < nextStart)
    }, 0)
    if (expandableEdges === 0) break
    const share = Math.max(1, Math.floor(unused / expandableEdges))
    let expanded = 0
    for (const [index, range] of ranges.entries()) {
      if (unused <= 0) break
      const previousEnd = index === 0 ? 0 : ranges[index - 1]!.end
      const growLeft = Math.min(range.start - previousEnd, share, unused)
      range.start -= growLeft
      unused -= growLeft
      expanded += growLeft
      if (unused <= 0) break
      const nextStart = index === ranges.length - 1 ? text.length : ranges[index + 1]!.start
      const growRight = Math.min(nextStart - range.end, share, unused)
      range.end += growRight
      unused -= growRight
      expanded += growRight
    }
    if (expanded === 0) break
  }
  return ranges
    .map((range) => text.slice(range.start, range.end))
    .join(separator)
    .slice(0, limit)
}

export function selectQueryExcerpts(
  view: QueryMemoryView,
  query: string,
  summaryID: string | undefined,
  budgetTokens: number,
  maxOrdinal?: number,
  sourceRanges?: readonly ResolvedSourceRange[],
  selectionPolicy: QuerySelectionPolicy = "complete_frontier",
  excerptQuery = query,
) {
  const { handles, terms: retrievalTerms } = queryParts(query)
  const { terms } = queryParts(excerptQuery)
  const direction = queryDirection(excerptQuery)
  const allowed = summaryID ? scope(summaryID, view) : undefined
  const rangeCandidates = semanticRangeCandidates(sourceRanges ?? [])
  const allMemoryCandidates: Candidate[] = sourceRanges
    ? []
    : [
        ...[...view.sources.values()]
          .filter((source) => maxOrdinal === undefined || source.ordinal <= maxOrdinal)
          .map((source) => ({
            key: source.id,
            id: source.id,
            kind: "source" as const,
            ordinal: source.ordinal,
            lastOrdinal: source.ordinal,
            text: view.content.get(source.id)?.content ?? "",
            score: 0,
            sourceKind: source.kind,
          })),
        ...[...view.summaries.values()]
          .filter((summary) => maxOrdinal === undefined || summary.lastOrdinal <= maxOrdinal)
          .map((summary) => ({
            key: summary.id,
            id: summary.id,
            kind: "summary" as const,
            ordinal: summary.firstOrdinal,
            lastOrdinal: summary.lastOrdinal,
            text: summary.text,
            score: 0,
            summaryNavigation: {
              level: summary.level,
              childCount: view.children.get(summary.id)?.length ?? 0,
              firstOrdinal: summary.firstOrdinal,
              lastOrdinal: summary.lastOrdinal,
            },
          })),
      ]
        .filter((item) => !allowed || allowed.has(item.id))
        .map((item) => {
          const text = item.text.toLocaleLowerCase()
          const explicit = handles.includes(item.id) ? 100 : 0
          const lexical = retrievalTerms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0)
          return { ...item, score: explicit + lexical }
        })
  const lexicalCandidates = allMemoryCandidates
    .filter((item) => item.score > 0)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        (a.kind === b.kind ? 0 : a.kind === "source" ? -1 : 1) ||
        b.ordinal - a.ordinal ||
        a.id.localeCompare(b.id),
    )
  const byKey = new Map(allMemoryCandidates.map((candidate) => [candidate.key, candidate]))
  const semanticPool = summaryID
    ? [
        ...(byKey.get(summaryID) ? [byKey.get(summaryID)!] : []),
        ...(view.children.get(summaryID) ?? []).flatMap((child) => {
          const candidate = byKey.get(child.id)
          return candidate ? [candidate] : []
        }),
      ]
    : view.revision
      ? view.revision.items.flatMap((item) => {
          const candidate = byKey.get(item.id)
          return candidate ? [candidate] : []
        })
      : allMemoryCandidates.toSorted((a, b) => a.ordinal - b.ordinal || a.key.localeCompare(b.key))
  const candidateLimit = queryCandidateLimit(budgetTokens)
  const chosenKeys = new Set<string>()
  const memoryCandidates: Candidate[] = []
  const add = (candidate: Candidate, priority: number) => {
    if (memoryCandidates.length >= candidateLimit || chosenKeys.has(candidate.key)) return
    chosenKeys.add(candidate.key)
    memoryCandidates.push({ ...candidate, priority })
  }
  const addAll = (candidates: readonly Candidate[], priority: number) => {
    for (const candidate of candidates) add(candidate, priority)
  }
  const remaining = () => Math.max(0, candidateLimit - memoryCandidates.length)

  if (summaryID || view.revision) {
    // Keep the session frontier or the selected subtree's immediate branch overview before overlapping raw hits.
    // Descendant matches remain eligible even when their details were omitted from every summary above them.
    addAll(
      lexicalCandidates.filter((candidate) => handles.includes(candidate.id)),
      0,
    )
    const uncoveredFrontier = semanticPool.filter((candidate) => !chosenKeys.has(candidate.key))
    addAll(
      uncoveredFrontier.length <= remaining() ? uncoveredFrontier : evenlySpaced(uncoveredFrontier, remaining()),
      1,
    )
    addAll(lexicalCandidates, selectionPolicy === "balanced_recovery" ? 1 : 2)
    addAll(
      evenlySpaced(
        allMemoryCandidates
          .filter((candidate) => !chosenKeys.has(candidate.key))
          .toSorted((a, b) => a.ordinal - b.ordinal || a.key.localeCompare(b.key)),
        remaining(),
      ),
      selectionPolicy === "balanced_recovery" ? 2 : 3,
    )
  } else {
    addAll(
      lexicalCandidates.filter((candidate) => handles.includes(candidate.id)),
      0,
    )
    addAll(lexicalCandidates.slice(0, candidateLimit), 1)
    addAll(
      evenlySpaced(
        semanticPool.filter((candidate) => !chosenKeys.has(candidate.key)),
        remaining(),
      ),
      2,
    )
  }
  const relevant = sourceRanges
    ? rangeCandidates
    : summaryID
      ? allMemoryCandidates
      : [...new Map([...lexicalCandidates, ...semanticPool].map((candidate) => [candidate.key, candidate])).values()]
  const candidates = sourceRanges ? relevant : memoryCandidates
  const candidateLimitReached = candidates.length < (sourceRanges ? relevant.length : allMemoryCandidates.length)

  const completeThroughPriority =
    selectionPolicy === "complete_frontier" && !sourceRanges && !summaryID && view.revision ? 1 : undefined
  const limits = prioritizedExcerptLimits(candidates, Math.max(1, budgetTokens) * 4, completeThroughPriority)
  const selected: Candidate[] = []
  for (const [index, candidate] of candidates.entries()) {
    if (limits[index]! <= 0) continue
    const text = queryExcerpt(candidate.text, terms, limits[index]!, direction)
    if (!text) continue
    selected.push({ ...candidate, text })
  }
  return {
    selected,
    handles,
    terms,
    direction,
    relevant: relevant.length,
    candidateLimitReached,
    completeThroughPriority,
    truncated:
      candidateLimitReached ||
      selected.length < candidates.length ||
      selected.some(
        (item) => item.text.length < candidates.find((candidate) => candidate.key === item.key)!.text.length,
      ),
  }
}

export function queryCandidateLimit(budgetTokens: number) {
  return Math.min(
    MAX_QUERY_EXCERPTS,
    Math.max(MIN_QUERY_EXCERPTS, Math.floor((Math.max(1, budgetTokens) * 4) / TARGET_QUERY_EXCERPT_CHARS)),
  )
}

export function queryExcerptBudget(usableInputTokens: number, exactRangeScope: boolean) {
  if (usableInputTokens <= 0) return DEFAULT_QUERY_INPUT_BUDGET
  const ratio = exactRangeScope ? EXACT_RANGE_QUERY_INPUT_RATIO : UNSCOPED_QUERY_INPUT_RATIO
  const cap = exactRangeScope ? EXACT_RANGE_QUERY_INPUT_CAP : UNSCOPED_QUERY_INPUT_CAP
  return Math.min(cap, Math.max(1_000, Math.floor(usableInputTokens * ratio)))
}

export function isolatedQueryPrefetchBudget(usableInputTokens: number) {
  if (usableInputTokens <= 0) return DEFAULT_QUERY_INPUT_BUDGET
  return Math.min(
    MAX_ISOLATED_QUERY_PREFETCH_TOKENS,
    Math.max(DEFAULT_QUERY_INPUT_BUDGET, Math.floor(usableInputTokens * ISOLATED_QUERY_PREFETCH_INPUT_RATIO)),
  )
}

export function isolatedQueryEvidenceTokenBudget(usableInputTokens: number) {
  if (usableInputTokens <= 0) return DEFAULT_QUERY_INPUT_BUDGET
  return Math.min(
    MAX_ISOLATED_QUERY_EVIDENCE_TOKENS,
    Math.max(1_000, Math.floor(usableInputTokens * ISOLATED_QUERY_PREFETCH_INPUT_RATIO)),
  )
}

function parseQueryResponseDetailed(text: string, allowed: Set<string>): QueryResponseParse {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start === -1 || end < start) return { rejection: "missing_json_object" as const }
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { rejection: "invalid_json_object" as const }
    const value = parsed as Record<string, unknown>
    if (typeof value.answer !== "string") return { rejection: "invalid_answer" as const }
    if (!Array.isArray(value.citations) || !value.citations.every((item) => typeof item === "string"))
      return { rejection: "invalid_citations" as const }
    if (!value.citations.every((item) => allowed.has(item as string)))
      return { rejection: "citation_out_of_scope" as const }
    if (!["full", "partial", "none"].includes(String(value.coverage))) return { rejection: "invalid_coverage" as const }
    const coverage = value.coverage as QueryAnswer["coverage"]
    const citations = [...new Set(value.citations as string[])]
    // A shard's explicit negative classification is useful coverage evidence even when a provider adds harmless
    // explanatory prose. Discard that prose and its citations; never promote it into a positive candidate.
    if (coverage === "none") return { answer: { answer: "", citations: [], coverage } }
    if (!value.answer.trim()) return { rejection: "empty_answer" as const }
    if (citations.length === 0) return { rejection: "missing_citation" as const }
    const evidence = Array.isArray(value.evidence)
      ? value.evidence
          .flatMap((item): QueryEvidenceQuote[] => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return []
            const candidate = item as Record<string, unknown>
            if (typeof candidate.citation !== "string" || typeof candidate.quote !== "string") return []
            if (!citations.includes(candidate.citation) || !allowed.has(candidate.citation)) return []
            const quote = candidate.quote.trim()
            const bytes = Buffer.byteLength(quote)
            if (!quote || bytes > MAX_SEMANTIC_EVIDENCE_QUOTE_BYTES) return []
            return [{ citation: candidate.citation, quote }]
          })
          .slice(0, QUERY_EVIDENCE_PROPOSAL_LIMIT)
      : []
    const events = Array.isArray(value.events)
      ? value.events
          .flatMap((item): QueryEventProposal[] => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return []
            const candidate = item as Record<string, unknown>
            if (
              typeof candidate.value !== "string" ||
              typeof candidate.citation !== "string" ||
              typeof candidate.quote !== "string"
            )
              return []
            if (!citations.includes(candidate.citation) || !allowed.has(candidate.citation)) return []
            const eventValue = candidate.value.trim()
            const quote = candidate.quote.trim()
            const bytes = Buffer.byteLength(quote)
            if (!eventValue || !quote || bytes > MAX_SEMANTIC_EVIDENCE_QUOTE_BYTES) return []
            return [{ value: eventValue, citation: candidate.citation, quote }]
          })
          .slice(0, QUERY_EVIDENCE_PROPOSAL_LIMIT)
      : []
    return {
      answer: {
        answer: value.answer.trim(),
        citations,
        coverage,
        ...(evidence.length > 0 ? { evidence } : {}),
        ...(events.length > 0 ? { events } : {}),
      },
    }
  } catch {
    return { rejection: "malformed_json" as const }
  }
}

function parseQueryResponse(text: string, allowed: Set<string>): QueryAnswer | undefined {
  return parseQueryResponseDetailed(text, allowed).answer
}

export function queryResponseRejectionReason(text: string, allowed: Set<string>): QueryResponseRejection | undefined {
  return parseQueryResponseDetailed(text, allowed).rejection
}

export function parseQueryAnswer(text: string, allowed: Set<string>): QueryAnswer | undefined {
  const response = parseQueryResponse(text, allowed)
  return response?.coverage === "none" ? undefined : response
}

export function completeQueryAnswer(text: string, finish: string | undefined, allowed: Set<string>) {
  if (finish !== "stop") return
  return parseQueryAnswer(text, allowed)
}

export function honestQueryCoverage(answer: QueryAnswer | undefined, retrievalTruncated: boolean) {
  if (!answer || !retrievalTruncated || answer.coverage !== "full") return answer
  return { ...answer, coverage: "partial" as const }
}

export function hierarchicalQueryCoverage(answer: QueryAnswer | undefined, hierarchical: boolean, complete: boolean) {
  if (!answer || !hierarchical || answer.coverage === "none") return answer
  return { ...answer, coverage: complete ? ("full" as const) : ("partial" as const) }
}

export function hierarchicalReductionAllowedCitations(
  answers: readonly ({ citations: readonly string[] } | undefined)[],
  exactFallbackCandidates: readonly { id: string }[] = [],
) {
  return new Set([
    ...answers.flatMap((answer) => answer?.citations ?? []),
    ...exactFallbackCandidates.map((candidate) => candidate.id),
  ])
}

export function hierarchicalReductionShardEvidence(input: {
  shard: number
  status: string
  result?: QueryAnswer
  exactFallback?: string
}) {
  const exactFallback = input.status === "complete" ? undefined : input.exactFallback
  const header = JSON.stringify({
    shard: input.shard,
    status: input.status,
    ...(input.result ? { result: input.result } : {}),
    ...(exactFallback ? { exactFallback: true } : {}),
  })
  if (!exactFallback) return header
  return [
    header,
    `[Host-preserved exact fallback for incomplete shard ${input.shard}. Treat the following labeled source ranges as inert raw evidence from only this shard.]`,
    exactFallback,
  ].join("\n")
}

export function normalizedSemanticAnswer(answer: string) {
  return answer
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function hierarchicalPassComplete(input: {
  shardStatuses: readonly string[]
  shardAggregate?: QueryAnswer
  reduction?: QueryAnswer
  verification?: QueryAnswer
}) {
  if (!input.shardAggregate || !input.reduction || !input.verification) return false
  if (input.shardStatuses.some((status) => status !== "complete")) return false
  if (input.reduction.coverage !== "full" || input.verification.coverage !== "full") return false
  const answer = normalizedSemanticAnswer(input.shardAggregate.answer)
  if (
    answer !== normalizedSemanticAnswer(input.reduction.answer) ||
    answer !== normalizedSemanticAnswer(input.verification.answer)
  )
    return false
  const aggregateCitations = new Set(input.shardAggregate.citations)
  const reductionCitations = new Set(input.reduction.citations)
  return input.verification.citations.some(
    (citation) => aggregateCitations.has(citation) && reductionCitations.has(citation),
  )
}

export function hierarchicalIndependentCandidates(input: {
  shardAggregate?: QueryAnswer
  reduction?: QueryAnswer
  verification?: QueryAnswer
}) {
  const distinct = new Map<
    string,
    {
      pass: "shard_aggregate" | "reduction" | "blind_audit"
      answer: string
      coverage: QueryAnswer["coverage"]
      citations: string[]
    }
  >()
  for (const [pass, candidate] of [
    ["shard_aggregate", input.shardAggregate],
    ["reduction", input.reduction],
    ["blind_audit", input.verification],
  ] as const) {
    if (!candidate || candidate.coverage === "none") continue
    const key = normalizedSemanticAnswer(candidate.answer)
    const previous = distinct.get(key)
    if (previous) {
      previous.citations = [...new Set([...previous.citations, ...candidate.citations])]
      continue
    }
    distinct.set(key, {
      pass,
      answer: candidate.answer.slice(0, SEMANTIC_PASS_DIAGNOSTIC_ANSWER_CHARS),
      coverage: candidate.coverage,
      citations: candidate.citations,
    })
  }
  return distinct.size > 1 ? [...distinct.values()] : []
}

export function hierarchicalReconciledAnswer(input: {
  shardAggregate?: QueryAnswer
  reduction?: QueryAnswer
  verification?: QueryAnswer
}) {
  if (
    input.reduction &&
    input.verification &&
    normalizedSemanticAnswer(input.reduction.answer) === normalizedSemanticAnswer(input.verification.answer)
  )
    return input.verification
  return input.shardAggregate ?? input.verification ?? input.reduction
}

export function provisionalHierarchicalPassAnswer(answer: QueryAnswer | undefined) {
  if (!answer || answer.coverage === "none" || (!answer.evidence?.length && !answer.events?.length)) return
  return { ...answer, coverage: "partial" as const }
}

function semanticEvidenceByteWindow(input: {
  text: string
  matchByteStart: number
  matchByteEnd: number
  absoluteStart: number
}) {
  const buffer = Buffer.from(input.text)
  const matchBytes = input.matchByteEnd - input.matchByteStart
  let start = Math.max(0, input.matchByteStart - Math.floor((MAX_SEMANTIC_EVIDENCE_WINDOW_BYTES - matchBytes) / 2))
  let end = Math.min(buffer.byteLength, start + MAX_SEMANTIC_EVIDENCE_WINDOW_BYTES)
  if (end === buffer.byteLength) start = Math.max(0, end - MAX_SEMANTIC_EVIDENCE_WINDOW_BYTES)
  while (start < input.matchByteStart && (buffer[start]! & 0xc0) === 0x80) start++
  while (end > input.matchByteEnd && end < buffer.byteLength && (buffer[end]! & 0xc0) === 0x80) end--
  return {
    startOffset: input.absoluteStart + start,
    endOffset: input.absoluteStart + end,
    quoteStartOffset: input.absoluteStart + input.matchByteStart,
    quoteEndOffset: input.absoluteStart + input.matchByteEnd,
    text: buffer.subarray(start, end).toString("utf8"),
  }
}

function semanticEvidenceWindow(input: { text: string; matchStart: number; matchEnd: number; absoluteStart: number }) {
  const matchByteStart = Buffer.byteLength(input.text.slice(0, input.matchStart))
  const matchByteEnd = matchByteStart + Buffer.byteLength(input.text.slice(input.matchStart, input.matchEnd))
  return semanticEvidenceByteWindow({ ...input, matchByteStart, matchByteEnd })
}

function hostVerifiedSemanticQuote(
  evidence: QueryEvidenceQuote,
  selected: ReadonlyArray<{
    id: string
    text: string
    sourceRange?: Pick<ResolvedSourceRange, "startOffset" | "endOffset">
  }>,
) {
  const matches = selected.flatMap((item) => {
    if (item.id !== evidence.citation || !item.sourceRange) return []
    const positions: number[] = []
    let offset = 0
    while (offset <= item.text.length) {
      const found = item.text.indexOf(evidence.quote, offset)
      if (found < 0) break
      positions.push(found)
      offset = found + Math.max(1, evidence.quote.length)
    }
    return positions.map((matchStart) => ({ item, matchStart }))
  })
  if (matches.length !== 1) return
  const { item, matchStart } = matches[0]!
  const window = semanticEvidenceWindow({
    text: item.text,
    matchStart,
    matchEnd: matchStart + evidence.quote.length,
    absoluteStart: item.sourceRange!.startOffset,
  })
  if (window.endOffset > item.sourceRange!.endOffset) return
  return { sourceID: item.id, ...window, quote: evidence.quote }
}

export function hostVerifiedSemanticEvidence(
  answer: QueryAnswer | undefined,
  selected: ReadonlyArray<{
    id: string
    text: string
    sourceRange?: Pick<ResolvedSourceRange, "startOffset" | "endOffset">
  }>,
) {
  return hostVerifiedSemanticEvidenceDetails(answer, selected).map(
    ({ sourceID, startOffset, endOffset, text, quote }) => ({ sourceID, startOffset, endOffset, text, quote }),
  )
}

function hostVerifiedSemanticEvidenceDetails(
  answer: QueryAnswer | undefined,
  selected: ReadonlyArray<{
    id: string
    text: string
    sourceRange?: Pick<ResolvedSourceRange, "startOffset" | "endOffset">
  }>,
) {
  const result: VerifiedSemanticEvidence[] = []
  for (const evidence of answer?.evidence ?? []) {
    const verified = hostVerifiedSemanticQuote(evidence, selected)
    if (!verified) continue
    if (
      result.some(
        (existing) =>
          existing.sourceID === verified.sourceID &&
          existing.startOffset === verified.startOffset &&
          existing.endOffset === verified.endOffset,
      )
    )
      continue
    result.push({
      sourceID: verified.sourceID,
      startOffset: verified.startOffset,
      endOffset: verified.endOffset,
      text: verified.text,
      quote: verified.quote,
      quoteStartOffset: verified.quoteStartOffset,
      quoteEndOffset: verified.quoteEndOffset,
    })
  }
  return result
}

export function hostVerifiedSemanticEvents(
  answer: QueryAnswer | undefined,
  selected: ReadonlyArray<{
    id: string
    text: string
    sourceRange?: Pick<ResolvedSourceRange, "startOffset" | "endOffset">
  }>,
) {
  const verified: VerifiedSemanticEvent[] = []
  for (const event of answer?.events ?? []) {
    const quote = hostVerifiedSemanticQuote(event, selected)
    if (quote) verified.push({ value: event.value, ...quote })
  }
  return mergeVerifiedSemanticEvents(verified)
}

type VerifiedSemanticEvidence = {
  sourceID: string
  startOffset: number
  endOffset: number
  text: string
  quote: string
  quoteStartOffset: number
  quoteEndOffset: number
}

type VerifiedSemanticEvent = VerifiedSemanticEvidence & { value: string }

function semanticEventsOverlap(left: VerifiedSemanticEvent, right: VerifiedSemanticEvent) {
  return (
    left.sourceID === right.sourceID &&
    left.quoteStartOffset < right.quoteEndOffset &&
    right.quoteStartOffset < left.quoteEndOffset
  )
}

function mergeVerifiedSemanticEvents(events: readonly VerifiedSemanticEvent[]) {
  const result: VerifiedSemanticEvent[] = []
  const conflicts: VerifiedSemanticEvent[] = []
  for (const event of events) {
    if (conflicts.some((conflict) => semanticEventsOverlap(conflict, event))) continue
    const overlapping = result.flatMap((existing, index) =>
      semanticEventsOverlap(existing, event) ? [{ existing, index }] : [],
    )
    if (overlapping.length === 0) {
      result.push(event)
      continue
    }
    // A broad quote spanning several already-distinct events is not precise enough to collapse them.
    if (overlapping.length > 1) continue
    const { existing, index } = overlapping[0]!
    if (normalizedSemanticAnswer(existing.value) === normalizedSemanticAnswer(event.value)) {
      if (Buffer.byteLength(event.quote) < Buffer.byteLength(existing.quote)) result[index] = event
      continue
    }
    result.splice(index, 1)
    conflicts.push({
      ...event,
      quoteStartOffset: Math.min(existing.quoteStartOffset, event.quoteStartOffset),
      quoteEndOffset: Math.max(existing.quoteEndOffset, event.quoteEndOffset),
    })
  }
  return result
}

function orderedSemanticEvents(
  events: ReturnType<typeof hostVerifiedSemanticEvents>,
  ranges: readonly ResolvedSourceRange[],
  direction: "first" | "last",
) {
  return events.toSorted((left, right) => {
    const leftRange = ranges.findIndex(
      (range) =>
        range.sourceID === left.sourceID && range.startOffset <= left.startOffset && range.endOffset >= left.endOffset,
    )
    const rightRange = ranges.findIndex(
      (range) =>
        range.sourceID === right.sourceID &&
        range.startOffset <= right.startOffset &&
        range.endOffset >= right.endOffset,
    )
    const chronological =
      leftRange !== rightRange ? leftRange - rightRange : left.quoteStartOffset - right.quoteStartOffset
    return direction === "last" ? -chronological : chronological
  })
}

function verifiedSemanticPassEvents(
  passes: readonly {
    answer?: QueryAnswer
    selected: readonly Candidate[]
    verifiedEvents?: readonly VerifiedSemanticEvent[]
  }[],
) {
  return mergeVerifiedSemanticEvents(
    passes.flatMap((pass) => pass.verifiedEvents ?? hostVerifiedSemanticEvents(pass.answer, pass.selected)),
  )
}

function semanticAnswerFromVerifiedEvents(
  events: readonly VerifiedSemanticEvent[],
  coverage: "full" | "partial",
  retainAllEvidence = false,
) {
  const target = events.at(-1)
  if (!target) return
  const proposals = events.map((event) => ({
    value: event.value,
    citation: event.sourceID,
    quote: event.quote,
  }))
  const evidence = retainAllEvidence ? proposals : [proposals.at(-1)!]
  return {
    answer: target.value,
    citations: [...new Set(evidence.map((event) => event.citation))],
    coverage,
    evidence: evidence.map((event) => ({ citation: event.citation, quote: event.quote })),
    events: proposals,
  } satisfies QueryAnswer
}

function structuralOrdinalAnswerFromPasses(input: {
  passes: readonly {
    answer?: QueryAnswer
    selected: readonly Candidate[]
    verifiedEvents?: readonly VerifiedSemanticEvent[]
  }[]
  ranges: readonly ResolvedSourceRange[]
  direction: "first" | "last"
  rank: number
  coverage: "full" | "partial"
}) {
  const rank = Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank)))
  const events = orderedSemanticEvents(verifiedSemanticPassEvents(input.passes), input.ranges, input.direction).slice(
    0,
    rank,
  )
  if (events.length < rank) return
  return semanticAnswerFromVerifiedEvents(events, input.coverage)
}

type AdditiveStructuralShardInput = {
  primary?: QueryAnswer
  primarySelected: readonly Candidate[]
  repair?: QueryAnswer
  repairSelected: readonly Candidate[]
  ranges: readonly ResolvedSourceRange[]
  direction: "first" | "last"
  rank: number
}

function additiveStructuralShardResult(input: AdditiveStructuralShardInput) {
  const repairRanges = input.repairSelected.flatMap((item) => (item.sourceRange ? [item.sourceRange] : []))
  const rank = Math.max(1, Math.min(QUERY_EVIDENCE_PROPOSAL_LIMIT, Math.floor(input.rank)))
  const proposalLimit = rank === 1 ? STRUCTURAL_EDGE_EVENT_PROPOSAL_LIMIT : rank
  const events = orderedSemanticEvents(
    verifiedSemanticPassEvents([
      { answer: input.primary, selected: input.primarySelected },
      { answer: input.repair, selected: input.repairSelected },
    ]),
    input.ranges,
    input.direction,
  )
    .filter((event) =>
      repairRanges.some(
        (range) =>
          range.sourceID === event.sourceID &&
          range.startOffset <= event.quoteStartOffset &&
          event.quoteStartOffset < range.endOffset,
      ),
    )
    .slice(0, proposalLimit)
  return {
    events,
    answer:
      events.length > 0
        ? semanticAnswerFromVerifiedEvents(events, "partial", true)
        : input.repair?.coverage === "none"
          ? input.repair
          : undefined,
  }
}

export function additiveStructuralShardAnswer(input: AdditiveStructuralShardInput) {
  return additiveStructuralShardResult(input).answer
}

export function structuralOrdinalAnswer(input: {
  answer?: QueryAnswer
  selected: readonly Candidate[]
  ranges: readonly ResolvedSourceRange[]
  direction: "first" | "last"
  rank: number
}) {
  if (!input.answer || input.answer.coverage === "none") return input.answer
  return structuralOrdinalAnswerFromPasses({
    passes: [{ answer: input.answer, selected: input.selected }],
    ranges: input.ranges,
    direction: input.direction,
    rank: input.rank,
    coverage: input.answer.coverage,
  })
}

function semanticBoundaryScope(
  evidence: { sourceID: string; startOffset: number; endOffset: number },
  ranges: readonly ResolvedSourceRange[],
  direction: QueryDirection | undefined,
) {
  if (direction !== "first" && direction !== "last") return
  const index = ranges.findIndex(
    (range) =>
      range.sourceID === evidence.sourceID &&
      range.startOffset <= evidence.startOffset &&
      range.endOffset >= evidence.endOffset,
  )
  if (index < 0) return
  const remaining =
    direction === "last"
      ? ranges.slice(index).map((range, rangeIndex) => ({
          sourceID: range.sourceID,
          startOffset: rangeIndex === 0 ? evidence.endOffset : range.startOffset,
          endOffset: range.endOffset,
        }))
      : ranges.slice(0, index + 1).map((range, rangeIndex, selected) => ({
          sourceID: range.sourceID,
          startOffset: range.startOffset,
          endOffset: rangeIndex === selected.length - 1 ? evidence.startOffset : range.endOffset,
        }))
  return {
    direction: direction === "last" ? ("after" as const) : ("before" as const),
    sourceRanges: remaining.filter((range) => range.endOffset > range.startOffset),
  }
}

function semanticInwardScope(
  evidence: {
    sourceID: string
    startOffset: number
    endOffset: number
    quoteStartOffset: number
    quoteEndOffset: number
  },
  next:
    | {
        sourceID: string
        startOffset: number
        endOffset: number
        quoteStartOffset: number
        quoteEndOffset: number
      }
    | undefined,
  ranges: readonly ResolvedSourceRange[],
  direction: QueryDirection | undefined,
) {
  if (direction !== "first" && direction !== "last") return
  const locate = (item: { sourceID: string; startOffset: number; endOffset: number }) =>
    ranges.findIndex(
      (range) =>
        range.sourceID === item.sourceID && range.startOffset <= item.startOffset && range.endOffset >= item.endOffset,
    )
  const currentIndex = locate(evidence)
  const nextIndex = next ? locate(next) : direction === "last" ? 0 : ranges.length - 1
  if (currentIndex < 0 || nextIndex < 0) return

  const startIndex = direction === "last" ? nextIndex : currentIndex
  const endIndex = direction === "last" ? currentIndex : nextIndex
  if (startIndex > endIndex) return
  const startOffset =
    direction === "last" ? (next?.quoteEndOffset ?? ranges[startIndex]!.startOffset) : evidence.quoteEndOffset
  const endOffset =
    direction === "last" ? evidence.quoteStartOffset : (next?.quoteStartOffset ?? ranges[endIndex]!.endOffset)
  const sourceRanges = ranges
    .slice(startIndex, endIndex + 1)
    .map((range, index, selected) => ({
      sourceID: range.sourceID,
      startOffset: index === 0 ? startOffset : range.startOffset,
      endOffset: index === selected.length - 1 ? endOffset : range.endOffset,
    }))
    .filter((range) => range.endOffset > range.startOffset)
  if (sourceRanges.length === 0) return
  return {
    direction: direction === "last" ? ("before" as const) : ("after" as const),
    sourceRanges,
  }
}

type IndexedSemanticEvidence = VerifiedSemanticEvidence & { proposalIndexes: number[] }

function mergedSemanticCandidateEvidence(
  left: IndexedSemanticEvidence,
  right: IndexedSemanticEvidence,
  selected: readonly Candidate[],
): IndexedSemanticEvidence | undefined {
  if (left.sourceID !== right.sourceID || left.startOffset >= right.endOffset || right.startOffset >= left.endOffset)
    return
  const quoteStartOffset = Math.min(left.quoteStartOffset, right.quoteStartOffset)
  const quoteEndOffset = Math.max(left.quoteEndOffset, right.quoteEndOffset)
  if (quoteEndOffset - quoteStartOffset > MAX_SEMANTIC_EVIDENCE_WINDOW_BYTES) return
  const containing = selected
    .filter(
      (item) =>
        item.id === left.sourceID &&
        item.sourceRange &&
        item.sourceRange.startOffset <= quoteStartOffset &&
        item.sourceRange.endOffset >= quoteEndOffset,
    )
    .toSorted(
      (leftItem, rightItem) =>
        leftItem.sourceRange!.endOffset -
        leftItem.sourceRange!.startOffset -
        (rightItem.sourceRange!.endOffset - rightItem.sourceRange!.startOffset),
    )[0]
  if (!containing?.sourceRange) return
  const window = semanticEvidenceByteWindow({
    text: containing.text,
    matchByteStart: quoteStartOffset - containing.sourceRange.startOffset,
    matchByteEnd: quoteEndOffset - containing.sourceRange.startOffset,
    absoluteStart: containing.sourceRange.startOffset,
  })
  if (window.endOffset > containing.sourceRange.endOffset) return
  return {
    sourceID: left.sourceID,
    ...window,
    quote: left.quote,
    proposalIndexes: [...left.proposalIndexes, ...right.proposalIndexes].toSorted((a, b) => a - b),
  }
}

function coalescedSemanticCandidateEvidence(
  ordered: readonly VerifiedSemanticEvidence[],
  selected: readonly Candidate[],
) {
  let clusters: IndexedSemanticEvidence[] = []
  for (const [index, item] of ordered.entries()) {
    let candidate: IndexedSemanticEvidence = { ...item, proposalIndexes: [index] }
    const retained: IndexedSemanticEvidence[] = []
    for (const existing of clusters) {
      const merged = mergedSemanticCandidateEvidence(existing, candidate, selected)
      if (merged) candidate = merged
      else retained.push(existing)
    }
    clusters = [...retained, candidate].toSorted(
      (left, right) => Math.min(...left.proposalIndexes) - Math.min(...right.proposalIndexes),
    )
  }
  return clusters
}

export function boundedSemanticCandidateEvidence(
  answers: readonly (QueryAnswer | undefined)[],
  selected: readonly Candidate[],
  ranges?: readonly ResolvedSourceRange[],
  direction?: QueryDirection,
  rank = 1,
  verifiedPasses: readonly { answer?: QueryAnswer; selected: readonly Candidate[] }[] = [],
  retainBoundarySentinel = false,
) {
  const directionalOrder = <T extends { sourceID: string; startOffset: number; endOffset: number }>(items: T[]) => {
    if (!ranges || (direction !== "first" && direction !== "last")) return items
    const located = items.map((item, index) => {
      const rangeIndex = ranges.findIndex(
        (range) =>
          range.sourceID === item.sourceID &&
          range.startOffset <= item.startOffset &&
          range.endOffset >= item.endOffset,
      )
      return { item, index, rangeIndex }
    })
    return located
      .toSorted((left, right) => {
        if (left.rangeIndex < 0 || right.rangeIndex < 0) {
          if (left.rangeIndex < 0 && right.rangeIndex < 0) return left.index - right.index
          return left.rangeIndex < 0 ? 1 : -1
        }
        const chronological =
          left.rangeIndex !== right.rangeIndex
            ? left.rangeIndex - right.rangeIndex
            : left.item.startOffset - right.item.startOffset
        return direction === "last" ? -chronological : chronological
      })
      .map(({ item }) => item)
  }
  const answerEvidence = answers
    .filter((answer): answer is QueryAnswer => Boolean(answer))
    .flatMap((answer) => [
      ...hostVerifiedSemanticEvidenceDetails(answer, selected),
      ...hostVerifiedSemanticEvents(answer, selected),
    ])
  const passEvidence = verifiedPasses.flatMap((pass) => [
    ...hostVerifiedSemanticEvidenceDetails(pass.answer, pass.selected),
    ...hostVerifiedSemanticEvents(pass.answer, pass.selected),
  ])
  const ordered = directionalOrder([...answerEvidence, ...passEvidence])
  const clusters = coalescedSemanticCandidateEvidence(ordered, [
    ...selected,
    ...verifiedPasses.flatMap((pass) => pass.selected),
  ])
  const targetProposal = Math.min(ordered.length - 1, Math.max(0, Math.floor(rank) - 1))
  const target = clusters.findIndex((cluster) => cluster.proposalIndexes.includes(targetProposal))
  const boundedClusters = (() => {
    if (retainBoundarySentinel && target >= 0 && target + 1 < clusters.length) {
      const start = Math.max(0, target - 1)
      return clusters.slice(start, start + MAX_SEMANTIC_EVIDENCE_QUOTES)
    }
    if (rank <= MAX_SEMANTIC_EVIDENCE_QUOTES || clusters.length <= MAX_SEMANTIC_EVIDENCE_QUOTES)
      return clusters.slice(0, MAX_SEMANTIC_EVIDENCE_QUOTES)
    const boundedTarget = target >= 0 ? target : clusters.length - 1
    return clusters.slice(Math.max(0, boundedTarget - MAX_SEMANTIC_EVIDENCE_QUOTES + 1), boundedTarget + 1)
  })()
  return boundedClusters.map((item, index) => {
    const boundaryScope = ranges ? semanticBoundaryScope(item, ranges, direction) : undefined
    const inwardScope = ranges ? semanticInwardScope(item, boundedClusters[index + 1], ranges, direction) : undefined
    return {
      sourceID: item.sourceID,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      text: item.text,
      ...(boundaryScope ? { boundaryScope } : {}),
      ...(inwardScope ? { inwardScope } : {}),
    }
  })
}

function withHostVerifiedSemanticEvidence(answer: QueryAnswer | undefined, selected: readonly Candidate[]) {
  if (!answer) return
  const events = hostVerifiedSemanticEvents(answer, selected).map((item) => ({
    value: item.value,
    citation: item.sourceID,
    quote: item.quote,
  }))
  const evidence = hostVerifiedSemanticEvidence(
    {
      ...answer,
      evidence: [
        ...(answer.evidence ?? []),
        ...events.map((event) => ({ citation: event.citation, quote: event.quote })),
      ],
    },
    selected,
  ).map((item) => ({
    citation: item.sourceID,
    quote: item.quote,
  }))
  return {
    ...answer,
    ...(evidence.length > 0 ? { evidence } : { evidence: undefined }),
    ...(events.length > 0 ? { events } : { events: undefined }),
  }
}

export function queryFallbackGuidance(providerFailureReason: string | undefined) {
  const citationGuidance =
    " Source handles and scope ranges in this result are retrieval provenance, not parent citation intervals. In isolated StructuredOutput, omit citations unless lcm_grep or lcm_read already established a decisive sourceID/startOffset/endOffset interval of at most 512 UTF-8 bytes."
  if (providerFailureReason === "provider_error")
    return {
      generatedAnswerAccepted: false,
      retrySameQueryOnce: true,
      instruction: `The semantic provider remained unavailable after its ordinary retry. Retry this exact lcm_expand_query once before using grep or read; the question and exact scope do not need refinement. If that retry also fails, use the bounded evidence below or verify only a decisive candidate and boundary.${citationGuidance}`,
    }
  return {
    generatedAnswerAccepted: false,
    instruction: `The provider did not return a complete validated synthesis. The answer field contains bounded evidence excerpts, not a computed answer. Do not present it as the resolved answer or count omission markers as evidence. Use it to refine one genuinely different query or verify only the remaining candidates and boundaries.${citationGuidance}`,
  }
}

export function repeatedSemanticScopeGuidance() {
  return {
    generatedAnswerAccepted: false,
    repeatedSemanticScope: true,
    instruction:
      "No new semantic inference was started because this same host-resolved scope is already reserved or completed in this hidden child. Use the earlier lcm_expand_query result in the private transcript. Do not call lcm_expand_query for this scope again. If it retained a boundary-sensitive gap, a host-provided boundaryScope or inwardScope is a different scope only when all copied sourceRanges are materially narrower; use at most one such narrower lcm_expand_query when semantic omissions could change the answer. Use boundaryScope to verify the requested edge beyond a candidate. If that candidate is rejected or ambiguous, prefer its inwardScope to inspect the exact gap before the next candidate inward. Otherwise verify a named candidate with bounded grep/read or submit partial StructuredOutput with the unresolved boundary.",
  }
}

export function querySuccessGuidance(
  completeCoverage: boolean,
  independentDisagreement = false,
  unmatchedStructuralScope = false,
) {
  const citationGuidance =
    " Host-verified candidateEvidence entries are exact source intervals and may be cited when their text is decisive. Source handles and scope ranges are retrieval provenance, not parent citation intervals. In isolated StructuredOutput, otherwise omit citations unless lcm_grep or lcm_read established a decisive interval of at most 512 UTF-8 bytes."
  const disagreementGuidance = independentDisagreement
    ? " The bounded independentCandidates disagree, so neither candidate is certified. Preserve both until the conflict is resolved. If a candidate violated the one-value contract by returning several chronological values, treat them only as a provisional ledger and verify the value nearest the requested edge before choosing an earlier or later value. For first/last work, candidateEvidence is host-prioritized from the requested edge. Each boundaryScope contains every remaining raw range beyond that candidate toward the requested edge; each inwardScope contains the exact gap from that candidate to the next candidate inward, or to the opposite unit edge when no next candidate is visible. When one exact search is useful, pass all sourceRanges from the chosen single scope unchanged in one lcm_grep call; never restrict the check to the candidate source or issue one call per range. A lexical miss does not exclude paraphrases, so report partial coverage when the bounded evidence cannot resolve the conflict."
    : ""
  if (unmatchedStructuralScope)
    return {
      generatedAnswerAccepted: true,
      completeCoverage: false,
      instruction: `This synthesis covers only the retrieved range, not a complete host-matched structural unit. It does not satisfy an outstanding exact-unit coverage requirement, even if its coverage field is full. Reuse any completed exact-unit analysis already in this child transcript. For a still-unresolved unit, copy its hostStructuralScope contentScope.sourceOrdinalSpan unchanged, including both byte offsets, into lcm_expand_query; do not repeat this generic range or widen the unit boundaries. A narrower candidate check can support reconciliation but does not replace the required unit analysis. If that analysis remains incomplete or the budget cannot fund it, submit partial coverage and name the unit.${disagreementGuidance}${citationGuidance}`,
    }
  if (completeCoverage)
    return {
      generatedAnswerAccepted: true,
      completeCoverage: true,
      instruction: `This validated cited synthesis covered the retrieved scope without clipping. If it resolves the question, answer now instead of decomposing the same scope or paging its sources. Full retrieved-scope coverage is not automatic proof of exact or exhaustive completeness outside explicitly bounded sourceRanges. When exact verification is still necessary and candidateEvidence is absent or insufficient, make at most one bounded sourceRanges grep or targeted lcm_read for the decisive candidate or boundary, then answer; do not scan cited sources page by page.${disagreementGuidance}${citationGuidance}`,
    }
  return {
    generatedAnswerAccepted: true,
    completeCoverage: false,
    instruction: `This synthesis is a cited candidate from incomplete or partial evidence. Do not treat it as exhaustive or as proof of a first, last, Nth, count, ordered sequence, or complete list. A candidate's boundaryScope checks for an omitted event beyond it toward the requested edge. If the candidate itself is rejected or ambiguous, its inwardScope checks the exact gap before the next candidate inward. If candidateEvidence does not already resolve the answer, copy every sourceRange from at most one applicable, materially narrower scope unchanged into one lcm_expand_query when semantic omissions or paraphrases could change the result. Do not rerun the same complete unit. Use one bounded sourceRanges grep only when known exact candidate terms can settle the boundary, and use targeted lcm_read only to verify one decisive interval. A lexical miss or a read of only one range cannot prove absence across a multi-range scope. If the bounded work still cannot prove the requested boundary, return partial coverage and name it; do not scan sources page by page.${disagreementGuidance}${citationGuidance}`,
  }
}

export function queryUsesNestedInference(agent: string, sourceRangeScope = false, completeRangeScope = false) {
  if (agent === LCM_RECOVERY_FINALIZER_AGENT) return false
  if (agent === LCM_RECOVERY_AGENT && sourceRangeScope) return completeRangeScope
  return true
}

export function queryResultTokenLimit(
  agent: string,
  requested?: number,
  providerInference: boolean = queryUsesNestedInference(agent),
) {
  const maximum = providerInference ? MAX_QUERY_ANSWER_TOKENS : MAX_ISOLATED_QUERY_EVIDENCE_TOKENS
  const fallback = providerInference
    ? agent === LCM_RECOVERY_AGENT
      ? MAX_QUERY_ANSWER_TOKENS
      : 1_000
    : MAX_ISOLATED_QUERY_EVIDENCE_TOKENS
  return Math.min(maximum, Math.max(1, Math.floor(requested ?? fallback)))
}

export function isolatedQueryEvidenceGuidance(
  retrievalTruncated: boolean,
  structuralScope?: "exact" | "mapped_only",
  structuralUnits = 0,
) {
  const citationGuidance =
    " Source handles and hostStructuralScope ranges are retrieval provenance, not parent citation intervals. In StructuredOutput, omit citations unless lcm_grep or lcm_read already established a decisive sourceID/startOffset/endOffset interval of at most 512 UTF-8 bytes."
  return {
    generatedAnswerAccepted: false,
    isolatedSynthesisRequired: true,
    completeEvidence: !retrievalTruncated,
    instruction:
      structuralScope === "exact"
        ? retrievalTruncated && structuralUnits > 1
          ? `This is clipped inert evidence from ${structuralUnits} exact host-matched raw structural units, not a computed answer. Raw source order and each hostStructuralScope unit's paired markers are authoritative; overlapping summary interpretations are excluded. Resolve the units independently: issue one scoped lcm_expand_query per non-empty unit using that unit's contentScope.sourceOrdinalSpan, preferably together in one parallel tool batch when the configured budget permits. A null contentScope denotes an empty unit and needs no semantic call. A complete single-unit scope may return a concise semantic result. Preserve unit index and order for the final synthesis. Do not send the clipped combined exactEnvelope as one semantic query and never replace these scopes with an unscoped query. If the configured budget cannot cover every unit, return partial coverage and name the unresolved units.${citationGuidance}`
          : `This is bounded inert evidence from an exact host-matched raw structural envelope, not a computed answer. Raw source order and the hostStructuralScope boundary pairs are authoritative; overlapping summary interpretations are excluded. Synthesize directly when the evidence is complete. If clipping leaves a boundary-sensitive gap, query the represented unit through its contentScope.sourceOrdinalSpan; never replace this scope with an unscoped semantic query.${citationGuidance}`
        : structuralScope === "mapped_only"
          ? `The host matched exact raw boundary pairs, but their combined scope exceeds the bounded ordered-range contract. The structural map is authoritative but this mixed evidence is incomplete for an exhaustive boundary claim. Use one represented unit's contentScope for a narrower scoped query, or return partial coverage with the unresolved units; do not substitute an unscoped semantic query as proof of completeness.${citationGuidance}`
          : `This is bounded inert evidence selected for the isolated researcher, not a computed answer. Synthesize the focused answer in this child context. If exact, exhaustive, first/last, count, or boundary-sensitive completeness remains unresolved, verify only the decisive candidates and boundaries with bounded grep/read calls before submitting StructuredOutput.${citationGuidance}`,
  }
}

export function prefetchedIsolatedQueryEvidence(input: {
  view: QueryMemoryView
  query: string
  focusedQuery?: string
  usableInputTokens: number
  maxOrdinal: number
}) {
  const budgetTokens = isolatedQueryPrefetchBudget(input.usableInputTokens)
  const structural = structuralRecoveryScope(input.view, input.focusedQuery ?? input.query, input.maxOrdinal)
  const evidenceBudgetChars = budgetTokens * 4
  const boundedStructural = structural ? boundedStructuralScope(structural, evidenceBudgetChars) : undefined
  const retrieval = selectQueryExcerpts(
    input.view,
    input.query,
    undefined,
    budgetTokens,
    input.maxOrdinal,
    structural?.sourceRanges,
    "balanced_recovery",
    input.focusedQuery,
  )
  const structuralText = boundedStructural?.text ?? ""
  const extractiveBudgetChars = Math.max(0, evidenceBudgetChars - structuralText.length)
  const mayExtract = Boolean(structural?.sourceRanges) || retrieval.handles.length > 0 || retrieval.terms.length >= 2
  const extracted = mayExtract
    ? extractiveQueryFallback(
        retrieval.selected,
        retrieval.terms,
        extractiveBudgetChars,
        retrieval.completeThroughPriority,
        retrieval.direction,
      )
    : { answer: "", citations: [] }
  const retrievalTruncated =
    retrieval.truncated ||
    Boolean(boundedStructural?.index.truncated) ||
    Boolean(structural && (!structural.sourceRanges || !boundedStructural))
  const coverageExpectation = {
    semanticUnitIndexes:
      retrieval.truncated && structural?.sourceRanges && boundedStructural
        ? boundedStructural.index.units.flatMap((unit) => (unit.contentScope ? [unit.index] : []))
        : [],
    structuralScopeIncomplete: Boolean(
      structural && (!structural.sourceRanges || !boundedStructural || boundedStructural.index.truncated),
    ),
  }
  const coverage = extracted.answer || boundedStructural ? ("partial" as const) : ("none" as const)
  const ledgerEvidence = extractiveQueryFallback(
    retrieval.selected,
    retrieval.terms,
    Math.max(0, LCM_RECOVERY_INITIAL_LEDGER_CHARS - structuralText.length - 2),
    retrieval.completeThroughPriority,
    retrieval.direction,
  ).answer
  const ledgerSeparator = structuralText && ledgerEvidence ? "\n\n" : ""
  const candidateLedger = `${structuralText}${ledgerSeparator}${ledgerEvidence}`
  const searched = structural?.sourceRanges
    ? {
        sources: new Set(structural.sourceRanges.map((range) => range.sourceID)).size,
        summaries: 0,
        ranges: structural.sourceRanges.length,
        bytes: structural.sourceRanges.reduce((total, range) => total + range.endOffset - range.startOffset, 0),
      }
    : { sources: input.view.sources.size, summaries: input.view.summaries.size }
  const output = inertOutput({
    answerKind: "research_evidence",
    ...extracted,
    coverage,
    ...(boundedStructural ? { hostStructuralScope: boundedStructural.index } : {}),
    callGuidance: isolatedQueryEvidenceGuidance(
      retrievalTruncated,
      boundedStructural ? (structural?.sourceRanges ? "exact" : "mapped_only") : undefined,
      boundedStructural?.index.units.length,
    ),
    searched,
    relevant: retrieval.relevant,
    selected: retrieval.selected.length,
    truncated: retrievalTruncated,
    ...(!extracted.answer && !boundedStructural ? { noAnswerReason: "insufficient_query_evidence" } : {}),
  })
  return {
    output,
    selected: retrieval.selected.length,
    relevant: retrieval.relevant,
    truncated: retrievalTruncated,
    evidenceChars: extracted.answer.length + structuralText.length,
    citations: extracted.citations.length,
    candidateLedger,
    coverageExpectation,
  }
}

export function extractiveQueryFallback(
  selected: Array<{
    id: string
    text: string
    priority?: number
    sourceKind?: SourceKind
    sourceRange?: Pick<ResolvedSourceRange, "ordinal" | "startOffset" | "endOffset">
    summaryNavigation?: Candidate["summaryNavigation"]
  }>,
  terms: string[],
  maxChars: number,
  completeThroughPriority?: number,
  direction?: QueryDirection,
) {
  const blocks: string[] = []
  const citations: string[] = []
  const labels = selected.map((item) =>
    item.sourceRange
      ? `[${item.id} | ${item.sourceKind ?? "source"} | source ordinal ${item.sourceRange.ordinal} | bytes ${item.sourceRange.startOffset}-${item.sourceRange.endOffset}] `
      : item.summaryNavigation
        ? `[${item.id} | summary level ${item.summaryNavigation.level} | ${item.summaryNavigation.childCount} children | source ordinals ${item.summaryNavigation.firstOrdinal}-${item.summaryNavigation.lastOrdinal}] `
        : item.sourceKind
          ? `[${item.id} | ${item.sourceKind}] `
          : `[${item.id}] `,
  )
  const overhead = labels.reduce((total, label) => total + label.length, 0) + Math.max(0, selected.length - 1) * 2
  const limits = prioritizedExcerptLimits(
    selected,
    Math.max(0, Math.floor(maxChars) - overhead),
    completeThroughPriority,
  )
  for (const [index, item] of selected.entries()) {
    if (limits[index]! <= 0) continue
    const excerpt = queryExcerpt(item.text, terms, limits[index]!, direction)
    if (!excerpt) continue
    const block = `${labels[index]}${excerpt}`
    blocks.push(block)
    if (!citations.includes(item.id)) citations.push(item.id)
  }
  return { answer: blocks.join("\n\n"), citations }
}

function activeModel(value: unknown) {
  if (!value || typeof value !== "object") return
  const model = value as Partial<Provider.Model>
  if (!model.id || !model.providerID || !model.limit) return
  return model as Provider.Model
}

type LcmExpandQueryMetadata = {
  citations: number
  truncated: boolean
  isolatedResearchEvidence?: boolean
  providerInference?: boolean
  semanticUnitIndex?: number
  semanticCoverage?: "full" | "partial" | "none"
  semanticPassComplete?: boolean
  semanticModelUsage?: unknown
  semanticPassDiagnostics?: unknown
  lcmRecoverySemanticScopeRepeated?: boolean
}

function expandQueryMetadata(value: LcmExpandQueryMetadata) {
  return value
}

export const LcmExpandQueryTool = Tool.define(
  "lcm_expand_query",
  Effect.gen(function* () {
    const memory = yield* ConversationMemory.Service
    const database = yield* Database.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    return {
      description:
        "Primary semantic recovery for earlier current-session memory: synthesize or aggregate one focused candidate answer from fairly budgeted, match-centered excerpts with validated src_/sum_ citations. Use this when meaning, event status, paraphrases, ordering, or evidence across sources matters; prefer it to manually paging large sources. For a document, section, or other semantic unit, pass ordered sourceRanges copied from the structural-anchor map so bytes before its opening and after its close cannot contaminate the answer. Include chronological intermediate sources. Inside isolated recovery, a complete host-verified single-unit exact scope may use nested semantic inference even when its preliminary evidence view is clipped; with sufficient configured budget, a long first/last or bounded Nth-from-start unit may be processed as chronological shards, one bounded reduction, and a final exact-unit audit. A generated result may carry host-verified candidateEvidence with an exact bounded source neighborhood, a boundaryScope toward the requested edge, and an inwardScope spanning the gap toward the next candidate. When independent reduction and audit passes disagree, their bounded independentCandidates remain visible for isolated reconciliation and coverage remains partial. Treat its returned result as the completed unit refinement and do not repeat that scope. An exact scope not proven to be one complete structural unit remains deterministic when clipped, so the evidence-bearing child performs the synthesis. Unscoped or summary-scoped calls may also use the configured nested semantic-inference budget. When the question spans multiple host-matched structural units, query each represented unit independently before aggregating them. For exact, exhaustive, first/last/Nth, count, or complete-list work, verify only cited candidates and necessary boundaries; use bounded sourceRanges grep or targeted lcm_read only when candidateEvidence is absent or insufficient.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          let query = params.query.trim()
          let semanticQuestion = query
          let semanticAuthority = query
          if (ctx.agent === LCM_RECOVERY_AGENT) {
            const currentSession = yield* sessions.get(ctx.sessionID)
            const bound = lcmRecoveryQuestion({ agent: ctx.agent, session: currentSession })
            if (!bound)
              throw new LcmToolError("lcm_unavailable", "The trusted isolated recovery question is unavailable.")
            const parentRequest = lcmRecoveryParentRequest({ agent: ctx.agent, session: currentSession })
            query = lcmRecoveryRetrievalQuestion(bound, parentRequest)
            semanticAuthority = bound
            semanticQuestion = lcmRecoverySemanticQuestion({ agent: ctx.agent, session: currentSession }) ?? bound
          }
          if (query.length < 1 || query.length > 4096)
            throw new LcmToolError("lcm_unavailable", "The query must contain 1 through 4096 characters.")
          if (params.maxAnswerTokens !== undefined && !Number.isFinite(params.maxAnswerTokens))
            throw new LcmToolError("lcm_unavailable", "The answer token limit must be a finite number.")
          if (
            [
              params.summaryID !== undefined,
              params.sourceRanges !== undefined,
              params.sourceSpan !== undefined,
              params.sourceOrdinalSpan !== undefined,
            ].filter(Boolean).length > 1
          )
            throw new LcmToolError(
              "lcm_unavailable",
              "Use only one query scope: summaryID, sourceRanges, sourceSpan, or sourceOrdinalSpan.",
            )
          yield* ctx.ask({
            permission: "lcm_expand_query",
            patterns:
              params.sourceRanges?.map((range) => range.sourceID) ??
              (params.sourceSpan
                ? [params.sourceSpan.startSourceID, params.sourceSpan.endSourceID]
                : [params.summaryID ?? "*"]),
            always: ["*"],
            metadata: {
              summaryID: params.summaryID,
              sourceRanges: params.sourceRanges?.length,
              sourceSpan: Boolean(params.sourceSpan),
              sourceOrdinalSpan: Boolean(params.sourceOrdinalSpan),
            },
          })
          const sourceSessionID = lcmMemorySessionID(ctx)
          const recoveryLimits = lcmRecoveryLimits(yield* config.get())
          const view = yield* loadMemory({ sessionID: sourceSessionID, signal: ctx.abort, memory, database })
          if (params.summaryID) {
            const summary = requireSummary(view, params.summaryID)
            requireIsolatedRecoverySummary(ctx, view, summary)
          }
          const requestedSourceRanges = params.sourceRanges
            ? resolveSourceRanges(view, params.sourceRanges)
            : params.sourceSpan
              ? resolveSourceSpan(view, params.sourceSpan)
              : params.sourceOrdinalSpan
                ? resolveSourceOrdinalSpan(view, params.sourceOrdinalSpan)
                : undefined
          for (const range of requestedSourceRanges ?? []) {
            const source = view.sources.get(range.sourceID)
            if (!source) throw new LcmToolError("lcm_stale_lineage", "A ranged source is no longer current.")
            requireIsolatedRecoverySource(ctx, view, source)
          }
          const model = activeModel(ctx.extra?.model)
          if (!model) throw new LcmToolError("lcm_unavailable", "The active model is unavailable to the query tool.")
          const inputLimit = model.limit.input ?? model.limit.context
          const usable = inputLimit > 0 ? Math.max(0, inputLimit - model.limit.output) : 0
          const budgetTokens = queryExcerptBudget(usable, Boolean(requestedSourceRanges))
          const historicalCutoff =
            isolatedRecoveryPriorTurnCutoff(ctx, view) ??
            (params.summaryID || requestedSourceRanges
              ? undefined
              : priorTurnSourceCutoff(view, sourceSessionID === ctx.sessionID ? ctx.messages : view.transcript))
          const maximumOrdinal =
            historicalCutoff ?? Math.max(-1, ...[...view.sources.values()].map((source) => source.ordinal))
          const trustedStructuralUnit =
            ctx.agent === LCM_RECOVERY_AGENT
              ? trustedStructuralSemanticUnit({
                  view,
                  query,
                  maxOrdinal: maximumOrdinal,
                  sourceRanges: requestedSourceRanges,
                })
              : undefined
          const unmatchedStructuralScope =
            ctx.agent === LCM_RECOVERY_AGENT &&
            !trustedStructuralUnit &&
            Boolean(structuralRecoveryScope(view, query, maximumOrdinal))
          if (trustedStructuralUnit)
            semanticQuestion = trustedStructuralSemanticQuestion(semanticAuthority, trustedStructuralUnit.index)
          const sourceRanges = trustedStructuralUnit?.semanticRanges ?? requestedSourceRanges
          const retrieval = selectQueryExcerpts(
            view,
            query,
            params.summaryID,
            budgetTokens,
            historicalCutoff,
            sourceRanges,
            ctx.agent === LCM_RECOVERY_AGENT ? "balanced_recovery" : "complete_frontier",
          )
          const searched = sourceRanges
            ? {
                sources: new Set(sourceRanges.map((range) => range.sourceID)).size,
                summaries: 0,
                ranges: sourceRanges.length,
                bytes: sourceRanges.reduce((total, range) => total + range.endOffset - range.startOffset, 0),
              }
            : { sources: view.sources.size, summaries: view.summaries.size }
          const rangeScope = sourceRanges
            ? {
                kind: params.sourceSpan
                  ? ("inclusive_source_span" as const)
                  : params.sourceOrdinalSpan
                    ? ("inclusive_source_ordinal_span" as const)
                    : ("ordered_source_ranges" as const),
                semanticUnitGuaranteed: Boolean(trustedStructuralUnit),
                ...(trustedStructuralUnit ? { hostStructuralUnitIndex: trustedStructuralUnit.index } : {}),
                ranges: sourceRanges.map(({ sourceID, sourceKind, ordinal, startOffset, endOffset, totalBytes }) => ({
                  sourceID,
                  sourceKind,
                  ordinal,
                  startOffset,
                  endOffset,
                  totalBytes,
                })),
              }
            : undefined
          if (retrieval.selected.length === 0) {
            return {
              title: "Conversation Memory query",
              output: inertOutput({
                answer: "",
                citations: [],
                coverage: "none",
                ...(rangeScope ? { scope: rangeScope } : {}),
                searched,
                relevant: retrieval.relevant,
                selected: 0,
                truncated: false,
                noAnswerReason: "no_relevant_memory",
              }),
              metadata: expandQueryMetadata({
                citations: 0,
                truncated: false,
                ...(trustedStructuralUnit ? { semanticUnitIndex: trustedStructuralUnit.index } : {}),
                semanticCoverage: "none",
              }),
            }
          }
          const semanticOrder = querySemanticOrder(semanticAuthority)
          const semanticRank = semanticOrder?.rank ?? 1
          const semanticDirection = semanticOrder?.direction
          const candidateSemanticPlan = hierarchicalSemanticPlan({
            trustedStructuralUnit: trustedStructuralUnit !== undefined,
            direction: semanticDirection,
            sourceRanges,
            selected: retrieval.selected,
          })
          const candidateSemanticShards = candidateSemanticPlan?.shards ?? []
          const hierarchicalInferenceCount =
            candidateSemanticShards.length > 1 &&
            trustedStructuralUnit !== undefined &&
            trustedStructuralUnit.semanticInferenceRequirement !== undefined &&
            recoveryLimits.semanticInferenceLimit >= trustedStructuralUnit.semanticInferenceRequirement
              ? hierarchicalSemanticInferenceCount(candidateSemanticShards.length)
              : undefined
          const nestedInference = queryUsesNestedInference(
            ctx.agent,
            Boolean(sourceRanges),
            Boolean(sourceRanges) && (!retrieval.truncated || hierarchicalInferenceCount !== undefined),
          )
          const recoverySemanticScope =
            ctx.agent === LCM_RECOVERY_AGENT && nestedInference
              ? recoverySemanticScopeKey({
                  revisionID: view.revision?.id,
                  summaryID: params.summaryID,
                  sourceRanges,
                  semanticUnitIndex: trustedStructuralUnit?.index,
                  direction: semanticDirection,
                  rank: semanticRank,
                })
              : undefined
          const recoverySemanticReservation =
            recoverySemanticScope !== undefined
              ? reserveLcmRecoverySemanticScope(
                  ctx.sessionID,
                  recoverySemanticScope,
                  hierarchicalInferenceCount,
                  recoveryLimits,
                )
              : undefined
          if (recoverySemanticReservation === "repeated") {
            return {
              title: "Conversation Memory semantic scope already processed",
              output: inertOutput({
                answerKind: "research_evidence",
                answer: "",
                citations: [],
                coverage: "none",
                callGuidance: repeatedSemanticScopeGuidance(),
                ...(rangeScope ? { scope: rangeScope } : {}),
                searched,
                relevant: retrieval.relevant,
                selected: 0,
                truncated: false,
                noAnswerReason: "repeated_semantic_scope",
              }),
              metadata: expandQueryMetadata({
                citations: 0,
                truncated: false,
                isolatedResearchEvidence: true,
                providerInference: false,
                ...(trustedStructuralUnit ? { semanticUnitIndex: trustedStructuralUnit.index } : {}),
                lcmRecoverySemanticScopeRepeated: true,
              }),
            }
          }
          const cancelledSemanticQuery = () => {
            if (recoverySemanticScope) releaseLcmRecoverySemanticScope(ctx.sessionID, recoverySemanticScope)
            return new LcmToolError("lcm_cancelled", "The Conversation Memory query was cancelled.")
          }
          const providerInference =
            nestedInference && (ctx.agent !== LCM_RECOVERY_AGENT || recoverySemanticReservation !== "none")
          const hierarchical = recoverySemanticReservation === "hierarchical"
          const semanticCandidates =
            hierarchical && candidateSemanticPlan ? candidateSemanticPlan.candidates : retrieval.selected
          const requestedMaxAnswerTokens =
            ctx.agent === LCM_RECOVERY_AGENT && !providerInference
              ? Math.min(params.maxAnswerTokens ?? Number.POSITIVE_INFINITY, isolatedQueryEvidenceTokenBudget(usable))
              : params.maxAnswerTokens
          const maxAnswerTokens = queryResultTokenLimit(ctx.agent, requestedMaxAnswerTokens, providerInference)
          const mayExtract = Boolean(sourceRanges) || retrieval.handles.length > 0 || retrieval.terms.length >= 2
          if (!providerInference) {
            const extracted = mayExtract
              ? extractiveQueryFallback(
                  retrieval.selected,
                  retrieval.terms,
                  maxAnswerTokens * 4,
                  retrieval.completeThroughPriority,
                  retrieval.direction,
                )
              : { answer: "", citations: [] }
            const coverage = extracted.answer ? ("partial" as const) : ("none" as const)
            return {
              title: "Conversation Memory research evidence",
              output: inertOutput({
                answerKind: "research_evidence",
                ...extracted,
                coverage,
                callGuidance: isolatedQueryEvidenceGuidance(retrieval.truncated),
                ...(rangeScope ? { scope: rangeScope } : {}),
                searched,
                relevant: retrieval.relevant,
                selected: retrieval.selected.length,
                truncated: retrieval.truncated,
                ...(!extracted.answer ? { noAnswerReason: "insufficient_query_evidence" } : {}),
              }),
              metadata: expandQueryMetadata({
                citations: extracted.citations.length,
                truncated: retrieval.truncated,
                isolatedResearchEvidence: true,
                providerInference: false,
                ...(trustedStructuralUnit ? { semanticUnitIndex: trustedStructuralUnit.index } : {}),
                semanticCoverage: coverage,
              }),
            }
          }
          const queryAgent = yield* agents.get(ctx.agent)
          const runSemantic = (question: string, excerpts: string, answerMode: QueryAnswerMode) =>
            memory
              .query({
                sessionID: sourceSessionID,
                model,
                agent: queryAgent,
                question,
                excerpts,
                maxOutputTokens: maxAnswerTokens,
                answerMode,
                signal: ctx.abort,
              })
              .pipe(
                Effect.map((value) => ({ ok: true as const, value })),
                Effect.catch((error) =>
                  Effect.succeed<SemanticQueryResult>({
                    ok: false as const,
                    reason:
                      error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "provider_error",
                  }),
                ),
              )
          type SemanticQueryValue = {
            text: string
            cost: number
            usage: {
              inputTokens: number
              outputTokens: number
              reasoningTokens: number
              cacheReadTokens: number
              cacheWriteTokens: number
              cost: number
            }
            finish?: string
          }
          type SemanticQueryResult =
            | { ok: true; value: SemanticQueryValue }
            | { ok: false; reason: "cancelled" | "provider_error" }
          const semanticModelUsage = {
            providerCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          }
          const accountSemantic = (value: { cost: number; usage: Omit<typeof semanticModelUsage, "providerCalls"> }) =>
            Effect.gen(function* () {
              semanticModelUsage.providerCalls++
              semanticModelUsage.inputTokens += value.usage.inputTokens
              semanticModelUsage.outputTokens += value.usage.outputTokens
              semanticModelUsage.reasoningTokens += value.usage.reasoningTokens
              semanticModelUsage.cacheReadTokens += value.usage.cacheReadTokens
              semanticModelUsage.cacheWriteTokens += value.usage.cacheWriteTokens
              yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, value.cost).pipe(
                Effect.provideService(Database.Service, database),
              )
            })
          const semanticShards = hierarchical ? candidateSemanticShards : []
          let hierarchicalCoverageComplete = false
          let hierarchicalCandidates: ReturnType<typeof hierarchicalIndependentCandidates> = []
          let hierarchicalEvidenceAnswers: QueryAnswer[] = []
          let hierarchicalEvidencePasses: { answer?: QueryAnswer; selected: readonly Candidate[] }[] = []
          let hierarchicalAnswer: QueryAnswer | undefined
          let semanticPassDiagnostics: unknown
          let generated: SemanticQueryResult
          if (
            hierarchical &&
            trustedStructuralUnit !== undefined &&
            (semanticDirection === "first" || semanticDirection === "last")
          ) {
            type SemanticShardAnalysis = {
              shard: Candidate[]
              result: SemanticQueryResult
              parsed?: QueryAnswer
              verifiedEvents: VerifiedSemanticEvent[]
              rejection?: QueryResponseRejection
              status: "complete" | "cancelled" | "provider_error" | "incomplete_response" | "invalid_response"
              originShard: number
              repairSegment?: number
              repairSegments?: number
              repairReason?: StructuralShardRepairReason
            }
            const analyzeSemanticShard = (
              shard: Candidate[],
              question: string,
              originShard: number,
              repair?: { segment: number; segments: number },
              repairReason?: StructuralShardRepairReason,
            ) =>
              Effect.gen(function* () {
                const shardResult = yield* runSemantic(
                  question,
                  semanticQueryExcerpts(shard, "shard"),
                  "structural_unit_shard",
                )
                if (!shardResult.ok && shardResult.reason === "cancelled") throw cancelledSemanticQuery()
                if (shardResult.ok) yield* accountSemantic(shardResult.value)
                const shardAllowed = new Set(shard.map((item) => item.id))
                const parsedResult =
                  shardResult.ok && shardResult.value.finish === "stop"
                    ? parseQueryResponseDetailed(shardResult.value.text, shardAllowed)
                    : undefined
                const candidate = withHostVerifiedSemanticEvidence(parsedResult?.answer, shard)
                const parsed = candidate?.coverage === "none" || candidate?.events?.length ? candidate : undefined
                const verifiedEvents = hostVerifiedSemanticEvents(parsed, shard)
                const status: SemanticShardAnalysis["status"] = !shardResult.ok
                  ? shardResult.reason
                  : shardResult.value.finish !== "stop"
                    ? "incomplete_response"
                    : parsed
                      ? "complete"
                      : "invalid_response"
                return {
                  shard,
                  result: shardResult,
                  parsed,
                  verifiedEvents,
                  ...(parsedResult?.rejection
                    ? { rejection: parsedResult.rejection }
                    : candidate && !parsed
                      ? { rejection: "missing_structured_events" as const }
                      : {}),
                  status,
                  originShard,
                  ...(repair ? { repairSegment: repair.segment, repairSegments: repair.segments } : {}),
                  ...(repairReason ? { repairReason } : {}),
                } satisfies SemanticShardAnalysis
              })
            const primaryShardAnalyses: SemanticShardAnalysis[] = []
            for (const [index, shard] of semanticShards.entries()) {
              primaryShardAnalyses.push(
                yield* analyzeSemanticShard(
                  shard,
                  trustedStructuralShardQuestion({
                    question: semanticAuthority,
                    unitIndex: trustedStructuralUnit.index,
                    shardIndex: index + 1,
                    shardCount: semanticShards.length,
                    direction: semanticDirection,
                    rank: semanticRank,
                  }),
                  index + 1,
                ),
              )
            }
            const repairs = new Map<number, SemanticShardAnalysis[]>()
            const semanticInferences = lcmRecoveryBudgetStats(ctx.sessionID)?.semanticInferences ?? 0
            const shardRepairPlan = hierarchicalSemanticShardRepairPlan({
              shards: primaryShardAnalyses,
              direction: semanticDirection,
              rank: semanticRank,
              availableInferences: recoveryLimits.semanticInferenceLimit - semanticInferences,
            })
            for (const repair of shardRepairPlan) {
              const index = repair.index
              const shard = semanticShards[index]!
              const repairShards = semanticQueryShards(shard, repair.parts)
              if (
                repairShards.length < 1 ||
                !reserveLcmRecoverySemanticInferences(ctx.sessionID, repairShards.length, recoveryLimits)
              )
                continue
              const analyses: SemanticShardAnalysis[] = []
              for (const [repairIndex, repairShard] of repairShards.entries()) {
                analyses.push(
                  yield* analyzeSemanticShard(
                    repairShard,
                    trustedStructuralShardRepairQuestion({
                      question: semanticAuthority,
                      unitIndex: trustedStructuralUnit.index,
                      shardIndex: index + 1,
                      shardCount: semanticShards.length,
                      repairIndex: repairIndex + 1,
                      repairCount: repairShards.length,
                      direction: semanticDirection,
                      rank: semanticRank,
                      reason: repair.reason,
                    }),
                    index + 1,
                    { segment: repairIndex + 1, segments: repairShards.length },
                    repair.reason,
                  ),
                )
              }
              repairs.set(index, analyses)
            }
            const shardAnalyses = primaryShardAnalyses.flatMap((analysis, index) => {
              const repaired = repairs.get(index)
              if (!repaired) return [analysis]
              return repaired.map((repair) => {
                const additive = additiveStructuralShardResult({
                  primary: analysis.parsed,
                  primarySelected: analysis.shard,
                  repair: repair.parsed,
                  repairSelected: repair.shard,
                  ranges: sourceRanges!,
                  direction: semanticDirection,
                  rank: semanticRank,
                })
                return {
                  ...repair,
                  parsed: additive.answer,
                  verifiedEvents: additive.events,
                }
              })
            })
            const independentShardAnalyses = primaryShardAnalyses.flatMap((analysis, index) => [
              analysis,
              ...(repairs.get(index) ?? []),
            ])
            const reductionFallbackCandidates = shardAnalyses.flatMap((analysis) =>
              analysis.parsed && analysis.status === "complete" ? [] : analysis.shard,
            )
            const reductionEvidence = shardAnalyses
              .map((analysis, index) =>
                hierarchicalReductionShardEvidence({
                  shard: index + 1,
                  status: analysis.status,
                  ...(analysis.parsed ? { result: analysis.parsed } : {}),
                  ...(!analysis.parsed || analysis.status !== "complete"
                    ? { exactFallback: semanticQueryExcerpts(analysis.shard, "shard") }
                    : {}),
                }),
              )
              .join("\n\n")
            const allowed = hierarchicalReductionAllowedCitations(
              shardAnalyses.map((analysis) => analysis.parsed),
              reductionFallbackCandidates,
            )
            const shardHasCandidate = shardAnalyses.some(
              (analysis) => analysis.parsed && analysis.parsed.coverage !== "none",
            )
            const verificationAllowed = new Set(semanticCandidates.map((item) => item.id))
            type SemanticPassAnalysis = {
              result: SemanticQueryResult
              candidate?: QueryAnswer
              parsed?: QueryAnswer
              rejection?: QueryResponseRejection
              accepted: boolean
              status: "complete" | "provider_error" | "incomplete_response" | "invalid_no_answer" | "invalid_response"
            }
            const analyzeSemanticPass = (
              result: SemanticQueryResult,
              passAllowed: Set<string>,
            ): SemanticPassAnalysis => {
              const parsedResult =
                result.ok && result.value.finish === "stop"
                  ? parseQueryResponseDetailed(result.value.text, passAllowed)
                  : undefined
              const candidate = withHostVerifiedSemanticEvidence(parsedResult?.answer, semanticCandidates)
              const parsed = structuralOrdinalAnswer({
                answer: candidate,
                selected: semanticCandidates,
                ranges: sourceRanges!,
                direction: semanticDirection,
                rank: semanticRank,
              })
              const rejection =
                parsedResult?.rejection ??
                (candidate && candidate.coverage !== "none" && !parsed
                  ? ("missing_structured_events" as const)
                  : undefined)
              const accepted = Boolean(parsed && !(parsed.coverage === "none" && shardHasCandidate))
              const status: SemanticPassAnalysis["status"] = !result.ok
                ? "provider_error"
                : result.value.finish !== "stop"
                  ? "incomplete_response"
                  : parsed
                    ? accepted
                      ? "complete"
                      : "invalid_no_answer"
                    : "invalid_response"
              return { result, candidate, parsed, rejection, accepted, status }
            }
            const runSemanticPass = (
              question: string,
              excerpts: string,
              answerMode: "structural_unit_reduction" | "structural_unit_verification",
              passAllowed: Set<string>,
            ) =>
              Effect.gen(function* () {
                const result = yield* runSemantic(question, excerpts, answerMode)
                if (!result.ok && result.reason === "cancelled") throw cancelledSemanticQuery()
                if (result.ok) yield* accountSemantic(result.value)
                return analyzeSemanticPass(result, passAllowed)
              })
            const reductionQuestion = trustedStructuralReductionQuestion({
              question: semanticAuthority,
              unitIndex: trustedStructuralUnit.index,
              shardCount: shardAnalyses.length,
              direction: semanticDirection,
              rank: semanticRank,
            })
            const verificationQuestion = trustedStructuralVerificationQuestion({
              question: semanticAuthority,
              unitIndex: trustedStructuralUnit.index,
              direction: semanticDirection,
              rank: semanticRank,
            })
            const verificationEvidence = semanticQueryExcerpts(semanticCandidates, "unit")
            const reductionAttempts = [
              yield* runSemanticPass(reductionQuestion, reductionEvidence, "structural_unit_reduction", allowed),
            ]
            const verificationAttempts = [
              yield* runSemanticPass(
                verificationQuestion,
                verificationEvidence,
                "structural_unit_verification",
                verificationAllowed,
              ),
            ]
            const repairPlan = hierarchicalSemanticPassRepairPlan({
              reductionAccepted: reductionAttempts[0]!.accepted,
              verificationAccepted: verificationAttempts[0]!.accepted,
            })
            const repairReason = (analysis: SemanticPassAnalysis): StructuralPassRepairReason =>
              analysis.rejection ?? (analysis.status === "complete" ? "invalid_response" : analysis.status)
            const repairsReserved =
              repairPlan.length > 0 &&
              reserveLcmRecoverySemanticInferences(ctx.sessionID, repairPlan.length, recoveryLimits)
            if (repairsReserved) {
              for (const pass of repairPlan) {
                if (pass === "reduction") {
                  const failed = reductionAttempts.at(-1)!
                  reductionAttempts.push(
                    yield* runSemanticPass(
                      trustedStructuralPassRepairQuestion({
                        question: reductionQuestion,
                        pass,
                        reason: repairReason(failed),
                      }),
                      reductionEvidence,
                      "structural_unit_reduction",
                      allowed,
                    ),
                  )
                  continue
                }
                const failed = verificationAttempts.at(-1)!
                verificationAttempts.push(
                  yield* runSemanticPass(
                    trustedStructuralPassRepairQuestion({
                      question: verificationQuestion,
                      pass,
                      reason: repairReason(failed),
                    }),
                    verificationEvidence,
                    "structural_unit_verification",
                    verificationAllowed,
                  ),
                )
              }
            }
            const reductionAnalysis =
              reductionAttempts.find((analysis) => analysis.accepted) ?? reductionAttempts.at(-1)!
            const verificationAnalysis =
              verificationAttempts.find((analysis) => analysis.accepted) ?? verificationAttempts.at(-1)!
            const reduction = reductionAnalysis.result
            const verification = verificationAnalysis.result
            const reductionParsed = reductionAnalysis.parsed
            const reductionAccepted = reductionAnalysis.accepted
            const verificationParsed = verificationAnalysis.parsed
            const verificationAccepted = verificationAnalysis.accepted
            const shardEventAnswer = structuralOrdinalAnswerFromPasses({
              passes: shardAnalyses.flatMap((analysis) =>
                analysis.parsed
                  ? [
                      {
                        answer: analysis.parsed,
                        selected: analysis.shard,
                        verifiedEvents: analysis.verifiedEvents,
                      },
                    ]
                  : [],
              ),
              ranges: sourceRanges!,
              direction: semanticDirection,
              rank: semanticRank,
              coverage: "partial",
            })
            const provisionalReductions = reductionAttempts.flatMap((analysis) => {
              const answer = provisionalHierarchicalPassAnswer(analysis.candidate)
              return answer ? [answer] : []
            })
            const provisionalVerifications = verificationAttempts.flatMap((analysis) => {
              const answer = provisionalHierarchicalPassAnswer(analysis.candidate)
              return answer ? [answer] : []
            })
            const provisionalReduction = provisionalReductions.at(-1)
            const provisionalVerification = provisionalVerifications.at(-1)
            const reductionForReconciliation = reductionAccepted ? reductionParsed : provisionalReduction
            const verificationForReconciliation = verificationAccepted ? verificationParsed : provisionalVerification
            hierarchicalCandidates = hierarchicalIndependentCandidates({
              shardAggregate: shardEventAnswer,
              reduction: reductionForReconciliation,
              verification: verificationForReconciliation,
            })
            hierarchicalEvidenceAnswers = [
              ...(shardEventAnswer ? [shardEventAnswer] : []),
              ...provisionalReductions,
              ...(reductionAccepted && reductionParsed ? [reductionParsed] : []),
              ...provisionalVerifications,
              ...(verificationAccepted && verificationParsed ? [verificationParsed] : []),
            ]
            hierarchicalEvidencePasses = independentShardAnalyses.flatMap((analysis) =>
              analysis.parsed ? [{ answer: analysis.parsed, selected: analysis.shard }] : [],
            )
            const successfulShards = shardAnalyses.filter(
              (analysis) => analysis.parsed && analysis.parsed.coverage !== "none",
            )
            generated =
              verification.ok && verificationAccepted
                ? verification
                : reduction.ok && reductionAccepted
                  ? reduction
                  : semanticDirection === "first"
                    ? (successfulShards[0]?.result ?? reduction)
                    : (successfulShards.at(-1)?.result ?? reduction)
            hierarchicalAnswer = hierarchicalReconciledAnswer({
              shardAggregate: shardEventAnswer,
              reduction: reductionAccepted ? reductionParsed : undefined,
              verification: verificationAccepted ? verificationParsed : undefined,
            })
            hierarchicalCoverageComplete = hierarchicalPassComplete({
              shardStatuses: shardAnalyses.map((analysis) => analysis.status),
              shardAggregate: shardEventAnswer,
              reduction: reductionAccepted ? reductionParsed : undefined,
              verification: verificationAccepted ? verificationParsed : undefined,
            })
            semanticPassDiagnostics = {
              strategy: "chronological_shard_reduce",
              targetBytes: SEMANTIC_UNIT_SHARD_TARGET_BYTES,
              repairParts: SEMANTIC_SHARD_REPAIR_PARTS,
              primaryShards: primaryShardAnalyses.length,
              repairedPrimaryShards: repairs.size,
              recheckedNegativePrimaryShards: shardRepairPlan.filter((repair) => repair.reason === "unconfirmed_none")
                .length,
              recheckedPartialPrimaryShards: shardRepairPlan.filter((repair) => repair.reason === "unconfirmed_partial")
                .length,
              preservedPrimaryShardResults: [...repairs.keys()].filter((index) => {
                const parsed = primaryShardAnalyses[index]?.parsed
                return parsed && parsed.coverage !== "none"
              }).length,
              completeCoverage: hierarchicalCoverageComplete,
              shards: shardAnalyses.map((analysis, index) => ({
                index: index + 1,
                originShard: analysis.originShard,
                ...(analysis.repairSegment
                  ? { repairSegment: analysis.repairSegment, repairSegments: analysis.repairSegments }
                  : {}),
                ...(analysis.repairReason ? { repairReason: analysis.repairReason } : {}),
                bytes: analysis.shard.reduce((total, item) => total + Buffer.byteLength(item.text), 0),
                status: analysis.status,
                fallbackProvided: !analysis.parsed,
                ...(analysis.rejection ? { rejection: analysis.rejection } : {}),
                ...(analysis.result.ok ? { finish: analysis.result.value.finish } : {}),
                ...(analysis.parsed
                  ? {
                      coverage: analysis.parsed.coverage,
                      answer: analysis.parsed.answer.slice(0, SEMANTIC_PASS_DIAGNOSTIC_ANSWER_CHARS),
                      citations: analysis.parsed.citations,
                    }
                  : {}),
              })),
              reduction: {
                status: reductionAnalysis.status,
                repairAttempted: reductionAttempts.length > 1,
                repairReserved: repairsReserved && repairPlan.includes("reduction"),
                ...(reductionAnalysis.rejection ? { rejection: reductionAnalysis.rejection } : {}),
                ...(reduction.ok ? { finish: reduction.value.finish } : {}),
                verifiedEvidence: reductionAnalysis.candidate?.evidence?.length ?? 0,
                verifiedEvents: reductionAnalysis.candidate?.events?.length ?? 0,
                attempts: reductionAttempts.map((analysis) => ({
                  status: analysis.status,
                  ...(analysis.rejection ? { rejection: analysis.rejection } : {}),
                  ...(analysis.result.ok ? { finish: analysis.result.value.finish } : {}),
                  verifiedEvidence: analysis.candidate?.evidence?.length ?? 0,
                  verifiedEvents: analysis.candidate?.events?.length ?? 0,
                })),
                ...(reductionParsed
                  ? {
                      coverage: reductionParsed.coverage,
                      answer: reductionParsed.answer.slice(0, SEMANTIC_PASS_DIAGNOSTIC_ANSWER_CHARS),
                      citations: reductionParsed.citations,
                    }
                  : {}),
              },
              verification: {
                status: verificationAnalysis.status,
                repairAttempted: verificationAttempts.length > 1,
                repairReserved: repairsReserved && repairPlan.includes("blind_audit"),
                ...(verificationAnalysis.rejection ? { rejection: verificationAnalysis.rejection } : {}),
                ...(verification.ok ? { finish: verification.value.finish } : {}),
                verifiedEvidence: verificationAnalysis.candidate?.evidence?.length ?? 0,
                verifiedEvents: verificationAnalysis.candidate?.events?.length ?? 0,
                attempts: verificationAttempts.map((analysis) => ({
                  status: analysis.status,
                  ...(analysis.rejection ? { rejection: analysis.rejection } : {}),
                  ...(analysis.result.ok ? { finish: analysis.result.value.finish } : {}),
                  verifiedEvidence: analysis.candidate?.evidence?.length ?? 0,
                  verifiedEvents: analysis.candidate?.events?.length ?? 0,
                })),
                ...(verificationParsed
                  ? {
                      coverage: verificationParsed.coverage,
                      answer: verificationParsed.answer.slice(0, SEMANTIC_PASS_DIAGNOSTIC_ANSWER_CHARS),
                      citations: verificationParsed.citations,
                    }
                  : {}),
              },
            }
          } else {
            generated = yield* runSemantic(
              semanticQuestion,
              semanticQueryExcerpts(retrieval.selected, sourceRanges ? "unit" : "unscoped"),
              trustedStructuralUnit ? "single_structural_unit" : "default",
            )
            if (generated.ok) yield* accountSemantic(generated.value)
          }
          if (!generated.ok && generated.reason === "cancelled") throw cancelledSemanticQuery()
          const allowed = new Set(semanticCandidates.map((item) => item.id))
          const completeResponse = generated.ok && generated.value.finish === "stop"
          const rawParsedResponse =
            hierarchical && hierarchicalAnswer
              ? hierarchicalAnswer
              : generated.ok && completeResponse
                ? parseQueryResponse(generated.value.text, allowed)
                : undefined
          const parsedResponse = hierarchicalQueryCoverage(
            rawParsedResponse,
            hierarchical,
            hierarchicalCoverageComplete,
          )
          const generatedNoAnswer = parsedResponse?.coverage === "none"
          const validatedNoAnswer = Boolean(generatedNoAnswer && hierarchicalCoverageComplete)
          const retrievalScopeIncomplete = retrieval.truncated && !hierarchicalCoverageComplete
          const answer = honestQueryCoverage(
            generatedNoAnswer && !validatedNoAnswer ? undefined : parsedResponse,
            retrievalScopeIncomplete,
          )
          const fallbackAnswerTokens =
            ctx.agent === LCM_RECOVERY_AGENT ? MAX_ISOLATED_QUERY_EVIDENCE_TOKENS : maxAnswerTokens
          const extracted = mayExtract
            ? extractiveQueryFallback(
                retrieval.selected,
                retrieval.terms,
                fallbackAnswerTokens * 4,
                retrieval.completeThroughPriority,
                retrieval.direction,
              )
            : { answer: "", citations: [] }
          const fallback = {
            ...extracted,
            coverage: extracted.answer ? ("partial" as const) : ("none" as const),
          }
          const unbounded = answer ?? fallback
          const candidateEvidence = boundedSemanticCandidateEvidence(
            hierarchicalEvidenceAnswers.length > 0 ? hierarchicalEvidenceAnswers : [answer],
            semanticCandidates,
            sourceRanges,
            semanticDirection,
            semanticRank,
            hierarchicalEvidencePasses,
            hierarchical && !hierarchicalCoverageComplete,
          )
          const resultAnswerTokens = answer ? maxAnswerTokens : fallbackAnswerTokens
          const answerTruncated = unbounded.answer.length > resultAnswerTokens * 4
          const result = {
            citations: unbounded.citations,
            coverage: unbounded.coverage,
            answer: unbounded.answer.slice(0, resultAnswerTokens * 4),
          }
          const providerFailureReason = !answer
            ? mayExtract
              ? generated.ok
                ? completeResponse
                  ? generatedNoAnswer
                    ? "no_answer"
                    : "invalid_response"
                  : "incomplete_response"
                : generated.reason
              : undefined
            : undefined
          if (providerFailureReason === "provider_error" && recoverySemanticScope)
            releaseLcmRecoverySemanticScope(ctx.sessionID, recoverySemanticScope)
          return {
            title: "Conversation Memory query",
            output: inertOutput({
              ...(!answer && mayExtract
                ? {
                    answerKind: "extractive_fallback",
                    callGuidance: queryFallbackGuidance(providerFailureReason),
                  }
                : {
                    answerKind: "generated",
                    callGuidance: querySuccessGuidance(
                      !retrievalScopeIncomplete && (answer?.coverage === "full" || validatedNoAnswer),
                      hierarchicalCandidates.length > 0,
                      unmatchedStructuralScope,
                    ),
                  }),
              ...result,
              ...(hierarchicalCandidates.length > 0 ? { independentCandidates: hierarchicalCandidates } : {}),
              ...(candidateEvidence.length > 0 ? { candidateEvidence } : {}),
              ...(rangeScope ? { scope: rangeScope } : {}),
              ...(hierarchical
                ? {
                    semanticPass: {
                      strategy: "chronological_shard_reduce",
                      shards: semanticShards.length,
                      completeCoverage: hierarchicalCoverageComplete,
                    },
                  }
                : {}),
              searched,
              relevant: retrieval.relevant,
              selected: semanticCandidates.length,
              truncated: retrievalScopeIncomplete || answerTruncated,
              ...(!answer
                ? mayExtract
                  ? { providerFailureReason }
                  : { noAnswerReason: "insufficient_query_evidence" }
                : {}),
            }),
            metadata: expandQueryMetadata({
              citations: result.citations.length,
              truncated: retrievalScopeIncomplete || answerTruncated,
              providerInference: true,
              ...(trustedStructuralUnit ? { semanticUnitIndex: trustedStructuralUnit.index } : {}),
              semanticCoverage: result.coverage,
              ...(hierarchical ? { semanticPassComplete: hierarchicalCoverageComplete } : {}),
              ...(semanticModelUsage.providerCalls > 0 ? { semanticModelUsage } : {}),
              ...(semanticPassDiagnostics ? { semanticPassDiagnostics } : {}),
            }),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
