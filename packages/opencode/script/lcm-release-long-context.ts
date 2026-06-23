#!/usr/bin/env bun
// kilocode_change - new file
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { diagnoseLcmDb, rebuildLcmDb, runLcmDbSmoke } from "../src/session/lcm/db-smoke"
import { createLcmDbWorker } from "../src/session/lcm/db-worker"
import { resolveLcmDbLayout, resolveLcmFamilyRoot } from "../src/session/lcm/db-layout"
import { deriveLcmFamilyID } from "../src/session/lcm/family"
import { getLcmProductionSchemaVersion } from "../src/session/lcm/migrations"
import { LCM_PGLITE_GATE_RELEASE_SCALE, LCM_PGLITE_GATE_TEST_SCALE } from "../src/session/lcm/pglite-gate"
import type { LcmDbSmokeRuntimeMode, LcmSafeError } from "../src/session/lcm/types"
import { validatePlatformPackagedRuntimeEvidence } from "./lcm-platform-evidence"
import {
  providerSafeReleasePass,
  validateProviderSafeReleaseSteps,
  type ProviderSafeReleaseStepEntry,
} from "./lcm-provider-safe-report"

type StepStatus = "passed" | "failed" | "blocked" | "not_run"

interface ReleaseStep {
  readonly stepID: string
  readonly command?: string
  readonly manualAction?: string
  readonly expected: string
  readonly actual: string
  readonly status: StepStatus
  readonly safeError?: LcmSafeError
}

interface SafeStatusCapture {
  readonly captureID: string
  readonly source: string
  readonly payload: unknown
}

const packageRoot = path.resolve(import.meta.dir, "..")
const implementationRoot = path.resolve(packageRoot, "../..")
const workspaceRoot = implementationRoot
const COMMAND_TIMEOUT_EXIT_CODE = 124
const RUNTIME_SMOKE_TIMEOUT_MS = 2 * 60_000
const VSCODE_INSTALL_TIMEOUT_MS = 2 * 60_000
const VSCODE_LIST_TIMEOUT_MS = 30_000
const LOCAL_SCRIPT_TIMEOUT_MS = 10 * 60_000
const TIMED_OUT_EXIT_DRAIN_MS = 6_000

type WorkspacePackageName = "opencode" | "kilo-vscode"
type LocalScenarioScript =
  | string
  | {
      readonly packageName: WorkspacePackageName
      readonly scriptName: string
    }

function releaseTmpRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.LCM_WORKSPACE_TMP ?? env.TMPDIR ?? path.join(workspaceRoot, "tmp"))
}

function releaseEnv(extra: NodeJS.ProcessEnv = {}) {
  const tmpRoot = releaseTmpRoot()
  return {
    ...process.env,
    TMPDIR: process.env.TMPDIR ?? tmpRoot,
    TMP: process.env.TMP ?? tmpRoot,
    TEMP: process.env.TEMP ?? tmpRoot,
    BUN_TMPDIR: process.env.BUN_TMPDIR ?? tmpRoot,
    BUN_INSTALL: process.env.BUN_INSTALL,
    ...extra,
  }
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

function packageCommand(packageName: WorkspacePackageName, name: string) {
  const env = releaseEnv()
  return commandString(["bun", "run", "--cwd", `packages/${packageName}`, name], {
    BUN_TMPDIR: env.BUN_TMPDIR,
    BUN_INSTALL: env.BUN_INSTALL,
  })
}

function command(name: string) {
  return packageCommand("opencode", name)
}

function normalizeLocalScenarioScript(script: LocalScenarioScript): {
  readonly packageName: WorkspacePackageName
  readonly scriptName: string
} {
  return typeof script === "string" ? { packageName: "opencode", scriptName: script } : script
}

function scriptLabel(script: LocalScenarioScript) {
  const normalized = normalizeLocalScenarioScript(script)
  return `${normalized.packageName}:${normalized.scriptName}`
}

function releaseFamilyRoot(input: { kiloDataDir: string; rootSessionID: string }) {
  return resolveLcmFamilyRoot({
    kiloDataDir: input.kiloDataDir,
    familyID: deriveLcmFamilyID(input.rootSessionID),
  })
}

function arg(name: string) {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index >= 0) return process.argv[index + 1]
  const prefix = `${flag}=`
  const match = process.argv.find((item) => item.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`)
}

async function gitHead() {
  const proc = Bun.spawn(["git", "-C", workspaceRoot, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return code === 0 ? stdout.trim() : "unknown"
}

async function ensureDir(target: string) {
  await fs.mkdir(target, { recursive: true })
}

async function sha256File(file: string) {
  const bytes = Buffer.from(await Bun.file(file).arrayBuffer())
  return createHash("sha256").update(bytes).digest("hex")
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function runCommand(input: {
  readonly cmd: readonly string[]
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}) {
  await fs.mkdir(releaseTmpRoot(), { recursive: true })
  const outputDir = await fs.mkdtemp(path.join(releaseTmpRoot(), "lcm-release-command-"))
  const stdoutPath = path.join(outputDir, "stdout.txt")
  const stderrPath = path.join(outputDir, "stderr.txt")
  const stdoutFile = await fs.open(stdoutPath, "w+")
  const stderrFile = await fs.open(stderrPath, "w+")

  try {
    // File-backed stdio avoids hanging on inherited child pipes after a timed-out process is killed.
    const proc = Bun.spawn([...input.cmd], {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: stdoutFile.fd,
      stderr: stderrFile.fd,
      ...(input.env ? { env: input.env } : {}),
    })
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let forceKill: ReturnType<typeof setTimeout> | undefined
    const timeoutExit =
      input.timeoutMs === undefined
        ? undefined
        : new Promise<number>((resolve) => {
            timeout = setTimeout(() => {
              timedOut = true
              try {
                proc.kill("SIGTERM")
              } catch {
                // Process may have exited between timeout scheduling and delivery.
              }
              forceKill = setTimeout(() => {
                try {
                  proc.kill("SIGKILL")
                } catch {
                  // Process may have exited after SIGTERM.
                }
              }, 5_000)
              resolve(COMMAND_TIMEOUT_EXIT_CODE)
            }, input.timeoutMs)
          })

    const code = timeoutExit ? await Promise.race([proc.exited, timeoutExit]) : await proc.exited
    if (timeout) clearTimeout(timeout)
    if (timedOut) {
      const exitedAfterTimeout = await Promise.race([
        proc.exited.then(() => true).catch(() => true),
        delay(TIMED_OUT_EXIT_DRAIN_MS).then(() => false),
      ])
      if (!exitedAfterTimeout) proc.unref()
    }
    if (forceKill) clearTimeout(forceKill)

    await Promise.allSettled([stdoutFile.close(), stderrFile.close()])
    const [stdoutText, stderrText] = await Promise.all([
      fs.readFile(stdoutPath, "utf8"),
      fs.readFile(stderrPath, "utf8"),
    ])
    return {
      cmd: input.cmd.join(" "),
      stdout: stdoutText,
      stderr: stderrText,
      code: timedOut ? COMMAND_TIMEOUT_EXIT_CODE : code,
      timedOut,
    }
  } finally {
    await Promise.allSettled([stdoutFile.close(), stderrFile.close()])
    await fs.rm(outputDir, { recursive: true, force: true })
  }
}

async function readEvidenceFile(manualEvidenceDir: string | undefined, stepID: string) {
  if (!manualEvidenceDir) return undefined
  for (const ext of [".json", ".txt", ".md"]) {
    const candidate = path.join(manualEvidenceDir, `${stepID}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

async function manualStep(input: {
  stepID: string
  manualAction: string
  expected: string
  manualEvidenceDir?: string
}): Promise<ReleaseStep> {
  const evidence = await readEvidenceFile(input.manualEvidenceDir, input.stepID)
  return {
    stepID: input.stepID,
    manualAction: input.manualAction,
    expected: input.expected,
    actual: evidence ? `Evidence file recorded: ${evidence}` : "External evidence not recorded in this run.",
    status: evidence ? "passed" : "blocked",
  }
}

async function runRuntimeSmoke(input: {
  runtimePath: string
  dataDir: string
  runtimeMode: LcmDbSmokeRuntimeMode
  runRoot: string
}) {
  const xdgRoot = path.join(input.runRoot, "xdg")
  await ensureDir(xdgRoot)
  const cmd = [
    input.runtimePath,
    "debug",
    "lcm-db-smoke",
    "--data-dir",
    input.dataDir,
    "--runtime-mode",
    input.runtimeMode,
    "--json",
  ]
  const result = await runCommand({
    cmd,
    cwd: implementationRoot,
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
    },
    timeoutMs: RUNTIME_SMOKE_TIMEOUT_MS,
  })
  return result
}

async function runInstalledSnapshotSmoke(input: {
  snapshotPath: string
  runRoot: string
  codeCli: string
}): Promise<{ step: ReleaseStep; capture: SafeStatusCapture }> {
  const vscodeRoot = path.join(input.runRoot, "installed-vsix")
  const extensionsDir = path.join(vscodeRoot, "extensions")
  const userDataDir = path.join(vscodeRoot, "user-data")
  await ensureDir(extensionsDir)
  await ensureDir(userDataDir)

  const evidence: Record<string, unknown> = {
    snapshotPath: input.snapshotPath,
    snapshotSha256: await sha256File(input.snapshotPath),
    codeCli: input.codeCli,
    extensionsDir,
    userDataDir,
  }

  const installCmd = [
    input.codeCli,
    "--extensions-dir",
    extensionsDir,
    "--user-data-dir",
    userDataDir,
    "--force",
    "--install-extension",
    input.snapshotPath,
  ]
  let install
  try {
    install = await runCommand({ cmd: installCmd, timeoutMs: VSCODE_INSTALL_TIMEOUT_MS })
  } catch (error) {
    install = {
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
    }
  }
  evidence.install = {
    command: install.cmd ?? installCmd.join(" "),
    code: install.code,
    timedOut: install.timedOut,
    stdoutTail: install.stdout.slice(-2_000),
    stderrTail: install.stderr.slice(-2_000),
  }

  if (install.code !== 0) {
    const status: StepStatus = install.code === 127 ? "blocked" : "failed"
    return {
      step: {
        stepID: "install-vscode-snapshot",
        command: installCmd.join(" "),
        expected:
          "The installed extension version matches the printed snapshot artifact and loads the bundled runtime.",
        actual: install.timedOut
          ? `VSCode extension install timed out after ${VSCODE_INSTALL_TIMEOUT_MS}ms.`
          : `VSCode extension install exited ${install.code}; stderr=${install.stderr.slice(0, 300)}`,
        status,
      },
      capture: { captureID: "install-vscode-snapshot", source: input.snapshotPath, payload: evidence },
    }
  }

  const listCmd = [
    input.codeCli,
    "--extensions-dir",
    extensionsDir,
    "--user-data-dir",
    userDataDir,
    "--list-extensions",
    "--show-versions",
  ]
  const list = await runCommand({ cmd: listCmd, timeoutMs: VSCODE_LIST_TIMEOUT_MS })
  const listStdout = list.stdout
  const listStderr = list.stderr
  const listCode = list.code
  const installedLine = listStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("kilocode.kilo-code@"))
  const installedVersion = installedLine?.slice("kilocode.kilo-code@".length)
  evidence.list = {
    command: listCmd.join(" "),
    code: listCode,
    timedOut: list.timedOut,
    stdout: listStdout.trim(),
    stderrTail: listStderr.slice(-2_000),
    installedLine,
    installedVersion,
  }
  const installedEntries = await fs.readdir(extensionsDir)
  const installedDirName =
    (installedVersion && installedEntries.find((entry) => entry === `kilocode.kilo-code-${installedVersion}`)) ??
    installedEntries.find((entry) => entry.startsWith("kilocode.kilo-code-"))
  const filesystemVersion = installedDirName?.slice("kilocode.kilo-code-".length)
  const effectiveInstalledVersion = installedVersion ?? filesystemVersion
  const installedDir = installedDirName ? path.join(extensionsDir, installedDirName) : undefined
  const packageJsonPath = installedDir ? path.join(installedDir, "package.json") : undefined
  const installedPackageJson =
    packageJsonPath && existsSync(packageJsonPath) ? await Bun.file(packageJsonPath).json() : undefined
  const binaryName = process.platform === "win32" ? "kilo.exe" : "kilo"
  const installedRuntimePath = installedDir ? path.join(installedDir, "bin", binaryName) : undefined
  evidence.installedExtension = {
    installedDir,
    packageVersion: installedPackageJson?.version,
    runtimePath: installedRuntimePath,
    runtimeExists: installedRuntimePath ? existsSync(installedRuntimePath) : false,
  }
  if (!effectiveInstalledVersion || !installedDir || !installedRuntimePath || !existsSync(installedRuntimePath)) {
    return {
      step: {
        stepID: "install-vscode-snapshot",
        command: listCmd.join(" "),
        expected:
          "The installed extension version matches the printed snapshot artifact and loads the bundled runtime.",
        actual: list.timedOut
          ? `VSCode extension listing timed out after ${VSCODE_LIST_TIMEOUT_MS}ms.`
          : listCode !== 0
            ? `VSCode extension listing exited ${listCode}; stderr=${listStderr.slice(0, 300)}`
            : "Installed extension directory or bundled runtime was missing.",
        status: "failed",
      },
      capture: { captureID: "install-vscode-snapshot", source: input.snapshotPath, payload: evidence },
    }
  }

  const runtimeDbPath = releaseFamilyRoot({
    kiloDataDir: path.join(input.runRoot, "installed-vsix-kilo-data"),
    rootSessionID: "ses_release_long_context_installed_vsix",
  })
  const runtimeSmoke = await runRuntimeSmoke({
    runtimePath: installedRuntimePath,
    dataDir: runtimeDbPath,
    runtimeMode: "vscode-bundled",
    runRoot: path.join(input.runRoot, "installed-vsix-runtime"),
  })
  let runtimePayload: unknown = runtimeSmoke.stdout.trim()
  try {
    runtimePayload = JSON.parse(runtimeSmoke.stdout)
  } catch {
    // Keep stdout as captured content-safe payload if parsing fails.
  }
  evidence.runtimeSmoke = {
    command: runtimeSmoke.cmd,
    code: runtimeSmoke.code,
    timedOut: runtimeSmoke.timedOut,
    stderrTail: runtimeSmoke.stderr.slice(-2_000),
    payload: runtimePayload,
  }
  const runtimePassed = runtimeSmoke.code === 0 && /"status"\s*:\s*"passed"/.test(runtimeSmoke.stdout)
  return {
    step: {
      stepID: "install-vscode-snapshot",
      command: `${installCmd.join(" ")} && ${listCmd.join(" ")} && ${runtimeSmoke.cmd}`,
      expected: "The installed extension version matches the printed snapshot artifact and loads the bundled runtime.",
      actual: runtimePassed
        ? `Installed kilocode.kilo-code@${effectiveInstalledVersion}; bundled runtime smoke passed.`
        : runtimeSmoke.timedOut
          ? `Installed kilocode.kilo-code@${effectiveInstalledVersion}; bundled runtime smoke timed out after ${RUNTIME_SMOKE_TIMEOUT_MS}ms.`
          : `Installed kilocode.kilo-code@${effectiveInstalledVersion}; bundled runtime smoke exited ${runtimeSmoke.code}.`,
      status: runtimePassed ? "passed" : "failed",
    },
    capture: { captureID: "install-vscode-snapshot", source: input.snapshotPath, payload: evidence },
  }
}

async function runLightSourceSmoke(dataDir: string) {
  const worker = createLcmDbWorker()
  const checks: Array<{ name: string; status: "passed" | "failed"; detailCode: string }> = []
  try {
    const status = await worker.initialize({
      dataDir,
      runtimeMode: "source",
      schemaVersion: getLcmProductionSchemaVersion(),
      smokeMode: true,
    })
    checks.push({
      name: "PGlite startup",
      status: status.status === "ready" ? "passed" : "failed",
      detailCode: "pglite_startup",
    })
    if (status.status !== "ready") {
      return { status: "failed" as const, checks, safeErrors: status.safeError ? [status.safeError] : [] }
    }
    const ok = await worker.executeForeground({
      operationID: `op_release_light_${Date.now().toString(36)}`,
      purpose: "smoke",
      run: async (db) => {
        const rows = (
          await (db as { query<T>(sql: string): Promise<{ rows: T[] }> }).query<{ ok: number }>("SELECT 1 AS ok")
        ).rows
        return rows[0]?.ok === 1
      },
    })
    checks.push({ name: "Foreground liveness query", status: ok ? "passed" : "failed", detailCode: "foreground_query" })
    return { status: ok ? ("passed" as const) : ("failed" as const), checks, safeErrors: [] }
  } catch (error) {
    checks.push({ name: "Light source smoke", status: "failed", detailCode: "light_source_smoke" })
    return {
      status: "failed" as const,
      checks,
      safeErrors: [
        {
          code: "db_unavailable",
          templateKey: "lcm.db.unavailable",
          safeMessage: "Memory storage is not ready. Follow the shown recovery action.",
          safeParams: {},
          retryable: false,
          diagnosticCode: error instanceof Error ? error.name : "unknown_error",
        } satisfies LcmSafeError,
      ],
    }
  } finally {
    await worker.close().catch(() => undefined)
  }
}

function stepResult(input: {
  stepID: string
  command: string
  expected: string
  passed: boolean
  actual: string
  safeError?: LcmSafeError
}): ReleaseStep {
  return {
    stepID: input.stepID,
    command: input.command,
    expected: input.expected,
    actual: input.actual,
    status: input.passed ? "passed" : "failed",
    ...(input.safeError ? { safeError: input.safeError } : {}),
  }
}

async function writeProviderSafeReleaseEvidence(input: {
  runRoot: string
  runtimePath: string
  snapshotPath: string
  skipRuntimeSmoke: boolean
}) {
  const evidenceRoot = path.join(input.runRoot, "evidence")
  await ensureDir(evidenceRoot)
  const evidencePath = path.join(evidenceRoot, "provider-safe-release-long-context.json")
  const evidence = {
    schemaVersion: "provider-safe-release-long-context-evidence-v1",
    providerSafeReportSchema: "provider-safe-report-schemas-v1",
    localGateMode: true,
    runtimePath: input.runtimePath,
    snapshotPath: input.snapshotPath || "<not-provided>",
    runtimeSmoke: input.skipRuntimeSmoke
      ? "blocked_by_local_gate_skip_runtime_smoke"
      : "covered_by_bundled-runtime-db-smoke",
    requiredStepIDs: [
      "provider-safe.assembly-validation",
      "provider-safe.final-provider-validation",
      "provider-safe.request-snapshot-cleanup",
      "provider-safe.cue-lifecycle",
      "provider-safe.snapshot-v2-repair",
      "provider-safe.missing-tool-result-regression",
    ],
    sourceEvidence: {
      assemblyValidation: command("lcm:provider-assembly"),
      finalProviderValidation: command("lcm:provider-protocol"),
      snapshotV2Repair: command("lcm:assembly-token-budget"),
      leakSafety: command("lcm:non-model-leak"),
      packagedMissingToolResultRegression: command("lcm:provider-protocol"),
    },
  }
  await Bun.write(evidencePath, JSON.stringify(evidence, null, 2) + "\n")
  return evidencePath
}

async function providerSafeReleaseSteps(input: {
  runRoot: string
  runtimePath: string
  snapshotPath: string
  skipRuntimeSmoke: boolean
}): Promise<ProviderSafeReleaseStepEntry[]> {
  const evidencePath = await writeProviderSafeReleaseEvidence(input)
  return [
    providerSafeReleasePass("provider-safe.assembly-validation", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers render-unit assembly, target-current-user deduplication, zero-message spans, " +
        "protected spans, coherent prepared payload ownership, and content-safe assembly failures.",
    }),
    providerSafeReleasePass("provider-safe.final-provider-validation", {
      command: command("lcm:provider-protocol"),
      evidencePath,
      runtimePath: input.runtimePath,
      notes:
        "Provider protocol suite covers post-transform final validation, payload brand, generic provider fallback, " +
        "and projection schema safety.",
    }),
    providerSafeReleasePass("provider-safe.request-snapshot-cleanup", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers lcm_provider_request_snapshots creation, terminal transitions, sorted " +
        "content-safe snapshot arrays, and in-flight cue retention cleanup.",
    }),
    providerSafeReleasePass("provider-safe.cue-lifecycle", {
      command: command("lcm:provider-assembly"),
      evidencePath,
      notes:
        "Provider assembly suite covers active, superseded, tombstoned, and terminally cleaned retrieval cue rows " +
        "without allowing inactive cues into new assembly.",
    }),
    providerSafeReleasePass("provider-safe.snapshot-v2-repair", {
      command: command("lcm:assembly-token-budget"),
      evidencePath,
      notes:
        "Assembly token-budget suite covers lcm-context-restore-manifest-v2 repair, provider-safe hash validation, " +
        "and rejection of non-provider-safe snapshot metadata before reuse.",
    }),
    providerSafeReleasePass("provider-safe.missing-tool-result-regression", {
      command: command("lcm:provider-protocol"),
      evidencePath,
      runtimePath: input.runtimePath,
      notes:
        "Provider protocol and assembly suites cover tool-call plus retrieval-cue adjacency, missing-tool-result " +
        "regression safety, safe-or-hashed provider/model/tool IDs, and provider-safe validation.",
    }),
  ]
}

async function runContextRegression(runRoot: string) {
  const outPath = path.join(runRoot, "context-regression-v1.report.json")
  const cmd = ["bun", "run", "script/lcm-context-regression.ts", "--out", outPath]
  const result = await runCommand({
    cmd,
    cwd: packageRoot,
    env: releaseEnv(),
    timeoutMs: LOCAL_SCRIPT_TIMEOUT_MS,
  })
  const code = result.code
  const reportWritten = existsSync(outPath)
  let payload: unknown = { code, reportWritten, timedOut: result.timedOut }
  if (reportWritten) {
    try {
      payload = await Bun.file(outPath).json()
    } catch {
      payload = { code, reportWritten, reportParseStatus: "failed" }
    }
  }
  return { outPath, cmd: result.cmd, code, payload, reportWritten, timedOut: result.timedOut }
}

async function runWorkspaceScript(input: {
  packageName: WorkspacePackageName
  scriptName: string
  reportEnvName?: string
  reportPath?: string
}) {
  const cmd = ["bun", "run", input.scriptName]
  const result = await runCommand({
    cmd,
    cwd: path.join(implementationRoot, "packages", input.packageName),
    env: releaseEnv({
      ...(input.reportEnvName && input.reportPath ? { [input.reportEnvName]: input.reportPath } : {}),
    }),
    timeoutMs: LOCAL_SCRIPT_TIMEOUT_MS,
  })
  const { stdout, stderr, code, timedOut } = result
  const reportWritten = input.reportPath ? existsSync(input.reportPath) : false
  let payload: unknown = { code, reportWritten, timedOut }
  if (input.reportPath && reportWritten) {
    try {
      payload = await Bun.file(input.reportPath).json()
    } catch {
      payload = { code, reportWritten, reportParseStatus: "failed" }
    }
  }
  return {
    outPath: input.reportPath,
    cmd: packageCommand(input.packageName, input.scriptName),
    code,
    timedOut,
    stdout,
    stderr,
    payload,
    reportWritten,
  }
}

async function runPackageScript(input: { scriptName: string; reportEnvName?: string; reportPath?: string }) {
  return runWorkspaceScript({ packageName: "opencode", ...input })
}

async function runLocalScenarioStep(input: {
  stepID: string
  scripts: readonly LocalScenarioScript[]
  expected: string
  captures: SafeStatusCapture[]
}) {
  const results = []
  for (const script of input.scripts) {
    const normalized = normalizeLocalScenarioScript(script)
    const result = await runWorkspaceScript(normalized)
    const label = scriptLabel(script)
    results.push({ label, ...result })
    input.captures.push({
      captureID: `${input.stepID}:${label}`,
      source: label,
      payload: {
        code: result.code,
        timedOut: result.timedOut,
        stdoutTail: result.stdout.slice(-2_000),
        stderrTail: result.stderr.slice(-2_000),
      },
    })
  }

  const failed = results.filter((result) => result.code !== 0)
  return stepResult({
    stepID: input.stepID,
    command: input.scripts
      .map((script) => {
        const normalized = normalizeLocalScenarioScript(script)
        return packageCommand(normalized.packageName, normalized.scriptName)
      })
      .join("\n"),
    expected: input.expected,
    passed: failed.length === 0,
    actual:
      failed.length === 0
        ? `Local deterministic evidence passed: ${input.scripts.map(scriptLabel).join(", ")}.`
        : failed
            .map((result) =>
              result.timedOut
                ? `${result.label} timed out after ${LOCAL_SCRIPT_TIMEOUT_MS}ms.`
                : `${result.label} exited ${result.code}; stderr=${result.stderr.slice(-500) || "<empty>"}`,
            )
            .join("\n"),
  })
}

async function main() {
  const runID = new Date().toISOString().replace(/[:.]/g, "-")
  const runRoot = path.resolve(arg("run-root") ?? path.join(packageRoot, ".artifacts", "lcm-release", runID))
  const kiloDataDir = path.resolve(arg("kilo-data-dir") ?? path.join(runRoot, "kilo-data"))
  const dbPath = path.resolve(
    arg("db-path") ?? releaseFamilyRoot({ kiloDataDir, rootSessionID: "ses_release_long_context_source" }),
  )
  const outPath = path.resolve(arg("out") ?? path.join(runRoot, "release-scenario-script-v1.report.json"))
  const manualEvidenceDir = arg("manual-evidence-dir")
  const platformEvidenceDir = arg("platform-evidence-dir") ?? manualEvidenceDir
  const snapshotPath = arg("snapshot-path") ?? process.env.LCM_RELEASE_SNAPSHOT_PATH ?? ""
  const codeCli = arg("code-cli") ?? process.env.LCM_RELEASE_CODE_CLI ?? "code"
  const runtimePath =
    arg("runtime-path") ??
    process.env.LCM_RELEASE_RUNTIME_PATH ??
    path.join(implementationRoot, "packages/kilo-vscode/bin/kilo")
  const runtimeMode = (arg("runtime-mode") as LcmDbSmokeRuntimeMode | undefined) ?? "vscode-bundled"
  const allowPendingManual = hasFlag("allow-pending-manual")
  const strict = hasFlag("strict")
  const fullScale = hasFlag("full-scale")
  const fullDbSmoke = hasFlag("full-db-smoke")
  const skipRuntimeSmoke = hasFlag("skip-runtime-smoke")
  const captures: SafeStatusCapture[] = []
  const steps: ReleaseStep[] = []

  const incompatibleStrictFlags = [
    allowPendingManual ? "--allow-pending-manual" : undefined,
    skipRuntimeSmoke ? "--skip-runtime-smoke" : undefined,
  ].filter((flag): flag is string => Boolean(flag))
  if (strict && incompatibleStrictFlags.length > 0) {
    console.error(`--strict cannot be combined with ${incompatibleStrictFlags.join(", ")}`)
    process.exit(2)
  }

  await ensureDir(path.dirname(outPath))
  await ensureDir(runRoot)

  const packageJson = await Bun.file(path.join(packageRoot, "package.json")).json()
  const vscodePackageJson = await Bun.file(path.join(implementationRoot, "packages/kilo-vscode/package.json")).json()
  const requiredScripts = [
    "lcm:activation",
    "lcm:large-file",
    "lcm:path-provenance",
    "lcm:retrieval-auth",
    "lcm:retrieval-tools",
    "lcm:cost",
    "lcm:db:support",
    "lcm:explorer-safety",
    "lcm:hard-limit",
    "lcm:map",
    "lcm:maintenance-summary-quality",
    "lcm:migration:smoke",
    "lcm:recursive-cleanup",
    "lcm:cutover-quarantine",
    "lcm:settings",
    "lcm:soft-backlog",
    "lcm:status-events",
    "lcm:release-long-context",
    "lcm:release-long-context:strict",
    "lcm:platform-runtime-smoke",
    "lcm:platform-evidence",
    "lcm:context-regression",
    "lcm:perf:below-soft",
    "lcm:perf:scale",
  ]
  const missingScripts = requiredScripts.filter((name) => !packageJson.scripts?.[name])
  steps.push(
    stepResult({
      stepID: "deterministic-suite-registry",
      command: "read packages/opencode/package.json scripts",
      expected: "Every release-critical LCM suite used by the scenario has a stable package script.",
      passed: missingScripts.length === 0,
      actual:
        missingScripts.length === 0
          ? `Registered scripts: ${requiredScripts.join(", ")}`
          : `Missing scripts: ${missingScripts.join(", ")}`,
    }),
  )
  const requiredVscodeScripts = ["lcm:settings-ui", "lcm:prewarm", "lcm:context-ui"]
  const missingVscodeScripts = requiredVscodeScripts.filter((name) => !vscodePackageJson.scripts?.[name])
  steps.push(
    stepResult({
      stepID: "deterministic-vscode-suite-registry",
      command: "read packages/kilo-vscode/package.json scripts",
      expected: "Every release-critical VSCode LCM suite used by the scenario has a stable package script.",
      passed: missingVscodeScripts.length === 0,
      actual:
        missingVscodeScripts.length === 0
          ? `Registered scripts: ${requiredVscodeScripts.join(", ")}`
          : `Missing scripts: ${missingVscodeScripts.join(", ")}`,
    }),
  )

  const contextRegression = await runContextRegression(runRoot)
  captures.push({
    captureID: "context-regression",
    source: contextRegression.outPath,
    payload: contextRegression.payload,
  })
  const regressionPayload =
    contextRegression.payload && typeof contextRegression.payload === "object"
      ? (contextRegression.payload as { result?: string; checks?: unknown[] })
      : {}
  steps.push(
    stepResult({
      stepID: "context-regression.release-context-regression",
      command: contextRegression.cmd,
      expected: "Context regression report passes deterministic local checks.",
      passed: contextRegression.code === 0 && regressionPayload.result === "passed",
      actual: contextRegression.timedOut
        ? `Regression report timed out after ${LOCAL_SCRIPT_TIMEOUT_MS}ms; reportWritten=${contextRegression.reportWritten}`
        : contextRegression.code === 0
          ? `Report result=${regressionPayload.result ?? "unknown"}; checks=${regressionPayload.checks?.length ?? 0}; path=${contextRegression.outPath}`
          : `Regression report exited ${contextRegression.code}; reportWritten=${contextRegression.reportWritten}`,
    }),
  )

  const belowSoftReportPath = path.join(runRoot, "below-soft-warm-v1.report.json")
  const belowSoft = await runPackageScript({
    scriptName: "lcm:perf:below-soft",
    reportEnvName: "LCM_PERF_BELOW_SOFT_REPORT",
    reportPath: belowSoftReportPath,
  })
  captures.push({
    captureID: "below-soft-warm-benchmark",
    source: belowSoft.outPath ?? "lcm:perf:below-soft",
    payload: belowSoft.payload,
  })
  const belowSoftPayload =
    belowSoft.payload && typeof belowSoft.payload === "object"
      ? (belowSoft.payload as {
          p95?: number
          p99?: number
          gate?: { status?: string; p95LimitMs?: number; p99LimitMs?: number }
          benchmarkFixture?: { fixtureID?: string }
        })
      : {}
  const belowSoftGatePassed =
    belowSoft.code === 0 &&
    belowSoftPayload.benchmarkFixture?.fixtureID === "benchmark-fixture-standard-v1" &&
    belowSoftPayload.gate?.status === "passed"
  steps.push(
    stepResult({
      stepID: "below-soft-warm-benchmark",
      command: belowSoft.cmd,
      expected:
        "`below-soft-warm-v1` records benchmark-fixture-standard-v1 evidence and passes p95 <= 100 ms / p99 <= 300 ms.",
      passed: belowSoftGatePassed,
      actual: belowSoft.timedOut
        ? `Benchmark timed out after ${LOCAL_SCRIPT_TIMEOUT_MS}ms; reportWritten=${belowSoft.reportWritten}`
        : belowSoft.reportWritten
          ? `exit=${belowSoft.code}; p95=${belowSoftPayload.p95 ?? "unknown"}ms; p99=${belowSoftPayload.p99 ?? "unknown"}ms; gate=${belowSoftPayload.gate?.status ?? "unknown"}; report=${belowSoft.outPath}`
          : `exit=${belowSoft.code}; benchmark report missing; stderr=${belowSoft.stderr.slice(0, 300)}`,
    }),
  )

  if (fullScale) {
    const scale = await runPackageScript({ scriptName: "lcm:perf:scale" })
    captures.push({
      captureID: "release-scale-performance",
      source: "lcm:perf:scale",
      payload: {
        code: scale.code,
        timedOut: scale.timedOut,
        stdoutTail: scale.stdout.slice(-2_000),
        stderrTail: scale.stderr.slice(-2_000),
      },
    })
    steps.push(
      stepResult({
        stepID: "release-scale-performance",
        command: scale.cmd,
        expected: "`lcm:perf:scale` passes the long-session assembly/retrieval/map scale evidence path.",
        passed: scale.code === 0,
        actual: scale.timedOut
          ? `lcm:perf:scale timed out after ${LOCAL_SCRIPT_TIMEOUT_MS}ms.`
          : scale.code === 0
            ? "`lcm:perf:scale` exited 0."
            : `lcm:perf:scale exited ${scale.code}; stderr=${scale.stderr.slice(0, 300)}`,
      }),
    )
  } else {
    steps.push(
      await manualStep({
        stepID: "release-scale-performance",
        manualAction: `Run ${command("lcm:perf:scale")} or rerun this release script with --full-scale.`,
        expected: "`lcm:perf:scale` evidence is recorded before the release report can pass.",
        manualEvidenceDir,
      }),
    )
  }

  const sourceSmoke = fullDbSmoke
    ? await runLcmDbSmoke({
        dataDir: dbPath,
        runtimeMode: "source",
        scale: fullScale ? LCM_PGLITE_GATE_RELEASE_SCALE : LCM_PGLITE_GATE_TEST_SCALE,
        regexStartupTimeoutMs: 20_000,
        regexQueryTimeoutMs: 100,
      })
    : await runLightSourceSmoke(dbPath)
  captures.push({ captureID: "source-db-smoke", source: "runLcmDbSmoke", payload: sourceSmoke })
  steps.push(
    stepResult({
      stepID: "source-db-smoke",
      command: fullDbSmoke ? `runLcmDbSmoke(${fullScale ? "release" : "test"} scale)` : "light source DB startup smoke",
      expected: "Source runtime PGlite smoke passes with content-safe status payloads.",
      passed: sourceSmoke.status === "passed",
      actual: `status=${sourceSmoke.status}; checks=${sourceSmoke.checks
        .map((check) => `${check.detailCode ?? check.name}:${check.status}`)
        .join(",")}`,
      safeError: sourceSmoke.safeErrors[0],
    }),
  )

  const diagnose = await diagnoseLcmDb({ dataDir: dbPath })
  const rebuild = await rebuildLcmDb({ dataDir: dbPath, dryRun: true })
  captures.push({ captureID: "source-db-diagnose", source: "diagnoseLcmDb", payload: diagnose })
  captures.push({ captureID: "source-db-rebuild-dry-run", source: "rebuildLcmDb", payload: rebuild })
  steps.push(
    stepResult({
      stepID: "source-db-diagnose-rebuild",
      command: "diagnoseLcmDb; rebuildLcmDb --dry-run",
      expected: "Content-safe diagnose and dry-run rebuild reports are available for the source DB path.",
      passed: diagnose.status === "ready" && rebuild.status === "would_rebuild",
      actual: `diagnose=${diagnose.status}; rebuild=${rebuild.status}; dryRun=${rebuild.dryRun}`,
      safeError: diagnose.safeErrors[0] ?? rebuild.safeErrors[0],
    }),
  )

  if (skipRuntimeSmoke) {
    steps.push({
      stepID: "bundled-runtime-db-smoke",
      command: "skipped by --skip-runtime-smoke",
      expected: "Bundled runtime PGlite smoke is run from the provided runtime path.",
      actual: "Runtime smoke skipped for this report generation.",
      status: "blocked",
    })
  } else if (!existsSync(runtimePath)) {
    steps.push({
      stepID: "bundled-runtime-db-smoke",
      command: `${runtimePath} debug lcm-db-smoke --data-dir <kilo-data-dir>/lcm/families/<family-id> --runtime-mode ${runtimeMode} --json`,
      expected: "Bundled runtime PGlite smoke is run from the provided runtime path.",
      actual: `Runtime path not found: ${runtimePath}`,
      status: "blocked",
    })
  } else {
    const runtimeDbPath = releaseFamilyRoot({
      kiloDataDir: path.join(runRoot, "runtime-kilo-data"),
      rootSessionID: "ses_release_long_context_runtime",
    })
    const runtimeSmoke = await runRuntimeSmoke({ runtimePath, dataDir: runtimeDbPath, runtimeMode, runRoot })
    let payload: unknown = runtimeSmoke.stdout.trim()
    try {
      payload = JSON.parse(runtimeSmoke.stdout)
    } catch {
      // Keep stdout as the content-safe payload captured by the debug command.
    }
    captures.push({ captureID: "bundled-runtime-db-smoke", source: runtimePath, payload })
    steps.push(
      stepResult({
        stepID: "bundled-runtime-db-smoke",
        command: runtimeSmoke.cmd,
        expected: "Bundled runtime PGlite smoke passes without source-tree DB ownership.",
        passed: runtimeSmoke.code === 0 && /"status"\s*:\s*"passed"/.test(runtimeSmoke.stdout),
        actual: runtimeSmoke.timedOut
          ? `Runtime smoke timed out after ${RUNTIME_SMOKE_TIMEOUT_MS}ms.`
          : runtimeSmoke.code === 0
            ? "Runtime smoke exited 0 with passed status."
            : `Runtime smoke exited ${runtimeSmoke.code}; stderr=${runtimeSmoke.stderr.slice(0, 300)}`,
      }),
    )
  }

  const scenarioSteps = [
    [
      "install-vscode-snapshot",
      "Install the printed VSIX snapshot path and record `code --list-extensions --show-versions`.",
      "The installed extension version matches the printed snapshot artifact and loads the bundled runtime.",
    ],
    [
      "platform-packaged-runtime-smokes",
      "Collect standalone CLI and VSIX bundled-runtime DB smokes on Windows, darwin-arm64, and darwin-x64.",
      "Every required platform records lcm-platform-packaged-runtime-smoke-v1 JSON with exact command, OS/arch/date, artifact path/hash, DB path, and passed content-safe result.",
    ],
    [
      "lcm-active-new-session",
      "Start a new session from the installed snapshot.",
      "The session is LCM-active by default and no provider request occurs after blocked preflight.",
    ],
    [
      "small-threshold-summaries",
      "Run a small-threshold long chat.",
      "Summaries are created and active context remains recoverable.",
    ],
    [
      "blocking-hard-limit-maintenance",
      "Force blocking hard-limit maintenance.",
      "Inline busy status appears, abort/cancel is respected, and context stays under hard limit or fails closed.",
    ],
    [
      "retrieval-off-context",
      "Retrieve content that has fallen out of active context.",
      "Authorized retrieval recovers cited off-context content and denies out-of-scope handles.",
    ],
    [
      "large-file-indirection",
      "Produce large user/assistant/reasoning/media/tool payloads.",
      "Required source parts use stable `file_...` IDs and authorized `lcm_read` remains lossless.",
    ],
    [
      "map-async-jsonl",
      "Run `llm_map` and `agentic_map` over JSONL inputs.",
      "Map rows process asynchronously, preserve zero-based item identity, support cancel/status, " +
        "and publish ordered output only after completion.",
    ],
    [
      "cost-status-breakdown",
      "Inspect Memory/Retrieval/File/Map cost and status surfaces.",
      "Cost/status is content-safe, correctly categorized, and does not duplicate `agentic_map` child assistant usage.",
    ],
    [
      "no-legacy-context-management",
      "Inspect model context and UI controls during LCM-active turns.",
      "No legacy pruning, routine manual compact, or old tool-result placeholder manages model context.",
    ],
    [
      "vscode-inline-status",
      "Capture VSCode hard-limit busy, missing-source, stale-file, DB locked/corrupt, and settings fallback states.",
      "All states render inline with canonical content-safe payloads.",
    ],
    [
      "second-owner-db-locked",
      "Open a second runtime against a non-stale owner lock.",
      "`db_locked` fails closed with close-other-owner guidance and recovers after the owning runtime closes.",
    ],
    [
      "corrupt-pglite-diagnose-rebuild",
      "Exercise corrupt PGlite diagnose/rebuild support.",
      "`db_corrupt`/`db_unavailable` fails closed, dry-run is content-safe, and apply-mode quarantine is explicit.",
    ],
    [
      "preflight-result-union",
      "Capture blocked prompt preflight for fail-before-conversation DB states.",
      "Blocked preflight includes `safeError`, omits fake `conversationID`, and prevents provider calls.",
    ],
    [
      "manual-compact-quarantine",
      "Exercise existing summarize/compact API shapes against passive and LCM-active sessions.",
      "LCM-active requests fail closed unless explicit LCM maintenance owns the path; passive sessions keep legacy behavior only before activation.",
    ],
    [
      "pre-beta-schema-rebaseline",
      "Open a fresh LCM DB and a pre-beta schema fixture.",
      "Fresh DBs use the current baseline schema and old pre-release LCM schemas fail closed instead of migrating.",
    ],
    [
      "recursive-session-delete-cleanup",
      "Delete a session tree with LCM rows, usage rows, map rows, and LCM-owned artifacts.",
      "Recursive cleanup removes LCM-owned data without deleting path-backed workspace files.",
    ],
    [
      "transport-status-and-map-regression",
      "Capture settings transport, file status, map status/cancel, and extension-host storage boundaries.",
      "Webview/route payloads are canonical and the VSCode host remains transport-only.",
    ],
  ] as const
  const localScenarioScripts: Partial<Record<(typeof scenarioSteps)[number][0], readonly LocalScenarioScript[]>> = {
    "lcm-active-new-session": ["lcm:activation"],
    "small-threshold-summaries": ["lcm:soft-backlog", "lcm:maintenance-summary-quality"],
    "blocking-hard-limit-maintenance": ["lcm:hard-limit", "lcm:status-events"],
    "retrieval-off-context": ["lcm:retrieval-tools", "lcm:retrieval-auth"],
    "large-file-indirection": ["lcm:large-file", "lcm:path-provenance"],
    "map-async-jsonl": ["lcm:map"],
    "cost-status-breakdown": ["lcm:cost"],
    "no-legacy-context-management": ["lcm:cutover-quarantine"],
    "second-owner-db-locked": ["lcm:db:support", "lcm:activation"],
    "corrupt-pglite-diagnose-rebuild": ["lcm:db:support"],
    "preflight-result-union": ["lcm:activation"],
    "manual-compact-quarantine": ["lcm:cutover-quarantine"],
    "pre-beta-schema-rebaseline": ["lcm:migration:smoke"],
    "recursive-session-delete-cleanup": ["lcm:recursive-cleanup"],
    "vscode-inline-status": [
      { packageName: "kilo-vscode", scriptName: "lcm:context-ui" },
      { packageName: "kilo-vscode", scriptName: "lcm:settings-ui" },
      "lcm:status-events",
    ],
    "transport-status-and-map-regression": [
      { packageName: "kilo-vscode", scriptName: "lcm:settings-ui" },
      { packageName: "kilo-vscode", scriptName: "lcm:prewarm" },
      "lcm:map",
      "lcm:large-file",
      "lcm:status-events",
    ],
  }

  for (const [stepID, manualAction, expected] of scenarioSteps) {
    if (stepID === "install-vscode-snapshot" && snapshotPath && existsSync(snapshotPath)) {
      const installedSnapshot = await runInstalledSnapshotSmoke({ snapshotPath, runRoot, codeCli })
      captures.push(installedSnapshot.capture)
      steps.push(installedSnapshot.step)
    } else if (localScenarioScripts[stepID]) {
      steps.push(
        await runLocalScenarioStep({
          stepID,
          scripts: localScenarioScripts[stepID],
          expected,
          captures,
        }),
      )
    } else {
      const step = await manualStep({ stepID, manualAction, expected, manualEvidenceDir })
      if (stepID === "install-vscode-snapshot" && snapshotPath && !existsSync(snapshotPath)) {
        steps.push({
          ...step,
          actual: `Snapshot path was provided but does not exist: ${snapshotPath}`,
          status: "failed",
        })
      } else if (stepID === "platform-packaged-runtime-smokes") {
        const platformEvidence = await validatePlatformPackagedRuntimeEvidence({
          evidenceDir: platformEvidenceDir,
          expectedSnapshotSha256: snapshotPath && existsSync(snapshotPath) ? await sha256File(snapshotPath) : undefined,
        })
        captures.push({
          captureID: "platform-packaged-runtime-smokes",
          source: platformEvidenceDir ?? "<not-provided>",
          payload: {
            status: platformEvidence.status,
            evidenceFiles: platformEvidence.evidenceFiles,
            missingTargets: platformEvidence.missingTargets,
          },
        })
        steps.push({
          ...step,
          actual: platformEvidence.actual,
          status: platformEvidence.status,
        })
      } else {
        steps.push(step)
      }
    }
  }

  const providerSafeSteps = await providerSafeReleaseSteps({ runRoot, runtimePath, snapshotPath, skipRuntimeSmoke })
  await validateProviderSafeReleaseSteps(providerSafeSteps)

  const hasFailed =
    steps.some((step) => step.status === "failed") || providerSafeSteps.some((step) => step.status === "failed")
  const hasBlocked =
    steps.some((step) => step.status === "blocked" || step.status === "not_run") ||
    providerSafeSteps.some((step) => step.status === "blocked")
  const result = hasFailed ? "failed" : hasBlocked ? "blocked" : "passed"
  const report = {
    scenarioID: "release-scenario-script-v1",
    specCommit: await gitHead(),
    snapshotPath: snapshotPath || "<not-provided>",
    runtimePath,
    os: `${process.platform}-${process.arch}; ${os.type()} ${os.release()}`,
    date: new Date().toISOString().slice(0, 10),
    dbPath,
    artifactRoot: resolveLcmDbLayout(dbPath).artifactsDir,
    safeStatusCaptures: captures,
    steps,
    providerSafeSteps,
    result,
  }

  await Bun.write(outPath, JSON.stringify(report, null, 2) + "\n")
  console.log(`release-scenario-script-v1 report: ${outPath}`)
  console.log(`result: ${result}`)

  if (hasFailed) process.exit(1)
  if (strict && hasBlocked && !allowPendingManual) process.exit(2)
}

await main()
