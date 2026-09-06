import { Effect } from "effect"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import * as Tool from "@/tool/tool"
import * as ConversationMemoryFeature from "@/kilocode/session/lcm/feature"
import { LcmGrepTool } from "./lcm-grep"
import { LcmDescribeTool } from "./lcm-describe"
import { LcmExpandQueryTool } from "./lcm-expand-query"
import { LcmExpandTool } from "./lcm-expand"
import { LcmReadTool } from "./lcm-read"
import { LcmQueryTool } from "./lcm-query"
import { lcmToolAvailable } from "@/kilocode/session/lcm/recovery-contract"

export const infos = Effect.all([
  LcmQueryTool,
  LcmGrepTool,
  LcmDescribeTool,
  LcmExpandQueryTool,
  LcmExpandTool,
  LcmReadTool,
])

export function build(items: readonly Tool.Info[]) {
  return Effect.all(items.map((item) => Tool.init(item)))
}

export function extra(items: Tool.Def[], config: Pick<ConfigV1.Info, "experimental">) {
  return ConversationMemoryFeature.enabled(config) ? items : []
}

export function available(tool: string, agent: string) {
  return lcmToolAvailable(tool, agent)
}
