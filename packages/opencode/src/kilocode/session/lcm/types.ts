import type { ModelMessage } from "ai"

export const LCM_SCHEMA_VERSION = 1

export type SourceKind = "user_text" | "assistant_text" | "reasoning" | "tool" | "media" | "attachment"
export type GenerationMode = "normal" | "aggressive" | "deterministic"
export type MemoryHealth = "ok" | "degraded"
export type MemoryMode = "raw" | "preparing" | "summarized"
export type ActivityKind = "summary_created" | "frontier_advanced" | "intervention" | "fallback" | "rebuild"

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

export interface ReadableSource extends FinalSource {
  content: string
  immutableMedia?: {
    bytes: Uint8Array
    mediaType: string
    filename?: string
  }
}

export interface TranscriptLineage {
  sessionID: string
  digest: string
  sourceCount: number
  lastSourceID?: string
}

export interface FinalSourcePage {
  items: FinalSource[]
  next?: number
  lineage: TranscriptLineage
}

export interface TranscriptSource {
  listFinalSources(input: {
    sessionID: string
    after?: number
    limit: number
    signal?: AbortSignal
  }): Promise<FinalSourcePage>
  readSource(input: { sessionID: string; sourceID: string; signal?: AbortSignal }): Promise<ReadableSource | undefined>
  computeLineage(input: { sessionID: string; signal?: AbortSignal }): Promise<TranscriptLineage>
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
  requestID?: string
  generationID?: string
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
  reason: "background" | "hard_ready" | "hard_built" | "rebuild"
  items: FrontierItem[]
  createdAt: number
}

export interface ActivityRecord {
  id: string
  sessionID: string
  sequence?: number
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
  reason: "soft_ready" | "hard_ready" | "hard_built" | "latest"
  pre: NormalizedModelInput
  post: NormalizedModelInput
  pressureBefore?: number
  pressureAfter?: number
  rawTokens: number
  summaryTokens: number
  createdAt: number
}

export interface NormalizedModelInput {
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, unknown>
}

export interface MemoryState {
  sessionID: string
  lineageDigest?: string
  indexedThrough?: number
  sourceCount: number
  pendingSources: number
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

export interface ProjectionInput {
  sessionID: string
  lineage: TranscriptLineage
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, unknown>
  contextTokens?: number
  outputTokens: number
  thresholdRatio: number
  protectedTailMessages: number
  requestID?: string
  continuationID?: string
  reason: "soft" | "hard"
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
  getSummary(sessionID: string, summaryID: string): Promise<SummaryNode | undefined>
  findSummary(sessionID: string, nodeKey: string): Promise<SummaryNode | undefined>
  listSummaries(sessionID: string): Promise<SummaryNode[]>
  listChildren(sessionID: string, summaryID: string): Promise<SummaryChild[]>
  commitRevision(revision: FrontierRevision): Promise<void>
  activeRevision(sessionID: string, lineageDigest: string): Promise<FrontierRevision | undefined>
  appendActivity(record: ActivityRecord): Promise<ActivityRecord>
  listActivity(sessionID: string, input?: { before?: number; limit?: number }): Promise<ActivityRecord[]>
  recordFrame(frame: ContextFrame): Promise<void>
  listFrames(sessionID: string): Promise<ContextFrame[]>
  acquireLease(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<boolean>
  releaseLease(input: { key: string; owner: string }): Promise<void>
  deleteSession(sessionID: string): Promise<void>
  close(): void
}
