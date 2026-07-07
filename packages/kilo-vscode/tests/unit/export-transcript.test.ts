import { describe, expect, it } from "bun:test"
import { fetchTranscriptItems, formatTranscript } from "../../src/kilo-provider/export-transcript"

type Message = { info: { id: string; role: "user" | "assistant"; time: { created: number } }; parts: unknown[] }

function message(id: string, role: "user" | "assistant", time: number, parts: unknown[] = []): Message {
  return { info: { id, role, time: { created: time } }, parts }
}

function mockClient(pages: { items: Message[]; cursor?: string }[]) {
  const calls: { before?: string; limit?: number }[] = []
  let idx = 0
  const client = {
    session: {
      messages: async (
        params: { sessionID: string; directory: string; limit: number; before?: string },
        _opts: { throwOnError: boolean; signal?: AbortSignal },
      ) => {
        calls.push({ before: params.before, limit: params.limit })
        const page = pages[idx++]
        if (!page) throw new Error("no more mock pages")
        const headers = new Headers()
        if (page.cursor) headers.set("X-Next-Cursor", page.cursor)
        return {
          data: page.items,
          response: { headers },
        }
      },
    },
  }
  return { client, calls }
}

describe("export transcript", () => {
  it("fetches session messages by cursor pages in chronological order", async () => {
    const { client, calls } = mockClient([
      { items: [message("m3", "user", 30), message("m4", "assistant", 40)], cursor: "older" },
      { items: [message("m1", "user", 10), message("m2", "assistant", 20)] },
    ])

    const items = await fetchTranscriptItems(client as never, { sessionID: "s1", dir: "/repo" })

    expect(calls.map((call) => call.before)).toEqual([undefined, "older"])
    expect(calls.every((call) => call.limit === 80)).toBe(true)
    expect(items.map((item) => item.info.id)).toEqual(["m1", "m2", "m3", "m4"])
  })

  it("renders tool input, output preview, error preview, and sidecar metadata", () => {
    const session = {
      id: "session_export_tool_details",
      title: "Tool transcript",
      time: { created: 1_800_000_000_000, updated: 1_800_000_001_000 },
    }
    const transcript = formatTranscript(session as never, [
      message("u1", "user", 1, [
        { id: "p1", messageID: "u1", type: "text", text: "Run the command", synthetic: false },
        { id: "p2", messageID: "u1", type: "text", text: "hidden", synthetic: true },
      ]),
      message("a1", "assistant", 2, [
        {
          id: "tool1",
          messageID: "a1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "printf needle" },
            output: "needle output",
            title: "bash",
            metadata: {
              outputPath: "/tmp/kilo/tool-output/full.log",
              outputByteCount: 123,
              outputSha256: "abc123",
            },
          },
        },
        {
          id: "tool2",
          messageID: "a1",
          type: "tool",
          tool: "read",
          state: {
            status: "error",
            input: { filePath: "missing.txt" },
            error: "file not found",
          },
        },
      ]),
    ] as never)

    expect(transcript).toContain("**Tool: bash**")
    expect(transcript).toContain("Status: completed")
    expect(transcript).toContain('"command": "printf needle"')
    expect(transcript).toContain("needle output")
    expect(transcript).toContain("Full output sidecar: /tmp/kilo/tool-output/full.log")
    expect(transcript).toContain("Output bytes: 123")
    expect(transcript).toContain("Output SHA-256: abc123")
    expect(transcript).toContain("**Tool: read**")
    expect(transcript).toContain("file not found")
    expect(transcript).not.toContain("hidden")
  })

  it("keeps an empty session export readable", () => {
    const text = formatTranscript(
      {
        id: "ses_empty",
        title: "Empty",
        time: { created: 1_000, updated: 2_000 },
      } as never,
      [],
    )

    expect(text).toContain("# Empty")
    expect(text).toEndWith("---\n\n")
  })
})
