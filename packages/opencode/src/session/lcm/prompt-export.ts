// kilocode_change - new file
import fs from "node:fs/promises"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import { readAndValidateLcmArtifact, renderLargeFileMarker } from "./artifacts"
import { resolveLcmDbLayout } from "./db-layout"
import { renderFileExplorationSummaryPromptRequest } from "./file-exploration"
import { renderLcmPromptRequest, type LcmRenderedPromptRequest } from "./prompts"
import {
  LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  LCM_CONDENSE_SUMMARY_PROMPT_VERSION,
  LCM_LEAF_SUMMARY_PROMPT_VERSION,
  renderCondenseSummaryPromptRequest,
  renderLeafSummaryPromptRequest,
  renderSummaryWrapper,
  type LcmCondenseSummarySourceItem,
  type LcmLeafSummarySourceItem,
} from "./summary"
import type {
  ConversationID,
  LcmFileID,
  LcmPromptExportReport,
  LcmPromptVersion,
  MessageRowID,
  OperationID,
  SummaryID,
} from "./types"
import { canonicalJson } from "./validators"

interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

interface ConversationRow {
  conversation_id: ConversationID
  lifecycle_state: string
  updated_at_ms: number | string | bigint
}

interface MessageRow {
  message_row_id: MessageRowID
  source_session_id: string
  source_message_id: string
  role: "user" | "assistant"
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
}

interface PartRow {
  part_row_id: string
  message_row_id: MessageRowID
  part_order: number | string | bigint
  part_kind: string
  ignored: boolean
  synthetic: boolean
  compatibility: boolean
  terminal_state: "completed" | "error" | null
  text_content: string | null
  reasoning_content: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_input_json: unknown
  tool_output_text: string | null
  tool_error_text: string | null
  file_url: string | null
  media_mime: string | null
  media_name: string | null
  provider_metadata_json: unknown
  render_metadata_json: unknown
  content_storage_kind: "inline" | "lcm_file"
  content_file_id: LcmFileID | null
  content_byte_count: number | string | bigint | null
  content_sha256: string | null
  search_text: string
  created_at_ms: number | string | bigint
  completed_at_ms: number | string | bigint | null
}

interface ContextItemRow {
  context_item_id: string
  conversation_id: ConversationID
  item_order: number | string | bigint
  item_type: "raw_message" | "summary" | "archive_stub" | "large_file_marker" | "retrieval_cue"
  message_row_id: MessageRowID | null
  summary_id: SummaryID | null
  pointer_id: string | null
  file_id: LcmFileID | null
  cue_payload_json: unknown
  cue_id: string | null
  cue_lifecycle_state: string | null
  cue_target_source_message_id: string | null
  cue_generation_id: string | null
  token_count: number | string | bigint | null
  created_at_ms: number | string | bigint
  updated_at_ms: number | string | bigint
}

interface SnapshotRow {
  snapshot_id: string
  created_at_ms: number | string | bigint
  metrics_json: unknown
  restore_manifest_json: unknown
}

interface SummaryRow {
  summary_id: SummaryID
  summary_type: "sprig" | "bindle" | "archive_stub"
  content_text: string
  source_token_count: number | string | bigint
  summary_token_count: number | string | bigint
  summary_level: number | string | bigint
  prompt_version: LcmPromptVersion
  strategy: string
  provider_id: string | null
  model_id: string | null
  objective_status: string
  fallback_mode: string
  created_at_ms: number | string | bigint
}

interface SummaryMessageRow {
  summary_id: SummaryID
  message_row_id: MessageRowID
  source_order: number | string | bigint
}

interface SummaryParentRow {
  summary_id: SummaryID
  parent_summary_id: SummaryID
  parent_order: number | string | bigint
}

interface LargeFileRow {
  file_id: LcmFileID
  conversation_id: ConversationID
  source_kind: string
  original_path: string | null
  canonical_path: string | null
  path_size_bytes: number | string | bigint | null
  path_content_sha256: string | null
  mime_type: string | null
  preview_text: string | null
  exploration_summary_text: string | null
  exploration_status: string
  exploration_kind: string
  exploration_safe_reason: string | null
  exploration_sampled: boolean
  exploration_sample_bytes: number | string | bigint
  exploration_prompt_version: LcmPromptVersion | null
  artifact_storage_kind: "none" | "file"
  artifact_path: string | null
  artifact_byte_count: number | string | bigint
  artifact_content_sha256: string | null
  created_at_ms: number | string | bigint
  updated_at_ms: number | string | bigint
}

interface MapRunRow {
  map_id: string
  tool_kind: "llm_map" | "agentic_map"
  status: string
  input_file_id: LcmFileID
  prompt_text: string
  schema_json: unknown
  model_selection_json: unknown
  agentic_mode: string | null
  created_at_ms: number | string | bigint
}

interface MapItemRow {
  map_id: string
  item_index: number | string | bigint
  attempts: number | string | bigint
  status: string
  output_json: unknown
  created_at_ms: number | string | bigint
  updated_at_ms: number | string | bigint
}

interface ExportData {
  conversation: ConversationRow
  messages: MessageRow[]
  parts: PartRow[]
  contextItems: ContextItemRow[]
  snapshots: SnapshotRow[]
  summaries: SummaryRow[]
  summaryMessages: SummaryMessageRow[]
  summaryParents: SummaryParentRow[]
  largeFiles: LargeFileRow[]
  mapRuns: MapRunRow[]
  mapItems: MapItemRow[]
}

interface ExportFile {
  filename: string
  title: string
  kind: string
}

interface ManifestItem {
  itemType?: string
  messageRowID?: string
  summaryID?: string
  pointerID?: string
  fileID?: string
  cueID?: string
  cuePayload?: unknown
  cueLifecycleState?: string
}

const REPLACEMENT_REASONS = new Set(["leaf_summary", "condensation", "hard_limit", "archive_stub"])

function asNumber(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined) return 0
  return typeof value === "bigint" ? Number(value) : Number(value)
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeSegment(value: string) {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "unnamed"
  )
}

function timestampForFolder(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("")
}

function maxBacktickRun(text: string) {
  return Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
}

function fence(text: string, language = "") {
  const ticks = "`".repeat(Math.max(3, maxBacktickRun(text) + 1))
  const suffix = language ? language : ""
  return `${ticks}${suffix}\n${text}\n${ticks}`
}

function formatJson(value: unknown) {
  return JSON.stringify(jsonValue(value), null, 2)
}

function section(title: string, body: string | undefined) {
  return body === undefined || body.length === 0 ? "" : `\n## ${title}\n\n${body.trimEnd()}\n`
}

function renderPromptRequest(request: LcmRenderedPromptRequest) {
  return [
    `Prompt version: \`${request.promptVersion}\``,
    section("System", fence(request.system, "text")),
    section("User", fence(request.user, "text")),
    section("Combined Prompt", fence(request.prompt, "text")),
  ].join("\n")
}

async function createUniqueExportDir(workspaceRoot: string, sessionID: string) {
  const root = path.join(workspaceRoot, "lcm-export")
  await fs.mkdir(root, { recursive: true })
  const base = `${timestampForFolder()}-${safeSegment(sessionID)}`
  for (let index = 0; index < 100; index++) {
    const dir = path.join(root, index === 0 ? base : `${base}-${index + 1}`)
    try {
      await fs.mkdir(dir)
      return dir
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: string }).code
          : undefined
      if (code !== "EEXIST") throw error
    }
  }
  throw new Error("lcm_prompt_export_unique_dir_exhausted")
}

async function loadExportData(db: Queryable, conversationID: ConversationID): Promise<ExportData> {
  const conversation = (
    await db.query<ConversationRow>(
      `
        SELECT conversation_id, lifecycle_state, updated_at_ms
        FROM lcm_conversations
        WHERE conversation_id = $1
      `,
      [conversationID],
    )
  ).rows[0]
  if (!conversation) throw new Error("lcm_prompt_export_conversation_not_found")

  const [
    messages,
    parts,
    contextItems,
    snapshots,
    summaries,
    summaryMessages,
    summaryParents,
    largeFiles,
    mapRuns,
    mapItems,
  ] = await Promise.all([
    db.query<MessageRow>(
      `
        SELECT message_row_id, source_session_id, source_message_id, role, message_order, created_at_ms,
               completed_at_ms, provider_id, model_id, agent_name, metadata_json, ignored, synthetic, compatibility
        FROM lcm_messages
        WHERE conversation_id = $1
        ORDER BY message_order, message_row_id
      `,
      [conversationID],
    ),
    db.query<PartRow>(
      `
        SELECT part_row_id, message_row_id, part_order, part_kind, ignored, synthetic, compatibility, terminal_state,
               text_content, reasoning_content, tool_call_id, tool_name, tool_input_json, tool_output_text,
               tool_error_text, file_url, media_mime, media_name, provider_metadata_json, render_metadata_json,
               content_storage_kind, content_file_id, content_byte_count, content_sha256, search_text, created_at_ms,
               completed_at_ms
        FROM lcm_message_parts
        WHERE conversation_id = $1
        ORDER BY message_row_id, part_order, part_row_id
      `,
      [conversationID],
    ),
    db.query<ContextItemRow>(
      `
        SELECT context_item_id, conversation_id, item_order, item_type, message_row_id, summary_id, pointer_id, file_id,
               cue_payload_json, cue_id, cue_lifecycle_state, cue_target_source_message_id, cue_generation_id,
               token_count, created_at_ms, updated_at_ms
        FROM lcm_context_items
        WHERE conversation_id = $1
        ORDER BY item_order, context_item_id
      `,
      [conversationID],
    ),
    db.query<SnapshotRow>(
      `
        SELECT snapshot_id, created_at_ms, metrics_json, restore_manifest_json
        FROM lcm_context_snapshots
        WHERE conversation_id = $1
        ORDER BY created_at_ms, snapshot_id
      `,
      [conversationID],
    ),
    db.query<SummaryRow>(
      `
        SELECT summary_id, summary_type, content_text, source_token_count, summary_token_count, summary_level,
               prompt_version, strategy, provider_id, model_id, objective_status, fallback_mode, created_at_ms
        FROM lcm_summaries
        WHERE conversation_id = $1
        ORDER BY created_at_ms, summary_id
      `,
      [conversationID],
    ),
    db.query<SummaryMessageRow>(
      `
        SELECT summary_id, message_row_id, source_order
        FROM lcm_summary_messages
        WHERE summary_id IN (SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1)
        ORDER BY summary_id, source_order
      `,
      [conversationID],
    ),
    db.query<SummaryParentRow>(
      `
        SELECT summary_id, parent_summary_id, parent_order
        FROM lcm_summary_parents
        WHERE summary_id IN (SELECT summary_id FROM lcm_summaries WHERE conversation_id = $1)
        ORDER BY summary_id, parent_order
      `,
      [conversationID],
    ),
    db.query<LargeFileRow>(
      `
        SELECT file_id, conversation_id, source_kind, original_path, canonical_path, path_size_bytes,
               path_content_sha256, mime_type, preview_text, exploration_summary_text, exploration_status,
               exploration_kind, exploration_safe_reason, exploration_sampled, exploration_sample_bytes,
               exploration_prompt_version, artifact_storage_kind, artifact_path, artifact_byte_count,
               artifact_content_sha256, created_at_ms, updated_at_ms
        FROM lcm_large_files
        WHERE conversation_id = $1
        ORDER BY created_at_ms, file_id
      `,
      [conversationID],
    ),
    db.query<MapRunRow>(
      `
        SELECT map_id, tool_kind, status, input_file_id, prompt_text, schema_json, model_selection_json,
               agentic_mode, created_at_ms
        FROM lcm_map_runs
        WHERE conversation_id = $1
        ORDER BY created_at_ms, map_id
      `,
      [conversationID],
    ),
    db.query<MapItemRow>(
      `
        SELECT map_id, item_index, attempts, status, output_json, created_at_ms, updated_at_ms
        FROM lcm_map_items
        WHERE map_id IN (SELECT map_id FROM lcm_map_runs WHERE conversation_id = $1)
        ORDER BY map_id, item_index
      `,
      [conversationID],
    ),
  ])

  return {
    conversation,
    messages: messages.rows,
    parts: parts.rows,
    contextItems: contextItems.rows,
    snapshots: snapshots.rows,
    summaries: summaries.rows,
    summaryMessages: summaryMessages.rows,
    summaryParents: summaryParents.rows,
    largeFiles: largeFiles.rows,
    mapRuns: mapRuns.rows,
    mapItems: mapItems.rows,
  }
}

function buildIndexes(data: ExportData) {
  const messages = new Map(data.messages.map((row) => [row.message_row_id, row] as const))
  const partsByMessage = new Map<MessageRowID, PartRow[]>()
  for (const part of data.parts) {
    const parts = partsByMessage.get(part.message_row_id) ?? []
    parts.push(part)
    partsByMessage.set(part.message_row_id, parts)
  }
  const summaries = new Map(data.summaries.map((row) => [row.summary_id, row] as const))
  const largeFiles = new Map(data.largeFiles.map((row) => [row.file_id, row] as const))
  const summaryMessages = new Map<SummaryID, SummaryMessageRow[]>()
  for (const row of data.summaryMessages) {
    const rows = summaryMessages.get(row.summary_id) ?? []
    rows.push(row)
    summaryMessages.set(row.summary_id, rows)
  }
  const summaryParents = new Map<SummaryID, SummaryParentRow[]>()
  for (const row of data.summaryParents) {
    const rows = summaryParents.get(row.summary_id) ?? []
    rows.push(row)
    summaryParents.set(row.summary_id, rows)
  }
  const mapItems = new Map<string, MapItemRow[]>()
  for (const row of data.mapItems) {
    const rows = mapItems.get(row.map_id) ?? []
    rows.push(row)
    mapItems.set(row.map_id, rows)
  }
  return { messages, partsByMessage, summaries, largeFiles, summaryMessages, summaryParents, mapItems }
}

function rawFallbackText(input: { message: MessageRow; parts: PartRow[] }) {
  return [input.message.role, ...input.parts.map((part) => `${part.part_kind}\n${part.search_text}`), ""].join("\n")
}

function renderLargeFile(row: LargeFileRow) {
  const byteCount = row.source_kind === "path" ? asNumber(row.path_size_bytes) : asNumber(row.artifact_byte_count)
  const sha256 = row.source_kind === "path" ? row.path_content_sha256 : row.artifact_content_sha256
  return renderLargeFileMarker({
    fileID: row.file_id,
    sourceKind: row.source_kind,
    byteCount,
    sha256: sha256 ?? "unknown",
    explorationStatus: row.exploration_status,
    previewText: row.preview_text,
  })
}

function renderPart(part: PartRow, largeFiles: Map<LcmFileID, LargeFileRow>) {
  const flags = [
    part.ignored ? "ignored" : undefined,
    part.synthetic ? "synthetic" : undefined,
    part.compatibility ? "compatibility" : undefined,
    part.content_storage_kind === "lcm_file" ? `large-payload:${part.content_file_id}` : undefined,
  ].filter(Boolean)
  const lines = [
    `### Part ${part.part_order}: ${part.part_kind} (${part.part_row_id})`,
    flags.length ? `Flags: ${flags.join(", ")}` : undefined,
  ].filter((line): line is string => !!line)

  const largeFile = part.content_file_id ? largeFiles.get(part.content_file_id) : undefined
  if (largeFile) {
    lines.push(fence(renderLargeFile(largeFile), "text"))
    return lines.join("\n\n")
  }

  if (part.part_kind === "text") lines.push(fence(part.text_content ?? "", "text"))
  else if (part.part_kind === "reasoning") lines.push(fence(part.reasoning_content ?? "", "text"))
  else if (part.part_kind === "file") {
    lines.push(`URL: ${part.file_url ?? "unknown"}`)
    lines.push(`MIME: ${part.media_mime ?? "unknown"}`)
    if (part.media_name) lines.push(`Name: ${part.media_name}`)
  } else if (part.part_kind === "tool") {
    lines.push(`Tool: ${part.tool_name ?? "unknown"}`)
    lines.push(`Call ID: ${part.tool_call_id ?? "unknown"}`)
    lines.push(`State: ${part.terminal_state ?? "unknown"}`)
    if (part.tool_input_json !== null)
      lines.push(section("Tool Input", fence(formatJson(part.tool_input_json), "json")))
    if (part.tool_output_text !== null) lines.push(section("Tool Output", fence(part.tool_output_text, "text")))
    if (part.tool_error_text !== null) lines.push(section("Tool Error", fence(part.tool_error_text, "text")))
  } else if (part.search_text) {
    lines.push(fence(part.search_text, "text"))
  } else {
    lines.push(fence(formatJson(jsonValue(part.render_metadata_json)), "json"))
  }

  return lines.join("\n\n")
}

function renderMessage(input: { message: MessageRow; parts: PartRow[]; largeFiles: Map<LcmFileID, LargeFileRow> }) {
  const header = [
    `## ${input.message.role} message ${input.message.message_row_id}`,
    `Source message: \`${input.message.source_message_id}\``,
    `Order: ${input.message.message_order}`,
    input.message.agent_name ? `Agent: ${input.message.agent_name}` : undefined,
    input.message.provider_id && input.message.model_id
      ? `Model: ${input.message.provider_id}/${input.message.model_id}`
      : undefined,
  ].filter((line): line is string => !!line)
  const parts = input.parts.map((part) => renderPart(part, input.largeFiles)).join("\n\n")
  return `${header.join("\n")}\n\n${parts || "_No parts._"}`
}

function summaryWrapper(row: SummaryRow, parentIDs: SummaryID[] = []) {
  return renderSummaryWrapper({
    summaryID: row.summary_id,
    contentText: row.content_text,
    parentSummaryIDs: parentIDs,
    objectiveStatus: row.objective_status as never,
    fallbackMode: row.fallback_mode as never,
    sourceTokenCount: asNumber(row.source_token_count),
    summaryTokenCount: asNumber(row.summary_token_count),
  })
}

function renderContextItem(input: { item: ManifestItem; indexes: ReturnType<typeof buildIndexes> }) {
  const { item, indexes } = input
  if (item.itemType === "raw_message" && item.messageRowID) {
    const message = indexes.messages.get(item.messageRowID as MessageRowID)
    if (!message) return `## Missing raw message\n\nMessage row \`${item.messageRowID}\` is unavailable.`
    return renderMessage({
      message,
      parts: indexes.partsByMessage.get(message.message_row_id) ?? [],
      largeFiles: indexes.largeFiles,
    })
  }
  if ((item.itemType === "summary" || item.itemType === "archive_stub") && item.summaryID) {
    const summary = indexes.summaries.get(item.summaryID as SummaryID)
    if (!summary) return `## Missing summary\n\nSummary \`${item.summaryID}\` is unavailable.`
    const parents = indexes.summaryParents.get(summary.summary_id)?.map((row) => row.parent_summary_id) ?? []
    return `## ${item.itemType} ${summary.summary_id}\n\n${fence(summaryWrapper(summary, parents), "text")}`
  }
  if (item.itemType === "large_file_marker" && item.fileID) {
    const file = indexes.largeFiles.get(item.fileID as LcmFileID)
    if (!file) return `## Missing large file marker\n\nFile \`${item.fileID}\` is unavailable.`
    return `## large file marker ${file.file_id}\n\n${fence(renderLargeFile(file), "text")}`
  }
  if (item.itemType === "retrieval_cue") {
    return `## retrieval cue ${item.cueID ?? "unknown"}\n\n${fence(formatJson(item.cuePayload), "json")}`
  }
  return `## Unknown context item\n\n${fence(formatJson(item), "json")}`
}

function currentManifestItems(rows: ContextItemRow[]): ManifestItem[] {
  return rows.map((row) => ({
    itemType: row.item_type,
    messageRowID: row.message_row_id ?? undefined,
    summaryID: row.summary_id ?? undefined,
    pointerID: row.pointer_id ?? undefined,
    fileID: row.file_id ?? undefined,
    cueID: row.cue_id ?? undefined,
    cuePayload: jsonValue(row.cue_payload_json),
    cueLifecycleState: row.cue_lifecycle_state ?? undefined,
  }))
}

function snapshotManifestItems(snapshot: SnapshotRow): ManifestItem[] | undefined {
  const manifest = jsonValue(snapshot.restore_manifest_json)
  if (!isRecord(manifest) || !Array.isArray(manifest.items)) return undefined
  return manifest.items.filter(isRecord).map((item) => item as ManifestItem)
}

function snapshotReason(snapshot: SnapshotRow) {
  const metrics = jsonValue(snapshot.metrics_json)
  return isRecord(metrics) && typeof metrics.reason === "string" ? metrics.reason : "unknown"
}

function renderContextMarkdown(input: {
  title: string
  sessionID: string
  conversationID: ConversationID
  items: ManifestItem[]
  indexes: ReturnType<typeof buildIndexes>
  note?: string
}) {
  const header = [
    `# ${input.title}`,
    "",
    `Session: \`${input.sessionID}\``,
    `Conversation: \`${input.conversationID}\``,
    input.note ? `Note: ${input.note}` : undefined,
  ].filter((line): line is string => line !== undefined)
  const body = input.items.map((item) => renderContextItem({ item, indexes: input.indexes })).join("\n\n---\n\n")
  return `${header.join("\n")}\n\n${body || "_No context items._"}\n`
}

function renderSummaryPrompt(input: { summary: SummaryRow; indexes: ReturnType<typeof buildIndexes> }) {
  const promptVersion = input.summary.prompt_version
  if (promptVersion === LCM_LEAF_SUMMARY_PROMPT_VERSION) {
    const sourceItems: LcmLeafSummarySourceItem[] = (input.indexes.summaryMessages.get(input.summary.summary_id) ?? [])
      .map((link) => {
        const message = input.indexes.messages.get(link.message_row_id)
        return message
          ? {
              messageRowID: link.message_row_id,
              text: rawFallbackText({
                message,
                parts: input.indexes.partsByMessage.get(link.message_row_id) ?? [],
              }),
              tokenCount: 0,
            }
          : undefined
      })
      .filter((item): item is LcmLeafSummarySourceItem => item !== undefined)
    return renderLeafSummaryPromptRequest(sourceItems)
  }

  if (
    promptVersion === LCM_CONDENSE_SUMMARY_PROMPT_VERSION ||
    promptVersion === LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION
  ) {
    const sourceItems: LcmCondenseSummarySourceItem[] = (
      input.indexes.summaryParents.get(input.summary.summary_id) ?? []
    )
      .map((link) => {
        const parent = input.indexes.summaries.get(link.parent_summary_id)
        if (!parent) return undefined
        const grandParents =
          input.indexes.summaryParents.get(parent.summary_id)?.map((row) => row.parent_summary_id) ?? []
        return {
          summaryID: parent.summary_id,
          text: summaryWrapper(parent, grandParents),
          tokenCount: asNumber(parent.summary_token_count),
          summaryLevel: asNumber(parent.summary_level),
        }
      })
      .filter((item): item is LcmCondenseSummarySourceItem => item !== undefined)
    return renderCondenseSummaryPromptRequest(promptVersion, sourceItems)
  }

  return undefined
}

function unavailablePromptMarkdown(input: {
  title: string
  promptVersion: LcmPromptVersion
  diagnosticCode: string
  details: string
}) {
  return [
    `# ${input.title}`,
    "",
    `Prompt version: \`${input.promptVersion}\``,
    `Diagnostic: \`${input.diagnosticCode}\``,
    "",
    input.details,
    "",
  ].join("\n")
}

function renderMapPromptRequest(input: {
  prompt: string
  item: unknown
  itemSchema: unknown
  previousInvalid: boolean
}) {
  return renderLcmPromptRequest("map-item-v1", {
    map_prompt: input.prompt,
    json_schema: canonicalJson(input.itemSchema),
    input_item_json: canonicalJson(input.item),
    retry_instruction: input.previousInvalid
      ? "The previous attempt returned invalid JSON or failed schema validation. Try again."
      : "",
  })
}

async function readJsonlMapItems(input: { file: LargeFileRow | undefined; artifactRoot: string; warnings: string[] }) {
  if (
    !input.file ||
    input.file.artifact_storage_kind !== "file" ||
    !input.file.artifact_path ||
    !input.file.artifact_content_sha256
  ) {
    input.warnings.push("lcm_prompt_export_map_input_artifact_unavailable")
    return undefined
  }
  const result = await readAndValidateLcmArtifact({
    artifactRoot: input.artifactRoot,
    artifactPath: input.file.artifact_path,
    byteCount: asNumber(input.file.artifact_byte_count),
    sha256: input.file.artifact_content_sha256,
  })
  if (!result.ok) {
    input.warnings.push(`lcm_prompt_export_map_input_artifact_${result.reason}`)
    return undefined
  }
  const lines = result.value.bytes.toString("utf8").split(/\r\n|\n|\r/)
  if (lines.at(-1) === "") lines.pop()
  const items: unknown[] = []
  for (const [index, line] of lines.entries()) {
    try {
      items.push(JSON.parse(line))
    } catch {
      input.warnings.push(`lcm_prompt_export_map_input_parse_failed_line_${index}`)
      return undefined
    }
  }
  return items
}

export async function exportLcmPrompts(input: {
  db: PGlite
  sessionID: string
  conversationID: ConversationID
  dataDir: string
  workspaceRoot: string
  operationID: OperationID
}): Promise<LcmPromptExportReport> {
  const data = await loadExportData(input.db, input.conversationID)
  const indexes = buildIndexes(data)
  const warnings: string[] = []
  const exportDir = await createUniqueExportDir(input.workspaceRoot, input.sessionID)
  const files: ExportFile[] = []
  let sequence = 1

  const write = async (kind: string, slug: string, title: string, body: string) => {
    const filename = `${String(sequence).padStart(4, "0")}-${safeSegment(slug)}.md`
    sequence++
    await fs.writeFile(path.join(exportDir, filename), body, "utf8")
    files.push({ filename, title, kind })
  }

  const summaries = [...data.summaries].sort(
    (left, right) => asNumber(left.created_at_ms) - asNumber(right.created_at_ms),
  )
  const replacementSnapshots = data.snapshots.filter((snapshot) => REPLACEMENT_REASONS.has(snapshotReason(snapshot)))
  const firstSummaryAt = summaries[0] ? asNumber(summaries[0].created_at_ms) : undefined
  const initialSnapshot =
    firstSummaryAt === undefined
      ? data.snapshots[data.snapshots.length - 1]
      : [...data.snapshots].reverse().find((snapshot) => asNumber(snapshot.created_at_ms) < firstSummaryAt)
  const initialItems = initialSnapshot
    ? snapshotManifestItems(initialSnapshot)
    : currentManifestItems(data.contextItems)
  if (!initialItems) warnings.push("lcm_prompt_export_initial_snapshot_manifest_unavailable")
  await write(
    "dialog",
    "dialog-active-context",
    "Dialog active context",
    renderContextMarkdown({
      title: "Dialog active context",
      sessionID: input.sessionID,
      conversationID: input.conversationID,
      items: initialItems ?? currentManifestItems(data.contextItems),
      indexes,
      note: initialSnapshot
        ? `snapshot ${initialSnapshot.snapshot_id}, reason ${snapshotReason(initialSnapshot)}`
        : "current context fallback",
    }),
  )

  const emittedReplacementSnapshots = new Set<string>()
  for (const summary of summaries) {
    const request = renderSummaryPrompt({ summary, indexes })
    if (request) {
      await write(
        "lcm-prompt",
        `lcm-${summary.prompt_version}-${summary.summary_id}`,
        `LCM ${summary.prompt_version} ${summary.summary_id}`,
        [
          `# LCM ${summary.prompt_version} ${summary.summary_id}`,
          "",
          `Summary type: \`${summary.summary_type}\``,
          `Provider/model: \`${summary.provider_id ?? "unknown"}/${summary.model_id ?? "unknown"}\``,
          `Created: ${new Date(asNumber(summary.created_at_ms)).toISOString()}`,
          "",
          renderPromptRequest(request),
          section("Accepted Summary", fence(summary.content_text, "text")),
        ].join("\n"),
      )
    } else {
      await write(
        "lcm-prompt-unavailable",
        `lcm-${summary.prompt_version}-${summary.summary_id}-unavailable`,
        `LCM ${summary.prompt_version} ${summary.summary_id} unavailable`,
        unavailablePromptMarkdown({
          title: `LCM ${summary.prompt_version} ${summary.summary_id}`,
          promptVersion: summary.prompt_version,
          diagnosticCode: "lcm_prompt_export_summary_prompt_unavailable",
          details: "This summary uses a prompt version that the exporter does not know how to reconstruct.",
        }),
      )
    }

    const replacementSnapshot = replacementSnapshots.find(
      (snapshot) =>
        !emittedReplacementSnapshots.has(snapshot.snapshot_id) &&
        asNumber(snapshot.created_at_ms) >= asNumber(summary.created_at_ms),
    )
    const replacementItems = replacementSnapshot ? snapshotManifestItems(replacementSnapshot) : undefined
    if (replacementSnapshot && replacementItems) {
      emittedReplacementSnapshots.add(replacementSnapshot.snapshot_id)
      await write(
        "dialog",
        `dialog-after-${summary.summary_id}`,
        `Dialog after ${summary.summary_id}`,
        renderContextMarkdown({
          title: `Dialog after ${summary.summary_id}`,
          sessionID: input.sessionID,
          conversationID: input.conversationID,
          items: replacementItems,
          indexes,
          note: `snapshot ${replacementSnapshot.snapshot_id}, reason ${snapshotReason(replacementSnapshot)}`,
        }),
      )
    }
  }

  for (const item of currentManifestItems(data.contextItems)) {
    if (item.itemType !== "retrieval_cue") continue
    const cue = isRecord(item.cuePayload) ? item.cuePayload : {}
    await write(
      "lcm-prompt-unavailable",
      `retrieval-expand-query-${item.cueID ?? "cue"}`,
      `Retrieval expand-query ${item.cueID ?? "cue"}`,
      unavailablePromptMarkdown({
        title: `Retrieval expand-query ${item.cueID ?? "cue"}`,
        promptVersion: "retrieval-expand-query-v3",
        diagnosticCode: "lcm_prompt_export_retrieval_excerpts_not_persisted",
        details: [
          "The retrieval cue is durable, but the exact ranked excerpt list used for the model call is not stored as a prompt log.",
          "",
          "Durable cue payload:",
          fence(formatJson(cue), "json"),
        ].join("\n"),
      }),
    )
  }

  for (const file of data.largeFiles.filter(
    (row) => row.exploration_prompt_version === "file-exploration-summary-v2",
  )) {
    if (file.artifact_storage_kind === "file" && file.artifact_path && file.artifact_content_sha256) {
      const artifact = await readAndValidateLcmArtifact({
        artifactRoot: resolveLcmDbLayout(input.dataDir).artifactsDir,
        artifactPath: file.artifact_path,
        byteCount: asNumber(file.artifact_byte_count),
        sha256: file.artifact_content_sha256,
      })
      if (artifact.ok) {
        const sample = artifact.value.bytes
          .subarray(0, Math.max(0, asNumber(file.exploration_sample_bytes)))
          .toString("utf8")
        await write(
          "lcm-prompt",
          `file-exploration-${file.file_id}`,
          `File exploration ${file.file_id}`,
          [
            `# File exploration ${file.file_id}`,
            "",
            renderPromptRequest(renderFileExplorationSummaryPromptRequest(sample)),
            section("Accepted Exploration Summary", fence(file.exploration_summary_text ?? "", "text")),
          ].join("\n"),
        )
        continue
      }
      warnings.push(`lcm_prompt_export_file_exploration_artifact_${artifact.reason}`)
    }
    await write(
      "lcm-prompt-unavailable",
      `file-exploration-${file.file_id}-unavailable`,
      `File exploration ${file.file_id} unavailable`,
      unavailablePromptMarkdown({
        title: `File exploration ${file.file_id}`,
        promptVersion: "file-exploration-summary-v2",
        diagnosticCode: "lcm_prompt_export_file_sample_unavailable",
        details: [
          "The exploration summary is durable, but the exact sampled file bytes are not available from LCM artifact storage.",
          "",
          "Stored file marker:",
          fence(renderLargeFile(file), "text"),
          section("Accepted Exploration Summary", fence(file.exploration_summary_text ?? "", "text")),
        ].join("\n"),
      }),
    )
  }

  const artifactRoot = resolveLcmDbLayout(input.dataDir).artifactsDir
  for (const run of data.mapRuns) {
    const items = await readJsonlMapItems({
      file: indexes.largeFiles.get(run.input_file_id),
      artifactRoot,
      warnings,
    })
    for (const item of indexes.mapItems.get(run.map_id) ?? []) {
      const itemIndex = asNumber(item.item_index)
      const mapInput = items?.[itemIndex]
      if (mapInput !== undefined) {
        const request = renderMapPromptRequest({
          prompt: run.prompt_text,
          item: mapInput,
          itemSchema: jsonValue(run.schema_json),
          previousInvalid: asNumber(item.attempts) > 1,
        })
        await write(
          "lcm-prompt",
          `map-item-${run.map_id}-${itemIndex}`,
          `Map item ${run.map_id} #${itemIndex}`,
          [
            `# Map item ${run.map_id} #${itemIndex}`,
            "",
            `Tool kind: \`${run.tool_kind}\``,
            `Status: \`${item.status}\``,
            renderPromptRequest(request),
            section("Stored Output", fence(formatJson(item.output_json), "json")),
          ].join("\n"),
        )
        continue
      }
      await write(
        "lcm-prompt-unavailable",
        `map-item-${run.map_id}-${itemIndex}-unavailable`,
        `Map item ${run.map_id} #${itemIndex} unavailable`,
        unavailablePromptMarkdown({
          title: `Map item ${run.map_id} #${itemIndex}`,
          promptVersion: "map-item-v1",
          diagnosticCode: "lcm_prompt_export_map_input_item_unavailable",
          details:
            "The map run is durable, but this item's exact JSONL input could not be reconstructed from artifact storage.",
        }),
      )
    }
  }

  const indexFilename = "0000-index.md"
  const index = [
    "# LCM Prompt Export",
    "",
    `Session: \`${input.sessionID}\``,
    `Conversation: \`${input.conversationID}\``,
    `Operation: \`${input.operationID}\``,
    `Exported at: ${new Date().toISOString()}`,
    "",
    "This export is an on-demand Markdown reconstruction from durable LCM state. It is not a continuous byte-for-byte provider wire log.",
    "",
    "## Files",
    "",
    ...files.map((file) => `- \`${file.filename}\` - ${file.kind}: ${file.title}`),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((warning) => `- \`${warning}\``) : ["_None._"]),
    "",
  ].join("\n")
  await fs.writeFile(path.join(exportDir, indexFilename), index, "utf8")

  return {
    operationID: input.operationID,
    sessionID: input.sessionID,
    conversationID: input.conversationID,
    exportDir,
    fileCount: files.length + 1,
    warnings,
  }
}
