// kilocode_change - new file
import { expect, test } from "bun:test"
import type { Tool as AITool } from "ai"
import { Effect } from "effect"
import type { Agent } from "../../src/agent/agent"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import type { Permission } from "../../src/permission"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { Info as SessionInfo } from "../../src/session/session"
import {
  attachLcmRenderOriginToMessage,
  classifyPromptRenderPart,
  containsRenderPrepLeak,
  createClosureRenderPreparationArtifact,
  makeFixtureClock,
  markLcmRenderOnlyPart,
  prepareKiloModelInput,
  type LcmMessageVisibilityInput,
} from "../../src/session/lcm/render-prep"
import type { LcmSafeError, OperationID } from "../../src/session/lcm/types"

const sentinels = {
  message: "LCM_RENDER_MESSAGE_SENTINEL",
  editor: "LCM_RENDER_EDITOR_SENTINEL",
  plugin: "LCM_RENDER_PLUGIN_SENTINEL",
  reminder: "LCM_RENDER_REMINDER_SENTINEL",
  system: "LCM_RENDER_SYSTEM_SENTINEL",
  tool: "LCM_RENDER_TOOL_SENTINEL",
}

const sessionID = SessionID.make("ses_render_prep")
const userID = MessageID.make("msg_render_user")
const partID = PartID.make("prt_render_user_text")
const operationID = "op_render_prep" as OperationID

function fakeModel(input: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: "model-render-a" as ModelID,
    providerID: "provider-render" as ProviderID,
    api: {
      id: "model-render-a",
      npm: "@ai-sdk/openai",
    },
    name: "Render Model A",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-04-30",
    ...input,
  } as Provider.Model
}

function fakeAgent(input: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name: "code",
    description: "Code agent",
    mode: "primary",
    builtIn: true,
    topP: 1,
    temperature: 0,
    permission: [{ permission: "edit", pattern: "*", action: "ask" }],
    tools: {},
    options: {},
    ...input,
  } as Agent.Info
}

function fakeSession(input: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: sessionID,
    projectID: "project_render",
    directory: "/workspace/render",
    title: "render prep",
    version: "test",
    time: { created: 1, updated: 1 },
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
    ...input,
  } as SessionInfo
}

function baseMessages(input: { text?: string; editor?: string } = {}): MessageV2.WithParts[] {
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 1_777_500_000_000 },
        agent: "code",
        model: {
          providerID: "provider-render" as ProviderID,
          modelID: "model-render-a" as ModelID,
        },
        editorContext: {
          activeFile: input.editor ?? sentinels.editor,
          visibleFiles: ["src/a.ts"],
          shell: "bash",
        },
      },
      parts: [
        {
          id: partID,
          sessionID,
          messageID: userID,
          type: "text",
          text: input.text ?? sentinels.message,
        },
      ],
    },
  ]
}

function visibility(input: Partial<LcmMessageVisibilityInput> = {}): LcmMessageVisibilityInput {
  return {
    version: "kilo-prompt-queue-visibility-v1",
    hash: "visibility-a",
    visibleMessageIDs: [userID],
    hiddenMessageIDs: [],
    ...input,
  }
}

function tool(description = sentinels.tool): AITool {
  return {
    description,
    inputSchema: {},
    execute: async () => "ok",
  } as unknown as AITool
}

async function prepare(
  input: {
    messages?: MessageV2.WithParts[]
    clockMs?: number
    editor?: string
    pluginText?: string
    systemText?: string
    toolDescription?: string
    agent?: Agent.Info
    model?: Provider.Model
    permissionProfile?: Permission.Ruleset
    taskCapabilityClass?: "root" | "task_child" | "explore_child" | "map_child"
    messageVisibility?: LcmMessageVisibilityInput
    stripMedia?: boolean
    lcmActive?: boolean
  } = {},
) {
  const messages = input.messages ?? baseMessages({ editor: input.editor })
  return Effect.runPromise(
    prepareKiloModelInput({
      sessionID,
      session: fakeSession(),
      messages,
      lastUser: messages[0]!.info as MessageV2.User,
      agent: input.agent ?? fakeAgent(),
      model: input.model ?? fakeModel(),
      permissionProfile: input.permissionProfile ?? fakeSession().permission,
      taskCapabilityClass: input.taskCapabilityClass ?? "root",
      messageVisibility: input.messageVisibility ?? visibility(),
      envCache: {},
      clock: makeFixtureClock(input.clockMs ?? 1_777_500_009_000),
      stripMedia: input.stripMedia ?? false,
      lcmActive: input.lcmActive,
      prepareRenderOnlyMessages: ({ messages, clockMs, operationID }) =>
        Effect.sync(() => {
          const user = messages.findLast((message) => message.info.role === "user")!
          const part: MessageV2.TextPart = {
            id: PartID.ascending(),
            sessionID,
            messageID: user.info.id,
            type: "text",
            synthetic: true,
            text: `<system-reminder>${sentinels.reminder}</system-reminder>`,
          }
          markLcmRenderOnlyPart(part, {
            kind: "plan_reminder",
            producer: "kilo.session.prompt",
            operationID,
            createdAtMs: clockMs,
          })
          user.parts.push(part)
          return messages
        }),
      transformMessages: ({ messages, clockMs, operationID }) =>
        Effect.sync(() => {
          const user = messages.findLast((message) => message.info.role === "user")!
          const part: MessageV2.TextPart = {
            id: PartID.ascending(),
            sessionID,
            messageID: user.info.id,
            type: "text",
            text: input.pluginText ?? sentinels.plugin,
          }
          markLcmRenderOnlyPart(part, {
            kind: "plugin_transform",
            producer: "opencode.plugin.transform",
            operationID,
            createdAtMs: clockMs,
          })
          user.parts.push(part)
        }),
      resolveSystem: ({ clockMs }) =>
        Effect.succeed([`${input.systemText ?? sentinels.system}:${new Date(clockMs).toDateString()}`]),
      resolveTools: () => Effect.succeed({ render_tool: tool(input.toolDescription) }),
    }),
  )
}

test("lcm:render-prep matches the previous inline render path with a frozen clock", async () => {
  const clockMs = 1_777_500_009_000
  const helper = await prepare({ clockMs })

  const inlineMessages = structuredClone(baseMessages())
  const user = inlineMessages[0]!
  user.parts.push({
    id: PartID.make("prt_inline_reminder"),
    sessionID,
    messageID: user.info.id,
    type: "text",
    synthetic: true,
    text: `<system-reminder>${sentinels.reminder}</system-reminder>`,
  })
  user.parts.push({
    id: PartID.make("prt_inline_plugin"),
    sessionID,
    messageID: user.info.id,
    type: "text",
    text: sentinels.plugin,
  })
  KiloSessionPrompt.injectEditorContext({
    msgs: inlineMessages,
    lastUser: user.info as MessageV2.User,
    sessionID,
    cache: {},
    now: clockMs,
  })
  const inlineModelMessages = await Effect.runPromise(
    MessageV2.toModelMessagesEffect(inlineMessages, fakeModel(), { stripMedia: false }),
  )

  expect(JSON.stringify(helper.modelMessages)).toBe(JSON.stringify(inlineModelMessages))
})

test("lcm:render-prep is deterministic for unchanged frozen-clock inputs", async () => {
  const first = await prepare()
  const second = await prepare()

  expect(first.renderInputManifest).toEqual(second.renderInputManifest)
  expect(first.messages).toEqual(second.messages)
  expect(first.system).toEqual(second.system)
  expect(first.driftReport).toEqual(second.driftReport)
})

test("lcm:render-prep manifest changes for cache-significant inputs", async () => {
  const baseline = (await prepare()).renderInputManifest
  const cases = [
    ["source", await prepare({ messages: baseMessages({ text: "changed source" }) })],
    ["system", await prepare({ systemText: "changed system" })],
    ["tool", await prepare({ toolDescription: "changed tool" })],
    ["plugin", await prepare({ pluginText: "changed plugin" })],
    ["dynamic", await prepare({ editor: "changed/editor.ts" })],
    ["clock", await prepare({ clockMs: 1_777_500_010_000 })],
    ["visibility", await prepare({ messageVisibility: visibility({ hash: "visibility-b" }) })],
    ["provider", await prepare({ model: fakeModel({ providerID: "provider-b" as ProviderID }) })],
    ["model", await prepare({ model: fakeModel({ id: "model-render-b" as ModelID }) })],
    [
      "media",
      await prepare({
        model: fakeModel({
          capabilities: {
            ...fakeModel().capabilities,
            attachment: false,
          },
        }),
      }),
    ],
    ["stripMedia", await prepare({ stripMedia: true })],
    ["agent", await prepare({ agent: fakeAgent({ name: "plan" }) })],
    ["permission", await prepare({ permissionProfile: [{ permission: "edit", pattern: "*", action: "deny" }] })],
    ["task", await prepare({ taskCapabilityClass: "task_child" })],
  ] as const

  for (const [name, prepared] of cases) {
    expect(prepared.renderInputManifest, name).not.toEqual(baseline)
  }
})

test("lcm:non-model-leak keeps manifest and drift artifact content-safe", async () => {
  const prepared = await prepare()
  const artifact = createClosureRenderPreparationArtifact(prepared)
  const forbidden = Object.values(sentinels)

  expect(containsRenderPrepLeak({ value: prepared.renderInputManifest, sentinels: forbidden })).toBe(false)
  expect(containsRenderPrepLeak({ value: artifact, sentinels: forbidden })).toBe(false)
  expect(artifact.contentSafety.rawContentFieldsSerialized).toBe(false)
  expect(artifact.manifestFields).toContain("dynamicPromptHash")
  expect(artifact.preparationOrder).toEqual([
    "prompt_queue_scope",
    "durable_source_message_selection",
    "render_only_prompt_wrappers",
    "plugin_experimental_chat_messages_transform",
    "dynamic_editor_context_injection",
    "system_prompt_environment_assembly",
    "tool_schema_resolution",
    "media_options_resolution",
    "message_v2_to_model_messages",
  ])
})

test("lcm:render-prep uses structural render-only metadata instead of helper-looking text", async () => {
  expect(
    classifyPromptRenderPart({
      id: PartID.make("prt_durable_synthetic"),
      sessionID,
      messageID: userID,
      type: "text",
      synthetic: true,
      text: "Called the Read tool with the following input: {}",
    }),
  ).toBe("durable_source")

  const renderOnlyPart: MessageV2.TextPart = {
    id: PartID.make("prt_helper_looking_source"),
    sessionID,
    messageID: userID,
    type: "text",
    text: "<environment_details>\nCurrent time: 2026-04-30T00:00:00+00:00\n</environment_details>",
  }
  expect(classifyPromptRenderPart(renderOnlyPart)).toBe("durable_source")

  const markedRenderOnlyPart = markLcmRenderOnlyPart(structuredClone(renderOnlyPart), {
    kind: "environment_details",
    producer: "kilo.editor-context",
    operationID,
    createdAtMs: 1_777_500_009_000,
  })
  expect(classifyPromptRenderPart(markedRenderOnlyPart)).toBe("render_only_prompt_helper")

  let providerInputsResolved = false
  await prepare({
    messages: [
      {
        ...baseMessages()[0]!,
        parts: [renderOnlyPart],
      },
    ],
    lcmActive: true,
    systemText: "safe system",
    pluginText: "safe plugin",
  })
  providerInputsResolved = true
  expect(providerInputsResolved).toBe(true)
})

test("lcm:render-prep fails closed for invalid render-only metadata", async () => {
  let providerInputsResolved = false
  const messages = baseMessages()
  const badPart = markLcmRenderOnlyPart(
    {
      id: PartID.make("prt_render_only_bad_producer"),
      sessionID,
      messageID: userID,
      type: "text",
      text: "<system-reminder>render only</system-reminder>",
    },
    {
      kind: "plan_reminder",
      producer: "kilo.session.prompt",
      operationID,
      createdAtMs: 1_777_500_009_000,
    },
  )
  ;(badPart as unknown as { lcmRenderOnly: { producer: string } }).lcmRenderOnly.producer = "unregistered.producer"
  messages[0]!.parts.push(badPart)
  await expect(
    Effect.runPromise(
      prepareKiloModelInput({
        sessionID,
        session: fakeSession(),
        messages,
        lastUser: messages[0]!.info as MessageV2.User,
        agent: fakeAgent(),
        model: fakeModel(),
        permissionProfile: [],
        taskCapabilityClass: "root",
        messageVisibility: visibility(),
        envCache: {},
        clock: makeFixtureClock(1_777_500_009_000),
        lcmActive: true,
        resolveSystem: () =>
          Effect.sync(() => {
            providerInputsResolved = true
            return []
          }),
        resolveTools: () => Effect.succeed({}),
      }),
    ),
  ).rejects.toMatchObject({
    code: "missing_source",
    diagnosticCode: "lcm_render_prep_prompt_helper_unknown_producer",
  } satisfies Partial<LcmSafeError>)
  expect(providerInputsResolved).toBe(false)
})

test("lcm:render-prep fails closed when plugin output loses source origin", async () => {
  const messages = baseMessages()
  attachLcmRenderOriginToMessage(messages[0]!, {
    renderUnitID: "lcm-render-unit-v1:test",
    sourceKind: "raw_message",
    sourceHandle: "msg_render_source",
  })

  await expect(
    Effect.runPromise(
      prepareKiloModelInput({
        sessionID,
        session: fakeSession(),
        messages,
        lastUser: messages[0]!.info as MessageV2.User,
        operationID,
        agent: fakeAgent(),
        model: fakeModel(),
        permissionProfile: [],
        taskCapabilityClass: "root",
        messageVisibility: visibility(),
        envCache: {},
        clock: makeFixtureClock(1_777_500_009_000),
        lcmActive: true,
        transformMessages: ({ messages }) =>
          Effect.sync(() => {
            messages[0]!.parts.push({
              id: PartID.make("prt_plugin_untracked"),
              sessionID,
              messageID: userID,
              type: "text",
              text: sentinels.plugin,
            })
          }),
        resolveSystem: () => Effect.succeed([]),
        resolveTools: () => Effect.succeed({}),
      }),
    ),
  ).rejects.toMatchObject({
    code: "missing_source",
    diagnosticCode: "lcm_render_prep_source_origin_missing",
  } satisfies Partial<LcmSafeError>)
})

test("lcm:render-prep allows plugin-created trusted render-only output", async () => {
  const messages = baseMessages()
  attachLcmRenderOriginToMessage(messages[0]!, {
    renderUnitID: "lcm-render-unit-v1:test",
    sourceKind: "raw_message",
    sourceHandle: "msg_render_source",
  })

  const prepared = await Effect.runPromise(
    prepareKiloModelInput({
      sessionID,
      session: fakeSession(),
      messages,
      lastUser: messages[0]!.info as MessageV2.User,
      operationID,
      agent: fakeAgent(),
      model: fakeModel(),
      permissionProfile: [],
      taskCapabilityClass: "root",
      messageVisibility: visibility(),
      envCache: {},
      clock: makeFixtureClock(1_777_500_009_000),
      lcmActive: true,
      transformMessages: ({ messages, clockMs, operationID }) =>
        Effect.sync(() => {
          const part: MessageV2.TextPart = {
            id: PartID.make("prt_plugin_render_only"),
            sessionID,
            messageID: userID,
            type: "text",
            text: sentinels.plugin,
          }
          markLcmRenderOnlyPart(part, {
            kind: "plugin_transform",
            producer: "opencode.plugin.transform",
            operationID,
            createdAtMs: clockMs,
          })
          messages[0]!.parts.push(part)
        }),
      resolveSystem: () => Effect.succeed([]),
      resolveTools: () => Effect.succeed({}),
    }),
  )

  expect(JSON.stringify(prepared.modelMessages)).toContain(sentinels.plugin)
})
