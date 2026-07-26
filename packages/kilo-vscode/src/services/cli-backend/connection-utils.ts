import type { SSEPayload } from "./sdk-sse-adapter"

export type { SSEPayload } from "./sdk-sse-adapter"
type SyncPayload = Extract<SSEPayload, { type: "sync" }>
type TransientPayload = Exclude<SSEPayload, SyncPayload>

/**
 * Pure session ID resolution for SSE events.
 * The lookupMessageSessionId callback remains part of the public resolver contract for
 * transient events that may only carry a message ID, and onMessageUpdated records the
 * messageID -> sessionID mapping from versioned message updates.
 */
export function resolveEventSessionId(
  event: SSEPayload,
  lookupMessageSessionId: (messageId: string) => string | undefined,
  onMessageUpdated?: (messageId: string, sessionId: string) => void,
): string | undefined {
  if (event.type === "sync") {
    return resolveSyncSessionId(event, onMessageUpdated)
  }

  void lookupMessageSessionId
  if (event.type === "sandbox.status.changed") return event.properties.sessionID
  return resolveTransientSessionId(event)
}

function resolveSyncSessionId(
  event: SyncPayload,
  onMessageUpdated?: (messageId: string, sessionId: string) => void,
): string | undefined {
  if (event.name === "message.updated.1") {
    onMessageUpdated?.(event.data.info.id, event.data.sessionID)
  }
  return event.data.sessionID
}

function resolveTransientSessionId(event: TransientPayload): string | undefined {
  // Transient global events simply omit sessionID. Reading the optional field
  // also keeps newly added session-scoped event types routable without growing
  // a duplicate switch alongside the generated SSE union.
  return (event.properties as { sessionID?: string }).sessionID
}
