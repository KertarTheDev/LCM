import type { LcmSafeError } from "@kilocode/sdk/v2/client"
import { z } from "zod"

const lcmSafeErrorCodeSchema = z.enum([
  "db_unavailable",
  "db_locked",
  "db_migration_failed",
  "db_corrupt",
  "settings_unavailable",
  "not_found",
  "unauthorized",
  "invalid_request",
  "over_limit",
  "timeout",
  "canceled",
  "recovery_required",
  "recovery_failed",
  "missing_source",
  "stale_source",
  "permission_denied",
  "provider_unavailable",
  "hard_limit_unresolved",
  "legacy_read_only",
  "provider_capacity_deferred",
])

const lcmSafeMessageTemplates = {
  "lcm.db.unavailable": "Memory storage is not ready. Follow the shown recovery action.",
  "lcm.settings.unavailable": "Memory settings are not ready. Retry or check the project configuration.",
  "lcm.auth.denied": "That memory item is not available from this session.",
  "lcm.request.invalid": "The memory request is outside the supported limits.",
  "lcm.operation.timeout": "The memory operation did not finish.",
  "lcm.operation.canceled": "The memory operation was canceled.",
  "lcm.recovery.missing_source": "Some required source was not saved. Repeat the missing input or action.",
  "lcm.file.stale":
    "The recorded file source is stale or inaccessible. Re-register the current file if you want to use it.",
  "lcm.hard_limit.unresolved":
    "Memory could not be reduced enough for this response. Start a new thread or repeat the needed input.",
  "lcm.provider_capacity.deferred": "Local model capacity is busy. The memory operation will retry later.",
  "lcm.provider.unavailable": "The model provider is not available. Retry after checking the provider connection.",
} as const

const lcmSafeMessageTemplateKeySchema = z.enum(
  Object.keys(lcmSafeMessageTemplates) as [
    keyof typeof lcmSafeMessageTemplates,
    ...(keyof typeof lcmSafeMessageTemplates)[],
  ],
)

const lcmSafeActionSchema = z.enum([
  "retry",
  "repeat_input",
  "start_new_thread",
  "re_register_file",
  "delete_session",
  "close_other_owner",
  "contact_support",
])

const lcmSafeParamValueSchema = z.union([z.string(), z.number(), z.boolean()])

const lcmSafeErrorSchema = z
  .object({
    code: lcmSafeErrorCodeSchema,
    templateKey: lcmSafeMessageTemplateKeySchema,
    safeParams: z.record(lcmSafeParamValueSchema),
    safeMessage: z.string(),
    action: lcmSafeActionSchema.optional(),
    retryable: z.boolean(),
    operationID: z.string().optional(),
    conversationID: z.string().optional(),
    summaryID: z.string().optional(),
    fileID: z.string().optional(),
    diagnosticCode: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.safeMessage === lcmSafeMessageTemplates[value.templateKey]) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["safeMessage"],
      message: "LCM safe error message does not match the canonical template",
    })
  })

export function parseLcmSafeError(value: unknown): LcmSafeError | undefined {
  const parsed = lcmSafeErrorSchema.safeParse(value)
  return parsed.success ? (parsed.data as LcmSafeError) : undefined
}

export function extractLcmSafeError(value: unknown): LcmSafeError | undefined {
  const direct = parseLcmSafeError(value)
  if (direct) return direct
  if (typeof value !== "object" || value === null) return undefined

  const record = value as Record<string, unknown>
  const error = parseLcmSafeError(record.error)
  if (error) return error
  const nestedError = record.error
  if (typeof nestedError === "object" && nestedError !== null) {
    const nested = parseLcmSafeError((nestedError as Record<string, unknown>).error)
    if (nested) return nested
  }

  const data = parseLcmSafeError(record.data)
  if (data) return data
  const nestedData = record.data
  if (typeof nestedData === "object" && nestedData !== null) {
    return parseLcmSafeError((nestedData as Record<string, unknown>).error)
  }
  return undefined
}
