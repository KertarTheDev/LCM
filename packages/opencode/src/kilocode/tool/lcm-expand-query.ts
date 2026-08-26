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
  requireSummary,
  type MemoryView,
} from "./lcm-common"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Question about earlier content in the current session (1-4096 characters).",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description: "Optional active sum_ handle whose descendants bound the search.",
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
  id: string
  kind: "source" | "summary"
  ordinal: number
  lastOrdinal: number
  text: string
  score: number
}

interface QueryAnswer {
  answer: string
  citations: string[]
  coverage: "full" | "partial" | "none"
}

function scope(summaryID: string, view: MemoryView) {
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

function bookends(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  const marker = "\n[… omitted …]\n"
  if (maxChars <= marker.length + 2) return text.slice(0, maxChars)
  const available = maxChars - marker.length
  const head = Math.ceil(available / 2)
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (available - head))}`
}

export function queryExcerpt(text: string, terms: string[], maxChars: number) {
  const limit = Math.max(1, Math.floor(maxChars))
  if (text.length <= limit) return text
  const lower = text.toLocaleLowerCase()
  const positions = terms
    .flatMap((term) => {
      const first = lower.indexOf(term)
      if (first < 0) return []
      const last = lower.lastIndexOf(term)
      return last === first
        ? [{ start: first, end: first + term.length }]
        : [
            { start: first, end: first + term.length },
            { start: last, end: last + term.length },
          ]
    })
    .filter(
      (position, index, all) =>
        all.findIndex((other) => other.start === position.start && other.end === position.end) === index,
    )
    .toSorted((a, b) => a.start - b.start || a.end - b.end)
  if (positions.length === 0) return bookends(text, limit)

  const separator = "\n[… omitted …]\n"
  const maxWindows = Math.max(1, Math.min(8, Math.floor(limit / 200)))
  const chosen =
    positions.length <= maxWindows
      ? positions
      : Array.from(
          { length: maxWindows },
          (_, index) => positions[Math.round((index * (positions.length - 1)) / Math.max(1, maxWindows - 1))]!,
        )
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
  view: MemoryView,
  query: string,
  summaryID: string | undefined,
  budgetTokens: number,
  maxOrdinal?: number,
) {
  const { handles, terms } = queryParts(query)
  const allowed = summaryID ? scope(summaryID, view) : undefined
  const candidates: Candidate[] = [
    ...[...view.sources.values()]
      .filter((source) => maxOrdinal === undefined || source.ordinal <= maxOrdinal)
      .map((source) => ({
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
    .filter((item) => item.score > 0)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        (a.kind === b.kind ? 0 : a.kind === "source" ? -1 : 1) ||
        b.ordinal - a.ordinal ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 8)

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
    truncated: selected.some((item) => item.text.length < candidates.find((c) => c.id === item.id)!.text.length),
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
        "Synthesize one focused candidate answer about earlier current-session memory from fairly budgeted, match-centered excerpts with validated src_/sum_ citations. For exact, exhaustive, boundary, first/last, count, or complete-list work, verify cited candidates with lcm_grep and lcm_read before claiming completeness.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const query = params.query.trim()
          if (query.length < 1 || query.length > 4096)
            throw new LcmToolError("lcm_unavailable", "The query must contain 1 through 4096 characters.")
          if (params.maxAnswerTokens !== undefined && !Number.isFinite(params.maxAnswerTokens))
            throw new LcmToolError("lcm_unavailable", "The answer token limit must be a finite number.")
          const maxAnswerTokens = Math.min(2_000, Math.max(1, Math.floor(params.maxAnswerTokens ?? 1_000)))
          yield* ctx.ask({
            permission: "lcm_expand_query",
            patterns: [params.summaryID ?? "*"],
            always: ["*"],
            metadata: { summaryID: params.summaryID },
          })
          const view = yield* loadMemory({ sessionID: ctx.sessionID, signal: ctx.abort, memory, database })
          if (params.summaryID) requireSummary(view, params.summaryID)
          const model = activeModel(ctx.extra?.model)
          if (!model) throw new LcmToolError("lcm_unavailable", "The active model is unavailable to the query tool.")
          const inputLimit = model.limit.input ?? model.limit.context
          const usable = inputLimit > 0 ? Math.max(0, inputLimit - model.limit.output) : 0
          const budgetTokens = usable > 0 ? Math.min(16_000, Math.max(1_000, Math.floor(usable * 0.2))) : 4_000
          const historicalCutoff = params.summaryID ? undefined : priorTurnSourceCutoff(view, ctx.messages)
          const retrieval = selectQueryExcerpts(view, query, params.summaryID, budgetTokens, historicalCutoff)
          if (retrieval.selected.length === 0) {
            return {
              title: "Conversation Memory query",
              output: inertOutput({
                answer: "",
                citations: [],
                coverage: "none",
                searched: { sources: view.sources.size, summaries: view.summaries.size },
                relevant: 0,
                truncated: false,
                noAnswerReason: "no_relevant_memory",
              }),
              metadata: { citations: 0, truncated: false },
            }
          }
          const excerpts = retrieval.selected
            .map((item) =>
              [
                `[${item.id} | ${item.kind} | ${
                  item.ordinal === item.lastOrdinal
                    ? `ordinal ${item.ordinal}`
                    : `ordinals ${item.ordinal}-${item.lastOrdinal}`
                }]`,
                item.text,
              ].join("\n"),
            )
            .join("\n\n")
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
          const mayExtract = retrieval.handles.length > 0 || retrieval.terms.length >= 2
          const fallback = mayExtract
            ? {
                answer: retrieval.selected
                  .map((item) => `[${item.id}] ${item.text.slice(0, 800)}`)
                  .join("\n\n")
                  .slice(0, maxAnswerTokens * 4),
                citations: retrieval.selected.map((item) => item.id),
                coverage: "partial" as const,
              }
            : { answer: "", citations: [], coverage: "none" as const }
          const unbounded = answer ?? fallback
          const answerTruncated = unbounded.answer.length > maxAnswerTokens * 4
          const result = {
            ...unbounded,
            answer: unbounded.answer.slice(0, maxAnswerTokens * 4),
          }
          return {
            title: "Conversation Memory query",
            output: inertOutput({
              ...result,
              searched: { sources: view.sources.size, summaries: view.summaries.size },
              relevant: retrieval.selected.length,
              truncated: retrieval.truncated || answerTruncated,
              ...(!answer
                ? mayExtract
                  ? {
                      providerFailureReason: generated.ok
                        ? completeResponse
                          ? "invalid_response"
                          : "incomplete_response"
                        : generated.reason,
                    }
                  : { noAnswerReason: "insufficient_query_evidence" }
                : {}),
            }),
            metadata: { citations: result.citations.length, truncated: retrieval.truncated || answerTruncated },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
