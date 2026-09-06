import { Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"

export const Issue = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  since: NonNegativeInt,
  lastAt: NonNegativeInt,
  nextRetryAt: Schema.optional(NonNegativeInt),
})

export const MemoryWork = Schema.Struct({
  attempts: NonNegativeInt,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  cost: Schema.Finite,
})

export const Status = Schema.Struct({
  sessionID: Schema.String,
  sequence: NonNegativeInt,
  mode: Schema.Literals(["raw", "preparing", "summarized"]),
  health: Schema.Literals(["ok", "degraded"]),
  capacity: Schema.Struct({
    known: Schema.Boolean,
    usableInputTokens: Schema.optional(NonNegativeInt),
    rawInputTokens: Schema.optional(NonNegativeInt),
    activeInputTokens: Schema.optional(NonNegativeInt),
    freeTokens: Schema.optional(NonNegativeInt),
    pressureRatio: Schema.optional(Schema.Finite),
    thresholdRatio: Schema.optional(Schema.Finite),
    softThresholdTokens: Schema.optional(NonNegativeInt),
    rawLaneTokens: Schema.optional(NonNegativeInt),
    rawLaneRatio: Schema.optional(Schema.Finite),
    fixedInputTokens: Schema.optional(NonNegativeInt),
  }),
  composition: Schema.Struct({
    revisionID: Schema.optional(Schema.String),
    rawTokens: NonNegativeInt,
    summaryTokens: NonNegativeInt,
    rawItems: NonNegativeInt,
    summaryItems: NonNegativeInt,
    eligibleRawTokens: NonNegativeInt,
    eligibleRawItems: NonNegativeInt,
    protectedRawTokens: NonNegativeInt,
    protectedRawItems: NonNegativeInt,
    recentConsumedRawTokens: NonNegativeInt,
    recentConsumedRawItems: NonNegativeInt,
    unconsumedRawTokens: NonNegativeInt,
    unconsumedRawItems: NonNegativeInt,
  }),
  background: Schema.Struct({
    summarizing: Schema.Boolean,
    phase: Schema.Literals(["idle", "soft_queued", "soft_running", "hard_running", "manual_running", "constrained"]),
  }),
  memoryWork: MemoryWork,
  lastInterventionAt: Schema.optional(NonNegativeInt),
  issue: Schema.optional(Issue),
})

export const Activity = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  sequence: NonNegativeInt,
  kind: Schema.Literals(["frontier_advanced", "intervention", "fallback", "rebuild"]),
  pressureBefore: Schema.optional(Schema.Finite),
  pressureAfter: Schema.optional(Schema.Finite),
  rawTokens: Schema.optional(NonNegativeInt),
  summaryTokens: Schema.optional(NonNegativeInt),
  summaryIDs: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.String,
  createdAt: NonNegativeInt,
})

export const ActivityPage = Schema.Struct({
  items: Schema.Array(Activity),
  nextCursor: Schema.optional(Schema.String),
})

export type Status = typeof Status.Type
export type Activity = typeof Activity.Type
