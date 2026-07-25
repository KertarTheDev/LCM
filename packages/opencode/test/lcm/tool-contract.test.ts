// kilocode_change - new file
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session/session"
import { LCM_MAP_TOOL_DESCRIPTIONS } from "../../src/session/lcm/map"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../../src/session/lcm/retrieval"
import { AgenticMapTool } from "../../src/tool/agentic-map"
import { LcmGrepTool } from "../../src/tool/lcm-grep"
import { LcmMapStatusTool } from "../../src/tool/lcm-map-status"
import { LlmMapTool } from "../../src/tool/llm-map"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("unused"),
  output: (text) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: 2_000, maxBytes: 50 * 1_024 }),
})

const agents = Agent.Service.of({} as Agent.Interface)
const sessions = Session.Service.of({} as Session.Interface)

test("provider-visible LCM grep and map schemas explain exact search and durable run semantics", async () => {
  const visible = await Effect.runPromise(
    Effect.gen(function* () {
      const grep = yield* Tool.init(yield* LcmGrepTool)
      const llmMap = yield* Tool.init(yield* LlmMapTool)
      const agenticMap = yield* Tool.init(yield* AgenticMapTool)
      const mapStatus = yield* Tool.init(yield* LcmMapStatusTool)
      return { grep, llmMap, agenticMap, mapStatus }
    }).pipe(
      Effect.provideService(Truncate.Service, truncate),
      Effect.provideService(Agent.Service, agents),
      Effect.provideService(Session.Service, sessions),
    ),
  )

  expect(visible.grep.description).toBe(LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_grep)
  expect(visible.llmMap.description).toBe(LCM_MAP_TOOL_DESCRIPTIONS.llm_map)
  expect(visible.agenticMap.description).toBe(LCM_MAP_TOOL_DESCRIPTIONS.agentic_map)
  expect(visible.mapStatus.description).toBe(LCM_MAP_TOOL_DESCRIPTIONS.lcm_map_status)

  expect(ToolJsonSchema.fromTool(visible.grep)).toMatchObject({
    properties: {
      pattern: {
        type: "string",
        description: expect.stringContaining("one exact contiguous substring"),
      },
      cursor: {
        description: expect.stringContaining("page.nextCursor"),
      },
    },
    required: ["pattern"],
  })
  expect(ToolJsonSchema.fromTool(visible.llmMap)).toMatchObject({
    properties: {
      inputFileID: {
        description: expect.stringContaining("Provide exactly one of inputFileID, inputPath, or inputJsonl"),
      },
      maxRetries: {
        description: expect.stringContaining("does not consume this budget"),
      },
    },
    required: ["itemSchema", "prompt"],
  })
  expect(ToolJsonSchema.fromTool(visible.agenticMap)).toMatchObject({
    properties: {
      mode: {
        description: expect.stringContaining("read_only denies edits"),
      },
      workers: {
        description: expect.stringContaining("may be lowered for provider capacity"),
      },
    },
    required: ["itemSchema", "prompt", "mode"],
  })
  expect(ToolJsonSchema.fromTool(visible.mapStatus)).toMatchObject({
    properties: {
      mapID: { type: "string" },
    },
    required: ["mapID"],
  })
})
