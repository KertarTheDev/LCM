// kilocode_change - new file
import { createHash } from "node:crypto"
import type { ContextItemType } from "./types"

export interface LcmBoundaryMetadataV1 {
  readonly version: 1
  readonly projectID: string
  readonly workspaceID?: string
  readonly platformPathFlavor: "posix" | "win32"
  readonly caseSensitivity: "sensitive" | "insensitive" | "unknown"
  readonly sessionDirectoryOriginal: string
  readonly sessionDirectoryCanonical: string
  readonly worktreeOriginal?: string
  readonly worktreeCanonical?: string
  readonly allowedRootOriginals: string[]
  readonly allowedRootCanonicals: string[]
  readonly kiloPermissionContext: {
    readonly source: "session" | "worktree" | "external_directory"
    readonly permissionProfileID?: string
  }
}

export interface ValidatorResult {
  readonly ok: boolean
  readonly reason?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function hasTraversal(value: string) {
  return value.split(/[\\/]+/).includes("..")
}

export function validateBoundaryMetadataV1(value: unknown): ValidatorResult {
  if (!isObject(value)) return { ok: false, reason: "boundary_not_object" }
  if (value.version !== 1) return { ok: false, reason: "boundary_wrong_version" }
  if (!isNonEmptyString(value.projectID)) return { ok: false, reason: "boundary_missing_project" }
  if (value.workspaceID !== undefined && !isNonEmptyString(value.workspaceID)) {
    return { ok: false, reason: "boundary_invalid_workspace" }
  }
  if (value.platformPathFlavor !== "posix" && value.platformPathFlavor !== "win32") {
    return { ok: false, reason: "boundary_invalid_path_flavor" }
  }
  if (
    value.caseSensitivity !== "sensitive" &&
    value.caseSensitivity !== "insensitive" &&
    value.caseSensitivity !== "unknown"
  ) {
    return { ok: false, reason: "boundary_invalid_case_sensitivity" }
  }
  if (!isNonEmptyString(value.sessionDirectoryOriginal) || !isNonEmptyString(value.sessionDirectoryCanonical)) {
    return { ok: false, reason: "boundary_missing_session_directory" }
  }
  if (hasTraversal(value.sessionDirectoryCanonical)) return { ok: false, reason: "boundary_traversal" }
  if (!isStringArray(value.allowedRootOriginals) || !isStringArray(value.allowedRootCanonicals)) {
    return { ok: false, reason: "boundary_missing_allowed_roots" }
  }
  if (value.allowedRootCanonicals.some(hasTraversal)) return { ok: false, reason: "boundary_root_traversal" }
  if (!isObject(value.kiloPermissionContext)) return { ok: false, reason: "boundary_missing_permission_context" }
  if (
    value.kiloPermissionContext.source !== "session" &&
    value.kiloPermissionContext.source !== "worktree" &&
    value.kiloPermissionContext.source !== "external_directory"
  ) {
    return { ok: false, reason: "boundary_invalid_permission_source" }
  }
  return { ok: true }
}

export function isCompleteBoundaryMetadataV1(value: unknown): value is LcmBoundaryMetadataV1 {
  return validateBoundaryMetadataV1(value).ok
}

export function validateContextItemReference(input: {
  readonly itemType: ContextItemType
  readonly messageRowID?: string | null
  readonly summaryID?: string | null
  readonly pointerID?: string | null
  readonly fileID?: string | null
  readonly cueID?: string | null
  readonly cuePayload?: unknown
  readonly cueLifecycleState?: "active" | "superseded" | "tombstoned" | null
  readonly cueTargetSourceMessageID?: string | null
  readonly cueGenerationID?: string | null
}): ValidatorResult {
  const hasCue = input.cuePayload !== undefined && input.cuePayload !== null
  const hasCueFields =
    Boolean(input.cueID) &&
    Boolean(input.cueTargetSourceMessageID) &&
    Boolean(input.cueGenerationID) &&
    ["active", "superseded", "tombstoned"].includes(String(input.cueLifecycleState))
  const hasNoCueFields =
    !input.cueID && !input.cueLifecycleState && !input.cueTargetSourceMessageID && !input.cueGenerationID
  const matches =
    (input.itemType === "raw_message" &&
      Boolean(input.messageRowID) &&
      !input.summaryID &&
      !input.pointerID &&
      !input.fileID &&
      hasNoCueFields &&
      !hasCue) ||
    (input.itemType === "summary" &&
      !input.messageRowID &&
      Boolean(input.summaryID) &&
      !input.pointerID &&
      !input.fileID &&
      hasNoCueFields &&
      !hasCue) ||
    (input.itemType === "archive_stub" &&
      !input.messageRowID &&
      Boolean(input.summaryID) &&
      Boolean(input.pointerID) &&
      !input.fileID &&
      hasNoCueFields &&
      !hasCue) ||
    (input.itemType === "large_file_marker" &&
      !input.messageRowID &&
      !input.summaryID &&
      !input.pointerID &&
      Boolean(input.fileID) &&
      hasNoCueFields &&
      !hasCue) ||
    (input.itemType === "retrieval_cue" &&
      !input.messageRowID &&
      !input.summaryID &&
      !input.pointerID &&
      !input.fileID &&
      hasCueFields &&
      hasCue)
  return matches ? { ok: true } : { ok: false, reason: "context_item_reference_mismatch" }
}

export function validateContentStorageReference(input: {
  readonly contentStorageKind: "inline" | "lcm_file"
  readonly contentFileID?: string | null
  readonly contentByteCount?: number | null
  readonly contentSha256?: string | null
  readonly inlineContentPresent?: boolean
  readonly partConversationID?: string | null
  readonly fileConversationID?: string | null
}): ValidatorResult {
  if (input.contentStorageKind === "inline") {
    return input.contentFileID ? { ok: false, reason: "inline_content_file_id_present" } : { ok: true }
  }
  if (!input.contentFileID || input.contentByteCount === undefined || input.contentByteCount === null) {
    return { ok: false, reason: "lcm_file_missing_file_metadata" }
  }
  if (!input.contentSha256) return { ok: false, reason: "lcm_file_missing_hash" }
  if (input.inlineContentPresent) return { ok: false, reason: "lcm_file_duplicates_inline_payload" }
  if (input.partConversationID && input.fileConversationID && input.partConversationID !== input.fileConversationID) {
    return { ok: false, reason: "lcm_file_conversation_mismatch" }
  }
  return { ok: true }
}

export function validateArtifactPath(artifactPath: string): ValidatorResult {
  if (
    !artifactPath ||
    artifactPath.startsWith("/") ||
    /^[A-Za-z]:/.test(artifactPath) ||
    artifactPath.startsWith("\\\\")
  ) {
    return { ok: false, reason: "artifact_path_absolute" }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(artifactPath)) return { ok: false, reason: "artifact_path_url" }
  if (artifactPath.split(/[\\/]+/).includes("..")) return { ok: false, reason: "artifact_path_traversal" }
  if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/.test(artifactPath)) {
    return { ok: false, reason: "artifact_path_format" }
  }
  return { ok: true }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function serializeMessagePartSearchText(input: {
  readonly textContent?: string | null
  readonly reasoningContent?: string | null
  readonly toolInputJson?: unknown
  readonly toolOutputText?: string | null
  readonly toolErrorText?: string | null
  readonly fileUrl?: string | null
  readonly mediaMime?: string | null
  readonly mediaName?: string | null
}) {
  const fields = [
    input.textContent,
    input.reasoningContent,
    input.toolInputJson === undefined || input.toolInputJson === null ? undefined : canonicalJson(input.toolInputJson),
    input.toolOutputText,
    input.toolErrorText,
    input.fileUrl,
    input.mediaMime,
    input.mediaName,
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
  return fields.join("\n")
}

export interface LcmInlinePartSourceFields {
  readonly textContent?: string | null
  readonly reasoningContent?: string | null
  readonly toolInputJson?: unknown
  readonly toolOutputText?: string | null
  readonly toolErrorText?: string | null
  readonly fileUrl?: string | null
  readonly mediaMime?: string | null
  readonly mediaName?: string | null
}

export interface LcmInlinePartDigest {
  readonly byteCount: number | null
  readonly sha256: string | null
}

const LCM_INLINE_PART_HEADER = "lcm-inline-part-v1\n"
const LCM_INLINE_PART_FIELD_NAMES = new Set([
  "text_content",
  "reasoning_content",
  "tool_input_json",
  "tool_output_text",
  "tool_error_text",
  "file_url",
  "media_mime",
  "media_name",
])

function inlineFrame(fieldName: string, value: string) {
  const bytes = Buffer.from(value, "utf8")
  return Buffer.concat([Buffer.from(`${fieldName}\0${bytes.length}\0`, "utf8"), bytes, Buffer.from("\n", "utf8")])
}

export function serializeInlinePartSourceBytes(input: LcmInlinePartSourceFields): Buffer | undefined {
  const frames: Buffer[] = []
  const addString = (fieldName: string, value: string | null | undefined) => {
    if (value === undefined || value === null) return
    frames.push(inlineFrame(fieldName, value))
  }

  addString("text_content", input.textContent)
  addString("reasoning_content", input.reasoningContent)
  if (input.toolInputJson !== undefined && input.toolInputJson !== null) {
    frames.push(inlineFrame("tool_input_json", canonicalJson(input.toolInputJson)))
  }
  addString("tool_output_text", input.toolOutputText)
  addString("tool_error_text", input.toolErrorText)
  addString("file_url", input.fileUrl)
  addString("media_mime", input.mediaMime)
  addString("media_name", input.mediaName)

  if (frames.length === 0) return undefined
  return Buffer.concat([Buffer.from(LCM_INLINE_PART_HEADER, "utf8"), ...frames])
}

export function parseInlinePartSourceBytes(
  input: Buffer | Uint8Array,
  options: { readonly allowPartial?: boolean } = {},
): { readonly fields: LcmInlinePartSourceFields; readonly truncated: boolean } | undefined {
  const bytes = Buffer.from(input)
  const header = Buffer.from(LCM_INLINE_PART_HEADER, "utf8")
  if (bytes.byteLength < header.byteLength || !bytes.subarray(0, header.byteLength).equals(header)) return undefined

  let offset = header.byteLength
  let truncated = false
  const fields: {
    textContent?: string
    reasoningContent?: string
    toolInputJson?: unknown
    toolOutputText?: string
    toolErrorText?: string
    fileUrl?: string
    mediaMime?: string
    mediaName?: string
  } = {}
  const assign = (fieldName: string, value: string, partial: boolean) => {
    if (!LCM_INLINE_PART_FIELD_NAMES.has(fieldName)) return true
    if (fieldName === "tool_input_json") {
      if (partial) return true
      try {
        fields.toolInputJson = JSON.parse(value)
      } catch {
        return false
      }
      return true
    }
    if (fieldName === "text_content") fields.textContent = value
    else if (fieldName === "reasoning_content") fields.reasoningContent = value
    else if (fieldName === "tool_output_text") fields.toolOutputText = value
    else if (fieldName === "tool_error_text") fields.toolErrorText = value
    else if (fieldName === "file_url") fields.fileUrl = value
    else if (fieldName === "media_mime") fields.mediaMime = value
    else if (fieldName === "media_name") fields.mediaName = value
    return true
  }

  while (offset < bytes.byteLength) {
    const nameEnd = bytes.indexOf(0, offset)
    if (nameEnd < 0) {
      if (!options.allowPartial) return undefined
      truncated = true
      break
    }
    const fieldName = bytes.subarray(offset, nameEnd).toString("utf8")
    const lengthEnd = bytes.indexOf(0, nameEnd + 1)
    if (lengthEnd < 0) {
      if (!options.allowPartial) return undefined
      truncated = true
      break
    }
    const lengthText = bytes.subarray(nameEnd + 1, lengthEnd).toString("ascii")
    if (!/^(0|[1-9][0-9]*)$/.test(lengthText)) return undefined
    const length = Number(lengthText)
    if (!Number.isSafeInteger(length)) return undefined

    const payloadStart = lengthEnd + 1
    const payloadEnd = payloadStart + length
    if (payloadEnd > bytes.byteLength) {
      if (!options.allowPartial) return undefined
      truncated = true
      if (!assign(fieldName, bytes.subarray(payloadStart).toString("utf8"), true)) return undefined
      break
    }
    if (!assign(fieldName, bytes.subarray(payloadStart, payloadEnd).toString("utf8"), false)) return undefined
    if (bytes[payloadEnd] !== 10) {
      if (!options.allowPartial || payloadEnd < bytes.byteLength) return undefined
      truncated = true
      break
    }
    offset = payloadEnd + 1
  }

  return { fields, truncated }
}

export function hashInlinePartSource(input: LcmInlinePartSourceFields): LcmInlinePartDigest {
  const bytes = serializeInlinePartSourceBytes(input)
  if (!bytes) return { byteCount: null, sha256: null }
  return {
    byteCount: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}
