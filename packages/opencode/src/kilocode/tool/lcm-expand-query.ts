import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
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
  claimLcmRecoverySemanticInference,
  lcmRecoveryLimits,
  lcmRecoveryQuestion,
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
const EXACT_RANGE_QUERY_INPUT_RATIO = 0.5
const EXACT_RANGE_QUERY_INPUT_CAP = 64_000
const MAX_STRUCTURAL_RECOVERY_UNITS = 32
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
}

interface QueryAnswer {
  answer: string
  citations: string[]
  coverage: "full" | "partial" | "none"
}

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
      contentScope: {
        sourceOrdinalSpan: {
          startOrdinal: unit.opening.ordinal,
          endOrdinal: unit.closing.ordinal,
          startOffset: unit.opening.byteEnd,
          endOffset: unit.closing.byteStart,
        },
      },
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
  const rangeCandidates: Candidate[] = (sourceRanges ?? []).map((range, index) => ({
    key: `${index}:${range.sourceID}:${range.startOffset}-${range.endOffset}`,
    id: range.sourceID,
    kind: "source",
    ordinal: range.ordinal,
    lastOrdinal: range.ordinal,
    text: range.text,
    score: 1,
    sourceKind: range.sourceKind,
    sourceRange: range,
  }))
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
        ...allMemoryCandidates
          .filter((candidate) => candidate.key !== summaryID)
          .toSorted((a, b) => a.ordinal - b.ordinal || a.key.localeCompare(b.key)),
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

  if (!summaryID && view.revision) {
    // The active frontier is the model-visible index of the whole retained session. Represent it before allowing
    // numerous overlapping raw descendants with generic lexical hits to crowd older semantic units out.
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

function parseQueryResponse(text: string, allowed: Set<string>): QueryAnswer | undefined {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start === -1 || end < start) return
  try {
    const value = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>
    if (
      typeof value.answer !== "string" ||
      !Array.isArray(value.citations) ||
      !value.citations.every((item) => typeof item === "string" && allowed.has(item)) ||
      !["full", "partial", "none"].includes(String(value.coverage))
    )
      return
    const coverage = value.coverage as QueryAnswer["coverage"]
    const citations = [...new Set(value.citations as string[])]
    if (coverage === "none") {
      if (value.answer.trim() || citations.length > 0) return
      return { answer: "", citations: [], coverage }
    }
    if (!value.answer.trim() || citations.length === 0) return
    return { answer: value.answer.trim(), citations, coverage }
  } catch {
    return
  }
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

export function querySuccessGuidance(completeCoverage: boolean) {
  const citationGuidance =
    " Source handles and scope ranges in this result are retrieval provenance, not parent citation intervals. In isolated StructuredOutput, omit citations unless lcm_grep or lcm_read already established a decisive sourceID/startOffset/endOffset interval of at most 512 UTF-8 bytes."
  if (completeCoverage)
    return {
      generatedAnswerAccepted: true,
      completeCoverage: true,
      instruction: `This validated cited synthesis covered the retrieved scope without clipping. If it resolves the question, answer now instead of decomposing the same scope or paging its sources. Full retrieved-scope coverage is not automatic proof of exact or exhaustive completeness outside explicitly bounded sourceRanges. When exact verification is still necessary, make at most one bounded sourceRanges grep or targeted lcm_read for the decisive candidate or boundary, then answer; do not scan cited sources page by page.${citationGuidance}`,
    }
  return {
    generatedAnswerAccepted: true,
    completeCoverage: false,
    instruction: `This synthesis is a cited candidate from incomplete or partial evidence. Do not treat it as exhaustive or as proof of a first, last, count, or complete list. Verify only the decisive candidate and required boundary with at most one bounded sourceRanges grep or targeted read, then answer; do not scan cited sources page by page.${citationGuidance}`,
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
          ? `This is clipped inert evidence from ${structuralUnits} exact host-matched raw structural units, not a computed answer. Raw source order and each hostStructuralScope unit's paired markers are authoritative; overlapping summary interpretations are excluded. Resolve the units independently: issue one scoped lcm_expand_query per unit using that unit's contentScope.sourceOrdinalSpan, preferably together in one parallel tool batch when the configured budget permits. A complete single-unit scope may return a concise semantic result. Preserve unit index and order for the final synthesis. Do not send the clipped combined exactEnvelope as one semantic query and never replace these scopes with an unscoped query. If the configured budget cannot cover every unit, return partial coverage and name the unresolved units.${citationGuidance}`
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
  }
}

export function extractiveQueryFallback(
  selected: Array<{
    id: string
    text: string
    priority?: number
    sourceKind?: SourceKind
    sourceRange?: Pick<ResolvedSourceRange, "ordinal" | "startOffset" | "endOffset">
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
        "Primary semantic recovery for earlier current-session memory: synthesize or aggregate one focused candidate answer from fairly budgeted, match-centered excerpts with validated src_/sum_ citations. Use this when meaning, event status, paraphrases, ordering, or evidence across sources matters; prefer it to manually paging large sources. For a document, section, or other semantic unit, pass ordered sourceRanges copied from the structural-anchor map so bytes before its opening and after its close cannot contaminate the answer. Include chronological intermediate sources. Inside isolated recovery, a complete single-unit exact scope may use one nested semantic inference; clipped exact scopes return deterministic bounded evidence so the evidence-bearing child performs the synthesis. Unscoped or summary-scoped calls may also use the configured nested semantic-inference budget. When the question spans multiple host-matched structural units, query each represented unit independently before aggregating them. For exact, exhaustive, first/last, count, or complete-list work, verify only cited candidates and necessary boundaries with bounded sourceRanges grep or targeted lcm_read before claiming completeness.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          let query = params.query.trim()
          if (ctx.agent === LCM_RECOVERY_AGENT) {
            const currentSession = yield* sessions.get(ctx.sessionID)
            const bound = lcmRecoveryQuestion({ agent: ctx.agent, session: currentSession })
            if (!bound)
              throw new LcmToolError("lcm_unavailable", "The trusted isolated recovery question is unavailable.")
            query = bound
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
          const sourceRanges = params.sourceRanges
            ? resolveSourceRanges(view, params.sourceRanges)
            : params.sourceSpan
              ? resolveSourceSpan(view, params.sourceSpan)
              : params.sourceOrdinalSpan
                ? resolveSourceOrdinalSpan(view, params.sourceOrdinalSpan)
                : undefined
          for (const range of sourceRanges ?? []) {
            const source = view.sources.get(range.sourceID)
            if (!source) throw new LcmToolError("lcm_stale_lineage", "A ranged source is no longer current.")
            requireIsolatedRecoverySource(ctx, view, source)
          }
          const model = activeModel(ctx.extra?.model)
          if (!model) throw new LcmToolError("lcm_unavailable", "The active model is unavailable to the query tool.")
          const inputLimit = model.limit.input ?? model.limit.context
          const usable = inputLimit > 0 ? Math.max(0, inputLimit - model.limit.output) : 0
          const budgetTokens = queryExcerptBudget(usable, Boolean(sourceRanges))
          const historicalCutoff =
            isolatedRecoveryPriorTurnCutoff(ctx, view) ??
            (params.summaryID || sourceRanges
              ? undefined
              : priorTurnSourceCutoff(view, sourceSessionID === ctx.sessionID ? ctx.messages : view.transcript))
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
                semanticUnitGuaranteed: false,
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
              metadata: { citations: 0, truncated: false },
            }
          }
          const nestedInference = queryUsesNestedInference(
            ctx.agent,
            Boolean(sourceRanges),
            Boolean(sourceRanges) && !retrieval.truncated,
          )
          const providerInference =
            nestedInference &&
            (ctx.agent !== LCM_RECOVERY_AGENT || claimLcmRecoverySemanticInference(ctx.sessionID, recoveryLimits))
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
              metadata: {
                citations: extracted.citations.length,
                truncated: retrieval.truncated,
                isolatedResearchEvidence: true,
                providerInference: false,
              },
            }
          }
          const excerpts = [
            ...(sourceRanges
              ? [
                  "[Exact ordered source byte-range scope. Only the labeled half-open ranges belong to the requested semantic unit. Preserve range order; omission markers denote unseen in-scope text.]",
                ]
              : []),
            ...retrieval.selected.map((item) =>
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
          const generated = yield* memory
            .query({
              sessionID: sourceSessionID,
              model,
              agent: yield* agents.get(ctx.agent),
              question: query,
              excerpts,
              maxOutputTokens: maxAnswerTokens,
              signal: ctx.abort,
            })
            .pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catch((error) =>
                Effect.succeed({
                  ok: false as const,
                  reason: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "provider_error",
                }),
              ),
            )
          if (!generated.ok && generated.reason === "cancelled")
            throw new LcmToolError("lcm_cancelled", "The Conversation Memory query was cancelled.")
          if (generated.ok)
            yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, generated.value.cost).pipe(
              Effect.provideService(Database.Service, database),
            )
          const allowed = new Set(retrieval.selected.map((item) => item.id))
          const completeResponse = generated.ok && generated.value.finish === "stop"
          const parsedResponse =
            generated.ok && completeResponse ? parseQueryResponse(generated.value.text, allowed) : undefined
          const generatedNoAnswer = parsedResponse?.coverage === "none"
          const answer = honestQueryCoverage(generatedNoAnswer ? undefined : parsedResponse, retrieval.truncated)
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
          const resultAnswerTokens = answer ? maxAnswerTokens : fallbackAnswerTokens
          const answerTruncated = unbounded.answer.length > resultAnswerTokens * 4
          const result = {
            ...unbounded,
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
                    callGuidance: querySuccessGuidance(!retrieval.truncated && answer?.coverage === "full"),
                  }),
              ...result,
              ...(rangeScope ? { scope: rangeScope } : {}),
              searched,
              relevant: retrieval.relevant,
              selected: retrieval.selected.length,
              truncated: retrieval.truncated || answerTruncated,
              ...(!answer
                ? mayExtract
                  ? { providerFailureReason }
                  : { noAnswerReason: "insufficient_query_evidence" }
                : {}),
            }),
            metadata: {
              citations: result.citations.length,
              truncated: retrieval.truncated || answerTruncated,
              providerInference: true,
              ...(generated.ok ? { semanticModelUsage: generated.value.usage } : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
