// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { slashEntryMatches, type SlashEntry } from "../../src/cli/cmd/tui/context/command-palette"
import { parseSlashCommandInput } from "../../src/cli/cmd/tui/component/prompt"
import { slashDisplay, slashMatches } from "../../src/kilocode/cli/cmd/command-display"

describe("tui local slash commands", () => {
  const memoryCommand: SlashEntry = {
    display: "/memory",
    aliases: ["/lcm", "/lcm-settings"],
    onSelect: () => {},
  }

  test("matches primary slash name and aliases", () => {
    expect(slashEntryMatches(memoryCommand, "memory")).toBe(true)
    expect(slashEntryMatches(memoryCommand, "/lcm")).toBe(true)
    expect(slashEntryMatches(memoryCommand, "LCM-SETTINGS")).toBe(true)
    expect(slashEntryMatches(memoryCommand, "models")).toBe(false)
  })

  test("finds a local slash command by alias", () => {
    const options: SlashEntry[] = [
      {
        display: "/models",
        onSelect: () => {},
      },
      memoryCommand,
    ]

    expect(options.find((option) => slashEntryMatches(option, "lcm"))?.display).toBe("/memory")
  })

  test("matches runtime slash command displays", () => {
    expect(slashDisplay({ name: "lint" })).toBe("/lint")
    expect(slashDisplay({ name: "docs", source: "skill" })).toBe("/docs:skill")
    expect(slashMatches({ name: "docs", source: "skill" }, "docs")).toBe(true)
    expect(slashMatches({ name: "docs", source: "skill" }, "docs:skill")).toBe(true)
    expect(slashMatches({ name: "docs", source: "skill" }, "docs:mcp")).toBe(false)
  })

  test("parses slash arguments without dropping multiline content", () => {
    expect(parseSlashCommandInput("/memory")).toEqual({ name: "memory", arguments: "" })
    expect(parseSlashCommandInput("/memory now")).toEqual({ name: "memory", arguments: "now" })
    expect(parseSlashCommandInput("/memory first line\nsecond line")).toEqual({
      name: "memory",
      arguments: "first line\nsecond line",
    })
    expect(parseSlashCommandInput("memory")).toBeUndefined()
    expect(parseSlashCommandInput("/")).toBeUndefined()
  })
})
