import type { KiloClient } from "@kilocode/sdk/v2"
import type { DialogContext } from "@tui/ui/dialog"
import type { ToastContext } from "@tui/ui/toast"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { errorMessage } from "@/util/error"
import { LCM_USAGE, parseLcmInput, runLcmCommand } from "@/kilocode/cli/cmd/tui/lcm-command"

export namespace LcmPrompt {
  export async function run(input: {
    text: string
    client: KiloClient
    workspace?: string
    directory?: string
    sessionID?: string
    toast: ToastContext
    dialog: DialogContext
    done(): void
  }) {
    const command = parseLcmInput(input.text)
    if (!command) return false
    if (command === "invalid") {
      input.toast.show({ variant: "error", message: LCM_USAGE })
      return true
    }
    if (!input.sessionID) {
      input.toast.show({ variant: "error", message: "Open a session before using Conversation Memory." })
      return true
    }
    try {
      const output = await runLcmCommand({
        command,
        client: input.client,
        sessionID: input.sessionID,
        workspace: input.workspace,
        directory: input.directory,
      })
      if (output.type === "message") {
        input.dialog.setSize("large")
        input.dialog.replace(() => <DialogAlert title={output.title} message={output.message} />)
      } else {
        input.toast.show({ variant: "success", message: `Context export saved to ${output.path}` })
      }
      input.done()
      return true
    } catch (error) {
      input.toast.show({ variant: "error", message: `Conversation Memory failed: ${errorMessage(error)}` })
      return true
    }
  }
}
