import { describe, expect, test } from "bun:test"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
import { createContextExport, LCM_UPSTREAM_BASE } from "@/kilocode/session/lcm/context-export"
import { normalizeModelInput } from "@/kilocode/session/lcm/context-frame"
import { SqliteConversationMemoryStore } from "@/kilocode/session/lcm/store"
import { sha256 } from "@/kilocode/session/lcm/ids"
import { writePrivateFileExclusive } from "@/kilocode/session/lcm/atomic-export"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"

describe("LCM context export", () => {
  test("records normalized frames and exports a self-consistent redacted ZIP", async () => {
    const store = SqliteConversationMemoryStore.open({ databasePath: ":memory:" })
    const normalized = normalizeModelInput({
      system: ["system"],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "text/plain",
              data: "data:text/plain;base64,c2Vuc2l0aXZlLWJ5dGVz",
            },
          ],
          providerOptions: { authorization: "secret-provider-value" },
        },
      ],
      tools: {
        read: {
          description: "Read a file",
          inputSchema: { type: "object" },
          execute: () => "must not be captured",
        },
      },
    })
    await store.recordFrame({
      id: "frame_test",
      sessionID: "ses_export",
      requestID: "msg_export",
      lineageDigest: "",
      active: true,
      reason: "latest",
      pre: normalized,
      post: normalized,
      pressureBefore: 0.4,
      pressureAfter: 0.4,
      usableInputTokens: 10_000,
      thresholdRatio: 0.6,
      rawTokens: 4_000,
      rawLaneTokens: 3_000,
      fixedInputTokens: 1_000,
      recentTailTokens: 2_000,
      summaryTokens: 0,
      createdAt: 1,
    })
    await store.recordAttempt({
      id: "attempt_test",
      nodeKey: "node_test",
      sessionID: "ses_export",
      providerID: "provider_test",
      modelID: "model_test",
      mode: "normal",
      inputTokens: 1_000,
      outputTokens: 0,
      reasoningTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      errorCode: "lcm_summary_rejected",
      durationMs: 200,
      createdAt: 2,
    })
    for (let index = 0; index < 105; index++) {
      await store.appendActivity({
        id: `activity_${index}`,
        sessionID: "ses_export",
        kind: "intervention",
        message: `intervention ${index}`,
        createdAt: index + 2,
      })
    }

    expect(await store.listFrames("ses_export")).toEqual([
      expect.objectContaining({
        id: "frame_test",
        pre: normalized,
        usableInputTokens: 10_000,
        thresholdRatio: 0.6,
      }),
    ])

    const output = await createContextExport({ sessionID: "ses_export", store })
    expect(output.frameCount).toBe(1)
    const zip = new ZipReader(new Uint8ArrayReader(output.bytes))
    const entries = await zip.getEntries()
    expect(entries.map((entry) => entry.filename).toSorted()).toEqual(["context.json", "context.md", "manifest.json"])
    const context = await entries.find((entry) => entry.filename === "context.json")!.getData!(new TextWriter())
    const parsed = JSON.parse(context) as {
      activity: unknown[]
      attempts: Array<{ id: string; errorCode?: string }>
      product: { upstreamBase: string }
    }
    const manifest = JSON.parse(
      await entries.find((entry) => entry.filename === "manifest.json")!.getData!(new TextWriter()),
    ) as {
      frameCount: number
      attemptCount: number
      files: Record<string, { sha256: string }>
      product: { upstreamBase: string }
    }
    expect(manifest.frameCount).toBe(1)
    expect(parsed.product.upstreamBase).toBe(LCM_UPSTREAM_BASE)
    expect(manifest.product.upstreamBase).toBe("v7.5.9")
    expect(parsed.activity).toHaveLength(105)
    expect(parsed.attempts).toEqual([
      expect.objectContaining({ id: "attempt_test", errorCode: "lcm_summary_rejected" }),
    ])
    expect(manifest.attemptCount).toBe(1)
    expect(manifest.files["context.json"]?.sha256).toBe(sha256(context))
    expect(context).toContain("excluded-binary")
    expect(context).toContain("excluded-sensitive")
    expect(context).not.toContain("c2Vuc2l0aXZlLWJ5dGVz")
    expect(context).not.toContain("secret-provider-value")
    expect(context).not.toContain("must not be captured")
    await zip.close()
    store.close()
  })

  test("publishes a complete private export without overwriting", async () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "lcm-export-"))
    const target = path.join(root, "context.zip")
    await writePrivateFileExclusive(target, new Uint8Array([1, 2, 3]))
    expect([...readFileSync(target)]).toEqual([1, 2, 3])
    expect(statSync(target).mode & 0o777).toBe(0o600)
    await expect(writePrivateFileExclusive(target, new Uint8Array([4]))).rejects.toMatchObject({ code: "EEXIST" })
    expect(readdirSync(root)).toEqual(["context.zip"])
    rmSync(root, { recursive: true })
  })
})
