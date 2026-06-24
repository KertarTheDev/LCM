import type { SendMessageFailedMessage } from "../types/messages"

export interface LcmLockRecoveryState {
  sessionID: string
  safeMessage: string
  detail: string
  status: "available" | "recovering"
}

export function lcmPromptFailureTitle(safeError: SendMessageFailedMessage["safeError"] | undefined): string {
  switch (safeError?.code) {
    case "db_locked":
      return "Memory locked"
    case "db_corrupt":
    case "db_migration_failed":
    case "db_unavailable":
    case "settings_unavailable":
      return "Memory unavailable"
    case "recovery_required":
    case "recovery_failed":
    case "missing_source":
    case "stale_source":
      return "Memory recovery needed"
    case "hard_limit_unresolved":
      return "Memory needs attention"
    case "timeout":
      return "Memory timed out"
    case "provider_unavailable":
    case "provider_capacity_deferred":
      return "Memory provider unavailable"
    default:
      return "Failed to send message"
  }
}

export function lcmPromptFailureDescription(message: SendMessageFailedMessage): string {
  const safeMessage = message.safeError?.safeMessage
  if (!safeMessage) return message.error
  if (message.safeError?.action === "retry") return `${safeMessage} You can retry after memory is ready.`
  if (message.safeError?.action === "close_other_owner")
    return `${safeMessage} If no other Kilo or VS Code window is using this task, use Force unlock.`
  if (message.safeError?.action === "contact_support") return `${safeMessage} Contact support if this persists.`
  if (message.safeError?.action === "start_new_thread")
    return `${safeMessage} Start a new task if you need to continue immediately.`
  return safeMessage
}

export function isLcmOwnerLockFailure(message: SendMessageFailedMessage): boolean {
  const safeError = message.safeError
  return (
    safeError?.code === "db_locked" &&
    (safeError.action === "close_other_owner" || safeError.diagnosticCode?.startsWith("lcm_owner_lock") === true)
  )
}
