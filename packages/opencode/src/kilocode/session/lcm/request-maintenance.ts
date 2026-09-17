import type { ModelMessage } from "ai"
import type { ProjectionResult } from "./types"

export async function maintainForRequest(input: {
  initial: ProjectionResult
  usableInputTokens: number
  targetTokens: number
  measure: (messages: ModelMessage[]) => number
  frontierTokens: () => Promise<number>
  maintain: (targetTokens: number) => Promise<void>
  project: () => Promise<ProjectionResult>
  signal?: AbortSignal
}): Promise<ProjectionResult> {
  input.signal?.throwIfAborted()
  let result = input.initial
  let before = await input.frontierTokens()
  while (result.type !== "unavailable" && input.measure(result.messages) >= input.usableInputTokens) {
    input.signal?.throwIfAborted()
    // Tree accounting excludes request framing and uses source estimates. Measured
    // overflow must tighten its target even when the configured tree target is met.
    const excess = result.type === "projected" ? input.measure(result.messages) - input.usableInputTokens + 1 : 0
    const target = Math.max(0, Math.min(input.targetTokens, before - Math.max(1, excess)))
    await input.maintain(target)
    input.signal?.throwIfAborted()
    result = await input.project()
    const after = await input.frontierTokens()
    // Every continued cycle must reduce durable frontier tokens. A failed model,
    // held lease, or irreducible frontier cannot cause unbounded maintenance calls.
    if (result.type !== "projected" || after >= before) break
    before = after
  }
  return result
}
