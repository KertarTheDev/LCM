import { lineageDigest, nodeKey, sha256, sortableID, summaryID } from "./ids"
import type {
  ConversationMemoryStore,
  FinalSource,
  FrontierItem,
  FrontierRevision,
  GenerationMode,
  SummaryAttempt,
  SummaryChild,
  SummaryNode,
  TranscriptLineage,
} from "./types"

const POLICY = "lcm-tree-v1"
const MAX_LEAF_TOKENS = 20_000
const MAX_ROOTS = 8
const CONDENSE_COUNT = 4

export interface SummaryCandidate {
  text: string
  mode: GenerationMode
  attempt?: SummaryAttempt
}

export interface SummaryGenerator {
  generate(input: {
    sessionID: string
    children: Array<FinalSource | SummaryNode>
    targetTokens: number
    usableInputTokens: number
    mode: "normal" | "aggressive"
    signal?: AbortSignal
  }): Promise<SummaryCandidate | undefined>
}

interface TreeItem {
  kind: "source" | "summary"
  id: string
  tokens: number
  bytes: number
  firstOrdinal: number
  lastOrdinal: number
  digest: string
  excerpt: string
  source?: FinalSource
  summary?: SummaryNode
}

function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function targetTokens(sourceTokens: number, usableInputTokens: number) {
  return Math.max(256, Math.floor(Math.min(1600, sourceTokens * 0.15, usableInputTokens * 0.1)))
}

function sourceItem(source: FinalSource): TreeItem {
  return {
    kind: "source",
    id: source.id,
    tokens: source.tokens,
    bytes: source.bytes,
    firstOrdinal: source.ordinal,
    lastOrdinal: source.ordinal,
    digest: source.digest,
    excerpt: source.excerpt,
    source,
  }
}

function summaryItem(summary: SummaryNode): TreeItem {
  return {
    kind: "summary",
    id: summary.id,
    tokens: summary.tokens,
    bytes: summary.bytes,
    firstOrdinal: summary.firstOrdinal,
    lastOrdinal: summary.lastOrdinal,
    digest: summary.digest,
    excerpt: summary.text.slice(0, 320),
    summary,
  }
}

function windows(sources: FinalSource[], usableInputTokens: number) {
  const target = Math.min(MAX_LEAF_TOKENS, Math.max(512, Math.floor(usableInputTokens * 0.3)))
  const result: FinalSource[][] = []
  let current: FinalSource[] = []
  let count = 0
  for (const source of sources) {
    if (current.length > 0 && count + source.tokens > target) {
      result.push(current)
      current = []
      count = 0
    }
    current.push(source)
    count += source.tokens
    if (count >= MAX_LEAF_TOKENS) {
      result.push(current)
      current = []
      count = 0
    }
  }
  if (current.length > 0) result.push(current)
  return result
}

function deterministic(children: TreeItem[], limit: number) {
  const header = children
    .map((item) => `${item.id} [${item.firstOrdinal}-${item.lastOrdinal}] ${item.excerpt.replace(/\s+/g, " ").trim()}`)
    .join("\n")
  const maxBytes = Math.max(256, limit * 4)
  const buffer = Buffer.from(`Conversation memory index:\n${header}`)
  if (buffer.byteLength <= maxBytes) return buffer.toString("utf8")
  const suffix = "\n[Additional detail omitted; use the cited LCM handles to recover it.]"
  const available = Math.max(0, maxBytes - Buffer.byteLength(suffix))
  return `${buffer
    .subarray(0, available)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "")}${suffix}`
}

function valid(candidate: string, sourceTokens: number, sourceBytes: number, target: number) {
  const candidateBytes = Buffer.byteLength(candidate)
  const candidateTokens = Math.max(1, Math.ceil(candidateBytes / 4))
  return (
    candidate.trim().length > 0 &&
    candidateBytes < sourceBytes &&
    candidateTokens < sourceTokens &&
    candidateTokens <= Math.ceil(target * 1.15)
  )
}

export class SummaryTree {
  constructor(
    private readonly store: ConversationMemoryStore,
    private readonly generator?: SummaryGenerator,
  ) {}

  private async createSummary(input: {
    sessionID: string
    items: TreeItem[]
    level: number
    usableInputTokens: number
    signal?: AbortSignal
  }) {
    abort(input.signal)
    const children: SummaryChild[] = input.items.map((item, ordinal) => ({
      summaryID: "",
      kind: item.kind,
      id: item.id,
      ordinal,
    }))
    const sourceDigest = lineageDigest(
      input.items.map((item, ordinal) => ({
        id: item.id,
        digest: item.digest,
        ordinal,
      })),
    )
    const key = nodeKey(children, sourceDigest, POLICY)
    const existing = await this.store.findSummary(input.sessionID, key)
    if (existing) return existing
    const sourceTokens = input.items.reduce((total, item) => total + item.tokens, 0)
    const sourceBytes = input.items.reduce((total, item) => total + item.bytes, 0)
    const target = targetTokens(sourceTokens, input.usableInputTokens)
    let candidate: SummaryCandidate | undefined
    if (this.generator) {
      const values = input.items.map((item) => item.source ?? item.summary).filter(Boolean) as Array<
        FinalSource | SummaryNode
      >
      candidate = await this.generator.generate({
        sessionID: input.sessionID,
        children: values,
        targetTokens: target,
        usableInputTokens: input.usableInputTokens,
        mode: "normal",
        signal: input.signal,
      })
      if (!candidate || !valid(candidate.text, sourceTokens, sourceBytes, target)) {
        candidate = await this.generator.generate({
          sessionID: input.sessionID,
          children: values,
          targetTokens: target,
          usableInputTokens: input.usableInputTokens,
          mode: "aggressive",
          signal: input.signal,
        })
      }
    }
    if (!candidate || !valid(candidate.text, sourceTokens, sourceBytes, target)) {
      candidate = { text: deterministic(input.items, target), mode: "deterministic" }
    }
    if (!valid(candidate.text, sourceTokens, sourceBytes, target)) return
    const id = summaryID({ nodeKey: key, text: candidate.text })
    for (const child of children) child.summaryID = id
    const summary: SummaryNode = {
      id,
      nodeKey: key,
      sessionID: input.sessionID,
      level: input.level,
      text: candidate.text,
      digest: sha256(candidate.text),
      sourceDigest,
      tokens: Math.max(1, Math.ceil(Buffer.byteLength(candidate.text) / 4)),
      bytes: Buffer.byteLength(candidate.text),
      firstOrdinal: input.items[0]!.firstOrdinal,
      lastOrdinal: input.items.at(-1)!.lastOrdinal,
      generationMode: candidate.mode,
      createdAt: Date.now(),
    }
    await this.store.commitSummary({ summary, children, ...(candidate.attempt ? { attempt: candidate.attempt } : {}) })
    return summary
  }

  async build(input: {
    sessionID: string
    lineage: TranscriptLineage
    usableInputTokens: number
    protectedSources: number
    reason: FrontierRevision["reason"]
    signal?: AbortSignal
  }): Promise<FrontierRevision | undefined> {
    const sources = await this.store.listSources(input.sessionID)
    const eligible = sources.slice(0, Math.max(0, sources.length - input.protectedSources))
    const protectedTail = sources.slice(eligible.length)
    if (eligible.length === 0) return
    const roots: TreeItem[] = []
    for (const window of windows(eligible, input.usableInputTokens)) {
      abort(input.signal)
      const created = await this.createSummary({
        sessionID: input.sessionID,
        items: window.map(sourceItem),
        level: 0,
        usableInputTokens: input.usableInputTokens,
        signal: input.signal,
      })
      if (!created) return
      roots.push(summaryItem(created))
    }
    while (roots.length > MAX_ROOTS) {
      abort(input.signal)
      const group = roots.splice(0, CONDENSE_COUNT)
      const created = await this.createSummary({
        sessionID: input.sessionID,
        items: group,
        level: Math.max(...group.map((item) => item.summary?.level ?? -1)) + 1,
        usableInputTokens: input.usableInputTokens,
        signal: input.signal,
      })
      if (!created) return
      roots.unshift(summaryItem(created))
    }
    const items: FrontierItem[] = [
      ...roots.map((item) => ({ kind: "summary" as const, id: item.id, ordinal: item.firstOrdinal })),
      ...protectedTail.map((item) => ({ kind: "source" as const, id: item.id, ordinal: item.ordinal })),
    ].toSorted((a, b) => a.ordinal - b.ordinal)
    const revision: FrontierRevision = {
      id: sortableID("rev"),
      sessionID: input.sessionID,
      lineageDigest: input.lineage.digest,
      reason: input.reason,
      items,
      createdAt: Date.now(),
    }
    await this.store.commitRevision(revision)
    return revision
  }
}
