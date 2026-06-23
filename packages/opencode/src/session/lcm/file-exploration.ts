// kilocode_change - new file
import path from "node:path"
import { TextDecoder } from "node:util"
import { RUNTIME_DEFAULTS } from "./config"
import { renderLcmPromptRequest, type LcmRenderedPromptRequest } from "./prompts"
import { parseLcmSafeError } from "./safe-error-schema"
import {
  loadLargeFileStatus,
  readLargeFileRowWindow,
  type LcmLargeFileRow,
  type LcmPathPermissionCheck,
} from "./large-files"
import type {
  ConversationID,
  LcmFileExplorerKind,
  LcmFileID,
  LcmFileStatus,
  LcmFileStatusReason,
  LcmPromptVersion,
  LcmSafeError,
  LcmUsageRecord,
  OperationID,
} from "./types"

interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export const LCM_FILE_EXPLORATION_PROMPT_VERSION = "file-exploration-summary-v2" satisfies LcmPromptVersion

export interface LcmFileExplorationUsage {
  providerID?: string
  modelID?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costAmount?: number
  costCurrency?: string
  costStatus?: LcmUsageRecord["costStatus"]
}

export interface LcmFileExplorationGeneratorInput {
  operationID: OperationID
  conversationID: ConversationID
  fileID: LcmFileID
  promptVersion: typeof LCM_FILE_EXPLORATION_PROMPT_VERSION
  prompt: string
  request: LcmRenderedPromptRequest
  fileSample: string
  sampled: boolean
  abortSignalID?: string
  abortSignal?: AbortSignal
}

export interface LcmFileExplorationGeneratorOutput {
  text: string
  usage?: LcmFileExplorationUsage
}

export type LcmFileExplorationGenerator = (
  input: LcmFileExplorationGeneratorInput,
) => Promise<string | LcmFileExplorationGeneratorOutput>

export interface LcmFileExplorationOutcome {
  fileID: LcmFileID
  conversationID: ConversationID
  explorationStatus: LcmFileStatus["explorationStatus"]
  explorerKind: LcmFileExplorerKind
  safeReason?: LcmFileStatusReason
  sampled: boolean
  sampleBytes: number
  summaryText?: string
  promptVersion?: typeof LCM_FILE_EXPLORATION_PROMPT_VERSION
  usage?: LcmFileExplorationUsage
}

export interface LcmFileExplorationLimits {
  sampleBytes?: number
  maxFullLoadBytes?: number
  maxOutputTokens?: number
  overLimitBytes?: number
  timeoutMs?: number
}

function asNumber(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined) return 0
  return typeof value === "bigint" ? Number(value) : Number(value)
}

function mime(row: LcmLargeFileRow) {
  return row.mime_type?.toLocaleLowerCase() ?? ""
}

function originalExt(row: LcmLargeFileRow) {
  const source = row.original_path ?? ""
  return path.extname(source).toLocaleLowerCase()
}

function isHtml(row: LcmLargeFileRow) {
  const m = mime(row)
  const ext = originalExt(row)
  return m.includes("html") || ext === ".html" || ext === ".htm" || ext === ".xhtml"
}

function helperBackedKind(
  row: LcmLargeFileRow,
): Exclude<LcmFileExplorerKind, "none" | "text" | "html" | "unknown"> | undefined {
  const m = mime(row)
  const ext = originalExt(row)
  if (m === "application/pdf" || ext === ".pdf") return "pdf"
  if (
    row.source_kind === "image" ||
    m.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)
  ) {
    return "image"
  }
  if (
    m === "application/vnd.sqlite3" ||
    m === "application/x-sqlite3" ||
    ext === ".sqlite" ||
    ext === ".sqlite3" ||
    ext === ".db"
  ) {
    return "sqlite"
  }
  return undefined
}

function isTextMetadata(row: LcmLargeFileRow) {
  const m = mime(row)
  const ext = originalExt(row)
  return (
    row.source_kind === "inline" ||
    row.source_kind === "tool_output" ||
    row.source_kind === "map_input" ||
    row.source_kind === "map_output" ||
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/ecmascript" ||
    m === "application/typescript" ||
    m.endsWith("+json") ||
    m.endsWith("+xml") ||
    [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".jsonl",
      ".ndjson",
      ".xml",
      ".yml",
      ".yaml",
      ".toml",
      ".ini",
      ".log",
      ".csv",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".css",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cc",
      ".cpp",
      ".h",
      ".hpp",
      ".sh",
      ".sql",
    ].includes(ext)
  )
}

function totalBytes(row: LcmLargeFileRow) {
  return row.source_kind === "path" ? asNumber(row.path_size_bytes) : asNumber(row.artifact_byte_count)
}

function validUtf8(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function looksBinary(text: string) {
  if (text.includes("\u0000")) return true
  if (text.length === 0) return false
  let controls = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t") controls++
  }
  return controls / text.length > 0.2
}

function capUtf8(text: string, maxBytes: number) {
  const bytes = Buffer.from(text)
  if (bytes.byteLength <= maxBytes) return text
  return bytes
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/g, "")
}

function cleanText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function hasHtmlActiveContent(html: string) {
  return (
    /<\s*(script|iframe|object|embed|applet|base|meta)\b/i.test(html) ||
    /\son[a-z]+\s*=/i.test(html) ||
    /javascript\s*:/i.test(html)
  )
}

function stripHtml(html: string) {
  return cleanText(
    html
      .replace(/<\s*(script|style|noscript|iframe|object|embed|applet)[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " "),
  )
}

function htmlMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern)
  return match?.[1] ? stripHtml(match[1]) : undefined
}

function htmlHeadings(html: string) {
  const headings: string[] = []
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null && headings.length < 12) {
    const text = stripHtml(match[2] ?? "")
    if (text) headings.push(`h${match[1]} ${capUtf8(text, 160)}`)
  }
  return headings
}

function lineCount(text: string) {
  if (text.length === 0) return 0
  return text.split("\n").length
}

function boundedSummary(input: {
  kind: "text" | "html"
  text: string
  sampled: boolean
  sampleBytes: number
  maxBytes: number
  html?: string
}) {
  const sample = capUtf8(input.text, Math.max(0, input.maxBytes - 512))
  const lines = [
    `Explorer: ${input.kind}`,
    `Coverage: ${input.sampled ? "sampled" : "complete"}`,
    `Bytes analyzed: ${input.sampleBytes}`,
  ]
  if (input.kind === "text") {
    lines.push(`Lines observed: ${lineCount(input.text)}`)
  } else {
    const title = input.html ? htmlMatch(input.html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) : undefined
    const headings = input.html ? htmlHeadings(input.html) : []
    if (title) lines.push(`Title: ${capUtf8(title, 240)}`)
    if (headings.length > 0) lines.push(`Headings: ${headings.join("; ")}`)
    lines.push(`Text characters observed: ${input.text.length}`)
  }
  if (sample) {
    lines.push("", "Bounded extracted text:", sample)
  }
  return capUtf8(lines.join("\n"), input.maxBytes)
}

function terminalOutcome(
  input: Omit<LcmFileExplorationOutcome, "fileID" | "conversationID"> & { row: LcmLargeFileRow },
) {
  return {
    fileID: input.row.file_id,
    conversationID: input.row.conversation_id,
    explorationStatus: input.explorationStatus,
    explorerKind: input.explorerKind,
    ...(input.safeReason ? { safeReason: input.safeReason } : {}),
    sampled: input.sampled,
    sampleBytes: input.sampleBytes,
    ...(input.summaryText ? { summaryText: input.summaryText } : {}),
    ...(input.promptVersion ? { promptVersion: input.promptVersion } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
  } satisfies LcmFileExplorationOutcome
}

function staleReason(row: LcmLargeFileRow, error: LcmSafeError): LcmFileStatusReason {
  if (error.code === "permission_denied" || error.code === "unauthorized") return "permission_denied"
  return row.source_kind === "path" ? "stale_source" : "artifact_invalid"
}

async function readSample(input: {
  row: LcmLargeFileRow
  artifactRoot: string
  bytesToRead: number
  permissionCheck?: LcmPathPermissionCheck
  abortSignal?: AbortSignal
}) {
  return readLargeFileRowWindow({
    row: input.row,
    artifactRoot: input.artifactRoot,
    window: {
      byteOffset: 0,
      maxBytes: input.bytesToRead,
    },
    permissionCheck: input.permissionCheck,
    abortSignal: input.abortSignal,
  })
}

async function runWithTimeout<T>(input: {
  timeoutMs?: number
  abortSignal?: AbortSignal
  run: (abortSignal?: AbortSignal) => Promise<T>
}): Promise<{ ok: true; value: T } | { ok: false; status: "timeout" | "canceled" }> {
  if (input.abortSignal?.aborted) return { ok: false, status: "canceled" }
  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) return { ok: false, status: "timeout" }

  if (input.timeoutMs === undefined && !input.abortSignal) return { ok: true, value: await input.run(undefined) }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  input.abortSignal?.addEventListener("abort", onAbort, { once: true })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const statusPromise = new Promise<{ ok: false; status: "timeout" | "canceled" }>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        if (!timedOut) resolve({ ok: false, status: "canceled" })
      },
      { once: true },
    )
    if (input.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        resolve({ ok: false, status: "timeout" })
      }, input.timeoutMs)
    }
  })
  const runPromise = Promise.resolve()
    .then(() => input.run(controller.signal))
    .then((value) => ({ ok: true, value }) as const)
  runPromise.catch(() => undefined)

  try {
    return await Promise.race([runPromise, statusPromise])
  } catch (error) {
    const safeError = parseLcmSafeError(error)
    if (timedOut) return { ok: false, status: "timeout" }
    if (input.abortSignal?.aborted || safeError?.code === "canceled") return { ok: false, status: "canceled" }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    input.abortSignal?.removeEventListener("abort", onAbort)
  }
}

export function renderFileExplorationSummaryPrompt(fileSample: string) {
  return renderFileExplorationSummaryPromptRequest(fileSample).prompt
}

export function renderFileExplorationSummaryPromptRequest(fileSample: string) {
  return renderLcmPromptRequest(LCM_FILE_EXPLORATION_PROMPT_VERSION, { file_sample: fileSample })
}

export async function exploreLargeFileRow(input: {
  row: LcmLargeFileRow
  artifactRoot: string
  operationID: OperationID
  generator?: LcmFileExplorationGenerator
  permissionCheck?: LcmPathPermissionCheck
  limits?: LcmFileExplorationLimits
  abortSignal?: AbortSignal
}): Promise<LcmFileExplorationOutcome> {
  const limits = {
    sampleBytes: input.limits?.sampleBytes ?? RUNTIME_DEFAULTS.largePayloads.explorationSampleBytes,
    maxFullLoadBytes: input.limits?.maxFullLoadBytes ?? RUNTIME_DEFAULTS.largePayloads.explorationMaxFullLoadBytes,
    maxOutputTokens: input.limits?.maxOutputTokens ?? RUNTIME_DEFAULTS.largePayloads.explorationMaxOutputTokens,
    overLimitBytes: input.limits?.overLimitBytes,
    timeoutMs: input.limits?.timeoutMs,
  }

  const helperKind = helperBackedKind(input.row)
  if (helperKind) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: "unavailable",
      explorerKind: helperKind,
      safeReason: "missing_helper",
      sampled: false,
      sampleBytes: 0,
    })
  }

  const bytesTotal = totalBytes(input.row)
  if (limits.overLimitBytes !== undefined && bytesTotal > limits.overLimitBytes) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: "over_limit",
      explorerKind: isHtml(input.row) ? "html" : isTextMetadata(input.row) ? "text" : "unknown",
      safeReason: "over_limit",
      sampled: false,
      sampleBytes: 0,
    })
  }

  const sampled = bytesTotal > limits.maxFullLoadBytes
  const bytesToRead = Math.max(0, Math.min(bytesTotal, sampled ? limits.sampleBytes : limits.maxFullLoadBytes))
  const read = await runWithTimeout({
    timeoutMs: limits.timeoutMs,
    abortSignal: input.abortSignal,
    run: (abortSignal) =>
      readSample({
        row: input.row,
        artifactRoot: input.artifactRoot,
        bytesToRead,
        permissionCheck: input.permissionCheck,
        abortSignal,
      }),
  }).catch((error) => {
    const safeError = parseLcmSafeError(error)
    if (safeError) {
      return terminalOutcome({
        row: input.row,
        explorationStatus: "unavailable",
        explorerKind: isHtml(input.row) ? "html" : isTextMetadata(input.row) ? "text" : "unknown",
        safeReason: staleReason(input.row, safeError),
        sampled: false,
        sampleBytes: 0,
      })
    }
    return terminalOutcome({
      row: input.row,
      explorationStatus: "failed",
      explorerKind: isHtml(input.row) ? "html" : isTextMetadata(input.row) ? "text" : "unknown",
      safeReason: "helper_failed",
      sampled: false,
      sampleBytes: 0,
    })
  })

  if (!("ok" in read)) return read
  if (!read.ok) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: read.status,
      explorerKind: isHtml(input.row) ? "html" : isTextMetadata(input.row) ? "text" : "unknown",
      safeReason: read.status,
      sampled: false,
      sampleBytes: 0,
    })
  }

  const result = read.value
  const bytes =
    result.encoding === "base64" ? Buffer.from(result.content, "base64") : Buffer.from(result.content, "utf8")
  const decoded = validUtf8(bytes)
  const kind: LcmFileExplorerKind = isHtml(input.row)
    ? "html"
    : isTextMetadata(input.row) || decoded !== undefined
      ? "text"
      : "unknown"
  if (decoded === undefined || looksBinary(decoded)) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: kind === "unknown" ? "unavailable" : "corrupt",
      explorerKind: kind,
      safeReason: kind === "unknown" ? "unsupported_type" : "corrupt_input",
      sampled: false,
      sampleBytes: bytes.byteLength,
    })
  }

  const text = cleanText(decoded)
  if (kind === "html" && hasHtmlActiveContent(decoded)) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: "unsafe",
      explorerKind: "html",
      safeReason: "unsafe_active_content",
      sampled,
      sampleBytes: bytes.byteLength,
    })
  }

  const extracted = kind === "html" ? stripHtml(decoded) : text
  const maxSummaryBytes = Math.max(512, limits.maxOutputTokens * 4)
  const deterministicSummary = boundedSummary({
    kind: kind === "html" ? "html" : "text",
    text: extracted,
    html: kind === "html" ? decoded : undefined,
    sampled,
    sampleBytes: bytes.byteLength,
    maxBytes: maxSummaryBytes,
  })

  if (!input.generator) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: sampled ? "sampled" : "completed",
      explorerKind: kind,
      safeReason: sampled ? "sampled" : undefined,
      sampled,
      sampleBytes: bytes.byteLength,
      summaryText: deterministicSummary,
    })
  }

  const request = renderFileExplorationSummaryPromptRequest(deterministicSummary)
  const prompt = request.prompt
  const generated = await runWithTimeout({
    timeoutMs: limits.timeoutMs,
    abortSignal: input.abortSignal,
    run: async (abortSignal) =>
      input.generator!({
        operationID: input.operationID,
        conversationID: input.row.conversation_id,
        fileID: input.row.file_id,
        promptVersion: LCM_FILE_EXPLORATION_PROMPT_VERSION,
        prompt,
        request,
        fileSample: deterministicSummary,
        sampled,
        abortSignal,
      }),
  }).catch(() => undefined)

  if (generated === undefined) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: "failed",
      explorerKind: kind,
      safeReason: "helper_failed",
      sampled,
      sampleBytes: bytes.byteLength,
    })
  }
  if (!generated.ok) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: generated.status,
      explorerKind: kind,
      safeReason: generated.status,
      sampled,
      sampleBytes: bytes.byteLength,
    })
  }

  const output = typeof generated.value === "string" ? { text: generated.value } : generated.value
  const providerSummary = capUtf8(output.text.trim(), maxSummaryBytes)
  if (providerSummary.length === 0) {
    return terminalOutcome({
      row: input.row,
      explorationStatus: "failed",
      explorerKind: kind,
      safeReason: "helper_failed",
      sampled,
      sampleBytes: bytes.byteLength,
    })
  }
  return terminalOutcome({
    row: input.row,
    explorationStatus: sampled ? "sampled" : "completed",
    explorerKind: kind,
    safeReason: sampled ? "sampled" : undefined,
    sampled,
    sampleBytes: bytes.byteLength,
    summaryText: providerSummary,
    promptVersion: LCM_FILE_EXPLORATION_PROMPT_VERSION,
    ...(output.usage ? { usage: output.usage } : {}),
  })
}

export async function updateLargeFileExplorationStatus(input: {
  db: Queryable
  fileID: LcmFileID
  status: LcmFileStatus["explorationStatus"]
  explorerKind: LcmFileExplorerKind
  safeReason?: LcmFileStatusReason
  sampled?: boolean
  sampleBytes?: number
  summaryText?: string | null
  promptVersion?: typeof LCM_FILE_EXPLORATION_PROMPT_VERSION | null
  usageRecordID?: string | null
  nowMs?: number
}) {
  const now = input.nowMs ?? Date.now()
  await input.db.query(
    `
      UPDATE lcm_large_files
      SET exploration_status = $2,
          exploration_kind = $3,
          exploration_safe_reason = $4,
          exploration_sampled = $5,
          exploration_sample_bytes = $6,
          exploration_summary_text = $7,
          exploration_prompt_version = $8,
          exploration_usage_record_id = $9,
          exploration_updated_at_ms = $10,
          updated_at_ms = $10
      WHERE file_id = $1
    `,
    [
      input.fileID,
      input.status,
      input.explorerKind,
      input.safeReason ?? null,
      input.sampled ?? false,
      input.sampleBytes ?? 0,
      input.summaryText ?? null,
      input.promptVersion ?? null,
      input.usageRecordID ?? null,
      now,
    ],
  )
  await input.db.query(
    `
      UPDATE lcm_context_items
      SET token_count = NULL,
          cache_key = NULL,
          cache_version = NULL,
          updated_at_ms = $2
      WHERE item_type = 'large_file_marker'
        AND file_id = $1
    `,
    [input.fileID, now],
  )
  return loadLargeFileStatus(input.db, input.fileID)
}
