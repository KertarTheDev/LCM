import { Effect } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionCompaction } from "@/session/compaction"
import { usable } from "@/session/overflow"
import { SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as ConversationMemoryFeature from "./feature"
import { ConversationMemory } from "./service"
import { DEFAULT_SOFT_THRESHOLD_RATIO } from "./types"

export type Route = "upstream" | "external"

/** One routing point for every manual compact/summarize affordance. */
export const run = Effect.fn("ConversationMemoryManual.run")(function* (input: {
  sessionID: SessionID
  agent: string
  model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  auto: boolean
}) {
  const config = yield* Config.Service
  const cfg = yield* config.get()
  if (!ConversationMemoryFeature.enabled(cfg)) {
    const compaction = yield* SessionCompaction.Service
    yield* compaction.create(input)
    return "upstream" as const
  }

  const memory = yield* ConversationMemory.Service
  const provider = yield* Provider.Service
  const flags = yield* RuntimeFlags.Service
  const model = yield* provider.getModel(input.model.providerID, input.model.modelID)
  const usableInputTokens = usable({ cfg, model, outputTokenMax: flags.outputTokenMax })
  const thresholdRatio =
    typeof cfg.conversation_memory?.soft_threshold_percent === "number"
      ? cfg.conversation_memory.soft_threshold_percent / 100
      : DEFAULT_SOFT_THRESHOLD_RATIO
  yield* memory.maintain({
    sessionID: input.sessionID,
    model,
    usableInputTokens,
    thresholdRatio,
    recentTailTokens: ConversationMemory.recentTailTokens({
      usableInputTokens,
      configured: cfg.compaction?.preserve_recent_tokens,
    }),
    reason: "manual",
  })
  return "external" as const
})
