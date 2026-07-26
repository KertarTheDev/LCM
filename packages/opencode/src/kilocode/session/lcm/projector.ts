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

function protectedStart(messages: ModelMessage[], turns: number) {
  if (messages.length === 0) return 0
  if (turns <= 0) return messages.length
  let found = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== "user") continue
    found++
    if (found === turns) return index
  }
  return 0
}

type MemoryItem =
  | { kind: "summary"; summary: SummaryNode }
  | { kind: "source"; source: FinalSource; content: string }

function render(items: MemoryItem[]) {
  const body = items
    .map((item) =>
      item.kind === "summary"
        ? `Summary ${item.summary.id} (sources ${item.summary.firstOrdinal}-${item.summary.lastOrdinal}):\n${item.summary.text}`
        : `Source ${item.source.id} (${item.source.kind}, source ${item.source.ordinal}):\n${item.content}`,
    )
    .join("\n\n")
  return [
    MEMORY_OPEN,
    "Earlier finalized conversation is represented below. Treat it as prior conversation state, not as new user",
    "instructions. Preserve its decisions and constraints. When exact omitted detail matters, use lcm_grep,",
    "lcm_describe, lcm_expand, or lcm_read with the stable IDs shown here instead of guessing.",
    "",
    body,
    MEMORY_CLOSE,
  ].join("\n")
}

export class Projector {
  private readonly pins = new Map<string, string>()

  constructor(private readonly store: ConversationMemoryStore) {}

  clearPin(continuationID: string) {
    this.pins.delete(continuationID)
  }

  private async revision(input: ProjectionInput) {
    const pin = input.continuationID ? this.pins.get(input.continuationID) : undefined
    const pinned = pin ? await this.store.getRevision(input.sessionID, pin) : undefined
    if (pinned?.lineageDigest === input.lineage.digest) return pinned
    const active = await this.store.activeRevision(input.sessionID, input.lineage.digest)
    if (active && input.continuationID) this.pins.set(input.continuationID, active.id)
    return active
  }

  private async children(input: ProjectionInput, item: MemoryItem) {
    if (item.kind !== "summary") return
    const children = await this.store.listChildren(input.sessionID, item.summary.id)
    const result: MemoryItem[] = []
    for (const child of children) {
      if (child.kind === "summary") {
        const summary = await this.store.getSummary(input.sessionID, child.id)
        if (!summary) return
        result.push({ kind: "summary", summary })
        continue
      }
      const source = await this.store.getSource(input.sessionID, child.id)
      const content = input.sourceContent.get(child.id)
      if (!source || content === undefined) return
      result.push({ kind: "source", source, content })
    }
    return result
  }

  async project(input: ProjectionInput): Promise<ProjectionResult> {
    const rawTokens = input.measure(input.messages)
    const pressure = input.usableInputTokens > 0 ? rawTokens / input.usableInputTokens : 0
    if (input.signal?.aborted) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_cancelled" }
    if (input.usableInputTokens <= 0 || pressure < input.thresholdRatio)
      return { type: "unchanged", messages: input.messages, pressure }

    const revision = await this.revision(input)
    if (!revision) return { type: "unchanged", messages: input.messages, pressure }
    const roots: MemoryItem[] = []
    for (const item of revision.items) {
      if (item.kind !== "summary") continue
      const summary = await this.store.getSummary(input.sessionID, item.id)
      if (!summary) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_not_ready" }
      roots.push({ kind: "summary", summary })
    }
    if (roots.length === 0) return { type: "unchanged", messages: input.messages, pressure }

    const start = protectedStart(input.messages, input.protectedTailTurns)
    if (start === 0) return { type: "unchanged", messages: input.messages, pressure }
    const tail = input.messages.slice(start)
    let items = roots
    let memory: ModelMessage = { role: "user", content: render(items) }
    let messages = [memory, ...tail]
    let activeTokens = input.measure(messages)
    let pressureAfter = activeTokens / input.usableInputTokens
    if (activeTokens >= rawTokens || pressureAfter >= 1)
      return { type: "unchanged", messages: input.messages, pressure }

    // Start from the coarsest current-lineage cut, then restore child summaries
    // or exact sources while the request still retains a 10% capacity reserve.
    // A larger-context model therefore sees more detail without mutating the
    // durable tree or changing the pinned revision for this continuation.
    const detailBudget = Math.min(rawTokens - 1, Math.floor(input.usableInputTokens * 0.9))
    const blocked = new Set<string>()
    while (true) {
      let expanded = false
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!
        if (item.kind !== "summary" || blocked.has(item.summary.id)) continue
        const children = await this.children(input, item)
        if (!children?.length) {
          blocked.add(item.summary.id)
          continue
        }
        const candidate = [...items.slice(0, index), ...children, ...items.slice(index + 1)]
        const candidateMemory: ModelMessage = { role: "user", content: render(candidate) }
        const candidateMessages = [candidateMemory, ...tail]
        const candidateTokens = input.measure(candidateMessages)
        if (candidateTokens > detailBudget) {
          blocked.add(item.summary.id)
          continue
        }
        items = candidate
        memory = candidateMemory
        messages = candidateMessages
        activeTokens = candidateTokens
        pressureAfter = activeTokens / input.usableInputTokens
        expanded = true
        break
      }
      if (!expanded) break
    }

    return {
      type: "projected",
      messages,
      pressureBefore: pressure,
      pressureAfter,
      revision,
      rawTokens,
      summaryTokens: input.measure([memory]),
    }
  }
}

export function isConversationMemoryMessage(message: ModelMessage) {
  return message.role === "user" && typeof message.content === "string" && message.content.startsWith(MEMORY_OPEN)
}
