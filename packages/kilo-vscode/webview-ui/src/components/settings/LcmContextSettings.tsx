import type {
  LcmActivityPage,
  LcmDbDiagnoseReport,
  LcmDbRecoverLockReport,
  LcmDbRebuildReport,
  LcmMaintenanceResult,
  LcmMetricsSnapshot,
  LcmPromptExportReport,
  LcmSettingsState,
} from "@kilocode/sdk/v2/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { LcmSettingsResultMessage, LcmSupportResultMessage } from "../../types/messages/extension-messages"
import type {
  LcmSupportRequestMessage,
  RequestLcmSettingsMessage,
  UpdateLcmSettingsMessage,
} from "../../types/messages/webview-messages"
import SettingsRow from "./SettingsRow"

function requestID() {
  return `lcm-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function bytes(value: LcmSettingsState["storageBytes"]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable"
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

const LCM_RESULT_TYPES: ReadonlySet<string> = new Set([
  "requestLcmSettings.result",
  "updateLcmSettings.result",
  "requestLcmStatus.result",
  "requestLcmActivity.result",
  "cancelLcmMaintenance.result",
  "diagnoseLcmDb.result",
  "recoverLcmDbLock.result",
  "rebuildLcmDb.result",
  "exportLcmPrompts.result",
])

export function LcmContextSettings() {
  const vscode = useVSCode()
  const session = useSession()
  const [state, setState] = createSignal<LcmSettingsState>()
  const [pending, setPending] = createSignal(false)
  const [metrics, setMetrics] = createSignal<LcmMetricsSnapshot>()
  const [activity, setActivity] = createSignal<LcmActivityPage>()
  const [supportResult, setSupportResult] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [threshold, setThreshold] = createSignal("")
  const activeRequests = new Map<string, string>()
  let activeSessionID: string | undefined

  const post = (message: RequestLcmSettingsMessage | UpdateLcmSettingsMessage | LcmSupportRequestMessage) => {
    activeRequests.set(message.type, message.requestID)
    setPending(true)
    vscode.postMessage(message)
  }

  const receive = (message: unknown) => {
    const candidate = message as { type?: unknown; requestID?: unknown }
    if (typeof candidate.type !== "string" || !LCM_RESULT_TYPES.has(candidate.type)) return
    const requestType = candidate.type.slice(0, -".result".length)
    if (typeof candidate.requestID !== "string" || activeRequests.get(requestType) !== candidate.requestID) return
    activeRequests.delete(requestType)
    setPending(activeRequests.size > 0)
    if (candidate.type !== "requestLcmSettings.result" && candidate.type !== "updateLcmSettings.result") {
      const result = message as LcmSupportResultMessage
      if (!result.ok) {
        setError(result.error.safeMessage)
        return
      }
      if (result.type === "requestLcmStatus.result") setMetrics(result.body as LcmMetricsSnapshot)
      else if (result.type === "requestLcmActivity.result") setActivity(result.body as LcmActivityPage)
      else if (result.type === "exportLcmPrompts.result") {
        const report = result.body as LcmPromptExportReport
        setSupportResult(
          `Exported ${report.fileCount} files to ${report.exportDir}${report.warnings[0] ? ` · ${report.warnings[0]}` : ""}`,
        )
      } else if (result.type === "diagnoseLcmDb.result") {
        const report = result.body as LcmDbDiagnoseReport
        setSupportResult(
          `Diagnosis ${report.status} · ${report.checks.filter((check) => check.status === "failed").length} failed checks`,
        )
      } else if (result.type === "recoverLcmDbLock.result") {
        setSupportResult(`Lock recovery ${(result.body as LcmDbRecoverLockReport).status}.`)
      } else if (result.type === "rebuildLcmDb.result") {
        setSupportResult(`Database rebuild ${(result.body as LcmDbRebuildReport).status}.`)
      } else {
        setSupportResult(`Maintenance ${(result.body as LcmMaintenanceResult).status}.`)
      }
      setError(undefined)
      return
    }
    const result = message as LcmSettingsResultMessage
    if (result.ok === false) {
      setError(result.error?.safeMessage ?? "LCM settings request failed.")
      return
    }
    if (!result.state) return
    setState(result.state)
    setThreshold(String(result.state.storageWarningThresholdBytes))
    setError(undefined)
  }

  const load = () => {
    const sessionID = session.currentSessionID()
    setError(undefined)
    post({ type: "requestLcmSettings", requestID: requestID(), sessionID })
    if (sessionID) {
      post({ type: "requestLcmStatus", requestID: requestID(), sessionID })
      post({ type: "requestLcmActivity", requestID: requestID(), sessionID, limit: 20 })
    } else {
      setMetrics(undefined)
      setActivity(undefined)
    }
  }

  const support = (
    type: "cancelLcmMaintenance" | "diagnoseLcmDb" | "recoverLcmDbLock" | "rebuildLcmDb" | "exportLcmPrompts",
  ) => {
    const sessionID = session.currentSessionID()
    if (!sessionID) {
      setError("Open a local session before using LCM support actions.")
      return
    }
    setError(undefined)
    setSupportResult(undefined)
    post({
      type,
      requestID: requestID(),
      sessionID,
      ...(type === "recoverLcmDbLock" || type === "rebuildLcmDb" ? { dryRun: true } : {}),
    })
  }

  const update = (input: { strategy?: "upward" | "dolt"; storageWarningThresholdBytes?: number }) => {
    setError(undefined)
    post({
      type: "updateLcmSettings",
      requestID: requestID(),
      sessionID: session.currentSessionID(),
      ...input,
    })
  }

  const saveThreshold = () => {
    const value = Number(threshold().trim())
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError("Storage warning threshold must be a positive integer byte value.")
      return
    }
    update({ storageWarningThresholdBytes: value })
  }

  const unsubscribe = vscode.onMessage(receive)
  onCleanup(unsubscribe)
  createEffect(() => {
    const sessionID = session.currentSessionID()
    if (sessionID !== activeSessionID) {
      activeSessionID = sessionID
      activeRequests.clear()
      setPending(false)
      setMetrics(undefined)
      setActivity(undefined)
      setSupportResult(undefined)
      setError(undefined)
    }
    load()
  })

  return (
    <>
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>LCM conversation context</h4>
      <Card>
        <SettingsRow
          title="Strategy"
          description="LCM maintains the active conversation lineage; project memory remains available separately below."
        >
          <select
            aria-label="LCM strategy"
            value={state()?.strategy ?? "upward"}
            disabled={pending() || !state()}
            onChange={(event) => update({ strategy: event.currentTarget.value as "upward" | "dolt" })}
          >
            <option value="upward">Upward</option>
            <option value="dolt">Dolt</option>
          </select>
        </SettingsRow>
        <SettingsRow
          title="Storage warning threshold"
          description={state() ? `${bytes(state()!.storageBytes)} currently stored` : "Loading LCM storage status…"}
        >
          <div style={{ display: "flex", gap: "6px", "align-items": "center", width: "190px" }}>
            <TextField
              type="number"
              min="1"
              step="1"
              value={threshold()}
              onChange={setThreshold}
              hideLabel
              label="LCM storage warning threshold"
            />
            <Button variant="secondary" size="small" disabled={pending()} onClick={saveThreshold}>
              Save
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          title="Hard / raw / backlog"
          description={
            metrics()
              ? `Hard ${metrics()!.activeTokens.toLocaleString()} / ${metrics()!.hardLimit.toLocaleString()} · raw ${metrics()!.rawLaneTokens.toLocaleString()} · backlog ${metrics()!.softBacklogTokens.toLocaleString()} tokens in ${metrics()!.softBacklogItemCount} items`
              : state()?.lifecycleState
                ? `${state()!.lifecycleState}${state()!.dbStatus ? ` · database ${state()!.dbStatus!.status}` : ""}`
                : "Status becomes session-specific after a conversation is opened."
          }
        >
          <Button variant="secondary" size="small" disabled={pending()} onClick={load}>
            Refresh
          </Button>
        </SettingsRow>
        <SettingsRow
          title="LCM token activity"
          description={
            activity()
              ? `${activity()!.summary.requestCount} paid-token requests · ${activity()!.summary.totalTokens.toLocaleString()} tokens${activity()!.summary.costAmount !== undefined ? ` · ${activity()!.summary.costAmount} ${activity()!.summary.costCurrency ?? ""}` : ` · cost ${activity()!.summary.costStatus}`} across compaction, retrieval, exploration, and maps`
              : "Loading model requests made by conversation memory…"
          }
        >
          <div style={{ "font-size": "var(--kilo-font-size-12)", "text-align": "right" }}>
            <Show when={activity()?.items[0]} fallback="No requests">
              {(item) => `${item().purpose.replaceAll("_", " ")} · ${item().totalTokens.toLocaleString()} tokens`}
            </Show>
          </div>
        </SettingsRow>
        <SettingsRow
          title="Memory support"
          description={
            supportResult() ?? "Diagnose storage, preview recovery, cancel queued work, or export compaction prompts."
          }
          last
        >
          <Show
            when={session.currentSessionID()}
            fallback={<span style={{ "font-size": "var(--kilo-font-size-12)" }}>Open a local session</span>}
          >
            <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "justify-content": "flex-end" }}>
              <Button variant="secondary" size="small" disabled={pending()} onClick={() => support("diagnoseLcmDb")}>
                Diagnose
              </Button>
              <Button variant="secondary" size="small" disabled={pending()} onClick={() => support("recoverLcmDbLock")}>
                Preview lock recovery
              </Button>
              <Button variant="secondary" size="small" disabled={pending()} onClick={() => support("rebuildLcmDb")}>
                Preview rebuild
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={pending()}
                onClick={() => support("cancelLcmMaintenance")}
              >
                Cancel maintenance
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={pending() || state()?.dbStatus?.status !== "ready"}
                onClick={() => support("exportLcmPrompts")}
              >
                Export compaction prompts
              </Button>
            </div>
          </Show>
        </SettingsRow>
        <Show when={error()}>
          {(message) => (
            <div
              style={{
                padding: "8px 12px",
                color: "var(--vscode-errorForeground)",
                "font-size": "var(--kilo-font-size-12)",
              }}
            >
              {message()}
            </div>
          )}
        </Show>
      </Card>
    </>
  )
}
