// kilocode_change - new file
import z from "zod"
import {
  LCM_SAFE_ACTIONS,
  LCM_SAFE_ERROR_CODES,
  LCM_SAFE_MESSAGE_TEMPLATES,
  normalizeLcmSafeError,
  type LcmSafeError,
  type LcmSafeMessageTemplateKey,
} from "./types"

export const LcmSafeActionSchema = z.enum(LCM_SAFE_ACTIONS)
export const LcmSafeErrorCodeSchema = z.enum(LCM_SAFE_ERROR_CODES)
export const LcmSafeMessageTemplateKeySchema = z.enum(
  Object.keys(LCM_SAFE_MESSAGE_TEMPLATES) as [LcmSafeMessageTemplateKey, ...LcmSafeMessageTemplateKey[]],
)
export const LcmSafeParamValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const LcmSafeErrorSchema = z.object({
  code: LcmSafeErrorCodeSchema,
  templateKey: LcmSafeMessageTemplateKeySchema,
  safeParams: z.record(z.string(), LcmSafeParamValueSchema),
  safeMessage: z.string(),
  action: LcmSafeActionSchema.optional(),
  retryable: z.boolean(),
  operationID: z.string().optional(),
  conversationID: z.string().optional(),
  summaryID: z.string().optional(),
  fileID: z.string().optional(),
  diagnosticCode: z.string().optional(),
})

export function parseLcmSafeError(value: unknown): LcmSafeError | undefined {
  const parsed = LcmSafeErrorSchema.safeParse(value)
  // The schema validates the wire shape; ID brands are runtime-owned string subtypes.
  return parsed.success ? normalizeLcmSafeError(parsed.data as LcmSafeError) : undefined
}
