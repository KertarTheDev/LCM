export const LCM_RETRIEVAL_TOOL_IDS = [
  "lcm_grep",
  "lcm_describe",
  "lcm_expand",
  "lcm_expand_query",
  "lcm_read",
] as const

export const LCM_MAP_TOOL_IDS = ["llm_map", "agentic_map", "lcm_map_status", "lcm_map_cancel"] as const

export const LCM_INFRASTRUCTURE_TOOL_IDS = [...LCM_RETRIEVAL_TOOL_IDS, ...LCM_MAP_TOOL_IDS] as const

const LCM_INFRASTRUCTURE_TOOL_ID_SET: ReadonlySet<string> = new Set(LCM_INFRASTRUCTURE_TOOL_IDS)

export function isLcmInfrastructureToolID(toolID: string) {
  return LCM_INFRASTRUCTURE_TOOL_ID_SET.has(toolID)
}
