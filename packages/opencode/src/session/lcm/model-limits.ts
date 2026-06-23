// kilocode_change - new file
import type { Provider } from "@/provider/provider"
import type { LcmBudgetStatus } from "./types"

const OPENAI_COMPATIBLE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible"
const CUSTOM_PROVIDER_DEFAULT_CONTEXT_LIMIT = 100_000
const CUSTOM_PROVIDER_DEFAULT_OUTPUT_LIMIT = 20_000
const GENERIC_PROVIDER_FALLBACK_CONTEXT_LIMIT = 64_000
const GENERIC_PROVIDER_FALLBACK_OUTPUT_LIMIT = 8_192

const PROVIDER_LIMIT_FALLBACKS: Record<string, { readonly context: number; readonly output: number }> = {
  "@ai-sdk/anthropic": { context: 200_000, output: 8_192 },
  "@ai-sdk/azure": { context: 128_000, output: 16_384 },
  "@ai-sdk/google": { context: 128_000, output: 8_192 },
  "@ai-sdk/openai": { context: 128_000, output: 16_384 },
  [OPENAI_COMPATIBLE_PROVIDER_PACKAGE]: {
    context: CUSTOM_PROVIDER_DEFAULT_CONTEXT_LIMIT,
    output: CUSTOM_PROVIDER_DEFAULT_OUTPUT_LIMIT,
  },
  "@kilocode/kilo-gateway": { context: 200_000, output: 32_000 },
}

export interface LcmResolvedModelLimits {
  readonly context: number
  readonly input?: number
  readonly output?: number
  readonly budgetStatus?: LcmBudgetStatus
}

function positiveModelLimit(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function positiveRecoveryAttempt(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

function modelLimitFallback(model: Provider.Model) {
  return (
    PROVIDER_LIMIT_FALLBACKS[model.api?.npm ?? ""] ?? {
      context: GENERIC_PROVIDER_FALLBACK_CONTEXT_LIMIT,
      output: GENERIC_PROVIDER_FALLBACK_OUTPUT_LIMIT,
    }
  )
}

export function resolveLcmModelLimits(model: Provider.Model): LcmResolvedModelLimits {
  const context = positiveModelLimit(model.limit.context)
  const input = positiveModelLimit(model.limit.input)
  const output = positiveModelLimit(model.limit.output)
  const fallback = modelLimitFallback(model)
  const resolvedContext = context ?? fallback.context
  const resolvedInput = input === undefined ? undefined : Math.min(input, resolvedContext)
  const resolvedOutput = Math.min(output ?? fallback.output, resolvedContext)
  const usesFallbackOrClamp =
    context === undefined ||
    (model.limit.input !== undefined && input === undefined) ||
    output === undefined ||
    (input !== undefined && input > resolvedContext) ||
    (output !== undefined && output > resolvedContext)
  return {
    context: resolvedContext,
    ...(resolvedInput === undefined ? {} : { input: resolvedInput }),
    output: resolvedOutput,
    ...(usesFallbackOrClamp ? { budgetStatus: "provider_limit_fallback" as const } : {}),
  }
}

export function lcmProviderOverflowRecoveryInputLimit(input: {
  readonly modelLimits: LcmResolvedModelLimits
  readonly recovery?: {
    readonly attempt: number
  }
}) {
  if (!input.recovery) return input.modelLimits.input
  const baseInputLimit = input.modelLimits.input ?? input.modelLimits.context
  const outputLimit = input.modelLimits.output ?? 0
  const attempt = positiveRecoveryAttempt(input.recovery.attempt)
  const reserveScale = Math.min(2, 1 + (attempt - 1) * 0.5)
  const maxReserveRatio = attempt <= 1 ? 0.33 : 0.5
  const baseRecoveryReserve = Math.max(8_192, Math.ceil(input.modelLimits.context * 0.08), Math.ceil(outputLimit * 0.5))
  const recoveryReserve = Math.min(
    Math.ceil(baseRecoveryReserve * reserveScale),
    Math.max(1, Math.floor(baseInputLimit * maxReserveRatio)),
  )
  return Math.max(1, baseInputLimit - recoveryReserve)
}
