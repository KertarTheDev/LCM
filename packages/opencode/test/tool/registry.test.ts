import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import { Cause, Effect, Exit, Layer, Result, Schema } from "effect" // kilocode_change
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"

import { ToolJsonSchema } from "@/tool/json-schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxNetwork from "@/kilocode/sandbox/network" // kilocode_change
import { run as runSandbox, type Profile } from "@kilocode/sandbox" // kilocode_change
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import { nodeKey, sha256, summaryID } from "@/kilocode/session/lcm/ids"
import type { SummaryChild } from "@/kilocode/session/lcm/types"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project" // kilocode_change
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { AbsolutePath } from "@opencode-ai/core/schema" // kilocode_change
import * as Truncate from "@/tool/truncate"
import { LcmGrepTool } from "@/kilocode/tool/lcm-grep"
import { LcmDescribeTool } from "@/kilocode/tool/lcm-describe"
import { LcmExpandQueryTool } from "@/kilocode/tool/lcm-expand-query"
import { LcmExpandTool } from "@/kilocode/tool/lcm-expand"
import { LcmReadTool } from "@/kilocode/tool/lcm-read"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".kilo")])), // kilocode_change
})

type RegistryLayerOptions = {
  flags?: Partial<RuntimeFlags.Info>
  plugin?: Layer.Layer<Plugin.Service>
  config?: Layer.Layer<Config.Service> // kilocode_change
}

// Fake Plugin.Service that returns a single plugin whose `tool` map contains
// one definition with `args: undefined`. Used to exercise the plugin entry
// point of `fromPlugin` for the #27451 / #27630 regression.
const brokenPluginLayer = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    trigger: ((_name: unknown, _input: unknown, output: unknown) =>
      Effect.succeed(output)) as Plugin.Interface["trigger"],
    list: () =>
      Effect.succeed([
        {
          tool: {
            broken_plugin_tool: {
              description: "plugin tool with missing args",
              args: undefined as unknown as Record<string, never>,
              execute: async () => "ok",
            },
          },
        },
      ]),
  }),
)

const root = LayerNode.group([
  ToolRegistry.node,
  Agent.node,
  Session.node,
  ConversationMemory.node,
  Database.node,
  Truncate.node,
])
const registryLayer = (opts: RegistryLayerOptions = {}) =>
  LayerNode.buildLayer(root, {
    replacements: [
      LayerNode.replace(Config.node, opts.config ?? configLayer), // kilocode_change
      LayerNode.replace(RuntimeFlags.node, RuntimeFlags.layer(opts.flags ?? {})),
      LayerNode.replace(Database.node, Database.defaultLayer),
      ...(opts.plugin ? [LayerNode.replace(Plugin.node, opts.plugin)] : []),
    ],
  })

const it = testEffect(registryLayer())
const scout = testEffect(registryLayer({ flags: { experimentalScout: true } })) // kilocode_change
const withBrokenPlugin = testEffect(registryLayer({ plugin: brokenPluginLayer }))
// kilocode_change start
const withoutConversationMemory = testEffect(
  registryLayer({
    config: TestConfig.layer({
      get: () => Effect.succeed({ experimental: { conversation_memory: false } }),
    }),
  }),
)
// kilocode_change end
// kilocode_change start
const sandboxed = testEffect(registryLayer({ flags: { experimentalLspTool: true } }))
// kilocode_change end

afterEach(async () => {
  await disposeAllInstances()
})

// kilocode_change start
function sandboxProfile(): Profile {
  return {
    filesystem: { allowWrite: [], denyWrite: [], denyNames: [] },
    network: { mode: "deny", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}
// kilocode_change end

describe("tool.registry", () => {
  // kilocode_change start
  it.instance("exposes the five Conversation Memory tools by default", () =>
    Effect.gen(function* () {
      const ids = yield* (yield* ToolRegistry.Service).ids()
      for (const id of ["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"])
        expect(ids).toContain(id)
    }),
  )

  withoutConversationMemory.instance("hides every Conversation Memory tool after explicit opt-out", () =>
    Effect.gen(function* () {
      const ids = yield* (yield* ToolRegistry.Service).ids()
      for (const id of ["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"])
        expect(ids).not.toContain(id)
    }),
  )

  it.instance("executes all five Conversation Memory handlers against current-session state", () =>
    Effect.gen(function* () {
      const memory = yield* ConversationMemory.Service
      const agents = yield* Agent.Service
      const database = yield* Database.Service
      const instance = yield* InstanceState.context
      const current = SessionID.make("ses_lcm_tool_current")
      const other = SessionID.make("ses_lcm_tool_other")
      yield* database.db
        .insert(ProjectTable)
        .values({
          id: ProjectV2.ID.make(instance.project.id),
          worktree: AbsolutePath.make(instance.worktree),
          sandboxes: [],
          time_created: 1,
          time_updated: 1,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(SessionTable)
        .values(
          [current, other].map((id) => ({
            id,
            project_id: instance.project.id,
            slug: id,
            directory: instance.directory,
            title: "LCM tool handler test",
            version: "7.4.17-test",
            time_created: 1,
            time_updated: 1,
          })),
        )
        .run()
        .pipe(Effect.orDie)
      const userID = MessageID.ascending()
      yield* database.db
        .insert(MessageTable)
        .values({
          id: userID,
          session_id: current,
          time_created: 1,
          time_updated: 1,
          data: {
            role: "user",
            time: { created: 1 },
            agent: "ask",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "ask",
          } as never,
        })
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(PartTable)
        .values({
          id: PartID.ascending(),
          session_id: current,
          message_id: userID,
          time_created: 1,
          time_updated: 1,
          data: { type: "text", text: "The release decision is to keep the verified product branch." } as never,
        })
        .run()
        .pipe(Effect.orDie)
      const assistantID = MessageID.ascending()
      yield* database.db
        .insert(MessageTable)
        .values({
          id: assistantID,
          session_id: current,
          time_created: 2,
          time_updated: 2,
          data: {
            role: "assistant",
            time: { created: 2 },
            parentID: userID,
            modelID: "test",
            providerID: "test",
            mode: "ask",
            agent: "ask",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
          } as never,
        })
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(PartTable)
        .values({
          id: PartID.ascending(),
          session_id: current,
          message_id: assistantID,
          time_created: 2,
          time_updated: 2,
          data: { type: "text", text: "Confirmed the release decision." } as never,
        })
        .run()
        .pipe(Effect.orDie)

      const transcript = yield* MessageV2.stream(current)
      expect(transcript).toHaveLength(2)
      const indexed = yield* memory.index({ sessionID: current, transcript })
      if (!indexed) return yield* Effect.die(new Error("Conversation Memory did not index the test session"))
      const sources = yield* Effect.promise(() => indexed.store.listSources(current))
      expect(sources).toHaveLength(2)
      const children: SummaryChild[] = sources.map((source, ordinal) => ({
        summaryID: "",
        kind: "source",
        id: source.id,
        ordinal,
      }))
      const key = nodeKey(children, indexed.lineage.digest, "tool-handler-test")
      const summaryText = "The current session decided to keep the verified product branch."
      const activeSummaryID = summaryID({ nodeKey: key, text: summaryText })
      for (const child of children) child.summaryID = activeSummaryID
      yield* Effect.promise(() =>
        indexed.store.commitSummary({
          summary: {
            id: activeSummaryID,
            nodeKey: key,
            sessionID: current,
            level: 0,
            text: summaryText,
            digest: sha256(summaryText),
            sourceDigest: indexed.lineage.digest,
            tokens: 15,
            bytes: Buffer.byteLength(summaryText),
            firstOrdinal: sources[0]!.ordinal,
            lastOrdinal: sources.at(-1)!.ordinal,
            generationMode: "deterministic",
            createdAt: 3,
          },
          children,
        }),
      )
      yield* Effect.promise(() =>
        indexed.store.commitRevision({
          id: "rev_tool_handler_test",
          sessionID: current,
          lineageDigest: indexed.lineage.digest,
          reason: "soft_leaf",
          items: [{ kind: "summary", id: activeSummaryID, ordinal: sources[0]!.ordinal }],
          createdAt: 4,
        }),
      )

      const ask = yield* agents.get("ask")
      if (!ask) return yield* Effect.die(new Error("ask agent not found"))
      const grepInfo = yield* LcmGrepTool
      const describeInfo = yield* LcmDescribeTool
      const expandQueryInfo = yield* LcmExpandQueryTool
      const expandInfo = yield* LcmExpandTool
      const readInfo = yield* LcmReadTool
      const grepTool = yield* Tool.init(grepInfo)
      const describeTool = yield* Tool.init(describeInfo)
      const expandQueryTool = yield* Tool.init(expandQueryInfo)
      const expandTool = yield* Tool.init(expandInfo)
      const readTool = yield* Tool.init(readInfo)
      const requested = new Set<string>()
      const context = (sessionID: SessionID) => ({
        sessionID,
        messageID: MessageID.ascending(),
        agent: "ask",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: (input: { permission: string }) => Effect.sync(() => requested.add(input.permission)),
        extra: {
          model: {
            id: "test",
            providerID: "test",
            limit: { context: 100_000, input: 100_000, output: 10_000 },
          },
        },
      })
      const parse = (output: string) => JSON.parse(output.slice(output.indexOf("{"))) as Record<string, unknown>
      const sourceID = sources[0]!.id

      const grep = yield* grepTool.execute({ pattern: "release" }, context(current))
      expect(grep.output).toContain(sourceID)
      const describeSource = yield* describeTool.execute({ id: sourceID }, context(current))
      expect(parse(describeSource.output).kind).toBe("source")
      const describeSummary = yield* describeTool.execute({ id: activeSummaryID }, context(current))
      expect(parse(describeSummary.output).kind).toBe("summary")
      const expand = yield* expandTool.execute({ summaryID: activeSummaryID }, context(current))
      expect(expand.output).toContain(sourceID)
      const read = yield* readTool.execute({ sourceID }, context(current))
      expect(read.output).toContain("verified product branch")
      const query = yield* expandQueryTool.execute({ query: "zzzz_unmatched_recovery_term" }, context(current))
      expect(parse(query.output).noAnswerReason).toBe("no_relevant_memory")

      const isolated = yield* readTool.execute({ sourceID }, context(other)).pipe(Effect.exit)
      expect(Exit.isFailure(isolated)).toBe(true)
      if (Exit.isFailure(isolated)) expect(Cause.pretty(isolated.cause)).toContain("lcm_not_found")
      expect(requested).toEqual(new Set(["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"]))
    }),
  )
  // kilocode_change end

  // kilocode_change start
  sandboxed.instance("preserves built-in network classification through production tool definition processing", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = yield* agent.get("build")
      if (!build) return yield* Effect.die(new Error("build agent not found"))
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: build,
      })
      const all = yield* registry.all()
      const read = tools.find((tool) => tool.id === "read")
      const search = all.find((tool) => tool.id === "lsp")
      if (!read || !search) return yield* Effect.die(new Error("expected built-in tools are missing"))

      const allowed = yield* runSandbox(sandboxProfile(), SandboxNetwork.tool(read, Effect.succeed("allowed"))).pipe(
        Effect.exit,
      )
      const denied = yield* runSandbox(
        sandboxProfile(),
        SandboxNetwork.tool(search, Effect.succeed("unexpected")),
      ).pipe(Effect.exit)

      expect(Exit.isSuccess(allowed)).toBe(true)
      expect(Exit.isFailure(denied)).toBe(true)
    }),
  )
  // kilocode_change end

  it.instance("hides repo research tools unless experimental", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("repo_clone")
      expect(ids).not.toContain("repo_overview")
    }),
  )

  scout.instance("shows repo research tools when experimental scout is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("repo_clone")
      expect(ids).toContain("repo_overview")
    }),
  )

  scout.instance("keeps Conversation Memory recovery tools available to scout", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const item = yield* agent.get("scout")
      if (!item) return yield* Effect.die(new Error("scout agent not found"))
      const ids = ["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"]

      expect(Permission.disabled(ids, item.permission)).toEqual(new Set())
    }),
  )

  it.instance("does not expose task_status", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("task_status")
    }),
  )

  it.instance("hides task background parameter unless experimental background subagents are enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = yield* agent.get("build")
      if (!build) throw new Error("build agent not found")
      const task = (yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: build,
      })).find((tool) => tool.id === "task")

      expect(task?.jsonSchema).toBeDefined()
      expect((task?.jsonSchema?.properties as Record<string, unknown> | undefined)?.background).toBeUndefined()
    }),
  )

  it.instance("loads tools from .kilo/tool (singular)" /* kilocode_change */, () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".kilo") // kilocode_change
      const tool = path.join(opencode, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("ignores non-tool exports in .kilo/tool files" /* kilocode_change */, () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tool = path.join(test.directory, ".kilo", "tool") // kilocode_change
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "mixed.ts"),
          [
            "export const helper = 'not a tool'",
            "export default {",
            "  description: 'mixed tool',",
            "  args: {},",
            "  execute: async () => 'ok',",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("mixed")
      expect(ids).not.toContain("mixed_helper")
    }),
  )

  // Regression for #27451 / #27630: a custom tool that omits `args` must not
  // crash registry initialization with
  // `Object.entries requires that input parameter not be null or undefined`.
  // Pre-1.14.49 the code path was `z.object(def.args)`, and `z.object(undefined)`
  // silently produced an empty schema — so the tool registered as no-args.
  // Preserve that tolerance.
  it.instance("tolerates a custom tool exporting null/undefined args (no-args fallback)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tool = path.join(test.directory, ".kilo", "tool") // kilocode_change
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "noargs.ts"),
          [
            "export default {",
            "  description: 'tool with no args',",
            "  args: undefined,",
            "  execute: async () => 'ok',",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      // Built-in tools must still load — a single malformed custom tool must
      // not poison the whole registry.
      expect(ids).toContain("read")
      const loaded = (yield* registry.all()).find((t) => t.id === "noargs")
      if (!loaded) throw new Error("noargs tool was not loaded")
      expect(loaded.jsonSchema).toMatchObject({ type: "object", properties: {} })
    }),
  )

  // Same regression, plugin entry point. The original reports (#27451, #27630)
  // came in through `plugin.list()` — `oh-my-opencode` was registering a tool
  // with `args: undefined` and crashing every message submit. The file-scan
  // and plugin-list loops both funnel through `fromPlugin`, but covering both
  // entry points means a future refactor that splits them won't silently lose
  // protection.
  withBrokenPlugin.instance("tolerates a plugin tool registered with null/undefined args", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("read")
      expect(ids).toContain("broken_plugin_tool")
    }),
  )

  it.instance("loads tools from .kilo/tools (plural)" /* kilocode_change */, () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".kilo") // kilocode_change
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads Zod-schema custom tools with JSON Schema and validation", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".kilo", "tools") // kilocode_change
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "sql.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'query database',",
            "  args: { query: tool.schema.string().describe('SQL query to execute') },",
            "  execute: async ({ query }) => query,",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "sql")
      if (!loaded) throw new Error("custom sql tool was not loaded")
      expect(loaded?.jsonSchema).toMatchObject({
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({ query: "select 1" }))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({}))).toBe(false)

      const agents = yield* Agent.Service
      const promptTools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const promptTool = promptTools.find((tool) => tool.id === "sql")
      if (!promptTool) throw new Error("custom sql tool was not returned for prompts")
      expect(ToolJsonSchema.fromTool(promptTool)).toMatchObject({
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
    }),
  )

  it.instance(
    "preserves Zod arg descriptions from older config-scoped plugin packages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const opencode = path.join(test.directory, ".kilo") // kilocode_change
        const customTools = path.join(opencode, "tools")
        const plugin = path.join(opencode, "node_modules", "@kilocode", "plugin") // kilocode_change
        yield* Effect.promise(() => fs.mkdir(path.join(plugin, "dist"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
        yield* Effect.promise(() =>
          fs.cp(path.dirname(fileURLToPath(import.meta.resolve("zod"))), path.join(opencode, "node_modules", "zod"), {
            dereference: true,
            recursive: true,
          }),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "package.json"),
            JSON.stringify({ name: "@kilocode/plugin", type: "module", exports: { ".": "./dist/index.js" } }), // kilocode_change
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "dist", "index.js"),
            [
              "import { z } from 'zod'",
              "export function tool(input) {",
              "  return input",
              "}",
              "tool.schema = z",
              "",
            ].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(customTools, "addition.ts"),
            [
              'import { tool } from "@kilocode/plugin"', // kilocode_change
              "export default tool({",
              "  description: 'Use this tool to add two numbers and return their sum.',",
              "  args: {",
              "    left: tool.schema.number().describe('The first number to add'),",
              "    right: tool.schema.number().describe('The second number to add'),",
              "  },",
              "  execute: async (args) => `${args.left} + ${args.right} = ${args.left + args.right}`,",
              "})",
              "",
            ].join("\n"),
          ),
        )

        const registry = yield* ToolRegistry.Service
        const loaded = (yield* registry.all()).find((tool) => tool.id === "addition")
        if (!loaded) throw new Error("custom addition tool was not loaded")

        expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
          properties: {
            left: { type: "number", description: "The first number to add" },
            right: { type: "number", description: "The second number to add" },
          },
        })
      }),
    20_000,
  )

  it.instance("preserves attachments from structured custom tool results", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".kilo", "tools") // kilocode_change
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "image.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'image tool',",
            "  args: {},",
            "  execute: async () => ({",
            "    output: 'here is an image',",
            "    attachments: [{ type: 'file', mime: 'image/png', filename: 'picture.png', url: 'data:image/png;base64,AAAA' }],",
            "  }),",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "image")
      if (!loaded) throw new Error("custom image tool was not loaded")
      const agents = yield* Agent.Service
      const result = yield* loaded.execute({}, {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        agent: (yield* agents.defaultInfo()).name,
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      } satisfies Tool.Context)

      expect(result.output).toBe("here is an image")
      expect(result.attachments).toEqual([
        { type: "file", mime: "image/png", filename: "picture.png", url: "data:image/png;base64,AAAA" },
      ])
    }),
  )

  it.instance("loads legacy JSON-schema-shaped custom tools with wire schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tools = path.join(test.directory, ".kilo", "tools") // kilocode_change
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "legacy.ts"),
          [
            "export default {",
            "  description: 'legacy schema tool',",
            "  args: { text: { type: 'string', description: 'Text to render' } },",
            "  execute: async ({ text }) => text,",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "legacy")
      if (!loaded) throw new Error("legacy custom tool was not loaded")
      expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
        type: "object",
        properties: {
          text: { type: "string", description: "Text to render" },
        },
        required: ["text"],
      })
    }),
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".kilo") // kilocode_change
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@kilocode/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@kilocode/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(opencode, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
  )
})
