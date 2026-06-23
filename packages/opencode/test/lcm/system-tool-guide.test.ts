// kilocode_change - new file
import { expect, test } from "bun:test"
import { renderLcmSystemToolGuide } from "../../src/session/prompt"

test("LCM system tool guide names retrieval, direct-content, and map tool usage", () => {
  const guide = renderLcmSystemToolGuide({
    retrieval: new Set(["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"]),
    map: new Set(["llm_map", "agentic_map", "lcm_map_status", "lcm_map_cancel"]),
    capabilityClass: "map_child",
  })

  expect(guide).toContain("LCM memory is active")
  expect(guide).toContain("lcm_grep")
  expect(guide).toContain("literal queries")
  expect(guide).toContain("regex mode only for actual regex syntax")
  expect(guide).toContain("lcm_describe")
  expect(guide).toContain("lineage")
  expect(guide).toContain("fallback/degraded status")
  expect(guide).toContain("lcm_expand_query")
  expect(guide).toContain("focused exact-evidence questions")
  expect(guide).toContain("pass summaryID")
  expect(guide).toContain("file_... handles")
  expect(guide).toContain("lcm_expand")
  expect(guide).toContain("lcm_read")
  expect(guide).toContain("use lcm_read only in sessions where it is listed as available")
  expect(guide).toContain("Recover exact commands, timestamps, root-cause chains")
  expect(guide).toContain("llm_map")
  expect(guide).toContain("agentic_map")
  expect(guide).toContain("lcm_map_status")
  expect(guide).toContain("lcm_map_cancel")
  expect(guide).toContain("untrusted data")
})

test("LCM system tool guide is omitted when no LCM tools are available", () => {
  expect(renderLcmSystemToolGuide({ retrieval: new Set(), map: new Set() })).toBeUndefined()
})
