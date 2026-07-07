// kilocode_change - new file
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { Effect, Schema } from "effect"
import { eq, inArray } from "drizzle-orm"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "../session.sql"
import { MessageV2 } from "../message-v2"
import { TRUNCATION_DIR, TRUNCATION_OUTPUT_METADATA_VERSION } from "@/tool/truncation-dir"
import {
  LCM_LARGE_FILE_TOKEN_COUNTER_MODE,
  LCM_LARGE_FILE_TOKEN_COUNTER_VERSION,
  createPreviewText,
  estimateLargePayloadTokens,
  writeLcmArtifact,
} from "./artifacts"
import { RUNTIME_DEFAULTS } from "./config"
import { LcmDb } from "./db"
import { resolveLcmDbLayout } from "./db-layout"
import { createDbRequestCanceledError, isLcmSafeError } from "./db-errors"
import { allocateStableLcmID, createOperationID } from "./id"
import { appendRawMessageContextItems } from "./context"
import { getOrCreateConversation } from "./lifecycle"
import { resolveDirectTestFamilyTargetEffect, resolveSessionFamilyTargetEffect } from "./family"
import { isSourceDriftError, resetConversationSourceAfterDrift } from "./source-drift-repair"
import {
  canonicalJson,
  hashInlinePartSource,
  serializeInlinePartSourceBytes,
  serializeMessagePartSearchText,
} from "./validators"
import {
  createLcmSafeError,
  type ConversationID,
  type LcmFileID,
  type LcmFileSourceKind,
  type LcmLifecycleState,
  type LcmSafeError,
  type LcmStrategy,
  type LcmSyncResult,
  type MessageRowID,
  type OperationID,
  type PartRowID,
} from "./types"

type KiloMessageRow = typeof MessageTable.$inferSelect
type KiloPartRow = typeof PartTable.$inferSelect

type MessageRole = "user" | "assistant"
type PartKind = MessageV2.Part["type"]
type TerminalState = "completed" | "error"

export const MESSAGE_V2_SYNC_TAXONOMY = {
  roles: ["user", "assistant"],
  partKinds: [
    "text",
    "reasoning",
    "file",
    "tool",
    "step-start",
    "step-finish",
    "snapshot",
    "patch",
    "agent",
    "retry",
    "compaction",
    "subtask",
  ],
  toolStates: ["pending", "running", "completed", "error"],
  terminalToolStates: ["completed", "error"],
  fileSourceKinds: ["file", "symbol", "resource"],
  partRenderFlags: ["ignored", "synthetic", "compatibility"],
} as const

export interface SourcePartKeyInput {
  readonly sourcePartID?: string | null
  readonly sourceMessageID: string
  readonly partOrder: number
  readonly partKind: string
  readonly ignored?: boolean
  readonly synthetic?: boolean
  readonly compatibility?: boolean
}

interface LoadedKiloPart {
  readonly row: KiloPartRow
  readonly part: MessageV2.Part
  readonly partOrder: number
}

interface LoadedKiloMessage {
  readonly row: KiloMessageRow
  readonly info: MessageV2.Info
  readonly messageOrder: number
  readonly parts: LoadedKiloPart[]
}

interface MappedMessage {
  readonly sourceMessageID: string
  readonly sourceSessionID: string
  readonly role: MessageRole
  readonly messageOrder: number
  readonly createdAtMs: number
  readonly completedAtMs: number | null
  readonly providerID: string | null
  readonly modelID: string | null
  readonly agentName: string | null
  readonly metadataJson: unknown
  readonly ignored: boolean
  readonly synthetic: boolean
  readonly compatibility: boolean
  readonly parts: MappedPart[]
}

interface LargePayloadStorage {
  readonly sourceKind: LcmFileSourceKind
  readonly artifactBytes: Buffer
  readonly previewText: string
  readonly mimeType: string | null
  readonly tokenEstimate: number | null
  readonly artifactFieldNames: readonly string[]
}

interface MappedPart {
  readonly sourcePartID: string | null
  readonly sourcePartKey: string
  readonly partOrder: number
  readonly partKind: PartKind
  readonly ignored: boolean
  readonly synthetic: boolean
  readonly compatibility: boolean
  readonly terminalState: TerminalState | null
  readonly textContent: string | null
  readonly reasoningContent: string | null
  readonly toolCallID: string | null
  readonly toolName: string | null
  readonly toolInputJson: unknown | null
  readonly toolOutputText: string | null
  readonly toolErrorText: string | null
  readonly fileUrl: string | null
  readonly mediaMime: string | null
  readonly mediaName: string | null
  readonly providerMetadataJson: unknown
  readonly renderMetadataJson: unknown
  readonly contentStorageKind: "inline" | "lcm_file"
  readonly contentFileID: LcmFileID | null
  readonly contentByteCount: number | null
  readonly contentSha256: string | null
  readonly searchText: string
  readonly createdAtMs: number
  readonly completedAtMs: number | null
  readonly largePayload: LargePayloadStorage | null
  readonly inlineFallbackByteCount: number | null
  readonly inlineFallbackSha256: string | null
}

interface ExistingMessageRow {
  message_row_id: MessageRowID
  source_session_id: string
  source_message_id: string
  role: string
  message_order: number | string | bigint
  created_at_ms: number | string | bigint
  completed_at_ms: number | string | bigint | null
  provider_id: string | null
  model_id: string | null
  agent_name: string | null
  metadata_json: unknown
  ignored: boolean
  synthetic: boolean
  compatibility: boolean
  source_version: number | string | bigint
}

interface ExistingPartRow {
  part_row_id: PartRowID
  source_part_id: string | null
  source_part_key: string
  part_order: number | string | bigint
  part_kind: string
  ignored: boolean
  synthetic: boolean
  compatibility: boolean
  terminal_state: string | null
  text_content: string | null
  reasoning_content: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_input_json: unknown | null
  tool_output_text: string | null
  tool_error_text: string | null
  file_url: string | null
  media_mime: string | null
  media_name: string | null
  provider_metadata_json: unknown
  render_metadata_json: unknown
  content_storage_kind: string
  content_file_id: string | null
  content_byte_count: number | string | bigint | null
  content_sha256: string | null
  search_text: string
  created_at_ms: number | string | bigint
  completed_at_ms: number | string | bigint | null
}

interface ExistingLargeFileRow {
  file_id: LcmFileID
  conversation_id: ConversationID
  source_kind: string
  mime_type: string | null
  token_estimate: number | string | bigint | null
  token_estimate_mode: string | null
  token_estimate_version: string | null
  preview_text: string | null
  artifact_storage_kind: string
  artifact_path: string | null
  artifact_byte_count: number | string | bigint
  artifact_content_sha256: string | null
}

interface ConversationRow {
  conversation_id: ConversationID
  lifecycle_state: LcmLifecycleState
}

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeJson(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isCurrentPartKind(value: string): value is PartKind {
  return (MESSAGE_V2_SYNC_TAXONOMY.partKinds as readonly string[]).includes(value)
}

function invalidRequest(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  })
}

function sourceDrift(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "recovery_required",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode,
  })
}

function missingSource(diagnosticCode: string, conversationID?: ConversationID): LcmSafeError {
  return createLcmSafeError({
    code: "missing_source",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      ...(conversationID ? { conversationID } : {}),
      action: "repeat_input",
    },
    retryable: false,
    diagnosticCode,
  })
}

function coerceSyncError(error: unknown): LcmSafeError {
  return isLcmSafeError(error) ? error : invalidRequest("lcm_sync_mapping_failed")
}

function decodeOrThrow<T>(schema: unknown, value: unknown, diagnosticCode: string): T {
  try {
    return Schema.decodeUnknownSync(schema as never)(value) as T
  } catch {
    throw invalidRequest(diagnosticCode)
  }
}

function throwIfSyncAborted(input: { abortSignal?: AbortSignal; operationID?: OperationID; diagnosticCode: string }) {
  if (!input.abortSignal?.aborted) return
  throw createDbRequestCanceledError({
    operationID: input.operationID,
    diagnosticCode: input.diagnosticCode,
  })
}

function numberOrNull(value: number | string | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number(value)
}

function assertEqual(label: string, left: unknown, right: unknown) {
  if (left !== right) throw sourceDrift(`lcm_source_drift_${label}`)
}

function assertJsonEqual(label: string, left: unknown, right: unknown) {
  if (canonicalJson(safeJson(jsonValue(left))) !== canonicalJson(safeJson(jsonValue(right)))) {
    throw sourceDrift(`lcm_source_drift_${label}`)
  }
}

function messageMetadataForDrift(value: unknown) {
  const metadata = safeJson(jsonValue(value))
  if (!isObject(metadata)) return metadata
  if (metadata.role === "user") {
    const { summary: _summary, ...rest } = metadata
    return rest
  }
  if (metadata.role === "assistant") {
    const { summary: _summary, cost: _cost, tokens: _tokens, ...rest } = metadata
    return rest
  }
  return metadata
}

function partRenderMetadataForDrift(value: unknown) {
  const metadata = safeJson(jsonValue(value))
  if (!isObject(metadata)) return metadata
  const { lcmFile: _lcmFile, ...rest } = metadata
  if (isObject(rest.time)) {
    const { compacted: _compacted, ...time } = rest.time
    return { ...rest, time }
  }
  return rest
}

function sourceFlags(value: unknown) {
  const row = isObject(value) ? value : {}
  return {
    ignored: row.ignored === true,
    synthetic: row.synthetic === true,
    compatibility: row.compatibility === true,
  }
}

function stripPartIdentity(part: MessageV2.Part) {
  const { id: _id, sessionID: _sessionID, messageID: _messageID, ...rest } = part
  return rest
}

function hashContentSafe(value: unknown) {
  const digest = hashInlinePartSource({ textContent: canonicalJson(safeJson(value)) })
  return digest.sha256
}

function messageMetadata(info: MessageV2.Info) {
  if (info.role === "user") {
    const editorContext = info.editorContext
    return safeJson({
      version: 1,
      role: "user",
      format: info.format,
      system: info.system,
      tools: info.tools,
      modelVariant: info.model.variant,
      summary: info.summary,
      editorContext:
        editorContext === undefined
          ? undefined
          : {
              version: 1,
              hash: hashContentSafe(editorContext),
              fields: Object.keys(editorContext).sort(),
            },
    })
  }

  return safeJson({
    version: 1,
    role: "assistant",
    parentID: info.parentID,
    mode: info.mode,
    path: info.path,
    summary: info.summary,
    structured: info.structured,
    error: info.error,
    cost: info.cost,
    tokens: info.tokens,
    variant: info.variant,
    finish: info.finish,
  })
}

function sourcePartKey(input: SourcePartKeyInput) {
  if (input.sourcePartID) return `id:${input.sourcePartID}`
  return [
    "derived",
    input.sourceMessageID,
    input.partOrder,
    input.partKind,
    `i${input.ignored ? 1 : 0}s${input.synthetic ? 1 : 0}c${input.compatibility ? 1 : 0}`,
  ].join(":")
}

export function createSourcePartKey(input: SourcePartKeyInput) {
  return sourcePartKey(input)
}

function partBaseMetadata(input: {
  readonly part: MessageV2.Part
  readonly flags: ReturnType<typeof sourceFlags>
  readonly sourcePartID: string | null
}) {
  return {
    version: 1,
    source: "message-v2",
    sourcePartType: input.part.type,
    sourcePartID: input.sourcePartID,
    durableClassification: input.flags,
  }
}

function sourceDigest(
  input: Pick<
    MappedPart,
    | "textContent"
    | "reasoningContent"
    | "toolInputJson"
    | "toolOutputText"
    | "toolErrorText"
    | "fileUrl"
    | "mediaMime"
    | "mediaName"
  >,
) {
  return hashInlinePartSource({
    textContent: input.textContent,
    reasoningContent: input.reasoningContent,
    toolInputJson: input.toolInputJson,
    toolOutputText: input.toolOutputText,
    toolErrorText: input.toolErrorText,
    fileUrl: input.fileUrl,
    mediaMime: input.mediaMime,
    mediaName: input.mediaName,
  })
}

function sha256Hex(bytes: Buffer | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function stableLargeFileID(input: { stableSeed: string; artifactSha256: string }) {
  const digest = createHash("sha256")
    .update("lcm-large-file-id-v1\0", "utf8")
    .update(input.stableSeed, "utf8")
    .update("\0", "utf8")
    .update(input.artifactSha256, "utf8")
    .digest("hex")
  return `file_${digest.slice(0, 32)}` as LcmFileID
}

function textByteLength(value: string) {
  return Buffer.byteLength(value, "utf8")
}

function shouldStoreTextAsLargePayload(input: { text: string; byteThreshold: number }) {
  const tokenEstimate = estimateLargePayloadTokens(input.text)
  return {
    tokenEstimate,
    large:
      textByteLength(input.text) > input.byteThreshold || tokenEstimate > RUNTIME_DEFAULTS.largePayloads.tokenThreshold,
  }
}

function textPreview(text: string) {
  return createPreviewText({ bytes: Buffer.from(text, "utf8") })
}

function parseTruncationOutputMetadata(value: unknown) {
  if (!isObject(value)) return undefined
  if (value.outputSidecarVersion !== TRUNCATION_OUTPUT_METADATA_VERSION) return undefined
  if (typeof value.outputPath !== "string") return undefined
  if (typeof value.outputByteCount !== "number" || !Number.isInteger(value.outputByteCount)) return undefined
  if (value.outputByteCount <= 0) return undefined
  if (typeof value.outputSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.outputSha256)) return undefined
  return {
    outputPath: value.outputPath,
    outputByteCount: value.outputByteCount,
    outputSha256: value.outputSha256,
  }
}

async function readValidatedTruncationSidecar(input: {
  readonly part: MappedPart
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  if (input.part.partKind !== "tool" || input.part.terminalState !== "completed") return undefined
  const renderMetadata = isObject(input.part.renderMetadataJson) ? input.part.renderMetadataJson : undefined
  const sidecar = parseTruncationOutputMetadata(renderMetadata?.stateMetadata)
  if (!sidecar) return undefined
  throwIfSyncAborted({
    abortSignal: input.abortSignal,
    operationID: input.operationID,
    diagnosticCode: "lcm_sync_canceled_before_truncation_sidecar_read",
  })
  try {
    const rootReal = await fs.realpath(TRUNCATION_DIR)
    const targetReal = await fs.realpath(sidecar.outputPath)
    const relative = path.relative(rootReal, targetReal)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    const bytes = Buffer.from(await fs.readFile(targetReal))
    throwIfSyncAborted({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_sync_canceled_after_truncation_sidecar_read",
    })
    if (bytes.byteLength !== sidecar.outputByteCount) return undefined
    if (sha256Hex(bytes) !== sidecar.outputSha256) return undefined
    return bytes
  } catch (error) {
    if (isLcmSafeError(error) && error.code === "canceled") throw error
    return undefined
  }
}

async function partWithValidatedTruncationSidecar(input: {
  readonly message: MappedMessage
  readonly part: MappedPart
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  const bytes = await readValidatedTruncationSidecar({
    part: input.part,
    abortSignal: input.abortSignal,
    operationID: input.operationID,
  })
  if (!bytes) return input.part
  const text = bytes.toString("utf8")
  const threshold = shouldStoreTextAsLargePayload({
    text,
    byteThreshold: RUNTIME_DEFAULTS.largePayloads.toolOutputThresholdBytes,
  })
  const stableFileSeed = `${input.message.sourceSessionID}:${input.message.sourceMessageID}:${input.part.sourcePartKey}`
  return completeMappedPart({
    ...input.part,
    stableFileSeed,
    largePayload: largeInlinePayload({
      sourceKind: "tool_output",
      fields: {
        toolInputJson: input.part.toolInputJson,
        toolOutputText: text,
        toolErrorText: null,
      },
      previewText: textPreview(
        serializeMessagePartSearchText({
          toolOutputText: text,
          toolErrorText: null,
        }),
      ),
      mimeType: "text/plain",
      tokenEstimate: threshold.tokenEstimate,
      artifactFieldNames: ["tool_input_json", "tool_output_text"],
    }),
  })
}

function largeInlinePayload(input: {
  readonly fields: Parameters<typeof serializeInlinePartSourceBytes>[0]
  readonly sourceKind: LcmFileSourceKind
  readonly previewText: string
  readonly mimeType?: string | null
  readonly tokenEstimate: number | null
  readonly artifactFieldNames: readonly string[]
}): LargePayloadStorage {
  const artifactBytes = serializeInlinePartSourceBytes(input.fields)
  if (!artifactBytes) throw invalidRequest("lcm_large_payload_missing_source_bytes")
  return {
    sourceKind: input.sourceKind,
    artifactBytes,
    previewText: input.previewText,
    mimeType: input.mimeType ?? null,
    tokenEstimate: input.tokenEstimate,
    artifactFieldNames: input.artifactFieldNames,
  }
}

function dataUrlBytes(url: string) {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(url)
  if (!match) return undefined
  const mimeType = match[1] || "application/octet-stream"
  const encoded = match[3] ?? ""
  const bytes = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded), "utf8")
  return { mimeType, bytes }
}

function withLargePayloadMetadata(input: {
  readonly renderMetadataJson: unknown
  readonly payload: LargePayloadStorage
  readonly contentFileID: LcmFileID
}) {
  const base = isObject(input.renderMetadataJson) ? input.renderMetadataJson : {}
  return safeJson({
    ...base,
    lcmFile: {
      version: 1,
      fileID: input.contentFileID,
      sourceKind: input.payload.sourceKind,
      artifactFieldNames: input.payload.artifactFieldNames,
      tokenEstimateMode: LCM_LARGE_FILE_TOKEN_COUNTER_MODE,
      tokenEstimateVersion: LCM_LARGE_FILE_TOKEN_COUNTER_VERSION,
    },
  })
}

function completeMappedPart(
  input: Omit<
    MappedPart,
    | "contentStorageKind"
    | "contentFileID"
    | "contentByteCount"
    | "contentSha256"
    | "searchText"
    | "largePayload"
    | "inlineFallbackByteCount"
    | "inlineFallbackSha256"
  > & {
    readonly stableFileSeed: string
    readonly largePayload?: LargePayloadStorage | null
  },
): MappedPart {
  const { stableFileSeed, largePayload, ...part } = input
  const inlineDigest = sourceDigest(part)
  if (largePayload) {
    const contentSha256 = sha256Hex(largePayload.artifactBytes)
    const contentFileID = stableLargeFileID({ stableSeed: stableFileSeed, artifactSha256: contentSha256 })
    const textContent = largePayload.artifactFieldNames.includes("text_content") ? null : part.textContent
    const reasoningContent = largePayload.artifactFieldNames.includes("reasoning_content")
      ? null
      : part.reasoningContent
    const toolOutputText = largePayload.artifactFieldNames.includes("tool_output_text") ? null : part.toolOutputText
    const toolErrorText = largePayload.artifactFieldNames.includes("tool_error_text") ? null : part.toolErrorText
    const fileUrl = largePayload.artifactFieldNames.includes("file_url") ? null : part.fileUrl
    const renderMetadataJson = withLargePayloadMetadata({
      renderMetadataJson: part.renderMetadataJson,
      payload: largePayload,
      contentFileID,
    })
    return {
      ...part,
      textContent,
      reasoningContent,
      toolOutputText,
      toolErrorText,
      fileUrl,
      renderMetadataJson,
      contentStorageKind: "lcm_file",
      contentFileID,
      contentByteCount: largePayload.artifactBytes.byteLength,
      contentSha256,
      searchText: serializeMessagePartSearchText({
        textContent,
        reasoningContent,
        toolInputJson: part.toolInputJson,
        toolOutputText,
        toolErrorText,
        fileUrl,
        mediaMime: part.mediaMime,
        mediaName: part.mediaName,
      }),
      largePayload,
      inlineFallbackByteCount: inlineDigest.byteCount,
      inlineFallbackSha256: inlineDigest.sha256,
    }
  }

  return {
    ...part,
    contentStorageKind: "inline",
    contentFileID: null,
    contentByteCount: inlineDigest.byteCount,
    contentSha256: inlineDigest.sha256,
    searchText: serializeMessagePartSearchText({
      textContent: part.textContent,
      reasoningContent: part.reasoningContent,
      toolInputJson: part.toolInputJson,
      toolOutputText: part.toolOutputText,
      toolErrorText: part.toolErrorText,
      fileUrl: part.fileUrl,
      mediaMime: part.mediaMime,
      mediaName: part.mediaName,
    }),
    largePayload: null,
    inlineFallbackByteCount: inlineDigest.byteCount,
    inlineFallbackSha256: inlineDigest.sha256,
  }
}

function mapPart(input: {
  readonly message: MessageV2.Info
  readonly part: MessageV2.Part
  readonly row: KiloPartRow
  readonly partOrder: number
}): MappedPart | undefined {
  const part = input.part
  if (!isCurrentPartKind(part.type)) throw invalidRequest(`lcm_unknown_part_kind_${part.type}`)
  const flags = sourceFlags(part)
  const sourcePartID = input.row.id ?? null
  const common = {
    sourcePartID,
    sourcePartKey: sourcePartKey({
      sourcePartID,
      sourceMessageID: input.message.id,
      partOrder: input.partOrder,
      partKind: part.type,
      ...flags,
    }),
    partOrder: input.partOrder,
    partKind: part.type,
    ...flags,
    terminalState: null,
    textContent: null,
    reasoningContent: null,
    toolCallID: null,
    toolName: null,
    toolInputJson: null,
    toolOutputText: null,
    toolErrorText: null,
    fileUrl: null,
    mediaMime: null,
    mediaName: null,
    providerMetadataJson: {},
    renderMetadataJson: partBaseMetadata({ part, flags, sourcePartID }),
    createdAtMs: input.row.time_created,
    completedAtMs: null,
  } satisfies Omit<
    MappedPart,
    | "contentStorageKind"
    | "contentFileID"
    | "contentByteCount"
    | "contentSha256"
    | "searchText"
    | "largePayload"
    | "inlineFallbackByteCount"
    | "inlineFallbackSha256"
  >
  const stableFileSeed = `${input.message.sessionID}:${input.message.id}:${common.sourcePartKey}`

  if (part.type === "text") {
    if (input.message.role === "assistant" && part.time && part.time.end === undefined) return undefined
    const threshold = shouldStoreTextAsLargePayload({
      text: part.text,
      byteThreshold: RUNTIME_DEFAULTS.largePayloads.promptPayloadThresholdBytes,
    })
    return completeMappedPart({
      ...common,
      stableFileSeed,
      textContent: part.text,
      providerMetadataJson: safeJson(part.metadata ?? {}),
      renderMetadataJson: safeJson({
        ...common.renderMetadataJson,
        time: part.time,
      }),
      completedAtMs: part.time?.end ?? null,
      largePayload: threshold.large
        ? largeInlinePayload({
            sourceKind: "inline",
            fields: { textContent: part.text },
            previewText: textPreview(part.text),
            mimeType: "text/plain",
            tokenEstimate: threshold.tokenEstimate,
            artifactFieldNames: ["text_content"],
          })
        : null,
    })
  }

  if (part.type === "reasoning") {
    if (part.time.end === undefined) return undefined
    const threshold = shouldStoreTextAsLargePayload({
      text: part.text,
      byteThreshold: RUNTIME_DEFAULTS.largePayloads.promptPayloadThresholdBytes,
    })
    return completeMappedPart({
      ...common,
      stableFileSeed,
      reasoningContent: part.text,
      providerMetadataJson: safeJson(part.metadata ?? {}),
      renderMetadataJson: safeJson({
        ...common.renderMetadataJson,
        time: part.time,
      }),
      completedAtMs: part.time.end,
      largePayload: threshold.large
        ? largeInlinePayload({
            sourceKind: "inline",
            fields: { reasoningContent: part.text },
            previewText: textPreview(part.text),
            mimeType: "text/plain",
            tokenEstimate: threshold.tokenEstimate,
            artifactFieldNames: ["reasoning_content"],
          })
        : null,
    })
  }

  if (part.type === "file") {
    const source = part.source
    if (source && !(MESSAGE_V2_SYNC_TAXONOMY.fileSourceKinds as readonly string[]).includes(source.type)) {
      throw invalidRequest(`lcm_unknown_file_source_kind_${source.type}`)
    }
    const mediaBytes = dataUrlBytes(part.url)
    return completeMappedPart({
      ...common,
      stableFileSeed,
      fileUrl: part.url,
      mediaMime: part.mime,
      mediaName: part.filename ?? null,
      renderMetadataJson: safeJson({
        ...common.renderMetadataJson,
        source: part.source,
        ...(mediaBytes ? { providerMediaUrlKind: "data_url" } : {}),
      }),
      largePayload: mediaBytes
        ? {
            sourceKind: "image",
            artifactBytes: mediaBytes.bytes,
            previewText: `Provider media (${part.mime || mediaBytes.mimeType}, ${mediaBytes.bytes.byteLength} bytes)`,
            mimeType: part.mime || mediaBytes.mimeType,
            tokenEstimate: Math.ceil(mediaBytes.bytes.byteLength / 4),
            artifactFieldNames: ["file_url"],
          }
        : null,
    })
  }

  if (part.type === "tool") {
    const state = part.state
    if (!(MESSAGE_V2_SYNC_TAXONOMY.toolStates as readonly string[]).includes(state.status)) {
      throw invalidRequest(`lcm_unknown_tool_state_${state.status}`)
    }
    if (state.status === "pending" || state.status === "running") return undefined

    const outputFromInterruptedError =
      state.status === "error" &&
      isObject(state.metadata) &&
      state.metadata.interrupted === true &&
      typeof state.metadata.output === "string"
        ? state.metadata.output
        : null

    return completeMappedPart({
      ...common,
      stableFileSeed,
      terminalState: state.status,
      toolCallID: part.callID,
      toolName: part.tool,
      toolInputJson: safeJson(state.input),
      toolOutputText: state.status === "completed" ? state.output : outputFromInterruptedError,
      toolErrorText: state.status === "error" ? state.error : null,
      providerMetadataJson: safeJson(part.metadata ?? {}),
      renderMetadataJson: safeJson({
        ...common.renderMetadataJson,
        title: "title" in state ? state.title : undefined,
        stateMetadata: "metadata" in state ? state.metadata : undefined,
        time:
          "time" in state
            ? {
                start: state.time.start,
                end: "end" in state.time ? state.time.end : undefined,
                compacted:
                  "compacted" in state.time && typeof state.time.compacted === "number"
                    ? state.time.compacted
                    : undefined,
              }
            : undefined,
        attachments: state.status === "completed" ? state.attachments : undefined,
        interruptedOutputFromMetadata: outputFromInterruptedError !== null,
      }),
      completedAtMs: "time" in state && "end" in state.time ? state.time.end : null,
      largePayload: (() => {
        const toolOutputText = state.status === "completed" ? state.output : outputFromInterruptedError
        const toolErrorText = state.status === "error" ? state.error : null
        const outputThreshold = toolOutputText
          ? shouldStoreTextAsLargePayload({
              text: toolOutputText,
              byteThreshold: RUNTIME_DEFAULTS.largePayloads.toolOutputThresholdBytes,
            })
          : { large: false, tokenEstimate: 0 }
        const errorThreshold = toolErrorText
          ? shouldStoreTextAsLargePayload({
              text: toolErrorText,
              byteThreshold: RUNTIME_DEFAULTS.largePayloads.toolOutputThresholdBytes,
            })
          : { large: false, tokenEstimate: 0 }
        if (!outputThreshold.large && !errorThreshold.large) return null
        return largeInlinePayload({
          sourceKind: "tool_output",
          fields: {
            toolInputJson: safeJson(state.input),
            toolOutputText,
            toolErrorText,
          },
          previewText: textPreview(
            serializeMessagePartSearchText({
              toolOutputText,
              toolErrorText,
            }),
          ),
          mimeType: "text/plain",
          tokenEstimate: outputThreshold.tokenEstimate + errorThreshold.tokenEstimate,
          artifactFieldNames: ["tool_input_json", "tool_output_text", "tool_error_text"].filter((field) => {
            if (field === "tool_output_text") return toolOutputText !== null
            if (field === "tool_error_text") return toolErrorText !== null
            return true
          }),
        })
      })(),
    })
  }

  return completeMappedPart({
    ...common,
    stableFileSeed,
    renderMetadataJson: safeJson({
      ...common.renderMetadataJson,
      payload: stripPartIdentity(part),
    }),
  })
}

function hasTerminalAssistantMetadata(info: MessageV2.Info) {
  if (info.role !== "assistant") return false
  return (
    info.time.completed !== undefined ||
    info.error !== undefined ||
    (info.finish !== undefined && info.finish !== "unknown")
  )
}

function isTerminalAssistantPart(part: MessageV2.Part) {
  if (part.type === "text") return !part.time || part.time.end !== undefined
  if (part.type === "reasoning") return part.time.end !== undefined
  if (part.type === "tool") return part.state.status === "completed" || part.state.status === "error"
  return true
}

function isSealedAssistantMessage(input: LoadedKiloMessage) {
  if (input.info.role !== "assistant") return true
  if (hasTerminalAssistantMetadata(input.info)) return true
  return input.parts.length > 0 && input.parts.every((part) => isTerminalAssistantPart(part.part))
}

function mapMessage(input: LoadedKiloMessage): MappedMessage | undefined {
  const info = input.info
  if (info.role !== "user" && info.role !== "assistant")
    throw invalidRequest(`lcm_unknown_message_role_${(info as { role?: string }).role}`)
  if (info.role === "user" && input.parts.length === 0) return undefined
  if (info.role === "assistant" && !isSealedAssistantMessage(input)) return undefined

  const mappedParts: MappedPart[] = []
  for (const part of input.parts) {
    const mapped = mapPart({
      message: info,
      part: part.part,
      row: part.row,
      partOrder: part.partOrder,
    })
    if (mapped) mappedParts.push(mapped)
  }

  return {
    sourceMessageID: input.row.id,
    sourceSessionID: input.row.session_id,
    role: info.role,
    messageOrder: input.messageOrder,
    createdAtMs: info.time.created ?? input.row.time_created,
    completedAtMs: info.role === "assistant" ? (info.time.completed ?? null) : null,
    providerID: info.role === "assistant" ? info.providerID : info.model.providerID,
    modelID: info.role === "assistant" ? info.modelID : info.model.modelID,
    agentName: info.agent,
    metadataJson: messageMetadata(info),
    ...sourceFlags(info),
    parts: mappedParts,
  }
}

function hasLaterDurableUserMessage(input: { loaded: readonly LoadedKiloMessage[]; messageOrder: number }) {
  return input.loaded.some(
    (message) => message.messageOrder > input.messageOrder && message.info.role === "user" && message.parts.length > 0,
  )
}

function nonTerminalAssistantPartCount(input: LoadedKiloMessage) {
  if (input.info.role !== "assistant") return 0
  return input.parts.reduce((count, part) => count + (isTerminalAssistantPart(part.part) ? 0 : 1), 0)
}

function isSupersededAssistantResidue(input: { loaded: readonly LoadedKiloMessage[]; item: LoadedKiloMessage }) {
  const info = input.item.info
  return (
    info.role === "assistant" &&
    nonTerminalAssistantPartCount(input.item) === input.item.parts.length &&
    hasLaterDurableUserMessage({ loaded: input.loaded, messageOrder: input.item.messageOrder })
  )
}

function benignSkippedPartCount(input: {
  loaded: readonly LoadedKiloMessage[]
  item: LoadedKiloMessage
  skippedParts: number
}) {
  if (input.skippedParts <= 0) return 0
  const info = input.item.info
  if (info.role !== "assistant") return 0
  if (!hasLaterDurableUserMessage({ loaded: input.loaded, messageOrder: input.item.messageOrder })) return 0
  return Math.min(input.skippedParts, nonTerminalAssistantPartCount(input.item))
}

function loadKiloMessages(input: {
  sessionID: string
  upToMessageID?: string
  abortSignal?: AbortSignal
  operationID?: OperationID
}) {
  return Effect.try({
    try: () =>
      Database.use((db) => {
        throwIfSyncAborted({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_sync_canceled_before_source_load",
        })
        const messageRows = db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.session_id, input.sessionID as KiloMessageRow["session_id"]))
          .orderBy(MessageTable.time_created, MessageTable.id)
          .all()

        const upToIndex =
          input.upToMessageID === undefined
            ? messageRows.length - 1
            : messageRows.findIndex((row) => row.id === input.upToMessageID)
        if (input.upToMessageID !== undefined && upToIndex === -1) {
          throw invalidRequest("lcm_sync_upto_message_not_found")
        }
        const selectedRows = upToIndex < 0 ? [] : messageRows.slice(0, upToIndex + 1)
        const ids = selectedRows.map((row) => row.id)
        const partRows =
          ids.length === 0
            ? []
            : db
                .select()
                .from(PartTable)
                .where(inArray(PartTable.message_id, ids as KiloPartRow["message_id"][]))
                .orderBy(PartTable.message_id, PartTable.id)
                .all()

        const partsByMessage = new Map<string, KiloPartRow[]>()
        for (const row of partRows) {
          throwIfSyncAborted({
            abortSignal: input.abortSignal,
            operationID: input.operationID,
            diagnosticCode: "lcm_sync_canceled_while_grouping_parts",
          })
          const list = partsByMessage.get(row.message_id)
          if (list) list.push(row)
          else partsByMessage.set(row.message_id, [row])
        }

        return selectedRows.map((row, index): LoadedKiloMessage => {
          throwIfSyncAborted({
            abortSignal: input.abortSignal,
            operationID: input.operationID,
            diagnosticCode: "lcm_sync_canceled_while_loading_source_messages",
          })
          const info = decodeOrThrow<MessageV2.Info>(
            MessageV2.Info,
            {
              ...(jsonValue(row.data) as object),
              id: row.id,
              sessionID: row.session_id,
            },
            "lcm_sync_invalid_message_v2_info",
          )

          return {
            row,
            info,
            messageOrder: index + 1,
            parts: (partsByMessage.get(row.id) ?? []).map((partRow, partIndex) => {
              return {
                row: partRow,
                part: decodeOrThrow<MessageV2.Part>(
                  MessageV2.Part,
                  {
                    ...(jsonValue(partRow.data) as object),
                    id: partRow.id,
                    sessionID: partRow.session_id,
                    messageID: partRow.message_id,
                  },
                  "lcm_sync_invalid_message_v2_part",
                ),
                partOrder: partIndex + 1,
              }
            }),
          }
        })
      }),
    catch: coerceSyncError,
  })
}

async function allocateMessageRowID(db: Queryable) {
  return allocateStableLcmID("msg", async (id) => {
    const rows = (
      await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM lcm_messages WHERE message_row_id = $1) AS exists`,
        [id],
      )
    ).rows
    return Boolean(rows[0]?.exists)
  })
}

async function allocatePartRowID(db: Queryable) {
  return allocateStableLcmID("part", async (id) => {
    const rows = (
      await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM lcm_message_parts WHERE part_row_id = $1) AS exists`,
        [id],
      )
    ).rows
    return Boolean(rows[0]?.exists)
  })
}

async function ensureLargePayloadFile(input: {
  readonly db: Queryable
  readonly conversationID: ConversationID
  readonly artifactRoot: string
  readonly part: MappedPart
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
}) {
  if (input.part.contentStorageKind !== "lcm_file" || !input.part.contentFileID || !input.part.largePayload) return
  throwIfSyncAborted({
    abortSignal: input.abortSignal,
    operationID: input.operationID,
    diagnosticCode: "lcm_sync_canceled_before_large_payload_write",
  })

  const artifact = await writeLcmArtifact({
    artifactRoot: input.artifactRoot,
    bytes: input.part.largePayload.artifactBytes,
  })
  if (artifact.byteCount !== input.part.contentByteCount || artifact.sha256 !== input.part.contentSha256) {
    throw invalidRequest("lcm_large_payload_artifact_digest_mismatch")
  }

  const existing = (
    await input.db.query<ExistingLargeFileRow>(
      `
        SELECT file_id, conversation_id, source_kind, mime_type, token_estimate, token_estimate_mode,
               token_estimate_version, preview_text, artifact_storage_kind, artifact_path,
               artifact_byte_count, artifact_content_sha256
        FROM lcm_large_files
        WHERE file_id = $1
      `,
      [input.part.contentFileID],
    )
  ).rows[0]

  if (existing) {
    assertEqual("large_file_conversation", existing.conversation_id, input.conversationID)
    assertEqual("large_file_source_kind", existing.source_kind, input.part.largePayload.sourceKind)
    assertEqual("large_file_artifact_storage", existing.artifact_storage_kind, "file")
    assertEqual("large_file_artifact_path", existing.artifact_path, artifact.artifactPath)
    assertEqual("large_file_artifact_byte_count", Number(existing.artifact_byte_count), artifact.byteCount)
    assertEqual("large_file_artifact_sha256", existing.artifact_content_sha256, artifact.sha256)
    return
  }

  const now = Date.now()
  await input.db.query(
    `
      INSERT INTO lcm_large_files (
        file_id,
        conversation_id,
        source_kind,
        mime_type,
        token_estimate,
        token_estimate_mode,
        token_estimate_version,
        preview_text,
        exploration_status,
        exploration_kind,
        artifact_storage_kind,
        artifact_path,
        artifact_byte_count,
        artifact_content_sha256,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'not_started', 'none', 'file', $9, $10, $11, $12, $12)
    `,
    [
      input.part.contentFileID,
      input.conversationID,
      input.part.largePayload.sourceKind,
      input.part.largePayload.mimeType,
      input.part.largePayload.tokenEstimate,
      input.part.largePayload.tokenEstimate === null ? null : LCM_LARGE_FILE_TOKEN_COUNTER_MODE,
      input.part.largePayload.tokenEstimate === null ? null : LCM_LARGE_FILE_TOKEN_COUNTER_VERSION,
      input.part.largePayload.previewText,
      artifact.artifactPath,
      artifact.byteCount,
      artifact.sha256,
      now,
    ],
  )
}

async function findConversation(db: Queryable, conversationID: ConversationID) {
  return (
    await db.query<ConversationRow>(
      `
        SELECT conversation_id, lifecycle_state
        FROM lcm_conversations
        WHERE conversation_id = $1
      `,
      [conversationID],
    )
  ).rows[0]
}

async function findExistingMessage(db: Queryable, conversationID: ConversationID, sourceMessageID: string) {
  return (
    await db.query<ExistingMessageRow>(
      `
        SELECT *
        FROM lcm_messages
        WHERE conversation_id = $1 AND source_message_id = $2
      `,
      [conversationID, sourceMessageID],
    )
  ).rows[0]
}

async function findExistingPart(db: Queryable, messageRowID: MessageRowID, sourcePartKey: string) {
  return (
    await db.query<ExistingPartRow>(
      `
        SELECT *
        FROM lcm_message_parts
        WHERE message_row_id = $1 AND source_part_key = $2
      `,
      [messageRowID, sourcePartKey],
    )
  ).rows[0]
}

function assertMessageUnchanged(existing: ExistingMessageRow, mapped: MappedMessage) {
  assertEqual("message_source_session_id", existing.source_session_id, mapped.sourceSessionID)
  assertEqual("message_source_message_id", existing.source_message_id, mapped.sourceMessageID)
  assertEqual("message_role", existing.role, mapped.role)
  assertEqual("message_order", Number(existing.message_order), mapped.messageOrder)
  assertEqual("message_created_at", Number(existing.created_at_ms), mapped.createdAtMs)
  assertEqual("message_completed_at", numberOrNull(existing.completed_at_ms), mapped.completedAtMs)
  assertEqual("message_provider_id", existing.provider_id, mapped.providerID)
  assertEqual("message_model_id", existing.model_id, mapped.modelID)
  assertEqual("message_agent_name", existing.agent_name, mapped.agentName)
  assertEqual("message_ignored", existing.ignored, mapped.ignored)
  assertEqual("message_synthetic", existing.synthetic, mapped.synthetic)
  assertEqual("message_compatibility", existing.compatibility, mapped.compatibility)
  assertEqual("message_source_version", Number(existing.source_version), 1)
  assertJsonEqual(
    "message_metadata",
    messageMetadataForDrift(existing.metadata_json),
    messageMetadataForDrift(mapped.metadataJson),
  )
}

function assertPartUnchanged(existing: ExistingPartRow, mapped: MappedPart) {
  assertEqual("part_source_part_id", existing.source_part_id, mapped.sourcePartID)
  assertEqual("part_source_part_key", existing.source_part_key, mapped.sourcePartKey)
  assertEqual("part_order", Number(existing.part_order), mapped.partOrder)
  assertEqual("part_kind", existing.part_kind, mapped.partKind)
  assertEqual("part_ignored", existing.ignored, mapped.ignored)
  assertEqual("part_synthetic", existing.synthetic, mapped.synthetic)
  assertEqual("part_compatibility", existing.compatibility, mapped.compatibility)
  assertEqual("part_terminal_state", existing.terminal_state, mapped.terminalState)
  assertEqual("part_tool_call_id", existing.tool_call_id, mapped.toolCallID)
  assertEqual("part_tool_name", existing.tool_name, mapped.toolName)
  assertJsonEqual("part_tool_input_json", existing.tool_input_json, mapped.toolInputJson)
  if (existing.content_storage_kind === "inline" && mapped.contentStorageKind === "lcm_file") {
    assertEqual(
      "part_inline_fallback_byte_count",
      numberOrNull(existing.content_byte_count),
      mapped.inlineFallbackByteCount,
    )
    assertEqual("part_inline_fallback_sha256", existing.content_sha256, mapped.inlineFallbackSha256)
    assertEqual("part_media_mime", existing.media_mime, mapped.mediaMime)
    assertEqual("part_media_name", existing.media_name, mapped.mediaName)
    assertJsonEqual("part_provider_metadata", existing.provider_metadata_json, mapped.providerMetadataJson)
    assertJsonEqual(
      "part_render_metadata",
      partRenderMetadataForDrift(existing.render_metadata_json),
      partRenderMetadataForDrift(mapped.renderMetadataJson),
    )
    assertEqual("part_created_at", Number(existing.created_at_ms), mapped.createdAtMs)
    assertEqual("part_completed_at", numberOrNull(existing.completed_at_ms), mapped.completedAtMs)
    return
  }
  assertEqual("part_text_content", existing.text_content, mapped.textContent)
  assertEqual("part_reasoning_content", existing.reasoning_content, mapped.reasoningContent)
  assertEqual("part_tool_output_text", existing.tool_output_text, mapped.toolOutputText)
  assertEqual("part_tool_error_text", existing.tool_error_text, mapped.toolErrorText)
  assertEqual("part_file_url", existing.file_url, mapped.fileUrl)
  assertEqual("part_media_mime", existing.media_mime, mapped.mediaMime)
  assertEqual("part_media_name", existing.media_name, mapped.mediaName)
  assertJsonEqual("part_provider_metadata", existing.provider_metadata_json, mapped.providerMetadataJson)
  assertJsonEqual(
    "part_render_metadata",
    partRenderMetadataForDrift(existing.render_metadata_json),
    partRenderMetadataForDrift(mapped.renderMetadataJson),
  )
  assertEqual("part_content_storage_kind", existing.content_storage_kind, mapped.contentStorageKind)
  assertEqual("part_content_file_id", existing.content_file_id, mapped.contentFileID)
  assertEqual("part_content_byte_count", numberOrNull(existing.content_byte_count), mapped.contentByteCount)
  assertEqual("part_content_sha256", existing.content_sha256, mapped.contentSha256)
  assertEqual("part_search_text", existing.search_text, mapped.searchText)
  assertEqual("part_created_at", Number(existing.created_at_ms), mapped.createdAtMs)
  assertEqual("part_completed_at", numberOrNull(existing.completed_at_ms), mapped.completedAtMs)
}

async function insertMessage(db: Queryable, conversationID: ConversationID, mapped: MappedMessage) {
  const messageRowID = await allocateMessageRowID(db)
  await db.query(
    `
      INSERT INTO lcm_messages (
        message_row_id,
        conversation_id,
        source_session_id,
        source_message_id,
        role,
        message_order,
        created_at_ms,
        completed_at_ms,
        provider_id,
        model_id,
        agent_name,
        metadata_json,
        ignored,
        synthetic,
        compatibility,
        source_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, 1)
    `,
    [
      messageRowID,
      conversationID,
      mapped.sourceSessionID,
      mapped.sourceMessageID,
      mapped.role,
      mapped.messageOrder,
      mapped.createdAtMs,
      mapped.completedAtMs,
      mapped.providerID,
      mapped.modelID,
      mapped.agentName,
      JSON.stringify(safeJson(mapped.metadataJson)),
      mapped.ignored,
      mapped.synthetic,
      mapped.compatibility,
    ],
  )
  return messageRowID
}

async function insertPart(
  db: Queryable,
  conversationID: ConversationID,
  messageRowID: MessageRowID,
  mapped: MappedPart,
) {
  const partRowID = await allocatePartRowID(db)
  await db.query(
    `
      INSERT INTO lcm_message_parts (
        part_row_id,
        message_row_id,
        conversation_id,
        source_part_id,
        source_part_key,
        part_order,
        part_kind,
        ignored,
        synthetic,
        compatibility,
        terminal_state,
        text_content,
        reasoning_content,
        tool_call_id,
        tool_name,
        tool_input_json,
        tool_output_text,
        tool_error_text,
        file_url,
        media_mime,
        media_name,
        provider_metadata_json,
        render_metadata_json,
        content_storage_kind,
        content_file_id,
        content_byte_count,
        content_sha256,
        search_text,
        created_at_ms,
        completed_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20,
        $21, $22::jsonb, $23::jsonb, $24, $25, $26, $27, $28, $29, $30
      )
    `,
    [
      partRowID,
      messageRowID,
      conversationID,
      mapped.sourcePartID,
      mapped.sourcePartKey,
      mapped.partOrder,
      mapped.partKind,
      mapped.ignored,
      mapped.synthetic,
      mapped.compatibility,
      mapped.terminalState,
      mapped.textContent,
      mapped.reasoningContent,
      mapped.toolCallID,
      mapped.toolName,
      mapped.toolInputJson === null ? null : JSON.stringify(safeJson(mapped.toolInputJson)),
      mapped.toolOutputText,
      mapped.toolErrorText,
      mapped.fileUrl,
      mapped.mediaMime,
      mapped.mediaName,
      JSON.stringify(safeJson(mapped.providerMetadataJson)),
      JSON.stringify(safeJson(mapped.renderMetadataJson)),
      mapped.contentStorageKind,
      mapped.contentFileID,
      mapped.contentByteCount,
      mapped.contentSha256,
      mapped.searchText,
      mapped.createdAtMs,
      mapped.completedAtMs,
    ],
  )
  return partRowID
}

async function syncMappedMessages(input: {
  readonly db: PGlite
  readonly sessionID: string
  readonly conversationID: ConversationID
  readonly artifactRoot: string
  readonly operationID: OperationID
  readonly abortSignal?: AbortSignal
  readonly strategy?: LcmStrategy
  readonly forceRawContextSourceMessageID?: string
  readonly loaded: LoadedKiloMessage[]
  readonly mapped: Array<{ loaded: LoadedKiloMessage; message: MappedMessage | undefined; skippedParts: number }>
}) {
  throwIfSyncAborted({
    abortSignal: input.abortSignal,
    operationID: input.operationID,
    diagnosticCode: "lcm_sync_canceled_before_commit",
  })
  const conversation = await findConversation(input.db, input.conversationID)
  if (!conversation) throw invalidRequest("lcm_sync_conversation_not_found")

  for (let attempt = 0; attempt < 2; attempt++) {
    let insertedMessages = 0
    let insertedParts = 0
    let insertedContextItems = 0
    let skippedUnsealedMessages = 0
    let skippedUnsealedParts = 0
    const rawContextMessageRowIDs = new Set<MessageRowID>()

    try {
      await input.db.transaction(async (tx) => {
        for (const item of input.mapped) {
          throwIfSyncAborted({
            abortSignal: input.abortSignal,
            operationID: input.operationID,
            diagnosticCode: "lcm_sync_canceled_while_committing_messages",
          })
          if (!item.message) {
            if (isSupersededAssistantResidue({ loaded: input.loaded, item: item.loaded })) continue
            skippedUnsealedMessages++
            skippedUnsealedParts += item.loaded.parts.length
            continue
          }
          skippedUnsealedParts +=
            item.skippedParts -
            benignSkippedPartCount({
              loaded: input.loaded,
              item: item.loaded,
              skippedParts: item.skippedParts,
            })

          const existing = await findExistingMessage(tx, input.conversationID, item.message.sourceMessageID)
          const messageRowID = existing?.message_row_id ?? (await insertMessage(tx, input.conversationID, item.message))
          if (existing) assertMessageUnchanged(existing, item.message)
          else {
            insertedMessages++
            if (item.message.parts.length > 0) rawContextMessageRowIDs.add(messageRowID)
          }
          if (
            input.forceRawContextSourceMessageID === item.message.sourceMessageID &&
            item.message.role === "user" &&
            item.message.parts.length > 0
          ) {
            rawContextMessageRowIDs.add(messageRowID)
          }

          for (const mappedPart of item.message.parts) {
            throwIfSyncAborted({
              abortSignal: input.abortSignal,
              operationID: input.operationID,
              diagnosticCode: "lcm_sync_canceled_while_committing_parts",
            })
            const part = await partWithValidatedTruncationSidecar({
              message: item.message,
              part: mappedPart,
              abortSignal: input.abortSignal,
              operationID: input.operationID,
            })
            const existingPart = await findExistingPart(tx, messageRowID, part.sourcePartKey)
            if (existingPart) {
              if (!(existingPart.content_storage_kind === "inline" && part.contentStorageKind === "lcm_file")) {
                await ensureLargePayloadFile({
                  db: tx,
                  conversationID: input.conversationID,
                  artifactRoot: input.artifactRoot,
                  part,
                  abortSignal: input.abortSignal,
                  operationID: input.operationID,
                })
              }
              assertPartUnchanged(existingPart, part)
            } else {
              await ensureLargePayloadFile({
                db: tx,
                conversationID: input.conversationID,
                artifactRoot: input.artifactRoot,
                part,
                abortSignal: input.abortSignal,
                operationID: input.operationID,
              })
              await insertPart(tx, input.conversationID, messageRowID, part)
              insertedParts++
              rawContextMessageRowIDs.add(messageRowID)
            }
          }
        }

        if (insertedMessages > 0 || insertedParts > 0 || rawContextMessageRowIDs.size > 0) {
          throwIfSyncAborted({
            abortSignal: input.abortSignal,
            operationID: input.operationID,
            diagnosticCode: "lcm_sync_canceled_before_context_append",
          })
          if (rawContextMessageRowIDs.size > 0) {
            insertedContextItems += await appendRawMessageContextItems({
              db: tx,
              conversationID: input.conversationID,
              messageRowIDs: [...rawContextMessageRowIDs],
              strategy: input.strategy,
            })
          }
        }
        if (insertedMessages > 0 || insertedParts > 0 || insertedContextItems > 0) {
          await tx.query(
            `
              UPDATE lcm_conversations
              SET updated_at_ms = $2
              WHERE conversation_id = $1
            `,
            [input.conversationID, Date.now()],
          )
        }
      })
    } catch (error) {
      if (attempt === 0 && isSourceDriftError(error)) {
        try {
          await resetConversationSourceAfterDrift(input.db, input.conversationID)
          continue
        } catch {
          throw error
        }
      }
      throw error
    }

    return {
      sessionID: input.sessionID,
      conversationID: input.conversationID,
      insertedMessages,
      insertedParts,
      skippedUnsealedMessages,
      skippedUnsealedParts,
      idempotent: insertedMessages === 0 && insertedParts === 0 && insertedContextItems === 0,
      lifecycleState: conversation.lifecycle_state,
      ...(skippedUnsealedMessages > 0 || skippedUnsealedParts > 0
        ? { safeError: missingSource("lcm_sync_unsealed_source_skipped", input.conversationID) }
        : {}),
    } satisfies LcmSyncResult
  }

  throw invalidRequest("lcm_sync_source_drift_rebuild_retry_failed")
}

export function syncFinalizedMessages(input: {
  readonly sessionID: string
  readonly upToMessageID?: string
  readonly dataDir?: string
  readonly strategy?: LcmStrategy
  readonly abortSignal?: AbortSignal
}): Effect.Effect<LcmSyncResult, LcmSafeError, LcmDb.Service> {
  return Effect.gen(function* () {
    const operationID = createOperationID()
    throwIfSyncAborted({
      abortSignal: input.abortSignal,
      operationID,
      diagnosticCode: "lcm_sync_canceled_before_resolution",
    })
    const target = input.dataDir
      ? yield* resolveDirectTestFamilyTargetEffect({ familyRoot: input.dataDir })
      : (yield* resolveSessionFamilyTargetEffect({ sessionID: input.sessionID })).target
    const dataDir = target.familyRoot
    const artifactRoot = resolveLcmDbLayout(dataDir).artifactsDir
    const conversationID = yield* getOrCreateConversation({
      sessionID: input.sessionID,
      dataDir,
      abortSignal: input.abortSignal,
    })
    const loaded = yield* loadKiloMessages({ ...input, operationID })
    const mapped = yield* Effect.try({
      try: () =>
        loaded.map((item) => {
          throwIfSyncAborted({
            abortSignal: input.abortSignal,
            operationID,
            diagnosticCode: "lcm_sync_canceled_while_mapping_source",
          })
          const message = mapMessage(item)
          const skippedParts = message ? item.parts.length - message.parts.length : 0
          return { loaded: item, message, skippedParts }
        }),
      catch: coerceSyncError,
    })
    const lcmDbRoot = yield* LcmDb.Service
    const lcmDb = LcmDb.scoped(lcmDbRoot, target)

    return yield* lcmDb.executeForeground({
      operationID,
      purpose: "sync",
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      run: (db, control) =>
        syncMappedMessages({
          db: db as PGlite,
          sessionID: input.sessionID,
          conversationID,
          artifactRoot,
          operationID,
          abortSignal: control?.abortSignal ?? input.abortSignal,
          strategy: input.strategy,
          forceRawContextSourceMessageID: input.upToMessageID,
          loaded,
          mapped,
        }),
    })
  })
}

export function syncFinalizedMessagesStandalone(input: {
  readonly sessionID: string
  readonly upToMessageID?: string
  readonly dataDir?: string
  readonly strategy?: LcmStrategy
}) {
  return Effect.runPromise(
    syncFinalizedMessages(input).pipe(
      Effect.ensuring(LcmDb.Service.use((db) => db.close()).pipe(Effect.ignore)),
      Effect.provide(LcmDb.defaultLayer),
    ),
  )
}
