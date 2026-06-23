// kilocode_change - new file
import type { LcmStrategy } from "./types"

export const STRATEGIES = ["upward", "dolt"] as const satisfies LcmStrategy[]

export function isStrategy(input: string): input is LcmStrategy {
  return (STRATEGIES as readonly string[]).includes(input)
}

export * as LcmStrategy from "./strategy"
