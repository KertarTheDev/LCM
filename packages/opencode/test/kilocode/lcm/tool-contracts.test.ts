import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor } from "@/kilocode/session/lcm/cursor"
import { regexSearch, regexSearchIssue, regexWorkerTarget } from "@/kilocode/session/lcm/regex-search"
import { LCM_RECOVERY_INITIAL_LEDGER_CHARS } from "@/kilocode/session/lcm/recovery-contract"
import {
  canonicalRecoveryToolInput,
  completedToolCallHistory,
  completedToolCallCount,
  currentTurnRecoveryCallCount,
  priorTurnSourceCutoff,
  recoveryCallGuidance,
  repeatedRecoveryResult,
  reserveRecoveryBatchCall,
  sourceChronology,
} from "@/kilocode/tool/lcm-common"
import {
  grepRangeLimit,
  grepCursorQuery,
  grepTotalsComplete,
  grepValueOrder,
  LcmGrepParameters,
  literalPatternAdvice,
  literalRanges,
  lastOccurrencePageOffset,
  lexicalSearchAdvice,
  occurrencePaginationAdvice,
  occurrenceTotals,
  regexErrorMessage,
  regexToolError,
  utf8Ranges,
  utf8SearchWindow,
} from "@/kilocode/tool/lcm-grep"
import { expandCursorQuery } from "@/kilocode/tool/lcm-expand"
import {
  readContinuation,
  readCursorQuery,
  resolveTextReadOffset,
  textChunk,
  validUtf8Offset,
} from "@/kilocode/tool/lcm-read"
import {
  completeQueryAnswer,
  extractiveQueryFallback,
  honestQueryCoverage,
  isolatedQueryPrefetchBudget,
  parseQueryAnswer,
  prefetchedIsolatedQueryEvidence,
  queryCandidateLimit,
  queryExcerpt,
  queryExcerptBudget,
  queryFallbackGuidance,
  queryDirection,
  queryParts,
  querySuccessGuidance,
  resolveSourceRanges,
  resolveSourceOrdinalSpan,
  resolveSourceSpan,
  selectQueryExcerpts,
  structuralRecoveryScope,
} from "@/kilocode/tool/lcm-expand-query"
import type { FinalSource, SummaryNode } from "@/kilocode/session/lcm/types"
import { Schema } from "effect"

describe("LCM tool contracts", () => {
  test("keeps global grep as discovery and reserves wider occurrence pages for exact source scopes", () => {
    expect(grepRangeLimit(false)).toBe(1)
    expect(grepRangeLimit(true)).toBe(20)
  })

  test("preserves caller order for multiple ranges within one source ordinal", () => {
    const values = Array.from({ length: 12 }, (_, sortIndex) => ({
      id: `range:${sortIndex}:src_a`,
      ordinal: 4,
      sortIndex,
    }))
    expect(values.toSorted(grepValueOrder).map((value) => value.sortIndex)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    )
  })

  test("makes regex intent and overlapping result totals explicit", () => {
    expect(literalPatternAdvice("alpha|beta", "literal")).toContain("Set mode to regex")
    expect(literalPatternAdvice("\\[START\\]", "literal")).toContain("search for [START]")
    expect(literalPatternAdvice("alpha|beta", "regex")).toBeUndefined()
    expect(occurrencePaginationAdvice(true, [21])).toContain("refine the pattern")
    expect(lastOccurrencePageOffset(21)).toBe(1)
    expect(lastOccurrencePageOffset(40)).toBe(20)
    expect(occurrencePaginationAdvice(true, [20])).toBeUndefined()
    expect(occurrencePaginationAdvice(false, [100])).toBeUndefined()
    expect(
      occurrenceTotals(
        [
          { id: "src_a", matchCount: 3 },
          { id: "sum_b", matchCount: 2 },
        ],
        new Map<string, "source" | "summary">([
          ["src_a", "source"],
          ["sum_b", "summary"],
        ]),
      ),
    ).toEqual({ sourceRecords: 1, summaryRecords: 1, sourceOccurrences: 3, summaryOccurrences: 2 })
    expect(grepTotalsComplete("literal", false)).toBe(true)
    expect(grepTotalsComplete("regex", false)).toBe(false)
    expect(grepTotalsComplete("regex", true)).toBe(true)
    expect(lexicalSearchAdvice(0)).toContain("paraphrases")
    expect(lexicalSearchAdvice(2)).toContain("not semantic conclusions")
  })

  test("bounds unscoped recovery before the current user turn", () => {
    const view = {
      sources: new Map([
        ["src_old_user", { messageID: "msg_old_user", ordinal: 0 }],
        ["src_old_assistant", { messageID: "msg_old_assistant", ordinal: 1 }],
        ["src_question", { messageID: "msg_question", ordinal: 2 }],
        ["src_current_reasoning", { messageID: "msg_current_assistant", ordinal: 3 }],
      ]),
    }
    const messages = [
      { info: { id: "msg_old_user", role: "user" } },
      { info: { id: "msg_old_assistant", role: "assistant" } },
      { info: { id: "msg_question", role: "user" } },
      { info: { id: "msg_current_assistant", role: "assistant" } },
    ]

    expect(priorTurnSourceCutoff(view, messages)).toBe(1)
    expect(priorTurnSourceCutoff(view, [])).toBeUndefined()
  })

  test("identifies semantically identical completed recovery calls and retains compact prior facts", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool",
            tool: "lcm_grep",
            state: {
              status: "completed",
              input: { pattern: "needle", sourceID: "src_a" },
              metadata: { lcmResult: { kind: "grep", matchedRecords: 2 } },
            },
          },
          {
            type: "tool",
            tool: "lcm_grep",
            state: { status: "running", input: { pattern: "needle", sourceID: "src_a" } },
          },
        ],
      },
    ]
    expect(
      completedToolCallHistory(messages, "lcm_grep", {
        sourceID: "src_a",
        pattern: "needle",
        mode: "literal",
        caseSensitive: false,
        startOffset: 0,
        occurrenceOffset: 0,
        limit: 20,
      }),
    ).toEqual({ count: 1, priorResult: { kind: "grep", matchedRecords: 2 } })
    expect(completedToolCallCount(messages, "lcm_grep", { sourceID: "src_a", pattern: "needle" })).toBe(1)
    expect(completedToolCallCount(messages, "lcm_grep", { sourceID: "src_b", pattern: "needle" })).toBe(0)
    expect(canonicalRecoveryToolInput("lcm_read", { sourceID: "src_a" })).toEqual({
      maxBytes: 8192,
      offset: 0,
      sourceID: "src_a",
    })
    expect(canonicalRecoveryToolInput("lcm_read", { sourceID: "src_a", cursor: "next" })).toEqual({
      cursor: "next",
      maxBytes: 8192,
      sourceID: "src_a",
    })
    expect(
      recoveryCallGuidance({
        tool: "lcm_grep",
        previousIdenticalCalls: 3,
        sourceScoped: true,
        completedRecoveryCalls: 5,
      }).instruction,
    ).toContain("do not resubmit it")
    expect(
      recoveryCallGuidance({
        tool: "lcm_grep",
        previousIdenticalCalls: 0,
        sourceScoped: true,
        completedRecoveryCalls: 5,
      }).instruction,
    ).toContain("one focused lcm_expand_query")
    expect(repeatedRecoveryResult({ tool: "lcm_grep", previousIdenticalCalls: 0, sourceScoped: true })).toBeUndefined()
    expect(repeatedRecoveryResult({ tool: "lcm_grep", previousIdenticalCalls: 1, sourceScoped: true })).toMatchObject({
      callGuidance: { previousIdenticalCalls: 1 },
      repeatedCall: { suppressed: true, noNewEvidence: true },
    })
    expect(
      repeatedRecoveryResult({
        tool: "lcm_grep",
        previousIdenticalCalls: 1,
        sourceScoped: true,
        priorResult: { matchedRecords: 2 },
      }),
    ).toMatchObject({ priorResult: { matchedRecords: 2 } })
  })

  test("counts exact recovery calls only after the current user turn", () => {
    const completed = (tool: string) => ({
      type: "tool",
      tool,
      state: { status: "completed", input: {} },
    })
    const messages = [
      { info: { role: "assistant" }, parts: [completed("lcm_grep")] },
      { info: { role: "user" }, parts: [] },
      { info: { role: "assistant" }, parts: [completed("lcm_read"), completed("lcm_expand_query")] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "lcm_grep", state: { status: "running", input: {} } }],
      },
      { info: { role: "assistant" }, parts: [completed("lcm_grep")] },
    ]
    expect(currentTurnRecoveryCallCount(messages)).toBe(2)
  })

  test("suppresses canonical duplicate recovery calls within one assistant batch", () => {
    const batch: readonly unknown[] = []
    expect(reserveRecoveryBatchCall(batch, "lcm_grep", { pattern: "needle", sourceID: "src_a" })).toEqual({
      batchCallNumber: 1,
      previousIdenticalCalls: 0,
    })
    expect(
      reserveRecoveryBatchCall(batch, "lcm_grep", {
        pattern: "needle",
        sourceID: "src_a",
        mode: "literal",
        caseSensitive: false,
        startOffset: 0,
        occurrenceOffset: 0,
        limit: 20,
      }),
    ).toEqual({ batchCallNumber: 2, previousIdenticalCalls: 1 })
    expect(reserveRecoveryBatchCall(batch, "lcm_read", { sourceID: "src_a" })).toEqual({
      batchCallNumber: 3,
      previousIdenticalCalls: 0,
    })
    expect(reserveRecoveryBatchCall([], "lcm_grep", { pattern: "needle", sourceID: "src_a" })).toEqual({
      batchCallNumber: 1,
      previousIdenticalCalls: 0,
    })
  })

  test("reports chronological transport neighbors while skipping pure receipt records", () => {
    const source = (id: string, ordinal: number, kind: FinalSource["kind"]): FinalSource => ({
      id,
      sessionID: "ses_tools",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind,
      digest: `digest_${ordinal}`,
      tokens: 1,
      bytes: 1,
      excerpt: id,
    })
    const first = source("src_first", 0, "user_text")
    const receipt = source("src_receipt", 1, "assistant_text")
    const next = source("src_next", 2, "user_text")
    const view = {
      sources: new Map([first, receipt, next].map((item) => [item.id, item])),
      content: new Map([
        [first.id, { content: "opening fragment" }],
        [receipt.id, { content: "RECEIVED" }],
        [next.id, { content: "continuation fragment" }],
      ]),
    }

    expect(sourceChronology(view, first.id)).toEqual({
      sourceOrdinal: 0,
      previousSource: null,
      nextSource: { sourceID: receipt.id, ordinal: 1, kind: "assistant_text" },
      previousNonReceiptSource: null,
      nextNonReceiptSource: { sourceID: next.id, ordinal: 2, kind: "user_text" },
    })
  })

  test("extracts stable handles and useful terms for bounded recovery queries", () => {
    expect(queryParts("What did src_alpha decide about the release branch and release tag?")).toEqual({
      handles: ["src_alpha"],
      terms: ["decide", "release", "branch", "tag"],
    })
  })

  test("accepts only structured query answers with selected citations", () => {
    const allowed = new Set(["src_alpha", "sum_beta"])
    expect(
      parseQueryAnswer(
        '```json\n{"answer":"Use the release branch.","citations":["src_alpha"],"coverage":"full"}\n```',
        allowed,
      ),
    ).toEqual({
      answer: "Use the release branch.",
      citations: ["src_alpha"],
      coverage: "full",
    })
    expect(
      parseQueryAnswer('{"answer":"Invented","citations":["src_other"],"coverage":"full"}', allowed),
    ).toBeUndefined()
    expect(parseQueryAnswer('{"answer":"","citations":[],"coverage":"none"}', allowed)).toBeUndefined()
    expect(
      parseQueryAnswer('{"answer":"Unsupported","citations":["src_alpha"],"coverage":"none"}', allowed),
    ).toBeUndefined()
    expect(
      completeQueryAnswer(
        '{"answer":"Use the release branch.","citations":["src_alpha"],"coverage":"full"}',
        "length",
        allowed,
      ),
    ).toBeUndefined()
    expect(honestQueryCoverage({ answer: "Candidate", citations: ["src_alpha"], coverage: "full" }, true)).toEqual({
      answer: "Candidate",
      citations: ["src_alpha"],
      coverage: "partial",
    })
    expect(honestQueryCoverage({ answer: "Complete", citations: ["src_alpha"], coverage: "full" }, false)).toEqual({
      answer: "Complete",
      citations: ["src_alpha"],
      coverage: "full",
    })
  })

  test("uses spare model input to preserve an explicitly bounded semantic unit", () => {
    expect(queryCandidateLimit(1_000)).toBe(8)
    expect(queryCandidateLimit(4_000)).toBe(16)
    expect(queryCandidateLimit(16_000)).toBe(32)
    expect(queryExcerptBudget(123_904, false)).toBe(16_000)
    expect(queryExcerptBudget(123_904, true)).toBe(61_952)
    expect(queryExcerptBudget(1_000_000, true)).toBe(64_000)
    expect(queryExcerptBudget(0, true)).toBe(4_000)
    expect(isolatedQueryPrefetchBudget(95_904)).toBe(31_968)
    expect(isolatedQueryPrefetchBudget(1_000_000)).toBe(32_000)
    expect(isolatedQueryPrefetchBudget(0)).toBe(4_000)

    const firstText = "early episode evidence ".repeat(5_000)
    const receiptText = "RECEIVED"
    const lastText = "late episode evidence ".repeat(4_000)
    const bytes = Buffer.byteLength(firstText) + Buffer.byteLength(receiptText) + Buffer.byteLength(lastText)
    const retrieval = selectQueryExcerpts(
      {
        sources: new Map(),
        summaries: new Map(),
        children: new Map(),
        content: new Map(),
      },
      "count every event in the episode",
      undefined,
      queryExcerptBudget(123_904, true),
      undefined,
      [
        {
          sourceID: "src_0123456789abcdef01234567",
          sourceKind: "user_text",
          ordinal: 4,
          startOffset: 0,
          endOffset: Buffer.byteLength(firstText),
          totalBytes: Buffer.byteLength(firstText),
          text: firstText,
        },
        {
          sourceID: "src_0123456789abcdef01234568",
          sourceKind: "assistant_text",
          ordinal: 5,
          startOffset: 0,
          endOffset: Buffer.byteLength(receiptText),
          totalBytes: Buffer.byteLength(receiptText),
          text: receiptText,
        },
        {
          sourceID: "src_0123456789abcdef01234569",
          sourceKind: "tool",
          ordinal: 6,
          startOffset: 0,
          endOffset: Buffer.byteLength(lastText),
          totalBytes: Buffer.byteLength(lastText),
          text: lastText,
        },
      ],
    )
    expect(bytes).toBeGreaterThan(188_000)
    expect(retrieval.selected.map((item) => item.text)).toEqual([firstText, receiptText, lastText])
    expect(retrieval.truncated).toBe(false)
  })

  test("retries one exact semantic query after a transient provider failure", () => {
    expect(queryFallbackGuidance("provider_error")).toMatchObject({
      generatedAnswerAccepted: false,
      retrySameQueryOnce: true,
    })
    expect(queryFallbackGuidance("provider_error").instruction).toContain("Retry this exact lcm_expand_query once")
    expect(queryFallbackGuidance("invalid_response")).not.toHaveProperty("retrySameQueryOnce")
  })

  test("stops open-ended recovery after complete or partial semantic synthesis", () => {
    expect(querySuccessGuidance(true)).toMatchObject({
      generatedAnswerAccepted: true,
      completeCoverage: true,
    })
    expect(querySuccessGuidance(true).instruction).toContain("answer now")
    expect(querySuccessGuidance(true).instruction).toContain(
      "at most one bounded sourceRanges grep or targeted lcm_read",
    )
    expect(querySuccessGuidance(true).instruction).toContain("do not scan cited sources page by page")
    expect(querySuccessGuidance(true).instruction).toContain("not parent citation intervals")
    expect(querySuccessGuidance(true).instruction).toContain("at most 512 UTF-8 bytes")

    expect(querySuccessGuidance(false)).toMatchObject({
      generatedAnswerAccepted: true,
      completeCoverage: false,
    })
    expect(querySuccessGuidance(false).instruction).toContain("at most one bounded sourceRanges grep or targeted read")
    expect(querySuccessGuidance(false).instruction).toContain("do not scan cited sources page by page")
    expect(querySuccessGuidance(false).instruction).toContain("not parent citation intervals")
  })

  test("centers bounded recovery excerpts on early and late matches", () => {
    const text = `early needle ${"unrelated ".repeat(200)}middle needle ${"unrelated ".repeat(200)}late needle`
    const excerpt = queryExcerpt(text, ["needle"], 500)
    expect(excerpt).toContain("early needle")
    expect(excerpt).toContain("middle needle")
    expect(excerpt).toContain("late needle")
    expect(excerpt).toContain("omitted")
    expect(excerpt.length).toBeLessThanOrEqual(500)
  })

  test("retains a locally decisive multi-term region alongside chronological coverage", () => {
    const text = [
      `early action ${"background action ".repeat(80)}`,
      `middle action ${"background action ".repeat(80)}`,
      "rareentity performed decisive operation",
      `${"background action ".repeat(80)} late action`,
    ].join("\n")
    const excerpt = queryExcerpt(text, ["action", "rareentity", "performed", "operation"], 600)
    expect(excerpt).toContain("early action")
    expect(excerpt).toContain("rareentity performed decisive operation")
    expect(excerpt).toContain("late action")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("reserves late matching evidence for last/latest questions", () => {
    const text = [
      ...Array.from({ length: 120 }, (_, index) => `operator cast decoy-${index} during the episode`),
      `${"closing context ".repeat(80)} operator cast decisive-latest-action`,
      `${"credits without a matching term ".repeat(120)}`,
    ].join("\n")
    const question = "What was the last action the operator cast in the episode?"
    const { terms } = queryParts(question)
    const excerpt = queryExcerpt(text, terms, 600, "last")

    expect(terms).not.toContain("last")
    expect(excerpt).toContain("decisive-latest-action")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("reserves early matching evidence for first/earliest questions", () => {
    const text = [
      `${"opening context ".repeat(80)} operator cast decisive-earliest-action`,
      ...Array.from({ length: 120 }, (_, index) => `operator cast decoy-${index} during the episode`),
      `${"closing context ".repeat(120)}`,
    ].join("\n")
    const question = "What was the first action the operator cast in the episode?"
    const { terms } = queryParts(question)
    const excerpt = queryExcerpt(text, terms, 600, "first")

    expect(terms).not.toContain("first")
    expect(excerpt).toContain("decisive-earliest-action")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("reserves both edge directions when a question asks for first and last", () => {
    const text = [
      `operator cast decisive-first-action ${"opening context ".repeat(100)}`,
      ...Array.from({ length: 200 }, (_, index) => `operator cast decoy-${index} during the episode`),
      `${"closing context ".repeat(100)} operator cast decisive-last-action`,
    ].join("\n")
    const question = "What were the first and last actions the operator cast?"
    const { terms } = queryParts(question)
    const direction = queryDirection(question)
    const excerpt = queryExcerpt(text, terms, 1_200, direction)

    expect(direction).toBe("both")
    expect(excerpt).toContain("decisive-first-action")
    expect(excerpt).toContain("decisive-last-action")
    expect(excerpt.length).toBeLessThanOrEqual(1_200)
  })

  test("samples chronology when no query term matches a paraphrased region", () => {
    const text = `${"opening material ".repeat(100)}paraphrased decisive evidence${"closing material ".repeat(100)}`
    const excerpt = queryExcerpt(text, ["absentwording"], 600)
    expect(excerpt).toContain("opening material")
    expect(excerpt).toContain("paraphrased decisive evidence")
    expect(excerpt).toContain("closing material")
    expect(excerpt.length).toBeLessThanOrEqual(600)
  })

  test("uses the full bounded excerpt across diverse matching passages", () => {
    const text = Array.from({ length: 180 }, (_, index) => {
      if (index === 83) return `alpha beta retained-decisive-passage ${"local context ".repeat(8)}`
      if (index < 50) return `alpha beta gamma decoy-${index} ${"dense context ".repeat(8)}`
      return `alpha routine-${index} ${"background context ".repeat(8)}`
    }).join("\n")

    const excerpt = queryExcerpt(text, ["alpha", "beta", "gamma"], 8_000)
    const larger = queryExcerpt(text, ["alpha", "beta", "gamma"], 16_000)

    expect(excerpt).toContain("retained-decisive-passage")
    expect(larger).toContain("retained-decisive-passage")
    expect(excerpt.length).toBe(8_000)
    expect(larger.length).toBe(16_000)
  })

  test("falls back to a fair active-frontier sample when no record has lexical overlap", () => {
    const sources = Array.from(
      { length: 10 },
      (_, ordinal): FinalSource => ({
        id: `src_${String(ordinal).padStart(24, "0")}`,
        sessionID: "ses_semantic_fallback",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 10,
        bytes: 40,
        excerpt: `historical material ${ordinal}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(
        sources.map((source) => [source.id, { metadata: source, content: `historical material ${source.ordinal}` }]),
      ),
      revision: {
        id: "rev_semantic_fallback",
        sessionID: "ses_semantic_fallback",
        lineageDigest: "lineage_semantic_fallback",
        reason: "append" as const,
        items: sources.map((source) => ({
          kind: "source" as const,
          id: source.id,
          ordinal: source.ordinal,
        })),
        createdAt: 1,
      },
    }
    const retrieval = selectQueryExcerpts(view, "unmatched vocabulary question", undefined, 1_000)
    expect(retrieval.selected).toHaveLength(8)
    expect(retrieval.selected.map((item) => item.id)).toContain(sources[0]!.id)
    expect(retrieval.selected.map((item) => item.id)).toContain(sources[9]!.id)
    expect(retrieval.relevant).toBe(10)
    expect(retrieval.candidateLimitReached).toBe(true)
  })

  test("covers the active frontier before overlapping lexical descendants when the private budget permits", () => {
    const sources = Array.from(
      { length: 40 },
      (_, ordinal): FinalSource => ({
        id: `src_${String(ordinal).padStart(24, "0")}`,
        sessionID: "ses_frontier_first",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 500,
        bytes: 2_000,
        excerpt: ordinal < 16 ? `active semantic unit ${ordinal}` : `needle decision descendant ${ordinal}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_frontier_first",
        sessionID: "ses_frontier_first",
        lineageDigest: "lineage_frontier_first",
        reason: "append" as const,
        items: sources.slice(0, 16).map((source) => ({
          kind: "source" as const,
          id: source.id,
          ordinal: source.ordinal,
        })),
        createdAt: 1,
      },
    }
    const retrieval = selectQueryExcerpts(view, "find every needle decision", undefined, 16_000)

    expect(retrieval.selected).toHaveLength(32)
    expect(retrieval.selected.slice(0, 16).map((item) => item.id)).toEqual(
      sources.slice(0, 16).map((source) => source.id),
    )
    expect(retrieval.selected.slice(16).every((item) => item.text.includes("needle decision"))).toBe(true)
    expect(retrieval.candidateLimitReached).toBe(true)

    const prefetched = prefetchedIsolatedQueryEvidence({
      view,
      query: "find every needle decision",
      usableInputTokens: 95_904,
      maxOrdinal: sources.at(-1)!.ordinal,
    })
    expect(prefetched).toMatchObject({
      selected: 32,
      relevant: 40,
      truncated: true,
      citations: 32,
    })
    expect(prefetched.evidenceChars).toBeLessThanOrEqual(isolatedQueryPrefetchBudget(95_904) * 4)
    expect(prefetched.candidateLedger.length).toBeLessThanOrEqual(LCM_RECOVERY_INITIAL_LEDGER_CHARS)
    expect(prefetched.candidateLedger).toContain("needle decision")
    expect(prefetched.output).toContain("research_evidence")
  })

  test("reports omitted historical candidates even when the relevant subset fits", () => {
    const sources = Array.from(
      { length: 34 },
      (_, ordinal): FinalSource => ({
        id: `src_candidate_truth_${String(ordinal).padStart(12, "0")}`,
        sessionID: "ses_candidate_truth",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 20,
        bytes: 80,
        excerpt: ordinal >= 18 && ordinal < 25 ? `needle decision ${ordinal}` : `historical material ${ordinal}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_candidate_truth",
        sessionID: "ses_candidate_truth",
        lineageDigest: "lineage_candidate_truth",
        reason: "append" as const,
        items: sources.slice(0, 18).map((source) => ({
          kind: "source" as const,
          id: source.id,
          ordinal: source.ordinal,
        })),
        createdAt: 1,
      },
    }

    const retrieval = selectQueryExcerpts(view, "find needle decision", undefined, 16_000)

    expect(retrieval.selected).toHaveLength(32)
    expect(retrieval.relevant).toBe(25)
    expect(retrieval.candidateLimitReached).toBe(true)
    expect(retrieval.truncated).toBe(true)
  })

  test("balances isolated recovery bytes between the frontier and lexical raw descendants", () => {
    const sources = Array.from(
      { length: 9 },
      (_, ordinal): FinalSource => ({
        id: `src_recovery_balance_${String(ordinal).padStart(10, "0")}`,
        sessionID: "ses_recovery_balance",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 2_500,
        bytes: 10_000,
        excerpt:
          ordinal === 0
            ? `active frontier ${"visible context ".repeat(700)}`
            : `needle decision ${ordinal} ${"raw descendant context ".repeat(500)}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_recovery_balance",
        sessionID: "ses_recovery_balance",
        lineageDigest: "lineage_recovery_balance",
        reason: "append" as const,
        items: [{ kind: "source" as const, id: sources[0]!.id, ordinal: 0 }],
        createdAt: 1,
      },
    }

    const frontierFirst = selectQueryExcerpts(view, "find needle decision", undefined, 4_000)
    const balanced = selectQueryExcerpts(
      view,
      "find needle decision with broader disambiguation",
      undefined,
      4_000,
      undefined,
      undefined,
      "balanced_recovery",
      "find needle decision",
    )

    expect(frontierFirst.completeThroughPriority).toBe(1)
    expect(balanced.completeThroughPriority).toBeUndefined()
    expect(frontierFirst.selected[0]!.text).toBe(sources[0]!.excerpt)
    expect(balanced.selected[0]!.text.length).toBeLessThan(sources[0]!.excerpt.length)
    expect(balanced.selected[1]!.text.length).toBeGreaterThan(frontierFirst.selected[1]!.text.length)
    expect(balanced.terms).toContain("needle")
    expect(balanced.terms).not.toContain("disambiguation")
  })

  test("spends spare unscoped evidence bytes on the active frontier without starving lexical descendants", () => {
    const frontierText = `frontier-start ${"frontier context ".repeat(350)} frontier-end`
    const sources = Array.from(
      { length: 9 },
      (_, ordinal): FinalSource => ({
        id: `src_priority_${String(ordinal).padStart(15, "0")}`,
        sessionID: "ses_frontier_byte_priority",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 1_000,
        bytes: 4_000,
        excerpt:
          ordinal === 0
            ? frontierText
            : `needle decision ${ordinal} ${"descendant context ".repeat(220)} descendant-end`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_frontier_byte_priority",
        sessionID: "ses_frontier_byte_priority",
        lineageDigest: "lineage_frontier_byte_priority",
        reason: "append" as const,
        items: [{ kind: "source" as const, id: sources[0]!.id, ordinal: 0 }],
        createdAt: 1,
      },
    }

    const retrieval = selectQueryExcerpts(view, "find every needle decision", undefined, 4_000)

    expect(retrieval.selected).toHaveLength(9)
    expect(retrieval.selected[0]).toMatchObject({ id: sources[0]!.id, text: frontierText })
    expect(retrieval.selected.slice(1).every((item) => item.text.includes("needle decision"))).toBe(true)
    expect(retrieval.candidateLimitReached).toBe(false)
    expect(retrieval.truncated).toBe(true)
  })

  test("preserves a complete fitting active frontier before sampling overlapping descendants", () => {
    const frontierTexts = [
      `frontier-a-start ${"alpha context ".repeat(520)} frontier-a-decisive-middle ${"alpha tail ".repeat(50)} frontier-a-end`,
      `frontier-b-start ${"beta context ".repeat(520)} frontier-b-decisive-middle ${"beta tail ".repeat(50)} frontier-b-end`,
    ]
    const sources = Array.from(
      { length: 16 },
      (_, ordinal): FinalSource => ({
        id: `src_fitting_frontier_${String(ordinal).padStart(5, "0")}`,
        sessionID: "ses_fitting_frontier",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 2_000,
        bytes: 8_000,
        excerpt: frontierTexts[ordinal] ?? `needle decision ${ordinal} ${"overlapping descendant ".repeat(120)}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_fitting_frontier",
        sessionID: "ses_fitting_frontier",
        lineageDigest: "lineage_fitting_frontier",
        reason: "append" as const,
        items: sources.slice(0, 2).map((source) => ({
          kind: "source" as const,
          id: source.id,
          ordinal: source.ordinal,
        })),
        createdAt: 1,
      },
    }

    expect(frontierTexts.reduce((total, text) => total + text.length, 0)).toBeLessThan(4_000 * 4)
    const retrieval = selectQueryExcerpts(view, "find every needle decision", undefined, 4_000)

    expect(retrieval.selected).toHaveLength(16)
    expect(retrieval.selected.slice(0, 2).map((item) => item.text)).toEqual(frontierTexts)
    expect(retrieval.selected.slice(2).every((item) => item.text.includes("needle decision"))).toBe(true)
    expect(retrieval.truncated).toBe(true)

    const serialized = extractiveQueryFallback(retrieval.selected, retrieval.terms, 4_000 * 4, 1)
    expect(serialized.answer).toContain(`[${sources[0]!.id} | user_text] ${frontierTexts[0]}`)
    expect(serialized.answer).toContain(`[${sources[1]!.id} | user_text] ${frontierTexts[1]}`)
  })

  test("uses spare isolated input for a wider initial evidence pass without widening later tool results", () => {
    const sources = Array.from(
      { length: 16 },
      (_, ordinal): FinalSource => ({
        id: `src_prefetch_${String(ordinal).padStart(16, "0")}`,
        sessionID: "ses_wide_prefetch",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 2_000,
        bytes: 8_000,
        excerpt: `needle ${"context ".repeat(990)}detail-${ordinal}`,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source) => [source.id, { metadata: source, content: source.excerpt }])),
      revision: {
        id: "rev_wide_prefetch",
        sessionID: "ses_wide_prefetch",
        lineageDigest: "lineage_wide_prefetch",
        reason: "append" as const,
        items: sources.map((source) => ({ kind: "source" as const, id: source.id, ordinal: source.ordinal })),
        createdAt: 1,
      },
    }
    const prefetched = prefetchedIsolatedQueryEvidence({
      view,
      query: "find needle details",
      usableInputTokens: 95_904,
      maxOrdinal: sources.at(-1)!.ordinal,
    })

    expect(prefetched.evidenceChars).toBeGreaterThan(16_000 * 4)
    expect(prefetched.evidenceChars).toBeLessThanOrEqual(isolatedQueryPrefetchBudget(95_904) * 4)
  })

  test("gives isolated boundary recovery an exact raw scope instead of a misleading summary", () => {
    const texts = [
      "outside-before\n[BEGIN ORBIT WINDOW]\nperformed cobalt setup\n",
      "performed cobalt seal as the final action\n",
      "[END ORBIT WINDOW]\noutside-poison-one\n",
      "outside-between\n[BEGIN ORBIT WINDOW]\nperformed amber setup\n",
      "performed amber seal as the final action\n",
      "[END ORBIT WINDOW]\noutside-poison-two\n",
    ]
    const sources = texts.map(
      (text, ordinal): FinalSource => ({
        id: `src_structural_${String(ordinal).padStart(12, "0")}`,
        sessionID: "ses_structural_recovery",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: Math.ceil(Buffer.byteLength(text) / 4),
        bytes: Buffer.byteLength(text),
        excerpt: text,
      }),
    )
    const misleading = {
      id: "sum_structural_misleading",
      nodeKey: "node_structural_misleading",
      sessionID: "ses_structural_recovery",
      level: 0,
      text: "Orbit one ended with MISLEADING IVORY and orbit two ended with MISLEADING VIOLET.",
      digest: "digest_summary",
      sourceDigest: "digest_sources",
      tokens: 20,
      bytes: 84,
      firstOrdinal: 0,
      lastOrdinal: 5,
      generationMode: "normal",
      createdAt: 1,
    } satisfies SummaryNode
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map([[misleading.id, misleading]]),
      children: new Map(),
      content: new Map(sources.map((source, index) => [source.id, { metadata: source, content: texts[index]! }])),
      revision: {
        id: "rev_structural_recovery",
        sessionID: "ses_structural_recovery",
        lineageDigest: "lineage_structural_recovery",
        reason: "append" as const,
        items: [{ kind: "summary" as const, id: misleading.id, ordinal: 0 }],
        createdAt: 2,
      },
    }
    const question = "Which action was last performed in each orbit window, respecting its BEGIN and END boundaries?"
    const scope = structuralRecoveryScope(view, question, sources.at(-1)!.ordinal)
    expect(scope?.sourceRanges?.map((range) => range.ordinal)).toEqual([0, 1, 2, 3, 4, 5])
    expect(scope?.index).toMatchObject({ matchedUnits: 2, representedUnits: 2, truncated: false })

    const first = structuralRecoveryScope(
      view,
      "In the first [BEGIN ORBIT WINDOW]...[END ORBIT WINDOW] unit, what action was last?",
      sources.at(-1)!.ordinal,
    )
    expect(first?.sourceRanges?.map((range) => range.ordinal)).toEqual([0, 1, 2])
    expect(first?.index).toMatchObject({ matchedUnits: 1, representedUnits: 1, truncated: false })
    expect(first?.index.units[0]?.index).toBe(1)

    const last = structuralRecoveryScope(
      view,
      "In the last [BEGIN ORBIT WINDOW]...[END ORBIT WINDOW] unit, what action was last?",
      sources.at(-1)!.ordinal,
    )
    expect(last?.sourceRanges?.map((range) => range.ordinal)).toEqual([3, 4, 5])
    expect(last?.index).toMatchObject({ matchedUnits: 1, representedUnits: 1, truncated: false })
    expect(last?.index.units[0]?.index).toBe(2)

    const prefetched = prefetchedIsolatedQueryEvidence({
      view,
      query: question,
      focusedQuery: question,
      usableInputTokens: 95_904,
      maxOrdinal: sources.at(-1)!.ordinal,
    })
    expect(prefetched).toMatchObject({ selected: 6, relevant: 6, truncated: false })
    expect(prefetched.output).toContain('"hostStructuralScope"')
    expect(prefetched.output).toContain('"exactEnvelope"')
    expect(prefetched.output).toContain('"sourceOrdinalSpan"')
    expect(prefetched.output).toContain("[BEGIN ORBIT WINDOW]")
    expect(prefetched.output).toContain("[END ORBIT WINDOW]")
    expect(prefetched.output).toContain("| bytes ")
    expect(prefetched.output).toContain("cobalt seal")
    expect(prefetched.output).toContain("amber seal")
    expect(prefetched.output).not.toContain("MISLEADING")
    expect(prefetched.output).not.toContain("outside-poison")
    expect(prefetched.candidateLedger).toContain('"authority"')
    expect(prefetched.candidateLedger).toContain("cobalt seal")
    expect(prefetched.candidateLedger).toContain("amber seal")
    expect(prefetched.candidateLedger.length).toBeLessThanOrEqual(LCM_RECOVERY_INITIAL_LEDGER_CHARS)
    expect(prefetched.evidenceChars).toBeLessThanOrEqual(isolatedQueryPrefetchBudget(95_904) * 4)
  })

  test("matches the named structural label without admitting a different bounded unit", () => {
    const texts = [
      "[START RED WINDOW]\nred action\n",
      "[END RED WINDOW]\n",
      "[START BLUE WINDOW]\nblue action\n",
      "[END BLUE WINDOW]\n",
    ]
    const sources = texts.map(
      (text, ordinal): FinalSource => ({
        id: `src_label_scope_${String(ordinal).padStart(12, "0")}`,
        sessionID: "ses_label_scope",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 8,
        bytes: Buffer.byteLength(text),
        excerpt: text,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source, index) => [source.id, { metadata: source, content: texts[index]! }])),
    }
    const scope = structuralRecoveryScope(view, "What was the last action inside the blue window?", 3)
    expect(scope?.sourceRanges?.map((range) => range.ordinal)).toEqual([2, 3])
    expect(JSON.stringify(scope?.index)).toContain("BLUE WINDOW")
    expect(JSON.stringify(scope?.index)).not.toContain("RED WINDOW")
  })

  test("reports a matched structural map as incomplete when its exact union exceeds 32 ranges", () => {
    const texts = Array.from({ length: 17 }, (_, index) => [
      `[START ARCHIVE PART]\npart ${index} opening\n`,
      `part ${index} closing\n[END ARCHIVE PART]\n`,
    ]).flat()
    const sources = texts.map(
      (text, ordinal): FinalSource => ({
        id: `src_wide_scope_${String(ordinal).padStart(12, "0")}`,
        sessionID: "ses_wide_scope",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 8,
        bytes: Buffer.byteLength(text),
        excerpt: text,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source, index) => [source.id, { metadata: source, content: texts[index]! }])),
    }
    const question = "List the final action in each archive part using its START and END boundaries."
    const scope = structuralRecoveryScope(view, question, sources.at(-1)!.ordinal)
    expect(scope?.index).toMatchObject({ matchedUnits: 17, representedUnits: 17, exactEnvelope: null })
    expect(scope?.sourceRanges).toBeUndefined()

    const prefetched = prefetchedIsolatedQueryEvidence({
      view,
      query: question,
      focusedQuery: question,
      usableInputTokens: 95_904,
      maxOrdinal: sources.at(-1)!.ordinal,
    })
    expect(prefetched.truncated).toBe(true)
    expect(prefetched.output).toContain("combined scope exceeds")
    expect(prefetched.output).toContain("mixed evidence is incomplete")
    expect(prefetched.candidateLedger.length).toBeLessThanOrEqual(LCM_RECOVERY_INITIAL_LEDGER_CHARS)
  })

  test("bounds a many-unit structural map inside a small-context prefetch budget", () => {
    const texts = Array.from({ length: 32 }, (_, index) => `[BEGIN SMALL WINDOW]\nitem ${index}\n[END SMALL WINDOW]\n`)
    const sources = texts.map(
      (text, ordinal): FinalSource => ({
        id: `src_small_scope_${String(ordinal).padStart(12, "0")}`,
        sessionID: "ses_small_scope",
        messageID: `msg_${ordinal}`,
        partID: `part_${ordinal}`,
        ordinal,
        kind: "user_text",
        digest: `digest_${ordinal}`,
        tokens: 12,
        bytes: Buffer.byteLength(text),
        excerpt: text,
      }),
    )
    const view = {
      sources: new Map(sources.map((source) => [source.id, source])),
      summaries: new Map(),
      children: new Map(),
      content: new Map(sources.map((source, index) => [source.id, { metadata: source, content: texts[index]! }])),
    }
    const usableInputTokens = 4_096
    const prefetched = prefetchedIsolatedQueryEvidence({
      view,
      query: "List the item inside each small window using its BEGIN and END boundaries.",
      usableInputTokens,
      maxOrdinal: sources.at(-1)!.ordinal,
    })
    const output = JSON.parse(prefetched.output.split("\n\n").slice(1).join("\n\n")) as {
      hostStructuralScope: { matchedUnits: number; representedUnits: number; truncated: boolean }
    }
    expect(output.hostStructuralScope.matchedUnits).toBe(32)
    expect(output.hostStructuralScope.representedUnits).toBeLessThan(32)
    expect(output.hostStructuralScope.truncated).toBe(true)
    expect(prefetched.evidenceChars).toBeLessThanOrEqual(isolatedQueryPrefetchBudget(usableInputTokens) * 4)
    expect(prefetched.candidateLedger.length).toBeLessThanOrEqual(LCM_RECOVERY_INITIAL_LEDGER_CHARS)
    expect(prefetched.output).toContain("Resolve the units independently")
    expect(prefetched.output).toContain("contentScope.sourceOrdinalSpan")
  })

  test("resolves ordered non-overlapping UTF-8 source ranges and retrieves only their bytes", () => {
    const makeSource = (id: string, ordinal: number, content: string): FinalSource => ({
      id,
      sessionID: "ses_ranges",
      messageID: `msg_${ordinal}`,
      partID: `part_${ordinal}`,
      ordinal,
      kind: "user_text",
      digest: `digest_${ordinal}`,
      tokens: Math.ceil(Buffer.byteLength(content) / 4),
      bytes: Buffer.byteLength(content),
      excerpt: content,
    })
    const firstText = "outside before\n[START]\ninside first needle\n"
    const middleText = "inside middle needle\n"
    const secondText = "inside second needle\n[END]\noutside after"
    const first = makeSource("src_0123456789abcdef01234567", 4, firstText)
    const middle = makeSource("src_456789abcdef0123456789ab", 5, middleText)
    const second = makeSource("src_89abcdef0123456789abcdef", 6, secondText)
    const view = {
      sources: new Map([
        [first.id, first],
        [middle.id, middle],
        [second.id, second],
      ]),
      summaries: new Map(),
      children: new Map(),
      content: new Map([
        [first.id, { metadata: first, content: firstText }],
        [middle.id, { metadata: middle, content: middleText }],
        [second.id, { metadata: second, content: secondText }],
      ]),
    }
    const startOffset = Buffer.byteLength("outside before\n[START]\n")
    const endOffset = Buffer.byteLength("inside second needle\n")
    const ranges = resolveSourceRanges(view, [
      { sourceID: first.id, startOffset },
      { sourceID: second.id, endOffset },
    ])
    expect(ranges.map((range) => ({ text: range.text, sourceKind: range.sourceKind }))).toEqual([
      { text: "inside first needle\n", sourceKind: "user_text" },
      { text: "inside second needle\n", sourceKind: "user_text" },
    ])
    const retrieval = selectQueryExcerpts(view, "find every needle", undefined, 1_000, undefined, ranges)
    expect(retrieval.selected.map((item) => item.text)).toEqual(["inside first needle\n", "inside second needle\n"])
    expect(retrieval.relevant).toBe(2)
    expect(retrieval.truncated).toBe(false)
    const span = resolveSourceSpan(view, {
      startSourceID: first.id,
      endSourceID: second.id,
      startOffset,
      endOffset,
    })
    expect(span.map((range) => range.text)).toEqual([
      "inside first needle\n",
      "inside middle needle\n",
      "inside second needle\n",
    ])
    expect(
      resolveSourceOrdinalSpan(view, {
        startOrdinal: first.ordinal,
        endOrdinal: second.ordinal,
        startOffset,
        endOffset,
      }).map((range) => range.text),
    ).toEqual(["inside first needle\n", "inside middle needle\n", "inside second needle\n"])
    expect(() => resolveSourceRanges(view, [{ sourceID: second.id }, { sourceID: first.id }])).toThrow(
      "chronological order",
    )
    expect(
      Schema.decodeUnknownSync(LcmGrepParameters)({
        pattern: "needle",
        sourceRanges: [
          { sourceID: first.id, startOffset },
          { sourceID: second.id, endOffset },
        ],
      }).sourceRanges,
    ).toEqual([
      { sourceID: first.id, startOffset },
      { sourceID: second.id, endOffset },
    ])
    expect(
      Schema.decodeUnknownSync(LcmGrepParameters)({
        pattern: "needle",
        sourceSpan: {
          startSourceID: first.id,
          endSourceID: second.id,
          startOffset,
          endOffset,
        },
      }).sourceSpan,
    ).toEqual({ startSourceID: first.id, endSourceID: second.id, startOffset, endOffset })
    expect(
      Schema.decodeUnknownSync(LcmGrepParameters)({
        pattern: "needle",
        sourceOrdinalSpan: {
          startOrdinal: first.ordinal,
          endOrdinal: second.ordinal,
          startOffset,
          endOffset,
        },
      }).sourceOrdinalSpan,
    ).toEqual({ startOrdinal: first.ordinal, endOrdinal: second.ordinal, startOffset, endOffset })
    expect(() => resolveSourceSpan(view, { startSourceID: second.id, endSourceID: first.id })).toThrow(
      "chronological order",
    )
    expect(
      occurrenceTotals(
        [
          { id: `range:0:${first.id}`, matchCount: 2 },
          { id: `range:1:${first.id}`, matchCount: 3 },
        ],
        new Map([
          [`range:0:${first.id}`, "source" as const],
          [`range:1:${first.id}`, "source" as const],
        ]),
        new Map([
          [`range:0:${first.id}`, first.id],
          [`range:1:${first.id}`, first.id],
        ]),
      ),
    ).toEqual({ sourceRecords: 1, summaryRecords: 0, sourceOccurrences: 5, summaryOccurrences: 0 })
  })

  test("keeps extractive query fallback fair across candidate records", () => {
    const fallback = extractiveQueryFallback(
      [
        { id: "src_first", text: `early needle ${"first ".repeat(300)}late needle` },
        { id: "src_second", text: `early needle ${"second ".repeat(300)}late needle` },
        { id: "src_third", text: `early needle ${"third ".repeat(300)}late needle` },
      ],
      ["needle"],
      900,
    )
    expect(fallback.citations).toEqual(["src_first", "src_second", "src_third"])
    expect(fallback.answer).toContain("[src_first]")
    expect(fallback.answer).toContain("[src_second]")
    expect(fallback.answer).toContain("[src_third]")
    expect(fallback.answer.length).toBeLessThanOrEqual(900)
  })

  test("labels extractive query evidence with raw source provenance", () => {
    const fallback = extractiveQueryFallback(
      [
        {
          id: "src_assistant",
          sourceKind: "assistant_text",
          text: "The deployment completed successfully.",
          sourceRange: { ordinal: 7, startOffset: 10, endOffset: 48 },
        },
        { id: "sum_prior", text: "A lossy index of the earlier exchange." },
      ],
      ["deployment"],
      500,
    )
    expect(fallback.answer).toContain("[src_assistant | assistant_text | source ordinal 7 | bytes 10-48]")
    expect(fallback.answer).toContain("[sum_prior]")
  })

  test("binds opaque cursors to semantic queries while allowing page-size changes", () => {
    const query = grepCursorQuery({
      pattern: "needle",
      mode: "literal",
      caseSensitive: false,
      startOffset: 0,
      occurrenceOffset: 0,
    })
    const cursor = encodeCursor(query, 12)
    expect(decodeCursor(query, cursor)).toBe(12)
    expect(() => decodeCursor({ ...query, pattern: "other" }, cursor)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor({ ...query, startOffset: 10 }, cursor)).toThrow("lcm_invalid_cursor")
    const rangedQuery = grepCursorQuery({
      ...query,
      sourceRanges: [{ sourceID: "src_a", startOffset: 10, endOffset: 20 }],
    })
    const rangedCursor = encodeCursor(rangedQuery, 1)
    expect(decodeCursor(rangedQuery, rangedCursor)).toBe(1)
    expect(() =>
      decodeCursor(
        { ...rangedQuery, sourceRanges: [{ sourceID: "src_a", startOffset: 11, endOffset: 20 }] },
        rangedCursor,
      ),
    ).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor.slice(0, -1)}x`)).toThrow("lcm_invalid_cursor")
    expect(() => decodeCursor(query, `${cursor}.extra`)).toThrow("lcm_invalid_cursor")
    const expansion = expandCursorQuery("sum_a")
    expect(decodeCursor(expansion, encodeCursor(expansion, 10))).toBe(10)
  })

  test("binds read cursors to immutable source identity rather than page size", () => {
    const query = readCursorQuery({ id: "src_a", digest: "digest_a" }, 12_000)
    const cursor = encodeCursor(query, 8_192)
    expect(decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_a" }, 12_000), cursor)).toBe(8_192)
    expect(() => decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_a" }, 13_000), cursor)).toThrow(
      "lcm_invalid_cursor",
    )
    expect(() => decodeCursor(readCursorQuery({ id: "src_a", digest: "digest_b" }, 12_000), cursor)).toThrow(
      "lcm_invalid_cursor",
    )
  })

  test("runs bounded regex search in a worker", async () => {
    expect(String(regexWorkerTarget())).toEndWith("/regex-worker.ts")
    const matches = await regexSearch({
      pattern: "alpha|beta",
      caseSensitive: false,
      values: [
        { id: "src_a", text: "Alpha and BETA" },
        { id: "src_b", text: "gamma" },
      ],
      recordLimit: 10,
      rangeLimit: 10,
    })
    expect(matches).toEqual([
      {
        id: "src_a",
        ranges: [
          { start: 0, end: 5 },
          { start: 10, end: 14 },
        ],
        matchCount: 2,
        rangesComplete: true,
      },
    ])
    await expect(
      regexSearch({
        pattern: "(",
        caseSensitive: true,
        values: [{ id: "src_a", text: "text" }],
        recordLimit: 10,
        rangeLimit: 10,
      }),
    ).rejects.toThrow("lcm_invalid_regex")
  })

  test("distinguishes invalid, timed-out, and unavailable regex execution", async () => {
    expect(regexToolError(new Error("lcm_invalid_regex")).message).toContain("syntax is invalid")
    expect(regexToolError(new Error("lcm_regex_timeout")).message).toContain("Do not retry it unchanged")
    expect(regexToolError(new Error("lcm_regex_worker_unavailable")).code).toBe("lcm_unavailable")
    const wrapped = {
      message: "An error occurred in Effect.tryPromise",
      cause: new Error("lcm_regex_pattern_too_long"),
    }
    expect(regexErrorMessage(wrapped)).toBe("lcm_regex_pattern_too_long")
    expect(regexToolError(wrapped).message).toContain("exceeds 512 characters")
    await expect(
      regexSearch(
        {
          pattern: "alpha",
          caseSensitive: false,
          values: [{ id: "src_a", text: "alpha" }],
          recordLimit: 1,
          rangeLimit: 1,
        },
        {
          createWorker: () => {
            throw new Error("worker missing")
          },
        },
      ),
    ).rejects.toThrow("lcm_regex_worker_unavailable")
  })

  test("limits matching records independently from ranges within each record", async () => {
    const matches = await regexSearch({
      pattern: "hit",
      caseSensitive: true,
      values: [
        { id: "src_many", text: "hit hit hit hit" },
        { id: "src_next", text: "hit" },
        { id: "src_later", text: "hit" },
      ],
      recordLimit: 2,
      rangeLimit: 2,
    })
    expect(matches).toEqual([
      {
        id: "src_many",
        ranges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
        matchCount: 4,
        rangesComplete: false,
      },
      { id: "src_next", ranges: [{ start: 0, end: 3 }], matchCount: 1, rangesComplete: true },
    ])
  })

  test("pages exact regex occurrences without losing the total match count", async () => {
    const matches = await regexSearch({
      pattern: "hit",
      caseSensitive: true,
      values: [{ id: "src_many", text: "hit hit hit hit" }],
      recordLimit: 1,
      rangeOffset: 1,
      rangeLimit: 2,
    })
    expect(matches).toEqual([
      {
        id: "src_many",
        ranges: [
          { start: 4, end: 7 },
          { start: 8, end: 11 },
        ],
        matchCount: 4,
        rangesComplete: false,
      },
    ])
  })

  test("pages exact literal occurrences without losing the total match count", () => {
    expect(literalRanges("hit hit hit hit", "hit", true, 1, 2)).toEqual({
      ranges: [
        { start: 4, end: 7 },
        { start: 8, end: 11 },
      ],
      matchCount: 4,
      rangesComplete: false,
    })
  })

  test("advances zero-width regular expressions without hanging", async () => {
    const matches = await regexSearch({
      pattern: "(?=a)",
      caseSensitive: true,
      values: [{ id: "src_a", text: "aaa" }],
      recordLimit: 1,
      rangeLimit: 3,
    })
    expect(matches[0]?.ranges).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ])
    expect(matches[0]?.matchCount).toBe(3)
    expect(matches[0]?.rangesComplete).toBe(true)
  })

  test("cancels regex work with the public cancellation code", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      regexSearch({
        pattern: "detail",
        caseSensitive: false,
        values: [{ id: "src_a", text: "detail" }],
        recordLimit: 10,
        rangeLimit: 10,
        signal: controller.signal,
      }),
    ).rejects.toThrow("lcm_cancelled")
  })

  test("rejects oversized regex input instead of silently skipping sources", async () => {
    expect(regexSearchIssue({ pattern: "x".repeat(513), values: [{ text: "small" }] })).toBe("pattern_too_long")
    await expect(
      regexSearch({
        pattern: "binding",
        caseSensitive: false,
        values: [{ id: "src_large", text: "x".repeat(1_000_001) }],
        recordLimit: 20,
        rangeLimit: 20,
      }),
    ).rejects.toThrow("lcm_regex_record_too_large")
  })

  test("paginates text on valid UTF-8 byte boundaries", () => {
    const value = "abαβcd"
    const first = textChunk(value, 0, 3)
    expect(first.content).toBe("ab")
    expect(first.end).toBe(2)
    const second = textChunk(value, first.end, 4)
    expect(second.content).toBe("αβ")
    expect(second.end).toBe(6)
    expect(second.total).toBe(Buffer.byteLength(value))
    expect(readContinuation(first.end, first.total)).toMatchObject({ complete: false, nextOffset: first.end })
    expect(readContinuation(second.end, second.total)).toMatchObject({ complete: false, nextOffset: second.end })
    const third = textChunk(value, second.end, 4)
    expect(third.content).toBe("cd")
    expect(readContinuation(third.end, third.total)).toEqual({
      complete: true,
      nextOffset: null,
      advice: [
        "This read reached the end of this transport source, not necessarily the end of a document, episode, section, or other semantic unit. nextOffset and nextCursor are null; do not retry this source. If verified boundaries show the unit continues, follow chronology.nextNonReceiptSource at offset 0.",
      ],
    })
    const bounded = textChunk(value, 2, 32, 6)
    expect(bounded.content).toBe("αβ")
    expect(bounded.rangeEnd).toBe(6)
    expect(readContinuation(bounded.end, bounded.total, bounded.rangeEnd)).toEqual({
      complete: true,
      nextOffset: null,
      advice: [
        "This read reached the requested exclusive endOffset. nextOffset and nextCursor are null; do not read beyond that verified interval for the current semantic unit.",
      ],
    })
  })

  test("maps grep character ranges to seekable UTF-8 byte ranges", () => {
    expect(
      utf8Ranges("aé🙂z", [
        { start: 1, end: 2 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 7 },
    ])
    expect(textChunk("aé🙂z", 3, 4).content).toBe("🙂")
    expect(validUtf8Offset("aé🙂z", 3)).toBe(true)
    expect(validUtf8Offset("aé🙂z", 2)).toBe(false)
    expect(resolveTextReadOffset("aé", 99)).toEqual({ offset: 3, total: 3, adjusted: true })
    expect(resolveTextReadOffset("aé", 1)).toEqual({ offset: 1, total: 3, adjusted: false })
  })

  test("searches an exact half-open UTF-8 source interval", () => {
    const text = "é before\n[START]\ninside needle\n[END]\nafter needle"
    const start = Buffer.byteLength("é before\n[START]\n")
    const end = Buffer.byteLength("é before\n[START]\ninside needle\n")
    const window = utf8SearchWindow(text, start, end)
    expect(window.text).toBe("inside needle\n")
    expect(window.byteOffset).toBe(start)
    expect(window.endOffset).toBe(end)
    expect(literalRanges(window.text, "needle", true, 0, 20).matchCount).toBe(1)
    expect(() => utf8SearchWindow(text, 1, end)).toThrow("lcm_invalid_search_range")
  })
})
