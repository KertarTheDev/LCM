import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { bootstrapConsumedThrough, extractFinalSources } from "@/kilocode/session/lcm/transcript-source"
import { sha256 } from "@/kilocode/session/lcm/ids"

const sessionID = "ses_source"

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
  test("indexes only finalized ordinary model-visible content", () => {
    const items = extractFinalSources(sessionID, messages())
    expect(items.map((item) => item.metadata.partID)).toEqual(["part_user", "part_media", "part_tool", "part_answer"])
    expect(items.map((item) => item.metadata.ordinal)).toEqual([0, 1, 2, 3])
    expect(items[2]?.content).toContain("original compacted tool detail")
    expect(items[3]?.content).toBe("The binding answer is beta.")
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
    expect(streamed.map((item) => item.metadata.ordinal)).toEqual([0, 1, 2, 3])
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
})
