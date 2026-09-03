import { describe, expect, test } from "bun:test"
import path from "node:path"

const promptPath = path.resolve(import.meta.dir, "../../../src/session/prompt.ts")
const queryPath = path.resolve(import.meta.dir, "../../../src/kilocode/tool/lcm-query.ts")
const hostPath = path.resolve(import.meta.dir, "../../../src/kilocode/session/lcm/prompt-host.ts")
const servicePath = path.resolve(import.meta.dir, "../../../src/kilocode/session/lcm/service.ts")

describe("LCM prompt seam", () => {
  test("projects only after upstream request assembly and before provider execution", async () => {
    const source = await Bun.file(promptPath).text()
    const converted = source.indexOf("MessageV2.toModelMessagesEffect")
    const finalStep = source.indexOf("content: MAX_STEPS_PROMPT", converted)
    const projected = source.indexOf("ConversationMemoryPromptHost.prepare")
    const processed = source.indexOf("handle.process({", projected)

    expect(converted).toBeGreaterThan(0)
    expect(finalStep).toBeGreaterThan(converted)
    expect(projected).toBeGreaterThan(converted)
    expect(processed).toBeGreaterThan(projected)
    expect(source.slice(processed, processed + 1_200)).toContain("messages: preparedRequest.messages")
    expect(source).toContain("step >= maxSteps && !isLcmRecoveryAgent(agent.name)")
    expect(source).not.toMatch(/\bMAX_STEPS\b/)
  })

  test("records successful consumption before a superseded queued handoff", async () => {
    const source = await Bun.file(promptPath).text()
    const completed = source.indexOf("yield* preparedRequest.complete(true)")
    const handoff = source.indexOf("KiloSessionPromptQueue.hasFollowup", completed)

    expect(completed).toBeGreaterThan(0)
    expect(handoff).toBeGreaterThan(completed)
    expect(source.slice(handoff, handoff + 300)).toContain('closeReasons.set(sessionID, "superseded")')
  })

  test("bounds stale query settlement before the tool-free answer step", async () => {
    const source = await Bun.file(promptPath).text()
    const attempted = source.indexOf("let lcmQuerySettlementAttempted = false")
    const limits = source.indexOf("lcmRecoveryLimits(iterationConfig)")
    const detected = source.indexOf("lcmQueryAnswerOnlyRequired(msgs, recoveryLimits)", limits)
    const fallback = source.indexOf("lcmQuerySettlementFallbackRequired(msgs, recoveryLimits)", detected)
    const toolsWithheld = source.indexOf("lcmQueryAnswerOnly && !lcmQuerySettlementFallback", fallback)
    const settlementTool = source.indexOf("name !== LCM_QUERY_TOOL", toolsWithheld)
    const choice = source.indexOf(": lcmQueryAnswerOnly", settlementTool)
    const completed = source.indexOf("yield* preparedRequest.complete(true)", choice)
    const actualCall = source.indexOf("MessageV2.parts(msg.id)", completed)
    const continued = source.indexOf("if (lcmQuerySettlementToolCalled)", actualCall)
    const stopped = source.indexOf('return "break" as const', continued)

    expect(attempted).toBeGreaterThan(0)
    expect(limits).toBeGreaterThan(attempted)
    expect(detected).toBeGreaterThan(limits)
    expect(fallback).toBeGreaterThan(detected)
    expect(source.slice(detected, fallback)).toContain("!lcmQuerySettlementAttempted")
    expect(toolsWithheld).toBeGreaterThan(fallback)
    expect(settlementTool).toBeGreaterThan(toolsWithheld)
    expect(choice).toBeGreaterThan(toolsWithheld)
    expect(completed).toBeGreaterThan(choice)
    expect(actualCall).toBeGreaterThan(completed)
    expect(continued).toBeGreaterThan(actualCall)
    expect(stopped).toBeGreaterThan(completed)
    expect(source.slice(continued, stopped)).toContain("lcmQuerySettlementAttempted = true")
    expect(source.slice(toolsWithheld, choice)).toContain("LCM_QUERY_ANSWER_ONLY_PROMPT")
  })

  test("keeps hidden recovery phase orchestration out of the shared prompt loop", async () => {
    const source = await Bun.file(promptPath).text()

    expect(source).not.toContain("lcmRecoverySynthesisOnly")
    expect(source).not.toContain("LCM_RECOVERY_SYNTHESIS_PROMPT")
    expect(source).toContain("lcmRecoveryHardStepExceeded(agent.name, step, maxSteps)")
  })

  test("synthesizes in the evidence-bearing child before creating a repair sibling", async () => {
    const source = await Bun.file(queryPath).text()
    const synthesis = source.indexOf("text: recoverySynthesisRequest(question, candidateLedger, fullCoverageReview)")
    const child = source.lastIndexOf("sessionID: child.id", synthesis)
    const locked = source.indexOf("agent: LCM_RECOVERY_FINALIZER_AGENT", synthesis)
    const repair = source.indexOf("const finalizerSessionID = yield* ensureFinalizer", locked)

    expect(synthesis).toBeGreaterThan(0)
    expect(child).toBeGreaterThan(0)
    expect(child).toBeLessThan(synthesis)
    expect(locked).toBeGreaterThan(synthesis)
    expect(repair).toBeGreaterThan(locked)
  })

  test("uses blocking LCM hard maintenance without a legacy compaction fallback", async () => {
    const source = await Bun.file(promptPath).text()
    const host = await Bun.file(hostPath).text()
    const projected = host.indexOf("input.memory.project")
    const hardFailure = host.indexOf("lcm_hard_limit_unresolved", projected)
    const retry = host.indexOf("input.memory.maintain", hardFailure)

    expect(projected).toBeGreaterThan(0)
    expect(hardFailure).toBeGreaterThan(projected)
    expect(retry).toBeGreaterThan(hardFailure)
    expect(host).toContain('projection.type !== "projected"')
    expect(host).not.toContain("compaction.create")
    expect(source).toContain('if (result === "compact")')
    expect(source).toContain("if (conversationMemoryEnabled)")
  })

  test("retains the upstream compact result and verifies the stricter external retry", async () => {
    const source = await Bun.file(promptPath).text()
    const host = await Bun.file(hostPath).text()
    expect(source).toContain('contextManagement: conversationMemoryEnabled ? "external" : "upstream"')
    expect(source).toContain('result === "compact"')
    expect(source).not.toContain('result === "provider_overflow"')
    expect(host).toContain('reason: input.state.overflowRetry ? "hard" : "soft"')
    expect(host).toContain("retryTokens < retry.requestTokens")
    expect(host).toContain("projection.revision.id === retry.revisionID")
  })

  test("keeps routine projection reuse out of activity timeline records", async () => {
    const source = await Bun.file(servicePath).text()
    expect(source).not.toContain("Conversation Memory represented earlier conversation with summaries.")
    expect(source).toContain("Conversation Memory prepared an earlier-history summary.")
    expect(source).toContain('reason: input.reason === "hard" || hard ? "hard_built" : "soft_ready"')
  })

  test("records direct hard-pressure preparation in the activity timeline", async () => {
    const source = await Bun.file(servicePath).text()
    const hard = source.indexOf("if (hard) {")
    const build = source.indexOf("const revision = yield* Effect.promise", hard)
    const activity = source.indexOf("synced.store.appendActivity", build)
    const projected = source.indexOf('projectCurrent("hard")', activity)

    expect(hard).toBeGreaterThan(0)
    expect(build).toBeGreaterThan(hard)
    expect(activity).toBeGreaterThan(build)
    expect(projected).toBeGreaterThan(activity)
    expect(source.slice(activity, projected)).toContain('kind: changed ? "frontier_advanced" : "intervention"')
    expect(source.slice(activity, projected)).toContain("hard-level preparation")
    expect(source.slice(activity, projected)).toContain("events.publish(LcmEvent.Activity")
  })
})
