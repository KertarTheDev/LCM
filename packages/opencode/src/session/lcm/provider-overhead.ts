// kilocode_change - new file
import type { LcmRenderedSpanProviderFamily } from "./types"

const LCM_PROVIDER_TRANSFORM_OVERHEAD_FLOOR_MAX_TOKENS = 512
const LCM_PROVIDER_TRANSFORM_OVERHEAD_FLOOR_MIN_TOKENS = 32
const LCM_PROVIDER_TRANSFORM_OVERHEAD_MAX_CONTEXT_RATIO = 0.1

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

function asNumber(value: number | string | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value)
  return Number(value ?? 0)
}

export function providerTransformOverheadFloor(providerContextLimit: number) {
  const contextScaled = Math.ceil(Math.max(1, providerContextLimit) * 0.0025)
  return Math.min(
    LCM_PROVIDER_TRANSFORM_OVERHEAD_FLOOR_MAX_TOKENS,
    Math.max(LCM_PROVIDER_TRANSFORM_OVERHEAD_FLOOR_MIN_TOKENS, contextScaled),
  )
}

export function clampProviderTransformOverhead(input: {
  readonly providerContextLimit: number
  readonly tokens: number
}) {
  const maxTokens = Math.max(
    1,
    Math.floor(input.providerContextLimit * LCM_PROVIDER_TRANSFORM_OVERHEAD_MAX_CONTEXT_RATIO),
  )
  if (!Number.isFinite(input.tokens) || input.tokens <= 0) return 0
  return Math.min(maxTokens, Math.floor(input.tokens))
}

export function providerInputLimitWithTransformReserve(input: {
  readonly providerContextLimit: number
  readonly providerInputLimit?: number
  readonly reserveTokens: number
}) {
  if (input.reserveTokens <= 0) return input.providerInputLimit
  const baseInputLimit = input.providerInputLimit ?? input.providerContextLimit
  return Math.max(1, baseInputLimit - input.reserveTokens)
}

export async function loadProviderTransformOverheadReserve(input: {
  readonly db: Queryable
  readonly providerID: string
  readonly modelID: string
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly providerContextLimit: number
}) {
  const floor = providerTransformOverheadFloor(input.providerContextLimit)
  const observed = await input.db.query<{ max_observed_tokens: number | string | bigint }>(
    `
      SELECT max_observed_tokens
      FROM lcm_provider_transform_overheads
      WHERE provider_id = $1
        AND model_id = $2
        AND provider_family = $3
      LIMIT 1
    `,
    [input.providerID, input.modelID, input.providerFamily],
  )
  const observedTokens = observed.rows[0] ? asNumber(observed.rows[0].max_observed_tokens) : 0
  return clampProviderTransformOverhead({
    providerContextLimit: input.providerContextLimit,
    tokens: Math.max(floor, observedTokens),
  })
}
