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

type MemoryItem = { kind: "summary"; summary: SummaryNode } | { kind: "source"; source: FinalSource; content: string }

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
  private readonly pins = new Map<
    string,
    {
      continuationID: string
      revisionID: string
      lineageDigest: string
    }
  >()

  constructor(private readonly store: ConversationMemoryStore) {}

  clearSession(sessionID: string) {
    this.pins.delete(sessionID)
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
    const memory: ModelMessage = { role: "user", content: render(roots) }
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
      summaryTokens: input.measure([memory]),
    }
  }
}

export function isConversationMemoryMessage(message: ModelMessage) {
  return message.role === "user" && typeof message.content === "string" && message.content.startsWith(MEMORY_OPEN)
}
