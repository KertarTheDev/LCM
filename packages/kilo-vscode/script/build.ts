#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { existsSync, mkdirSync, rmSync, chmodSync } from "node:fs"
import { copyTreeSitterResources } from "../src/services/cli-backend/cli-resources"
import { ensureFfmpegForTarget } from "./ffmpeg-helper"

const packageJsonPath = join(import.meta.dir, "..", "package.json")
const packageJson = await Bun.file(packageJsonPath).json()
const version = process.env.KILO_VERSION ? process.env.KILO_VERSION : packageJson.version
const prerelease = process.env.KILO_PRE_RELEASE === "true"

console.log(`Building VSCode extension version: ${version}${prerelease ? " (pre-release)" : ""}`)

if (packageJson.version !== version) {
  console.log(`Updating package.json version from ${packageJson.version} to ${version}`)
  packageJson.version = version
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
}

const cliDistDir = process.env.CLI_DIST_DIR || join(import.meta.dir, "..", "..", "opencode", "dist")
console.log(`Using CLI dist directory: ${cliDistDir}`)

if (!existsSync(cliDistDir)) {
  throw new Error(`CLI dist directory not found: ${cliDistDir}`)
}

type TargetConfig = {
  target: string
  cliDir: string
  binary: string
}

const allTargets: TargetConfig[] = [
  { target: "linux-x64", cliDir: "@kilocode/cli-linux-x64", binary: "kilo" },
  { target: "linux-arm64", cliDir: "@kilocode/cli-linux-arm64", binary: "kilo" },
  { target: "alpine-x64", cliDir: "@kilocode/cli-linux-x64-musl", binary: "kilo" },
  { target: "alpine-arm64", cliDir: "@kilocode/cli-linux-arm64-musl", binary: "kilo" },
  { target: "darwin-x64", cliDir: "@kilocode/cli-darwin-x64", binary: "kilo" },
  { target: "darwin-arm64", cliDir: "@kilocode/cli-darwin-arm64", binary: "kilo" },
  { target: "win32-x64", cliDir: "@kilocode/cli-windows-x64", binary: "kilo.exe" },
  { target: "win32-arm64", cliDir: "@kilocode/cli-windows-arm64", binary: "kilo.exe" },
]

function selectedTargetNames() {
  const names: string[] = []
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === "--target") {
      const value = process.argv[i + 1]
      if (!value || value.startsWith("-")) {
        throw new Error("--target requires a VSIX target name")
      }
      names.push(value)
      i++
      continue
    }
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length)
      if (!value) {
        throw new Error("--target requires a VSIX target name")
      }
      names.push(value)
    }
  }
  return [...new Set(names)]
}

const requestedTargets = selectedTargetNames()
const targets =
  requestedTargets.length === 0 ? allTargets : allTargets.filter((config) => requestedTargets.includes(config.target))

const missingTargets = requestedTargets.filter((target) => !allTargets.some((config) => config.target === target))
if (missingTargets.length > 0) {
  throw new Error(
    `Unknown VSIX target(s): ${missingTargets.join(", ")}. Valid targets: ${allTargets
      .map((config) => config.target)
      .join(", ")}`,
  )
}

if (requestedTargets.length > 0) {
  console.log(`Building selected VSIX target(s): ${targets.map((config) => config.target).join(", ")}`)
}

const binDir = join(import.meta.dir, "..", "bin")
const distDir = join(import.meta.dir, "..", "dist")
const outDir = join(import.meta.dir, "..", "out")
const buildStateDir = process.env.KILO_VSCODE_BUILD_STATE_DIR ?? join(outDir, ".build-state")
const buildEnv = {
  ...process.env,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(buildStateDir, "data"),
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(buildStateDir, "cache"),
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? join(buildStateDir, "config"),
  XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? join(buildStateDir, "state"),
}

console.log("\n🧹 Cleaning up directories...")
for (const dir of [binDir, distDir, outDir]) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ✓ Cleaned ${dir}`)
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(distDir, { recursive: true })

console.log("\n🔄 Rebuilding SDK types (ensures dist/ is in sync with server API)...")
await $`bun run --cwd ${join(import.meta.dir, "..", "..", "sdk", "js")} build`.env(buildEnv)

console.log("\n📦 Compiling extension...")
await $`bun run check-types`.env(buildEnv)
await $`bun run lint`.env(buildEnv)
await $`node ${join(import.meta.dir, "..", "esbuild.js")} --production`.env(buildEnv)

for (const config of targets) {
  console.log(`\n🎯 Processing target: ${config.target}`)

  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
  }
  mkdirSync(binDir, { recursive: true })

  const sourceBinary = join(cliDistDir, config.cliDir, "bin", config.binary)
  const targetBinary = join(binDir, config.binary)

  if (!existsSync(sourceBinary)) {
    throw new Error(`CLI binary not found at ${sourceBinary}`)
  }

  console.log(`  📥 Copying binary from ${config.cliDir}/bin/${config.binary}...`)
  await $`cp ${sourceBinary} ${targetBinary}`
  await copyTreeSitterResources(sourceBinary, targetBinary)

  if (config.binary !== "kilo.exe") {
    chmodSync(targetBinary, 0o755)
  }

  console.log(`  ✅ Binary ready at ${targetBinary}`)

  console.log("Adding bundled FFmpeg helper...")
  await ensureFfmpegForTarget(config.target, binDir)

  console.log(`  📦 Packaging .vsix for ${config.target}${prerelease ? " (pre-release)" : ""}...`)
  const vsixPath = join(outDir, `kilo-vscode-${config.target}.vsix`)
  const args = ["--no-dependencies", "--skip-license", "--target", config.target, "-o", vsixPath]
  if (prerelease) args.push("--pre-release")
  await $`bunx vsce package ${args}`.env({
    ...buildEnv,
    npm_config_ignore_scripts: "true",
  })
  console.log(`  ✅ Created ${vsixPath}`)
}

console.log("\n✨ All VSIX packages built successfully!")
