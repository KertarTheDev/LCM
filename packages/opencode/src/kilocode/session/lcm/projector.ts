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
  byteStart: number
  byteEnd: number
}

interface StructuralAnchorIndex {
  anchors: StructuralAnchor[]
  total: number
}

export function exactStructuralAnchors(content: string) {
  return exactStructuralAnchorOccurrences(content).map((anchor) => anchor.marker)
}

export function exactStructuralAnchorOccurrences(content: string) {
  const result: Array<{ marker: string; byteStart: number; byteEnd: number }> = []
  let byteOffset = 0
  for (const rawLine of content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu) ?? []) {
    if (rawLine.length === 0) continue
    const line = rawLine.replace(/(?:\r\n|\r|\n)$/u, "")
    const marker = line.trim()
    if (
      marker.length > 0 &&
      (XML_ANCHOR.test(marker) ||
        (BOUNDARY_WORD.test(marker) && (BRACKETED_ANCHOR.test(marker) || FENCED_ANCHOR.test(marker))))
    ) {
      const characterStart = line.indexOf(marker)
      const byteStart = byteOffset + Buffer.byteLength(line.slice(0, characterStart))
      result.push({ marker, byteStart, byteEnd: byteStart + Buffer.byteLength(marker) })
    }
    byteOffset += Buffer.byteLength(rawLine)
  }
  return result
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
    (anchor) =>
      `- ${anchor.sourceID} (source ${anchor.ordinal}, bytes ${anchor.byteStart}-${anchor.byteEnd}): ${anchor.marker}`,
  )
  const structuralMap =
    structural.total === 0
      ? []
      : [
          "",
          "Deterministic structural anchors copied verbatim from consumed finalized sources:",
          "Occurrences are in transcript-source order. A src_ handle is a transport record, not a semantic unit; one",
          "marked document, episode, section, or other unit may span several sources. Transport/data wrappers are",
          "anchors too, not semantic units. Pair ordered openings and closings before answering per-unit first/last",
          "questions. Byte intervals are half-open. When boundaries share a source, constrain sourceID-scoped lcm_grep",
          "with startOffset at the opening marker's byte end and endOffset at the closing marker's byte start. For units",
          "spanning sources, apply the opening offset to the first source, the closing offset to the last, and search",
          "intermediate sources in full. Do not use evidence before the opening or after the closing.",
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
    "present, then verify relevant summarized regions with stable IDs instead of guessing. Recover economically:",
    "use one focused lcm_expand_query for synthesis or aggregation, or unscoped lcm_grep for compact discovery; then",
    "verify only necessary candidates with sourceID-scoped lcm_grep and targeted lcm_read. Do not page whole large",
    "sources when focused search or query can answer. lcm_grep defaults to literal mode: enter punctuation without",
    "regex escapes (for example [START], not \\[START\\]); set mode=regex for | alternatives. Unscoped grep can",
    "return overlapping summaries and raw descendants: never add both counts. lcm_read reports complete and a",
    "nextOffset/nextCursor; never repeat a consumed page. lcm_describe and lcm_expand navigate provenance. Once exact",
    "evidence resolves the current question, stop recovery and answer immediately instead of re-verifying it.",
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
      maxConsumedOrdinal: number
      index: StructuralAnchorIndex
    }
  >()

  constructor(private readonly store: ConversationMemoryStore) {}

  private async structuralAnchorIndex(
    input: ProjectionInput,
    revisionID: string,
  ): Promise<StructuralAnchorIndex | undefined> {
    const cached = this.structuralIndexes.get(input.sessionID)
    if (cached?.revisionID === revisionID && cached.maxConsumedOrdinal === input.maxConsumedOrdinal) return cached.index
    const sources = (await this.store.listSources(input.sessionID))
      .filter((source) => source.ordinal <= input.maxConsumedOrdinal)
      .toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
    if (input.signal?.aborted || sources.some((source) => !input.sourceContent.has(source.id))) return

    const anchors: StructuralAnchor[] = []
    let bytes = 0
    let total = 0
    for (const source of sources) {
      if (input.signal?.aborted) return
      for (const occurrence of exactStructuralAnchorOccurrences(input.sourceContent.get(source.id)!)) {
        total++
        const anchor = { sourceID: source.id, ordinal: source.ordinal, ...occurrence }
        const nextBytes = Buffer.byteLength(
          `${anchor.sourceID} ${anchor.ordinal} ${anchor.byteStart} ${anchor.byteEnd} ${anchor.marker}\n`,
        )
        if (anchors.length >= MAX_STRUCTURAL_ANCHORS || bytes + nextBytes > MAX_STRUCTURAL_ANCHOR_BYTES) continue
        anchors.push(anchor)
        bytes += nextBytes
      }
    }
    const index = { anchors, total }
    this.structuralIndexes.set(input.sessionID, { revisionID, maxConsumedOrdinal: input.maxConsumedOrdinal, index })
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
    const structural = await this.structuralAnchorIndex(input, revision.id)
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
