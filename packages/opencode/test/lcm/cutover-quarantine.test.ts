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
  test("keeps project memory and LCM conversation context as complementary namespaces", async () => {
    const contextTab = await implementationFile(
      "packages/kilo-vscode/webview-ui/src/components/settings/ContextTab.tsx",
    )
    expect(contextTab).toContain("LcmContextSettings")
    expect(contextTab).not.toContain("settings.context.autoCompaction")
    expect(contextTab).not.toContain("settings.context.prune")
    expect(contextTab).not.toContain("config().compaction")

    const tuiApp = await implementationFile("packages/tui/src/app.tsx")
    expect(tuiApp).toContain('slashName: "lcm"')
    expect(tuiApp).toContain('slashAliases: ["lcm-settings"]')
    const tuiPrompt = await implementationFile("packages/tui/src/component/prompt/index.tsx")
    expect(tuiPrompt).toContain('trimmed === "/lcm"')
    expect(tuiPrompt).toContain("MemoryPrompt.run")
    expect(tuiPrompt).not.toContain('trimmed === "/memory"')

    const route = await packageFile("src/server/routes/instance/httpapi/handlers/session.ts")
    expect(route).not.toContain("SessionCompaction.Service")
    expect(route).toContain("runManualMaintenance")
    expect(route).toContain("syncFinalizedMessages")

    const vscodeProvider = await implementationFile("packages/kilo-vscode/src/KiloProvider.ts")
    expect(vscodeProvider).toContain("routeLcmSettingsWebviewRequest")
    expect(vscodeProvider).toContain("handleMemoryMessage")

    const sdkV2Types = await implementationFile("packages/sdk/js/src/v2/gen/types.gen.ts")
    expect(sdkV2Types).toContain('type: "session.compacted"')
    expect(sdkV2Types).toContain("EventSessionCompacted")
    expect(sdkV2Types).not.toContain('type: "lcm.compaction.')
    expect(sdkV2Types).not.toContain("EventLcmCompaction")
    expect(sdkV2Types).toContain('type: "lcm.maintenance.started"')

    const sdkV1Types = await implementationFile("packages/sdk/js/src/gen/types.gen.ts")
    const sdkOpenApi = await implementationFile("packages/sdk/openapi.json")
    expect(sdkV1Types).toContain('type: "session.compacted"')
    expect(sdkV1Types).toContain("EventSessionCompacted")
    expect(sdkOpenApi).toContain("EventSessionCompacted")

    const lcmContract = await packageFile("src/session/lcm/contracts/lcm-api-contract.generated.json")
    expect(lcmContract).not.toContain("lcm.compaction.")
    expect(lcmContract).not.toContain("LcmCompactionEventPayload")
    expect(lcmContract).toContain("lcm.maintenance.started")
    expect(lcmContract).toContain("LcmMaintenanceEventPayload")
  })

  test("retains upstream compaction only as the non-LCM prompt adapter", async () => {
    const prompt = await packageFile("src/session/prompt.ts")
    expect(prompt).toContain("SessionCompaction")
    expect(prompt).toContain('task?.type === "compaction" && !useLcmManagedHistory')
    expect(prompt).toContain("!useLcmManagedHistory &&")
    expect(prompt).toContain("if (!usedLcmManagedHistory)")
    expect(prompt).toContain('lcmCapabilities.lifecycleState === "passive_synced"')
    expect(prompt).toContain("useLcmManagedHistory")
    expect(prompt).toContain("MessageV2.filterCompactedEffect(sessionID)")
    expect(prompt).toContain('if (result === "compact")')
    expect(prompt).toContain("resolveLcmProviderOverflowResult")
    expect(prompt).toContain("pendingLcmProviderOverflowRecovery")
    expect(prompt).toContain("lcm_prompt_provider_overflow_after_lcm_retry_exhausted")
    expect(prompt).toContain("lcm_prompt_provider_overflow_without_active_lcm_rejected")

    const appRuntime = await packageFile("src/effect/app-runtime.ts")
    expect(appRuntime).toContain("SessionCompaction.defaultLayer")
    expect(appRuntime).toContain("LcmAppLayer")
    expect(appRuntime).toContain("SessionPrompt.layer")

    const lcmIndex = await packageFile("src/session/lcm/index.ts")
    expect(lcmIndex).not.toContain("compact-compat")
  })

  test("queues soft maintenance between finalized model steps", async () => {
    const prompt = await packageFile("src/session/prompt.ts")
    expect(prompt).toContain("queueSoftMaintenanceAfterTurn")
    expect(prompt).toContain("recordNoOpAttempt: false")
    const maintenance = prompt.indexOf("queueSoftMaintenanceAfterTurn")
    const continuation = prompt.indexOf('return "continue" as const', maintenance)
    expect(maintenance).toBeGreaterThan(0)
    expect(continuation).toBeGreaterThan(maintenance)
  })

  test("keeps LCM maintenance diagnostics out of legacy compaction naming", async () => {
    const runtime = await packageFile("src/session/lcm/runtime-maintenance.ts")
    expect(runtime).not.toContain("lcm_compact_")
    expect(runtime).toContain("lcm_maintenance_hard_limit_failed")
    expect(runtime).toContain("lcm_maintenance_leaf_summary_failed")
  })

  test("keeps VSCode extension host transport-only for LCM storage", async () => {
    const files = await readSourceTree("packages/kilo-vscode/src")
    const forbidden = /@electric-sql\/pglite|session\/lcm\/db|lcm\/db-worker|PGlite/
    const offenders = files.filter(({ text }) => forbidden.test(text)).map(({ file }) => file)
    expect(offenders).toEqual([])

    const transport = await implementationFile("packages/kilo-vscode/src/kilo-provider/lcm-settings.ts")
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
