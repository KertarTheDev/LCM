// kilocode_change - bounded fail-closed provider-overflow recovery for LCM-managed prompts
import { expect, test } from "bun:test"
import { resolveLcmProviderOverflowResult } from "../../src/session/prompt"

test("active LCM performs one bounded provider-overflow rebuild", () => {
  expect(
    resolveLcmProviderOverflowResult({
      lifecycleState: "lcm_active",
      retryAttempt: 0,
      conversationID: "conv_provider_overflow",
    }),
  ).toEqual({
    action: "retry",
    nextAttempt: 1,
    providerOverflowRecovery: { attempt: 1 },
  })
})

test("active LCM fails closed after its one provider-overflow rebuild", () => {
  const result = resolveLcmProviderOverflowResult({
    lifecycleState: "lcm_active",
    retryAttempt: 1,
    conversationID: "conv_provider_overflow",
    threshold: { activeTokens: 120_000, hardLimit: 100_000 },
  })

  expect(result.action).toBe("fail")
  if (result.action !== "fail") throw new Error("expected fail-closed provider overflow")
  expect(result.safeError).toMatchObject({
    code: "hard_limit_unresolved",
    retryable: false,
    diagnosticCode: "lcm_prompt_provider_overflow_after_lcm_retry_exhausted",
    safeParams: {
      conversationID: "conv_provider_overflow",
      beforeTokens: 120_000,
      hardLimit: 100_000,
      action: "start_new_thread",
    },
  })
})

test("non-active LCM never falls back to provider-overflow retry", () => {
  const result = resolveLcmProviderOverflowResult({
    lifecycleState: "passive_synced",
    retryAttempt: 0,
  })

  expect(result.action).toBe("fail")
  if (result.action !== "fail") throw new Error("expected fail-closed inactive provider overflow")
  expect(result.safeError.diagnosticCode).toBe("lcm_prompt_provider_overflow_without_active_lcm_rejected")
})
