import { expect, test } from "bun:test"
import { completeClipboardWrite, copyCommand } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})

test("reports the native clipboard path when it succeeds", async () => {
  await expect(completeClipboardWrite({ osc52: true, native: async () => {}, platform: "linux" })).resolves.toEqual({
    method: "native",
    osc52: true,
  })
})

test("reports OSC 52 fallback instead of false native success", async () => {
  await expect(
    completeClipboardWrite({
      osc52: true,
      native: async () => {
        throw new Error("missing")
      },
      platform: "linux",
    }),
  ).resolves.toEqual({ method: "osc52", osc52: true })
})

test("surfaces actionable Linux clipboard failure when every path fails", async () => {
  await expect(
    completeClipboardWrite({
      osc52: false,
      native: async () => {
        throw new Error("missing")
      },
      platform: "linux",
    }),
  ).rejects.toThrow("Install wl-clipboard")
})
