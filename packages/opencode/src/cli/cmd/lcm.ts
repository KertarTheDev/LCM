// kilocode_change - new file; LCM settings CLI
import { EOL } from "node:os"
import type { Argv } from "yargs"
import { WorkspaceContext } from "../../control-plane/workspace-context"
import { Instance } from "../../kilocode/instance"
import { LcmRuntime } from "../../session/lcm/runtime"
import type {
  LcmActivityPage,
  LcmMetricsSnapshot,
  LcmSettingsState,
  LcmUpdateSettingsInput,
} from "../../session/lcm/types"
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
): Pick<LcmUpdateSettingsInput, "strategy" | "storageWarningThresholdBytes"> {
  return {
    ...(args.strategy ? { strategy: args.strategy as LcmUpdateSettingsInput["strategy"] } : {}),
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
    .option("session", { type: "string", describe: "session ID whose LCM settings scope should be used" })
    .option("project", { type: "string", describe: "project ID scope; defaults to the current project" })
    .option("workspace", { type: "string", describe: "workspace ID scope" })
    .option("json", { type: "boolean", default: false, describe: "print JSON output" })
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

export function formatLcmStatus(status: LcmMetricsSnapshot) {
  const percent = (value: number | undefined) => (value === undefined ? "n/a" : `${Math.round(value * 100)}%`)
  const costs = [
    status.memoryMaintenanceCostTotal,
    status.retrievalCostTotal,
    status.fileExplorationCostTotal,
    status.mapCostTotal,
  ]
  const hasCosts = costs.some((value) => value !== undefined)
  return (
    [
      `lifecycle: ${status.lifecycleState}`,
      `strategy: ${status.strategy}`,
      `hard: ${status.activeTokens} / ${status.hardLimit} (${percent(status.hardFillRatio)})`,
      `raw: ${status.rawLaneTokens} (${percent(status.rawLaneRatio)})`,
      `backlog: ${status.softBacklogTokens} tokens / ${status.softBacklogItemCount} items (${percent(status.softBacklogRatio)})`,
      `freshTailRaw: ${status.freshTailRawTokens} tokens / ${status.freshTailRawItemCount} items`,
      `unconsumedRaw: ${status.unconsumedRawTokens} tokens / ${status.unconsumedRawItemCount} items`,
      `outputReserve: ${status.outputReserve ?? "unavailable"}`,
      hasCosts
        ? `costs: maintenance ${status.memoryMaintenanceCostTotal ?? 0}, retrieval ${status.retrievalCostTotal ?? 0}, exploration ${status.fileExplorationCostTotal ?? 0}, maps ${status.mapCostTotal ?? 0}${status.currency ? ` ${status.currency}` : " (mixed or unknown currency)"}`
        : "costs: unavailable",
      `storage: ${status.storageBytes} / warning ${status.storageWarningThresholdBytes}${status.storageWarning ? " (warning)" : ""}`,
      `tokenCounter: ${status.tokenCounterMode} ${status.tokenCounterVersion}`,
    ].join(EOL) + EOL
  )
}

export function formatLcmActivity(activity: LcmActivityPage) {
  const lines = [
    `requests: ${activity.summary.requestCount}`,
    `tokens: ${activity.summary.totalTokens} (input ${activity.summary.inputTokens}, output ${activity.summary.outputTokens}, cache read ${activity.summary.cacheReadTokens}, cache write ${activity.summary.cacheWriteTokens})`,
  ]
  if (activity.summary.costAmount !== undefined) {
    lines.push(
      `cost: ${activity.summary.costAmount}${activity.summary.costCurrency ? ` ${activity.summary.costCurrency}` : ""}`,
    )
  } else {
    lines.push(`cost: ${activity.summary.costStatus}`)
  }
  for (const item of activity.items) {
    lines.push(
      [
        item.createdAt,
        item.purpose,
        item.mode,
        `${item.totalTokens} tokens`,
        item.providerID && item.modelID ? `${item.providerID}/${item.modelID}` : undefined,
        item.maintenanceStatus,
        item.costAmount !== undefined
          ? `${item.costAmount}${item.costCurrency ? ` ${item.costCurrency}` : ""}`
          : item.costStatus,
      ]
        .filter(Boolean)
        .join(" | "),
    )
  }
  return lines.join(EOL) + EOL
}

function sessionReadOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("session", { type: "string", demandOption: true, describe: "session ID" })
    .option("json", { type: "boolean", default: false, describe: "print JSON output" })
}

const LcmStatusCommand = cmd({
  command: "status",
  describe: "show LCM hard, raw, backlog, storage, and cost metrics",
  builder: (yargs) => sessionReadOptions(yargs),
  async handler(args) {
    await bootstrap(process.cwd(), async () =>
      withLcm(async () => {
        const status = await LcmRuntime.getStatus({ sessionID: args.session })
        process.stdout.write(args.json ? JSON.stringify(status, null, 2) + EOL : formatLcmStatus(status))
      }),
    )
  },
})

const LcmActivityCommand = cmd({
  command: "activity",
  describe: "show paid-token LCM maintenance and tool requests",
  builder: (yargs) =>
    sessionReadOptions(yargs).option("limit", {
      type: "number",
      default: 100,
      describe: "maximum activity records",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () =>
      withLcm(async () => {
        const activity = await LcmRuntime.getActivity({ sessionID: args.session, limit: args.limit })
        process.stdout.write(args.json ? JSON.stringify(activity, null, 2) + EOL : formatLcmActivity(activity))
      }),
    )
  },
})

const LcmSettingsShowCommand = cmd({
  command: "show",
  describe: "show LCM conversation-context settings",
  builder: (yargs) => scopedOptions(yargs),
  async handler(args) {
    await bootstrap(process.cwd(), async () =>
      withLcm(async () => writeState(await LcmRuntime.getSettingsState(currentScopeInput(args)), args.json === true)),
    )
  },
})

const LcmSettingsSetCommand = cmd({
  command: "set",
  describe: "update LCM conversation-context settings",
  builder: (yargs) =>
    scopedOptions(yargs)
      .option("strategy", { type: "string", choices: strategies, describe: "LCM strategy" })
      .option("storage-warning-threshold-bytes", {
        type: "number",
        describe: "local LCM storage warning threshold in bytes",
      })
      .check((args) => {
        if (args.strategy === undefined && args.storageWarningThresholdBytes === undefined) {
          throw new Error("set requires --strategy or --storage-warning-threshold-bytes")
        }
        const threshold = args.storageWarningThresholdBytes
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
  describe: "show and update LCM conversation-context settings",
  builder: (yargs) => yargs.command(LcmSettingsShowCommand).command(LcmSettingsSetCommand).demandCommand(),
  async handler() {},
})

export const LcmCommand = cmd({
  command: "lcm",
  describe: "manage LCM conversation context",
  builder: (yargs) =>
    yargs.command(LcmSettingsCommand).command(LcmStatusCommand).command(LcmActivityCommand).demandCommand(),
  async handler() {},
})
