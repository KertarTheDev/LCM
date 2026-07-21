import { Component, For, Show, createSignal } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useMemory } from "../../context/memory"
import SettingsRow from "./SettingsRow"
import { LcmContextSettings } from "./LcmContextSettings"

const ContextTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const memory = useMemory()
  const language = useLanguage()
  const [newPattern, setNewPattern] = createSignal("")

  const patterns = () => config().watcher?.ignore ?? []
  const addPattern = () => {
    const value = newPattern().trim()
    if (!value) return
    const current = [...patterns()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ watcher: { ignore: current } })
    }
    setNewPattern("")
  }

  const removePattern = (index: number) => {
    const current = [...patterns()]
    current.splice(index, 1)
    updateConfig({ watcher: { ignore: current } })
  }

  const memoryStats = () => {
    const status = memory.status()
    if (!status) return language.t("settings.context.memory.status.notLoaded")
    if (!status.state.enabled) return language.t("settings.context.memory.status.disabled")
    if (status.index.estimatedTokens === 0) return language.t("chat.memory.project.empty")
    const tokens = status.index.estimatedTokens.toLocaleString(language.locale())
    return language.t("settings.context.memory.status.enabledTokens", { tokens })
  }

  return (
    <div>
      <LcmContextSettings />

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.context.memory.title")}</h4>
      <Card>
        <SettingsRow title={language.t("settings.context.memory.project.title")} description={memoryStats()}>
          <Switch
            checked={memory.enabled()}
            onChange={(checked) => (checked ? memory.enable() : memory.disable())}
            hideLabel
            disabled={memory.pending()}
          >
            {language.t("settings.context.memory.project.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.autoSave.title")}
          description={language.t("settings.context.memory.autoSave.description")}
        >
          <Switch
            checked={memory.status()?.state.autoConsolidate ?? true}
            onChange={(checked) => memory.auto(checked ? "on" : "off")}
            hideLabel
            disabled={memory.pending() || !memory.status()}
          >
            {language.t("settings.context.memory.autoSave.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.storage.title")}
          description={
            memory.enabled()
              ? language.t("settings.context.memory.storage.path", { path: memory.status()!.root })
              : language.t("settings.context.memory.storage.enable")
          }
          last
        >
          <Button
            variant="secondary"
            size="small"
            icon="eye"
            disabled={memory.loading() || memory.pending() || !memory.enabled() || memory.totalTokens() === 0}
            onClick={() => memory.inspect()}
          >
            {language.t("settings.context.memory.inspect")}
          </Button>
        </SettingsRow>
        <Show when={memory.error()}>
          {(err) => (
            <div
              style={{
                padding: "8px 12px",
                color: "var(--vscode-errorForeground)",
                "font-size": "var(--kilo-font-size-12)",
              }}
            >
              {err()}
            </div>
          )}
        </Show>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.context.watcherPatterns")}</h4>

      <Card>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": patterns().length > 0 || newPattern() ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          {language.t("settings.context.watcherPatterns.description")}
        </div>

        {/* Add new pattern */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": patterns().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newPattern()}
              placeholder="e.g. **/node_modules/**"
              onChange={(val) => setNewPattern(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addPattern()
              }}
            />
          </div>
          <Button variant="secondary" onClick={addPattern}>
            {language.t("common.add")}
          </Button>
        </div>

        {/* Pattern list */}
        <For each={patterns()}>
          {(pattern, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < patterns().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "var(--kilo-font-size-12)",
                }}
              >
                {pattern}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removePattern(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ContextTab
