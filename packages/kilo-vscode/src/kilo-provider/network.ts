/**
 * Handles session.network.* SSE events for the VS Code extension.
 *
 * When the CLI backend detects a network failure (timeout, DNS, connection refused, etc.)
 * it pauses the session and emits session.network.asked. A background DNS probe polls for
 * recovery and emits session.network.restored when connectivity returns. The TUI asks the
 * user to press Enter; `kilo run` auto-retries with backoff. This module implements auto-reply
 * for the VS Code extension: once restored, it immediately calls network.reply() so the
 * session resumes without user intervention.
 */

import type { Event, KiloClient } from "@kilocode/sdk/v2/client"

/** Pending network-offline requests: requestID -> { sessionID, refcount }. */
const waits = new Map<string, { sid: string; refs: number }>()

type NetworkEvent = Extract<Event, { type: `session.network.${string}` }>
type GetDir = (sessionID: string) => string

export function isNetworkEvent(event: Event): event is NetworkEvent {
  return event.type.startsWith("session.network.")
}

/** Process a session.network.* event from handleEvent(). */
export function handleNetworkEvent(event: NetworkEvent, client: KiloClient | null, dir: GetDir) {
  switch (event.type) {
    case "session.network.asked": {
      const existing = waits.get(event.properties.id)
      if (existing) existing.refs++
      else waits.set(event.properties.id, { sid: event.properties.sessionID, refs: 1 })
      return
    }
    case "session.network.restored": {
      const entry = waits.get(event.properties.requestID)
      if (!entry) return
      console.log("[Kilo New] network: auto-replying to restore", event.properties.requestID)
      void client?.network.reply({ requestID: event.properties.requestID, directory: dir(entry.sid) })
      waits.delete(event.properties.requestID)
      return
    }
    case "session.network.replied":
    case "session.network.rejected":
      waits.delete(event.properties.requestID)
  }
}

/**
 * Release network waits owned by a disposing provider. Each provider that
 * received the `session.network.asked` event incremented the refcount, so
 * the wait is only removed when the last provider referencing it disposes.
 */
export function clearNetworkWaits(sessions: Set<string>) {
  for (const [rid, entry] of waits) {
    if (!sessions.has(entry.sid)) continue
    if (--entry.refs <= 0) waits.delete(rid)
  }
}
