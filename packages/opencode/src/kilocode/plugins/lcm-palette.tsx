import type { TuiPlugin } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "@/plugin/tui/internal"

const id = "internal:kilo-lcm-palette"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
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
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
