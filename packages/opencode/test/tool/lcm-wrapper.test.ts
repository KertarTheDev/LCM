// kilocode_change - regression coverage for LCM infrastructure tool wrapper failures
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { AgenticMapTool } from "../../src/tool/agentic-map"
import { LcmDescribeTool } from "../../src/tool/lcm-describe"
import { LcmExpandQueryTool } from "../../src/tool/lcm-expand-query"
import { LcmExpandTool } from "../../src/tool/lcm-expand"
import { LcmGrepTool } from "../../src/tool/lcm-grep"
import { LcmMapCancelTool } from "../../src/tool/lcm-map-cancel"
import { LcmMapStatusTool } from "../../src/tool/lcm-map-status"
import { LcmReadTool } from "../../src/tool/lcm-read"
import { LlmMapTool } from "../../src/tool/llm-map"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const testLayer = Layer.mergeAll(
  Layer.succeed(
    Agent.Service,
    Agent.Service.of({
      get: () =>
        Effect.succeed({
          name: "build",
          mode: "primary",
          permission: {},
          options: {},
        } as Agent.Info),
      list: () => Effect.succeed([]),
      defaultInfo: () =>
        Effect.succeed({
          name: "build",
          mode: "primary",
          permission: {},
          options: {},
        } as Agent.Info),
      defaultAgent: () => Effect.succeed("build"),
      generate: () => Effect.die("not used"),
    }),
  ),
  Layer.succeed(
    Session.Service,
    Session.Service.of({
      get: () => Effect.die("not used"),
      list: () => Effect.die("not used"),
      children: () => Effect.succeed([]),
      create: () => Effect.die("not used"),
      setPermission: () => Effect.void,
    } as unknown as Session.Interface),
  ),
  Layer.succeed(
    Truncate.Service,
    Truncate.Service.of({
      cleanup: () => Effect.void,
      write: () => Effect.succeed("unused"),
      output: (text) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
    }),
  ),
)

function ctx(): Tool.Context {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_lcm_wrapper_smoke",
    messages: [],
    extra: {
      model: { providerID: "test", id: "model" },
      promptOps: {},
    },
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

const cases = [
  {
    name: "lcm_grep",
    tool: LcmGrepTool,
    input: { pattern: "needle" },
    diagnosticCode: "lcm_grep_tool_wrapper_failed",
  },
  {
    name: "lcm_describe",
    tool: LcmDescribeTool,
    input: { id: "sum_missing" },
    diagnosticCode: "lcm_describe_tool_wrapper_failed",
  },
  {
    name: "lcm_expand_query",
    tool: LcmExpandQueryTool,
    input: { query: "what happened?" },
    diagnosticCode: "lcm_expand_query_tool_wrapper_failed",
  },
  {
    name: "lcm_expand",
    tool: LcmExpandTool,
    input: { summaryID: "sum_missing" },
    diagnosticCode: "lcm_expand_tool_wrapper_failed",
  },
  {
    name: "lcm_read",
    tool: LcmReadTool,
    input: { fileID: "file_missing" },
    diagnosticCode: "lcm_read_tool_wrapper_failed",
  },
  {
    name: "llm_map",
    tool: LlmMapTool,
    input: { inputJsonl: "{\"value\":1}", itemSchema: true, prompt: "Return JSON." },
    diagnosticCode: "llm_map_tool_wrapper_failed",
  },
  {
    name: "agentic_map",
    tool: AgenticMapTool,
    input: { inputJsonl: "{\"value\":1}", itemSchema: true, prompt: "Return JSON.", mode: "read_only" },
    diagnosticCode: "agentic_map_tool_wrapper_failed",
  },
  {
    name: "lcm_map_status",
    tool: LcmMapStatusTool,
    input: { mapID: "map_missing" },
    diagnosticCode: "lcm_map_status_tool_wrapper_failed",
  },
  {
    name: "lcm_map_cancel",
    tool: LcmMapCancelTool,
    input: { mapID: "map_missing" },
    diagnosticCode: "lcm_map_cancel_tool_wrapper_failed",
  },
] as const

test("LCM infrastructure tools return structured wrapper errors when runtime binding is unavailable", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      for (const item of cases) {
        const info = yield* item.tool
        const tool = yield* info.init()
        const result = yield* tool.execute(item.input as never, ctx())
        const output = JSON.parse(result.output) as {
          ok: boolean
          error?: { code?: string; diagnosticCode?: string; templateKey?: string; retryable?: boolean }
        }

        expect(result.metadata.ok, item.name).toBe(false)
        expect(output.ok, item.name).toBe(false)
        expect(output.error?.code, item.name).toBe("provider_unavailable")
        expect(output.error?.templateKey, item.name).toBe("lcm.provider.unavailable")
        expect(output.error?.retryable, item.name).toBe(true)
        expect(output.error?.diagnosticCode, item.name).toBe(item.diagnosticCode)
      }
    }).pipe(Effect.provide(testLayer)),
  )
})
