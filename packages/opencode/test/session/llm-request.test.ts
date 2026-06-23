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
    llm_map: dummyTool(),
    lcm_map_status: dummyTool(),
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
      }),
    } as never,
    permission: Permission.fromConfig({
      lcm_describe: "deny",
      lcm_expand_query: "deny",
      lcm_map_status: "deny",
    }),
    user: {
      tools: {
        read: false,
        lcm_grep: false,
        llm_map: false,
      },
    } as never,
  })

  expect(Object.keys(filtered).sort()).toEqual([
    "lcm_describe",
    "lcm_expand_query",
    "lcm_grep",
    "lcm_map_status",
    "llm_map",
  ])
})
