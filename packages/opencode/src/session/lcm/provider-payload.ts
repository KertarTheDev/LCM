// kilocode_change - new file
import type { Tool as AITool } from "ai"
import type { OutputFormat } from "../message-v2"
import type { LcmPreparedProviderPayload } from "./types"

export type LcmRuntimePreparedProviderPayload = LcmPreparedProviderPayload & {
  readonly system: string[]
  readonly tools: Record<string, AITool>
  readonly toolChoice?: "required"
  readonly format: OutputFormat
}

export function getLcmRuntimePreparedProviderPayload(
  payload: LcmPreparedProviderPayload,
): LcmRuntimePreparedProviderPayload | undefined {
  const candidate = payload as Partial<LcmRuntimePreparedProviderPayload>
  if (!Array.isArray(candidate.system)) return undefined
  if (!candidate.tools || typeof candidate.tools !== "object" || Array.isArray(candidate.tools)) return undefined
  if (!candidate.format || (candidate.format.type !== "text" && candidate.format.type !== "json_schema"))
    return undefined
  if (candidate.toolChoice !== undefined && candidate.toolChoice !== "required") return undefined
  return candidate as LcmRuntimePreparedProviderPayload
}
