import { describe, expect, it } from "bun:test"
import type { KiloClient, LcmSettingsState, Session } from "@kilocode/sdk/v2/client"
import {
  handleLcmSettingsWebviewRequest,
  isLcmSettingsWebviewRequest,
} from "../../src/kilo-provider/lcm-settings"

function state(strategy: "upward" | "dolt" = "upward") {
  return {
    strategy,
    storageWarningThresholdBytes: 1024,
    storageBytes: 0,
  } as LcmSettingsState
}

describe("LCM settings transport", () => {
  it("recognizes only the two transport-only settings messages", () => {
    expect(isLcmSettingsWebviewRequest({ type: "requestLcmSettings" })).toBe(true)
    expect(isLcmSettingsWebviewRequest({ type: "updateLcmSettings" })).toBe(true)
    expect(isLcmSettingsWebviewRequest({ type: "requestMemory" })).toBe(false)
  })

  it("returns a content-safe error while the runtime client is offline", async () => {
    const posts: unknown[] = []
    await handleLcmSettingsWebviewRequest(
      { type: "requestLcmSettings", requestID: "offline" },
      {
        connected: false,
        directory: () => "/repo",
        post: (message) => posts.push(message),
      },
    )

    expect(posts).toEqual([
      {
        type: "requestLcmSettings.result",
        requestID: "offline",
        ok: false,
        error: expect.objectContaining({
          code: "db_unavailable",
          templateKey: "lcm.db.unavailable",
          diagnosticCode: "lcm_ui_offline",
        }),
      },
    ])
  })

  it("uses the generated session route and trusted workspace context", async () => {
    const calls: unknown[] = []
    const posts: unknown[] = []
    const value = state()
    const client = {
      session: {
        lcm: {
          settings: {
            get: async (input: unknown) => {
              calls.push(input)
              return { data: value }
            },
          },
        },
      },
    } as unknown as KiloClient

    await handleLcmSettingsWebviewRequest(
      { type: "requestLcmSettings", requestID: "session" },
      {
        client,
        connected: true,
        currentSession: { id: "ses_current", workspaceID: "wrk_current" } as Session,
        directory: (sessionID) => `/repo/${sessionID}`,
        post: (message) => posts.push(message),
      },
    )

    expect(calls).toEqual([
      { sessionID: "ses_current", directory: "/repo/ses_current", workspace: "wrk_current" },
    ])
    expect(posts).toEqual([
      { type: "requestLcmSettings.result", requestID: "session", ok: true, state: value },
    ])
  })

  it("uses the generated sessionless update route when no conversation is open", async () => {
    const calls: unknown[] = []
    const posts: unknown[] = []
    const value = state("dolt")
    const client = {
      lcm: {
        settings: {
          update: async (input: unknown) => {
            calls.push(input)
            return { data: value }
          },
        },
      },
    } as unknown as KiloClient

    await handleLcmSettingsWebviewRequest(
      {
        type: "updateLcmSettings",
        requestID: "global",
        strategy: "dolt",
        storageWarningThresholdBytes: 4096,
      },
      {
        client,
        connected: true,
        directory: () => "/repo",
        post: (message) => posts.push(message),
      },
    )

    expect(calls).toEqual([
      {
        directory: "/repo",
        lcmUpdateSettingsInput: { strategy: "dolt", storageWarningThresholdBytes: 4096 },
      },
    ])
    expect(posts).toEqual([
      { type: "updateLcmSettings.result", requestID: "global", ok: true, state: value },
    ])
  })
})
