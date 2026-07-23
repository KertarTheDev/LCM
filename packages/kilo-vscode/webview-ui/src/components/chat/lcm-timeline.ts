import type { LcmActivityItem, LcmActivityPage } from "@kilocode/sdk/v2/client"
import { palette } from "../../utils/timeline/colors"
import { sizesFromContent } from "../../utils/timeline/sizes"

export interface LcmTimelineBar {
  key: string
  bg: string
  tip: string
  width: number
  height: number
  idx: number
  time: number
}

const PURPOSE_LABELS: Record<LcmActivityItem["purpose"], string> = {
  leaf_summary: "Leaf summary",
  condensation: "Summary condensation",
  hard_limit_maintenance: "Hard-limit maintenance",
  retrieval_expand_query: "Memory query",
  file_exploration: "File exploration",
  llm_map: "LLM map",
}

function activityColor(purpose: LcmActivityItem["purpose"]) {
  if (purpose === "retrieval_expand_query" || purpose === "file_exploration") return palette.read
  if (purpose === "llm_map") return palette.tool
  return palette.step
}

function value(input: number | string | undefined) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function hasProviderRequestEvidence(item: LcmActivityItem) {
  return (
    value(item.inputTokens) !== undefined ||
    value(item.outputTokens) !== undefined ||
    value(item.cacheReadTokens) !== undefined ||
    value(item.cacheWriteTokens) !== undefined ||
    item.costStatus !== "not_applicable"
  )
}

function model(item: LcmActivityItem) {
  if (item.providerID && item.modelID) return `${item.providerID}/${item.modelID}`
  return item.modelID ?? item.providerID ?? "Model unavailable"
}

function usage(item: LcmActivityItem) {
  const input = value(item.inputTokens)
  const output = value(item.outputTokens)
  const cacheRead = value(item.cacheReadTokens)
  const cacheWrite = value(item.cacheWriteTokens)
  const parts: string[] = []
  if (input !== undefined || output !== undefined) {
    parts.push(`In ${input?.toLocaleString() ?? "unknown"} · Out ${output?.toLocaleString() ?? "unknown"}`)
  }
  if ((cacheRead ?? 0) > 0 || (cacheWrite ?? 0) > 0) {
    parts.push(`Cache R ${cacheRead?.toLocaleString() ?? "unknown"} · W ${cacheWrite?.toLocaleString() ?? "unknown"}`)
  }
  return parts.length ? parts.join(" · ") : "Token usage unavailable"
}

function cost(item: LcmActivityItem) {
  const amount = value(item.costAmount)
  if (amount !== undefined) return `Cost ${amount.toLocaleString()}${item.costCurrency ? ` ${item.costCurrency}` : ""}`
  if (item.costStatus === "unknown") return "Cost unknown"
  if (item.costStatus === "provider_reported") return "Cost provider reported"
  return "Cost not applicable"
}

export function lcmBars(activity: LcmActivityPage | undefined): LcmTimelineBar[] {
  if (!activity) return []
  const items = [...activity.items].reverse().filter(hasProviderRequestEvidence)
  const sizes = sizesFromContent(items.map((item) => value(item.totalTokens) ?? 1))
  return items.map((item, index) => ({
    key: item.usageRecordID,
    bg: activityColor(item.purpose),
    tip: [`LCM · ${PURPOSE_LABELS[item.purpose]}`, model(item), usage(item), cost(item)].join(" · "),
    width: sizes[index]!.width,
    height: sizes[index]!.height,
    idx: index,
    time: Date.parse(item.createdAt),
  }))
}
