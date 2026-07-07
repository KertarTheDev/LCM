// kilocode_change - new file
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { RUNTIME_DEFAULTS } from "./config"
import { LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION } from "./token-budget"
import { validateArtifactPath } from "./validators"
import { createLcmSafeError, type LcmFileID, type LcmFileSourceKind, type LcmTokenCounterMode } from "./types"

export const LCM_LARGE_FILE_MARKER_VERSION = "large-file-marker-v1"
export const LCM_LARGE_FILE_TOKEN_COUNTER_MODE = "deterministic_fallback" satisfies LcmTokenCounterMode
export const LCM_LARGE_FILE_TOKEN_COUNTER_VERSION = LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION

const SHA256_HEX = /^[a-f0-9]{64}$/

export interface LcmArtifactWriteResult {
  readonly artifactPath: string
  readonly byteCount: number
  readonly sha256: string
}

export interface LcmArtifactValidationResult extends LcmArtifactWriteResult {
  readonly bytes: Buffer
}

export interface LcmLargeFileMarkerInput {
  readonly fileID: LcmFileID
  readonly sourceKind: LcmFileSourceKind | string
  readonly byteCount: number
  readonly sha256: string
  readonly explorationStatus: string
  readonly previewText?: string | null
}

function invalidRequest(diagnosticCode: string) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

function sha256Hex(bytes: Buffer | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function ensureSha256(value: string) {
  if (!SHA256_HEX.test(value)) throw invalidRequest("lcm_artifact_invalid_sha256")
}

export function artifactPathForSha256(sha256: string) {
  ensureSha256(sha256)
  return `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.bin`
}

export function resolveArtifactPath(input: { artifactRoot: string; artifactPath: string }) {
  const validation = validateArtifactPath(input.artifactPath)
  if (!validation.ok) throw invalidRequest(`lcm_artifact_${validation.reason ?? "path_invalid"}`)
  const root = path.resolve(input.artifactRoot)
  const target = path.resolve(root, input.artifactPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw invalidRequest("lcm_artifact_path_escape")
  }
  return target
}

async function readExistingArtifact(input: {
  artifactRoot: string
  artifactPath: string
  sha256: string
  byteCount: number
}) {
  const target = resolveArtifactPath({ artifactRoot: input.artifactRoot, artifactPath: input.artifactPath })
  let bytes: Buffer
  try {
    bytes = Buffer.from(await fs.readFile(target))
  } catch {
    return undefined
  }
  if (bytes.byteLength !== input.byteCount) return undefined
  if (sha256Hex(bytes) !== input.sha256) return undefined
  return bytes
}

export async function writeLcmArtifact(input: {
  readonly artifactRoot: string
  readonly bytes: Buffer | Uint8Array
}): Promise<LcmArtifactWriteResult> {
  const bytes = Buffer.from(input.bytes)
  if (bytes.byteLength === 0) throw invalidRequest("lcm_artifact_empty_payload")
  const sha256 = sha256Hex(bytes)
  const artifactPath = artifactPathForSha256(sha256)
  const existing = await readExistingArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath,
    sha256,
    byteCount: bytes.byteLength,
  })
  if (existing) {
    return { artifactPath, byteCount: bytes.byteLength, sha256 }
  }

  const target = resolveArtifactPath({ artifactRoot: input.artifactRoot, artifactPath })
  const tmpDir = path.join(path.resolve(input.artifactRoot), "tmp")
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.mkdir(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `${sha256}.${randomBytes(8).toString("hex")}.tmp`)
  try {
    await fs.writeFile(tmpPath, bytes)
    const written = Buffer.from(await fs.readFile(tmpPath))
    if (written.byteLength !== bytes.byteLength || sha256Hex(written) !== sha256) {
      throw invalidRequest("lcm_artifact_write_verification_failed")
    }
    await fs.rename(tmpPath, target)
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }

  const verified = await readExistingArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath,
    sha256,
    byteCount: bytes.byteLength,
  })
  if (!verified) throw invalidRequest("lcm_artifact_final_verification_failed")
  return { artifactPath, byteCount: bytes.byteLength, sha256 }
}

export async function readAndValidateLcmArtifact(input: {
  readonly artifactRoot: string
  readonly artifactPath: string
  readonly byteCount: number
  readonly sha256: string
}): Promise<{ ok: true; value: LcmArtifactValidationResult } | { ok: false; reason: string }> {
  const pathValidation = validateArtifactPath(input.artifactPath)
  if (!pathValidation.ok) return { ok: false, reason: pathValidation.reason ?? "artifact_path_invalid" }
  if (!SHA256_HEX.test(input.sha256)) return { ok: false, reason: "artifact_hash_invalid" }
  let bytes: Buffer
  try {
    bytes = Buffer.from(
      await fs.readFile(resolveArtifactPath({ artifactRoot: input.artifactRoot, artifactPath: input.artifactPath })),
    )
  } catch {
    return { ok: false, reason: "artifact_missing" }
  }
  if (bytes.byteLength !== input.byteCount) return { ok: false, reason: "artifact_size_mismatch" }
  const digest = sha256Hex(bytes)
  if (digest !== input.sha256) return { ok: false, reason: "artifact_hash_mismatch" }
  return {
    ok: true,
    value: {
      artifactPath: input.artifactPath,
      byteCount: bytes.byteLength,
      sha256: digest,
      bytes,
    },
  }
}

export async function cleanupLcmArtifactTemps(artifactRoot: string) {
  await fs.rm(path.join(path.resolve(artifactRoot), "tmp"), { recursive: true, force: true }).catch(() => undefined)
}

export function createPreviewText(input: { bytes: Buffer | Uint8Array; maxBytes?: number }) {
  const maxBytes = input.maxBytes ?? RUNTIME_DEFAULTS.largePayloads.previewBytes
  if (maxBytes <= 0) return ""
  return Buffer.from(input.bytes).subarray(0, maxBytes).toString("utf8")
}

export function estimateLargePayloadTokens(text: string) {
  return Math.ceil(text.length / 4)
}

export function renderLargeFileMarker(input: LcmLargeFileMarkerInput) {
  return [
    `[File ID: ${input.fileID}]`,
    `[Source Kind: ${input.sourceKind}]`,
    `[Bytes: ${input.byteCount}]`,
    `[SHA-256: ${input.sha256}]`,
    `[Exploration: ${input.explorationStatus}]`,
    "[Recovery: root sessions use lcm_expand_query with this File ID; lcm_read requires child/explore/map access]",
    "",
    "[Preview]",
    input.previewText ?? "",
  ].join("\n")
}
