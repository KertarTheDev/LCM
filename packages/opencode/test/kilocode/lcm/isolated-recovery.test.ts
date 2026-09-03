import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Deferred, Effect, Option, Schema } from "effect"
import type { FinalSource } from "@/kilocode/session/lcm/types"
import {
  LCM_INTERNAL_RECOVERY_TOOLS,
  LCM_QUERY_MAX_QUESTION_CHARS,
  LCM_QUERY_ANSWER_ONLY_PROMPT,
  LCM_QUERY_TOOL,
  LCM_QUERY_TURN_LIMIT,
  LCM_RECOVERY_AGENT,
  LCM_RECOVERY_CLEANUP_WALL_TIME_MS,
  LCM_RECOVERY_FINALIZER_AGENT,
  LCM_RECOVERY_FINALIZER_MAX_STEPS,
  LCM_RECOVERY_FINALIZER_WALL_TIME_MS,
  LCM_RECOVERY_CANDIDATE_LEDGER_CHARS,
  LCM_RECOVERY_INITIAL_LEDGER_CHARS,
  LCM_RECOVERY_MAX_ANSWER_CHARS,
  LCM_RECOVERY_MAX_STEPS,
  LCM_RECOVERY_RESEARCH_MAX_STEPS,
  LCM_RECOVERY_REPAIR_MAX_ATTEMPTS,
  LCM_RECOVERY_SEMANTIC_INFERENCE_LIMIT,
  LCM_RECOVERY_RESEARCH_WALL_TIME_MS,
  LCM_RECOVERY_QUESTION_METADATA,
  LCM_RECOVERY_SOURCE_METADATA,
  LCM_RECOVERY_TOOL_LIMIT,
  LCM_RECOVERY_WALL_TIME_MS,
  completedLcmRecoveryCalls,
  completedLcmRecoveryOutputs,
  completedLcmQueryCalls,
  claimLcmRecoverySemanticInference,
  lcmToolAvailableInTurn,
  lcmRecoveryBudgetStats,
  lcmRecoveryHardStepExceeded,
  lcmRecoveryLimits,
  lcmRecoveryQuestion,
  lcmRecoverySourceSession,
  lcmQueryBudgetResult,
  lcmQueryAnswerOnlyRequired,
  lcmQueryBudgetSentinelCompleted,
  lcmQuerySettlementFallbackRequired,
  lcmToolAvailable,
  reserveLcmQueryCall,
  reserveLcmRecoveryToolCall,
  repairLcmQueryInput,
} from "@/kilocode/session/lcm/recovery-contract"
import {
  LCM_RECOVERY_OUTPUT_FORMAT,
  boundedRecoveryCandidateLedger,
  combineRecoveryModelUsage,
  isolatedRecoveryParentContext,
  isolatedRecoveryRetrievalQuery,
  latestRecoverySubmission,
  recoveryFinalizerRequest,
  recoveryFullCoverageNeedsReview,
  recoveryCanSynthesizeInChild,
  recoveryModelUsage,
  recoveryResearchCandidateLedger,
  recoverySynthesisRequest,
  runRecoveryCleanupPhases,
  lcmQueryParentGuidance,
  parseRecoverySubmission,
  plainRecoveryFallback,
  recoveryDeadlineObservation,
  verifyRecoverySubmission,
  withRecoveryCompleteDeadline,
  withRecoveryDeadline,
  type RecoveryCitationView,
} from "@/kilocode/tool/lcm-query"
import {
  isolatedQueryEvidenceTokenBudget,
  isolatedQueryEvidenceGuidance,
  queryResultTokenLimit,
  queryUsesNestedInference,
} from "@/kilocode/tool/lcm-expand-query"
import LCM_RECOVERY_PROMPT from "@/kilocode/agent/lcm-recovery.txt"
import LCM_RECOVERY_FINALIZER_PROMPT from "@/kilocode/agent/lcm-recovery-finalizer.txt"
import {
  LcmToolError,
  requireIsolatedRecoverySource,
  requireIsolatedRecoverySummary,
  sourceChronology,
} from "@/kilocode/tool/lcm-common"

function messages(value: unknown[]) {
  return value as SessionV1.WithParts[]
}

function source(input: { id: string; messageID: string; ordinal: number; content: string }): FinalSource {
  return {
    id: input.id,
    sessionID: "ses_parent",
    messageID: input.messageID,
    partID: `part_${input.ordinal}`,
    ordinal: input.ordinal,
    kind: "user_text",
    digest: `digest_${input.ordinal}`,
    tokens: Math.ceil(input.content.length / 4),
    bytes: Buffer.byteLength(input.content),
    excerpt: input.content,
  }
}

describe("LCM isolated recovery contract", () => {
  test("accounts for hidden child and nested semantic model usage without duplicating propagated cost", () => {
    const research = recoveryModelUsage(
      messages([
        {
          info: {
            role: "assistant",
            cost: 0.75,
            tokens: { input: 100, output: 10, reasoning: 2, cache: { read: 40, write: 3 } },
          },
          parts: [
            {
              type: "tool",
              tool: "lcm_expand_query",
              state: {
                status: "completed",
                metadata: {
                  semanticModelUsage: {
                    inputTokens: 500,
                    outputTokens: 50,
                    reasoningTokens: 4,
                    cacheReadTokens: 200,
                    cacheWriteTokens: 5,
                    cost: 0.5,
                  },
                },
              },
            },
          ],
        },
      ]),
    )
    const finalizer = recoveryModelUsage(
      messages([
        {
          info: {
            role: "assistant",
            cost: 0.25,
            tokens: { input: 80, output: 8, reasoning: 0, cache: { read: 20, write: 0 } },
          },
          parts: [],
        },
      ]),
    )
    expect(combineRecoveryModelUsage(research, finalizer)).toEqual({
      providerCalls: 3,
      inputTokens: 680,
      outputTokens: 68,
      reasoningTokens: 6,
      cacheReadTokens: 260,
      cacheWriteTokens: 8,
      cost: 1,
    })
  })

  test("uses a decoded structured-output format at the internal prompt boundary", () => {
    const format = Schema.encodeUnknownSync(SessionV1.Format)(LCM_RECOVERY_OUTPUT_FORMAT)
    expect(format).toMatchObject({
      type: "json_schema",
      retryCount: 0,
    })
    if (format.type !== "json_schema") throw new Error("expected a JSON-schema recovery format")
    expect(JSON.stringify(format.schema)).toContain("not citation intervals")
    expect(JSON.stringify(format.schema)).toContain("512 UTF-8 bytes")
  })

  test("gives research and finalization independent time inside the complete child bound", async () => {
    expect(LCM_RECOVERY_RESEARCH_WALL_TIME_MS).toBe(9 * 60_000)
    expect(LCM_RECOVERY_FINALIZER_WALL_TIME_MS).toBe(10 * 60_000)
    expect(LCM_RECOVERY_CLEANUP_WALL_TIME_MS).toBe(60_000)
    expect(LCM_RECOVERY_WALL_TIME_MS).toBe(20 * 60_000)
    expect(LCM_RECOVERY_WALL_TIME_MS).toBe(
      LCM_RECOVERY_RESEARCH_WALL_TIME_MS + LCM_RECOVERY_FINALIZER_WALL_TIME_MS + LCM_RECOVERY_CLEANUP_WALL_TIME_MS,
    )
    expect(LCM_RECOVERY_TOOL_LIMIT).toBe(2)
    expect(LCM_RECOVERY_MAX_STEPS).toBe(4)
    expect(LCM_RECOVERY_RESEARCH_MAX_STEPS).toBe(1)
    expect(LCM_RECOVERY_FINALIZER_MAX_STEPS).toBe(1)
    expect(LCM_RECOVERY_REPAIR_MAX_ATTEMPTS).toBe(2)
    const result = await Effect.runPromise(withRecoveryDeadline(Effect.never, 5))
    expect(Option.isNone(result)).toBe(true)
  })

  test("distinguishes each isolated recovery deadline while preserving the aggregate flag", () => {
    expect(
      recoveryDeadlineObservation({
        researchDeadlineExceeded: false,
        finalizerDeadlineExceeded: false,
        completeDeadlineExceeded: false,
      }),
    ).toEqual({
      deadlineExceeded: false,
      researchDeadlineExceeded: false,
      finalizerDeadlineExceeded: false,
      completeDeadlineExceeded: false,
      deadlinePhase: "none",
    })
    expect(
      recoveryDeadlineObservation({
        researchDeadlineExceeded: true,
        finalizerDeadlineExceeded: false,
        completeDeadlineExceeded: false,
      }),
    ).toMatchObject({ deadlineExceeded: false, deadlinePhase: "research" })
    expect(
      recoveryDeadlineObservation({
        researchDeadlineExceeded: false,
        finalizerDeadlineExceeded: true,
        completeDeadlineExceeded: false,
      }),
    ).toMatchObject({ deadlineExceeded: true, deadlinePhase: "finalizer" })
    expect(
      recoveryDeadlineObservation({
        researchDeadlineExceeded: true,
        finalizerDeadlineExceeded: true,
        completeDeadlineExceeded: true,
      }),
    ).toMatchObject({ deadlineExceeded: true, deadlinePhase: "complete" })
  })

  test("bounds complete recovery even when interrupted cleanup is still running", async () => {
    const observation = await Effect.runPromise(
      Effect.gen(function* () {
        const releaseCleanup = yield* Deferred.make<void>()
        let cleanupStarted = false
        const startedAt = Date.now()
        const result = yield* withRecoveryCompleteDeadline(
          Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                cleanupStarted = true
              }).pipe(Effect.andThen(Deferred.await(releaseCleanup))),
            ),
          ),
          5,
          5,
        )
        const elapsed = Date.now() - startedAt
        yield* Deferred.succeed(releaseCleanup, undefined)
        return { cleanupStarted, elapsed, result }
      }),
    )
    expect(Option.isNone(observation.result)).toBe(true)
    expect(observation.cleanupStarted).toBe(true)
    expect(observation.elapsed).toBeLessThan(250)
    expect(await Effect.runPromise(withRecoveryCompleteDeadline(Effect.succeed("done"), 100, 100))).toEqual(
      Option.some("done"),
    )
  })

  test("preserves a completed recovery result when cleanup phases fail", async () => {
    const phases: string[] = []
    const result = await Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.void,
        () => Effect.succeed("bounded answer"),
        () =>
          runRecoveryCleanupPhases([
            {
              phase: "cost_propagation",
              effect: Effect.sync(() => phases.push("cost")).pipe(
                Effect.andThen(Effect.fail(new Error("injected bookkeeping failure"))),
              ),
            },
            {
              phase: "usage_metadata",
              effect: Effect.sync(() => phases.push("usage")).pipe(
                Effect.andThen(Effect.die(new Error("injected metadata defect"))),
              ),
            },
          ]),
      ),
    )
    expect(result).toBe("bounded answer")
    expect(phases).toEqual(["cost", "usage"])
  })

  test("uses nested inference for complete single-unit scopes and bounds clipped exact evidence by context", () => {
    expect(queryUsesNestedInference(LCM_RECOVERY_AGENT)).toBe(true)
    expect(queryUsesNestedInference(LCM_RECOVERY_AGENT, true)).toBe(false)
    expect(queryUsesNestedInference(LCM_RECOVERY_AGENT, true, true)).toBe(true)
    expect(queryUsesNestedInference("code")).toBe(true)
    expect(queryUsesNestedInference("code", true)).toBe(true)
    expect(queryResultTokenLimit(LCM_RECOVERY_AGENT)).toBe(2_000)
    expect(queryResultTokenLimit(LCM_RECOVERY_AGENT, undefined, false)).toBe(16_000)
    expect(isolatedQueryEvidenceTokenBudget(95_904)).toBe(16_000)
    expect(isolatedQueryEvidenceTokenBudget(12_000)).toBe(4_000)
    expect(isolatedQueryEvidenceTokenBudget(0)).toBe(4_000)
    expect(queryResultTokenLimit("code")).toBe(1_000)
    expect(LCM_RECOVERY_SEMANTIC_INFERENCE_LIMIT).toBe(1)
    expect(claimLcmRecoverySemanticInference("ses_semantic_inference_once")).toBe(true)
    expect(claimLcmRecoverySemanticInference("ses_semantic_inference_once")).toBe(false)
    expect(lcmRecoveryBudgetStats("ses_semantic_inference_once")?.semanticInferences).toBe(1)
    expect(isolatedQueryEvidenceGuidance(true)).toMatchObject({
      generatedAnswerAccepted: false,
      isolatedSynthesisRequired: true,
      completeEvidence: false,
    })
  })

  test("uses bounded current-request context only to disambiguate isolated retrieval", () => {
    const transcript = messages([
      {
        info: { role: "user" },
        parts: [
          { type: "text", text: "Earlier request" },
          { type: "text", text: "Current broader request about the release sequence" },
          { type: "text", text: "synthetic host text", synthetic: true },
          { type: "text", text: "ignored host text", ignored: true },
        ],
      },
    ])
    expect(isolatedRecoveryParentContext(transcript)).toBe(
      "Earlier request\n\nCurrent broader request about the release sequence",
    )
    expect(isolatedRecoveryRetrievalQuery("Which release was last?", transcript)).toBe(
      "Which release was last?\n\nEarlier request\n\nCurrent broader request about the release sequence",
    )
    expect(isolatedRecoveryRetrievalQuery("Same request", messages([{ info: { role: "user" }, parts: [] }]))).toBe(
      "Same request",
    )
    const bounded = isolatedRecoveryParentContext(
      messages([{ info: { role: "user" }, parts: [{ type: "text", text: "x".repeat(4_096) }] }]),
    )
    expect(bounded.length).toBe(2_048)
    expect(bounded).toContain("current request omitted")
  })

  test("keeps private tool names literal in the recovery prompt", () => {
    expect(LCM_RECOVERY_PROMPT).toContain("lcm_expand_query")
    expect(LCM_RECOVERY_PROMPT).toContain("src_ handles")
    expect(LCM_RECOVERY_PROMPT).toContain("lifetime budget")
    expect(LCM_RECOVERY_PROMPT).toContain("same evidence-bearing")
    expect(LCM_RECOVERY_PROMPT).toContain("hidden transcript")
    expect(LCM_RECOVERY_PROMPT).toContain("fresh tool-free repair session")
    expect(LCM_RECOVERY_PROMPT).toContain("already copied one bounded evidence pass")
    expect(LCM_RECOVERY_PROMPT).toContain("hostStructuralScope")
    expect(LCM_RECOVERY_PROMPT).toContain("contentScope.sourceOrdinalSpan")
    expect(LCM_RECOVERY_PROMPT).toContain("complete single-unit exact lcm_expand_query")
    expect(LCM_RECOVERY_PROMPT).toContain("Clipped exact range and span calls")
    expect(LCM_RECOVERY_PROMPT).toContain("Never replace an exact scope")
    expect(LCM_RECOVERY_PROMPT).toContain("only when no exact host scope exists")
    expect(LCM_RECOVERY_PROMPT).toContain("unscoped semantic query")
    expect(LCM_RECOVERY_PROMPT).toContain("Do not repeat the same scope")
    expect(LCM_RECOVERY_PROMPT).toContain("submit StructuredOutput")
    expect(LCM_RECOVERY_PROMPT).toContain("not parent citation intervals")
    expect(LCM_RECOVERY_PROMPT).toContain("512 UTF-8 bytes")
    expect(LCM_RECOVERY_PROMPT).not.toContain("lcm*expand_query")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("tool-free Conversation Memory finalizer")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("same hidden transcript")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("StructuredOutput")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("plain-text fallback")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("first sentence or line")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("at most 1,024 characters")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("Never silently omit a supported candidate")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("bounded cumulative research ledger")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("fresh hidden")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).toContain("complete repair handoff")
    expect(LCM_RECOVERY_FINALIZER_PROMPT).not.toContain("older private evidence")
    for (const tool of LCM_INTERNAL_RECOVERY_TOOLS) expect(LCM_RECOVERY_FINALIZER_PROMPT).not.toContain(tool)
  })

  test("makes a bounded cumulative research ledger the repair finalizer's immediate handoff", () => {
    const ledger = "candidate one: sum_a\ncandidate two: src_b"
    const request = recoveryFinalizerRequest("Which candidates are supported?", ledger)
    expect(request).toContain(`Question: ${JSON.stringify("Which candidates are supported?")}`)
    expect(request).toContain("Host-captured cumulative research ledger")
    expect(request).toContain(ledger)
    expect(request).toContain("complete research handoff")
    expect(request).toContain("Preserve every supported candidate in this ledger")
    expect(request).not.toContain("older private evidence")

    const bounded = boundedRecoveryCandidateLedger("x".repeat(LCM_RECOVERY_CANDIDATE_LEDGER_CHARS + 100))
    expect(bounded.length).toBe(LCM_RECOVERY_CANDIDATE_LEDGER_CHARS)
    expect(bounded).toContain("candidate ledger bounded by host")

    const cumulative = recoveryResearchCandidateLedger({
      question: "Find every needle decision",
      initialEvidence: `[sum_a] needle alpha ${"initial ".repeat(800)}\n\n[sum_b] needle beta`,
      toolOutputs: [`[src_c] needle gamma ${"tool ".repeat(800)}`],
      synthesis: `needle alpha and needle delta ${"synthesis ".repeat(800)}`,
    })
    expect(cumulative.length).toBeLessThanOrEqual(LCM_RECOVERY_CANDIDATE_LEDGER_CHARS)
    expect(cumulative).toContain("Host-selected evidence digest")
    expect(cumulative).toContain("Completed recovery primitive output")
    expect(cumulative).toContain("Reserved research synthesis")
    for (const candidate of ["needle alpha", "needle beta", "needle gamma", "needle delta"])
      expect(cumulative).toContain(candidate)
    expect(LCM_RECOVERY_INITIAL_LEDGER_CHARS).toBe(32_768)
    expect(LCM_RECOVERY_CANDIDATE_LEDGER_CHARS).toBe(65_536)
  })

  test("starts separately timed synthesis in the evidence-bearing hidden transcript", () => {
    const request = recoverySynthesisRequest(
      "Which candidates are supported?",
      "candidate one: sum_a\ncandidate two: src_b",
      true,
    )
    expect(request).toContain(`Question: ${JSON.stringify("Which candidates are supported?")}`)
    expect(request).toContain("separately timed synthesis step")
    expect(request).toContain("complete existing hidden transcript")
    expect(request).toContain("every completed recovery result")
    expect(request).toContain("Host-captured cumulative candidate ledger for immediate review")
    expect(request).toContain("candidate one: sum_a")
    expect(request).toContain("claimed full coverage after consuming a clipped recovery result")
    expect(request).toContain("Submit the best supported answer now through StructuredOutput")
    expect(request).toContain("Do not call another tool")
  })

  test("reviews full coverage after a clipped recovery primitive result", () => {
    const full = {
      answer: "candidate",
      coverage: "full" as const,
      citations: [],
      unresolved: [],
    }
    const clipped = messages([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "lcm_expand_query",
            state: { status: "completed", output: "bounded evidence", metadata: { truncated: true } },
          },
        ],
      },
    ])
    expect(recoveryFullCoverageNeedsReview(full, clipped)).toBeTrue()
    expect(recoveryFullCoverageNeedsReview({ ...full, coverage: "partial" }, clipped)).toBeFalse()
    expect(
      recoveryFullCoverageNeedsReview(
        full,
        messages([
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "lcm_expand_query",
                state: { status: "completed", output: "complete evidence", metadata: { truncated: false } },
              },
            ],
          },
        ]),
      ),
    ).toBeFalse()
  })

  test("keeps recoverable structured-output failures in the evidence-bearing child for synthesis", () => {
    const structuredError = new SessionV1.StructuredOutputError({
      message: "The research response reached its output limit before submitting structured output",
      retries: 0,
    })
    expect(
      recoveryCanSynthesizeInChild(
        messages([
          { info: { role: "assistant", error: structuredError }, parts: [{ type: "text", text: "ledger" }] },
        ])[0],
      ),
    ).toBeTrue()
    expect(
      recoveryCanSynthesizeInChild(
        messages([{ info: { role: "assistant", error: structuredError.toObject() }, parts: [] }])[0],
      ),
    ).toBeTrue()
    expect(recoveryCanSynthesizeInChild(messages([{ info: { role: "assistant" }, parts: [] }])[0])).toBeTrue()
    expect(
      recoveryCanSynthesizeInChild(
        messages([{ info: { role: "assistant", error: { name: "APIError" } }, parts: [] }])[0],
      ),
    ).toBeFalse()
    expect(recoveryCanSynthesizeInChild(messages([{ info: { role: "user" }, parts: [] }])[0])).toBeFalse()
  })

  test("exposes only the query to ordinary agents and only primitives to the hidden worker", () => {
    expect(lcmToolAvailable(LCM_QUERY_TOOL, "code")).toBe(true)
    for (const tool of LCM_INTERNAL_RECOVERY_TOOLS) {
      expect(lcmToolAvailable(tool, "code")).toBe(false)
      expect(lcmToolAvailable(tool, LCM_RECOVERY_AGENT)).toBe(true)
    }
    expect(lcmToolAvailable(LCM_QUERY_TOOL, LCM_RECOVERY_AGENT)).toBe(false)
    expect(lcmToolAvailable(LCM_QUERY_TOOL, LCM_RECOVERY_FINALIZER_AGENT)).toBe(false)
    for (const tool of LCM_INTERNAL_RECOVERY_TOOLS) {
      expect(lcmToolAvailable(tool, LCM_RECOVERY_FINALIZER_AGENT)).toBe(false)
    }
  })

  test("makes both hidden recovery phase step limits hard host bounds", () => {
    expect(lcmRecoveryHardStepExceeded(LCM_RECOVERY_AGENT, 1, LCM_RECOVERY_RESEARCH_MAX_STEPS)).toBe(false)
    expect(lcmRecoveryHardStepExceeded(LCM_RECOVERY_AGENT, 2, LCM_RECOVERY_RESEARCH_MAX_STEPS)).toBe(true)
    expect(lcmRecoveryHardStepExceeded(LCM_RECOVERY_FINALIZER_AGENT, 1, LCM_RECOVERY_FINALIZER_MAX_STEPS)).toBe(false)
    expect(lcmRecoveryHardStepExceeded(LCM_RECOVERY_FINALIZER_AGENT, 2, LCM_RECOVERY_FINALIZER_MAX_STEPS)).toBe(true)
    expect(lcmRecoveryHardStepExceeded("code", 999, 1)).toBe(false)
  })

  test("repairs only bounded unambiguous lcm_query string wrappers", () => {
    expect(repairLcmQueryInput(JSON.stringify({ value: JSON.stringify({ question: "  What changed?  " }) }))).toBe(
      JSON.stringify({ question: "What changed?" }),
    )
    expect(repairLcmQueryInput(JSON.stringify({ value: "What changed?" }))).toBe(
      JSON.stringify({ question: "What changed?" }),
    )
    expect(repairLcmQueryInput(JSON.stringify({ value: '{"question":"truncated' }))).toBeUndefined()
    expect(repairLcmQueryInput(JSON.stringify({ value: "x".repeat(LCM_QUERY_MAX_QUESTION_CHARS + 1) }))).toBeUndefined()
    expect(repairLcmQueryInput(JSON.stringify({ value: "What changed?", extra: true }))).toBeUndefined()
  })

  test("binds parent memory only from trusted hidden-session metadata", () => {
    expect(
      lcmRecoverySourceSession({
        agent: LCM_RECOVERY_AGENT,
        session: {
          parentID: "ses_parent",
          metadata: { [LCM_RECOVERY_SOURCE_METADATA]: "ses_parent" },
        },
      }),
    ).toBe("ses_parent")
    expect(
      lcmRecoverySourceSession({
        agent: "code",
        session: {
          parentID: "ses_parent",
          metadata: { [LCM_RECOVERY_SOURCE_METADATA]: "ses_parent" },
        },
      }),
    ).toBeUndefined()
    expect(
      lcmRecoverySourceSession({
        agent: LCM_RECOVERY_AGENT,
        session: {
          parentID: "ses_parent",
          metadata: { [LCM_RECOVERY_SOURCE_METADATA]: "ses_other" },
        },
      }),
    ).toBeUndefined()
  })

  test("binds semantic recovery to the exact focused question in trusted child metadata", () => {
    const session = {
      parentID: "ses_parent",
      metadata: {
        [LCM_RECOVERY_SOURCE_METADATA]: "ses_parent",
        [LCM_RECOVERY_QUESTION_METADATA]: "  Which decisions were final?  ",
      },
    }
    expect(lcmRecoveryQuestion({ agent: LCM_RECOVERY_AGENT, session })).toBe("Which decisions were final?")
    expect(lcmRecoveryQuestion({ agent: "code", session })).toBeUndefined()
    expect(
      lcmRecoveryQuestion({
        agent: LCM_RECOVERY_AGENT,
        session: { ...session, parentID: "ses_other" },
      }),
    ).toBeUndefined()
  })

  test("reserves the isolated primitive budget synchronously across parallel siblings", () => {
    const transcript = messages([{ info: { role: "user" }, parts: [] }])
    for (let index = 0; index < LCM_RECOVERY_TOOL_LIMIT; index++) {
      expect(
        reserveLcmRecoveryToolCall(transcript, "lcm_read", {
          sessionID: "ses_parallel_budget",
        }),
      ).toMatchObject({ allowed: true })
    }
    expect(
      reserveLcmRecoveryToolCall(messages([{ info: { role: "user" }, parts: [] }]), "lcm_grep", {
        sessionID: "ses_parallel_budget",
      }),
    ).toEqual({
      allowed: false,
      completed: LCM_RECOVERY_TOOL_LIMIT,
      limit: LCM_RECOVERY_TOOL_LIMIT,
    })
    expect(lcmRecoveryBudgetStats("ses_parallel_budget")).toEqual({
      calls: LCM_RECOVERY_TOOL_LIMIT,
      semanticInferences: 0,
      tools: ["lcm_read"],
    })
  })

  test("does not report a host-suppressed primitive as completed recovery work", () => {
    const transcript = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "lcm_expand_query", state: { status: "completed", output: "kept evidence" } },
          {
            type: "tool",
            tool: "lcm_grep",
            state: {
              status: "completed",
              output: "suppressed receipt",
              metadata: { lcmRecoveryBudgetExhausted: true },
            },
          },
        ],
      },
    ])
    expect(completedLcmRecoveryCalls(transcript)).toBe(1)
    expect(completedLcmRecoveryOutputs(transcript)).toEqual(["kept evidence"])
  })

  test("does not reset the isolated primitive budget for a finalizer correction", () => {
    const transcript = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: Array.from({ length: LCM_RECOVERY_TOOL_LIMIT }, () => ({
          type: "tool",
          tool: "lcm_grep",
          state: { status: "completed" },
        })),
      },
      { info: { role: "user" }, parts: [] },
    ])
    expect(completedLcmRecoveryCalls(transcript)).toBe(LCM_RECOVERY_TOOL_LIMIT)
    expect(lcmToolAvailableInTurn("lcm_read", LCM_RECOVERY_AGENT, transcript)).toBe(false)
    expect(
      reserveLcmRecoveryToolCall(transcript, "lcm_read", {
        sessionID: "ses_retry_budget",
      }),
    ).toEqual({
      allowed: false,
      completed: LCM_RECOVERY_TOOL_LIMIT,
      limit: LCM_RECOVERY_TOOL_LIMIT,
    })
  })

  test("allows one parent question and one narrower follow-up across parallel siblings", () => {
    const transcript = messages([{ info: { role: "user" }, parts: [] }])
    for (let index = 0; index < LCM_QUERY_TURN_LIMIT; index++) {
      expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL)).toMatchObject({ allowed: true })
    }
    expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL)).toEqual({
      allowed: false,
      completed: LCM_QUERY_TURN_LIMIT,
      limit: LCM_QUERY_TURN_LIMIT,
      repeated: false,
    })

    const continued = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: LCM_QUERY_TOOL,
            state: { status: "completed", metadata: { isolatedSessionID: "ses_child_1" } },
          },
        ],
      },
    ])
    expect(reserveLcmQueryCall(continued, LCM_QUERY_TOOL)).toEqual({
      allowed: true,
      completed: 1,
      limit: LCM_QUERY_TURN_LIMIT,
      repeated: false,
    })
    expect(reserveLcmQueryCall(continued, LCM_QUERY_TOOL)).toEqual({
      allowed: false,
      completed: LCM_QUERY_TURN_LIMIT,
      limit: LCM_QUERY_TURN_LIMIT,
      repeated: false,
    })
  })

  test("rejects an identical follow-up without spending the second child slot", () => {
    const transcript = messages([{ info: { role: "user" }, parts: [] }])
    expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL, { question: "Count every roll." })).toMatchObject({
      allowed: true,
      repeated: false,
    })
    expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL, { question: "  count   every ROLL. " })).toEqual({
      allowed: false,
      completed: 1,
      limit: LCM_QUERY_TURN_LIMIT,
      repeated: true,
    })
    expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL, { question: "Which roll came last?" })).toEqual({
      allowed: true,
      completed: 1,
      limit: LCM_QUERY_TURN_LIMIT,
      repeated: false,
    })

    const continued = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: LCM_QUERY_TOOL,
            state: {
              status: "completed",
              input: { question: "Count every roll." },
              metadata: { isolatedSessionID: "ses_child_1" },
            },
          },
          {
            type: "tool",
            tool: LCM_QUERY_TOOL,
            state: {
              status: "completed",
              input: { question: "Count every roll." },
              metadata: { lcmQueryBudgetExhausted: true, repeated: true },
            },
          },
        ],
      },
    ])
    expect(completedLcmQueryCalls(continued)).toBe(1)
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, "code", continued)).toBe(true)
    expect(reserveLcmQueryCall(continued, LCM_QUERY_TOOL, { question: "Which roll came last?" })).toMatchObject({
      allowed: true,
      repeated: false,
    })
  })

  test("invalid provider calls do not consume an actual child allowance", () => {
    const transcript = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: LCM_QUERY_TOOL,
            state: { status: "error", input: { value: "broken" }, error: "Invalid tool input" },
          },
        ],
      },
    ])
    expect(completedLcmQueryCalls(transcript)).toBe(0)
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, "code", transcript)).toBe(true)
    expect(reserveLcmQueryCall(transcript, LCM_QUERY_TOOL, { question: "What changed?" })).toMatchObject({
      allowed: true,
      completed: 0,
    })
  })

  test("prefetched recovery exposes optional primitives and exhausted parents transition directly to answering", () => {
    const fresh = messages([{ info: { role: "user" }, parts: [] }])
    expect(lcmToolAvailableInTurn("lcm_expand_query", LCM_RECOVERY_AGENT, fresh)).toBe(true)
    expect(lcmToolAvailableInTurn("lcm_grep", LCM_RECOVERY_AGENT, fresh)).toBe(true)
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, "code", fresh)).toBe(true)

    const childAfterEvidence = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "lcm_expand_query", state: { status: "completed" } }],
      },
    ])
    expect(lcmToolAvailableInTurn("lcm_grep", LCM_RECOVERY_AGENT, childAfterEvidence)).toBe(true)

    const childAfterNavigation = messages([
      ...childAfterEvidence,
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "lcm_describe", state: { status: "completed" } }],
      },
    ])
    expect(lcmToolAvailableInTurn("lcm_grep", LCM_RECOVERY_AGENT, childAfterNavigation)).toBe(false)

    const exhaustedParent = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: Array.from({ length: LCM_QUERY_TURN_LIMIT }, (_, index) => ({
          type: "tool",
          tool: LCM_QUERY_TOOL,
          state: { status: "completed", metadata: { isolatedSessionID: `ses_child_${index}` } },
        })),
      },
    ])
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, "code", exhaustedParent)).toBe(true)
    expect(lcmQueryAnswerOnlyRequired(exhaustedParent)).toBe(true)
    expect(lcmQuerySettlementFallbackRequired(exhaustedParent)).toBe(true)
    expect(lcmQueryBudgetSentinelCompleted(exhaustedParent)).toBe(false)
    expect(lcmQueryBudgetResult({ completed: LCM_QUERY_TURN_LIMIT, limit: LCM_QUERY_TURN_LIMIT })).toMatchObject({
      metadata: {
        lcmQueryBudgetExhausted: true,
        completed: LCM_QUERY_TURN_LIMIT,
        limit: LCM_QUERY_TURN_LIMIT,
      },
      output: expect.stringContaining("Answer now from the bounded results already returned"),
    })
    expect(lcmQueryBudgetResult({ completed: 1, limit: LCM_QUERY_TURN_LIMIT, repeated: true }).output).toContain(
      "Do not substitute cross-session recall",
    )
    expect(LCM_QUERY_ANSWER_ONLY_PROMPT).toContain("Do not call another tool")
    expect(LCM_QUERY_ANSWER_ONLY_PROMPT).toContain("host-verified citations")
    expect(LCM_QUERY_ANSWER_ONLY_PROMPT).toContain("supplement rather than replace the active context")
    expect(lcmQueryParentGuidance("full")).toContain("supplements rather than replaces")
    expect(lcmQueryParentGuidance("partial")).toContain("retain independently supported facts")
    expect(lcmQueryParentGuidance("none")).toContain("Retain and answer from relevant facts")
    expect(
      lcmQueryAnswerOnlyRequired(
        messages([
          { info: { role: "user" }, parts: [] },
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: LCM_QUERY_TOOL,
                state: { status: "completed", metadata: { lcmQueryBudgetExhausted: true } },
              },
            ],
          },
        ]),
      ),
    ).toBe(true)
    expect(
      lcmQuerySettlementFallbackRequired(
        messages([
          { info: { role: "user" }, parts: [] },
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: LCM_QUERY_TOOL,
                state: { status: "completed", metadata: { lcmQueryBudgetExhausted: true } },
              },
            ],
          },
        ]),
      ),
    ).toBe(false)
    expect(
      lcmQueryAnswerOnlyRequired(
        messages([
          { info: { role: "user" }, parts: [] },
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: LCM_QUERY_TOOL,
                state: { status: "completed", metadata: { lcmQueryBudgetExhausted: true } },
              },
            ],
          },
          { info: { role: "user" }, parts: [] },
        ]),
      ),
    ).toBe(false)

    const exhaustedChild = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: Array.from({ length: LCM_RECOVERY_TOOL_LIMIT }, () => ({
          type: "tool",
          tool: "lcm_read",
          state: { status: "completed" },
        })),
      },
    ])
    expect(lcmToolAvailableInTurn("lcm_read", LCM_RECOVERY_AGENT, exhaustedChild)).toBe(false)
  })

  test("applies configured hidden-worker budgets without weakening isolation", () => {
    const generous = lcmRecoveryLimits({
      conversation_memory: {
        recovery: {
          max_queries_per_turn: 4,
          max_research_steps: 6,
          max_tool_calls: 4,
          max_semantic_inferences: 3,
          max_repair_attempts: 4,
          research_timeout_seconds: 2_400,
          finalizer_timeout_seconds: 900,
          cleanup_timeout_seconds: 120,
        },
      },
    })
    const threeCalls = messages([
      { info: { role: "user" }, parts: [] },
      {
        info: { role: "assistant" },
        parts: Array.from({ length: 3 }, () => ({
          type: "tool",
          tool: "lcm_expand_query",
          state: { status: "completed" },
        })),
      },
    ])
    expect(lcmToolAvailableInTurn("lcm_expand_query", LCM_RECOVERY_AGENT, threeCalls, generous)).toBe(true)
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, LCM_RECOVERY_AGENT, threeCalls, generous)).toBe(false)
    expect(
      reserveLcmRecoveryToolCall(threeCalls, "lcm_read", { sessionID: "ses_generous_budget" }, generous),
    ).toMatchObject({
      allowed: true,
      completed: 3,
      limit: 4,
    })
    expect(claimLcmRecoverySemanticInference("ses_generous_semantic", generous)).toBe(true)
    expect(claimLcmRecoverySemanticInference("ses_generous_semantic", generous)).toBe(true)
    expect(claimLcmRecoverySemanticInference("ses_generous_semantic", generous)).toBe(true)
    expect(claimLcmRecoverySemanticInference("ses_generous_semantic", generous)).toBe(false)

    const disabledQueries = lcmRecoveryLimits({
      conversation_memory: { recovery: { max_queries_per_turn: 0 } },
    })
    const fresh = messages([{ info: { role: "user" }, parts: [] }])
    expect(lcmToolAvailableInTurn(LCM_QUERY_TOOL, "code", fresh, disabledQueries)).toBe(false)
    expect(lcmQueryAnswerOnlyRequired(fresh, disabledQueries)).toBe(false)
    expect(lcmQuerySettlementFallbackRequired(fresh, disabledQueries)).toBe(false)
    expect(reserveLcmQueryCall(fresh, LCM_QUERY_TOOL, { question: "What changed?" }, disabledQueries)).toMatchObject({
      allowed: false,
      limit: 0,
    })
  })

  test("validates concise structured submissions and exact citation bounds", () => {
    expect(LCM_RECOVERY_MAX_ANSWER_CHARS).toBe(1_024)
    expect(
      parseRecoverySubmission({
        answer: "The result is 12.",
        coverage: "full",
        citations: [{ sourceID: "src_prior", startOffset: 6, endOffset: 18 }],
        unresolved: [],
      }),
    ).toEqual({
      answer: "The result is 12.",
      coverage: "full",
      citations: [{ sourceID: "src_prior", startOffset: 6, endOffset: 18 }],
      unresolved: [],
    })
    expect(
      parseRecoverySubmission({
        answer: "A concise uncited synthesis.",
        coverage: "full",
      }),
    ).toEqual({
      answer: "A concise uncited synthesis.",
      coverage: "full",
      citations: [],
      unresolved: [],
    })
    const oversizedAnswer = parseRecoverySubmission({
      answer: "x".repeat(LCM_RECOVERY_MAX_ANSWER_CHARS + 1),
      coverage: "full",
      citations: [],
      unresolved: [],
    })
    expect(oversizedAnswer).toBeUndefined()
    expect(
      parseRecoverySubmission({
        answer: "too wide",
        coverage: "full",
        citations: [{ sourceID: "src_prior", startOffset: 0, endOffset: 513 }],
        unresolved: [],
      }),
    ).toEqual({
      answer: "too wide",
      coverage: "full",
      citations: [],
      unresolved: [],
      rejectedCitations: 1,
    })
    expect(
      parseRecoverySubmission({
        answer: "unsupported",
        coverage: "none",
        citations: [],
        unresolved: [],
      }),
    ).toBeUndefined()
    expect(
      parseRecoverySubmission({
        answer: "unsupported full claim",
        coverage: "full",
        citations: [],
        unresolved: ["A gap remains."],
      }),
    ).toEqual({
      answer: "unsupported full claim",
      coverage: "partial",
      citations: [],
      unresolved: ["A gap remains."],
    })
    expect(
      parseRecoverySubmission({
        answer: "unsupported partial claim",
        coverage: "partial",
        citations: [],
        unresolved: [],
      }),
    ).toEqual({
      answer: "unsupported partial claim",
      coverage: "partial",
      citations: [],
      unresolved: ["The isolated answer reported partial coverage without naming a remaining gap."],
    })
    expect(
      parseRecoverySubmission({
        answer: "A bounded partial answer.",
        coverage: "partial",
        citations: [],
        unresolved: ["g".repeat(300)],
      }),
    ).toEqual({
      answer: "A bounded partial answer.",
      coverage: "partial",
      citations: [],
      unresolved: ["g".repeat(240)],
    })
  })

  test("reads the terminal structured answer persisted after a tool transition", () => {
    const submission = {
      answer: "The supported result.",
      coverage: "full" as const,
      citations: [],
      unresolved: [],
    }
    expect(
      latestRecoverySubmission(
        messages([
          {
            info: { role: "assistant" },
            parts: [{ type: "tool", tool: "lcm_expand_query", state: { status: "completed" } }],
          },
          {
            info: { role: "assistant", structured: submission },
            parts: [{ type: "tool", tool: "StructuredOutput", state: { status: "completed" } }],
          },
        ]),
      ),
    ).toEqual(submission)
    expect(
      latestRecoverySubmission(
        messages([
          {
            info: { role: "assistant", structured: submission },
            parts: [
              { type: "tool", tool: "lcm_read", state: { status: "completed" } },
              { type: "tool", tool: "StructuredOutput", state: { status: "completed" } },
            ],
          },
        ]),
      ),
    ).toBeUndefined()
    expect(
      latestRecoverySubmission(
        messages([
          {
            info: {
              role: "assistant",
              structured: { ...submission, answer: "x".repeat(LCM_RECOVERY_MAX_ANSWER_CHARS + 1) },
            },
            parts: [{ type: "tool", tool: "StructuredOutput", state: { status: "completed" } }],
          },
        ]),
      ),
    ).toBeUndefined()
  })

  test("bounds an unstructured tool-free correction as partial and uncited", () => {
    expect(plainRecoveryFallback("  A short answer from private evidence.  ")).toEqual({
      accepted: true,
      rejected: 0,
      answer: "A short answer from private evidence.",
      coverage: "partial",
      citations: [],
      unresolved: [
        "Structured coverage and citations were unavailable; this bounded answer was synthesized from the host-captured cumulative research ledger.",
      ],
    })
    const bounded = plainRecoveryFallback(`Direct answer. ${"detail ".repeat(300)}`)
    expect(bounded?.answer.startsWith("Direct answer.")).toBe(true)
    expect(bounded?.answer.length).toBe(LCM_RECOVERY_MAX_ANSWER_CHARS)
    expect(bounded?.unresolved[0]).toContain("bounded to the maximum answer size")
    expect(plainRecoveryFallback("   ")).toBeUndefined()
  })

  test("copies exact prior-turn bytes and omits current-turn citations", () => {
    const priorText = "alpha decisive evidence omega"
    const currentText = "current user text"
    const prior = source({ id: "src_prior", messageID: "msg_prior", ordinal: 0, content: priorText })
    const current = source({ id: "src_current", messageID: "msg_current", ordinal: 1, content: currentText })
    const view: RecoveryCitationView = {
      sources: new Map([
        [prior.id, prior],
        [current.id, current],
      ]),
      content: new Map([
        [prior.id, { metadata: prior, content: priorText }],
        [current.id, { metadata: current, content: currentText }],
      ]),
      transcript: messages([
        { info: { id: "msg_prior", role: "user" }, parts: [] },
        { info: { id: "msg_consumed", role: "assistant" }, parts: [] },
        { info: { id: "msg_current", role: "user" }, parts: [] },
      ]),
    }
    const accepted = verifyRecoverySubmission(
      {
        answer: "decisive evidence",
        coverage: "full",
        citations: [{ sourceID: prior.id, startOffset: 6, endOffset: 23 }],
        unresolved: [],
      },
      view,
    )
    expect(accepted).toMatchObject({ accepted: true, rejected: 0, coverage: "full" })
    expect(accepted.citations).toEqual([
      {
        sourceID: prior.id,
        sourceOrdinal: 0,
        sourceKind: "user_text",
        startOffset: 6,
        endOffset: 23,
        excerpt: "decisive evidence",
      },
    ])

    const downgraded = verifyRecoverySubmission(
      {
        answer: "current",
        coverage: "full",
        citations: [{ sourceID: current.id, startOffset: 0, endOffset: 7 }],
        unresolved: [],
      },
      view,
    )
    expect(downgraded).toMatchObject({
      accepted: true,
      rejected: 1,
      answer: "current",
      coverage: "partial",
      unresolved: ["1 optional exact citation was omitted because host validation failed."],
    })
    expect(downgraded.citations).toEqual([])

    const normalized = parseRecoverySubmission({
      answer: "prior evidence",
      coverage: "full",
      citations: [{ sourceID: prior.id, startOffset: 0, endOffset: 513 }],
      unresolved: [],
    })
    expect(normalized).toBeDefined()
    if (!normalized) throw new Error("expected a normalized recovery submission")
    const normalizedCitationOmission = verifyRecoverySubmission(normalized, view)
    expect(normalizedCitationOmission).toMatchObject({
      accepted: true,
      rejected: 1,
      answer: "prior evidence",
      coverage: "partial",
      unresolved: ["1 optional exact citation was omitted because host validation failed."],
    })
    expect(normalizedCitationOmission.citations).toEqual([])
  })

  test("applies the prior-turn boundary to explicit source and summary scopes", () => {
    const prior = source({ id: "src_prior_scope", messageID: "msg_prior", ordinal: 3, content: "prior" })
    const current = source({ id: "src_current_scope", messageID: "msg_current", ordinal: 4, content: "current" })
    const view = {
      sources: new Map([
        [prior.id, prior],
        [current.id, current],
      ]),
      transcript: messages([
        { info: { id: "msg_prior", role: "assistant" }, parts: [] },
        { info: { id: "msg_current", role: "user" }, parts: [] },
      ]),
    }
    const ctx = { extra: { lcmSourceSessionID: "ses_parent" } }

    expect(() => requireIsolatedRecoverySource(ctx, view, prior)).not.toThrow()
    expect(() => requireIsolatedRecoverySource(ctx, view, current)).toThrow(LcmToolError)
    expect(() => requireIsolatedRecoverySummary(ctx, view, { lastOrdinal: prior.ordinal })).not.toThrow()
    expect(() => requireIsolatedRecoverySummary(ctx, view, { lastOrdinal: current.ordinal })).toThrow(LcmToolError)
    expect(sourceChronology({ sources: view.sources, content: new Map() }, prior.id, prior.ordinal)).toMatchObject({
      sourceOrdinal: prior.ordinal,
      nextSource: null,
      nextNonReceiptSource: null,
    })
  })
})
