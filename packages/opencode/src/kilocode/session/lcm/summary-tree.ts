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
import { LCM_TREE_POLICY } from "./types"

const POLICY = LCM_TREE_POLICY
const MAX_LEAF_TOKENS = 20_000
const MAX_ROOTS = 8
const CONDENSE_COUNT = 4
const RECOVERY_HANDLE = /\b(?:src|sum)_[a-f0-9]{24}\b/g

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

export function rollForwardItems(input: {
  revision: FrontierRevision
  previousSources: FinalSource[]
  sources: FinalSource[]
}) {
  const appended =
    input.previousSources.length > 0 &&
    input.sources.length > input.previousSources.length &&
    input.previousSources.every(
      (source, index) =>
        source.id === input.sources[index]?.id &&
        source.digest === input.sources[index]?.digest &&
        source.ordinal === input.sources[index]?.ordinal,
    )
  if (!appended) return
  return [
    ...input.revision.items,
    ...input.sources.slice(input.previousSources.length).map((source) => ({
      kind: "source" as const,
      id: source.id,
      ordinal: source.ordinal,
    })),
  ].toSorted((a, b) => a.ordinal - b.ordinal)
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

function deterministic(children: TreeItem[], limit: number, allowed: Set<string>) {
  const header = children
    .map((item) => {
      const excerpt = item.excerpt
        .replace(RECOVERY_HANDLE, (handle) => (allowed.has(handle) ? handle : "[referenced memory]"))
        .replace(/\s+/g, " ")
        .trim()
      return `${item.id} [${item.firstOrdinal}-${item.lastOrdinal}] ${excerpt}`
    })
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

function valid(candidate: string, sourceTokens: number, sourceBytes: number, target: number, allowed: Set<string>) {
  const candidateBytes = Buffer.byteLength(candidate)
  const candidateTokens = Math.max(1, Math.ceil(candidateBytes / 4))
  const handles = candidate.match(RECOVERY_HANDLE) ?? []
  const contentCharacters = candidate.replace(RECOVERY_HANDLE, "").replace(/\s/gu, "").length
  return (
    candidate.trim().length > 0 &&
    candidateBytes < sourceBytes &&
    candidateTokens < sourceTokens &&
    candidateTokens <= Math.ceil(target * 1.15) &&
    handles.length > 0 &&
    contentCharacters >= 16 &&
    handles.every((handle) => allowed.has(handle))
  )
}

export class SummaryTree {
  constructor(
    private readonly store: ConversationMemoryStore,
    private readonly generator?: SummaryGenerator,
  ) {}

  private async allowedHandles(sessionID: string, items: TreeItem[]) {
    const allowed = new Set(items.map((item) => item.id))
    const visited = new Set<string>()
    const visit = async (summaryID: string): Promise<void> => {
      if (visited.has(summaryID)) return
      visited.add(summaryID)
      for (const child of await this.store.listChildren(sessionID, summaryID)) {
        allowed.add(child.id)
        if (child.kind === "summary") await visit(child.id)
      }
    }
    for (const item of items) {
      if (item.kind === "summary") await visit(item.id)
    }
    return allowed
  }

  private async createSummary(input: {
    sessionID: string
    items: TreeItem[]
    level: number
    usableInputTokens: number
    maintenanceMode: "soft" | "hard" | "manual"
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
    const allowed = await this.allowedHandles(input.sessionID, input.items)
    let candidate: SummaryCandidate | undefined
    if (this.generator) {
      const values = input.items.map((item) => item.source ?? item.summary).filter(Boolean) as Array<
        FinalSource | SummaryNode
      >
      const generate = async (mode: "normal" | "aggressive") => {
        try {
          return await this.generator!.generate({
            sessionID: input.sessionID,
            children: values,
            targetTokens: target,
            usableInputTokens: input.usableInputTokens,
            mode,
            signal: input.signal,
          })
        } catch (error) {
          if (input.signal?.aborted) throw error
          return
        }
      }
      candidate = await generate("normal")
      if (!candidate || !valid(candidate.text, sourceTokens, sourceBytes, target, allowed)) {
        if (candidate?.attempt)
          await this.store.recordAttempt({
            ...candidate.attempt,
            nodeKey: key,
            sessionID: input.sessionID,
            errorCode: candidate.attempt.errorCode ?? "lcm_summary_rejected",
          })
        if (input.maintenanceMode === "soft") return
        candidate = await generate("aggressive")
      }
    }
    if (!candidate || !valid(candidate.text, sourceTokens, sourceBytes, target, allowed)) {
      if (candidate?.attempt)
        await this.store.recordAttempt({
          ...candidate.attempt,
          nodeKey: key,
          sessionID: input.sessionID,
          errorCode: candidate.attempt.errorCode ?? "lcm_summary_rejected",
        })
      candidate = { text: deterministic(input.items, target, allowed), mode: "deterministic" }
    }
    if (!valid(candidate.text, sourceTokens, sourceBytes, target, allowed)) return
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
    const attempt = candidate.attempt
      ? {
          ...candidate.attempt,
          nodeKey: key,
          sessionID: input.sessionID,
          mode: candidate.mode,
        }
      : undefined
    await this.store.commitSummary({ summary, children, ...(attempt ? { attempt } : {}) })
    return summary
  }

  private async item(sessionID: string, item: FrontierItem): Promise<TreeItem | undefined> {
    if (item.kind === "source") {
      const value = await this.store.getSource(sessionID, item.id)
      return value ? sourceItem(value) : undefined
    }
    const value = await this.store.getSummary(sessionID, item.id)
    return value ? summaryItem(value) : undefined
  }

  private async items(sessionID: string, revision: FrontierRevision | undefined, sources: FinalSource[]) {
    if (!revision) return sources.map(sourceItem)
    const result: TreeItem[] = []
    for (const value of revision.items) {
      const loaded = await this.item(sessionID, value)
      if (!loaded) return sources.map(sourceItem)
      result.push(loaded)
    }
    return result.toSorted((a, b) => a.firstOrdinal - b.firstOrdinal)
  }

  private revision(input: {
    sessionID: string
    lineage: TranscriptLineage
    reason: FrontierRevision["reason"]
    items: TreeItem[]
  }): FrontierRevision {
    return {
      id: sortableID("rev"),
      sessionID: input.sessionID,
      lineageDigest: input.lineage.digest,
      reason: input.reason,
      items: input.items.map((item) => ({
        kind: item.kind,
        id: item.id,
        ordinal: item.firstOrdinal,
      })),
      createdAt: Date.now(),
    }
  }

  private async summarizeRaw(input: {
    sessionID: string
    items: TreeItem[]
    maxEligibleOrdinal: number
    usableInputTokens: number
    one: boolean
    maintenanceMode: "soft" | "hard" | "manual"
    signal?: AbortSignal
  }) {
    let changed = false
    for (let index = 0; index < input.items.length; ) {
      abort(input.signal)
      if (input.items[index]?.kind !== "source" || input.items[index]!.lastOrdinal > input.maxEligibleOrdinal) {
        index++
        continue
      }
      let end = index
      const eligible: FinalSource[] = []
      while (
        end < input.items.length &&
        input.items[end]?.kind === "source" &&
        input.items[end]!.lastOrdinal <= input.maxEligibleOrdinal
      ) {
        eligible.push(input.items[end]!.source!)
        end++
      }
      const groups = windows(eligible, input.usableInputTokens)
      const replacements: TreeItem[] = []
      let consumed = 0
      for (const group of groups) {
        const created = await this.createSummary({
          sessionID: input.sessionID,
          items: group.map(sourceItem),
          level: 0,
          usableInputTokens: input.usableInputTokens,
          maintenanceMode: input.maintenanceMode,
          signal: input.signal,
        })
        if (!created) {
          replacements.push(...group.map(sourceItem))
        } else {
          replacements.push(summaryItem(created))
          changed = true
        }
        consumed += group.length
        if (input.one && changed) {
          replacements.push(...eligible.slice(consumed).map(sourceItem))
          break
        }
      }
      input.items.splice(index, end - index, ...replacements)
      index += replacements.length
      if (input.one && changed) break
    }
    return changed
  }

  private async promote(input: {
    sessionID: string
    items: TreeItem[]
    maxEligibleOrdinal: number
    usableInputTokens: number
    targetTokens: number
    force: boolean
    maintenanceMode: "soft" | "hard" | "manual"
    signal?: AbortSignal
  }) {
    let changed = false
    const total = () => input.items.reduce((sum, item) => sum + item.tokens, 0)
    while (
      input.force
        ? total() > input.targetTokens
        : input.items.filter((item) => item.kind === "summary").length > MAX_ROOTS
    ) {
      abort(input.signal)
      const eligible = input.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.kind === "summary" && item.lastOrdinal <= input.maxEligibleOrdinal)
      if (eligible.length < 2) break
      const group = eligible.slice(0, CONDENSE_COUNT)
      if (!input.force && group.length < CONDENSE_COUNT) break
      const first = group[0]!.index
      const last = group.at(-1)!.index
      if (last - first + 1 !== group.length) break
      const children = group.map(({ item }) => item)
      const before = children.reduce((sum, item) => sum + item.tokens, 0)
      const created = await this.createSummary({
        sessionID: input.sessionID,
        items: children,
        level: Math.max(...children.map((item) => item.summary?.level ?? -1)) + 1,
        usableInputTokens: input.usableInputTokens,
        maintenanceMode: input.maintenanceMode,
        signal: input.signal,
      })
      if (!created || created.tokens >= before) break
      input.items.splice(first, group.length, summaryItem(created))
      changed = true
      if (!input.force) break
    }
    return changed
  }

  async maintain(input: {
    sessionID: string
    lineage: TranscriptLineage
    usableInputTokens: number
    maxEligibleOrdinal: number
    targetTokens: number
    mode: "soft" | "hard" | "manual"
    signal?: AbortSignal
  }): Promise<FrontierRevision | undefined> {
    const sources = await this.store.listSources(input.sessionID)
    if (input.maxEligibleOrdinal < 0 || sources.length === 0) return
    const active = await this.store.activeRevision(input.sessionID, input.lineage.digest)
    const items = await this.items(input.sessionID, active, sources)
    const rawChanged = await this.summarizeRaw({
      sessionID: input.sessionID,
      items,
      maxEligibleOrdinal: input.maxEligibleOrdinal,
      usableInputTokens: input.usableInputTokens,
      one: input.mode === "soft",
      maintenanceMode: input.mode,
      signal: input.signal,
    })
    const promoted =
      input.mode === "soft" && rawChanged
        ? false
        : await this.promote({
            sessionID: input.sessionID,
            items,
            maxEligibleOrdinal: input.maxEligibleOrdinal,
            usableInputTokens: input.usableInputTokens,
            targetTokens: input.targetTokens,
            force: input.mode !== "soft",
            maintenanceMode: input.mode,
            signal: input.signal,
          })
    if (!rawChanged && !promoted) return active
    const revision = this.revision({
      sessionID: input.sessionID,
      lineage: input.lineage,
      reason: input.mode === "soft" ? "soft_leaf" : input.mode === "hard" ? "hard_level" : "manual",
      items,
    })
    await this.store.commitRevision(revision)
    return revision
  }

  /** Compatibility wrapper for direct tree tests and local callers. */
  async build(input: {
    sessionID: string
    lineage: TranscriptLineage
    usableInputTokens: number
    protectedSources: number
    reason: "background" | "hard_built" | FrontierRevision["reason"]
    signal?: AbortSignal
  }) {
    const sources = await this.store.listSources(input.sessionID)
    return this.maintain({
      sessionID: input.sessionID,
      lineage: input.lineage,
      usableInputTokens: input.usableInputTokens,
      maxEligibleOrdinal: sources.length - input.protectedSources - 1,
      targetTokens: Math.floor(input.usableInputTokens * 0.4),
      mode: input.reason === "background" || input.reason === "soft_leaf" ? "soft" : "hard",
      signal: input.signal,
    })
  }
}
