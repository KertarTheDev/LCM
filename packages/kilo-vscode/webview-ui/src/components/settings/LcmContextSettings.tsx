import type { LcmSettingsState } from "@kilocode/sdk/v2/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { LcmSettingsResultMessage } from "../../types/messages/extension-messages"
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

export function LcmContextSettings() {
  const vscode = useVSCode()
  const [state, setState] = createSignal<LcmSettingsState>()
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [threshold, setThreshold] = createSignal("")

  const receive = (message: unknown) => {
    const candidate = message as { type?: unknown }
    if (candidate.type !== "requestLcmSettings.result" && candidate.type !== "updateLcmSettings.result") return
    const result = message as LcmSettingsResultMessage
    setPending(false)
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
    setPending(true)
    setError(undefined)
    vscode.postMessage({ type: "requestLcmSettings", requestID: requestID() })
  }

  const update = (input: { strategy?: "upward" | "dolt"; storageWarningThresholdBytes?: number }) => {
    setPending(true)
    setError(undefined)
    vscode.postMessage({ type: "updateLcmSettings", requestID: requestID(), ...input })
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
  onMount(load)

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
          title="Runtime status"
          description={
            state()?.lifecycleState
              ? `${state()!.lifecycleState}${state()!.dbStatus ? ` · database ${state()!.dbStatus!.status}` : ""}`
              : "Status becomes session-specific after a conversation is opened."
          }
          last
        >
          <Button variant="secondary" size="small" disabled={pending()} onClick={load}>
            Refresh
          </Button>
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
