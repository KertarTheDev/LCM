import type { TuiPlugin } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "@/plugin/tui/internal"
import { createEffect } from "solid-js"

const id = "internal:kilo-lcm-palette"

const tui: TuiPlugin = async (api) => {
  let unregister: (() => void) | undefined
  createEffect(() => {
    const enabled = api.state.config.experimental?.conversation_memory !== false
    if (!enabled) {
      unregister?.()
      unregister = undefined
      return
    }
    if (unregister) return
    unregister = api.keymap.registerLayer({
      commands: [
        {
          namespace: "palette",
          name: "conversation_memory.status",
          title: "Conversation Memory",
          desc: "Show context pressure, summary composition, activity, or export the active model input",
          slashName: "lcm",
          category: "Session",
          run() {
            void api.client.tui.appendPrompt({ text: "/lcm" })
          },
        },
      ],
      bindings: [],
    })
  })
  api.lifecycle.onDispose(() => unregister?.())
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
