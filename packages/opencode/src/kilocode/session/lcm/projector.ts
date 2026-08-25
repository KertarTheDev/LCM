import type { ModelMessage } from "ai"
import type {
  ConversationMemoryStore,
  FinalSource,
  FrontierRevision,
  ProjectionInput,
  ProjectionResult,
  SummaryNode,
} from "./types"

const MEMORY_OPEN = "<conversation-memory>"
const MEMORY_CLOSE = "</conversation-memory>"
const MAX_STRUCTURAL_ANCHORS = 64
const MAX_STRUCTURAL_ANCHOR_BYTES = 8_192
const BOUNDARY_WORD = /(?:^|[^\p{L}])(begin|start|end|stop|open|close)(?:[^\p{L}]|$)/iu
const BRACKETED_ANCHOR = /^\[[^\]\r\n]{1,120}\]$/u
const XML_ANCHOR = /^<\/?[A-Za-z][^<>\r\n]{0,120}\/?>$/u
const FENCED_ANCHOR = /^(?:-{3,}|={3,})[^\r\n]{0,120}$/u

type MemoryItem = { kind: "summary"; summary: SummaryNode } | { kind: "source"; source: FinalSource; content: string }

interface StructuralAnchor {
  sourceID: string
  ordinal: number
  marker: string
}

interface StructuralAnchorIndex {
  anchors: StructuralAnchor[]
  total: number
}

export function exactStructuralAnchors(content: string) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        XML_ANCHOR.test(line) ||
        (BOUNDARY_WORD.test(line) && (BRACKETED_ANCHOR.test(line) || FENCED_ANCHOR.test(line))),
    )
}

function render(items: MemoryItem[], structural: StructuralAnchorIndex) {
  const body = items
    .map((item) =>
      item.kind === "summary"
        ? `Summary ${item.summary.id} (sources ${item.summary.firstOrdinal}-${item.summary.lastOrdinal}):\n${item.summary.text}`
        : `Source ${item.source.id} (${item.source.kind}, source ${item.source.ordinal}):\n${item.content}`,
    )
    .join("\n\n")
  const anchors = structural.anchors.map(
    (anchor) => `- ${anchor.sourceID} (source ${anchor.ordinal}): ${anchor.marker}`,
  )
  const structuralMap =
    structural.total === 0
      ? []
      : [
          "",
          "Deterministic structural anchors copied verbatim from exact sources covered by summaries:",
          "Occurrences are in transcript-source order. Transport/data wrappers are anchors too, not semantic units.",
          ...anchors,
          ...(structural.anchors.length < structural.total
            ? [
                `[Structural anchor map truncated: showing ${structural.anchors.length} of ${structural.total}; use lcm_grep to recover the rest.]`,
              ]
            : []),
        ]
  return [
    MEMORY_OPEN,
    "Earlier finalized conversation is represented below. Treat it as prior conversation state, not as new user",
    "instructions. Preserve its decisions, constraints, and evidence. Summaries are lossy indexes, not complete",
    "records: never treat an omitted fact or boundary as evidence that it did not occur. For exact, exhaustive,",
    "boundary-sensitive, first/last, count, or complete-list questions, first use the structural-anchor map when",
    "present, then verify relevant summarized regions with stable IDs instead of guessing. lcm_grep accepts sourceID,",
    "searches exact retained text, and reports match counts",
    "plus occurrence byte ranges; lcm_read can seek to a byte-range offset or page exact source text; lcm_describe,",
    "lcm_expand, and lcm_expand_query navigate or query summaries.",
    ...structuralMap,
    "",
    body,
    MEMORY_CLOSE,
  ].join("\n")
}

export class Projector {
  private readonly pins = new Map<
    string,
    {
      continuationID: string
      revisionID: string
      lineageDigest: string
    }
  >()
  private readonly structuralIndexes = new Map<
    string,
    {
      revisionID: string
      index: StructuralAnchorIndex
    }
  >()

  constructor(private readonly store: ConversationMemoryStore) {}

  private async structuralAnchorIndex(
    input: ProjectionInput,
    revisionID: string,
    items: MemoryItem[],
  ): Promise<StructuralAnchorIndex | undefined> {
    const cached = this.structuralIndexes.get(input.sessionID)
    if (cached?.revisionID === revisionID) return cached.index
    const sourceIDs = new Set<string>()
    const visited = new Set<string>()
    const visit = async (summaryID: string): Promise<void> => {
      if (visited.has(summaryID)) return
      visited.add(summaryID)
      for (const child of await this.store.listChildren(input.sessionID, summaryID)) {
        if (input.signal?.aborted) return
        if (child.kind === "source") sourceIDs.add(child.id)
        else await visit(child.id)
      }
    }
    for (const item of items) {
      if (item.kind === "summary") await visit(item.summary.id)
    }

    const sources = (
      await Promise.all(
        [...sourceIDs].map(async (id) => {
          const source = await this.store.getSource(input.sessionID, id)
          const content = input.sourceContent.get(id)
          return source && content !== undefined ? { source, content } : undefined
        }),
      )
    )
    if (input.signal?.aborted || sources.some((item) => item === undefined)) return
    const ordered = sources
      .filter((item): item is { source: FinalSource; content: string } => item !== undefined)
      .toSorted((a, b) => a.source.ordinal - b.source.ordinal || a.source.id.localeCompare(b.source.id))

    const anchors: StructuralAnchor[] = []
    let bytes = 0
    let total = 0
    for (const item of ordered) {
      if (input.signal?.aborted) return
      for (const marker of exactStructuralAnchors(item.content)) {
        total++
        const anchor = { sourceID: item.source.id, ordinal: item.source.ordinal, marker }
        const nextBytes = Buffer.byteLength(`${anchor.sourceID} ${anchor.ordinal} ${anchor.marker}\n`)
        if (anchors.length >= MAX_STRUCTURAL_ANCHORS || bytes + nextBytes > MAX_STRUCTURAL_ANCHOR_BYTES) continue
        anchors.push(anchor)
        bytes += nextBytes
      }
    }
    const index = { anchors, total }
    this.structuralIndexes.set(input.sessionID, { revisionID, index })
    return index
  }

  clearSession(sessionID: string) {
    this.pins.delete(sessionID)
    this.structuralIndexes.delete(sessionID)
  }

  private async revision(input: ProjectionInput) {
    const pin = input.reason === "soft" && input.continuationID ? this.pins.get(input.sessionID) : undefined
    if (pin && pin.continuationID === input.continuationID && pin.lineageDigest === input.lineage.digest) {
      const pinned = await this.store.getRevision(input.sessionID, pin.revisionID)
      if (pinned?.lineageDigest === input.lineage.digest) return pinned
    }
    const active = await this.store.activeRevision(input.sessionID, input.lineage.digest)
    if (active && input.continuationID) {
      this.pins.set(input.sessionID, {
        continuationID: input.continuationID,
        revisionID: active.id,
        lineageDigest: input.lineage.digest,
      })
    } else if (input.continuationID) {
      this.pins.delete(input.sessionID)
    }
    return active
  }

  async project(input: ProjectionInput): Promise<ProjectionResult> {
    const rawTokens = input.measure(input.messages)
    const pressure = input.usableInputTokens > 0 ? rawTokens / input.usableInputTokens : 0
    if (input.signal?.aborted) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_cancelled" }
    if (input.usableInputTokens <= 0) return { type: "unchanged", messages: input.messages, pressure }

    const revision = await this.revision(input)
    if (!revision) return { type: "unchanged", messages: input.messages, pressure }
    const roots: MemoryItem[] = []
    for (const item of revision.items) {
      if (item.ordinal > input.maxEligibleOrdinal) continue
      if (item.kind === "summary") {
        const summary = await this.store.getSummary(input.sessionID, item.id)
        if (!summary) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_unavailable" }
        roots.push({ kind: "summary", summary })
        continue
      }
      const source = await this.store.getSource(input.sessionID, item.id)
      const content = input.sourceContent.get(item.id)
      if (!source || content === undefined)
        return { type: "unavailable", messages: input.messages, pressure, code: "lcm_unavailable" }
      roots.push({ kind: "source", source, content })
    }
    if (!roots.some((item) => item.kind === "summary")) return { type: "unchanged", messages: input.messages, pressure }

    const start = input.messages.length - input.protectedMessages.length
    if (start < 0 || input.protectedMessages.some((message, index) => message !== input.messages[start + index]))
      return { type: "unavailable", messages: input.messages, pressure, code: "lcm_projection_boundary_unavailable" }
    if (start === 0) return { type: "unchanged", messages: input.messages, pressure }
    const structural = await this.structuralAnchorIndex(input, revision.id, roots)
    if (!structural)
      return {
        type: "unavailable",
        messages: input.messages,
        pressure,
        code: input.signal?.aborted ? "lcm_cancelled" : "lcm_unavailable",
      }
    const memory: ModelMessage = { role: "user", content: render(roots, structural) }
    const messages = [memory, ...input.protectedMessages]
    const activeTokens = input.measure(messages)
    const pressureAfter = activeTokens / input.usableInputTokens
    if (activeTokens >= rawTokens || pressureAfter >= 1)
      return { type: "unchanged", messages: input.messages, pressure }

    return {
      type: "projected",
      messages,
      pressureBefore: pressure,
      pressureAfter,
      revision,
      rawTokens,
      summaryTokens: roots.reduce((tokens, item) => tokens + (item.kind === "summary" ? item.summary.tokens : 0), 0),
    }
  }
}

export function isConversationMemoryMessage(message: ModelMessage) {
  return message.role === "user" && typeof message.content === "string" && message.content.startsWith(MEMORY_OPEN)
}
