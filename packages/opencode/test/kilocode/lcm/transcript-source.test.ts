import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { KiloTranscriptSource, extractFinalSources } from "@/kilocode/session/lcm/transcript-source"
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

  test("returns digest-verified immutable persisted media", async () => {
    const source = new KiloTranscriptSource(async () => messages())
    const page = await source.listFinalSources({ sessionID, limit: 10 })
    const media = page.items.find((item) => item.kind === "media")
    expect(media).toBeDefined()
    const read = await source.readSource({ sessionID, sourceID: media!.id })
    expect(read?.immutableMedia?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(read?.digest).toBe(sha256(new Uint8Array([1, 2, 3, 4])))
    expect((await source.computeLineage({ sessionID })).digest).toBe(page.lineage.digest)
  })
})
