import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { settingsPanelOpenTab, settingsPanelSessionContext } from "../../src/SettingsEditorProvider"

const root = path.resolve(import.meta.dir, "../..")
const settingsEditorProvider = fs.readFileSync(path.join(root, "src/SettingsEditorProvider.ts"), "utf-8")
const extension = fs.readFileSync(path.join(root, "src/extension.ts"), "utf-8")

describe("Settings editor provider open context", () => {
  it("keeps legacy tab-only opens working", () => {
    expect(settingsPanelOpenTab("lcmMemory")).toBe("lcmMemory")
    expect(settingsPanelSessionContext("lcmMemory")).toBeUndefined()
  })

  it("extracts a local inherited session context from structured opens", () => {
    expect(
      settingsPanelSessionContext({
        tab: "lcmMemory",
        sessionID: " sess-1 ",
        directory: "/repo/.kilo/worktrees/feature",
      }),
    ).toEqual({
      sessionID: "sess-1",
      directory: "/repo/.kilo/worktrees/feature",
    })
  })

  it("does not export cloud preview sessions as local memory targets", () => {
    expect(settingsPanelSessionContext({ sessionID: "cloud:remote-1", directory: "/repo" })).toBeUndefined()
  })

  it("passes inherited session context into new and existing settings panels", () => {
    expect(settingsEditorProvider).toContain("initialSessionContext: sessionContext")
    expect(settingsEditorProvider).toContain("setInheritedSessionContext(inheritedSessionContext)")
    expect(settingsEditorProvider).toContain('this.providers.get("settings")?.setInheritedSessionContext(next)')
  })

  it("opens sidebar settings with the sidebar session instead of an active tab guess", () => {
    expect(extension).toContain(
      'track("settings", "kilo-code.new.settingsButtonClicked", provider.getCurrentSessionContext())',
    )
    expect(extension).toContain("onSessionContextChanged: syncSettingsSessionContext")
  })
})
