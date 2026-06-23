#!/usr/bin/env bun
// kilocode_change - new file
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { resolveLcmFamilyRoot } from "../src/session/lcm/db-layout"
import { deriveLcmFamilyID } from "../src/session/lcm/family"
import type { LcmDbSmokeRuntimeMode } from "../src/session/lcm/types"
import {
  LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION,
  type LcmPlatformEvidenceTarget,
  type LcmPlatformPackagedRuntimeSmokeEvidence,
} from "./lcm-platform-evidence"

const packageRoot = path.resolve(import.meta.dir, "..")

function arg(name: string) {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index >= 0) return process.argv[index + 1]
  const prefix = `${flag}=`
  const match = process.argv.find((item) => item.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function inferTarget(): LcmPlatformEvidenceTarget {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64"
  return "linux-x64"
}

function isTarget(value: string): value is LcmPlatformEvidenceTarget {
  return ["windows", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"].includes(value)
}

function isRuntimeMode(value: string): value is LcmDbSmokeRuntimeMode {
  return value === "source" || value === "compiled-bin" || value === "serve" || value === "vscode-bundled"
}

function parseTargetArg(value: string | undefined): LcmPlatformEvidenceTarget {
  const inferred = inferTarget()
  if (!value) return inferred
  if (isTarget(value)) return value
  console.error("--target must be one of windows, darwin-arm64, darwin-x64, linux-x64, linux-arm64")
  process.exit(2)
  throw new Error("unreachable")
}

function parseRuntimeModeArg(value: string | undefined): LcmDbSmokeRuntimeMode {
  if (!value) return "vscode-bundled"
  if (isRuntimeMode(value)) return value
  console.error("--runtime-mode must be one of source, compiled-bin, serve, vscode-bundled")
  process.exit(2)
  throw new Error("unreachable")
}

async function ensureDir(target: string) {
  await fs.mkdir(target, { recursive: true })
}

async function sha256File(file: string) {
  const bytes = Buffer.from(await Bun.file(file).arrayBuffer())
  return createHash("sha256").update(bytes).digest("hex")
}

async function gitHead() {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: path.resolve(packageRoot, "../.."),
    stdout: "pipe",
    stderr: "ignore",
  })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return code === 0 ? stdout.trim() : undefined
}

async function main() {
  const target = parseTargetArg(arg("target"))
  if (target !== inferTarget()) {
    console.error(`--target ${target} does not match this host (${inferTarget()})`)
    process.exit(2)
  }
  const runtimePathArg = arg("runtime-path")
  if (!runtimePathArg) {
    console.error("--runtime-path must point to the packaged kilo runtime binary")
    process.exit(2)
  }
  const runtimePath = path.resolve(runtimePathArg)
  if (!existsSync(runtimePath)) {
    console.error("--runtime-path must point to the packaged kilo runtime binary")
    process.exit(2)
  }

  const snapshotPath = arg("snapshot-path")
  const runtimeMode = parseRuntimeModeArg(arg("runtime-mode"))
  const outDir = path.resolve(
    arg("out-dir") ??
      process.env.LCM_PLATFORM_EVIDENCE_DIR ??
      path.join(packageRoot, ".artifacts", "platform-evidence"),
  )
  const kiloDataDir = path.resolve(arg("kilo-data-dir") ?? path.join(outDir, "kilo-data", target))
  const dataDir = path.resolve(
    arg("data-dir") ??
      resolveLcmFamilyRoot({
        kiloDataDir,
        familyID: deriveLcmFamilyID(`ses_platform_packaged_runtime_${target}`),
      }),
  )
  await ensureDir(outDir)
  await ensureDir(dataDir)

  const xdgRoot = path.join(outDir, "xdg", target)
  await ensureDir(xdgRoot)

  const cmd = [runtimePath, "debug", "lcm-db-smoke", "--data-dir", dataDir, "--runtime-mode", runtimeMode, "--json"]
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
    },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  let report: unknown = stdout.trim()
  try {
    report = JSON.parse(stdout)
  } catch {
    // Keep stdout as the captured payload so a failure can still be diagnosed without raw DB content.
  }
  const reportStatus =
    typeof report === "object" && report !== null && "status" in report
      ? (report as { readonly status?: unknown }).status
      : undefined

  const evidence: LcmPlatformPackagedRuntimeSmokeEvidence = {
    schemaVersion: LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION,
    target,
    generatedAt: new Date().toISOString(),
    os: {
      platform: process.platform,
      arch: process.arch,
      type: os.type(),
      release: os.release(),
    },
    artifact: {
      runtimePath,
      runtimeSha256: await sha256File(runtimePath),
      ...(snapshotPath
        ? { snapshotPath: path.resolve(snapshotPath), snapshotSha256: await sha256File(snapshotPath) }
        : {}),
      ...(await gitHead().then((head) => (head ? { gitHead: head } : {}))),
    },
    runtimeSmoke: {
      command: cmd.join(" "),
      code,
      runtimeMode,
      dataDir,
      status: code === 0 && reportStatus === "passed" ? "passed" : "failed",
      stderrTail: stderr.slice(-2_000),
      report,
    },
  }

  const outPath = path.join(outDir, `platform-packaged-runtime-smoke-${target}.json`)
  await Bun.write(outPath, JSON.stringify(evidence, null, 2) + "\n")
  console.log(`platform packaged-runtime evidence: ${outPath}`)
  console.log(`result: ${evidence.runtimeSmoke.status}`)
  if (evidence.runtimeSmoke.status !== "passed") process.exit(1)
}

await main()
