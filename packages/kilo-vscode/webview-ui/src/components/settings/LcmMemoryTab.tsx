import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import type {
  LcmDbDiagnoseReport,
  LcmDbRebuildReport,
  LcmPromptExportReport,
  LcmSafeError,
  LcmSettingsState,
} from "@kilocode/sdk/v2/client"
import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import {
  dbStatusLabel,
  describeScope,
  finiteNumber,
  formatStorageThresholdGiB,
  LCM_FRESH_TAIL_DESCRIPTION,
  lcmMemoryActionButtons,
  type LcmMemoryActionKind,
  lcmMemoryStatusItems,
  storageWarningSettingsDescription,
  statusMessage,
} from "./lcm-memory-state"
import { createLcmSettingsRefreshScheduler } from "./lcm-memory-refresh"
import {
  createLcmMemoryNumericSettingsAutosave,
  isLcmMemoryAutosaveValidationError,
} from "./lcm-memory-autosave"
import {
  beginLcmDbDiagnose,
  beginLcmDbRebuild,
  beginLcmMaintenanceCancel,
  beginLcmPromptsExport,
  beginLcmSettingsRead,
  beginLcmSettingsUpdate,
  finishLcmSettingsRequest,
  lcmMemoryRequestScope,
  type LcmSettingsRequestKind,
  type LcmSettingsPendingRequests,
} from "./lcm-memory-requests"

type StrategyOption = {
  value: "upward" | "dolt"
  label: string
}

const strategyOptions: StrategyOption[] = [
  { value: "upward", label: "Upward" },
  { value: "dolt", label: "Dolt" },
]

const KILO_SUPPORT_URL = "https://kilo.ai/support"

let requestSequence = 0

function nextRequestID(prefix: string) {
  requestSequence += 1
  return `lcm-${prefix}-${requestSequence}`
}

function diagnosticSummary(report: LcmDbDiagnoseReport) {
  const passed = report.checks.filter((check) => check.status === "passed").length
  const failed = report.checks.filter((check) => check.status === "failed").length
  const total = report.checks.length
  const failedText = failed > 0 ? `, ${failed} failed` : ""
  return `${dbStatusLabel({ status: report.status, dataDir: report.dataDir })}. ${passed}/${total} checks passed${failedText}.`
}

function diagnosticDetail(report: LcmDbDiagnoseReport) {
  const firstSafeError = report.safeErrors[0]
  if (firstSafeError) return firstSafeError.safeMessage
  if (report.quarantineRecommended) return "Memory can be rebuilt from saved Kilo messages."
  return `Operation ${report.operationID}`
}

function rebuildSummary(report: LcmDbRebuildReport) {
  const repaired = report.status === "rebuilt" ? "Memory repair completed" : "Memory repair preview"
  const rebuiltConversations = finiteNumber(report.rebuiltConversations) ?? 0
  const failedConversations = finiteNumber(report.failedConversations) ?? 0
  const failed = failedConversations > 0 ? `, ${failedConversations} failed` : ""
  return `${repaired}. ${rebuiltConversations} conversations rebuilt${failed}.`
}

function promptExportSummary(report: LcmPromptExportReport) {
  const fileCount = finiteNumber(report.fileCount) ?? 0
  return `Prompt export wrote ${fileCount} Markdown files to ${report.exportDir}.`
}

function shouldOfferRepairPreview(report: LcmDbDiagnoseReport | undefined) {
  return !!report && (report.quarantineRecommended || report.status === "corrupt" || report.status === "unavailable")
}

const LcmMemoryTab: Component = () => {
  const vscode = useVSCode()
  const session = useSession()
  const [state, setState] = createSignal<LcmSettingsState>()
  const [error, setError] = createSignal<LcmSafeError>()
  const [diagnostics, setDiagnostics] = createSignal<LcmDbDiagnoseReport>()
  const [rebuild, setRebuild] = createSignal<LcmDbRebuildReport>()
  const [promptExport, setPromptExport] = createSignal<LcmPromptExportReport>()
  const [pendingRequests, setPendingRequests] = createSignal<LcmSettingsPendingRequests>({})
  const [freshTailDraft, setFreshTailDraft] = createSignal("")
  const [thresholdDraft, setThresholdDraft] = createSignal("")

  const loading = createMemo(() => pendingRequests().read !== undefined)
  const saving = createMemo(() => pendingRequests().update !== undefined)
  const cancelingMaintenance = createMemo(() => pendingRequests().cancelMaintenance !== undefined)
  const diagnosingDb = createMemo(() => pendingRequests().diagnoseDb !== undefined)
  const rebuildingDb = createMemo(() => pendingRequests().rebuildDb !== undefined)
  const exportingPrompts = createMemo(() => pendingRequests().exportPrompts !== undefined)
  const settingsDisabled = createMemo(
    () => loading() || saving() || cancelingMaintenance() || diagnosingDb() || rebuildingDb() || exportingPrompts(),
  )
  const canPreviewRepair = createMemo(() => shouldOfferRepairPreview(diagnostics()) && !rebuild()?.dryRun)
  const canApplyRepair = createMemo(() => rebuild()?.dryRun === true && rebuild()?.status === "would_rebuild")
  const selectedStrategy = createMemo(
    () => strategyOptions.find((option) => option.value === state()?.strategy) ?? strategyOptions[0]!,
  )
  const statusItems = createMemo(() =>
    lcmMemoryStatusItems({
      state: state(),
      error: error(),
      metrics: session.lcmMetrics(),
      contextUsage: session.contextUsage(),
      maintenanceHint: session.maintenanceHint(),
    }),
  )
  const actionButtons = createMemo(() =>
    lcmMemoryActionButtons({
      state: state(),
      error: error(),
      metrics: session.lcmMetrics(),
      maintenanceHint: session.maintenanceHint(),
    }),
  )
  const requestScope = () => lcmMemoryRequestScope(session.currentSessionID())

  const requestSettings = (options: { resetPending?: boolean } = {}) => {
    const requestID = nextRequestID("settings")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmSettingsRead(options.resetPending ? {} : pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    vscode.postMessage({
      type: "requestLcmSettings",
      requestID,
      body: requestScope(),
    })
  }

  const updateSettings = (patch: {
    strategy?: "upward" | "dolt"
    freshTailTokens?: number
    storageWarningThresholdBytes?: number
  }) => {
    const requestID = nextRequestID("settings-update")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmSettingsUpdate(pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    vscode.postMessage({
      type: "updateLcmSettings",
      requestID,
      body: { ...requestScope(), ...patch },
    })
  }
  const settingsRefresh = createLcmSettingsRefreshScheduler(requestSettings)
  const clearAutosaveValidationError = () => {
    setError((current) => (isLcmMemoryAutosaveValidationError(current) ? undefined : current))
  }
  const numericSettingsAutosave = createLcmMemoryNumericSettingsAutosave({
    save: updateSettings,
    invalid: setError,
    idle: clearAutosaveValidationError,
  })

  const cancelMaintenance = () => {
    const requestID = nextRequestID("maintenance-cancel")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmMaintenanceCancel(pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    vscode.postMessage({
      type: "cancelLcmMaintenance",
      requestID,
      body: requestScope(),
    })
  }

  const diagnoseDb = () => {
    const requestID = nextRequestID("db-diagnose")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmDbDiagnose(pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    setDiagnostics(undefined)
    setRebuild(undefined)
    vscode.postMessage({
      type: "diagnoseLcmDb",
      requestID,
      body: requestScope(),
    })
  }

  const rebuildDb = (dryRun: boolean) => {
    const requestID = nextRequestID(dryRun ? "db-rebuild-preview" : "db-rebuild-apply")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmDbRebuild(pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    vscode.postMessage({
      type: "rebuildLcmDb",
      requestID,
      body: { ...requestScope(), dryRun },
    })
  }

  const exportPrompts = () => {
    const requestID = nextRequestID("prompts-export")
    let started = false
    setPendingRequests((pending) => {
      const result = beginLcmPromptsExport(pending, requestID)
      started = result.started
      return result.pending
    })
    if (!started) return
    setError(undefined)
    setPromptExport(undefined)
    vscode.postMessage({
      type: "exportLcmPrompts",
      requestID,
      body: requestScope(),
    })
  }

  const runMemoryAction = (kind: LcmMemoryActionKind) => {
    if (kind === "refresh") {
      requestSettings({ resetPending: true })
      return
    }
    if (kind === "cancel_maintenance") {
      cancelMaintenance()
      return
    }
    if (kind === "diagnose_db") {
      diagnoseDb()
      return
    }
    if (kind === "export_prompts") {
      exportPrompts()
      return
    }
    if (kind === "support") {
      vscode.postMessage({ type: "openExternal", url: KILO_SUPPORT_URL })
      return
    }
    session.createSession()
  }

  const acceptResponse = (kind: LcmSettingsRequestKind, requestID: string) => {
    let accepted = false
    setPendingRequests((pending) => {
      const result = finishLcmSettingsRequest(pending, kind, requestID)
      accepted = result.accepted
      return result.pending
    })
    return accepted
  }

  const handleSettingsResult = (
    message: Extract<ExtensionMessage, { type: "requestLcmSettings.result" | "updateLcmSettings.result" }>,
  ) => {
    const kind = message.type === "requestLcmSettings.result" ? "read" : "update"
    if (!acceptResponse(kind, message.requestID)) return
    if (!message.ok) {
      setError(message.error)
      return
    }
    setState(message.body)
    setFreshTailDraft(String(message.body.freshTailTokens))
    setThresholdDraft(formatStorageThresholdGiB(message.body.storageWarningThresholdBytes))
    setError(undefined)
    if (!message.body.safeError && message.body.dbStatus?.status === "ready") {
      setDiagnostics(undefined)
      setRebuild(undefined)
    }
  }

  const handleCancelMaintenanceResult = (
    message: Extract<ExtensionMessage, { type: "cancelLcmMaintenance.result" }>,
  ) => {
    if (!acceptResponse("cancelMaintenance", message.requestID)) return
    if (message.ok) requestSettings({ resetPending: true })
    else setError(message.error)
  }

  const handleDiagnoseResult = (message: Extract<ExtensionMessage, { type: "diagnoseLcmDb.result" }>) => {
    if (!acceptResponse("diagnoseDb", message.requestID)) return
    if (!message.ok) {
      setError(message.error)
      return
    }
    setDiagnostics(message.body)
    setRebuild(undefined)
    setError(undefined)
  }

  const handleRebuildResult = (message: Extract<ExtensionMessage, { type: "rebuildLcmDb.result" }>) => {
    if (!acceptResponse("rebuildDb", message.requestID)) return
    if (!message.ok) {
      setError(message.error)
      return
    }
    setRebuild(message.body)
    setError(undefined)
    if (!message.body.dryRun) requestSettings({ resetPending: true })
  }

  const handleExportResult = (message: Extract<ExtensionMessage, { type: "exportLcmPrompts.result" }>) => {
    if (!acceptResponse("exportPrompts", message.requestID)) return
    if (!message.ok) {
      setError(message.error)
      return
    }
    setPromptExport(message.body)
    setError(undefined)
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    switch (message.type) {
      case "requestLcmSettings.result":
      case "updateLcmSettings.result":
        handleSettingsResult(message)
        break
      case "cancelLcmMaintenance.result":
        handleCancelMaintenanceResult(message)
        break
      case "diagnoseLcmDb.result":
        handleDiagnoseResult(message)
        break
      case "rebuildLcmDb.result":
        handleRebuildResult(message)
        break
      case "exportLcmPrompts.result":
        handleExportResult(message)
        break
      case "lcmEvent":
        if (message.event.type === "lcm.metrics.updated") settingsRefresh.schedule()
        break
      case "lcmMemoryContextChanged":
        setError(undefined)
        setDiagnostics(undefined)
        setRebuild(undefined)
        setPromptExport(undefined)
        requestSettings({ resetPending: true })
        break
    }
  })

  onCleanup(() => {
    settingsRefresh.dispose()
    numericSettingsAutosave.dispose()
    unsubscribe()
  })
  onMount(settingsRefresh.requestNow)
  createEffect(
    on(
      () => session.currentSessionID(),
      () => requestSettings({ resetPending: true }),
      { defer: true },
    ),
  )
  createEffect(() => {
    const current = state()
    const disabled = settingsDisabled()
    const freshTail = freshTailDraft()
    const storageThreshold = thresholdDraft()
    if (!current || disabled) {
      numericSettingsAutosave.clear()
      return
    }
    numericSettingsAutosave.schedule({
      freshTailDraft: freshTail,
      storageThresholdDraft: storageThreshold,
      currentFreshTailTokens: finiteNumber(current.freshTailTokens),
      currentStorageWarningThresholdBytes: finiteNumber(current.storageWarningThresholdBytes),
    })
  })

  return (
    <div data-component="lcm-memory-settings">
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow title="Status" description={`DB status: ${dbStatusLabel(state()?.dbStatus)}`}>
          <span
            data-lcm-status
            data-state={state()?.lifecycleState ?? "unknown"}
            style={{
              color: error() || state()?.safeError ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
            }}
          >
            {statusMessage({ state: state(), error: error() })}
          </span>
        </SettingsRow>
        <div
          data-lcm-status-details
          style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px 12px",
            "margin-bottom": "12px",
            "padding-bottom": "12px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <For each={statusItems()}>
            {(item) => (
              <div
                data-lcm-status-item
                data-tone={item.tone}
                title={item.detail}
                style={{ "min-width": "0", display: "grid", gap: "2px" }}
              >
                <span
                  data-lcm-status-label
                  style={{
                    color: "var(--vscode-descriptionForeground)",
                    "font-size": "11px",
                    "line-height": "1.3",
                  }}
                >
                  {item.label}
                </span>
                <span
                  data-lcm-status-value
                  style={{
                    color:
                      item.tone === "error"
                        ? "var(--vscode-errorForeground)"
                        : item.tone === "warning"
                          ? "var(--vscode-editorWarning-foreground)"
                          : item.tone === "muted"
                            ? "var(--vscode-descriptionForeground)"
                            : "var(--vscode-foreground)",
                    "font-size": "12px",
                    "line-height": "1.35",
                    "overflow-wrap": "anywhere",
                  }}
                >
                  {item.value}
                </span>
                <Show when={item.detail}>
                  {(detail) => (
                    <span
                      data-lcm-status-detail
                      style={{
                        color: "var(--vscode-descriptionForeground)",
                        "font-size": "11px",
                        "line-height": "1.3",
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {detail()}
                    </span>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
        <Show when={actionButtons().length > 0}>
          <div
            data-lcm-safe-actions
            style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-bottom": "12px" }}
          >
            <For each={actionButtons()}>
              {(action) => (
                <Button
                  size="small"
                  variant="secondary"
                  icon={action.icon}
                  title={action.title}
                  onClick={() => runMemoryAction(action.kind)}
                  disabled={
                    action.disabled ||
                    (action.kind === "refresh" && settingsDisabled()) ||
                    (action.kind === "cancel_maintenance" && settingsDisabled()) ||
                    (action.kind === "diagnose_db" && settingsDisabled()) ||
                    (action.kind === "export_prompts" && settingsDisabled())
                  }
                >
                  {action.label}
                </Button>
              )}
            </For>
          </div>
        </Show>
        <Show when={promptExport()}>
          {(report) => (
            <div
              data-lcm-prompt-export
              style={{
                color: "var(--vscode-descriptionForeground)",
                "font-size": "12px",
                "line-height": "1.35",
                "margin-bottom": "12px",
                "overflow-wrap": "anywhere",
              }}
            >
              <div>{promptExportSummary(report())}</div>
              <Show when={report().warnings[0]}>{(warning) => <div>Warning: {warning()}</div>}</Show>
            </div>
          )}
        </Show>
        <Show when={diagnostics()}>
          {(report) => (
            <div
              data-lcm-db-diagnostics
              data-status={report().status}
              style={{
                color: "var(--vscode-descriptionForeground)",
                "font-size": "12px",
                "line-height": "1.35",
                "margin-bottom": "12px",
                "overflow-wrap": "anywhere",
              }}
            >
              <div>{diagnosticSummary(report())}</div>
              <div>{diagnosticDetail(report())}</div>
              <Show when={canPreviewRepair()}>
                <div style={{ "margin-top": "8px" }}>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => rebuildDb(true)}
                    disabled={settingsDisabled()}
                  >
                    Preview repair
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
        <Show when={rebuild()}>
          {(report) => (
            <div
              data-lcm-db-rebuild
              data-status={report().status}
              data-dry-run={String(report().dryRun)}
              style={{
                color: "var(--vscode-descriptionForeground)",
                "font-size": "12px",
                "line-height": "1.35",
                "margin-bottom": "12px",
                "overflow-wrap": "anywhere",
              }}
            >
              <div>{rebuildSummary(report())}</div>
              <Show when={report().safeErrors[0]}>{(safeError) => <div>{safeError().safeMessage}</div>}</Show>
              <Show when={canApplyRepair()}>
                <div style={{ "margin-top": "8px" }}>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => rebuildDb(false)}
                    disabled={settingsDisabled()}
                  >
                    Apply repair
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <SettingsRow title="Memory Strategy" description={`Effective scope: ${describeScope(state())}`}>
          <Select
            options={strategyOptions}
            current={selectedStrategy()}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => {
              if (!option || option.value === state()?.strategy) return
              updateSettings({ strategy: option.value })
            }}
            disabled={settingsDisabled()}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow title="Fresh Tail" description={LCM_FRESH_TAIL_DESCRIPTION}>
          <div style={{ width: "128px" }}>
            <TextField
              type="number"
              min="1"
              step="1"
              value={freshTailDraft()}
              onInput={(event) => setFreshTailDraft(event.currentTarget.value)}
              disabled={settingsDisabled()}
              hideLabel
            />
          </div>
        </SettingsRow>

        <SettingsRow title="Storage Warning" description={storageWarningSettingsDescription(state())} last>
          <div style={{ width: "128px" }}>
            <TextField
              type="number"
              min="0.001"
              step="0.001"
              value={thresholdDraft()}
              onInput={(event) => setThresholdDraft(event.currentTarget.value)}
              disabled={settingsDisabled()}
              hideLabel
            />
          </div>
        </SettingsRow>

        <div style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px", "margin-top": "10px" }}>
          Deleting a Kilo session also removes its saved memory.
        </div>
      </Card>
    </div>
  )
}

export default LcmMemoryTab
