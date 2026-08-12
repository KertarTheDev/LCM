import type { KiloClient } from "@kilocode/sdk/v2"
import path from "node:path"
import { errorMessage } from "@/util/error"
import { writePrivateFileExclusive } from "@/kilocode/session/lcm/atomic-export"

export const LCM_USAGE = "Usage: /lcm [status|timeline|export]"

export type LcmCommand = "status" | "timeline" | "export"

export function parseLcmInput(value: string): LcmCommand | "invalid" | undefined {
  const match = value.trim().match(/^\/lcm(?:\s+(\S+))?\s*$/i)
  if (!match) return
  const operation = match[1]?.toLowerCase() ?? "status"
  if (operation === "status" || operation === "timeline" || operation === "export") return operation
  return "invalid"
}

function result<T>(value: { data?: T; error?: unknown }) {
  if (value.error) throw new Error(errorMessage(value.error))
  if (value.data === undefined) throw new Error("Conversation Memory returned no data")
  return value.data
}

function scope(input: { workspace?: string; directory?: string }) {
  return {
    ...(input.workspace ? { workspace: input.workspace } : input.directory ? { directory: input.directory } : {}),
  }
}

function percent(value?: number) {
  return value === undefined ? "unknown" : `${Math.round(value * 100)}%`
}

export function formatLcmStatus(value: {
  mode: string
  health: string
  capacity: {
    known: boolean
    pressureRatio?: number
    thresholdRatio?: number
    activeInputTokens?: number
    usableInputTokens?: number
    rawLaneRatio?: number
    fixedInputTokens?: number
    softThresholdTokens?: number
  }
  composition: {
    rawItems: number
    summaryItems: number
    rawTokens: number
    summaryTokens: number
    eligibleRawTokens: number
    eligibleRawItems: number
    protectedRawTokens: number
    protectedRawItems: number
    recentConsumedRawTokens: number
    recentConsumedRawItems: number
    unconsumedRawTokens: number
    unconsumedRawItems: number
  }
  background: { summarizing: boolean; phase: string }
  memoryWork: { attempts: number; inputTokens: number; outputTokens: number; cost: number }
  issue?: { message: string }
}) {
  return [
    `State: ${value.mode} · ${value.health}`,
    `Context pressure: ${value.capacity.known ? percent(value.capacity.pressureRatio) : "not measured yet"}${
      value.capacity.thresholdRatio === undefined ? "" : ` · intervention at ${percent(value.capacity.thresholdRatio)}`
    }`,
    `Raw conversation pressure: ${percent(value.capacity.rawLaneRatio)} · eligible backlog ${value.composition.eligibleRawItems} items (${value.composition.eligibleRawTokens.toLocaleString()} tokens) · protected ${value.composition.protectedRawItems} items (${value.composition.protectedRawTokens.toLocaleString()} tokens)`,
    `Protected detail: recent consumed ${value.composition.recentConsumedRawItems} items (${value.composition.recentConsumedRawTokens.toLocaleString()} tokens) · not yet consumed ${value.composition.unconsumedRawItems} items (${value.composition.unconsumedRawTokens.toLocaleString()} tokens)`,
    value.capacity.fixedInputTokens === undefined
      ? "Fixed upstream input: not measured yet"
      : `Fixed upstream input: ${value.capacity.fixedInputTokens.toLocaleString()} tokens`,
    value.capacity.activeInputTokens === undefined || value.capacity.usableInputTokens === undefined
      ? "Active capacity: not measured yet"
      : `Active capacity: ${value.capacity.activeInputTokens.toLocaleString()} / ${value.capacity.usableInputTokens.toLocaleString()} tokens`,
    `Composition: ${value.composition.rawItems} raw (${value.composition.rawTokens.toLocaleString()} tokens) · ${
      value.composition.summaryItems
    } summaries (${value.composition.summaryTokens.toLocaleString()} tokens)`,
    `Maintenance: ${value.background.phase}${value.background.summarizing ? " · summarizing" : ""}`,
    `Memory work: ${value.memoryWork.attempts} attempts · ${value.memoryWork.inputTokens.toLocaleString()} in · ${value.memoryWork.outputTokens.toLocaleString()} out · $${value.memoryWork.cost.toFixed(4)}`,
    ...(value.issue ? [`Issue: ${value.issue.message}`] : []),
  ].join("\n")
}

export function formatLcmTimeline(items: Array<{ createdAt: number; kind: string; message: string }>) {
  if (items.length === 0) return "No Conversation Memory activity has been recorded for this session."
  return items
    .map((item) => `${new Date(item.createdAt).toLocaleString()} · ${item.kind}\n${item.message}`)
    .join("\n\n")
}

export async function runLcmCommand(input: {
  command: LcmCommand
  client: KiloClient
  sessionID: string
  workspace?: string
  directory?: string
}) {
  const routed = { sessionID: input.sessionID, ...scope(input) }
  if (input.command === "status") {
    return {
      type: "message" as const,
      title: "Conversation Memory",
      message: formatLcmStatus(result(await input.client.conversationMemory.status(routed))),
    }
  }
  if (input.command === "timeline") {
    const page = result(await input.client.conversationMemory.activity({ ...routed, limit: "50" }))
    return {
      type: "message" as const,
      title: "Conversation Memory Timeline",
      message: formatLcmTimeline(page.items),
    }
  }
  const response = await input.client.conversationMemory.export(routed)
  const data = result(response)
  const header = response.response?.headers.get("content-disposition")
  const suggested = header?.match(/filename="([^"]+)"/)?.[1]
  const filename = path.basename(suggested ?? `kilo-context-${input.sessionID}-${Date.now()}.zip`)
  const target = path.join(input.directory ?? process.cwd(), filename)
  // The generated SDK's binary response union includes the project `File`
  // model; the HTTP client returns the successful response as a web Blob.
  const bytes = new Uint8Array(await (data as Blob).arrayBuffer())
  await writePrivateFileExclusive(target, bytes)
  return { type: "export" as const, path: target }
}
