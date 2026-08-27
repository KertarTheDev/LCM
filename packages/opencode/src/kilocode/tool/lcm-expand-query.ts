import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { KiloCostPropagation } from "@/kilocode/session/cost-propagation"
import {
  inertOutput,
  LcmToolError,
  loadMemory,
  priorTurnSourceCutoff,
  requireSource,
  requireSummary,
  type MemoryView,
} from "./lcm-common"
import { utf8SearchWindow } from "./lcm-grep"

const MAX_QUERY_EXCERPTS = 8
const MAX_SOURCE_RANGES = 32

const SourceRange = Schema.Struct({
  sourceID: Schema.String.annotate({ description: "Exact current-session src_ source handle." }),
  startOffset: Schema.optional(Schema.Number).annotate({
    description: "Inclusive UTF-8 byte offset; defaults to the source start.",
  }),
  endOffset: Schema.optional(Schema.Number).annotate({
    description: "Exclusive UTF-8 byte offset; defaults to the source end.",
  }),
})

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Question about earlier content in the current session (1-4096 characters).",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description:
      "Optional active sum_ handle whose descendants bound the search. Mutually exclusive with sourceRanges.",
  }),
  sourceRanges: Schema.optional(Schema.Array(SourceRange)).annotate({
    description:
      "Optional ordered semantic scope of 1-32 exact source byte ranges. Use the structural-anchor map: start after an opening marker, include chronological intermediate sources, and end before the matching closing marker. Mutually exclusive with summaryID.",
  }),
  maxAnswerTokens: Schema.optional(Schema.Number).annotate({
    description: "Maximum answer size in tokens (default 1000, maximum 2000).",
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
  "from",
  "have",
  "into",
  "list",
  "only",
  "return",
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
  sourceRange?: ResolvedSourceRange
}

export interface ResolvedSourceRange {
  sourceID: string
  ordinal: number
  startOffset: number
  endOffset: number
  totalBytes: number
  text: string
}

interface QueryAnswer {
  answer: string
  citations: string[]
  coverage: "full" | "partial" | "none"
}

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

export function resolveSourceRanges(
  view: Pick<MemoryView, "sources" | "content">,
  ranges: ReadonlyArray<{ sourceID: string; startOffset?: number; endOffset?: number }>,
) {
  if (ranges.length < 1 || ranges.length > MAX_SOURCE_RANGES)
    throw new LcmToolError("lcm_unavailable", `Source range scope must contain 1 through ${MAX_SOURCE_RANGES} ranges.`)
  const resolved: ResolvedSourceRange[] = []
  for (const range of ranges) {
    if (
      (range.startOffset !== undefined && (!Number.isSafeInteger(range.startOffset) || range.startOffset < 0)) ||
      (range.endOffset !== undefined && (!Number.isSafeInteger(range.endOffset) || range.endOffset < 0))
    )
      throw new LcmToolError("lcm_unavailable", "Source ranges require non-negative integer UTF-8 byte offsets.")
    const { source, content } = requireSource(view, range.sourceID)
    let window: ReturnType<typeof utf8SearchWindow>
    try {
      window = utf8SearchWindow(content.content, range.startOffset ?? 0, range.endOffset)
    } catch {
      throw new LcmToolError(
        "lcm_unavailable",
        "A source range is outside its source or is not aligned to UTF-8 byte boundaries.",
      )
    }
    if (window.byteOffset >= window.endOffset)
      throw new LcmToolError("lcm_unavailable", "Every source range must contain at least one UTF-8 byte.")
    const previous = resolved.at(-1)
    if (
      previous &&
      (source.ordinal < previous.ordinal ||
        (source.ordinal === previous.ordinal &&
          (source.id !== previous.sourceID || window.byteOffset < previous.endOffset)))
    )
      throw new LcmToolError(
        "lcm_unavailable",
        "Source ranges must be in chronological order and must not overlap within one source.",
      )
    resolved.push({
      sourceID: source.id,
      ordinal: source.ordinal,
      startOffset: window.byteOffset,
      endOffset: window.endOffset,
      totalBytes: window.totalBytes,
      text: window.text,
    })
  }
  return resolved
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

export function queryExcerpt(text: string, terms: string[], maxChars: number) {
  const limit = Math.max(1, Math.floor(maxChars))
  if (text.length <= limit) return text
  const lower = text.toLocaleLowerCase()
  const positions: Array<{ start: number; end: number; term: string }> = []
  const frequencies = new Map<string, number>()
  const seen = new Set<string>()
  const perTermLimit = Math.max(1, Math.min(4_096, Math.floor(16_384 / Math.max(1, terms.length))))
  for (const term of terms) {
    let offset = 0
    let termMatches = 0
    while (termMatches < perTermLimit) {
      const start = lower.indexOf(term, offset)
      if (start < 0) break
      const end = start + term.length
      const key = `${start}:${end}`
      if (!seen.has(key)) {
        seen.add(key)
        positions.push({ start, end, term })
      }
      termMatches++
      offset = start + Math.max(1, term.length)
    }
    frequencies.set(term, termMatches)
  }
  positions.sort((a, b) => a.start - b.start || a.end - b.end)

  const separator = "\n[… omitted …]\n"
  const maxWindows = Math.max(1, Math.min(8, Math.floor(limit / 120)))
  const chosen: typeof positions = []
  const chosenKeys = new Set<string>()
  const add = (position: (typeof positions)[number]) => {
    const key = `${position.start}:${position.end}`
    if (chosenKeys.has(key) || chosen.length >= maxWindows) return
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
        left.position.start - right.position.start ||
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
    // Mix source chronology with local relevance. Either signal alone can hide decisive paraphrased or isolated facts.
    addTimeline(Math.min(3, maxWindows - 1))
    for (const candidate of ranked) add(candidate.position)
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
) {
  const { handles, terms } = queryParts(query)
  const allowed = summaryID ? scope(summaryID, view) : undefined
  const rangeCandidates: Candidate[] = (sourceRanges ?? []).map((range, index) => ({
    key: `${index}:${range.sourceID}:${range.startOffset}-${range.endOffset}`,
    id: range.sourceID,
    kind: "source",
    ordinal: range.ordinal,
    lastOrdinal: range.ordinal,
    text: range.text,
    score: 1,
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
          const lexical = terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0)
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
  const chosenKeys = new Set(lexicalCandidates.slice(0, MAX_QUERY_EXCERPTS).map((candidate) => candidate.key))
  const memoryCandidates = [
    ...lexicalCandidates.slice(0, MAX_QUERY_EXCERPTS),
    ...evenlySpaced(
      semanticPool.filter((candidate) => !chosenKeys.has(candidate.key)),
      Math.max(0, MAX_QUERY_EXCERPTS - chosenKeys.size),
    ),
  ]
  const relevant = sourceRanges
    ? rangeCandidates
    : [...new Map([...lexicalCandidates, ...semanticPool].map((candidate) => [candidate.key, candidate])).values()]
  const candidates = sourceRanges ? relevant : memoryCandidates
  const candidateLimitReached = candidates.length < relevant.length

  let remaining = Math.max(1, budgetTokens) * 4
  const selected: Candidate[] = []
  for (const [index, candidate] of candidates.entries()) {
    if (remaining <= 0) break
    const fair = Math.max(1, Math.floor(remaining / (candidates.length - index)))
    const text = queryExcerpt(candidate.text, terms, fair)
    if (!text) continue
    selected.push({ ...candidate, text })
    remaining -= text.length
  }
  return {
    selected,
    handles,
    terms,
    relevant: relevant.length,
    candidateLimitReached,
    truncated:
      candidateLimitReached ||
      selected.length < candidates.length ||
      selected.some(
        (item) => item.text.length < candidates.find((candidate) => candidate.key === item.key)!.text.length,
      ),
  }
}

export function parseQueryAnswer(text: string, allowed: Set<string>): QueryAnswer | undefined {
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
    if (coverage === "none") return { answer: "", citations: [], coverage }
    if (!value.answer.trim() || citations.length === 0) return
    return { answer: value.answer.trim(), citations, coverage }
  } catch {
    return
  }
}

export function completeQueryAnswer(text: string, finish: string | undefined, allowed: Set<string>) {
  if (finish !== "stop") return
  return parseQueryAnswer(text, allowed)
}

export function extractiveQueryFallback(
  selected: Array<{ id: string; text: string }>,
  terms: string[],
  maxChars: number,
) {
  const blocks: string[] = []
  const citations: string[] = []
  let remaining = Math.max(0, Math.floor(maxChars))
  for (const [index, item] of selected.entries()) {
    const separator = blocks.length > 0 ? "\n\n" : ""
    const available = remaining - separator.length
    const share = Math.floor(available / (selected.length - index))
    const label = `[${item.id}] `
    if (share <= label.length) continue
    const excerpt = queryExcerpt(item.text, terms, share - label.length)
    if (!excerpt) continue
    const block = `${label}${excerpt}`
    blocks.push(block)
    if (!citations.includes(item.id)) citations.push(item.id)
    remaining -= separator.length + block.length
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
    return {
      description:
        "Primary semantic recovery for earlier current-session memory: synthesize or aggregate one focused candidate answer from fairly budgeted, match-centered excerpts with validated src_/sum_ citations. Use this when meaning, event status, paraphrases, ordering, or evidence across sources matters; prefer it to manually paging large sources. For a document, section, or other semantic unit, pass ordered sourceRanges copied from the structural-anchor map so bytes before its opening and after its close cannot contaminate the answer. Include chronological intermediate sources. For exact, exhaustive, first/last, count, or complete-list work, verify only cited candidates and necessary boundaries with bounded lcm_grep or lcm_read before claiming completeness.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const query = params.query.trim()
          if (query.length < 1 || query.length > 4096)
            throw new LcmToolError("lcm_unavailable", "The query must contain 1 through 4096 characters.")
          if (params.maxAnswerTokens !== undefined && !Number.isFinite(params.maxAnswerTokens))
            throw new LcmToolError("lcm_unavailable", "The answer token limit must be a finite number.")
          if (params.summaryID && params.sourceRanges)
            throw new LcmToolError("lcm_unavailable", "Use either summaryID or sourceRanges, not both.")
          const maxAnswerTokens = Math.min(2_000, Math.max(1, Math.floor(params.maxAnswerTokens ?? 1_000)))
          yield* ctx.ask({
            permission: "lcm_expand_query",
            patterns: params.sourceRanges?.map((range) => range.sourceID) ?? [params.summaryID ?? "*"],
            always: ["*"],
            metadata: { summaryID: params.summaryID, sourceRanges: params.sourceRanges?.length },
          })
          const view = yield* loadMemory({ sessionID: ctx.sessionID, signal: ctx.abort, memory, database })
          if (params.summaryID) requireSummary(view, params.summaryID)
          const sourceRanges = params.sourceRanges ? resolveSourceRanges(view, params.sourceRanges) : undefined
          const model = activeModel(ctx.extra?.model)
          if (!model) throw new LcmToolError("lcm_unavailable", "The active model is unavailable to the query tool.")
          const inputLimit = model.limit.input ?? model.limit.context
          const usable = inputLimit > 0 ? Math.max(0, inputLimit - model.limit.output) : 0
          const budgetTokens = usable > 0 ? Math.min(16_000, Math.max(1_000, Math.floor(usable * 0.2))) : 4_000
          const historicalCutoff =
            params.summaryID || sourceRanges ? undefined : priorTurnSourceCutoff(view, ctx.messages)
          const retrieval = selectQueryExcerpts(
            view,
            query,
            params.summaryID,
            budgetTokens,
            historicalCutoff,
            sourceRanges,
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
                kind: "ordered_source_ranges" as const,
                semanticUnitGuaranteed: false,
                ranges: sourceRanges.map(({ sourceID, ordinal, startOffset, endOffset, totalBytes }) => ({
                  sourceID,
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
          const excerpts = [
            ...(sourceRanges
              ? [
                  "[Exact ordered source byte-range scope. Only the labeled half-open ranges belong to the requested semantic unit. Preserve range order; omission markers denote unseen in-scope text.]",
                ]
              : []),
            ...retrieval.selected.map((item) =>
              [
                item.sourceRange
                  ? `[${item.id} | source | ordinal ${item.ordinal} | bytes ${item.sourceRange.startOffset}-${item.sourceRange.endOffset}]`
                  : `[${item.id} | ${item.kind} | ${
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
              sessionID: ctx.sessionID,
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
          const answer = generated.ok
            ? completeQueryAnswer(generated.value.text, generated.value.finish, allowed)
            : undefined
          const mayExtract = Boolean(sourceRanges) || retrieval.handles.length > 0 || retrieval.terms.length >= 2
          const extracted = mayExtract
            ? extractiveQueryFallback(retrieval.selected, retrieval.terms, maxAnswerTokens * 4)
            : { answer: "", citations: [] }
          const fallback = {
            ...extracted,
            coverage: extracted.answer ? ("partial" as const) : ("none" as const),
          }
          const unbounded = answer ?? fallback
          const answerTruncated = unbounded.answer.length > maxAnswerTokens * 4
          const result = {
            ...unbounded,
            answer: unbounded.answer.slice(0, maxAnswerTokens * 4),
          }
          const providerFailureReason = !answer
            ? mayExtract
              ? generated.ok
                ? completeResponse
                  ? "invalid_response"
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
                    callGuidance: {
                      generatedAnswerAccepted: false,
                      instruction:
                        "The provider did not return a complete validated synthesis. The answer field contains bounded evidence excerpts, not a computed answer. Do not present it as the resolved answer or count omission markers as evidence. Use it to refine one genuinely different query or verify only the remaining candidates and boundaries.",
                    },
                  }
                : { answerKind: "generated" }),
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
            metadata: { citations: result.citations.length, truncated: retrieval.truncated || answerTruncated },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
