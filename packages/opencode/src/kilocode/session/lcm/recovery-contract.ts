import type { SessionV1 } from "@opencode-ai/core/v1/session"

export const LCM_QUERY_TOOL = "lcm_query"
export const LCM_RECOVERY_AGENT = "lcm-recovery"
export const LCM_RECOVERY_FINALIZER_AGENT = "lcm-recovery-finalizer"
export const LCM_RECOVERY_SOURCE_METADATA = "lcmRecoverySourceSessionID"
export const LCM_RECOVERY_QUESTION_METADATA = "lcmRecoveryQuestion"
export const LCM_RECOVERY_STRUCTURED_TOOL = "StructuredOutput"

export const LCM_RECOVERY_AGENTS = [LCM_RECOVERY_AGENT, LCM_RECOVERY_FINALIZER_AGENT] as const

export const LCM_INTERNAL_RECOVERY_TOOLS = [
  "lcm_grep",
  "lcm_describe",
  "lcm_expand_query",
  "lcm_expand",
  "lcm_read",
] as const

export type LcmInternalRecoveryTool = (typeof LCM_INTERNAL_RECOVERY_TOOLS)[number]

export type LcmRecoveryConfig = {
  conversation_memory?: {
    recovery?: {
      max_queries_per_turn?: number
      max_research_steps?: number
      max_tool_calls?: number
      max_semantic_inferences?: number
      max_repair_attempts?: number
      research_timeout_seconds?: number
      finalizer_timeout_seconds?: number
      cleanup_timeout_seconds?: number
    }
  }
}

export type LcmRecoveryLimits = {
  queryTurnLimit: number
  researchMaxSteps: number
  toolLimit: number
  semanticInferenceLimit: number
  repairMaxAttempts: number
  researchWallTimeMs: number
  finalizerWallTimeMs: number
  cleanupWallTimeMs: number
  activeWallTimeMs: number
  wallTimeMs: number
}

const DEFAULT_RECOVERY_LIMITS = {
  queryTurnLimit: 2,
  researchMaxSteps: 1,
  toolLimit: 2,
  semanticInferenceLimit: 1,
  repairMaxAttempts: 2,
  researchWallTimeMs: 9 * 60_000,
  finalizerWallTimeMs: 10 * 60_000,
  cleanupWallTimeMs: 60_000,
} as const

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function positiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function timeoutMs(value: number | undefined, fallback: number) {
  const seconds = positiveInteger(value, fallback / 1_000)
  return Math.min(Number.MAX_SAFE_INTEGER, seconds * 1_000)
}

function saturatedAdd(...values: number[]) {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    values.reduce((total, value) => total + value, 0),
  )
}

function reservationExpiry(now: number, limits: LcmRecoveryLimits) {
  return saturatedAdd(now, limits.wallTimeMs, limits.wallTimeMs)
}

export function lcmRecoveryLimits(config?: LcmRecoveryConfig): LcmRecoveryLimits {
  const recovery = config?.conversation_memory?.recovery
  const researchWallTimeMs = timeoutMs(recovery?.research_timeout_seconds, DEFAULT_RECOVERY_LIMITS.researchWallTimeMs)
  const finalizerWallTimeMs = timeoutMs(
    recovery?.finalizer_timeout_seconds,
    DEFAULT_RECOVERY_LIMITS.finalizerWallTimeMs,
  )
  const cleanupWallTimeMs = timeoutMs(recovery?.cleanup_timeout_seconds, DEFAULT_RECOVERY_LIMITS.cleanupWallTimeMs)
  const activeWallTimeMs = saturatedAdd(researchWallTimeMs, finalizerWallTimeMs)
  return {
    queryTurnLimit: nonNegativeInteger(recovery?.max_queries_per_turn, DEFAULT_RECOVERY_LIMITS.queryTurnLimit),
    researchMaxSteps: positiveInteger(recovery?.max_research_steps, DEFAULT_RECOVERY_LIMITS.researchMaxSteps),
    toolLimit: nonNegativeInteger(recovery?.max_tool_calls, DEFAULT_RECOVERY_LIMITS.toolLimit),
    semanticInferenceLimit: nonNegativeInteger(
      recovery?.max_semantic_inferences,
      DEFAULT_RECOVERY_LIMITS.semanticInferenceLimit,
    ),
    repairMaxAttempts: nonNegativeInteger(recovery?.max_repair_attempts, DEFAULT_RECOVERY_LIMITS.repairMaxAttempts),
    researchWallTimeMs,
    finalizerWallTimeMs,
    cleanupWallTimeMs,
    activeWallTimeMs,
    wallTimeMs: saturatedAdd(activeWallTimeMs, cleanupWallTimeMs),
  }
}

export const LCM_QUERY_TURN_LIMIT = DEFAULT_RECOVERY_LIMITS.queryTurnLimit
export const LCM_RECOVERY_TOOL_LIMIT = DEFAULT_RECOVERY_LIMITS.toolLimit
export const LCM_RECOVERY_SEMANTIC_INFERENCE_LIMIT = DEFAULT_RECOVERY_LIMITS.semanticInferenceLimit
export const LCM_QUERY_MAX_QUESTION_CHARS = 1_024
export const LCM_RECOVERY_RESEARCH_MAX_STEPS = DEFAULT_RECOVERY_LIMITS.researchMaxSteps
export const LCM_RECOVERY_FINALIZER_MAX_STEPS = 1
export const LCM_RECOVERY_REPAIR_MAX_ATTEMPTS = DEFAULT_RECOVERY_LIMITS.repairMaxAttempts
export const LCM_RECOVERY_MAX_STEPS =
  LCM_RECOVERY_RESEARCH_MAX_STEPS + LCM_RECOVERY_FINALIZER_MAX_STEPS * (1 + LCM_RECOVERY_REPAIR_MAX_ATTEMPTS)
export const LCM_RECOVERY_RESEARCH_WALL_TIME_MS = DEFAULT_RECOVERY_LIMITS.researchWallTimeMs
export const LCM_RECOVERY_FINALIZER_WALL_TIME_MS = DEFAULT_RECOVERY_LIMITS.finalizerWallTimeMs
export const LCM_RECOVERY_CLEANUP_WALL_TIME_MS = DEFAULT_RECOVERY_LIMITS.cleanupWallTimeMs
export const LCM_RECOVERY_WALL_TIME_MS =
  LCM_RECOVERY_RESEARCH_WALL_TIME_MS + LCM_RECOVERY_FINALIZER_WALL_TIME_MS + LCM_RECOVERY_CLEANUP_WALL_TIME_MS
export const LCM_RECOVERY_MAX_ANSWER_CHARS = 1_024
export const LCM_RECOVERY_CANDIDATE_LEDGER_CHARS = 65_536
export const LCM_RECOVERY_INITIAL_LEDGER_CHARS = 32_768
export const LCM_RECOVERY_MAX_CITATIONS = 6
export const LCM_RECOVERY_CITATION_BYTES = 512
export const LCM_QUERY_ANSWER_ONLY_PROMPT =
  "Conversation Memory recovery for this user turn is complete. Answer the user now by combining the original active context with each bounded lcm_query answer to its focused question. Recovery results supplement rather than replace the active context: a partial or empty result does not erase independently supported facts already visible there, and you must not omit such facts merely because a recovery answer lacks them. If evidence conflicts, prefer exact claims supported by host-verified citations over unsupported inference. State any unresolved uncertainty. Do not call another tool."
const internal = new Set<string>(LCM_INTERNAL_RECOVERY_TOOLS)

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

// Some OpenAI-compatible endpoints double-encode a tool's sole object argument. Repair only the unambiguous
// lcm_query shapes and let the ordinary schema reject truncated JSON or any wider mutation.
export function repairLcmQueryInput(input: string) {
  let outer: unknown
  try {
    outer = JSON.parse(input)
  } catch {
    return
  }
  if (!record(outer) || Object.keys(outer).length !== 1 || typeof outer.value !== "string") return

  const wrapped = outer.value.trim()
  let question: string | undefined
  try {
    const nested: unknown = JSON.parse(wrapped)
    if (!record(nested) || Object.keys(nested).length !== 1 || typeof nested.question !== "string") return
    question = nested.question.trim()
  } catch {
    if (wrapped.startsWith("{") || wrapped.startsWith("[")) return
    question = wrapped
  }
  if (!question || question.length > LCM_QUERY_MAX_QUESTION_CHARS) return
  return JSON.stringify({ question })
}

export function isLcmInternalRecoveryTool(value: string): value is LcmInternalRecoveryTool {
  return internal.has(value)
}

export function isLcmRecoveryAgent(value: string): value is (typeof LCM_RECOVERY_AGENTS)[number] {
  return LCM_RECOVERY_AGENTS.includes(value as (typeof LCM_RECOVERY_AGENTS)[number])
}

export function lcmRecoveryHardStepExceeded(agent: string, step: number, maxSteps: number) {
  return isLcmRecoveryAgent(agent) && step > maxSteps
}

export function lcmToolAvailable(tool: string, agent: string) {
  if (agent === LCM_RECOVERY_AGENT) return isLcmInternalRecoveryTool(tool)
  if (agent === LCM_RECOVERY_FINALIZER_AGENT) return false
  return tool === LCM_QUERY_TOOL
}

export function lcmRecoverySourceSession(input: {
  agent: string
  session: {
    parentID?: string
    metadata?: Record<string, unknown>
  }
}) {
  if (input.agent !== LCM_RECOVERY_AGENT || !input.session.parentID) return
  const source = input.session.metadata?.[LCM_RECOVERY_SOURCE_METADATA]
  return source === input.session.parentID ? source : undefined
}

export function lcmRecoveryQuestion(input: {
  agent: string
  session: {
    parentID?: string
    metadata?: Record<string, unknown>
  }
}) {
  if (!lcmRecoverySourceSession(input)) return
  const question = input.session.metadata?.[LCM_RECOVERY_QUESTION_METADATA]
  if (typeof question !== "string") return
  const normalized = question.trim()
  if (!normalized || normalized.length > LCM_QUERY_MAX_QUESTION_CHARS) return
  return normalized
}

export function completedLcmRecoveryCalls(messages: readonly SessionV1.WithParts[]) {
  let calls = 0
  // The hidden child exists for exactly one parent question. Structured-output repair prompts add later user
  // messages to that same child, but they must not reset its lifetime research budget.
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (
        part.type === "tool" &&
        isLcmInternalRecoveryTool(part.tool) &&
        (part.state.status === "completed" || part.state.status === "error") &&
        part.state.metadata?.lcmRecoveryBudgetExhausted !== true
      )
        calls++
    }
  }
  return calls
}

export function completedLcmRecoveryOutputs(messages: readonly SessionV1.WithParts[]) {
  const outputs: string[] = []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (
        part.type !== "tool" ||
        !isLcmInternalRecoveryTool(part.tool) ||
        part.state.status !== "completed" ||
        part.state.metadata?.lcmRecoveryBudgetExhausted === true
      )
        continue
      if (typeof part.state.output === "string" && part.state.output.trim()) outputs.push(part.state.output)
    }
  }
  return outputs
}

export function completedLcmQueryCalls(messages: readonly SessionV1.WithParts[]) {
  const currentUser = messages.findLastIndex((message) => message.info.role === "user")
  if (currentUser < 0) return 0
  let calls = 0
  for (const message of messages.slice(currentUser + 1)) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (
        part.type === "tool" &&
        part.tool === LCM_QUERY_TOOL &&
        (part.state.status === "completed" || part.state.status === "error") &&
        typeof part.state.metadata?.isolatedSessionID === "string"
      )
        calls++
    }
  }
  return calls
}

export function lcmQueryBudgetSentinelCompleted(messages: readonly SessionV1.WithParts[]) {
  const currentUser = messages.findLastIndex((message) => message.info.role === "user")
  if (currentUser < 0) return false
  return messages
    .slice(currentUser + 1)
    .some(
      (message) =>
        message.info.role === "assistant" &&
        message.parts.some(
          (part) =>
            part.type === "tool" &&
            part.tool === LCM_QUERY_TOOL &&
            part.state.status === "completed" &&
            part.state.metadata?.lcmQueryBudgetExhausted === true,
        ),
    )
}

export function lcmQueryAnswerOnlyRequired(
  messages: readonly SessionV1.WithParts[],
  limits: LcmRecoveryLimits = lcmRecoveryLimits(),
) {
  return (
    (limits.queryTurnLimit > 0 && completedLcmQueryCalls(messages) >= limits.queryTurnLimit) ||
    lcmQueryBudgetSentinelCompleted(messages)
  )
}

export function lcmQuerySettlementFallbackRequired(
  messages: readonly SessionV1.WithParts[],
  limits: LcmRecoveryLimits = lcmRecoveryLimits(),
) {
  return (
    limits.queryTurnLimit > 0 &&
    completedLcmQueryCalls(messages) >= limits.queryTurnLimit &&
    !lcmQueryBudgetSentinelCompleted(messages)
  )
}

export function lcmToolAvailableInTurn(
  tool: string,
  agent: string,
  messages: readonly SessionV1.WithParts[],
  limits: LcmRecoveryLimits = lcmRecoveryLimits(),
) {
  // Keep the public tool addressable after its child-start allowance is exhausted. A provider may emit a stale or
  // parallel call from an earlier schema; reserveLcmQueryCall settles it with normal terminal guidance instead of an
  // unavailable-tool error that can send the parent into an unrelated recovery loop. The atomic reservation remains
  // the authority for whether another hidden child may start.
  if (tool === LCM_QUERY_TOOL) return limits.queryTurnLimit > 0 && !isLcmRecoveryAgent(agent)
  if (!isLcmInternalRecoveryTool(tool)) return true
  if (agent !== LCM_RECOVERY_AGENT) return false
  const completed = completedLcmRecoveryCalls(messages)
  if (completed >= limits.toolLimit) return false
  // The host prefetches the initial semantic evidence into the isolated transcript, so every recovery primitive may
  // be used immediately for one genuinely narrower scope, candidate, or boundary.
  return true
}

type RecoveryBatch = {
  historical: number
  reserved: number
}

type QueryBatch = RecoveryBatch & {
  questions: Set<string>
}

const queryBatches = new WeakMap<readonly unknown[], QueryBatch>()

type RecoverySessionBudget = {
  used: number
  semanticInferences: number
  tools: Set<LcmInternalRecoveryTool>
  expiresAt: number
}

// Tool executions in one provider batch do not reliably retain the same messages-array identity. The trusted hidden
// child ID is the actual isolation boundary, so reserve against it atomically for the child's complete lifetime.
const recoverySessionBudgets = new Map<string, RecoverySessionBudget>()

function pruneRecoverySessionBudgets(now: number) {
  for (const [sessionID, budget] of recoverySessionBudgets) {
    if (budget.expiresAt <= now) recoverySessionBudgets.delete(sessionID)
  }
}

function normalizedQuestion(value: unknown) {
  if (typeof value !== "string") return
  const question = value.trim().replace(/\s+/g, " ").toLowerCase()
  return question || undefined
}

function completedLcmQuestions(messages: readonly SessionV1.WithParts[]) {
  const currentUser = messages.findLastIndex((message) => message.info.role === "user")
  if (currentUser < 0) return []
  const questions: string[] = []
  for (const message of messages.slice(currentUser + 1)) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (
        part.type !== "tool" ||
        part.tool !== LCM_QUERY_TOOL ||
        (part.state.status !== "completed" && part.state.status !== "error") ||
        typeof part.state.metadata?.isolatedSessionID !== "string"
      )
        continue
      const input = part.state.input
      const question =
        input && typeof input === "object" && !Array.isArray(input)
          ? normalizedQuestion((input as { question?: unknown }).question)
          : undefined
      if (question) questions.push(question)
    }
  }
  return questions
}

export function reserveLcmQueryCall(
  messages: readonly SessionV1.WithParts[],
  tool: string,
  input?: { question?: unknown },
  limits: LcmRecoveryLimits = lcmRecoveryLimits(),
) {
  if (tool !== LCM_QUERY_TOOL) return
  let batch = queryBatches.get(messages)
  if (!batch) {
    batch = {
      historical: completedLcmQueryCalls(messages),
      reserved: 0,
      questions: new Set(completedLcmQuestions(messages)),
    }
    queryBatches.set(messages, batch)
  }
  const question = normalizedQuestion(input?.question)
  const repeated = question ? batch.questions.has(question) : false
  const position = batch.historical + batch.reserved
  if (repeated) {
    return {
      allowed: false,
      completed: Math.min(position, limits.queryTurnLimit),
      limit: limits.queryTurnLimit,
      repeated: true,
    }
  }
  batch.reserved++
  if (question) batch.questions.add(question)
  return {
    allowed: position < limits.queryTurnLimit,
    completed: Math.min(position, limits.queryTurnLimit),
    limit: limits.queryTurnLimit,
    repeated,
  }
}

export function reserveLcmRecoveryToolCall(
  messages: readonly SessionV1.WithParts[],
  tool: string,
  scope: { sessionID: string },
  limits: LcmRecoveryLimits = lcmRecoveryLimits(),
): { allowed: boolean; completed: number; limit: number } | undefined {
  if (!isLcmInternalRecoveryTool(tool)) return
  const now = Date.now()
  pruneRecoverySessionBudgets(now)
  let budget = recoverySessionBudgets.get(scope.sessionID)
  if (!budget) {
    budget = {
      used: completedLcmRecoveryCalls(messages),
      semanticInferences: 0,
      tools: new Set(),
      expiresAt: reservationExpiry(now, limits),
    }
    recoverySessionBudgets.set(scope.sessionID, budget)
  } else {
    budget.used = Math.max(budget.used, completedLcmRecoveryCalls(messages))
    budget.expiresAt = reservationExpiry(now, limits)
  }
  const decision = {
    allowed: budget.used < limits.toolLimit,
    completed: Math.min(budget.used, limits.toolLimit),
    limit: limits.toolLimit,
  }
  if (decision.allowed) {
    budget.used++
    budget.tools.add(tool)
  }
  return decision
}

export function claimLcmRecoverySemanticInference(sessionID: string, limits: LcmRecoveryLimits = lcmRecoveryLimits()) {
  const now = Date.now()
  pruneRecoverySessionBudgets(now)
  let budget = recoverySessionBudgets.get(sessionID)
  if (!budget) {
    budget = {
      used: 0,
      semanticInferences: 0,
      tools: new Set(),
      expiresAt: reservationExpiry(now, limits),
    }
    recoverySessionBudgets.set(sessionID, budget)
  }
  budget.expiresAt = reservationExpiry(now, limits)
  budget.semanticInferences ??= 0
  if (budget.semanticInferences >= limits.semanticInferenceLimit) return false
  budget.semanticInferences++
  return true
}

export function lcmRecoveryBudgetStats(sessionID: string) {
  const budget = recoverySessionBudgets.get(sessionID)
  if (!budget) return
  return {
    calls: budget.used,
    semanticInferences: budget.semanticInferences,
    tools: [...budget.tools].toSorted(),
  }
}

export function lcmQueryBudgetResult(input: { completed: number; limit: number; repeated?: boolean }) {
  return {
    title: input.repeated ? "LCM query already attempted" : "LCM query limit reached",
    metadata: {
      lcmQueryBudgetExhausted: true,
      completed: input.completed,
      limit: input.limit,
      repeated: Boolean(input.repeated),
    },
    output: input.repeated
      ? "No new isolated recovery was started because this same question was already attempted in this turn. Use that bounded result and state any remaining uncertainty; only a materially narrower question can justify the remaining query allowance. Do not substitute cross-session recall for this current-session recovery."
      : "No new isolated recovery was started because the current-session query allowance is exhausted. Do not call lcm_query again or substitute cross-session recall for this current-session recovery in this turn. Answer now from the bounded results already returned and state any remaining uncertainty.",
  }
}

export function lcmRecoveryBudgetResult(input: { completed: number; limit: number }) {
  return {
    title: "LCM isolated recovery budget reached",
    metadata: {
      lcmRecoveryBudgetExhausted: true,
      completed: input.completed,
      limit: input.limit,
    },
    output:
      "No evidence was retrieved. The isolated recovery budget is exhausted; submit the best supported structured answer now, marking unresolved gaps and partial or none coverage.",
  }
}
