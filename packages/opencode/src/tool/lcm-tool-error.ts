// kilocode_change - new file
import { createLcmSafeError, type LcmToolErrorResult } from "../session/lcm/types"

export function lcmToolWrapperError(diagnosticCode: string): LcmToolErrorResult {
  return {
    ok: false,
    error: createLcmSafeError({
      code: "provider_unavailable",
      templateKey: "lcm.provider.unavailable",
      safeParams: { retryable: true, action: "retry" },
      retryable: true,
      diagnosticCode,
    }),
  }
}
