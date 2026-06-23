// kilocode_change - new file
import type { Accessor } from "solid-js"
import { useCommandSlashes as useKeymapCommandSlashes, useOpencodeKeymap } from "../keymap"

export type SlashEntry = {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}

type CommandPaletteContext = {
  run(command: string): void
  slashes: Accessor<readonly SlashEntry[]>
}

export function slashEntryMatches(entry: Pick<SlashEntry, "display" | "aliases">, name: string) {
  const normalized = name.startsWith("/") ? name : `/${name}`
  const lower = normalized.toLowerCase()
  return entry.display.toLowerCase() === lower || entry.aliases?.some((alias) => alias.toLowerCase() === lower) === true
}

export function useCommandPalette() {
  const keymap = useOpencodeKeymap()
  return {
    run(command: string) {
      keymap.dispatchCommand(command)
    },
    slashes: useKeymapCommandSlashes(),
  }
}

export function useCommandSlashes(): Accessor<readonly SlashEntry[]> {
  return useKeymapCommandSlashes()
}
