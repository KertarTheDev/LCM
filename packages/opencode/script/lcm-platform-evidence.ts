// kilocode_change - new file
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import type { LcmDbSmokeRuntimeMode } from "../src/session/lcm/types"

export const LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION = "lcm-platform-packaged-runtime-smoke-v1"
export const REQUIRED_PLATFORM_EVIDENCE_TARGETS = ["windows", "darwin-arm64", "darwin-x64"] as const

export type LcmPlatformEvidenceTarget =
  | (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number]
  | "linux-x64"
  | "linux-arm64"

export interface LcmPlatformPackagedRuntimeSmokeEvidence {
  readonly schemaVersion: typeof LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION
  readonly target: LcmPlatformEvidenceTarget
  readonly generatedAt: string
  readonly os: {
    readonly platform: string
    readonly arch: string
    readonly type: string
    readonly release: string
  }
  readonly artifact: {
    readonly runtimePath: string
    readonly runtimeSha256?: string
    readonly snapshotPath?: string
    readonly snapshotSha256?: string
    readonly gitHead?: string
  }
  readonly runtimeSmoke: {
    readonly command: string
    readonly code: number
    readonly runtimeMode: LcmDbSmokeRuntimeMode
    readonly dataDir: string
    readonly status: "passed" | "failed"
    readonly stderrTail?: string
    readonly report: unknown
  }
}

export interface PlatformEvidenceValidationResult {
  readonly status: "passed" | "failed" | "blocked"
  readonly actual: string
  readonly evidenceFiles: readonly string[]
  readonly missingTargets: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidTarget(value: unknown): value is LcmPlatformEvidenceTarget {
  return (
    value === "windows" ||
    value === "darwin-arm64" ||
    value === "darwin-x64" ||
    value === "linux-x64" ||
    value === "linux-arm64"
  )
}

function isRuntimeMode(value: unknown): value is LcmDbSmokeRuntimeMode {
  return value === "source" || value === "compiled-bin" || value === "serve" || value === "vscode-bundled"
}

function reportStatus(report: unknown) {
  return isRecord(report) && typeof report.status === "string" ? report.status : undefined
}

function targetOsMismatch(target: LcmPlatformEvidenceTarget, os: Record<string, unknown>) {
  const platform = typeof os.platform === "string" ? os.platform : ""
  const arch = typeof os.arch === "string" ? os.arch : ""
  if (target === "windows") return platform === "win32" ? undefined : "windows evidence must come from win32"
  if (target === "darwin-arm64") {
    return platform === "darwin" && arch === "arm64" ? undefined : "darwin-arm64 evidence must come from darwin arm64"
  }
  if (target === "darwin-x64") {
    return platform === "darwin" && arch === "x64" ? undefined : "darwin-x64 evidence must come from darwin x64"
  }
  if (target === "linux-arm64") {
    return platform === "linux" && arch === "arm64" ? undefined : "linux-arm64 evidence must come from linux arm64"
  }
  return platform === "linux" && arch === "x64" ? undefined : "linux-x64 evidence must come from linux x64"
}

function validateEvidencePayload(input: {
  payload: unknown
  file: string
  expectedSnapshotSha256?: string
  requiredTargets: readonly string[]
}): { target?: LcmPlatformEvidenceTarget; errors: string[] } {
  const { payload, file, expectedSnapshotSha256, requiredTargets } = input
  const errors: string[] = []
  if (!isRecord(payload)) return { errors: [`${file}: evidence is not a JSON object`] }

  if (payload.schemaVersion !== LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`${file}: schemaVersion must be ${LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION}`)
  }

  const target = payload.target
  if (!isValidTarget(target)) {
    errors.push(`${file}: target is missing or unsupported`)
  } else if (!requiredTargets.includes(target)) {
    return { target, errors: [] }
  }

  if (!isNonEmptyString(payload.generatedAt)) errors.push(`${file}: generatedAt is required`)

  const artifact = payload.artifact
  if (!isRecord(artifact)) {
    errors.push(`${file}: artifact is required`)
  } else {
    if (!isNonEmptyString(artifact.runtimePath)) errors.push(`${file}: artifact.runtimePath is required`)
    if (artifact.runtimeSha256 !== undefined && !isNonEmptyString(artifact.runtimeSha256)) {
      errors.push(`${file}: artifact.runtimeSha256 must be a non-empty string when present`)
    }
    if (expectedSnapshotSha256) {
      if (!isNonEmptyString(artifact.snapshotSha256)) {
        errors.push(`${file}: artifact.snapshotSha256 is required for the candidate VSIX`)
      } else if (artifact.snapshotSha256 !== expectedSnapshotSha256) {
        errors.push(`${file}: artifact.snapshotSha256 does not match the candidate VSIX`)
      }
    }
  }

  const os = payload.os
  if (!isRecord(os)) {
    errors.push(`${file}: os is required`)
  } else {
    for (const key of ["platform", "arch", "type", "release"] as const) {
      if (!isNonEmptyString(os[key])) errors.push(`${file}: os.${key} is required`)
    }
    if (isValidTarget(target)) {
      const mismatch = targetOsMismatch(target, os)
      if (mismatch) errors.push(`${file}: ${mismatch}`)
    }
  }

  const runtimeSmoke = payload.runtimeSmoke
  if (!isRecord(runtimeSmoke)) {
    errors.push(`${file}: runtimeSmoke is required`)
  } else {
    if (!isNonEmptyString(runtimeSmoke.command)) errors.push(`${file}: runtimeSmoke.command is required`)
    if (!String(runtimeSmoke.command ?? "").includes("debug lcm-db-smoke")) {
      errors.push(`${file}: runtimeSmoke.command must run debug lcm-db-smoke`)
    }
    if (runtimeSmoke.code !== 0) errors.push(`${file}: runtimeSmoke.code must be 0`)
    if (!isRuntimeMode(runtimeSmoke.runtimeMode)) errors.push(`${file}: runtimeSmoke.runtimeMode is invalid`)
    if (!isNonEmptyString(runtimeSmoke.dataDir)) errors.push(`${file}: runtimeSmoke.dataDir is required`)
    if (runtimeSmoke.status !== "passed") errors.push(`${file}: runtimeSmoke.status must be passed`)
    if (reportStatus(runtimeSmoke.report) !== "passed") {
      errors.push(`${file}: runtimeSmoke.report.status must be passed`)
    }
  }

  return { target: isValidTarget(target) ? target : undefined, errors }
}

export async function validatePlatformPackagedRuntimeEvidence(input: {
  evidenceDir?: string
  expectedSnapshotSha256?: string
  requiredTargets?: readonly (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number][]
}): Promise<PlatformEvidenceValidationResult> {
  const requiredTargets = input.requiredTargets ?? REQUIRED_PLATFORM_EVIDENCE_TARGETS
  if (!input.evidenceDir || !existsSync(input.evidenceDir)) {
    return {
      status: "blocked",
      actual: "External platform evidence directory was not provided.",
      evidenceFiles: [],
      missingTargets: requiredTargets,
    }
  }

  const entries = await fs.readdir(input.evidenceDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(input.evidenceDir!, entry.name))
    .sort()
  const validByTarget = new Map<string, string>()
  const invalid: string[] = []

  for (const file of jsonFiles) {
    let payload: unknown
    try {
      payload = await Bun.file(file).json()
    } catch {
      const filename = path.basename(file)
      if (requiredTargets.some((target) => filename.includes(target))) invalid.push(`${file}: invalid JSON`)
      continue
    }

    const record = isRecord(payload) ? payload : undefined
    const target = record?.target
    const filename = path.basename(file)
    const looksLikePlatformEvidence =
      record?.schemaVersion === LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION ||
      (typeof target === "string" &&
        requiredTargets.includes(target as (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number])) ||
      requiredTargets.some((required) => filename.includes(required))
    if (!looksLikePlatformEvidence) continue

    const result = validateEvidencePayload({
      payload,
      file,
      expectedSnapshotSha256: input.expectedSnapshotSha256,
      requiredTargets,
    })
    if (result.errors.length > 0) {
      invalid.push(...result.errors)
      continue
    }
    if (
      result.target &&
      requiredTargets.includes(result.target as (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number])
    ) {
      validByTarget.set(result.target, file)
    }
  }

  const missingTargets = requiredTargets.filter((target) => !validByTarget.has(target))
  if (invalid.length > 0) {
    return {
      status: "failed",
      actual: `Invalid platform evidence: ${invalid.slice(0, 6).join("; ")}${invalid.length > 6 ? "; ..." : ""}`,
      evidenceFiles: [...validByTarget.values()],
      missingTargets,
    }
  }
  if (missingTargets.length > 0) {
    return {
      status: "blocked",
      actual: `Missing valid platform evidence for: ${missingTargets.join(", ")}`,
      evidenceFiles: [...validByTarget.values()],
      missingTargets,
    }
  }
  return {
    status: "passed",
    actual: `Valid platform packaged-runtime evidence recorded for: ${requiredTargets.join(", ")}`,
    evidenceFiles: requiredTargets.map((target) => validByTarget.get(target)!),
    missingTargets: [],
  }
}
