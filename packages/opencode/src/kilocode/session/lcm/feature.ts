import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

export const DEFAULT_ENABLED = true
export const DISABLED_MESSAGE =
  "Conversation Memory is disabled. Enable experimental.conversation_memory to use this feature."

export function enabled(config: Pick<ConfigV1.Info, "experimental">) {
  return config.experimental?.conversation_memory ?? DEFAULT_ENABLED
}
