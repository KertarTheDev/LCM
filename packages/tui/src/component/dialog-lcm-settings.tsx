// kilocode_change - LCM conversation-context settings dialog
import { TextAttributes } from "@opentui/core"
import type { LcmSettingsState, LcmUpdateSettingsInput } from "@kilocode/sdk/v2"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { Spinner } from "./spinner"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogAlert } from "../ui/dialog-alert"
import { useToast } from "../ui/toast"

type FiniteNumberInput = number | "NaN" | "Infinity" | "-Infinity" | undefined | null

function finiteNumber(value: FiniteNumberInput): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function formatLcmSettingsBytes(input: FiniteNumberInput) {
  const bytes = finiteNumber(input)
  if (bytes === undefined) return "Not reported"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatLcmSettingsScope(scope: LcmSettingsState["effectiveScope"]) {
  if (scope.kind === "workspace") return `workspace ${scope.workspaceID ?? ""}`.trim()
  if (scope.kind === "project") return `project ${scope.projectID ?? ""}`.trim()
  return "default"
}

export function lcmSettingsErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "error" in error) {
    const routeError = error as { error?: { safeMessage?: string } }
    if (routeError.error?.safeMessage) return routeError.error.safeMessage
  }
  if (error instanceof Error) return error.message
  return "LCM settings are not ready. Retry or check the project configuration."
}

export function DialogLcmSettings(props: { sessionID?: string; initialState?: LcmSettingsState }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [state, setState] = createSignal<LcmSettingsState | undefined>(props.initialState)
  const [busy, setBusy] = createSignal<string | undefined>(props.initialState ? undefined : "Loading LCM settings...")
  const [error, setError] = createSignal<string | undefined>()

  async function load() {
    setBusy("Loading LCM settings...")
    setError(undefined)
    const result = props.sessionID
      ? await sdk.client.session.lcm.settings.get({ sessionID: props.sessionID })
      : await sdk.client.lcm.settings.get()
    setBusy(undefined)
    if (result.error || !result.data) {
      setError(lcmSettingsErrorMessage(result.error))
      return
    }
    setState(result.data)
  }

  async function updateSettings(input: LcmUpdateSettingsInput) {
    setBusy("Saving LCM settings...")
    setError(undefined)
    const result = props.sessionID
      ? await sdk.client.session.lcm.settings.update({
          sessionID: props.sessionID,
          lcmUpdateSettingsInput: input,
        })
      : await sdk.client.lcm.settings.update({ lcmUpdateSettingsInput: input })
    setBusy(undefined)
    if (result.error || !result.data) {
      const message = lcmSettingsErrorMessage(result.error)
      setError(message)
      toast.show({ variant: "error", message })
      return
    }
    toast.show({ variant: "success", message: "LCM settings updated.", duration: 2500 })
    dialog.replace(() => <DialogLcmSettings sessionID={props.sessionID} initialState={result.data} />)
  }

  function showStrategyDialog(current: LcmSettingsState) {
    const options: DialogSelectOption<LcmSettingsState["strategy"]>[] = [
      {
        title: "Upward",
        value: "upward",
        description: "Use the default upward summary strategy",
        onSelect: () => void updateSettings({ strategy: "upward" }),
      },
      {
        title: "Dolt",
        value: "dolt",
        description: "Use the Dolt-backed strategy",
        onSelect: () => void updateSettings({ strategy: "dolt" }),
      },
    ]
    dialog.replace(() => <DialogSelect title="LCM strategy" options={options} current={current.strategy} />)
  }

  async function showThresholdPrompt(current: LcmSettingsState) {
    const threshold = finiteNumber(current.storageWarningThresholdBytes)
    const value = await DialogPrompt.show(dialog, "Storage warning threshold", {
      value: threshold === undefined ? "" : String(threshold),
      placeholder: "10737418240",
      description: () => (
        <text fg={theme.textMuted}>
          Current threshold {formatLcmSettingsBytes(current.storageWarningThresholdBytes)}. Enter bytes.
        </text>
      ),
    })
    if (value === null) return
    const next = Number(value.trim())
    if (!Number.isSafeInteger(next) || next <= 0) {
      await DialogAlert.show(dialog, "Invalid threshold", "Enter a positive integer byte value.")
      dialog.replace(() => <DialogLcmSettings sessionID={props.sessionID} initialState={current} />)
      return
    }
    await updateSettings({ storageWarningThresholdBytes: next })
  }

  const options = createMemo((): DialogSelectOption<string>[] => {
    const current = state()
    if (!current) {
      return [{ title: "Retry", value: "retry", description: error(), onSelect: () => void load() }]
    }
    return [
      {
        title: "Strategy",
        value: "strategy",
        description: "Current conversation-context strategy",
        footer: current.strategy,
        category: "Settings",
        onSelect: () => showStrategyDialog(current),
      },
      {
        title: "Storage warning threshold",
        value: "threshold",
        description: "Warn when LCM storage exceeds this value",
        footer: formatLcmSettingsBytes(current.storageWarningThresholdBytes),
        category: "Settings",
        onSelect: () => void showThresholdPrompt(current),
      },
      {
        title: "Storage used",
        value: "storage",
        description: `${formatLcmSettingsBytes(current.storageBytes)} stored`,
        footer: current.storageWarning ? "warning" : "ok",
        category: "Status",
      },
      {
        title: "Scope",
        value: "scope",
        description: formatLcmSettingsScope(current.effectiveScope),
        category: "Status",
      },
      ...(current.lifecycleState
        ? [{ title: "Lifecycle", value: "lifecycle", description: current.lifecycleState, category: "Status" }]
        : []),
      ...(current.dbStatus
        ? [
            {
              title: "Database",
              value: "database",
              description: current.dbStatus.status,
              footer: `schema ${current.dbStatus.schemaVersion}`,
              category: "Status",
            },
          ]
        : []),
      {
        title: "Refresh",
        value: "refresh",
        description: "Reload LCM settings",
        category: "Actions",
        onSelect: () => void load(),
      },
    ]
  })

  onMount(() => {
    if (!props.initialState) void load()
  })

  return (
    <Show
      when={!busy()}
      fallback={
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              LCM conversation context
            </text>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc
            </text>
          </box>
          <Spinner color={theme.textMuted}>{busy()}</Spinner>
        </box>
      }
    >
      <DialogSelect title="LCM conversation context" placeholder="Select setting" options={options()} />
    </Show>
  )
}
