import { describe, expect, it } from "bun:test"
import {
  beginLcmDbDiagnose,
  beginLcmDbRebuild,
  beginLcmMaintenanceCancel,
  beginLcmPromptsExport,
  beginLcmSettingsRead,
  beginLcmSettingsUpdate,
  finishLcmSettingsRequest,
  lcmMemoryRequestScope,
  type LcmSettingsPendingRequests,
} from "../../webview-ui/src/components/settings/lcm-memory-requests"

describe("LCM/Memory settings request tracking", () => {
  it("builds a session scope only for selected local Kilo sessions", () => {
    expect(lcmMemoryRequestScope("sess-1")).toEqual({ sessionID: "sess-1" })
    expect(lcmMemoryRequestScope(" sess-1 ")).toEqual({ sessionID: "sess-1" })
    expect(lcmMemoryRequestScope(undefined)).toEqual({})
    expect(lcmMemoryRequestScope("")).toEqual({})
    expect(lcmMemoryRequestScope("   ")).toEqual({})
    expect(lcmMemoryRequestScope("cloud:remote-1")).toEqual({})
  })

  it("accepts only the current matching read response", () => {
    let pending: LcmSettingsPendingRequests = beginLcmSettingsRead({}, "read-1").pending
    pending = beginLcmSettingsRead(pending, "read-2").pending

    const stale = finishLcmSettingsRequest(pending, "read", "read-1")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ read: "read-2" })

    const current = finishLcmSettingsRequest(stale.pending, "read", "read-2")
    expect(current.accepted).toBe(true)
    expect(current.pending).toEqual({})
  })

  it("invalidates in-flight reads when a settings update starts", () => {
    const reading = beginLcmSettingsRead({}, "read-1").pending
    const updating = beginLcmSettingsUpdate(reading, "write-1").pending

    expect(updating).toEqual({ update: "write-1" })

    const staleRead = finishLcmSettingsRequest(updating, "read", "read-1")
    expect(staleRead.accepted).toBe(false)
    expect(staleRead.pending).toEqual({ update: "write-1" })

    const currentUpdate = finishLcmSettingsRequest(staleRead.pending, "update", "write-1")
    expect(currentUpdate.accepted).toBe(true)
    expect(currentUpdate.pending).toEqual({})
  })

  it("defers refresh reads while a settings update is pending", () => {
    const pending = beginLcmSettingsUpdate({}, "write-1").pending
    const read = beginLcmSettingsRead(pending, "read-1")

    expect(read.started).toBe(false)
    expect(read.pending).toEqual({ update: "write-1" })
  })

  it("ignores stale update responses without clearing the current update", () => {
    let pending: LcmSettingsPendingRequests = beginLcmSettingsUpdate({}, "write-1").pending
    pending = beginLcmSettingsUpdate(pending, "write-2").pending

    const stale = finishLcmSettingsRequest(pending, "update", "write-1")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ update: "write-2" })
  })

  it("tracks maintenance cancel as an exclusive DB-backed request", () => {
    const canceling = beginLcmMaintenanceCancel({}, "cancel-1").pending
    const read = beginLcmSettingsRead(canceling, "read-1")
    const update = beginLcmSettingsUpdate(canceling, "write-1")

    expect(read.started).toBe(false)
    expect(read.pending).toEqual({ cancelMaintenance: "cancel-1" })
    expect(update.started).toBe(false)
    expect(update.pending).toEqual({ cancelMaintenance: "cancel-1" })

    const stale = finishLcmSettingsRequest(canceling, "cancelMaintenance", "cancel-old")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ cancelMaintenance: "cancel-1" })

    const current = finishLcmSettingsRequest(stale.pending, "cancelMaintenance", "cancel-1")
    expect(current.accepted).toBe(true)
    expect(current.pending).toEqual({})
  })

  it("tracks DB diagnosis as an exclusive read-only DB request", () => {
    const diagnosing = beginLcmDbDiagnose({}, "diagnose-1").pending
    const read = beginLcmSettingsRead(diagnosing, "read-1")
    const update = beginLcmSettingsUpdate(diagnosing, "write-1")
    const cancel = beginLcmMaintenanceCancel(diagnosing, "cancel-1")

    expect(read.started).toBe(false)
    expect(read.pending).toEqual({ diagnoseDb: "diagnose-1" })
    expect(update.started).toBe(false)
    expect(update.pending).toEqual({ diagnoseDb: "diagnose-1" })
    expect(cancel.started).toBe(false)
    expect(cancel.pending).toEqual({ diagnoseDb: "diagnose-1" })

    const stale = finishLcmSettingsRequest(diagnosing, "diagnoseDb", "diagnose-old")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ diagnoseDb: "diagnose-1" })

    const current = finishLcmSettingsRequest(stale.pending, "diagnoseDb", "diagnose-1")
    expect(current.accepted).toBe(true)
    expect(current.pending).toEqual({})
  })

  it("tracks DB rebuild as an exclusive DB repair request", () => {
    const rebuilding = beginLcmDbRebuild({}, "rebuild-1").pending
    const read = beginLcmSettingsRead(rebuilding, "read-1")
    const update = beginLcmSettingsUpdate(rebuilding, "write-1")
    const cancel = beginLcmMaintenanceCancel(rebuilding, "cancel-1")
    const diagnose = beginLcmDbDiagnose(rebuilding, "diagnose-1")

    expect(read.started).toBe(false)
    expect(read.pending).toEqual({ rebuildDb: "rebuild-1" })
    expect(update.started).toBe(false)
    expect(update.pending).toEqual({ rebuildDb: "rebuild-1" })
    expect(cancel.started).toBe(false)
    expect(cancel.pending).toEqual({ rebuildDb: "rebuild-1" })
    expect(diagnose.started).toBe(false)
    expect(diagnose.pending).toEqual({ rebuildDb: "rebuild-1" })

    const stale = finishLcmSettingsRequest(rebuilding, "rebuildDb", "rebuild-old")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ rebuildDb: "rebuild-1" })

    const current = finishLcmSettingsRequest(stale.pending, "rebuildDb", "rebuild-1")
    expect(current.accepted).toBe(true)
    expect(current.pending).toEqual({})
  })

  it("tracks prompt export as an exclusive DB-backed request", () => {
    const exporting = beginLcmPromptsExport({}, "export-1").pending
    const read = beginLcmSettingsRead(exporting, "read-1")
    const update = beginLcmSettingsUpdate(exporting, "write-1")
    const cancel = beginLcmMaintenanceCancel(exporting, "cancel-1")
    const diagnose = beginLcmDbDiagnose(exporting, "diagnose-1")
    const rebuild = beginLcmDbRebuild(exporting, "rebuild-1")

    expect(read.started).toBe(false)
    expect(read.pending).toEqual({ exportPrompts: "export-1" })
    expect(update.started).toBe(false)
    expect(update.pending).toEqual({ exportPrompts: "export-1" })
    expect(cancel.started).toBe(false)
    expect(cancel.pending).toEqual({ exportPrompts: "export-1" })
    expect(diagnose.started).toBe(false)
    expect(diagnose.pending).toEqual({ exportPrompts: "export-1" })
    expect(rebuild.started).toBe(false)
    expect(rebuild.pending).toEqual({ exportPrompts: "export-1" })

    const stale = finishLcmSettingsRequest(exporting, "exportPrompts", "export-old")
    expect(stale.accepted).toBe(false)
    expect(stale.pending).toEqual({ exportPrompts: "export-1" })

    const current = finishLcmSettingsRequest(stale.pending, "exportPrompts", "export-1")
    expect(current.accepted).toBe(true)
    expect(current.pending).toEqual({})
  })
})
