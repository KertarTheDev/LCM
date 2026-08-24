import { createEffect, createSignal, type Accessor } from "solid-js"
import type { ExtensionMessage, LcmActivity, LcmStatus } from "../types/messages"

export type LcmContextValue = {
  lcmActivity: Accessor<LcmActivity[]>
  lcmStatus: Accessor<LcmStatus | undefined>
  lcmStatusError: Accessor<string | undefined>
}

export function createLcmState(input: {
  config: () => { experimental?: { conversation_memory?: boolean } }
  sessionID: () => string | undefined
  connected: () => boolean
  requestStatus: (sessionID: string) => void
}) {
  const [activity, setActivity] = createSignal<LcmActivity[]>([])
  const [status, setStatus] = createSignal<LcmStatus | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const enabled = () => input.config().experimental?.conversation_memory !== false
  const route = (message: ExtensionMessage) =>
    routeLcmMessage({
      message,
      enabled: enabled(),
      activeSessionID: input.sessionID(),
      requestStatus: input.requestStatus,
      setStatus,
      setError,
      setActivity,
    })

  createEffect(() => {
    const sessionID = input.sessionID()
    const connected = input.connected()
    const active = enabled()
    setStatus(undefined)
    setError(undefined)
    setActivity([])
    if (active && sessionID && !sessionID.startsWith("cloud:") && connected) input.requestStatus(sessionID)
  })

  const context: LcmContextValue = { lcmActivity: activity, lcmStatus: status, lcmStatusError: error }
  return { activity, status, error, enabled, route, context }
}

export function updateLcmStatus(input: {
  activeSessionID?: string
  messageSessionID: string
  current?: LcmStatus
  next?: LcmStatus
}) {
  if (input.messageSessionID !== input.activeSessionID || !input.next) return input.current
  if (input.current && input.next.sequence <= input.current.sequence) return input.current
  return input.next
}

export function updateLcmActivity(input: {
  activeSessionID?: string
  messageSessionID: string
  current: LcmActivity[]
  next: LcmActivity[]
}) {
  if (input.messageSessionID !== input.activeSessionID) return input.current
  return [...new Map([...input.current, ...input.next].map((item) => [item.id, item])).values()].toSorted(
    (a, b) => a.sequence - b.sequence,
  )
}

export function routeLcmMessage(input: {
  message: ExtensionMessage
  enabled: boolean
  activeSessionID?: string
  requestStatus: (sessionID: string) => void
  setStatus: (update: (current?: LcmStatus) => LcmStatus | undefined) => void
  setError: (message?: string) => void
  setActivity: (update: (current: LcmActivity[]) => LcmActivity[]) => void
}) {
  if (!input.enabled) return
  const message = input.message
  if (message.type === "sessionStatus") {
    if (message.status === "idle" && message.sessionID === input.activeSessionID) input.requestStatus(message.sessionID)
    return
  }
  if (message.type === "lcmStatus") {
    input.setError(undefined)
    input.setStatus((current) =>
      updateLcmStatus({
        activeSessionID: input.activeSessionID,
        messageSessionID: message.sessionID,
        current,
        next: message.status,
      }),
    )
    return
  }
  if (message.type === "lcmStatusError") {
    if (message.sessionID === input.activeSessionID) input.setError(message.message)
    return
  }
  if (message.type !== "lcmActivity") return
  input.setActivity((current) =>
    updateLcmActivity({
      activeSessionID: input.activeSessionID,
      messageSessionID: message.sessionID,
      current,
      next: message.items,
    }),
  )
}
