// kilocode_change - new file
import type { Provider } from "@/provider/provider"
import { RUNTIME_DEFAULTS } from "./config"
import { resolveLcmModelLimits } from "./model-limits"
import { computeTokenBudget } from "./token-budget"

export function lcmPromptPathByteCount(value: number | bigint) {
  if (typeof value === "bigint")
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value)
  return Number.isFinite(value) ? Math.max(0, value) : Number.MAX_SAFE_INTEGER
}

export function lcmPromptPathAdmissionThresholdBytes(model: Provider.Model) {
  const limits = resolveLcmModelLimits(model)
  const budget = computeTokenBudget({
    providerContextLimit: limits.context,
    providerInputLimit: limits.input,
    providerOutputLimit: limits.output,
    activeTokens: 0,
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
  })
  const providerAwareBytes = Math.floor(budget.softThreshold * 4 * 0.25)
  const configured = RUNTIME_DEFAULTS.largePayloads.promptPayloadThresholdBytes
  return Math.max(1, Math.min(configured, providerAwareBytes > 0 ? providerAwareBytes : configured))
}

export function lcmShouldAdmitPromptPathBackedFile(input: {
  readonly byteCount: number | bigint
  readonly thresholdBytes: number
  readonly offset?: number
  readonly limit?: number
}) {
  if (input.offset !== undefined || input.limit !== undefined) return false
  return lcmPromptPathByteCount(input.byteCount) > input.thresholdBytes
}
