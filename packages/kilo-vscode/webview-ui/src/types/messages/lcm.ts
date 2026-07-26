export interface LcmStatus {
  sessionID: string
  sequence: number
  mode: "raw" | "preparing" | "summarized"
  health: "ok" | "degraded"
  capacity: {
    known: boolean
    usableInputTokens?: number
    rawInputTokens?: number
    activeInputTokens?: number
    freeTokens?: number
    pressureRatio?: number
    thresholdRatio?: number
  }
  composition: {
    revisionID?: string
    rawTokens: number
    summaryTokens: number
    rawItems: number
    summaryItems: number
  }
  background: {
    pendingSources: number
    summarizing: boolean
  }
  memoryWork: {
    attempts: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
  }
  lastInterventionAt?: number
  issue?: {
    code: string
    message: string
    since: number
    lastAt: number
    nextRetryAt?: number
  }
}

export interface LcmStatusMessage {
  type: "lcmStatus"
  sessionID: string
  status?: LcmStatus
}

export interface LcmActivity {
  id: string
  sessionID: string
  sequence: number
  kind: "summary_created" | "frontier_advanced" | "intervention" | "fallback" | "rebuild"
  pressureBefore?: number
  pressureAfter?: number
  rawTokens?: number
  summaryTokens?: number
  summaryIDs?: string[]
  message: string
  createdAt: number
}

export interface LcmActivityMessage {
  type: "lcmActivity"
  sessionID: string
  items: LcmActivity[]
}

export type LcmRequest =
  | { type: "requestLcmStatus"; sessionID: string }
  | { type: "showLcmTimeline"; sessionID: string }
  | { type: "exportLcmContext"; sessionID: string }
