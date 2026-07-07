// kilocode_change - new file
import { EOL } from "node:os"
import type { Argv } from "yargs"
import { WorkspaceContext } from "../../control-plane/workspace-context"
import { Instance } from "../../kilocode/instance"
import { LcmRuntime } from "../../session/lcm/runtime"
import type { LcmSettingsState, LcmUpdateSettingsInput } from "../../session/lcm/types"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

const strategies = ["upward", "dolt"] as const

type ScopeArgs = {
  session?: string
  project?: string
  workspace?: string
}

type UpdateArgs = ScopeArgs & {
  strategy?: string
  freshTailTokens?: number
  storageWarningThresholdBytes?: number
}

export function resolveLcmSettingsScope(
  args: ScopeArgs,
  current: { projectID: string; workspaceID?: string },
): Pick<LcmUpdateSettingsInput, "sessionID" | "projectID" | "workspaceID"> {
  if (args.session) {
    return {
      sessionID: args.session,
      ...(args.project ? { projectID: args.project } : {}),
      ...(args.workspace ? { workspaceID: args.workspace } : {}),
    }
  }

  return {
    projectID: args.project ?? current.projectID,
    ...(args.workspace !== undefined
      ? { workspaceID: args.workspace }
      : current.workspaceID
        ? { workspaceID: current.workspaceID }
        : {}),
  }
}

export function lcmSettingsUpdateFromArgs(
  args: UpdateArgs,
): Pick<LcmUpdateSettingsInput, "strategy" | "freshTailTokens" | "storageWarningThresholdBytes"> {
  return {
    ...(args.strategy ? { strategy: args.strategy as LcmUpdateSettingsInput["strategy"] } : {}),
    ...(args.freshTailTokens !== undefined ? { freshTailTokens: args.freshTailTokens } : {}),
    ...(args.storageWarningThresholdBytes !== undefined
      ? { storageWarningThresholdBytes: args.storageWarningThresholdBytes }
      : {}),
  }
}

export function formatLcmSettingsState(state: LcmSettingsState) {
  const scope = [
    state.effectiveScope.kind,
    state.effectiveScope.projectID ? `project=${state.effectiveScope.projectID}` : undefined,
    state.effectiveScope.workspaceID ? `workspace=${state.effectiveScope.workspaceID}` : undefined,
  ]
    .filter(Boolean)
    .join(" ")

  const lines = [
    `strategy: ${state.strategy}`,
    `freshTailTokens: ${state.freshTailTokens}`,
    `storageWarningThresholdBytes: ${state.storageWarningThresholdBytes}`,
    `storageBytes: ${state.storageBytes}`,
    `storageWarning: ${state.storageWarning ? "yes" : "no"}`,
    `scope: ${scope || "default"}`,
  ]
  if (state.lifecycleState) lines.push(`lifecycleState: ${state.lifecycleState}`)
  if (state.dbStatus) lines.push(`dbStatus: ${state.dbStatus.status}`)
  if (state.safeError) lines.push(`safeError: ${state.safeError.safeMessage}`)
  return lines.join(EOL) + EOL
}

function scopedOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("session", {
      type: "string",
      describe: "session ID whose LCM settings scope should be used",
    })
    .option("project", {
      type: "string",
      describe: "project ID scope; defaults to the current project",
    })
    .option("workspace", {
      type: "string",
      describe: "workspace ID scope",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "print JSON output",
    })
}

function currentScopeInput(args: ScopeArgs) {
  return resolveLcmSettingsScope(args, {
    projectID: Instance.project.id,
    ...(WorkspaceContext.workspaceID ? { workspaceID: WorkspaceContext.workspaceID } : {}),
  })
}

async function withLcm<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } finally {
    await LcmRuntime.close().catch(() => undefined)
  }
}

function writeState(state: LcmSettingsState, json: boolean) {
  process.stdout.write(json ? JSON.stringify(state, null, 2) + EOL : formatLcmSettingsState(state))
}

const LcmSettingsShowCommand = cmd({
  command: "show",
  describe: "show LCM memory settings",
  builder: (yargs) => scopedOptions(yargs),
  async handler(args) {
    await bootstrap(process.cwd(), async () =>
      withLcm(async () => {
        const state = await LcmRuntime.getSettingsState(currentScopeInput(args))
        writeState(state, args.json === true)
      }),
    )
  },
})

const LcmSettingsSetCommand = cmd({
  command: "set",
  describe: "update LCM memory settings",
  builder: (yargs) =>
    scopedOptions(yargs)
      .option("strategy", {
        type: "string",
        choices: strategies,
        describe: "LCM strategy",
      })
      .option("storage-warning-threshold-bytes", {
        type: "number",
        describe: "local LCM storage warning threshold in bytes",
      })
      .option("fresh-tail-tokens", {
        type: "number",
        describe: "raw-message tokens kept fresh before soft backlog summarization",
      })
      .check((args) => {
        if (Array.isArray(args._) && args._.length === 0) return true
        if (
          args.strategy === undefined &&
          args.freshTailTokens === undefined &&
          args.storageWarningThresholdBytes === undefined
        ) {
          throw new Error("set requires --strategy, --fresh-tail-tokens, or --storage-warning-threshold-bytes")
        }
        const freshTailTokens = typeof args.freshTailTokens === "number" ? args.freshTailTokens : undefined
        if (
          freshTailTokens !== undefined &&
          (!Number.isInteger(freshTailTokens) || freshTailTokens <= 0 || !Number.isFinite(freshTailTokens))
        ) {
          throw new Error("--fresh-tail-tokens must be a positive integer")
        }
        const threshold =
          typeof args.storageWarningThresholdBytes === "number" ? args.storageWarningThresholdBytes : undefined
        if (
          threshold !== undefined &&
          (!Number.isInteger(threshold) || threshold <= 0 || !Number.isFinite(threshold))
        ) {
          throw new Error("--storage-warning-threshold-bytes must be a positive integer")
        }
        return true
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () =>
      withLcm(async () => {
        const state = await LcmRuntime.updateSettings({
          ...currentScopeInput(args),
          ...lcmSettingsUpdateFromArgs(args),
        })
        writeState(state, args.json === true)
      }),
    )
  },
})

export const LcmSettingsCommand = cmd({
  command: "settings",
  describe: "show and update LCM memory settings",
  builder: (yargs) => yargs.command(LcmSettingsShowCommand).command(LcmSettingsSetCommand).demandCommand(),
  async handler() {},
})

export const LcmCommand = cmd({
  command: "lcm",
  describe: "manage LCM memory",
  builder: (yargs) => yargs.command(LcmSettingsCommand).demandCommand(),
  async handler() {},
})
