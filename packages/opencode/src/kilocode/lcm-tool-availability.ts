import type { LcmConversationCapabilityClass, LcmLifecycleState } from "@/session/lcm/types"
import { LCM_MAP_TOOL_IDS } from "@/session/lcm/tool-ids"

export type LcmAllowedToolIDs = {
  readonly retrieval: Set<string>
  readonly map: Set<string>
}

const PREFLIGHT_REGISTRATION_STATES: ReadonlySet<LcmLifecycleState> = new Set(["passive_synced", "lcm_active"])

export function resolvePreflightLcmToolIDs(input: {
  readonly capabilitiesLifecycleState: LcmLifecycleState
  readonly scopeLifecycleState: LcmLifecycleState
  readonly capabilityClass: LcmConversationCapabilityClass
  readonly capabilityProven: boolean
  readonly directContentToolsAllowed: boolean
}): LcmAllowedToolIDs {
  const allowed: LcmAllowedToolIDs = { retrieval: new Set(), map: new Set() }
  if (
    !PREFLIGHT_REGISTRATION_STATES.has(input.capabilitiesLifecycleState) ||
    input.scopeLifecycleState !== input.capabilitiesLifecycleState ||
    !input.capabilityProven
  ) {
    return allowed
  }

  // A passive payload is local-only until prompt preflight proves the old session and marks it active.
  // Retrieval and map execution independently require the persisted lcm_active lifecycle.
  if (input.capabilityClass === "root" || input.capabilityClass === "map_child") {
    for (const id of LCM_MAP_TOOL_IDS) allowed.map.add(id)
  }
  allowed.retrieval.add("lcm_grep")
  allowed.retrieval.add("lcm_describe")
  allowed.retrieval.add("lcm_expand_query")
  if (input.capabilityClass !== "root") allowed.retrieval.add("lcm_expand")
  if (input.directContentToolsAllowed) allowed.retrieval.add("lcm_read")
  return allowed
}
