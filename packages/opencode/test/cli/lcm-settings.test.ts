// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { formatLcmSettingsState, lcmSettingsUpdateFromArgs, resolveLcmSettingsScope } from "../../src/cli/cmd/lcm"
import type { LcmSettingsState } from "../../src/session/lcm/types"

describe("lcm settings cli helpers", () => {
  test("defaults to the current project scope", () => {
    expect(resolveLcmSettingsScope({}, { projectID: "project_a" })).toEqual({ projectID: "project_a" })
  })

  test("uses current workspace scope when present", () => {
    expect(resolveLcmSettingsScope({}, { projectID: "project_a", workspaceID: "workspace_a" })).toEqual({
      projectID: "project_a",
      workspaceID: "workspace_a",
    })
  })

  test("session scope does not add current project unless explicitly requested", () => {
    expect(resolveLcmSettingsScope({ session: "ses_a" }, { projectID: "project_a" })).toEqual({
      sessionID: "ses_a",
    })
  })

  test("builds update payload without an enabled switch", () => {
    expect(
      lcmSettingsUpdateFromArgs({
        strategy: "dolt",
        freshTailTokens: 20_000,
        storageWarningThresholdBytes: 1024,
      }),
    ).toEqual({
      strategy: "dolt",
      freshTailTokens: 20_000,
      storageWarningThresholdBytes: 1024,
    })
  })

  test("formats content-safe settings state", () => {
    const state: LcmSettingsState = {
      strategy: "upward",
      freshTailTokens: 20_000,
      storageWarningThresholdBytes: 1024,
      storageBytes: 512,
      storageWarning: false,
      effectiveScope: { kind: "project", projectID: "project_a" },
      lifecycleState: "lcm_active",
      dbStatus: { status: "ready", dataDir: "/tmp/lcm", schemaVersion: 1 },
    }

    const text = formatLcmSettingsState(state)
    expect(text).toContain("strategy: upward")
    expect(text).toContain("freshTailTokens: 20000")
    expect(text).toContain("scope: project project=project_a")
    expect(text).toContain("dbStatus: ready")
  })
})
