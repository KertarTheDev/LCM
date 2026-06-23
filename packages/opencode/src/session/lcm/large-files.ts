// kilocode_change - new file
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { TextDecoder } from "node:util"
import type { PGlite } from "@electric-sql/pglite"
import { RUNTIME_DEFAULTS } from "./config"
import { allocateStableLcmID } from "./id"
import {
  createPreviewText,
  readAndValidateLcmArtifact,
  writeLcmArtifact,
  type LcmArtifactValidationResult,
} from "./artifacts"
import {
  isCanonicalPathInsideBoundary,
  validateObservedPathState,
  validateRegisteredPathRecord,
  type LcmPathBackedFileRecord,
} from "./path-provenance"
import { parseLcmSafeError } from "./safe-error-schema"
import {
  createLcmSafeError,
  LcmSafeErrorFailure,
  type ConversationID,
  type ContextItemID,
  type LcmFileID,
  type LcmFileSourceKind,
  type LcmFileStaleState,
  type LcmFileStatus,
  type LcmReadResult,
  type LcmSafeError,
} from "./types"
import { isCompleteBoundaryMetadataV1, type LcmBoundaryMetadataV1 } from "./validators"

interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface LcmLargeFileRow {
  readonly conversation_id: ConversationID
  readonly file_id: LcmFileID
  readonly source_kind: LcmFileSourceKind
  readonly original_path: string | null
  readonly canonical_path: string | null
  readonly path_size_bytes: number | string | bigint | null
  readonly path_mtime_ms: number | string | bigint | null
  readonly path_content_sha256: string | null
  readonly path_hash_mode: "full" | "not_computed" | string
  readonly boundary_metadata_json: unknown
  readonly mime_type: string | null
  readonly token_estimate: number | string | bigint | null
  readonly preview_text: string | null
  readonly exploration_status: LcmFileStatus["explorationStatus"]
  readonly exploration_kind: LcmFileStatus["explorerKind"]
  readonly exploration_safe_reason: LcmFileStatus["safeReason"] | null
  readonly exploration_sampled: boolean
  readonly exploration_sample_bytes: number | string | bigint
  readonly exploration_prompt_version: string | null
  readonly exploration_usage_record_id: string | null
  readonly artifact_storage_kind: "none" | "file"
  readonly artifact_path: string | null
  readonly artifact_byte_count: number | string | bigint
  readonly artifact_content_sha256: string | null
}

export interface LcmReadWindow {
  readonly byteOffset: number
  readonly maxBytes: number
}

export interface LcmPathPermissionCheckInput {
  readonly fileID: LcmFileID
  readonly canonicalPath: string
  readonly originalPath: string
  readonly boundaryMetadata: LcmBoundaryMetadataV1
}

export type LcmPathPermissionCheck = (
  input: LcmPathPermissionCheckInput,
) => Promise<"allowed" | "denied"> | "allowed" | "denied"

function asNumber(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined) return 0
  return typeof value === "bigint" ? Number(value) : Number(value)
}

function sha256Hex(bytes: Buffer | Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function toBuffer(bytes: Buffer | Uint8Array | string) {
  return typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes)
}

function stableFileID(input: {
  namespace: string
  conversationID: ConversationID
  sourceKind: LcmFileSourceKind
  stableSeed: string
  sha256: string
}) {
  const digest = createHash("sha256")
    .update(input.namespace, "utf8")
    .update("\0", "utf8")
    .update(input.conversationID, "utf8")
    .update("\0", "utf8")
    .update(input.sourceKind, "utf8")
    .update("\0", "utf8")
    .update(input.stableSeed, "utf8")
    .update("\0", "utf8")
    .update(input.sha256, "utf8")
    .digest("hex")
  return `file_${digest.slice(0, 32)}` as LcmFileID
}

function fileSafeError(input: {
  code?: LcmSafeError["code"]
  fileID: LcmFileID
  staleState: LcmFileStaleState
  diagnosticCode: string
  action?: "re_register_file" | "repeat_input" | "retry"
}) {
  return createLcmSafeError({
    code: input.code ?? (input.staleState === "permission_denied" ? "permission_denied" : "stale_source"),
    templateKey: "lcm.file.stale",
    safeParams: {
      fileID: input.fileID,
      staleState: input.staleState,
      action: input.action ?? (input.staleState.startsWith("artifact_") ? "repeat_input" : "re_register_file"),
    },
    retryable: false,
    diagnosticCode: input.diagnosticCode,
  })
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

function canceled(fileID: LcmFileID) {
  return createLcmSafeError({
    code: "canceled",
    templateKey: "lcm.operation.canceled",
    safeParams: {
      retryable: false,
    },
    retryable: false,
    fileID,
    diagnosticCode: "lcm_file_read_canceled",
  })
}

function pathRegistrationCanceled() {
  return createLcmSafeError({
    code: "canceled",
    templateKey: "lcm.operation.canceled",
    safeParams: { retryable: false },
    retryable: false,
    diagnosticCode: "lcm_path_registration_canceled",
  })
}

function throwIfPathRegistrationCanceled(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) throw pathRegistrationCanceled()
}

function throwIfFileReadCanceled(fileID: LcmFileID, abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) throw canceled(fileID)
}

function streamDestroyError(error: Error | LcmSafeError) {
  return error instanceof Error ? error : new LcmSafeErrorFailure(error)
}

function streamRejectError(error: Error) {
  return error instanceof LcmSafeErrorFailure ? error.safeError : error
}

function isTextLike(sourceKind: LcmFileSourceKind, mimeType?: string | null) {
  if (
    sourceKind === "inline" ||
    sourceKind === "tool_output" ||
    sourceKind === "map_input" ||
    sourceKind === "map_output"
  ) {
    return true
  }
  const mime = mimeType?.toLocaleLowerCase()
  if (!mime) return false
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/ecmascript" ||
    mime === "application/typescript" ||
    mime === "application/x-javascript" ||
    mime === "application/x-typescript" ||
    mime === "application/jsonl" ||
    mime === "application/x-ndjson" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  )
}

function encodeWindow(input: { bytes: Buffer; sourceKind: LcmFileSourceKind; mimeType?: string | null }) {
  if (isTextLike(input.sourceKind, input.mimeType)) {
    try {
      return {
        encoding: "utf8" as const,
        content: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
      }
    } catch {
      // Fall through to base64 for invalid or split UTF-8 windows.
    }
  }
  return {
    encoding: "base64" as const,
    content: input.bytes.toString("base64"),
  }
}

function pageInfo(input: { byteOffset: number; maxBytes: number; bytesReturned: number; totalBytes: number }) {
  const nextOffset = input.byteOffset + input.bytesReturned
  const hasMore = nextOffset < input.totalBytes
  return {
    limit: input.maxBytes,
    ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
    hasMore,
  }
}

function sliceWindow(bytes: Buffer, window: LcmReadWindow) {
  if (window.byteOffset >= bytes.byteLength) return Buffer.alloc(0)
  return bytes.subarray(window.byteOffset, Math.min(bytes.byteLength, window.byteOffset + window.maxBytes))
}

async function rowExists(db: Queryable, fileID: LcmFileID) {
  const rows = (
    await db.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM lcm_large_files WHERE file_id = $1) AS exists`, [
      fileID,
    ])
  ).rows
  return Boolean(rows[0]?.exists)
}

async function allocateContextItemID(db: Queryable): Promise<ContextItemID> {
  return allocateStableLcmID("ctx", async (id) => {
    const rows = (
      await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM lcm_context_items WHERE context_item_id = $1) AS exists`,
        [id],
      )
    ).rows
    return Boolean(rows[0]?.exists)
  })
}

async function hashFile(filePath: string, abortSignal?: AbortSignal, onCanceled?: () => LcmSafeError) {
  const abortError = () => onCanceled?.() ?? new Error("aborted")
  if (abortSignal?.aborted) throw abortError()
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    const onAbort = () => {
      stream.destroy(streamDestroyError(abortError()))
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true })
    stream.on("data", (chunk) => {
      hash.update(toBuffer(chunk))
    })
    stream.on("error", (error) => {
      abortSignal?.removeEventListener("abort", onAbort)
      reject(streamRejectError(error))
    })
    stream.on("end", () => {
      abortSignal?.removeEventListener("abort", onAbort)
      resolve(hash.digest("hex"))
    })
  })
}

async function hashFileAndCollectWindow(input: {
  fileID: LcmFileID
  filePath: string
  window: LcmReadWindow
  abortSignal?: AbortSignal
}) {
  throwIfFileReadCanceled(input.fileID, input.abortSignal)
  return new Promise<{ sha256: string; byteCount: number; windowBytes: Buffer }>((resolve, reject) => {
    const hash = createHash("sha256")
    const chunks: Buffer[] = []
    let position = 0
    const end = input.window.byteOffset + input.window.maxBytes
    const stream = createReadStream(input.filePath)
    const onAbort = () => {
      stream.destroy(streamDestroyError(canceled(input.fileID)))
    }
    input.abortSignal?.addEventListener("abort", onAbort, { once: true })
    stream.on("data", (chunk) => {
      const bytes = toBuffer(chunk)
      hash.update(bytes)
      const next = position + bytes.byteLength
      if (next > input.window.byteOffset && position < end) {
        const startInChunk = Math.max(0, input.window.byteOffset - position)
        const endInChunk = Math.min(bytes.byteLength, end - position)
        if (endInChunk > startInChunk) chunks.push(Buffer.from(bytes.subarray(startInChunk, endInChunk)))
      }
      position = next
    })
    stream.on("error", (error) => {
      input.abortSignal?.removeEventListener("abort", onAbort)
      reject(streamRejectError(error))
    })
    stream.on("end", () => {
      input.abortSignal?.removeEventListener("abort", onAbort)
      resolve({
        sha256: hash.digest("hex"),
        byteCount: position,
        windowBytes: Buffer.concat(chunks),
      })
    })
  })
}

async function observePath(input: { filePath: string; abortSignal?: AbortSignal; onCanceled?: () => LcmSafeError }) {
  const metadata = await observePathMetadata({
    filePath: input.filePath,
    abortSignal: input.abortSignal,
    onCanceled: input.onCanceled,
  })
  return {
    ...metadata,
    contentSha256: await hashFile(metadata.canonicalPath, input.abortSignal, input.onCanceled),
  }
}

async function observePathMetadata(input: {
  filePath: string
  abortSignal?: AbortSignal
  onCanceled?: () => LcmSafeError
}) {
  const abortError = () => input.onCanceled?.() ?? new Error("aborted")
  if (input.abortSignal?.aborted) throw abortError()
  const canonicalPath = await fs.realpath(input.filePath)
  if (input.abortSignal?.aborted) throw abortError()
  const stat = await fs.stat(canonicalPath)
  if (input.abortSignal?.aborted) throw abortError()
  if (!stat.isFile()) throw invalidRequest("lcm_path_registration_not_file")
  return {
    canonicalPath,
    sizeBytes: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
  }
}

function pathPermissionProbeFileID(input: {
  conversationID: ConversationID
  originalPath: string
  canonicalPath: string
  sizeBytes: number
  mtimeMs: number
}) {
  return stableFileID({
    namespace: "lcm-path-permission-probe-file-id-v1",
    conversationID: input.conversationID,
    sourceKind: "path",
    stableSeed: `${input.originalPath}\0${input.canonicalPath}\0${input.sizeBytes}\0${input.mtimeMs}`,
    sha256: "permission-probe",
  })
}

async function requirePathPermission(input: {
  permissionCheck?: LcmPathPermissionCheck
  fileID: LcmFileID
  canonicalPath: string
  originalPath: string
  boundaryMetadata: LcmBoundaryMetadataV1
  diagnosticCode: string
  staleFileError?: boolean
}) {
  const permission = input.permissionCheck
    ? await input.permissionCheck({
        fileID: input.fileID,
        canonicalPath: input.canonicalPath,
        originalPath: input.originalPath,
        boundaryMetadata: input.boundaryMetadata,
      })
    : "denied"
  if (permission === "allowed") return
  if (input.staleFileError) {
    throw fileSafeError({
      code: "permission_denied",
      fileID: input.fileID,
      staleState: "permission_denied",
      diagnosticCode: input.diagnosticCode,
    })
  }
  throw fileSafeError({
    code: "permission_denied",
    fileID: input.fileID,
    staleState: "permission_denied",
    diagnosticCode: input.diagnosticCode,
    action: "repeat_input",
  })
}

function rowToPathRecord(row: LcmLargeFileRow): LcmPathBackedFileRecord {
  return {
    fileID: row.file_id,
    sourceKind: row.source_kind,
    originalPath: row.original_path,
    canonicalPath: row.canonical_path,
    pathSizeBytes: row.path_size_bytes === null ? null : asNumber(row.path_size_bytes),
    pathMtimeMs: row.path_mtime_ms === null ? null : asNumber(row.path_mtime_ms),
    pathContentSha256: row.path_content_sha256,
    pathHashMode: row.path_hash_mode,
    boundaryMetadata: row.boundary_metadata_json,
  }
}

export async function loadLargeFileRow(db: Queryable, fileID: LcmFileID) {
  return (
    await db.query<LcmLargeFileRow>(
      `
        SELECT file_id, conversation_id, source_kind, original_path, canonical_path, path_size_bytes, path_mtime_ms,
               path_content_sha256, path_hash_mode, boundary_metadata_json, mime_type, token_estimate, preview_text,
               exploration_status, exploration_kind, exploration_safe_reason, exploration_sampled,
               exploration_sample_bytes, exploration_prompt_version, exploration_usage_record_id,
               artifact_storage_kind, artifact_path, artifact_byte_count, artifact_content_sha256
        FROM lcm_large_files
        WHERE file_id = $1
      `,
      [fileID],
    )
  ).rows[0]
}

export async function loadLargeFileStatus(
  db: Queryable,
  fileID: LcmFileID,
  input?: {
    staleState?: LcmFileStaleState
    blockingUse?: boolean
    safeError?: LcmSafeError
  },
): Promise<LcmFileStatus | undefined> {
  const row = await loadLargeFileRow(db, fileID)
  if (!row) return undefined
  return {
    fileID,
    sourceKind: row.source_kind,
    staleState: input?.staleState ?? "current",
    explorationStatus: row.exploration_status,
    explorerKind: row.exploration_kind,
    safeReason: input?.safeError
      ? input.safeError.code === "permission_denied"
        ? "permission_denied"
        : row.source_kind === "path"
          ? "stale_source"
          : "artifact_invalid"
      : (row.exploration_safe_reason ?? undefined),
    sampled: row.exploration_sampled,
    sampleBytes: asNumber(row.exploration_sample_bytes),
    blockingUse: input?.blockingUse ?? false,
    safeError: input?.safeError,
  }
}

export async function registerPathBackedFile(input: {
  db: Queryable
  conversationID: ConversationID
  originalPath: string
  boundaryMetadata: LcmBoundaryMetadataV1
  mimeType?: string | null
  stableSeed?: string
  permissionCheck?: LcmPathPermissionCheck
  nowMs?: number
  abortSignal?: AbortSignal
}) {
  if (!isCompleteBoundaryMetadataV1(input.boundaryMetadata)) {
    throw invalidRequest("lcm_path_registration_incomplete_boundary")
  }
  throwIfPathRegistrationCanceled(input.abortSignal)
  const initialMetadata = await observePathMetadata({
    filePath: input.originalPath,
    abortSignal: input.abortSignal,
    onCanceled: pathRegistrationCanceled,
  }).catch((error) => {
    if (input.abortSignal?.aborted) throw pathRegistrationCanceled()
    throw error
  })
  throwIfPathRegistrationCanceled(input.abortSignal)
  const initialInsideBoundary = isCanonicalPathInsideBoundary({
    canonicalPath: initialMetadata.canonicalPath,
    boundaryMetadata: input.boundaryMetadata,
  })
  if (input.permissionCheck || !initialInsideBoundary) {
    throwIfPathRegistrationCanceled(input.abortSignal)
    await requirePathPermission({
      permissionCheck: input.permissionCheck,
      fileID: pathPermissionProbeFileID({
        conversationID: input.conversationID,
        originalPath: input.originalPath,
        canonicalPath: initialMetadata.canonicalPath,
        sizeBytes: initialMetadata.sizeBytes,
        mtimeMs: initialMetadata.mtimeMs,
      }),
      canonicalPath: initialMetadata.canonicalPath,
      originalPath: input.originalPath,
      boundaryMetadata: input.boundaryMetadata,
      diagnosticCode: "lcm_path_registration_permission_denied",
    })
    throwIfPathRegistrationCanceled(input.abortSignal)
  }
  let initialContentSha256: string
  try {
    initialContentSha256 = await hashFile(initialMetadata.canonicalPath, input.abortSignal, pathRegistrationCanceled)
  } catch (error) {
    if (input.abortSignal?.aborted) throw pathRegistrationCanceled()
    throw error
  }
  throwIfPathRegistrationCanceled(input.abortSignal)
  const initial = {
    ...initialMetadata,
    contentSha256: initialContentSha256,
  }
  const final = await observePath({
    filePath: input.originalPath,
    abortSignal: input.abortSignal,
    onCanceled: pathRegistrationCanceled,
  }).catch((error) => {
    if (input.abortSignal?.aborted) throw pathRegistrationCanceled()
    throw error
  })
  throwIfPathRegistrationCanceled(input.abortSignal)
  if (
    initial.canonicalPath !== final.canonicalPath ||
    initial.sizeBytes !== final.sizeBytes ||
    initial.mtimeMs !== final.mtimeMs ||
    initial.contentSha256 !== final.contentSha256
  ) {
    throw invalidRequest("lcm_path_registration_changed_during_hash")
  }
  const fileID = stableFileID({
    namespace: "lcm-path-file-id-v1",
    conversationID: input.conversationID,
    sourceKind: "path",
    stableSeed:
      input.stableSeed ?? `${input.originalPath}\0${final.canonicalPath}\0${final.sizeBytes}\0${final.mtimeMs}`,
    sha256: final.contentSha256,
  })
  const existing = await loadLargeFileRow(input.db, fileID)
  if (existing) return existing
  if (await rowExists(input.db, fileID)) throw invalidRequest("lcm_path_registration_file_id_collision")

  const previewBytes = await fs
    .open(final.canonicalPath, "r")
    .then(async (handle) => {
      try {
        const buffer = Buffer.alloc(Math.min(RUNTIME_DEFAULTS.largePayloads.previewBytes, final.sizeBytes))
        const read = await handle.read(buffer, 0, buffer.byteLength, 0)
        return buffer.subarray(0, read.bytesRead)
      } finally {
        await handle.close()
      }
    })
    .catch(() => Buffer.alloc(0))
  const now = input.nowMs ?? Date.now()
  await input.db.query(
    `
      INSERT INTO lcm_large_files (
        file_id, conversation_id, source_kind, original_path, canonical_path, path_size_bytes, path_mtime_ms,
        path_content_sha256, path_hash_mode, boundary_metadata_json, mime_type, preview_text,
        exploration_status, exploration_kind, artifact_storage_kind, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, 'path', $3, $4, $5, $6, $7, 'full', $8::jsonb, $9, $10,
              'not_started', 'none', 'none', $11, $11)
    `,
    [
      fileID,
      input.conversationID,
      input.originalPath,
      final.canonicalPath,
      final.sizeBytes,
      final.mtimeMs,
      final.contentSha256,
      JSON.stringify(input.boundaryMetadata),
      input.mimeType ?? null,
      createPreviewText({ bytes: previewBytes }),
      now,
    ],
  )
  return (await loadLargeFileRow(input.db, fileID))!
}

export async function registerMapArtifactFile(input: {
  db: Queryable
  artifactRoot: string
  conversationID: ConversationID
  sourceKind: Extract<LcmFileSourceKind, "map_input" | "map_output">
  bytes: Buffer | Uint8Array | string
  stableSeed: string
  mimeType?: string | null
  nowMs?: number
}) {
  const bytes = toBuffer(input.bytes)
  const artifact = await writeLcmArtifact({ artifactRoot: input.artifactRoot, bytes })
  const fileID = stableFileID({
    namespace: "lcm-map-artifact-file-id-v1",
    conversationID: input.conversationID,
    sourceKind: input.sourceKind,
    stableSeed: input.stableSeed,
    sha256: artifact.sha256,
  })
  const existing = await loadLargeFileRow(input.db, fileID)
  if (existing) return existing
  const now = input.nowMs ?? Date.now()
  await input.db.query(
    `
      INSERT INTO lcm_large_files (
        file_id, conversation_id, source_kind, mime_type, preview_text, exploration_status, exploration_kind,
        artifact_storage_kind, artifact_path, artifact_byte_count, artifact_content_sha256, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, 'not_started', 'none', 'file', $6, $7, $8, $9, $9)
    `,
    [
      fileID,
      input.conversationID,
      input.sourceKind,
      input.mimeType ?? "application/jsonl",
      createPreviewText({ bytes }),
      artifact.artifactPath,
      artifact.byteCount,
      artifact.sha256,
      now,
    ],
  )
  return (await loadLargeFileRow(input.db, fileID))!
}

export async function addLargeFileMarkerContextItem(input: {
  db: Queryable
  conversationID: ConversationID
  fileID: LcmFileID
  nowMs?: number
}) {
  const existing = (
    await input.db.query<{ context_item_id: ContextItemID }>(
      `
        SELECT context_item_id
        FROM lcm_context_items
        WHERE conversation_id = $1
          AND item_type = 'large_file_marker'
          AND file_id = $2
        LIMIT 1
      `,
      [input.conversationID, input.fileID],
    )
  ).rows[0]
  if (existing) return existing.context_item_id
  const orderRows = (
    await input.db.query<{ item_order: number | string | bigint }>(
      `SELECT coalesce(max(item_order), 0)::int AS item_order FROM lcm_context_items WHERE conversation_id = $1`,
      [input.conversationID],
    )
  ).rows
  const now = input.nowMs ?? Date.now()
  const contextItemID = await allocateContextItemID(input.db)
  await input.db.query(
    `
      INSERT INTO lcm_context_items (
        context_item_id, conversation_id, item_order, item_type, file_id, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, 'large_file_marker', $4, $5, $5)
    `,
    [contextItemID, input.conversationID, asNumber(orderRows[0]?.item_order) + 1, input.fileID, now],
  )
  return contextItemID
}

function artifactStaleState(reason: string): LcmFileStaleState {
  if (reason === "artifact_missing") return "artifact_missing"
  if (reason === "artifact_size_mismatch") return "artifact_size_mismatch"
  return "artifact_hash_mismatch"
}

function resultFromBytes(input: {
  fileID: LcmFileID
  sourceKind: LcmFileSourceKind
  mimeType?: string | null
  bytes: Buffer
  totalBytes: number
  window: LcmReadWindow
}): LcmReadResult {
  const encoded = encodeWindow({ bytes: input.bytes, sourceKind: input.sourceKind, mimeType: input.mimeType })
  return {
    ok: true,
    fileID: input.fileID,
    sourceKind: input.sourceKind,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    byteOffset: input.window.byteOffset,
    bytesReturned: input.bytes.byteLength,
    encoding: encoded.encoding,
    content: encoded.content,
    page: pageInfo({
      byteOffset: input.window.byteOffset,
      maxBytes: input.window.maxBytes,
      bytesReturned: input.bytes.byteLength,
      totalBytes: input.totalBytes,
    }),
  }
}

async function readArtifactWindow(input: {
  row: LcmLargeFileRow
  artifactRoot: string
  window: LcmReadWindow
  abortSignal?: AbortSignal
}): Promise<{ result: LcmReadResult; artifact: LcmArtifactValidationResult }> {
  throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
  if (!input.row.artifact_path || !input.row.artifact_content_sha256) {
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: "artifact_hash_mismatch",
      diagnosticCode: "lcm_file_artifact_metadata_incomplete",
      action: "repeat_input",
    })
  }
  const artifact = await readAndValidateLcmArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath: input.row.artifact_path,
    byteCount: asNumber(input.row.artifact_byte_count),
    sha256: input.row.artifact_content_sha256,
  })
  throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
  if (!artifact.ok) {
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: artifactStaleState(artifact.reason),
      diagnosticCode: `lcm_file_${artifact.reason}`,
      action: "repeat_input",
    })
  }
  return {
    artifact: artifact.value,
    result: resultFromBytes({
      fileID: input.row.file_id,
      sourceKind: input.row.source_kind,
      mimeType: input.row.mime_type,
      bytes: sliceWindow(artifact.value.bytes, input.window),
      totalBytes: artifact.value.bytes.byteLength,
      window: input.window,
    }),
  }
}

async function readPathWindow(input: {
  row: LcmLargeFileRow
  window: LcmReadWindow
  permissionCheck?: LcmPathPermissionCheck
  abortSignal?: AbortSignal
}) {
  throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
  const record = rowToPathRecord(input.row)
  const registered = validateRegisteredPathRecord(record)
  if (!registered.ok) {
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: registered.staleState,
      diagnosticCode: registered.safeError.diagnosticCode ?? "lcm_path_registered_invalid",
    })
  }
  let canonicalPath: string
  let lstat: Awaited<ReturnType<typeof fs.lstat>> | undefined
  try {
    canonicalPath = await fs.realpath(input.row.original_path!)
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
    lstat = await fs.lstat(input.row.original_path!)
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
  } catch {
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: "missing",
      diagnosticCode: "lcm_path_source_missing",
    })
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(canonicalPath)
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
    if (!stat.isFile()) throw new Error("not file")
  } catch {
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: "missing",
      diagnosticCode: "lcm_path_source_inaccessible",
    })
  }
  let read: Awaited<ReturnType<typeof hashFileAndCollectWindow>>
  try {
    read = await hashFileAndCollectWindow({
      fileID: input.row.file_id,
      filePath: canonicalPath,
      window: input.window,
      abortSignal: input.abortSignal,
    })
  } catch (error) {
    if (input.abortSignal?.aborted) throw canceled(input.row.file_id)
    const safeError = parseLcmSafeError(error)
    if (safeError) throw safeError
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: "missing",
      diagnosticCode: "lcm_path_source_inaccessible",
    })
  }
  const observed = validateObservedPathState(record, {
    canonicalPath,
    sizeBytes: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    contentSha256: read.sha256,
    permission: "allowed",
    symlinkRetargeted: Boolean(lstat?.isSymbolicLink() && canonicalPath !== input.row.canonical_path),
  })
  if (!observed.ok) {
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: observed.staleState,
      diagnosticCode: observed.safeError.diagnosticCode ?? "lcm_path_source_stale",
    })
  }
  if (!observed.insideBoundary || input.permissionCheck) {
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
    await requirePathPermission({
      permissionCheck: input.permissionCheck,
      fileID: input.row.file_id,
      canonicalPath,
      originalPath: input.row.original_path!,
      boundaryMetadata: observed.boundaryMetadata,
      diagnosticCode: "lcm_path_permission_denied",
      staleFileError: true,
    })
    throwIfFileReadCanceled(input.row.file_id, input.abortSignal)
  }
  return resultFromBytes({
    fileID: input.row.file_id,
    sourceKind: input.row.source_kind,
    mimeType: input.row.mime_type,
    bytes: read.windowBytes,
    totalBytes: read.byteCount,
    window: input.window,
  })
}

export async function readLargeFileRowWindow(input: {
  row: LcmLargeFileRow
  artifactRoot: string
  window: LcmReadWindow
  permissionCheck?: LcmPathPermissionCheck
  abortSignal?: AbortSignal
}) {
  if (input.row.source_kind === "path") {
    return readPathWindow({
      row: input.row,
      window: input.window,
      permissionCheck: input.permissionCheck,
      abortSignal: input.abortSignal,
    })
  }
  if (input.row.artifact_storage_kind !== "file") {
    throw fileSafeError({
      fileID: input.row.file_id,
      staleState: "artifact_hash_mismatch",
      diagnosticCode: "lcm_file_artifact_storage_missing",
      action: "repeat_input",
    })
  }
  return (
    await readArtifactWindow({
      row: input.row,
      artifactRoot: input.artifactRoot,
      window: input.window,
      abortSignal: input.abortSignal,
    })
  ).result
}

export async function readLargeFileWindow(input: {
  db: PGlite
  fileID: LcmFileID
  artifactRoot: string
  window: LcmReadWindow
  permissionCheck?: LcmPathPermissionCheck
  abortSignal?: AbortSignal
}) {
  throwIfFileReadCanceled(input.fileID, input.abortSignal)
  const row = await loadLargeFileRow(input.db, input.fileID)
  throwIfFileReadCanceled(input.fileID, input.abortSignal)
  if (!row) {
    throw createLcmSafeError({
      code: "not_found",
      templateKey: "lcm.auth.denied",
      safeParams: { fileID: input.fileID },
      retryable: false,
      diagnosticCode: "lcm_file_not_found",
    })
  }
  return readLargeFileRowWindow({
    row,
    artifactRoot: input.artifactRoot,
    window: input.window,
    permissionCheck: input.permissionCheck,
    abortSignal: input.abortSignal,
  })
}
