// kilocode_change - new file
import path from "node:path"
import { createLcmSafeError, type LcmFileID, type LcmFileStaleState, type LcmSafeError } from "./types"
import { isCompleteBoundaryMetadataV1, type LcmBoundaryMetadataV1 } from "./validators"

export interface LcmPathBackedFileRecord {
  readonly fileID: LcmFileID
  readonly sourceKind: "path" | string
  readonly originalPath?: string | null
  readonly canonicalPath?: string | null
  readonly pathSizeBytes?: number | null
  readonly pathMtimeMs?: number | null
  readonly pathContentSha256?: string | null
  readonly pathHashMode?: "full" | "not_computed" | string | null
  readonly boundaryMetadata?: unknown
}

export interface LcmObservedPathState {
  readonly canonicalPath: string
  readonly sizeBytes: number
  readonly mtimeMs: number
  readonly contentSha256: string
  readonly permission: "allowed" | "denied"
  readonly symlinkRetargeted?: boolean
}

export type LcmPathProvenanceResult =
  | {
      readonly ok: true
      readonly fileID: LcmFileID
      readonly staleState: "current"
      readonly boundaryMetadata: LcmBoundaryMetadataV1
      readonly insideBoundary: boolean
    }
  | {
      readonly ok: false
      readonly fileID: LcmFileID
      readonly staleState: LcmFileStaleState
      readonly safeError: LcmSafeError
    }

function failure(input: { fileID: LcmFileID; staleState: LcmFileStaleState; diagnosticCode: string }) {
  return {
    ok: false,
    fileID: input.fileID,
    staleState: input.staleState,
    safeError: createLcmSafeError({
      code: input.staleState === "permission_denied" ? "unauthorized" : "missing_source",
      templateKey: "lcm.recovery.missing_source",
      safeParams: { action: "repeat_input" },
      retryable: false,
      diagnosticCode: input.diagnosticCode,
    }),
  } satisfies LcmPathProvenanceResult
}

function platformPath(boundary: LcmBoundaryMetadataV1) {
  return boundary.platformPathFlavor === "win32" ? path.win32 : path.posix
}

function normalizeForCompare(value: string, boundary: LcmBoundaryMetadataV1) {
  const parsed = platformPath(boundary).normalize(value)
  return boundary.caseSensitivity === "insensitive" ? parsed.toLocaleLowerCase() : parsed
}

function pathInsideRoot(input: {
  readonly canonicalPath: string
  readonly root: string
  readonly boundary: LcmBoundaryMetadataV1
}) {
  const p = platformPath(input.boundary)
  const file = normalizeForCompare(input.canonicalPath, input.boundary)
  const root = normalizeForCompare(input.root, input.boundary)
  if (file === root) return true
  const relative = p.relative(root, file)
  return relative.length > 0 && !relative.startsWith("..") && !p.isAbsolute(relative)
}

export function isCanonicalPathInsideBoundary(input: {
  readonly canonicalPath: string
  readonly boundaryMetadata: LcmBoundaryMetadataV1
}) {
  return input.boundaryMetadata.allowedRootCanonicals.some((root) =>
    pathInsideRoot({ canonicalPath: input.canonicalPath, root, boundary: input.boundaryMetadata }),
  )
}

function isFiniteInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

export function validateRegisteredPathRecord(record: LcmPathBackedFileRecord): LcmPathProvenanceResult {
  if (record.sourceKind !== "path") {
    return failure({
      fileID: record.fileID,
      staleState: "unknown",
      diagnosticCode: "lcm_path_provenance_not_path_record",
    })
  }
  if (
    !record.originalPath ||
    !record.canonicalPath ||
    !isFiniteInteger(record.pathSizeBytes) ||
    !isFiniteInteger(record.pathMtimeMs) ||
    !record.pathContentSha256 ||
    record.pathHashMode !== "full" ||
    !isCompleteBoundaryMetadataV1(record.boundaryMetadata)
  ) {
    return failure({
      fileID: record.fileID,
      staleState: "unknown",
      diagnosticCode: "lcm_path_provenance_incomplete_registration",
    })
  }
  const boundary = record.boundaryMetadata
  const insideBoundary = isCanonicalPathInsideBoundary({
    canonicalPath: record.canonicalPath!,
    boundaryMetadata: boundary,
  })
  return {
    ok: true,
    fileID: record.fileID,
    staleState: "current",
    boundaryMetadata: boundary,
    insideBoundary,
  }
}

export function validateObservedPathState(
  record: LcmPathBackedFileRecord,
  observed: LcmObservedPathState,
): LcmPathProvenanceResult {
  const registered = validateRegisteredPathRecord(record)
  if (!registered.ok) return registered
  const boundary = registered.boundaryMetadata
  if (observed.permission === "denied") {
    return failure({
      fileID: record.fileID,
      staleState: "permission_denied",
      diagnosticCode: "lcm_path_provenance_permission_denied",
    })
  }
  if (observed.symlinkRetargeted) {
    return failure({
      fileID: record.fileID,
      staleState: "symlink_retargeted",
      diagnosticCode: "lcm_path_provenance_symlink_retargeted",
    })
  }
  if (normalizeForCompare(observed.canonicalPath, boundary) !== normalizeForCompare(record.canonicalPath!, boundary)) {
    return failure({
      fileID: record.fileID,
      staleState: "moved",
      diagnosticCode: "lcm_path_provenance_canonical_path_mismatch",
    })
  }
  if (observed.sizeBytes !== record.pathSizeBytes) {
    return failure({
      fileID: record.fileID,
      staleState: "size_mismatch",
      diagnosticCode: "lcm_path_provenance_size_mismatch",
    })
  }
  if (observed.mtimeMs !== record.pathMtimeMs) {
    return failure({
      fileID: record.fileID,
      staleState: "mtime_mismatch",
      diagnosticCode: "lcm_path_provenance_mtime_mismatch",
    })
  }
  if (observed.contentSha256 !== record.pathContentSha256) {
    return failure({
      fileID: record.fileID,
      staleState: "hash_mismatch",
      diagnosticCode: "lcm_path_provenance_hash_mismatch",
    })
  }
  return registered
}
