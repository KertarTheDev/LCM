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
import { DEFAULT_SOFT_THRESHOLD_RATIO, LCM_TREE_POLICY } from "./types"

const POLICY = LCM_TREE_POLICY
const MAX_LEAF_TOKENS = 20_000
const MAX_ROOTS = 8
const CONDENSE_COUNT = 4
const RECOVERY_HANDLE = /\b(?:src|sum)_[a-f0-9]{24}\b/g
const RECOVERY_HANDLE_LIKE = /\b(?:src|sum)_(?:[a-z0-9][a-z0-9_-]*|\.{2,})/gi
const RECOVERY_FOOTER = /\n\nRecovery handles: (?:\b(?:src|sum)_[a-f0-9]{24}\b(?:, )?)+\s*$/u
const PROTOCOL_ONLY = /^(?:received|acknowledged|understood|ok(?:ay)?)[.!]?$/iu
const PROTOCOL_LINE = /(?:^|\n)\s*(?:received|acknowledged|understood|ok(?:ay)?)[.!]?\s*(?=\n|$)/iu
const TRANSFORMER_COMPLETION_LEAD =
  /^(?:i(?:'ve| have)|we(?:'ve| have))\s+(?:updated|implemented|completed|made|applied|finished|fixed|changed|created|added|removed)\b/iu
const ANSWER_WRAPPER = /^(?:<[a-z0-9_-]*(?:final|answer)[a-z0-9_-]*>|(?:```(?:json)?\s*)?\{\s*"answer"\s*:)/iu
const SUMMARY_TASK_SCAFFOLDING =
  /(?:\baccording to the system task\b|\bactive instruction is to summari[sz]e\b|\bno (?:summary|action|further response) (?:is )?required\b|\bsummary has been provided\b|^(?:i(?:'ll| will)|let me) summari[sz]e\b)/iu
const REFUSAL = /^(?:i(?:'m| am) sorry\b|i (?:cannot|can't|won't|am unable to)\b)/iu
const GROUNDING_STOP_WORDS = new Set(
  `about after again against all also and any are because been before being between both but can conversation could
  current data detail details does each earlier every following from further had has have having historical into its
  itself more most other our out over provided recovery requested same should source sources state summary task text than
  that the their them then there these they this those through under user very was were what when where which while who
  will with would`.split(/\s+/u),
)

export interface SummaryCandidate {
  text: string
  mode: GenerationMode
  grounded?: boolean
  fallbackText?: string
  attempt?: SummaryAttempt
}

export interface SummaryGenerator {
  generate(input: {
    sessionID: string
    children: Array<FinalSource | SummaryNode>
    targetTokens: number
    usableInputTokens: number
    allowedHandles: string[]
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
        .replace(RECOVERY_HANDLE_LIKE, (handle) => (allowed.has(handle) ? handle : "[referenced memory]"))
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

function substantiveCharacters(text: string) {
  return text.replace(RECOVERY_FOOTER, "").replace(RECOVERY_HANDLE, "").replace(/\s/gu, "").length
}

function groundingTerms(text: string) {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_./-]{3,}/gu) ?? []
  )
    .map((term) => term.replace(/^[./-]+|[./-]+$/gu, ""))
    .filter((term) => term.length >= 3 && !GROUNDING_STOP_WORDS.has(term) && !/^(?:src|sum)_[a-f0-9]{24}$/u.test(term))
}

export function isReceiptOnlyAcknowledgement(text: string) {
  return PROTOCOL_ONLY.test(text.trim())
}

export function summaryGrounded(sourceText: string, candidateText: string) {
  const candidateTerms = [...new Set(groundingTerms(candidateText.replace(RECOVERY_HANDLE_LIKE, " ")))]
  if (candidateTerms.length < 4) return true
  const sourceTerms = new Set(groundingTerms(sourceText.replace(RECOVERY_HANDLE_LIKE, " ")))
  return candidateTerms.some((term) => sourceTerms.has(term))
}

function candidateIssue(
  candidate: SummaryCandidate,
  sourceTokens: number,
  sourceBytes: number,
  target: number,
  allowed: Set<string>,
) {
  const trimmed = candidate.text.trim()
  const candidateBytes = Buffer.byteLength(candidate.text)
  const candidateTokens = Math.max(1, Math.ceil(candidateBytes / 4))
  const handles = candidate.text.match(RECOVERY_HANDLE) ?? []
  const handleLike = candidate.text.match(RECOVERY_HANDLE_LIKE) ?? []
  if (trimmed.length === 0) return "empty" as const
  if (candidate.attempt && candidate.attempt.finish !== "stop") return "incomplete" as const
  if (PROTOCOL_ONLY.test(trimmed) || REFUSAL.test(trimmed)) return "protocol_output" as const
  if (
    PROTOCOL_LINE.test(trimmed) ||
    TRANSFORMER_COMPLETION_LEAD.test(trimmed) ||
    ANSWER_WRAPPER.test(trimmed) ||
    SUMMARY_TASK_SCAFFOLDING.test(trimmed)
  )
    return "protocol_scaffolding" as const
  if (candidate.grounded === false) return "ungrounded" as const
  if (candidateBytes >= sourceBytes || candidateTokens >= sourceTokens) return "not_reduced" as const
  if (candidateTokens > Math.ceil(target * 1.15)) return "too_long" as const
  if (handleLike.some((handle) => !allowed.has(handle))) return "unknown_handle" as const
  if (handles.length === 0) return "missing_handle" as const
  if (substantiveCharacters(candidate.text) < 16) return "content_free" as const
}

function valid(
  candidate: SummaryCandidate,
  sourceTokens: number,
  sourceBytes: number,
  target: number,
  allowed: Set<string>,
) {
  return candidateIssue(candidate, sourceTokens, sourceBytes, target, allowed) === undefined
}

function attachRecoveryHandles(
  candidate: SummaryCandidate,
  items: TreeItem[],
  sourceTokens: number,
  sourceBytes: number,
  target: number,
) {
  if ((candidate.text.match(RECOVERY_HANDLE) ?? []).length > 0) return candidate
  const trimmed = candidate.text.trim()
  if (
    trimmed.length === 0 ||
    (candidate.attempt && candidate.attempt.finish !== "stop") ||
    PROTOCOL_ONLY.test(trimmed) ||
    PROTOCOL_LINE.test(trimmed) ||
    TRANSFORMER_COMPLETION_LEAD.test(trimmed) ||
    ANSWER_WRAPPER.test(trimmed) ||
    SUMMARY_TASK_SCAFFOLDING.test(trimmed) ||
    REFUSAL.test(trimmed) ||
    candidate.grounded === false ||
    substantiveCharacters(trimmed) < 16
  )
    return candidate
  const text = `${trimmed}\n\nRecovery handles: ${items.map((item) => item.id).join(", ")}`
  const bytes = Buffer.byteLength(text)
  const tokens = Math.max(1, Math.ceil(bytes / 4))
  if (bytes >= sourceBytes || tokens >= sourceTokens || tokens > Math.ceil(target * 1.15)) return candidate
  return { ...candidate, text }
}

function rejectedAttempt(
  candidate: SummaryCandidate,
  sourceTokens: number,
  sourceBytes: number,
  target: number,
  allowed: Set<string>,
) {
  const attempt = candidate.attempt
  if (!attempt) return
  const issue = candidateIssue(candidate, sourceTokens, sourceBytes, target, allowed) ?? "rejected"
  return {
    ...attempt,
    errorCode: attempt.errorCode ?? `lcm_summary_${issue}`,
  }
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
    let extractiveFallback: string | undefined
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
            allowedHandles: [...allowed].toSorted(),
            mode,
            signal: input.signal,
          })
        } catch (error) {
          if (input.signal?.aborted) throw error
          return
        }
      }
      candidate = await generate("normal")
      extractiveFallback = candidate?.fallbackText
      if (candidate) candidate = attachRecoveryHandles(candidate, input.items, sourceTokens, sourceBytes, target)
      if (!candidate || !valid(candidate, sourceTokens, sourceBytes, target, allowed)) {
        const attempt = candidate && rejectedAttempt(candidate, sourceTokens, sourceBytes, target, allowed)
        if (attempt)
          await this.store.recordAttempt({
            ...attempt,
            nodeKey: key,
            sessionID: input.sessionID,
          })
        if (input.maintenanceMode === "soft") return
        candidate = await generate("aggressive")
        extractiveFallback = candidate?.fallbackText ?? extractiveFallback
        if (candidate) candidate = attachRecoveryHandles(candidate, input.items, sourceTokens, sourceBytes, target)
      }
    }
    if (!candidate || !valid(candidate, sourceTokens, sourceBytes, target, allowed)) {
      const attempt = candidate && rejectedAttempt(candidate, sourceTokens, sourceBytes, target, allowed)
      if (attempt)
        await this.store.recordAttempt({
          ...attempt,
          nodeKey: key,
          sessionID: input.sessionID,
        })
      const extractive = extractiveFallback
        ? ({ text: extractiveFallback, mode: "deterministic" } satisfies SummaryCandidate)
        : undefined
      candidate =
        extractive && valid(extractive, sourceTokens, sourceBytes, target, allowed)
          ? extractive
          : { text: deterministic(input.items, target, allowed), mode: "deterministic" }
    }
    if (!valid(candidate, sourceTokens, sourceBytes, target, allowed)) return
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
      targetTokens: Math.floor(input.usableInputTokens * DEFAULT_SOFT_THRESHOLD_RATIO),
      mode: input.reason === "background" || input.reason === "soft_leaf" ? "soft" : "hard",
      signal: input.signal,
    })
  }
}
