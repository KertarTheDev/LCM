// Tool state for tool parts
export type ToolMetadata = Record<string, unknown>
export type ToolTime = {
  start: number
  end?: number
  compacted?: number
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw?: string; metadata?: ToolMetadata; time?: ToolTime }
  | { status: "running"; input: Record<string, unknown>; title?: string; metadata?: ToolMetadata; time?: ToolTime }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata?: ToolMetadata
      time?: ToolTime
      attachments?: FilePart[]
    }
  | { status: "error"; input: Record<string, unknown>; error: string; metadata?: ToolMetadata; time?: ToolTime }

// Base part interface - all parts have these fields
export interface BasePart {
  id: string
  sessionID?: string
  messageID?: string
}

// Part types from the backend
export interface TextPart extends BasePart {
  type: "text"
  text: string
  synthetic?: boolean
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
}

export interface FilePartSource {
  type: "file"
  path: string
  text: {
    value: string
    start: number
    end: number
  }
}

export interface FilePart extends BasePart {
  type: "file"
  mime: string
  url: string
  filename?: string
  source?: FilePartSource
}

export interface ToolPart extends BasePart {
  type: "tool"
  callID?: string
  tool: string
  state: ToolState
  metadata?: ToolMetadata
}

export interface ReasoningPart extends BasePart {
  type: "reasoning"
  text: string
  time?: { start: number; end?: number }
}

// Step parts from the backend
export interface StepStartPart extends BasePart {
  type: "step-start"
}

export interface StepFinishPart extends BasePart {
  type: "step-finish"
  reason?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
}

export interface CompactionPart extends BasePart {
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part = TextPart | FilePart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart | CompactionPart

// Part delta for streaming updates
export interface PartDelta {
  type: "text-delta"
  textDelta?: string
}

// Token usage for assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Context usage derived from LCM metrics or the last assistant message's tokens.
export interface ContextUsage {
  tokens: number
  percentage: number | null
  source: "lcm_active_budget" | "provider_context"
  label: string
  limit?: number
  providerContextLimit?: number
  providerOutputLimit?: number
  outputReserve?: number
  systemPromptTokens?: number
  toolSchemaTokens?: number
  tokenCounterMode?: string
  tokenCounterVersion?: string
  freshTailTokens?: number
  softBacklogTokens?: number
  softThreshold?: number
  freshTailRawTokens?: number
  freshTailRawItemCount?: number
  unconsumedRawTokens?: number
  unconsumedRawItemCount?: number
  protectedTailRawTokens?: number
  protectedTailRawItemCount?: number
  rawLaneTokens?: number
  hardFillRatio?: number | null
  rawLaneRatio?: number | null
  softBacklogRatio?: number | null
  budgetStatus?: "budgeted" | "unavailable" | "provider_limit_fallback"
}

export interface FileAttachment {
  mime: string
  url: string
  filename?: string
  source?: FilePartSource
}
