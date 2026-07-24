#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Guards against accidentally inheriting workflows from upstream opencode and
 * rejects invalid GitHub Actions syntax before it reaches GitHub.
 *
 * To accept a new workflow, add its filename to ACTIVE_WORKFLOWS. To drop one,
 * remove its filename from the list. actionlint is downloaded from its pinned
 * upstream release and verified before use; ACTIONLINT_BIN can select an
 * already-installed binary and ACTIONLINT_CACHE_DIR can relocate the cache.
 */

import { createHash, randomUUID } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dir, "..")
export const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows")
export const ACTIONLINT_VERSION = "1.7.12"

export const ACTIVE_WORKFLOWS = [
  "auto-docs.yml",
  "beta.yml",
  "check-forbidden-strings.yml",
  "check-kilo-generated-artifacts.yml",
  "check-md-table-padding.yml",
  "check-opencode-annotations.yml",
  "check-org-member.yml",
  "codeql-kotlin.yml",
  "codeql.yml",
  "containers.yml",
  "docs-build.yml",
  "docs-check-links.yml",
  "generate.yml",
  "kilo-auto-close.yml",
  "lcm-macos-platform-smoke.yml",
  "lcm-required-checks.yml",
  "nix-eval.yml",
  "nix-hashes.yml",
  "prepare-jetbrains-release.yml",
  "publish-jetbrains.yml",
  "publish.yml",
  "smoke-test.yml",
  "source-check-links.yml",
  "test-jetbrains.yml",
  "test-vscode.yml",
  "test.yml",
  "typecheck.yml",
  "visual-regression.yml",
  "watch-opencode-releases.yml",
  "workflow-validation.yml",
] as const

type ActionlintAsset = {
  archive: string
  sha256: string
  executable: string
}

type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<RunResult>

const ACTIONLINT_ASSETS: Record<string, ActionlintAsset> = {
  "darwin-arm64": {
    archive: "actionlint_1.7.12_darwin_arm64.tar.gz",
    sha256: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
    executable: "actionlint",
  },
  "darwin-x64": {
    archive: "actionlint_1.7.12_darwin_amd64.tar.gz",
    sha256: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
    executable: "actionlint",
  },
  "linux-arm64": {
    archive: "actionlint_1.7.12_linux_arm64.tar.gz",
    sha256: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
    executable: "actionlint",
  },
  "linux-x64": {
    archive: "actionlint_1.7.12_linux_amd64.tar.gz",
    sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
    executable: "actionlint",
  },
  "win32-arm64": {
    archive: "actionlint_1.7.12_windows_arm64.zip",
    sha256: "cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41",
    executable: "actionlint.exe",
  },
  "win32-x64": {
    archive: "actionlint_1.7.12_windows_amd64.zip",
    sha256: "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9",
    executable: "actionlint.exe",
  },
}

const isWorkflow = (file: string) => file.endsWith(".yml") || file.endsWith(".yaml")

export function workflowDrift(expected: Iterable<string>, actual: Iterable<string>) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const errors: string[] = []
  for (const file of [...actualSet].filter((item) => !expectedSet.has(item)).sort()) {
    errors.push(`unexpected workflow: ${file} — if this was added intentionally, add it to script/check-workflows.ts`)
  }
  for (const file of [...expectedSet].filter((item) => !actualSet.has(item)).sort()) {
    errors.push(
      `expected workflow not found: ${file} — if this was removed intentionally, remove it from script/check-workflows.ts`,
    )
  }
  return errors
}

export function actionlintAsset(platform = process.platform, arch = process.arch) {
  const asset = ACTIONLINT_ASSETS[`${platform}-${arch}`]
  if (!asset) throw new Error(`actionlint ${ACTIONLINT_VERSION} does not support ${platform}/${arch}`)
  return asset
}

export function verifySha256(bytes: Uint8Array, expected: string) {
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== expected) throw new Error(`actionlint archive checksum mismatch: expected ${expected}, got ${actual}`)
  return actual
}

export const runCommand: CommandRunner = async (command, args, cwd) => {
  const process = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { exitCode, stdout, stderr }
}

export async function verifyActionlintVersion(binary: string, runner: CommandRunner = runCommand) {
  const result = await runner(binary, ["-version"], ROOT)
  if (result.exitCode !== 0) {
    throw new Error(`actionlint version check failed: ${(result.stderr || result.stdout).trim()}`)
  }
  const reported = (result.stdout || result.stderr).trim().split(/\s+/, 1)[0]?.replace(/^v/, "")
  if (reported !== ACTIONLINT_VERSION) {
    throw new Error(`actionlint ${ACTIONLINT_VERSION} is required, but ${reported || "an unknown version"} was found`)
  }
  return reported
}

export async function downloadActionlintArchive(asset: ActionlintAsset, fetcher: typeof fetch = fetch, attempts = 3) {
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${asset.archive}`
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { redirect: "follow" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      verifySha256(bytes, asset.sha256)
      return bytes
    } catch (error) {
      lastError = error
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `failed to download verified actionlint ${ACTIONLINT_VERSION} after ${attempts} attempt(s): ${detail}`,
  )
}

async function extractArchive(archivePath: string, destination: string, runner: CommandRunner = runCommand) {
  const result = await runner("tar", ["-xf", archivePath, "-C", destination], ROOT)
  if (result.exitCode !== 0) {
    throw new Error(`failed to extract actionlint: ${(result.stderr || result.stdout).trim()}`)
  }
}

export async function ensureActionlint(
  options: {
    platform?: NodeJS.Platform
    arch?: string
    cacheDir?: string
    binary?: string
    fetcher?: typeof fetch
    runner?: CommandRunner
  } = {},
) {
  const runner = options.runner ?? runCommand
  const configuredBinary = options.binary ?? process.env.ACTIONLINT_BIN
  if (configuredBinary) {
    await verifyActionlintVersion(configuredBinary, runner)
    return configuredBinary
  }

  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const asset = actionlintAsset(platform, arch)
  const cacheRoot =
    options.cacheDir ?? process.env.ACTIONLINT_CACHE_DIR ?? path.join(os.homedir(), ".cache", "kilo-code", "actionlint")
  const targetDir = path.join(cacheRoot, `v${ACTIONLINT_VERSION}`, `${platform}-${arch}`)
  const binary = path.join(targetDir, asset.executable)
  if (existsSync(binary)) {
    await verifyActionlintVersion(binary, runner)
    return binary
  }

  await mkdir(targetDir, { recursive: true })
  const staging = await mkdtemp(path.join(targetDir, "download-"))
  try {
    const bytes = await downloadActionlintArchive(asset, options.fetcher)
    const archivePath = path.join(staging, asset.archive)
    await writeFile(archivePath, bytes)
    await extractArchive(archivePath, staging, runner)
    const extracted = path.join(staging, asset.executable)
    if (!existsSync(extracted)) throw new Error(`actionlint archive did not contain ${asset.executable}`)
    await chmod(extracted, 0o755)
    await verifyActionlintVersion(extracted, runner)
    const pending = `${binary}.${randomUUID()}.pending`
    await copyFile(extracted, pending)
    await chmod(pending, 0o755)
    await rename(pending, binary)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  await verifyActionlintVersion(binary, runner)
  return binary
}

export async function runActionlint(
  binary: string,
  workflowFiles: string[],
  cwd = ROOT,
  runner: CommandRunner = runCommand,
) {
  const result = await runner(binary, ["-no-color", "-shellcheck", "", "-pyflakes", "", ...workflowFiles], cwd)
  if (result.exitCode !== 0) {
    throw new Error(`GitHub Actions validation failed:\n${(result.stderr || result.stdout).trim()}`)
  }
}

export async function checkWorkflows() {
  const workflowFiles = readdirSync(WORKFLOW_DIR).filter(isWorkflow).sort()
  const errors = workflowDrift(ACTIVE_WORKFLOWS, workflowFiles)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    throw new Error(
      `Found ${errors.length} workflow drift issue(s). This guard prevents upstream-merged workflows from silently running in CI.`,
    )
  }
  console.log(`check-workflows: allowlist ok (${workflowFiles.length} workflows).`)

  const binary = await ensureActionlint()
  const relativeFiles = workflowFiles.map((file) => path.join(".github", "workflows", file))
  await runActionlint(binary, relativeFiles)
  console.log(`check-workflows: actionlint ${ACTIONLINT_VERSION} ok (${workflowFiles.length} workflows).`)
}

if (import.meta.main) {
  checkWorkflows().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
