// kilocode_change - new file
import { renderLcmPromptRequest, type LcmRenderedPromptRequest } from "./prompts"
import { isLcmProviderCapacityDeferredError } from "./provider-capacity"
import { runWithOperationCancellation, throwIfOperationCanceled } from "./operation-control"
import { parseLcmSafeError } from "./safe-error-schema"
import type { LcmTokenCounter } from "./token-budget"
import type {
  ConversationID,
  LcmSafeError,
  LcmPromptVersion,
  LcmSummaryFallbackMode,
  LcmSummaryObjectiveStatus,
  LcmSummaryReasoningPolicy,
  LcmUsageRecord,
  MessageRowID,
  OperationID,
  SummaryID,
} from "./types"

export const LCM_LEAF_SUMMARY_PROMPT_VERSION = "summary-leaf-v2" satisfies LcmPromptVersion
export const LCM_LEAF_SUMMARY_FALLBACK_LABEL = "LCM leaf summary fallback"
export const LCM_CONDENSE_SUMMARY_PROMPT_VERSION = "summary-condense-v2" satisfies LcmPromptVersion
export const LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION = "summary-aggressive-v2" satisfies LcmPromptVersion
export const LCM_SUMMARY_FALLBACK_LABEL = "LCM summary fallback"
export const LCM_ARCHIVE_STUB_TEXT =
  "Older memory is archived. Use authorized retrieval with the summary ID to inspect details."
export const LCM_SUMMARY_TARGET_TOKENS = 1600
export const LCM_SUMMARY_GENERATION_MAX_OUTPUT_TOKENS = 4096

export interface LcmLeafSummarySourceItem {
  messageRowID: MessageRowID
  text: string
  tokenCount: number
}

export interface LcmCondenseSummarySourceItem {
  summaryID: SummaryID
  text: string
  tokenCount: number
  summaryLevel: number
}

export interface LcmLeafSummaryUsage {
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

export interface LcmSummaryAttemptEvidence {
  providerBacked: boolean
  usage?: LcmLeafSummaryUsage
  summaryTargetTokens: number
  summaryGenerationMaxOutputTokens: number
  maintenanceInputBudget: number
  summarySourceTokens: number
  candidateSummaryTokens?: number
  acceptedSummaryTokens?: number
  summaryObjectiveStatus: LcmSummaryObjectiveStatus
  summaryFallbackMode: LcmSummaryFallbackMode
  summaryReasoningPolicy: LcmSummaryReasoningPolicy
  summaryRetryAttempt: number
}

export interface LcmLeafSummaryGeneratorInput {
  operationID: OperationID
  conversationID: ConversationID
  promptVersion: typeof LCM_LEAF_SUMMARY_PROMPT_VERSION
  prompt: string
  request: LcmRenderedPromptRequest
  sourceItems: LcmLeafSummarySourceItem[]
  attempt: number
  maxOutputTokens?: number
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  abortSignalID?: string
  abortSignal?: AbortSignal
}

export interface LcmLeafSummaryGeneratorOutput {
  text: string
  usage?: LcmLeafSummaryUsage
}

export type LcmLeafSummaryGenerator = (
  input: LcmLeafSummaryGeneratorInput,
) => Promise<string | LcmLeafSummaryGeneratorOutput>

export interface LcmSummaryCondenseGeneratorInput {
  operationID: OperationID
  conversationID: ConversationID
  promptVersion: typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION
  prompt: string
  request: LcmRenderedPromptRequest
  sourceItems: LcmCondenseSummarySourceItem[]
  attempt: number
  maxOutputTokens?: number
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  abortSignalID?: string
  abortSignal?: AbortSignal
}

export interface LcmSummaryCondenseGeneratorOutput {
  text: string
  usage?: LcmLeafSummaryUsage
}

export type LcmSummaryCondenseGenerator = (
  input: LcmSummaryCondenseGeneratorInput,
) => Promise<string | LcmSummaryCondenseGeneratorOutput>

export interface LcmSummaryGenerationRunResult<TPromptVersion extends LcmPromptVersion = LcmPromptVersion> {
  contentText: string
  sourceTokenCount: number
  summaryTokenCount: number
  promptVersion: TPromptVersion
  objectiveStatus: LcmSummaryObjectiveStatus
  fallbackMode: LcmSummaryFallbackMode
  attempts: number
  usage?: LcmLeafSummaryUsage
  usageEvidence: LcmSummaryAttemptEvidence[]
}

export type LcmLeafSummaryRunResult = LcmSummaryGenerationRunResult<typeof LCM_LEAF_SUMMARY_PROMPT_VERSION>

export class LcmSummaryObjectiveFailedError extends Error {
  readonly usageEvidence: readonly LcmSummaryAttemptEvidence[]

  constructor(message: string, usageEvidence: readonly LcmSummaryAttemptEvidence[]) {
    super(message)
    this.name = "LcmSummaryObjectiveFailedError"
    this.usageEvidence = usageEvidence
  }
}

export function isLcmSummaryObjectiveFailedError(error: unknown): error is LcmSummaryObjectiveFailedError {
  return error instanceof LcmSummaryObjectiveFailedError
}

function canceledSafeError(error: unknown): LcmSafeError | undefined {
  const safeError = parseLcmSafeError(error)
  return safeError?.code === "canceled" ? safeError : undefined
}

function throwIfSummaryCanceled(input: {
  readonly abortSignal?: AbortSignal
  readonly operationID?: OperationID
  readonly diagnosticCode: string
}) {
  throwIfOperationCanceled(input)
}

export function renderLeafSummarySourceItems(items: LcmLeafSummarySourceItem[]): string {
  return items.map((item) => `[Message ID: ${item.messageRowID}]\n${item.text}`).join("\n\n")
}

export function renderLeafSummaryPromptRequest(items: LcmLeafSummarySourceItem[]): LcmRenderedPromptRequest {
  return renderLcmPromptRequest(LCM_LEAF_SUMMARY_PROMPT_VERSION, {
    source_items: renderLeafSummarySourceItems(items),
  })
}

export function renderLeafSummaryPrompt(items: LcmLeafSummarySourceItem[]): string {
  return renderLeafSummaryPromptRequest(items).prompt
}

export function renderCondenseSummarySourceItems(items: LcmCondenseSummarySourceItem[]): string {
  return items
    .map((item) => `[Summary ID: ${item.summaryID}]\n[Summary Level: ${item.summaryLevel}]\n${item.text}`)
    .join("\n\n")
}

export function renderCondenseSummaryPromptRequest(
  promptVersion: typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  items: LcmCondenseSummarySourceItem[],
): LcmRenderedPromptRequest {
  const sourceKey = promptVersion === LCM_CONDENSE_SUMMARY_PROMPT_VERSION ? "source_items" : "source_items"
  return renderLcmPromptRequest(promptVersion, {
    [sourceKey]: renderCondenseSummarySourceItems(items),
  })
}

export function renderCondenseSummaryPrompt(
  promptVersion: typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION,
  items: LcmCondenseSummarySourceItem[],
): string {
  return renderCondenseSummaryPromptRequest(promptVersion, items).prompt
}

export function renderSummaryWrapper(input: {
  summaryID: SummaryID
  contentText: string
  parentSummaryIDs?: SummaryID[]
  objectiveStatus?: LcmSummaryObjectiveStatus
  fallbackMode?: LcmSummaryFallbackMode
  sourceTokenCount?: number
  summaryTokenCount?: number
}): string {
  const parentIDs = input.parentSummaryIDs ?? []
  const header = [`[Summary ID: ${input.summaryID}]`]
  if (parentIDs.length > 0) {
    header.push(`[Parent Summaries: ${parentIDs.join(", ")}]`)
  }
  if (
    input.objectiveStatus === "fallback_accepted" ||
    input.fallbackMode === "truncated_prefix" ||
    input.fallbackMode === "extractive_key_points"
  ) {
    const sourceTokens = floorFiniteNonNegative(input.sourceTokenCount, 0)
    const summaryTokens = floorFiniteNonNegative(input.summaryTokenCount, 0)
    const fallbackMode = input.fallbackMode ?? "extractive_key_points"
    const tokenNote =
      sourceTokens > 0 && summaryTokens > 0 ? `; source ${sourceTokens} tokens -> summary ${summaryTokens} tokens` : ""
    header.push(`[Fallback: ${fallbackMode}${tokenNote}]`)
    header.push(
      `[Original Source: retained in LCM storage; use authorized LCM retrieval/search with Summary ID ${input.summaryID} to restore covered source messages where available.]`,
    )
  }
  return `${header.join("\n")}\n\n${input.contentText}`
}

export function renderArchiveStubWrapper(input: { summaryID: SummaryID; pointerID: string }): string {
  return `[Archive Stub: ${input.summaryID}]\n[Pointer ID: ${input.pointerID}]\n\n${LCM_ARCHIVE_STUB_TEXT}`
}

function floorFiniteNonNegative(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

export function normalizeLcmProviderOutputLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

export function computeSummaryGenerationMaxOutputTokens(input: {
  providerContextLimit?: number
  providerOutputLimit?: number
  requestedMaxOutputTokens?: number
}) {
  const providerContextLimit = Math.max(1, floorFiniteNonNegative(input.providerContextLimit, 80_000))
  const normalizedOutputLimit = normalizeLcmProviderOutputLimit(input.providerOutputLimit) ?? providerContextLimit
  const requested = floorFiniteNonNegative(input.requestedMaxOutputTokens, LCM_SUMMARY_GENERATION_MAX_OUTPUT_TOKENS)
  return Math.max(0, Math.min(requested, normalizedOutputLimit, Math.floor(providerContextLimit * 0.25)))
}

export function computeMaintenanceInputBudget(input: {
  providerContextLimit?: number
  providerInputLimit?: number
  summaryGenerationMaxOutputTokens?: number
  maintenancePromptOverheadTokens?: number
}) {
  const providerContextLimit = Math.max(1, floorFiniteNonNegative(input.providerContextLimit, 80_000))
  const providerInputLimit =
    typeof input.providerInputLimit === "number" && Number.isFinite(input.providerInputLimit)
      ? Math.max(0, Math.floor(input.providerInputLimit))
      : providerContextLimit
  const outputCap = floorFiniteNonNegative(input.summaryGenerationMaxOutputTokens, 0)
  const promptOverhead = floorFiniteNonNegative(input.maintenancePromptOverheadTokens, 0)
  return Math.max(0, Math.min(providerInputLimit, providerContextLimit - outputCap) - promptOverhead)
}

function deterministicFallbackTokenLimit(input: { sourceTokenCount: number; summaryTargetTokens: number }) {
  const sourceLimit = Math.max(0, input.sourceTokenCount - 1)
  const targetLimit = Math.max(1, input.summaryTargetTokens)
  const significantLimit =
    input.sourceTokenCount >= targetLimit * 2 ? Math.max(1, Math.floor(input.sourceTokenCount * 0.25)) : sourceLimit
  return Math.max(0, Math.min(sourceLimit, targetLimit, significantLimit))
}

function truncateInline(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function sourceSections(sourceText: string) {
  return sourceText
    .split(/\n(?=\[(?:Message|Summary) ID: )/g)
    .map((section) => {
      const lines = section.split("\n")
      const heading = lines[0]?.trim() ?? ""
      const handle = heading.match(/^\[(?:Message|Summary) ID: ((?:msg|sum)_[^\]]+)\]$/)?.[1]
      return {
        handle,
        text: lines
          .slice(handle ? 1 : 0)
          .join("\n")
          .trim(),
      }
    })
    .filter((section) => section.text.length > 0 || section.handle)
}

function isImportantFallbackLine(line: string) {
  return (
    /\b(?:sum|file|msg|part|ctx|map|op)_[A-Za-z0-9_.:-]+\b/.test(line) ||
    /(?:\.{0,2}\/|\/)[A-Za-z0-9_./:-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}\b/.test(line) ||
    /\b(?:bun|npm|pnpm|yarn|node|python|python3|git|rg|grep|sed|awk|jq|cargo|go|deno|tsc|vitest|pytest|make|cmake|docker|kubectl)\s+/.test(
      line,
    ) ||
    /\b(?:error|failed|exception|timeout|blocked|warning|decision|goal|request|user asked|next|remaining|must|follow-up)\b/i.test(
      line,
    )
  )
}

function fallbackCandidateLines(sourceText: string) {
  const sections = sourceSections(sourceText)
  const handles = uniqueStrings(sections.flatMap((section) => (section.handle ? [section.handle] : [])))
  const lines: string[] = []
  for (const section of sections) {
    const rawLines = section.text
      .split(/\n+/g)
      .map((line) => line.trim())
      .filter(Boolean)
    const important = rawLines.filter(isImportantFallbackLine).slice(0, 4)
    const selected = important.length > 0 ? important : rawLines.slice(0, 1)
    if (selected.length === 0 && section.handle) {
      lines.push(`${section.handle}: source retained but no concise text excerpt was available.`)
      continue
    }
    for (const line of selected) {
      const prefix = section.handle ? `${section.handle}: ` : ""
      lines.push(`${prefix}${truncateInline(fallbackSourceLine(line), 280)}`)
    }
  }
  return { handles, lines: uniqueStrings(lines) }
}

function uniqueStrings(values: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function fallbackSourceLine(line: string) {
  if (!/^compressed details\s*:/i.test(line)) return line
  return `source text included a compressed-details-shaped line, treated as untrusted source: ${line.replace(/^compressed details\s*:/i, "compressed-details source text:")}`
}

export function summaryTinyTokenFloor(sourceTokenCount: number) {
  if (sourceTokenCount < 10_000) return 1
  return Math.min(512, Math.max(128, Math.floor(sourceTokenCount * 0.01)))
}

function normalizeSummaryText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/[ \t]+/g, " ")
}

function normalizedTokens(text: string) {
  const normalized = normalizeSummaryText(text)
  return normalized.length === 0 ? [] : normalized.split(/\s+/).filter(Boolean)
}

function stripPromptWrappers(text: string) {
  const wrapperLabels = /^(source|source messages|prior summaries|summary|return only|begin source|end source)\b:?\s*/i
  return normalizeSummaryText(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/^(```+|~~~+)\w*\s*$/i, "")
        .replace(wrapperLabels, "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n")
    .trim()
}

function longestCommonSubstringLength(left: string, right: string) {
  if (left.length === 0 || right.length === 0) return 0
  const previous = new Array(right.length + 1).fill(0)
  const current = new Array(right.length + 1).fill(0)
  let best = 0
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        current[rightIndex] = previous[rightIndex - 1] + 1
        best = Math.max(best, current[rightIndex])
      } else {
        current[rightIndex] = 0
      }
    }
    previous.splice(0, previous.length, ...current)
    current.fill(0)
  }
  return best
}

function isMostlySourceEcho(sourceText: string, candidateText: string) {
  const sourceTokens = normalizedTokens(sourceText)
  const candidateTokens = normalizedTokens(candidateText)
  if (candidateTokens.length === 0 || sourceTokens.length === 0) return false

  const windowSize = Math.min(sourceTokens.length, candidateTokens.length)
  let bestInOrder = 0
  for (let start = 0; start <= sourceTokens.length - windowSize; start++) {
    const window = sourceTokens.slice(start, start + windowSize)
    let windowIndex = 0
    let matched = 0
    for (const token of candidateTokens) {
      while (windowIndex < window.length && window[windowIndex] !== token) windowIndex++
      if (windowIndex >= window.length) continue
      matched++
      windowIndex++
    }
    bestInOrder = Math.max(bestInOrder, matched)
    if (bestInOrder / candidateTokens.length >= 0.8) return true
  }

  const normalizedCandidate = normalizeSummaryText(candidateText)
  if (normalizedCandidate.length <= 200) return false
  const normalizedSource = normalizeSummaryText(sourceText)
  if (normalizedCandidate.length * normalizedSource.length > 2_000_000) return false
  return longestCommonSubstringLength(normalizedCandidate, normalizedSource) / normalizedCandidate.length >= 0.6
}

type AnchorClass =
  | "stable_handle"
  | "file_path"
  | "command"
  | "code_symbol"
  | "error"
  | "decision"
  | "user_goal"
  | "unresolved_work"

interface ContinuityAnchor {
  className: AnchorClass
  text: string
}

function collectMatches(text: string, className: AnchorClass, regex: RegExp, out: Map<string, ContinuityAnchor>) {
  for (const match of text.matchAll(regex)) {
    const value = match[0]?.trim()
    if (!value) continue
    out.set(`${className}:${value.toLowerCase()}`, { className, text: value })
  }
}

export function extractContinuityAnchors(text: string) {
  const normalized = normalizeSummaryText(text)
  const anchors = new Map<string, ContinuityAnchor>()
  collectMatches(normalized, "stable_handle", /\b(?:sum|file|msg|part|ctx|map|op)_[A-Za-z0-9_.:-]+\b/g, anchors)
  collectMatches(
    normalized,
    "file_path",
    /(?:\.{0,2}\/|\/)[A-Za-z0-9_./:-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}\b/g,
    anchors,
  )
  collectMatches(
    normalized,
    "command",
    /(?:^\$ [^\n]+|\b(?:bun|npm|pnpm|yarn|node|python|python3|git|rg|grep|sed|awk|jq|cargo|go|deno|tsc|vitest|pytest|make|cmake|docker|kubectl)\s+[^\n.]+)/gm,
    anchors,
  )
  collectMatches(normalized, "code_symbol", /\b[A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)+\b/g, anchors)
  collectMatches(
    normalized,
    "error",
    /\b(?:[A-Z][A-Z0-9_]{2,}|error|failed|exception|timeout|blocked):?[A-Za-z0-9_.:-]*\b/g,
    anchors,
  )
  collectMatches(normalized, "decision", /\b(?:Decision:|DR-\d{3})\b[^\n]*/g, anchors)
  collectMatches(normalized, "user_goal", /\b(?:goal|request|user asked|must implement|need to)\b[^\n.]*/gi, anchors)
  collectMatches(normalized, "unresolved_work", /\b(?:remaining|blocked|next|must|follow-up)\b[^\n.]*/gi, anchors)
  return [...anchors.values()]
}

function candidateContainsAnchor(candidate: string, anchor: ContinuityAnchor) {
  const normalizedCandidate = normalizeSummaryText(candidate).toLowerCase()
  const normalizedAnchor = normalizeSummaryText(anchor.text).toLowerCase()
  if (normalizedAnchor.length === 0) return false
  if (normalizedCandidate.includes(normalizedAnchor)) return true
  if (anchor.className === "decision") return /\b(?:decision:|dr-\d{3})\b/i.test(candidate)
  return false
}

const ANCHOR_CLASS_CAPS: Record<AnchorClass, number> = {
  stable_handle: 6,
  file_path: 8,
  command: 4,
  code_symbol: 6,
  error: 6,
  decision: 6,
  user_goal: 6,
  unresolved_work: 6,
}

const ANCHOR_CLASS_WEIGHTS: Record<AnchorClass, number> = {
  stable_handle: 3,
  file_path: 2,
  command: 2,
  code_symbol: 1,
  error: 2,
  decision: 2,
  user_goal: 2,
  unresolved_work: 2,
}

function cappedContinuityAnchors(anchors: readonly ContinuityAnchor[]) {
  const counts = new Map<AnchorClass, number>()
  return anchors.filter((anchor) => {
    const count = counts.get(anchor.className) ?? 0
    if (count >= ANCHOR_CLASS_CAPS[anchor.className]) return false
    counts.set(anchor.className, count + 1)
    return true
  })
}

function hasRequiredAnchorCoverage(candidateText: string, sourceAnchors: readonly ContinuityAnchor[]) {
  if (sourceAnchors.length === 0) return true
  const stableAnchors = sourceAnchors.filter((anchor) => anchor.className === "stable_handle")
  const fileAnchors = stableAnchors
    .filter((anchor) => anchor.text.startsWith("file_"))
    .slice(0, ANCHOR_CLASS_CAPS.stable_handle)
  if (fileAnchors.length > 0 && !fileAnchors.every((anchor) => candidateContainsAnchor(candidateText, anchor))) {
    return false
  }
  if (stableAnchors.length > 0 && !stableAnchors.some((anchor) => candidateContainsAnchor(candidateText, anchor))) {
    return false
  }
  const capped = cappedContinuityAnchors(sourceAnchors)
  const totalWeight = capped.reduce((total, anchor) => total + ANCHOR_CLASS_WEIGHTS[anchor.className], 0)
  const preservedWeight = capped.reduce(
    (total, anchor) =>
      total + (candidateContainsAnchor(candidateText, anchor) ? ANCHOR_CLASS_WEIGHTS[anchor.className] : 0),
    0,
  )
  return preservedWeight >= Math.max(2, Math.ceil(totalWeight * 0.2))
}

function isRefusal(candidateText: string, strippedText: string, anchors: ContinuityAnchor[]) {
  const refusalPatterns = [
    "i can't",
    "i cannot",
    "unable to",
    "as an ai",
    "cannot summarize",
    "insufficient information",
    "not enough information",
  ]
  const lower = normalizeSummaryText(strippedText).toLowerCase()
  if (lower.length === 0) return false
  const tokens = normalizedTokens(lower)
  const refusalTokenCount = refusalPatterns.reduce((total, pattern) => {
    if (!lower.includes(pattern)) return total
    return total + normalizedTokens(pattern).length
  }, 0)
  if (tokens.length > 0 && refusalTokenCount / tokens.length >= 0.5) return true
  const firstSentence = lower.split(/[.!?\n]/).find((part) => part.trim().length > 0) ?? ""
  const firstSentenceRefuses = refusalPatterns.some((pattern) => firstSentence.includes(pattern))
  if (!firstSentenceRefuses) return false
  return !anchors.some((anchor) => candidateContainsAnchor(candidateText, anchor))
}

export function evaluateSummaryQuality(input: {
  sourceText: string
  candidateText: string
  sourceTokenCount: number
  summaryTokenCount: number
  summaryTargetTokens: number
  allowAggressiveOversize?: boolean
}): LcmSummaryObjectiveStatus {
  const normalizedCandidate = normalizeSummaryText(input.candidateText)
  if (normalizedCandidate.length === 0) return "rejected_empty"
  if (input.summaryTokenCount >= input.sourceTokenCount) return "rejected_not_smaller"
  if (!input.allowAggressiveOversize && input.summaryTokenCount > Math.ceil(input.summaryTargetTokens * 1.25)) {
    return "rejected_too_large"
  }
  if (input.sourceTokenCount >= 10_000 && input.summaryTokenCount < summaryTinyTokenFloor(input.sourceTokenCount)) {
    return "rejected_tiny"
  }
  if (isMostlySourceEcho(input.sourceText, input.candidateText)) return "rejected_source_echo"

  const wrapperStripped = stripPromptWrappers(input.candidateText)
  const sourceAnchors = extractContinuityAnchors(input.sourceText)
  if (isRefusal(input.candidateText, wrapperStripped, sourceAnchors)) return "rejected_refusal"
  if (normalizedTokens(wrapperStripped).length < 40) return "rejected_prompt_wrapper"
  if (sourceAnchors.length > 0) {
    if (!hasRequiredAnchorCoverage(input.candidateText, sourceAnchors)) return "rejected_anchorless"
  }
  return "provider_accepted"
}

export async function buildDeterministicLeafSummaryFallback(input: {
  sourceText: string
  sourceTokenCount: number
  counter: LcmTokenCounter
  summaryTargetTokens?: number
  operationID?: OperationID
  abortSignal?: AbortSignal
}): Promise<{ contentText: string; tokenCount: number }> {
  return buildDeterministicSummaryFallback({
    ...input,
    label: LCM_LEAF_SUMMARY_FALLBACK_LABEL,
  })
}

export async function buildDeterministicSummaryFallback(input: {
  sourceText: string
  sourceTokenCount: number
  counter: LcmTokenCounter
  label?: string
  summaryTargetTokens?: number
  operationID?: OperationID
  abortSignal?: AbortSignal
}): Promise<{ contentText: string; tokenCount: number }> {
  throwIfSummaryCanceled({
    abortSignal: input.abortSignal,
    operationID: input.operationID,
    diagnosticCode: "lcm_summary_fallback_canceled_before_start",
  })
  const maxTokenCount = deterministicFallbackTokenLimit({
    sourceTokenCount: input.sourceTokenCount,
    summaryTargetTokens: floorFiniteNonNegative(input.summaryTargetTokens, LCM_SUMMARY_TARGET_TOKENS),
  })

  if (maxTokenCount <= 0) {
    throw new Error("lcm_leaf_summary_fallback_unfit")
  }

  const fallback = fallbackCandidateLines(input.sourceText)
  const label = input.label ?? LCM_SUMMARY_FALLBACK_LABEL
  const coverage = fallback.handles.length > 0 ? fallback.handles.slice(0, 48).join(", ") : "source retained"
  const header = [
    `[${label}; extractive_key_points from ${input.sourceTokenCount} tokens]`,
    `Coverage: ${coverage}`,
    "Original source remains retained in LCM storage; use authorized retrieval with the summary ID for exact details.",
    "",
    "Key points:",
  ]
  let best = header.join("\n")
  let bestTokenCount = await input.counter.countText({ text: best })
  if (bestTokenCount > maxTokenCount || bestTokenCount >= input.sourceTokenCount) {
    const compactHeader = `[${label}; extractive_key_points from ${input.sourceTokenCount} tokens]\nCoverage: ${coverage}`
    best = compactHeader
    bestTokenCount = await input.counter.countText({ text: best })
  }
  if (bestTokenCount > maxTokenCount || bestTokenCount >= input.sourceTokenCount) {
    const compactHeader = `[${label}; extractive_key_points from ${input.sourceTokenCount} tokens]`
    best = compactHeader
    bestTokenCount = await input.counter.countText({ text: best })
  }

  for (const line of fallback.lines) {
    throwIfSummaryCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_summary_fallback_canceled_during_extractive_build",
    })
    const candidate = `${best}\n- ${line}`.trim()
    const tokenCount = await input.counter.countText({ text: candidate })
    if (candidate.length > 0 && tokenCount <= maxTokenCount && tokenCount < input.sourceTokenCount) {
      best = candidate
      bestTokenCount = tokenCount
    }
  }

  if (best.length > 0 && bestTokenCount <= maxTokenCount && bestTokenCount < input.sourceTokenCount) {
    return { contentText: best, tokenCount: bestTokenCount }
  }

  const codepoints = Array.from(input.sourceText)
  let low = 0
  let high = codepoints.length
  while (low <= high) {
    throwIfSummaryCanceled({
      abortSignal: input.abortSignal,
      operationID: input.operationID,
      diagnosticCode: "lcm_summary_fallback_canceled_during_raw_search",
    })
    const mid = Math.floor((low + high) / 2)
    const candidate = codepoints.slice(0, mid).join("").trim()
    const tokenCount = await input.counter.countText({ text: candidate })
    if (candidate.length > 0 && tokenCount <= maxTokenCount && tokenCount < input.sourceTokenCount) {
      best = candidate
      bestTokenCount = tokenCount
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (best.length === 0) {
    throw new Error("lcm_leaf_summary_fallback_unfit")
  }

  return { contentText: best, tokenCount: bestTokenCount }
}

export async function runCondenseSummaryGeneration(input: {
  operationID: OperationID
  conversationID: ConversationID
  sourceItems: LcmCondenseSummarySourceItem[]
  counter: LcmTokenCounter
  promptVersion?: typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION
  generator?: LcmSummaryCondenseGenerator
  maxAttempts?: number
  allowFallback?: boolean
  summaryTargetTokens?: number
  summaryGenerationMaxOutputTokens?: number
  maintenanceInputBudget?: number
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  retrySummaryReasoningPolicy?: LcmSummaryReasoningPolicy
  allowAggressiveOversize?: boolean
  abortSignalID?: string
  abortSignal?: AbortSignal
}): Promise<
  LcmSummaryGenerationRunResult<
    typeof LCM_CONDENSE_SUMMARY_PROMPT_VERSION | typeof LCM_AGGRESSIVE_SUMMARY_PROMPT_VERSION
  >
> {
  const promptVersion = input.promptVersion ?? LCM_CONDENSE_SUMMARY_PROMPT_VERSION
  const sourceTokenCount = input.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
  const sourceText = renderCondenseSummarySourceItems(input.sourceItems)
  const request = renderCondenseSummaryPromptRequest(promptVersion, input.sourceItems)
  const prompt = request.prompt
  const maxAttempts = Math.max(0, input.maxAttempts ?? 2)
  const allowFallback = input.allowFallback ?? true
  const summaryTargetTokens = floorFiniteNonNegative(input.summaryTargetTokens, LCM_SUMMARY_TARGET_TOKENS)
  const summaryGenerationMaxOutputTokens = floorFiniteNonNegative(
    input.summaryGenerationMaxOutputTokens,
    LCM_SUMMARY_GENERATION_MAX_OUTPUT_TOKENS,
  )
  const maintenanceInputBudget = floorFiniteNonNegative(input.maintenanceInputBudget, sourceTokenCount)
  const usageEvidence: LcmSummaryAttemptEvidence[] = []

  let lastUsage: LcmLeafSummaryUsage | undefined
  let attempts = 0
  if (input.generator && maxAttempts > 0) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfSummaryCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_summary_condense_canceled_before_attempt",
      })
      attempts = attempt
      const summaryRetryAttempt = attempt - 1
      const summaryReasoningPolicy =
        summaryRetryAttempt === 0
          ? (input.summaryReasoningPolicy ?? "provider_default")
          : (input.retrySummaryReasoningPolicy ?? "not_supported")
      try {
        const generated = await runWithOperationCancellation({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_summary_condense_canceled_during_provider",
          run: () =>
            input.generator!({
              operationID: input.operationID,
              conversationID: input.conversationID,
              promptVersion,
              prompt,
              request,
              sourceItems: input.sourceItems,
              attempt,
              maxOutputTokens: summaryGenerationMaxOutputTokens,
              summaryReasoningPolicy,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
            }),
        })
        throwIfSummaryCanceled({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_summary_condense_canceled_after_provider",
        })
        const output = typeof generated === "string" ? { text: generated } : generated
        const contentText = output.text.trim()
        lastUsage = output.usage ?? lastUsage
        const summaryTokenCount = await input.counter.countText({ text: contentText })
        throwIfSummaryCanceled({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_summary_condense_canceled_after_count",
        })
        const objectiveStatus = evaluateSummaryQuality({
          sourceText,
          candidateText: contentText,
          sourceTokenCount,
          summaryTokenCount,
          summaryTargetTokens,
          allowAggressiveOversize: input.allowAggressiveOversize,
        })
        usageEvidence.push({
          providerBacked: true,
          usage: output.usage,
          summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          maintenanceInputBudget,
          summarySourceTokens: sourceTokenCount,
          candidateSummaryTokens: summaryTokenCount,
          ...(objectiveStatus === "provider_accepted" ? { acceptedSummaryTokens: summaryTokenCount } : {}),
          summaryObjectiveStatus: objectiveStatus,
          summaryFallbackMode: "none",
          summaryReasoningPolicy,
          summaryRetryAttempt,
        })
        if (objectiveStatus === "provider_accepted") {
          return {
            contentText,
            sourceTokenCount,
            summaryTokenCount,
            promptVersion,
            objectiveStatus,
            fallbackMode: "none",
            attempts,
            usage: output.usage ?? lastUsage,
            usageEvidence,
          }
        }
      } catch (error) {
        const canceled = canceledSafeError(error)
        if (isLcmProviderCapacityDeferredError(error)) throw error
        if (canceled) throw canceled
        continue
      }
    }
  }

  if (!allowFallback) {
    throw new LcmSummaryObjectiveFailedError("lcm_summary_condense_objective_failed", usageEvidence)
  }

  const fallback = await buildDeterministicSummaryFallback({
    sourceText,
    sourceTokenCount,
    counter: input.counter,
    summaryTargetTokens,
    operationID: input.operationID,
    abortSignal: input.abortSignal,
  })
  return {
    contentText: fallback.contentText,
    sourceTokenCount,
    summaryTokenCount: fallback.tokenCount,
    promptVersion,
    objectiveStatus: "fallback_accepted",
    fallbackMode: "extractive_key_points",
    attempts,
    usage: undefined,
    usageEvidence: [
      ...usageEvidence,
      {
        providerBacked: false,
        summaryTargetTokens,
        summaryGenerationMaxOutputTokens,
        maintenanceInputBudget,
        summarySourceTokens: sourceTokenCount,
        acceptedSummaryTokens: fallback.tokenCount,
        summaryObjectiveStatus: "fallback_accepted",
        summaryFallbackMode: "extractive_key_points",
        summaryReasoningPolicy: input.retrySummaryReasoningPolicy ?? input.summaryReasoningPolicy ?? "not_supported",
        summaryRetryAttempt: Math.max(0, attempts),
      },
    ],
  }
}

export async function runLeafSummaryGeneration(input: {
  operationID: OperationID
  conversationID: ConversationID
  sourceItems: LcmLeafSummarySourceItem[]
  counter: LcmTokenCounter
  generator?: LcmLeafSummaryGenerator
  maxAttempts?: number
  allowFallback?: boolean
  summaryTargetTokens?: number
  summaryGenerationMaxOutputTokens?: number
  maintenanceInputBudget?: number
  summaryReasoningPolicy?: LcmSummaryReasoningPolicy
  retrySummaryReasoningPolicy?: LcmSummaryReasoningPolicy
  allowAggressiveOversize?: boolean
  abortSignalID?: string
  abortSignal?: AbortSignal
}): Promise<LcmLeafSummaryRunResult> {
  const sourceTokenCount = input.sourceItems.reduce((total, item) => total + item.tokenCount, 0)
  const sourceText = renderLeafSummarySourceItems(input.sourceItems)
  const request = renderLeafSummaryPromptRequest(input.sourceItems)
  const prompt = request.prompt
  const maxAttempts = Math.max(0, input.maxAttempts ?? 2)
  const allowFallback = input.allowFallback ?? true
  const summaryTargetTokens = floorFiniteNonNegative(input.summaryTargetTokens, LCM_SUMMARY_TARGET_TOKENS)
  const summaryGenerationMaxOutputTokens = floorFiniteNonNegative(
    input.summaryGenerationMaxOutputTokens,
    LCM_SUMMARY_GENERATION_MAX_OUTPUT_TOKENS,
  )
  const maintenanceInputBudget = floorFiniteNonNegative(input.maintenanceInputBudget, sourceTokenCount)
  const usageEvidence: LcmSummaryAttemptEvidence[] = []

  let lastUsage: LcmLeafSummaryUsage | undefined
  let attempts = 0
  if (input.generator && maxAttempts > 0) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfSummaryCanceled({
        abortSignal: input.abortSignal,
        operationID: input.operationID,
        diagnosticCode: "lcm_leaf_summary_canceled_before_attempt",
      })
      attempts = attempt
      const summaryRetryAttempt = attempt - 1
      const summaryReasoningPolicy =
        summaryRetryAttempt === 0
          ? (input.summaryReasoningPolicy ?? "provider_default")
          : (input.retrySummaryReasoningPolicy ?? "not_supported")
      try {
        const generated = await runWithOperationCancellation({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_leaf_summary_canceled_during_provider",
          run: () =>
            input.generator!({
              operationID: input.operationID,
              conversationID: input.conversationID,
              promptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
              prompt,
              request,
              sourceItems: input.sourceItems,
              attempt,
              maxOutputTokens: summaryGenerationMaxOutputTokens,
              summaryReasoningPolicy,
              abortSignalID: input.abortSignalID,
              abortSignal: input.abortSignal,
            }),
        })
        throwIfSummaryCanceled({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_leaf_summary_canceled_after_provider",
        })
        const output = typeof generated === "string" ? { text: generated } : generated
        const contentText = output.text.trim()
        lastUsage = output.usage ?? lastUsage
        const summaryTokenCount = await input.counter.countText({ text: contentText })
        throwIfSummaryCanceled({
          abortSignal: input.abortSignal,
          operationID: input.operationID,
          diagnosticCode: "lcm_leaf_summary_canceled_after_count",
        })
        const objectiveStatus = evaluateSummaryQuality({
          sourceText,
          candidateText: contentText,
          sourceTokenCount,
          summaryTokenCount,
          summaryTargetTokens,
          allowAggressiveOversize: input.allowAggressiveOversize,
        })
        usageEvidence.push({
          providerBacked: true,
          usage: output.usage,
          summaryTargetTokens,
          summaryGenerationMaxOutputTokens,
          maintenanceInputBudget,
          summarySourceTokens: sourceTokenCount,
          candidateSummaryTokens: summaryTokenCount,
          ...(objectiveStatus === "provider_accepted" ? { acceptedSummaryTokens: summaryTokenCount } : {}),
          summaryObjectiveStatus: objectiveStatus,
          summaryFallbackMode: "none",
          summaryReasoningPolicy,
          summaryRetryAttempt,
        })
        if (objectiveStatus === "provider_accepted") {
          return {
            contentText,
            sourceTokenCount,
            summaryTokenCount,
            promptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
            objectiveStatus,
            fallbackMode: "none",
            attempts,
            usage: output.usage ?? lastUsage,
            usageEvidence,
          }
        }
      } catch (error) {
        const canceled = canceledSafeError(error)
        if (isLcmProviderCapacityDeferredError(error)) throw error
        if (canceled) throw canceled
        continue
      }
    }
  }

  if (!allowFallback) {
    throw new LcmSummaryObjectiveFailedError("lcm_leaf_summary_objective_failed", usageEvidence)
  }

  const fallback = await buildDeterministicLeafSummaryFallback({
    sourceText,
    sourceTokenCount,
    counter: input.counter,
    summaryTargetTokens,
    operationID: input.operationID,
    abortSignal: input.abortSignal,
  })
  return {
    contentText: fallback.contentText,
    sourceTokenCount,
    summaryTokenCount: fallback.tokenCount,
    promptVersion: LCM_LEAF_SUMMARY_PROMPT_VERSION,
    objectiveStatus: "fallback_accepted",
    fallbackMode: "extractive_key_points",
    attempts,
    usage: undefined,
    usageEvidence: [
      ...usageEvidence,
      {
        providerBacked: false,
        summaryTargetTokens,
        summaryGenerationMaxOutputTokens,
        maintenanceInputBudget,
        summarySourceTokens: sourceTokenCount,
        acceptedSummaryTokens: fallback.tokenCount,
        summaryObjectiveStatus: "fallback_accepted",
        summaryFallbackMode: "extractive_key_points",
        summaryReasoningPolicy: input.retrySummaryReasoningPolicy ?? input.summaryReasoningPolicy ?? "not_supported",
        summaryRetryAttempt: Math.max(0, attempts),
      },
    ],
  }
}
