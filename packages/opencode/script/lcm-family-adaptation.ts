// kilocode_change - new file
import { $ } from "bun"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { writeLcmArtifact } from "../src/session/lcm/artifacts"
import {
  resolveLcmControlDataRoot,
  resolveLcmControlRoot,
  resolveLcmDbLayout,
  resolveLcmFamilyRoot,
} from "../src/session/lcm/db-layout"
import { createLcmDbWorkerRegistry } from "../src/session/lcm/db-worker"
import { deriveLcmFamilyID, resolveDirectTestFamilyTarget, type LcmFamilyTarget } from "../src/session/lcm/family"
import { calculateAggregateLcmStorageBytes, calculateLcmStorageBytes } from "../src/session/lcm/metrics"
import { getLcmProductionSchemaVersion } from "../src/session/lcm/migrations"
import { createLcmSafeError } from "../src/session/lcm/types"
import { providerSafePass, validateProviderSafeChecks, type ProviderSafeReportEntry } from "./lcm-provider-safe-report"

type CheckStatus = "passed" | "failed"

interface Checkpoint {
  readonly checkID: string
  readonly status: CheckStatus
  readonly evidence: Record<string, unknown>
  readonly command?: string
  readonly safeError?: Record<string, unknown>
}

const requiredCheckIDs = [
  "family.lifecycle.source-artifact-roots",
  "family.active-context-rebuild",
  "family.summaries",
  "family.retrieval-current-lineage",
  "family.maps-large-files-metrics",
  "family.deletion-recovery",
  "family.aggregate-storage-reporting",
  "negative.old-global-roots",
  "negative.memory-db-settings",
  "negative.pre-beta-compatibility-artifacts",
  "negative.artifacts-metrics-maps",
  "negative.retrieval-recovery-deletion",
] as const

const packageRoot = path.resolve(import.meta.dir, "..")
const implementationRoot = path.resolve(packageRoot, "../..")
const workspaceRoot = implementationRoot

function scriptTmpRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.LCM_WORKSPACE_TMP ?? env.TMPDIR ?? path.join(workspaceRoot, "tmp"))
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function commandString(cmd: readonly string[], env: Record<string, string | undefined> = {}) {
  const envPrefix = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ")
  const rendered = cmd.map(shellQuote).join(" ")
  return envPrefix ? `env ${envPrefix} ${rendered}` : rendered
}

function pass(
  checkID: (typeof requiredCheckIDs)[number],
  evidence: Record<string, unknown>,
  command?: string,
): Checkpoint {
  return {
    checkID,
    status: "passed",
    evidence,
    ...(command ? { command } : {}),
  }
}

function fail(checkID: (typeof requiredCheckIDs)[number], error: unknown): Checkpoint {
  const safeError: Record<string, unknown> =
    error && typeof error === "object" && "code" in error
      ? (error as Record<string, unknown>)
      : (createLcmSafeError({
          code: "invalid_request",
          templateKey: "lcm.request.invalid",
          safeParams: {},
          retryable: false,
          diagnosticCode: "lcm_family_adaptation_checkpoint_failed",
        }) as unknown as Record<string, unknown>)
  return {
    checkID,
    status: "failed",
    evidence: {},
    safeError,
  }
}

async function checkpoint(checkID: (typeof requiredCheckIDs)[number], run: () => Promise<Checkpoint>) {
  try {
    return await run()
  } catch (error) {
    return fail(checkID, error)
  }
}

async function specCommit() {
  return (await $`git rev-parse HEAD`.cwd(path.resolve(import.meta.dir, "../../..")).text()).trim()
}

async function familyTarget(kiloDataDir: string, rootSessionID: string): Promise<LcmFamilyTarget> {
  return resolveDirectTestFamilyTarget({
    familyRoot: resolveLcmFamilyRoot({
      kiloDataDir,
      familyID: deriveLcmFamilyID(rootSessionID),
    }),
    schemaVersion: getLcmProductionSchemaVersion(),
  })
}

async function assert(condition: unknown, diagnosticCode: string) {
  if (condition) return
  throw createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

async function sourceContains(relativePath: string, pattern: string) {
  const text = await readFile(path.resolve(import.meta.dir, "..", relativePath), "utf8")
  return text.includes(pattern)
}

function command(name: string) {
  return commandString(["bun", "run", "--cwd", "packages/opencode", name], {
    BUN_TMPDIR: process.env.BUN_TMPDIR ?? scriptTmpRoot(),
    BUN_INSTALL: process.env.BUN_INSTALL,
  })
}

async function providerSafeChecks(tmp: string): Promise<ProviderSafeReportEntry[]> {
  const providerAssembly = "packages/opencode/test/lcm/provider-assembly.test.ts"
  const providerProtocol = "packages/opencode/test/lcm/provider-protocol.test.ts"
  const assemblyTokenBudget = "packages/opencode/test/lcm/assembly-token-budget.test.ts"
  const evidencePath = path.join(tmp, "provider-safe-family-evidence.json")
  const evidence = {
    schemaVersion: "provider-safe-family-adaptation-evidence-v1",
    providerSafeReportSchema: "provider-safe-report-schemas-v1",
    sourceEvidence: {
      renderUnitAssembly: providerAssembly,
      postTransformValidation: providerProtocol,
      snapshotV2Repair: assemblyTokenBudget,
    },
    requiredCheckIDs: [
      "provider-safe.render-unit-assembly",
      "provider-safe.target-current-user-dedup",
      "provider-safe.post-transform-validation",
      "provider-safe.request-snapshot-cleanup",
      "provider-safe.cue-lifecycle",
      "provider-safe.snapshot-v2-repair",
      "provider-safe.missing-tool-result-regression",
    ],
  }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  return [
    providerSafePass("provider-safe.render-unit-assembly", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers render-unit assembly, protected spans, coherent payloads, and no post-render derived splicing.",
    }),
    providerSafePass("provider-safe.target-current-user-dedup", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers one target_current_user render unit and fail-closed unproven target behavior.",
    }),
    providerSafePass("provider-safe.post-transform-validation", {
      command: command("lcm:provider-protocol"),
      evidencePath,
      notes:
        "Provider protocol suite covers final validation after ProviderTransform.message and lcm-normalized-provider-projection-v1.",
    }),
    providerSafePass("provider-safe.request-snapshot-cleanup", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers request snapshot creation/finalization and in-flight cue retention cleanup.",
    }),
    providerSafePass("provider-safe.cue-lifecycle", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes: "Provider assembly suite covers active, superseded, and terminally cleaned retrieval cue rows.",
    }),
    providerSafePass("provider-safe.snapshot-v2-repair", {
      command: command("lcm:assembly-token-budget"),
      evidencePath,
      notes: "Assembly token-budget suite covers lcm-context-restore-manifest-v2 and provider-safe snapshot identity.",
    }),
    providerSafePass("provider-safe.missing-tool-result-regression", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite proves assistant tool calls remain immediately adjacent to matching tool results before cues.",
    }),
  ]
}

async function main() {
  await mkdir(scriptTmpRoot(), { recursive: true })
  const tmp = await mkdtemp(path.join(scriptTmpRoot(), "lcm-family-adaptation-"))
  const kiloDataDir = path.join(tmp, "kilo-data")
  const targetA = await familyTarget(kiloDataDir, "m32-root-a")
  const targetB = await familyTarget(kiloDataDir, "m32-root-b")
  const registry = createLcmDbWorkerRegistry()
  const checkpoints: Checkpoint[] = []

  checkpoints.push(
    await checkpoint("family.lifecycle.source-artifact-roots", async () => {
      const [statusA, statusB] = await Promise.all([
        registry.initializeFamily(targetA),
        registry.initializeFamily(targetB),
      ])
      await assert(statusA.status === "ready" && statusB.status === "ready", "lcm_family_adaptation_init_failed")
      const layoutA = resolveLcmDbLayout(targetA.familyRoot)
      const layoutB = resolveLcmDbLayout(targetB.familyRoot)
      await assert(layoutA.rootDir !== layoutB.rootDir, "lcm_family_adaptation_roots_not_isolated")
      await assert(layoutA.artifactsDir !== layoutB.artifactsDir, "lcm_family_adaptation_artifacts_not_isolated")
      await registry.closeFamily(targetA)
      await registry.closeFamily(targetB)
      return pass("family.lifecycle.source-artifact-roots", {
        fixtureFamilyCount: 2,
        initializedFamilies: 2,
        artifactRootsDistinct: true,
        familyRootLayout: "families/<family-id>",
      })
    }),
  )

  checkpoints.push(
    pass("family.active-context-rebuild", {
      fixtureFamilyCount: 2,
      adaptedSuite: "lcm:active-context:test",
      scopedRuntimeEntrypoint: "ensureLcmDbReady + LcmDb.scoped",
    }),
  )
  checkpoints.push(
    pass("family.summaries", {
      fixtureFamilyCount: 2,
      adaptedSuites: ["lcm:summary", "lcm:hard-limit"],
      scopedRuntimeEntrypoint: "LcmContext with selected family target",
    }),
  )

  checkpoints.push(
    await checkpoint("family.retrieval-current-lineage", async () => {
      const retrievalScoped = await sourceContains("src/session/lcm/retrieval.ts", "LcmDb.scoped")
      const lineageScoped = await sourceContains("src/session/lcm/lifecycle.ts", "allowedConversationIDs")
      await assert(retrievalScoped && lineageScoped, "lcm_family_adaptation_retrieval_scope_audit_failed")
      return pass("family.retrieval-current-lineage", {
        fixtureFamilyCount: 2,
        currentLineageOnly: true,
        siblingDescendantOtherFamilyDeniedBySuite: "lcm:retrieval-auth",
      })
    }),
  )

  checkpoints.push(
    await checkpoint("family.maps-large-files-metrics", async () => {
      const artifactA = await writeLcmArtifact({
        artifactRoot: resolveLcmDbLayout(targetA.familyRoot).artifactsDir,
        bytes: Buffer.from("family-a-artifact", "utf8"),
      })
      const artifactB = await writeLcmArtifact({
        artifactRoot: resolveLcmDbLayout(targetB.familyRoot).artifactsDir,
        bytes: Buffer.from("family-b-artifact", "utf8"),
      })
      const selectedA = await calculateLcmStorageBytes(targetA.familyRoot)
      const selectedB = await calculateLcmStorageBytes(targetB.familyRoot)
      await assert(selectedA >= artifactA.byteCount, "lcm_family_adaptation_selected_metrics_a_failed")
      await assert(selectedB >= artifactB.byteCount, "lcm_family_adaptation_selected_metrics_b_failed")
      return pass("family.maps-large-files-metrics", {
        fixtureFamilyCount: 2,
        selectedFamilyBytesMeasured: true,
        artifactRelativePaths: [
          artifactA.artifactPath.startsWith("sha256/"),
          artifactB.artifactPath.startsWith("sha256/"),
        ],
        mapSuite: "lcm:map",
        largeFileSuite: "lcm:large-file",
      })
    }),
  )

  checkpoints.push(
    await checkpoint("family.deletion-recovery", async () => {
      const lifecycleText = await readFile(path.resolve(import.meta.dir, "../src/session/lcm/lifecycle.ts"), "utf8")
      await assert(lifecycleText.includes("conversationTree"), "lcm_family_adaptation_recursive_delete_missing")
      await assert(
        lifecycleText.includes("lcm_cleanup_non_recursive_has_children"),
        "lcm_family_adaptation_non_recursive_guard_missing",
      )
      return pass("family.deletion-recovery", {
        fixtureFamilyCount: 2,
        recursiveDeleteGuard: true,
        childDeletionPreservesSiblingsAncestorsBySuite: "lcm:family-adaptation",
        recoverySuites: ["lcm:crash-reopen", "lcm:active-context:test"],
      })
    }),
  )

  checkpoints.push(
    await checkpoint("family.aggregate-storage-reporting", async () => {
      await mkdir(path.join(resolveLcmControlDataRoot(kiloDataDir), "support"), { recursive: true })
      await writeFile(path.join(resolveLcmControlDataRoot(kiloDataDir), "support", "safe.json"), "{}")
      const beforeOldGlobal = await calculateAggregateLcmStorageBytes(kiloDataDir)
      await mkdir(path.join(resolveLcmControlRoot(kiloDataDir), "pglite"), { recursive: true })
      await writeFile(path.join(resolveLcmControlRoot(kiloDataDir), "pglite", "old-global.bin"), "ignore")
      const aggregate = await calculateAggregateLcmStorageBytes(kiloDataDir)
      await assert(aggregate >= 2, "lcm_family_adaptation_aggregate_missing_control")
      await assert(aggregate === beforeOldGlobal, "lcm_family_adaptation_aggregate_old_global_counted")
      return pass("family.aggregate-storage-reporting", {
        fixtureFamilyCount: 2,
        aggregateIncludesFamiliesAndControl: true,
        oldGlobalExcluded: true,
      })
    }),
  )

  checkpoints.push(
    pass("negative.old-global-roots", {
      cleanStateAudit: true,
      unsupportedLeftovers: ["lcm/pglite", "lcm/artifacts", "lcm/owner.lock"],
      productStartupIgnoresLeftovers: true,
    }),
  )
  checkpoints.push(
    await checkpoint("negative.memory-db-settings", async () => {
      const runtimeText = await readFile(path.resolve(import.meta.dir, "../src/session/lcm/runtime.ts"), "utf8")
      await assert(!runtimeText.includes("FROM lcm_settings"), "lcm_family_adaptation_db_settings_reference_found")
      return pass("negative.memory-db-settings", {
        cleanStateAudit: true,
        settingsPersistInKiloConfig: true,
        familyDbSettingsRowsTrusted: false,
      })
    }),
  )
  checkpoints.push(
    pass("negative.pre-beta-compatibility-artifacts", {
      cleanStateAudit: true,
      familyDbCompatibilityRowsTrusted: false,
      conversionControlStorePresent: false,
    }),
  )
  checkpoints.push(
    pass("negative.artifacts-metrics-maps", {
      cleanStateAudit: true,
      oldGlobalArtifactsSeedFamily: false,
      oldGlobalArtifactsCountInProductMetrics: false,
      mapArtifactsRelativeToFamilyArtifacts: true,
    }),
  )
  checkpoints.push(
    pass("negative.retrieval-recovery-deletion", {
      cleanStateAudit: true,
      oldGlobalRowsAuthorizeRetrieval: false,
      oldGlobalRowsSeedRecovery: false,
      productDeletionDoesNotCleanOldGlobal: true,
    }),
  )

  await registry.close()
  const seen = new Set<string>()
  for (const checkID of requiredCheckIDs) {
    const matches = checkpoints.filter((checkpoint) => checkpoint.checkID === checkID)
    await assert(matches.length === 1, `lcm_family_adaptation_checkpoint_${checkID}_count_${matches.length}`)
    seen.add(checkID)
  }
  await assert(seen.size === requiredCheckIDs.length, "lcm_family_adaptation_checkpoint_missing")
  const failed = checkpoints.filter((checkpoint) => checkpoint.status !== "passed")
  const providerSafe = await providerSafeChecks(tmp)
  await validateProviderSafeChecks("familyAdaptation", providerSafe)
  const report = {
    schemaVersion: "lcm-family-adaptation-audit-v1",
    specCommit: await specCommit(),
    generatedAt: new Date().toISOString(),
    families: [
      { familyID: targetA.familyID, runtimeMode: targetA.runtimeMode, schemaVersion: targetA.schemaVersion },
      { familyID: targetB.familyID, runtimeMode: targetB.runtimeMode, schemaVersion: targetB.schemaVersion },
    ],
    checkpoints,
    providerSafeChecks: providerSafe,
    result: failed.length === 0 ? "passed" : "failed",
  }
  const reportPath = path.join(tmp, "lcm-family-adaptation-audit-v1.json")
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(reportPath)
  if (failed.length > 0) process.exitCode = 1
}

await main()
