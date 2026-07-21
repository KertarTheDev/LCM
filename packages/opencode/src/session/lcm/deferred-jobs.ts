// kilocode_change - new file
import type { PGlite } from "@electric-sql/pglite"
import { sha256Hex } from "./hash"
import type {
  ConversationID,
  LcmProtectedCurrentUserInput,
  LcmRenderOptions,
  LcmSafeError,
  LcmSoftMaintenanceAfterTurnInput,
} from "./types"

export const LCM_DEFERRED_SOFT_MAINTENANCE_JOB_KIND = "soft_maintenance"

export type LcmDeferredJobTerminalStatus = "completed" | "failed" | "canceled"

export interface LcmDeferredSoftMaintenanceJob {
  readonly conversationID: ConversationID
  readonly sessionID: string
  readonly providerID: string
  readonly modelID: string
  readonly renderOptions: LcmRenderOptions
  readonly protectedCurrentUser?: LcmProtectedCurrentUserInput
  readonly attemptCount: number
  readonly nextRunAtMs: number
}

interface LcmDeferredSoftMaintenancePayloadV1 {
  readonly version: 1
  readonly input: {
    readonly sessionID: string
    readonly providerID: string
    readonly modelID: string
    readonly renderOptions: LcmRenderOptions
    readonly protectedCurrentUser?: LcmProtectedCurrentUserInput
  }
}

interface DeferredSoftMaintenanceRow {
  readonly conversation_id: string
  readonly source_session_id: string
  readonly provider_id: string | null
  readonly model_id: string | null
  readonly payload_json: unknown
  readonly attempt_count: number
  readonly next_run_at_ms: number
}

function stableHash(input: string) {
  return sha256Hex(input).slice(0, 32)
}

export function lcmDeferredSoftMaintenanceJobID(conversationID: ConversationID) {
  return `job_soft_${stableHash(conversationID)}`
}

function serializePayload(input: LcmSoftMaintenanceAfterTurnInput): string {
  return JSON.stringify({
    version: 1,
    input: {
      sessionID: input.sessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      renderOptions: input.renderOptions,
      ...(input.protectedCurrentUser ? { protectedCurrentUser: input.protectedCurrentUser } : {}),
    },
  } satisfies LcmDeferredSoftMaintenancePayloadV1)
}

function parseProtectedCurrentUser(value: unknown): LcmProtectedCurrentUserInput | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null) return undefined
  const input = value as Partial<LcmProtectedCurrentUserInput>
  if (typeof input.sourceSessionID !== "string") return undefined
  if (typeof input.sourceMessageID !== "string") return undefined
  if (input.messageRowID !== undefined && typeof input.messageRowID !== "string") return undefined
  return {
    sourceSessionID: input.sourceSessionID,
    sourceMessageID: input.sourceMessageID,
    ...(input.messageRowID ? { messageRowID: input.messageRowID } : {}),
  }
}

function parsePayload(value: unknown): LcmDeferredSoftMaintenancePayloadV1 | undefined {
  let parsed: unknown
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const payload = parsed as Partial<LcmDeferredSoftMaintenancePayloadV1>
  if (payload.version !== 1) return undefined
  if (typeof payload.input !== "object" || payload.input === null) return undefined
  const input = payload.input as Partial<LcmDeferredSoftMaintenancePayloadV1["input"]>
  if (typeof input.sessionID !== "string") return undefined
  if (typeof input.providerID !== "string") return undefined
  if (typeof input.modelID !== "string") return undefined
  if (typeof input.renderOptions !== "object" || input.renderOptions === null) return undefined
  const protectedCurrentUser = parseProtectedCurrentUser(input.protectedCurrentUser)
  if (input.protectedCurrentUser !== undefined && !protectedCurrentUser) return undefined
  if (protectedCurrentUser) {
    return {
      version: 1,
      input: {
        sessionID: input.sessionID,
        providerID: input.providerID,
        modelID: input.modelID,
        renderOptions: input.renderOptions,
        protectedCurrentUser,
      },
    }
  }
  return payload as LcmDeferredSoftMaintenancePayloadV1
}

function rowToJob(row: DeferredSoftMaintenanceRow): LcmDeferredSoftMaintenanceJob | undefined {
  const payload = parsePayload(row.payload_json)
  if (!payload) return undefined
  return {
    conversationID: row.conversation_id as ConversationID,
    sessionID: payload.input.sessionID,
    providerID: payload.input.providerID,
    modelID: payload.input.modelID,
    renderOptions: payload.input.renderOptions,
    ...(payload.input.protectedCurrentUser ? { protectedCurrentUser: payload.input.protectedCurrentUser } : {}),
    attemptCount: Math.max(0, Number(row.attempt_count) || 0),
    nextRunAtMs: Math.max(0, Number(row.next_run_at_ms) || 0),
  }
}

export async function upsertDeferredSoftMaintenanceJob(input: {
  readonly db: PGlite
  readonly conversationID: ConversationID
  readonly retryInput: LcmSoftMaintenanceAfterTurnInput
  readonly attemptCount: number
  readonly nextRunAtMs: number
  readonly safeError?: LcmSafeError
  readonly safeMessage?: string
  readonly nowMs?: number
}) {
  const nowMs = input.nowMs ?? Date.now()
  await input.db.query(
    `
      INSERT INTO lcm_deferred_jobs (
        job_id,
        job_kind,
        conversation_id,
        source_session_id,
        provider_id,
        model_id,
        payload_json,
        status,
        attempt_count,
        next_run_at_ms,
        last_safe_code,
        last_diagnostic_code,
        last_safe_message,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, 'soft_maintenance', $2, $3, $4, $5, $6::jsonb, 'queued', $7, $8, $9, $10, $11, $12, $12)
      ON CONFLICT (job_id) DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        source_session_id = EXCLUDED.source_session_id,
        provider_id = EXCLUDED.provider_id,
        model_id = EXCLUDED.model_id,
        payload_json = EXCLUDED.payload_json,
        status = 'queued',
        attempt_count = EXCLUDED.attempt_count,
        next_run_at_ms = EXCLUDED.next_run_at_ms,
        last_safe_code = EXCLUDED.last_safe_code,
        last_diagnostic_code = EXCLUDED.last_diagnostic_code,
        last_safe_message = EXCLUDED.last_safe_message,
        updated_at_ms = EXCLUDED.updated_at_ms,
        completed_at_ms = NULL
    `,
    [
      lcmDeferredSoftMaintenanceJobID(input.conversationID),
      input.conversationID,
      input.retryInput.sessionID,
      input.retryInput.providerID,
      input.retryInput.modelID,
      serializePayload(input.retryInput),
      Math.max(0, Math.floor(input.attemptCount)),
      Math.max(0, Math.floor(input.nextRunAtMs)),
      input.safeError?.code ?? null,
      input.safeError?.diagnosticCode ?? null,
      input.safeMessage ?? input.safeError?.safeMessage ?? null,
      nowMs,
    ],
  )
}

export async function readDeferredSoftMaintenanceJobs(input: {
  readonly db: PGlite
  readonly sessionID: string
  readonly limit?: number
}) {
  const rows = (
    await input.db.query<DeferredSoftMaintenanceRow>(
      `
        SELECT conversation_id, source_session_id, provider_id, model_id,
               payload_json, attempt_count, next_run_at_ms
        FROM lcm_deferred_jobs
        WHERE job_kind = 'soft_maintenance'
          AND source_session_id = $1
          AND status = 'queued'
        ORDER BY next_run_at_ms, updated_at_ms
        LIMIT $2
      `,
      [input.sessionID, Math.max(1, Math.floor(input.limit ?? 16))],
    )
  ).rows
  return rows.flatMap((row) => {
    const job = rowToJob(row)
    return job ? [job] : []
  })
}

export async function finishDeferredSoftMaintenanceJob(input: {
  readonly db: PGlite
  readonly conversationID: ConversationID
  readonly status: LcmDeferredJobTerminalStatus
  readonly safeError?: LcmSafeError
  readonly safeMessage?: string
  readonly nowMs?: number
}) {
  const nowMs = input.nowMs ?? Date.now()
  await input.db.query(
    `
      UPDATE lcm_deferred_jobs
      SET status = $2,
          last_safe_code = $3,
          last_diagnostic_code = $4,
          last_safe_message = $5,
          updated_at_ms = $6,
          completed_at_ms = $6
      WHERE job_id = $1
        AND job_kind = 'soft_maintenance'
    `,
    [
      lcmDeferredSoftMaintenanceJobID(input.conversationID),
      input.status,
      input.safeError?.code ?? null,
      input.safeError?.diagnosticCode ?? null,
      input.safeMessage ?? input.safeError?.safeMessage ?? null,
      nowMs,
    ],
  )
}

export async function cancelQueuedDeferredSoftMaintenanceJob(input: {
  readonly db: PGlite
  readonly conversationID: ConversationID
  readonly safeMessage?: string
  readonly nowMs?: number
}) {
  const nowMs = input.nowMs ?? Date.now()
  const result = await input.db.query<{ job_id: string }>(
    `
      UPDATE lcm_deferred_jobs
      SET status = 'canceled',
          last_safe_code = 'canceled',
          last_diagnostic_code = 'lcm_deferred_soft_maintenance_user_canceled',
          last_safe_message = $2,
          updated_at_ms = $3,
          completed_at_ms = $3
      WHERE job_id = $1
        AND job_kind = 'soft_maintenance'
        AND status = 'queued'
      RETURNING job_id
    `,
    [
      lcmDeferredSoftMaintenanceJobID(input.conversationID),
      input.safeMessage ?? "Queued memory maintenance retry was canceled.",
      nowMs,
    ],
  )
  return result.rows.length > 0
}
