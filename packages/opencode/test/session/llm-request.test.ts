import { expect, test } from "bun:test"
import { tool } from "ai"
import { Permission } from "../../src/permission"
import { resolveTools } from "../../src/session/llm/request"

const dummyTool = () =>
  tool({
    description: "test tool",
    inputSchema: {},
    execute: async () => ({}),
  })

test("LLM request prep keeps LCM infrastructure tools despite generic tool denies", () => {
  const tools = {
    bash: dummyTool(),
    read: dummyTool(),
    lcm_grep: dummyTool(),
    lcm_describe: dummyTool(),
    lcm_expand_query: dummyTool(),
    lcm_expand: dummyTool(),
    lcm_read: dummyTool(),
    llm_map: dummyTool(),
    agentic_map: dummyTool(),
    lcm_map_status: dummyTool(),
    lcm_map_cancel: dummyTool(),
  }

  const filtered = resolveTools({
    tools,
    agent: {
      name: "plan",
      permission: Permission.fromConfig({
        "*": "deny",
        read: "allow",
        lcm_grep: "deny",
        llm_map: "deny",
        agentic_map: "deny",
      }),
    } as never,
    permission: Permission.fromConfig({
      lcm_describe: "deny",
      lcm_expand_query: "deny",
      lcm_expand: "deny",
      lcm_read: "deny",
      lcm_map_status: "deny",
      lcm_map_cancel: "deny",
    }),
    user: {
      tools: {
        read: false,
        lcm_grep: false,
        llm_map: false,
        lcm_read: false,
      },
    } as never,
  })

  expect(Object.keys(filtered).sort()).toEqual([
    "agentic_map",
    "lcm_describe",
    "lcm_expand",
    "lcm_expand_query",
    "lcm_grep",
    "lcm_map_cancel",
    "lcm_map_status",
    "lcm_read",
    "llm_map",
  ])
})
