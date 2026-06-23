// kilocode_change - new file
import { RUNTIME_DEFAULTS } from "./config"
import { createOperationID } from "./id"
import type { ConversationID, LcmMaintenanceResult, LcmThresholdDecision, OperationID } from "./types"

export interface LcmSchedulerState {
  readonly softMaintenanceJobsForConversation?: number
  readonly backgroundJobsInWorkspace?: number
}

export interface LcmSchedulerTrigger {
  readonly trigger: "none" | "soft_background" | "hard_blocking" | "soft_cap_deferred"
  readonly result: LcmMaintenanceResult
}

export function decideMaintenanceTrigger(input: {
  readonly threshold: LcmThresholdDecision
  readonly state?: LcmSchedulerState
  readonly operationID?: OperationID
}): LcmSchedulerTrigger {
  const operationID = input.operationID ?? createOperationID()
  const base = {
    conversationID: input.threshold.conversationID as ConversationID,
    operationID,
    workPerformed: false,
    beforeTokens: input.threshold.activeTokens,
    afterTokens: input.threshold.activeTokens,
    summariesCreated: 0,
    contextItemsReplaced: 0,
    status: "no_op" as const,
  }

  if (input.threshold.overHard) {
    return {
      trigger: "hard_blocking",
      result: {
        ...base,
        workNeeded: true,
        blocking: true,
        reason: "hard_limit",
        safeMessage: "Preparing memory for this response...",
      },
    }
  }

  if (!input.threshold.overSoft) {
    return {
      trigger: "none",
      result: {
        ...base,
        workNeeded: false,
        blocking: false,
        reason: "soft_threshold",
        status: "healthy",
      },
    }
  }

  const softCount = input.state?.softMaintenanceJobsForConversation ?? 0
  const backgroundCount = input.state?.backgroundJobsInWorkspace ?? 0
  const atConversationCap = softCount >= RUNTIME_DEFAULTS.scheduler.maxSoftMaintenanceJobsPerConversation
  const atWorkspaceCap = backgroundCount >= RUNTIME_DEFAULTS.scheduler.maxBackgroundMaintenanceModelJobsPerWorkspace
  if (atConversationCap || atWorkspaceCap) {
    return {
      trigger: "soft_cap_deferred",
      result: {
        ...base,
        workNeeded: true,
        blocking: false,
        reason: "soft_threshold",
        safeMessage: "Memory maintenance is already queued.",
      },
    }
  }

  return {
    trigger: "soft_background",
    result: {
      ...base,
      workNeeded: true,
      blocking: false,
      reason: "soft_threshold",
      safeMessage: "Memory maintenance scheduled.",
    },
  }
}

export * as LcmScheduler from "./scheduler"
