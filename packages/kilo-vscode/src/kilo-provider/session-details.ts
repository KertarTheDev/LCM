import type { KiloClient, Session, SessionStatus } from "@kilocode/sdk/v2/client"

export function refreshSessionDetails(input: {
  client: KiloClient | null
  sessionID: string
  dir: string
  workspaceDirectory: string
  trackedSessionIds: Set<string>
  signal?: AbortSignal
  prewarm: () => void
  setCurrentSession: (session: Session) => void
  postMessage: (message: unknown) => void
}): void {
  if (!input.client) return
  input.prewarm()
  input.client.session
    .get({ sessionID: input.sessionID, directory: input.dir })
    .then((r) => {
      if (r.data && !input.signal?.aborted) input.setCurrentSession(r.data)
    })
    .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: getSession failed (non-critical):", e))
  input.postMessage({ type: "workspaceDirectoryChanged", directory: input.workspaceDirectory })
  input.client.session
    .status({ directory: input.dir })
    .then((r) => {
      if (!r.data || input.signal?.aborted) return
      for (const [sid, info] of Object.entries(r.data) as [string, SessionStatus][]) {
        if (!input.trackedSessionIds.has(sid)) continue
        input.postMessage({
          type: "sessionStatus",
          sessionID: sid,
          status: info.type,
          ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
        })
      }
    })
    .catch((e: unknown) => console.error("[Kilo New] KiloProvider: Failed to fetch session statuses:", e))
}
