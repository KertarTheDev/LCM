// kilocode_change - new file
import { expect, test } from "bun:test"
import { readLcmActivity } from "../../src/session/lcm/activity"
import type { ConversationID } from "../../src/session/lcm/types"

test("LCM activity exposes paid maintenance and retrieval token usage", async () => {
  const page = await readLcmActivity({
    conversationID: "conv_activity" as ConversationID,
    db: {
      async query() {
        return {
          rows: [
            {
              usage_record_id: "usage_retrieval",
              source_session_id: "ses_activity",
              conversation_id: "conv_activity",
              job_id: null,
              purpose: "retrieval_expand_query",
              mode: "explicit_retrieval",
              provider_id: "zai-coding-plan",
              model_id: "glm-4.5",
              input_tokens: 1200,
              output_tokens: 240,
              cache_read_tokens: 100,
              cache_write_tokens: 0,
              cost_amount: null,
              cost_currency: null,
              cost_status: "unknown",
              summary_target_tokens: null,
              summary_generation_max_output_tokens: null,
              maintenance_input_budget: null,
              summary_source_tokens: null,
              candidate_summary_tokens: null,
              accepted_summary_tokens: null,
              summary_objective_status: null,
              summary_fallback_mode: null,
              summary_reasoning_policy: null,
              summary_retry_attempt: null,
              maintenance_status: null,
              maintenance_safe_code: null,
              maintenance_diagnostic_code: null,
              maintenance_safe_message: null,
              created_at_ms: 1_777_500_000_000,
            },
            {
              usage_record_id: "usage_maintenance",
              source_session_id: "ses_activity",
              conversation_id: "conv_activity",
              job_id: "op_activity",
              purpose: "hard_limit_maintenance",
              mode: "blocking",
              provider_id: null,
              model_id: null,
              input_tokens: null,
              output_tokens: null,
              cache_read_tokens: null,
              cache_write_tokens: null,
              cost_amount: null,
              cost_currency: null,
              cost_status: "not_applicable",
              summary_target_tokens: 1600,
              summary_generation_max_output_tokens: 4096,
              maintenance_input_budget: 40_000,
              summary_source_tokens: 20_000,
              candidate_summary_tokens: null,
              accepted_summary_tokens: null,
              summary_objective_status: null,
              summary_fallback_mode: null,
              summary_reasoning_policy: null,
              summary_retry_attempt: null,
              maintenance_status: "completed",
              maintenance_safe_code: null,
              maintenance_diagnostic_code: null,
              maintenance_safe_message: null,
              created_at_ms: 1_777_499_000_000,
            },
          ],
        } as never
      },
    },
  })

  expect(page.summary).toMatchObject({
    requestCount: 1,
    inputTokens: 1200,
    outputTokens: 240,
    cacheReadTokens: 100,
    totalTokens: 1440,
    costStatus: "unknown",
  })
  expect(page.items[0]).toMatchObject({
    purpose: "retrieval_expand_query",
    providerID: "zai-coding-plan",
    totalTokens: 1440,
  })
  expect(page.items[1]).toMatchObject({
    purpose: "hard_limit_maintenance",
    maintenanceStatus: "completed",
    maintenanceInputBudget: 40_000,
  })
})
