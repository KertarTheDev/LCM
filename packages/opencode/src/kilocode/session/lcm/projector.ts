import type { ModelMessage } from "ai"
import type { ConversationMemoryStore, FrontierRevision, ProjectionInput, ProjectionResult, SummaryNode } from "./types"

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

function render(summaries: SummaryNode[]) {
  const body = summaries
    .map(
      (summary) => `Summary ${summary.id} (sources ${summary.firstOrdinal}-${summary.lastOrdinal}):\n${summary.text}`,
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

  async project(input: ProjectionInput): Promise<ProjectionResult> {
    const rawTokens = input.measure(input.messages)
    const pressure = input.usableInputTokens > 0 ? rawTokens / input.usableInputTokens : 0
    if (input.signal?.aborted) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_cancelled" }
    if (input.usableInputTokens <= 0 || pressure < input.thresholdRatio)
      return { type: "unchanged", messages: input.messages, pressure }

    const revision = await this.revision(input)
    if (!revision) return { type: "unchanged", messages: input.messages, pressure }
    const summaries: SummaryNode[] = []
    for (const item of revision.items) {
      if (item.kind !== "summary") continue
      const summary = await this.store.getSummary(input.sessionID, item.id)
      if (!summary) return { type: "unavailable", messages: input.messages, pressure, code: "lcm_not_ready" }
      summaries.push(summary)
    }
    if (summaries.length === 0) return { type: "unchanged", messages: input.messages, pressure }

    const start = protectedStart(input.messages, input.protectedTailTurns)
    if (start === 0) return { type: "unchanged", messages: input.messages, pressure }
    const memory: ModelMessage = { role: "user", content: render(summaries) }
    const messages = [memory, ...input.messages.slice(start)]
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
      summaryTokens: summaries.reduce((total, summary) => total + summary.tokens, 0),
    }
  }
}

export function isConversationMemoryMessage(message: ModelMessage) {
  return message.role === "user" && typeof message.content === "string" && message.content.startsWith(MEMORY_OPEN)
}
