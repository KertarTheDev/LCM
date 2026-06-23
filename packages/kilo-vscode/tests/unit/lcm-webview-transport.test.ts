import { describe, expect, it } from "bun:test"
import { handleLcmWebviewRequest } from "../../src/kilo-provider/lcm-webview"

type LcmWebviewContext = Parameters<typeof handleLcmWebviewRequest>[1]

function createContext(input: {
  client: unknown
  posts: unknown[]
  connectionState?: LcmWebviewContext["connectionState"]
  currentSession?: Partial<NonNullable<LcmWebviewContext["currentSession"]>> | null
  contextSessionID?: string
  projectID?: string
}) {
  let projectID = input.projectID
  const ctx: LcmWebviewContext = {
    client: input.client as LcmWebviewContext["client"],
    connectionState: input.connectionState ?? "connected",
    currentSession:
      input.currentSession === undefined
        ? ({
            id: "sess-1",
            projectID: "proj-1",
            workspaceID: "workspace-1",
          } as NonNullable<LcmWebviewContext["currentSession"]>)
        : (input.currentSession as LcmWebviewContext["currentSession"]),
    contextSessionID: input.contextSessionID,
    get projectID() {
      return projectID
    },
    setProjectID(nextProjectID) {
      projectID = nextProjectID
    },
    getWorkspaceDirectory(sessionID) {
      return `/workspace/${sessionID ?? "none"}`
    },
    postMessage(message) {
      input.posts.push(message)
    },
  }
  return ctx
}

describe("LCM webview transport", () => {
  it("preserves request IDs and forwards no-session settings reads through the primary runtime SDK", async () => {
    const calls: unknown[] = []
    const client = {
      lcm: {
        settings: {
          async get(input: unknown) {
            calls.push(input)
            return {
              data: {
                strategy: "upward",
                storageWarningThresholdBytes: 10737418240,
                storageBytes: 1024,
                storageWarning: false,
                effectiveScope: { kind: "project", projectID: "proj-1" },
              },
            }
          },
        },
      },
      session: {
        lcm: {
          settings: {
            async get() {
              throw new Error("compatibility session settings route must not be used")
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "requestLcmSettings", requestID: "req-1" },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([
      {
        directory: "/workspace/none",
      },
    ])
    expect(posts).toEqual([
      {
        type: "requestLcmSettings.result",
        requestID: "req-1",
        ok: true,
        body: {
          strategy: "upward",
          storageWarningThresholdBytes: 10737418240,
          storageBytes: 1024,
          storageWarning: false,
          effectiveScope: { kind: "project", projectID: "proj-1" },
        },
      },
    ])
  })

  it("uses session settings reads when an active session is available", async () => {
    const calls: unknown[] = []
    const client = {
      lcm: {
        settings: {
          async get() {
            throw new Error("primary settings route must not be used when a session is available")
          },
        },
      },
      session: {
        lcm: {
          settings: {
            async get(input: unknown) {
              calls.push(input)
              return {
                data: {
                  strategy: "dolt",
                  storageWarningThresholdBytes: 4096,
                  storageBytes: 0,
                  storageWarning: false,
                  effectiveScope: { kind: "workspace", projectID: "proj-1", workspaceID: "workspace-1" },
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest({ type: "requestLcmSettings", requestID: "req-1b" }, createContext({ client, posts }))

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
      },
    ])
    expect(posts).toEqual([
      {
        type: "requestLcmSettings.result",
        requestID: "req-1b",
        ok: true,
        body: {
          strategy: "dolt",
          storageWarningThresholdBytes: 4096,
          storageBytes: 0,
          storageWarning: false,
          effectiveScope: { kind: "workspace", projectID: "proj-1", workspaceID: "workspace-1" },
        },
      },
    ])
  })

  it("forwards no-session settings writes through the primary runtime SDK and returns canonical errors", async () => {
    const safeError = {
      code: "db_locked",
      templateKey: "lcm.db.unavailable",
      safeParams: {},
      safeMessage: "Memory storage is not ready. Follow the shown recovery action.",
      retryable: true,
      diagnosticCode: "lcm_db_locked",
    }
    const calls: unknown[] = []
    const client = {
      lcm: {
        settings: {
          async update(input: unknown) {
            calls.push(input)
            return { error: { error: safeError } }
          },
        },
      },
      session: {
        lcm: {
          settings: {
            async update() {
              throw new Error("compatibility session settings route must not be used")
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      {
        type: "updateLcmSettings",
        requestID: "req-2",
        body: { strategy: "dolt", storageWarningThresholdBytes: 4096 },
      },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([
      {
        directory: "/workspace/none",
        lcmUpdateSettingsInput: {
          strategy: "dolt",
          storageWarningThresholdBytes: 4096,
        },
      },
    ])
    expect(posts).toEqual([
      {
        type: "updateLcmSettings.result",
        requestID: "req-2",
        ok: false,
        error: safeError,
      },
    ])
  })

  it("does not forward malformed runtime safe-error-shaped objects", async () => {
    const calls: unknown[] = []
    const client = {
      lcm: {
        settings: {
          async update(input: unknown) {
            calls.push(input)
            return {
              error: {
                error: {
                  code: "db_locked",
                  templateKey: "lcm.db.unavailable",
                  safeParams: {},
                  safeMessage: "Raw backend text must not be trusted.",
                  retryable: true,
                },
              },
            }
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      {
        type: "updateLcmSettings",
        requestID: "req-2b",
        body: { strategy: "dolt", storageWarningThresholdBytes: 4096 },
      },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toHaveLength(1)
    expect(posts).toEqual([
      {
        type: "updateLcmSettings.result",
        requestID: "req-2b",
        ok: false,
        error: {
          code: "db_unavailable",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Memory request failed.",
          retryable: false,
          diagnosticCode: "lcm_webview_settings_update_failed",
        },
      },
    ])
  })

  it("uses session settings writes when an active session is available", async () => {
    const calls: unknown[] = []
    const client = {
      lcm: {
        settings: {
          async update() {
            throw new Error("primary settings route must not be used when a session is available")
          },
        },
      },
      session: {
        lcm: {
          settings: {
            async update(input: unknown) {
              calls.push(input)
              return {
                data: {
                  strategy: "dolt",
                  storageWarningThresholdBytes: 4096,
                  storageBytes: 0,
                  storageWarning: false,
                  effectiveScope: { kind: "workspace", projectID: "proj-1", workspaceID: "workspace-1" },
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      {
        type: "updateLcmSettings",
        requestID: "req-3",
        body: { strategy: "dolt", storageWarningThresholdBytes: 4096 },
      },
      createContext({ client, posts }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
        lcmUpdateSettingsInput: {
          strategy: "dolt",
          storageWarningThresholdBytes: 4096,
        },
      },
    ])
    expect(posts).toEqual([
      {
        type: "updateLcmSettings.result",
        requestID: "req-3",
        ok: true,
        body: {
          strategy: "dolt",
          storageWarningThresholdBytes: 4096,
          storageBytes: 0,
          storageWarning: false,
          effectiveScope: { kind: "workspace", projectID: "proj-1", workspaceID: "workspace-1" },
        },
      },
    ])
  })

  it("cancels queued maintenance through the session runtime route", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          maintenance: {
            async cancel(input: unknown) {
              calls.push(input)
              return {
                data: {
                  conversationID: "conv-webview-cancel",
                  operationID: "op-webview-cancel",
                  workNeeded: true,
                  workPerformed: false,
                  blocking: false,
                  reason: "soft_threshold",
                  summariesCreated: 0,
                  contextItemsReplaced: 0,
                  status: "canceled",
                  safeMessage: "Queued memory maintenance retry was canceled.",
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "cancelLcmMaintenance", requestID: "req-cancel" },
      createContext({ client, posts }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
        lcmCancelMaintenanceInput: { reason: "user" },
      },
    ])
    expect(posts).toEqual([
      {
        type: "cancelLcmMaintenance.result",
        requestID: "req-cancel",
        ok: true,
        body: {
          conversationID: "conv-webview-cancel",
          operationID: "op-webview-cancel",
          workNeeded: true,
          workPerformed: false,
          blocking: false,
          reason: "soft_threshold",
          summariesCreated: 0,
          contextItemsReplaced: 0,
          status: "canceled",
          safeMessage: "Queued memory maintenance retry was canceled.",
        },
      },
    ])
  })

  it("runs read-only DB diagnostics through the trusted session route", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          db: {
            async diagnose(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-diagnose",
                  dataDir: "/safe/lcm/family",
                  status: "ready",
                  schemaVersion: 1,
                  checks: [{ name: "Open DB for diagnosis", status: "passed" }],
                  safeErrors: [],
                  quarantineRecommended: false,
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "diagnoseLcmDb", requestID: "req-diagnose" },
      createContext({ client, posts }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
      },
    ])
    expect(posts).toEqual([
      {
        type: "diagnoseLcmDb.result",
        requestID: "req-diagnose",
        ok: true,
        body: {
          operationID: "op-webview-diagnose",
          dataDir: "/safe/lcm/family",
          status: "ready",
          schemaVersion: 1,
          checks: [{ name: "Open DB for diagnosis", status: "passed" }],
          safeErrors: [],
          quarantineRecommended: false,
        },
      },
    ])
  })

  it("runs DB rebuild previews through the trusted session route", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          db: {
            async rebuild(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-rebuild",
                  dataDir: "/safe/lcm/family",
                  dryRun: true,
                  status: "would_rebuild",
                  rebuiltConversations: 0,
                  readOnlyConversations: 0,
                  skippedConversations: 0,
                  failedConversations: 0,
                  safeErrors: [],
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "rebuildLcmDb", requestID: "req-rebuild", body: { dryRun: true } },
      createContext({ client, posts }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
        lcmDbRebuildInput: { dryRun: true },
      },
    ])
    expect(posts).toEqual([
      {
        type: "rebuildLcmDb.result",
        requestID: "req-rebuild",
        ok: true,
        body: {
          operationID: "op-webview-rebuild",
          dataDir: "/safe/lcm/family",
          dryRun: true,
          status: "would_rebuild",
          rebuiltConversations: 0,
          readOnlyConversations: 0,
          skippedConversations: 0,
          failedConversations: 0,
          safeErrors: [],
        },
      },
    ])
  })

  it("exports reconstructed prompts through the trusted session route", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          prompts: {
            async export(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-export",
                  sessionID: "sess-1",
                  conversationID: "conv-webview-export",
                  exportDir: "/workspace/sess-1/lcm-export/20260611-sess-1",
                  fileCount: 3,
                  warnings: [],
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "exportLcmPrompts", requestID: "req-export" },
      createContext({ client, posts }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-1",
        directory: "/workspace/sess-1",
        workspace: "workspace-1",
      },
    ])
    expect(posts).toEqual([
      {
        type: "exportLcmPrompts.result",
        requestID: "req-export",
        ok: true,
        body: {
          operationID: "op-webview-export",
          sessionID: "sess-1",
          conversationID: "conv-webview-export",
          exportDir: "/workspace/sess-1/lcm-export/20260611-sess-1",
          fileCount: 3,
          warnings: [],
        },
      },
    ])
  })

  it("exports prompts for an explicit selected session when host current session state is empty", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          prompts: {
            async export(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-export-visible",
                  sessionID: "sess-visible",
                  conversationID: "conv-webview-export-visible",
                  exportDir: "/workspace/sess-visible/lcm-export/20260611-sess-visible",
                  fileCount: 1,
                  warnings: [],
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "exportLcmPrompts", requestID: "req-export-visible", body: { sessionID: "sess-visible" } },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-visible",
        directory: "/workspace/sess-visible",
      },
    ])
    expect(posts).toEqual([
      {
        type: "exportLcmPrompts.result",
        requestID: "req-export-visible",
        ok: true,
        body: {
          operationID: "op-webview-export-visible",
          sessionID: "sess-visible",
          conversationID: "conv-webview-export-visible",
          exportDir: "/workspace/sess-visible/lcm-export/20260611-sess-visible",
          fileCount: 1,
          warnings: [],
        },
      },
    ])
  })

  it("exports prompts for the inherited settings-panel session when webview session state is empty", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          prompts: {
            async export(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-export-inherited",
                  sessionID: "sess-inherited",
                  conversationID: "conv-webview-export-inherited",
                  exportDir: "/workspace/sess-inherited/lcm-export/20260611-sess-inherited",
                  fileCount: 2,
                  warnings: [],
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "exportLcmPrompts", requestID: "req-export-inherited" },
      createContext({ client, posts, currentSession: null, contextSessionID: "sess-inherited" }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-inherited",
        directory: "/workspace/sess-inherited",
      },
    ])
    expect(posts).toEqual([
      {
        type: "exportLcmPrompts.result",
        requestID: "req-export-inherited",
        ok: true,
        body: {
          operationID: "op-webview-export-inherited",
          sessionID: "sess-inherited",
          conversationID: "conv-webview-export-inherited",
          exportDir: "/workspace/sess-inherited/lcm-export/20260611-sess-inherited",
          fileCount: 2,
          warnings: [],
        },
      },
    ])
  })

  it("does not forward stale workspace metadata for an explicit different selected session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          prompts: {
            async export(input: unknown) {
              calls.push(input)
              return {
                data: {
                  operationID: "op-webview-export-explicit",
                  sessionID: "sess-explicit",
                  conversationID: "conv-webview-export-explicit",
                  exportDir: "/workspace/sess-explicit/lcm-export/20260611-sess-explicit",
                  fileCount: 2,
                  warnings: [],
                },
              }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "exportLcmPrompts", requestID: "req-export-explicit", body: { sessionID: "sess-explicit" } },
      createContext({
        client,
        posts,
        currentSession: { id: "sess-stale", workspaceID: "workspace-stale" },
        contextSessionID: "sess-stale",
      }),
    )

    expect(calls).toEqual([
      {
        sessionID: "sess-explicit",
        directory: "/workspace/sess-explicit",
      },
    ])
    expect(posts).toEqual([
      {
        type: "exportLcmPrompts.result",
        requestID: "req-export-explicit",
        ok: true,
        body: {
          operationID: "op-webview-export-explicit",
          sessionID: "sess-explicit",
          conversationID: "conv-webview-export-explicit",
          exportDir: "/workspace/sess-explicit/lcm-export/20260611-sess-explicit",
          fileCount: 2,
          warnings: [],
        },
      },
    ])
  })

  it("fails closed when maintenance cancel has no active session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          maintenance: {
            async cancel(input: unknown) {
              calls.push(input)
              return { data: {} }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "cancelLcmMaintenance", requestID: "req-cancel-missing" },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([])
    expect(posts).toEqual([
      {
        type: "cancelLcmMaintenance.result",
        requestID: "req-cancel-missing",
        ok: false,
        error: {
          code: "invalid_request",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Open a Kilo task before canceling queued memory maintenance.",
          retryable: false,
          diagnosticCode: "lcm_webview_cancel_maintenance_session_missing",
        },
      },
    ])
  })

  it("fails closed when DB diagnostics have no active session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          db: {
            async diagnose(input: unknown) {
              calls.push(input)
              return { data: {} }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "diagnoseLcmDb", requestID: "req-diagnose-missing" },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([])
    expect(posts).toEqual([
      {
        type: "diagnoseLcmDb.result",
        requestID: "req-diagnose-missing",
        ok: false,
        error: {
          code: "invalid_request",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Open a Kilo task before running memory diagnostics.",
          retryable: false,
          diagnosticCode: "lcm_webview_db_diagnose_session_missing",
        },
      },
    ])
  })

  it("fails closed when DB rebuild has no active session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          db: {
            async rebuild(input: unknown) {
              calls.push(input)
              return { data: {} }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "rebuildLcmDb", requestID: "req-rebuild-missing", body: { dryRun: true } },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([])
    expect(posts).toEqual([
      {
        type: "rebuildLcmDb.result",
        requestID: "req-rebuild-missing",
        ok: false,
        error: {
          code: "invalid_request",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Open a Kilo task before repairing memory.",
          retryable: false,
          diagnosticCode: "lcm_webview_db_rebuild_session_missing",
        },
      },
    ])
  })

  it("fails closed when prompt export has no active session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        lcm: {
          prompts: {
            async export(input: unknown) {
              calls.push(input)
              return { data: {} }
            },
          },
        },
      },
    }
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "exportLcmPrompts", requestID: "req-export-missing" },
      createContext({ client, posts, currentSession: null }),
    )

    expect(calls).toEqual([])
    expect(posts).toEqual([
      {
        type: "exportLcmPrompts.result",
        requestID: "req-export-missing",
        ok: false,
        error: {
          code: "invalid_request",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Open a Kilo task before exporting memory prompts.",
          retryable: false,
          diagnosticCode: "lcm_webview_prompts_export_session_missing",
        },
      },
    ])
  })

  it("fails closed with a safe error when the backend is disconnected", async () => {
    const posts: unknown[] = []

    await handleLcmWebviewRequest(
      { type: "requestLcmSettings", requestID: "req-4" },
      createContext({ client: null, posts, connectionState: "disconnected" }),
    )

    expect(posts).toEqual([
      {
        type: "requestLcmSettings.result",
        requestID: "req-4",
        ok: false,
        error: {
          code: "db_unavailable",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          safeMessage: "Memory settings are unavailable because the CLI backend is not connected.",
          retryable: true,
          diagnosticCode: "lcm_webview_backend_not_connected",
        },
      },
    ])
  })
})
