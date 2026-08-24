import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import {
  bootstrapConsumedThrough,
  extractFinalSources,
  replacementBootstrapConsumedThrough,
} from "@/kilocode/session/lcm/transcript-source"
import { sha256 } from "@/kilocode/session/lcm/ids"
import type { MessageID, PartID } from "@/session/schema"

const sessionID = "ses_source"
const messageID = (value: string) => value as MessageID
const partID = (value: string) => value as PartID

function messages() {
  return [
    {
      info: {
        id: "msg_user",
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [
        { id: "part_user", sessionID, messageID: "msg_user", type: "text", text: "Remember α and beta." },
        {
          id: "part_media",
          sessionID,
          messageID: "msg_user",
          type: "file",
          mime: "image/png",
          filename: "pixel.png",
          url: "data:image/png;base64,AQIDBA==",
        },
      ],
    },
    {
      info: {
        id: "msg_assistant",
        sessionID,
        role: "assistant",
        parentID: "msg_user",
        providerID: "test",
        modelID: "test",
        mode: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
        finish: "stop",
      },
      parts: [
        {
          id: "part_lcm",
          sessionID,
          messageID: "msg_assistant",
          type: "tool",
          callID: "call_lcm",
          tool: "lcm_read",
          state: {
            status: "completed",
            input: { sourceID: "src_old" },
            output: "large recovered payload",
            title: "read",
            metadata: {},
            time: { start: 2, end: 3 },
          },
        },
        {
          id: "part_tool",
          sessionID,
          messageID: "msg_assistant",
          type: "tool",
          callID: "call_read",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "decision.txt" },
            output: "original compacted tool detail",
            title: "read",
            metadata: {},
            time: { start: 2, end: 3, compacted: 4 },
          },
        },
        {
          id: "part_answer",
          sessionID,
          messageID: "msg_assistant",
          type: "text",
          text: "The binding answer is beta.",
          time: { start: 2, end: 3 },
        },
      ],
    },
    {
      info: {
        id: "msg_summary",
        sessionID,
        role: "assistant",
        parentID: "msg_compact",
        providerID: "test",
        modelID: "test",
        mode: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 4, completed: 5 },
        finish: "stop",
        summary: true,
      },
      parts: [
        {
          id: "part_summary",
          sessionID,
          messageID: "msg_summary",
          type: "text",
          text: "Legacy compaction summary",
          time: { start: 4, end: 5 },
        },
      ],
    },
  ] as SessionV1.WithParts[]
}

describe("LCM transcript source", () => {
  test("indexes every finalized model-visible source, including LCM recovery results", () => {
    const items = extractFinalSources(sessionID, messages())
    expect(items.map((item) => item.metadata.partID)).toEqual([
      "part_user",
      "part_media",
      "part_lcm",
      "part_tool",
      "part_answer",
    ])
    expect(items.map((item) => item.metadata.ordinal)).toEqual([0, 1, 2, 3, 4])
    expect(items[2]?.content).toContain("large recovered payload")
    expect(items[3]?.content).toContain("original compacted tool detail")
    expect(items[4]?.content).toBe("The binding answer is beta.")
  })

  test("extracts digest-verified immutable persisted media", () => {
    const media = extractFinalSources(sessionID, messages()).find((item) => item.metadata.kind === "media")
    expect(media).toBeDefined()
    expect(media?.immutableMedia?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(media?.metadata.digest).toBe(sha256(new Uint8Array([1, 2, 3, 4])))
  })

  test("normalizes the newest-first MessageV2 stream before assigning ordinals", () => {
    const chronological = extractFinalSources(sessionID, messages())
    const streamed = extractFinalSources(sessionID, messages().toReversed())
    expect(streamed.map((item) => item.metadata.id)).toEqual(chronological.map((item) => item.metadata.id))
    expect(streamed.map((item) => item.metadata.ordinal)).toEqual([0, 1, 2, 3, 4])
  })

  test("keeps stable chronology beyond one hundred imported sources", () => {
    const transcript = Array.from({ length: 128 }, (_, index) => ({
      info: {
        id: `msg_${index.toString().padStart(3, "0")}`,
        sessionID,
        role: "user" as const,
        time: { created: index + 1 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [
        {
          id: `part_${index.toString().padStart(3, "0")}`,
          sessionID,
          messageID: `msg_${index.toString().padStart(3, "0")}`,
          type: "text" as const,
          text: `Imported source ${index}`,
        },
      ],
    })) as SessionV1.WithParts[]
    const sources = extractFinalSources(sessionID, transcript.toReversed())
    expect(sources).toHaveLength(128)
    expect(sources.map((item) => item.metadata.ordinal)).toEqual(Array.from({ length: 128 }, (_, index) => index))
    expect(sources[0]?.metadata.partID).toBe("part_000")
    expect(sources.at(-1)?.metadata.partID).toBe("part_127")
  })

  test("bootstraps only history proven consumed by a later successful response", () => {
    const transcript = messages()
    const sources = extractFinalSources(sessionID, transcript).map((item) => item.metadata)
    expect(bootstrapConsumedThrough(sessionID, transcript, sources)).toBe(1)
    expect(bootstrapConsumedThrough(sessionID, transcript.toReversed(), sources)).toBe(1)
  })

  test("re-bootstraps proven consumption after an unconsumed retry suffix is replaced", () => {
    const [user] = messages()
    const retry = {
      info: {
        ...user!.info,
        id: messageID("msg_retry_new"),
        time: { created: 6 },
      },
      parts: [
        {
          ...user!.parts[0]!,
          id: partID("part_retry_new"),
          messageID: messageID("msg_retry_new"),
          text: "Retry the current unconsumed request.",
        },
      ],
    } as SessionV1.WithParts
    const transcript = [...messages(), retry]
    const sources = extractFinalSources(sessionID, transcript).map((item) => item.metadata)
    const previousSources = sources.map((source, index) =>
      index === sources.length - 1
        ? {
            ...source,
            id: "src_retry_old",
            messageID: "msg_retry_old",
            partID: "part_retry_old",
          }
        : source,
    )

    expect(
      replacementBootstrapConsumedThrough({
        sessionID,
        messages: transcript,
        previousSources,
        sources,
        hadPreviousLineage: true,
      }),
    ).toBe(1)
    expect(
      replacementBootstrapConsumedThrough({
        sessionID,
        messages: transcript,
        previousSources: sources.slice(0, -1),
        sources,
        hadPreviousLineage: true,
      }),
    ).toBe(-1)
  })

  test("a later successful provider step consumes sequential and parallel LCM tool results", () => {
    const [user, assistant] = messages()
    const lcm = assistant!.parts.find(
      (part): part is SessionV1.ToolPart => part.id === "part_lcm" && part.type === "tool",
    )!
    const toolStep = {
      info: {
        ...assistant!.info,
        id: messageID("msg_tool_step"),
        finish: "tool-calls",
        time: { created: 2, completed: 3 },
      },
      parts: [
        { ...lcm, messageID: messageID("msg_tool_step") },
        {
          ...lcm,
          id: partID("part_parallel_lcm"),
          messageID: messageID("msg_tool_step"),
          callID: "call_parallel_lcm",
          tool: "lcm_grep",
          state: { ...lcm.state, input: { pattern: "binding" }, output: "parallel recovered payload" },
        },
      ],
    } as SessionV1.WithParts
    const sequentialStep = {
      info: {
        ...assistant!.info,
        id: messageID("msg_sequential_tool_step"),
        parentID: messageID("msg_tool_step"),
        finish: "tool-calls",
        time: { created: 4, completed: 5 },
      },
      parts: [
        {
          ...lcm,
          id: partID("part_sequential_lcm"),
          messageID: messageID("msg_sequential_tool_step"),
          callID: "call_sequential_lcm",
          tool: "lcm_expand",
          state: { ...lcm.state, input: { handle: "sum_old" }, output: "sequential recovered payload" },
        },
      ],
    } as SessionV1.WithParts
    const answerStep = {
      info: {
        ...assistant!.info,
        id: messageID("msg_answer_step"),
        parentID: messageID("msg_sequential_tool_step"),
        finish: "stop",
        time: { created: 6, completed: 7 },
      },
      parts: [
        {
          id: partID("part_final_answer"),
          sessionID,
          messageID: messageID("msg_answer_step"),
          type: "text",
          text: "Done after recovery.",
          time: { start: 6, end: 7 },
        },
      ],
    } as SessionV1.WithParts
    const transcript = [user!, toolStep, sequentialStep, answerStep]
    const sources = extractFinalSources(sessionID, transcript).map((item) => item.metadata)
    const beforeFinalSuccess = transcript.slice(0, -1)
    const beforeFinalSources = extractFinalSources(sessionID, beforeFinalSuccess).map((item) => item.metadata)

    expect(sources.map((source) => source.partID)).toEqual([
      "part_user",
      "part_media",
      "part_lcm",
      "part_parallel_lcm",
      "part_sequential_lcm",
      "part_final_answer",
    ])
    expect(bootstrapConsumedThrough(sessionID, beforeFinalSuccess, beforeFinalSources)).toBe(3)
    expect(bootstrapConsumedThrough(sessionID, transcript, sources)).toBe(4)
  })
})
