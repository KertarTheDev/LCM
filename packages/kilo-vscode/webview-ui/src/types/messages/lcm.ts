import type { EventSessionLcmActivity, EventSessionLcmStatus } from "@kilocode/sdk/v2"

export type LcmStatus = EventSessionLcmStatus["properties"]["status"]

export interface LcmStatusMessage {
  type: "lcmStatus"
  sessionID: string
  status?: LcmStatus
}

export interface LcmStatusErrorMessage {
  type: "lcmStatusError"
  sessionID: string
  message: string
}

export type LcmActivity = EventSessionLcmActivity["properties"]["activity"]

export interface LcmActivityMessage {
  type: "lcmActivity"
  sessionID: string
  items: LcmActivity[]
}

export type LcmRequest =
  | { type: "requestLcmStatus"; sessionID: string }
  | { type: "showLcmTimeline"; sessionID: string }
  | { type: "exportLcmContext"; sessionID: string }
