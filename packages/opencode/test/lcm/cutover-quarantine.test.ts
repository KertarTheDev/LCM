// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const packageRoot = process.cwd()
const implementationRoot = path.resolve(packageRoot, "../..")
const workspaceRoot = implementationRoot

function implementationFile(relativePath: string) {
  return fs.readFile(path.join(implementationRoot, relativePath), "utf8")
}

async function optionalImplementationFile(relativePath: string) {
  const file = Bun.file(path.join(implementationRoot, relativePath))
  return (await file.exists()) ? file.text() : ""
}

function workspaceFile(relativePath: string) {
  return fs.readFile(path.join(workspaceRoot, relativePath), "utf8")
}

function packageFile(relativePath: string) {
  return fs.readFile(path.join(packageRoot, relativePath), "utf8")
}

async function readSourceTree(relativePath: string) {
  const root = path.join(implementationRoot, relativePath)
  const glob = new Bun.Glob("**/*.{ts,tsx,mts,cts}")
  const files = await Array.fromAsync(glob.scan({ cwd: root }))
  const entries = await Promise.all(
    files.map(async (file) => ({
      file,
      text: await fs.readFile(path.join(root, file), "utf8"),
    })),
  )
  return entries
}

describe("milestone 27 cutover quarantine", () => {
  test("hides routine manual compact from default client surfaces while preserving backend compatibility", async () => {
    const taskHeader = await implementationFile("packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx")
    expect(taskHeader).not.toContain("session.compact()")
    expect(taskHeader).not.toContain("command.session.compact")

    const promptInput = await implementationFile("packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx")
    expect(promptInput).not.toContain("compactSession")

    const slash = await implementationFile("packages/kilo-vscode/webview-ui/src/hooks/useSlashCommand.ts")
    expect(slash).not.toContain('name: "compact"')
    expect(slash).not.toContain("compactSession")

    const contextTab = await implementationFile(
      "packages/kilo-vscode/webview-ui/src/components/settings/ContextTab.tsx",
    )
    expect(contextTab).not.toContain("settings.context.autoCompaction")
    expect(contextTab).not.toContain("settings.context.prune")
    expect(contextTab).not.toContain("config().compaction")

    const webviewI18n = (await readSourceTree("packages/kilo-vscode/webview-ui/src/i18n"))
      .map(({ text }) => text)
      .join("\n")
    expect(webviewI18n).not.toContain("command.session.compact")
    expect(webviewI18n).not.toContain("settings.context.autoCompaction")
    expect(webviewI18n).not.toContain("settings.context.prune")
    expect(webviewI18n).not.toContain("toast.model.none")
    expect(webviewI18n).not.toContain("summarize this session")
    expect(webviewI18n).not.toContain("compact this session")

    const appCommands = await optionalImplementationFile("packages/app/src/pages/session/use-session-commands.tsx")
    expect(appCommands).not.toContain('id: "session.compact"')
    expect(appCommands).not.toContain('slash: "compact"')
    expect(appCommands).not.toContain("session.summarize")

    const tuiSession = await packageFile("src/cli/cmd/tui/routes/session/index.tsx")
    expect(tuiSession).not.toContain('value: "session.compact"')
    expect(tuiSession).not.toContain('name: "compact"')
    expect(tuiSession).not.toContain("Connect a provider to summarize this session")

    const tuiTips = await packageFile("src/cli/cmd/tui/feature-plugins/home/tips-view.tsx")
    const kiloTips = await packageFile("src/kilocode/components/tips.tsx")
    expect(tuiTips).not.toContain("/compact")
    expect(kiloTips).not.toContain("/compact")

    const skill = await packageFile("src/kilocode/skills/kilo-config.md")
    expect(skill).not.toContain("compaction.auto")
    expect(skill).not.toContain("compaction.prune")
    expect(skill).not.toContain("/compact")

    const acp = await packageFile("src/acp/agent.ts")
    expect(acp).not.toContain("compact the session")
    const acpService = await packageFile("src/acp/service.ts")
    expect(acpService).not.toContain("compact the session")
    expect(acpService).toContain('command.name === "compact"')
    expect(acpService).toContain("session.summarize")

    const route = await packageFile("src/server/routes/instance/httpapi/handlers/session.ts")
    expect(route).not.toContain("routeCompactCompatibility")
    expect(route).not.toContain("SessionCompaction.Service")
    expect(route).not.toContain("compact.create")
    expect(route).not.toContain("prompt.loop")
    expect(route).toContain("runManualMaintenance")
    expect(route).toContain("syncFinalizedMessages")

    const vscodeProvider = await implementationFile("packages/kilo-vscode/src/KiloProvider.ts")
    expect(vscodeProvider).toContain('case "compact"')
    expect(vscodeProvider).toContain("handleManualMemoryMaintenance")
    expect(vscodeProvider).not.toContain("handleCompact(")
    expect(vscodeProvider).not.toContain("compact this session")
    expect(vscodeProvider).not.toContain("Failed to compact session")

    const sdkV2Types = await implementationFile("packages/sdk/js/src/v2/gen/types.gen.ts")
    expect(sdkV2Types).not.toContain('type: "session.compacted"')
    expect(sdkV2Types).not.toContain("EventSessionCompacted")
    expect(sdkV2Types).not.toContain('type: "lcm.compaction.')
    expect(sdkV2Types).not.toContain("EventLcmCompaction")
    expect(sdkV2Types).toContain('type: "lcm.maintenance.started"')

    const sdkV1Types = await implementationFile("packages/sdk/js/src/gen/types.gen.ts")
    const sdkOpenApi = await implementationFile("packages/sdk/openapi.json")
    expect(sdkV1Types).not.toContain('type: "session.compacted"')
    expect(sdkV1Types).not.toContain("EventSessionCompacted")
    expect(sdkOpenApi).not.toContain("Event.session.compacted")

    const lcmContract = await packageFile("src/session/lcm/contracts/lcm-api-contract.generated.json")
    expect(lcmContract).not.toContain("lcm.compaction.")
    expect(lcmContract).not.toContain("LcmCompactionEventPayload")
    expect(lcmContract).toContain("lcm.maintenance.started")
    expect(lcmContract).toContain("LcmMaintenanceEventPayload")
  })

  test("prevents legacy prompt pruning and automatic compaction from managing LCM-active context", async () => {
    const prompt = await packageFile("src/session/prompt.ts")
    expect(prompt).not.toContain("compaction.prune")
    expect(prompt).not.toContain("SessionCompaction")
    expect(prompt).not.toContain("compaction.create")
    expect(prompt).not.toContain("!lcmCapabilities.lcmActive &&\n            lastFinished")
    expect(prompt).toContain('lcmCapabilities.lifecycleState === "passive_synced"')
    expect(prompt).toContain("useLcmManagedHistory")
    expect(prompt).toContain("MessageV2.filterCompactedEffect(sessionID)")
    expect(prompt).toContain('if (result === "compact")')
    expect(prompt).toContain("resolveLcmProviderOverflowResult")
    expect(prompt).toContain("pendingLcmProviderOverflowRecovery")
    expect(prompt).toContain("lcm_prompt_provider_overflow_after_lcm_retry_exhausted")
    expect(prompt).toContain("lcm_prompt_provider_overflow_without_active_lcm_rejected")

    const appRuntime = await packageFile("src/effect/app-runtime.ts")
    expect(appRuntime).not.toContain("SessionCompaction")

    const lcmIndex = await packageFile("src/session/lcm/index.ts")
    expect(lcmIndex).not.toContain("compact-compat")

    const legacyCompaction = await packageFile("src/session/compaction.ts")
    expect(legacyCompaction).not.toContain('"session.compacted"')
  })

  test("queues soft maintenance between finalized model steps", async () => {
    const prompt = await packageFile("src/session/prompt.ts")
    expect(prompt).toContain("const queueSoftMaintenanceCandidate")
    expect(prompt).toContain("recordNoOpAttempt: false")
    expect(prompt).not.toContain("preflight.threshold.overSoft && preflight.threshold.softBacklogItemCount > 0")

    const continueBlockStart = prompt.indexOf("if (KiloSessionPromptQueue.hasFollowup(sessionID))")
    const continueBlockEnd = prompt.indexOf('return "continue" as const', continueBlockStart)
    expect(continueBlockStart).toBeGreaterThan(0)
    expect(continueBlockEnd).toBeGreaterThan(continueBlockStart)

    const continueBlock = prompt.slice(continueBlockStart, continueBlockEnd)
    expect(continueBlock).toContain("yield* queueSoftMaintenanceCandidate(softMaintenanceCandidate)")
    expect(continueBlock).not.toContain("pendingSoftMaintenance = softMaintenanceCandidate")
  })

  test("keeps LCM maintenance diagnostics out of legacy compaction naming", async () => {
    const runtime = await packageFile("src/session/lcm/runtime.ts")
    expect(runtime).not.toContain("lcm_compact_")
    expect(runtime).toContain("lcm_maintenance_hard_limit_failed")
    expect(runtime).toContain("lcm_maintenance_leaf_summary_failed")
  })

  test("keeps VSCode extension host transport-only for LCM storage", async () => {
    const files = await readSourceTree("packages/kilo-vscode/src")
    const forbidden = /@electric-sql\/pglite|session\/lcm\/db|lcm\/db-worker|PGlite/
    const offenders = files.filter(({ text }) => forbidden.test(text)).map(({ file }) => file)
    expect(offenders).toEqual([])

    const transport = await implementationFile("packages/kilo-vscode/src/kilo-provider/lcm-webview.ts")
    expect(transport).toContain("requestLcmSettings")
    expect(transport).not.toContain("startLcmLegacyConversion")
    expect(transport).not.toContain("requestLcmLegacyConversionReport")
  })

  test("records milestone 27 ownership for the release scenario skeleton", async () => {
    const readme = await workspaceFile("specifications/fixtures/release-scenario/README.md")
    expect(readme).toContain("Owner: milestone 27")
    expect(readme).toContain("Milestone 28")

    const skeleton = await workspaceFile(
      "specifications/fixtures/release-scenario/release-scenario-script-v1.skeleton.json",
    )
    expect(JSON.parse(skeleton)).toMatchObject({
      scenarioID: "release-scenario-script-v1",
      result: "not_run",
    })
  })
})
