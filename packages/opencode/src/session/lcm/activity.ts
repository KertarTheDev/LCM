// kilocode_change - new file
import type { ConversationID, LcmActivityItem, LcmActivityPage, LcmUsageRecord, SessionID } from "./types"

export interface LcmActivityQueryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

interface UsageRow {
  usage_record_id: string
  source_session_id: string
  conversation_id: string
  job_id: string | null
  purpose: LcmUsageRecord["purpose"]
  mode: LcmUsageRecord["mode"]
  provider_id: string | null
  model_id: string | null
  input_tokens: number | string | null
  output_tokens: number | string | null
  cache_read_tokens: number | string | null
  cache_write_tokens: number | string | null
  cost_amount: number | string | null
  cost_currency: string | null
  cost_status: LcmUsageRecord["costStatus"]
  summary_target_tokens: number | string | null
  summary_generation_max_output_tokens: number | string | null
  maintenance_input_budget: number | string | null
  summary_source_tokens: number | string | null
  candidate_summary_tokens: number | string | null
  accepted_summary_tokens: number | string | null
  summary_objective_status: LcmUsageRecord["summaryObjectiveStatus"] | null
  summary_fallback_mode: LcmUsageRecord["summaryFallbackMode"] | null
  summary_reasoning_policy: LcmUsageRecord["summaryReasoningPolicy"] | null
  summary_retry_attempt: number | string | null
  maintenance_status: LcmUsageRecord["maintenanceStatus"] | null
  maintenance_safe_code: LcmUsageRecord["maintenanceSafeCode"] | null
  maintenance_diagnostic_code: string | null
  maintenance_safe_message: string | null
  created_at_ms: number | string | bigint
}

function number(value: number | string | bigint | null) {
  return value === null ? undefined : Number(value)
}

function item(row: UsageRow): LcmActivityItem {
  const inputTokens = number(row.input_tokens)
  const outputTokens = number(row.output_tokens)
  const cacheReadTokens = number(row.cache_read_tokens)
  const cacheWriteTokens = number(row.cache_write_tokens)
  return {
    usageRecordID: row.usage_record_id,
    sessionID: row.source_session_id as SessionID,
    conversationID: row.conversation_id as ConversationID,
    ...(row.job_id ? { jobID: row.job_id as LcmUsageRecord["jobID"] } : {}),
    purpose: row.purpose,
    mode: row.mode,
    ...(row.provider_id ? { providerID: row.provider_id } : {}),
    ...(row.model_id ? { modelID: row.model_id } : {}),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(number(row.summary_target_tokens) === undefined
      ? {}
      : { summaryTargetTokens: number(row.summary_target_tokens)! }),
    ...(number(row.summary_generation_max_output_tokens) === undefined
      ? {}
      : { summaryGenerationMaxOutputTokens: number(row.summary_generation_max_output_tokens)! }),
    ...(number(row.maintenance_input_budget) === undefined
      ? {}
      : { maintenanceInputBudget: number(row.maintenance_input_budget)! }),
    ...(number(row.summary_source_tokens) === undefined
      ? {}
      : { summarySourceTokens: number(row.summary_source_tokens)! }),
    ...(number(row.candidate_summary_tokens) === undefined
      ? {}
      : { candidateSummaryTokens: number(row.candidate_summary_tokens)! }),
    ...(number(row.accepted_summary_tokens) === undefined
      ? {}
      : { acceptedSummaryTokens: number(row.accepted_summary_tokens)! }),
    ...(row.summary_objective_status ? { summaryObjectiveStatus: row.summary_objective_status } : {}),
    ...(row.summary_fallback_mode ? { summaryFallbackMode: row.summary_fallback_mode } : {}),
    ...(row.summary_reasoning_policy ? { summaryReasoningPolicy: row.summary_reasoning_policy } : {}),
    ...(number(row.summary_retry_attempt) === undefined
      ? {}
      : { summaryRetryAttempt: number(row.summary_retry_attempt)! }),
    ...(row.maintenance_status ? { maintenanceStatus: row.maintenance_status } : {}),
    ...(row.maintenance_safe_code ? { maintenanceSafeCode: row.maintenance_safe_code } : {}),
    ...(row.maintenance_diagnostic_code ? { maintenanceDiagnosticCode: row.maintenance_diagnostic_code } : {}),
    ...(row.maintenance_safe_message ? { maintenanceSafeMessage: row.maintenance_safe_message } : {}),
    ...(number(row.cost_amount) === undefined ? {} : { costAmount: number(row.cost_amount)! }),
    ...(row.cost_currency ? { costCurrency: row.cost_currency } : {}),
    costStatus: row.cost_status,
    // AI SDK inputTokens includes cached input. Cache values remain useful as a
    // billing breakdown, but adding them again would overstate paid activity.
    totalTokens: (inputTokens ?? (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)) + (outputTokens ?? 0),
    createdAt: new Date(Number(row.created_at_ms)).toISOString(),
  }
}

export async function readLcmActivity(input: {
  db: LcmActivityQueryable
  conversationID: ConversationID
  limit?: number
}): Promise<LcmActivityPage> {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)))
  const rows = await input.db.query<UsageRow>(
    `
      SELECT *
      FROM lcm_usage_records
      WHERE conversation_id = $1
      ORDER BY created_at_ms DESC, usage_record_id DESC
      LIMIT $2
    `,
    [input.conversationID, limit],
  )
  const items = rows.rows.map(item)
  const requests = items.filter(
    (record) =>
      record.providerID !== undefined ||
      record.modelID !== undefined ||
      record.inputTokens !== undefined ||
      record.outputTokens !== undefined ||
      record.costStatus === "provider_reported",
  )
  const costRecords = requests.filter(
    (record) =>
      record.costStatus === "provider_reported" && record.costAmount !== undefined && record.costCurrency !== undefined,
  )
  const currencies = new Set(costRecords.map((record) => record.costCurrency!))
  const costAmount = costRecords.reduce((total, record) => total + record.costAmount!, 0)
  const statuses = new Set(requests.map((record) => record.costStatus))
  const costStatus =
    currencies.size > 1
      ? "mixed"
      : statuses.size === 0
        ? "not_applicable"
        : statuses.size === 1
          ? [...statuses][0]!
          : "mixed"
  return {
    conversationID: input.conversationID,
    items,
    summary: {
      requestCount: requests.length,
      inputTokens: items.reduce((total, record) => total + (record.inputTokens ?? 0), 0),
      outputTokens: items.reduce((total, record) => total + (record.outputTokens ?? 0), 0),
      cacheReadTokens: items.reduce((total, record) => total + (record.cacheReadTokens ?? 0), 0),
      cacheWriteTokens: items.reduce((total, record) => total + (record.cacheWriteTokens ?? 0), 0),
      totalTokens: items.reduce((total, record) => total + record.totalTokens, 0),
      ...(currencies.size === 1 ? { costAmount, costCurrency: [...currencies][0]! } : {}),
      costStatus,
    },
  }
}
