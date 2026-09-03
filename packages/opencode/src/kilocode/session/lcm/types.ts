import type { ModelMessage } from "ai"

export const LCM_SCHEMA_VERSION = 14
export const LCM_TREE_POLICY = "lcm-tree-v11"
export const DEFAULT_SOFT_THRESHOLD_RATIO = 0.6
export const DEFAULT_RECENT_TAIL_RATIO = 0.15

export type SourceKind = "user_text" | "assistant_text" | "reasoning" | "tool" | "media" | "attachment"
export type GenerationMode = "normal" | "aggressive" | "deterministic"
export type MemoryHealth = "ok" | "degraded"
export type MemoryMode = "raw" | "preparing" | "summarized"
export type ActivityKind = "frontier_advanced" | "intervention" | "fallback" | "rebuild"
export type MaintenancePhase =
  | "idle"
  | "soft_queued"
  | "soft_running"
  | "hard_running"
  | "manual_running"
  | "constrained"

export interface FinalSource {
  id: string
  sessionID: string
  messageID: string
  partID: string
  ordinal: number
  kind: SourceKind
  digest: string
  tokens: number
  bytes: number
  excerpt: string
  mediaType?: string
  filename?: string
}

export interface TranscriptLineage {
  sessionID: string
  digest: string
  sourceCount: number
  lastSourceID?: string
}

export interface SummaryNode {
  id: string
  nodeKey: string
  sessionID: string
  level: number
  text: string
  digest: string
  sourceDigest: string
  tokens: number
  bytes: number
  firstOrdinal: number
  lastOrdinal: number
  generationMode: GenerationMode
  createdAt: number
}

export interface SummaryChild {
  summaryID: string
  kind: "source" | "summary"
  id: string
  ordinal: number
}

export interface SummaryAttempt {
  id: string
  nodeKey: string
  sessionID: string
  providerID?: string
  modelID?: string
  variant?: string
  mode: GenerationMode
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  finish?: string
  errorCode?: string
  durationMs: number
  createdAt: number
}

export interface FrontierItem {
  kind: "source" | "summary"
  id: string
  ordinal: number
}

export interface FrontierRevision {
  id: string
  sessionID: string
  lineageDigest: string
  reason: "soft_leaf" | "hard_level" | "manual" | "append"
  items: FrontierItem[]
  createdAt: number
}

export interface ActivityRecord {
  id: string
  sessionID: string
  sequence: number
  kind: ActivityKind
  pressureBefore?: number
  pressureAfter?: number
  rawTokens?: number
  summaryTokens?: number
  summaryIDs?: string[]
  message: string
  createdAt: number
}

export interface ContextFrame {
  id: string
  sessionID: string
  requestID?: string
  revisionID?: string
  lineageDigest: string
  active: boolean
  reason: "soft_ready" | "hard_ready" | "hard_built" | "manual" | "latest"
  pre: NormalizedModelInput
  post: NormalizedModelInput
  pressureBefore?: number
  pressureAfter?: number
  usableInputTokens: number
  thresholdRatio: number
  rawTokens: number
  rawLaneTokens: number
  fixedInputTokens: number
  recentTailTokens: number
  summaryTokens: number
  createdAt: number
}

export interface NormalizedModelInput {
  system: string[]
  messages: unknown[]
  tools: Record<string, unknown>
}

export interface MemoryState {
  sessionID: string
  sequence: number
  lineageDigest?: string
  indexedThrough?: number
  sourceCount: number
  consumedThrough: number
  state: MemoryMode
  health: MemoryHealth
  issue?: {
    code: string
    message: string
    since: number
    lastAt: number
    nextRetryAt?: number
  }
}

export interface MemoryWork {
  attempts: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

export interface MemoryStoreMetrics {
  work: MemoryWork
}

export interface LcmStatus {
  sessionID: string
  sequence: number
  mode: MemoryMode
  health: MemoryHealth
  capacity: {
    known: boolean
    usableInputTokens?: number
    rawInputTokens?: number
    activeInputTokens?: number
    freeTokens?: number
    pressureRatio?: number
    thresholdRatio?: number
    softThresholdTokens?: number
    rawLaneTokens?: number
    rawLaneRatio?: number
    fixedInputTokens?: number
  }
  composition: {
    revisionID?: string
    rawTokens: number
    summaryTokens: number
    rawItems: number
    summaryItems: number
    eligibleRawTokens: number
    eligibleRawItems: number
    protectedRawTokens: number
    protectedRawItems: number
    recentConsumedRawTokens: number
    recentConsumedRawItems: number
    unconsumedRawTokens: number
    unconsumedRawItems: number
  }
  background: {
    summarizing: boolean
    phase: MaintenancePhase
  }
  memoryWork: MemoryWork
  lastInterventionAt?: number
  issue?: MemoryState["issue"]
}

export interface MaintenanceResult {
  outcome: "maintained" | "noop" | "constrained" | "capacity_unknown" | "unresolved"
  changed: boolean
  beforeTokens: number
  afterTokens: number
  targetTokens: number
  targetReached: boolean
  reducible: boolean
  lineageDigest?: string
  revisionID?: string
}

export interface ProjectionInput {
  sessionID: string
  lineage: TranscriptLineage
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, unknown>
  usableInputTokens: number
  thresholdRatio: number
  recentTailTokens: number
  protectedMessages: ModelMessage[]
  maxEligibleOrdinal: number
  maxConsumedOrdinal: number
  sourceContent: ReadonlyMap<string, string>
  requestID?: string
  continuationID?: string
  reason: "soft" | "hard" | "manual"
  measure(messages: ModelMessage[]): number
  signal?: AbortSignal
}

export type ProjectionResult =
  | { type: "unchanged"; messages: ModelMessage[]; pressure: number }
  | {
      type: "projected"
      messages: ModelMessage[]
      pressureBefore: number
      pressureAfter: number
      revision: FrontierRevision
      rawTokens: number
      summaryTokens: number
    }
  | { type: "unavailable"; messages: ModelMessage[]; pressure: number; code: string }

export interface ConversationMemoryStore {
  inspect(sessionID: string): Promise<MemoryState>
  replaceSources(input: { sessionID: string; lineage: TranscriptLineage; sources: FinalSource[] }): Promise<void>
  listSources(sessionID: string): Promise<FinalSource[]>
  getSource(sessionID: string, sourceID: string): Promise<FinalSource | undefined>
  commitSummary(input: { summary: SummaryNode; children: SummaryChild[]; attempt?: SummaryAttempt }): Promise<void>
  recordAttempt(attempt: SummaryAttempt): Promise<void>
  listAttempts(sessionID: string): Promise<SummaryAttempt[]>
  getSummary(sessionID: string, summaryID: string): Promise<SummaryNode | undefined>
  findSummary(sessionID: string, nodeKey: string): Promise<SummaryNode | undefined>
  listSummaries(sessionID: string): Promise<SummaryNode[]>
  listChildren(sessionID: string, summaryID: string): Promise<SummaryChild[]>
  commitRevision(revision: FrontierRevision): Promise<void>
  getRevision(sessionID: string, revisionID: string): Promise<FrontierRevision | undefined>
  activeRevision(sessionID: string, lineageDigest: string): Promise<FrontierRevision | undefined>
  markConsumed(input: { sessionID: string; lineageDigest: string; throughOrdinal: number }): Promise<void>
  appendActivity(record: Omit<ActivityRecord, "sequence"> & { sequence?: number }): Promise<ActivityRecord>
  listActivity(sessionID: string, input?: { before?: number; limit?: number }): Promise<ActivityRecord[]>
  setIssue(sessionID: string, issue?: NonNullable<MemoryState["issue"]>): Promise<void>
  bumpStatus(sessionID: string): Promise<void>
  metrics(sessionID: string): Promise<MemoryStoreMetrics>
  recordFrame(frame: ContextFrame): Promise<void>
  listFrames(sessionID: string): Promise<ContextFrame[]>
  acquireLease(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<boolean>
  releaseLease(input: { key: string; owner: string }): Promise<void>
  deleteSession(sessionID: string): Promise<void>
  close(): void
}
