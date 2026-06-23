// kilocode_change - new file

import { Global } from "@opencode-ai/core/global"
import { staticEnvLines, type EditorContext, type RenderTimeInput } from "@/kilocode/editor-context"
import type { Provider } from "@/provider/provider"
import type { InstanceContext } from "@/project/instance-context"

export namespace KilocodeSystemPrompt {
  export function environment(input: {
    ctx: InstanceContext
    model: Provider.Model
    editor?: EditorContext
    time?: RenderTimeInput
  }) {
    const now =
      input.time?.now instanceof Date
        ? input.time.now
        : typeof input.time?.now === "number"
          ? new Date(input.time.now)
          : new Date()
    return [
      [
        `You are powered by the model named ${input.model.api.id}. The exact model ID is ${input.model.providerID}/${input.model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${input.ctx.directory}`,
        `  Workspace root folder: ${input.ctx.worktree}`,
        `  Is directory a git repo: ${input.ctx.project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${now.toDateString()}`,
        `  Project config: .kilo/command/*.md, .kilo/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in .kilo/. Do not use .kilocode/ or .opencode/.`,
        `  Global config: ${Global.Path.config}/ (same structure)`,
        ...staticEnvLines(input.editor),
        `</env>`,
      ].join("\n"),
    ]
  }
}
