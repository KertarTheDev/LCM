/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost and context usage.
 * Also shows todo progress when the session has todos.
 *
 * When expanded, shows the task timeline (colored bars representing
 * session activity) and a context window progress bar.
 */

import { Component, For, Show, createMemo, createSignal, createEffect, onMount, onCleanup } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useSession } from "../../context/session"
import { calcTokenUsage, collapseCostBreakdown } from "../../context/session-utils"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TaskTimeline } from "./TaskTimeline"
import { ContextProgress } from "./ContextProgress"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import { target as todoTarget } from "../../context/todo-revert"
import type { Part, TodoItem, ExtensionMessage } from "../../types/messages"

interface TaskHeaderProps {
  readonly?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!session.currentSession())
  const hasMessages = createMemo(() => session.messages().length > 0)

  const fmt = (n: number) => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }).format(n)

  const breakdown = () => session.costBreakdown()

  const cost = createMemo(() => {
    const total = breakdown().reduce((sum, e) => sum + e.cost, 0)
    if (total === 0) return undefined
    return fmt(total)
  })

  const costTooltip = createMemo(() => {
    const items = breakdown()
    if (items.length <= 1) return <span>{language.t("context.usage.sessionCost")}</span>
    const collapsed = collapseCostBreakdown(items, (n) =>
      language.t("context.usage.olderSessions", { count: String(n) }),
    )
    return (
      <div style={{ "text-align": "left", "white-space": "nowrap" }}>
        <For each={collapsed}>{(e) => <div>{`${e.label}: ${fmt(e.cost)}`}</div>}</For>
      </div>
    )
  })

  const context = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    const label = usage.label
    const detail =
      usage.source === "lcm_active_budget"
        ? `${label}: ${tokens} tokens${pct ? ` (${pct} of active budget)` : ""}`
        : `${tokens} tokens${pct ? ` (${pct} of context)` : ""}`
    return { tokens, pct, label, detail }
  })

  const maintenanceHint = createMemo(() => session.maintenanceHint())
  const maintenanceTooltip = createMemo(() => {
    const hint = maintenanceHint()
    if (!hint) return ""
    const details = [`Status: ${hint.state}`, `Reason: ${hint.reason ?? hint.kind}`]
    if (hint.operationID) details.push(`Operation: ${hint.operationID}`)
    if (hint.safeCode) details.push(`Code: ${hint.safeCode}`)
    if (hint.action) details.push(`Action: ${hint.action}`)
    if (hint.retryable !== undefined) details.push(`Retryable: ${hint.retryable ? "yes" : "no"}`)
    if (hint.safeMessage) details.push(`Message: ${hint.safeMessage}`)
    if (hint.diagnosticCode) details.push(`Diagnostic: ${hint.diagnosticCode}`)
    if (hint.softBacklogTokens !== undefined && hint.softThreshold !== undefined) {
      details.push(
        `Soft backlog: ${hint.softBacklogTokens.toLocaleString(language.locale())} / ${hint.softThreshold.toLocaleString(language.locale())}`,
      )
    }
    if (hint.rawLaneTokens !== undefined && hint.softThreshold !== undefined) {
      details.push(
        `Raw lane: ${hint.rawLaneTokens.toLocaleString(language.locale())} / ${hint.softThreshold.toLocaleString(language.locale())}`,
      )
    }
    if (hint.protectedTailRawTokens !== undefined) {
      details.push(`Protected tail: ${hint.protectedTailRawTokens.toLocaleString(language.locale())}`)
    }
    if (hint.rawLaneRatio !== undefined) {
      details.push(`Raw lane: ${Math.round(hint.rawLaneRatio * 100)}% of threshold`)
    }
    if (hint.softBacklogRatio !== undefined) {
      details.push(`Raw backlog: ${Math.round(hint.softBacklogRatio * 100)}% of threshold`)
    }
    return details.join("\n")
  })

  const tokens = createMemo(() => calcTokenUsage(session.visibleMessages()))

  const hasTimeline = createMemo(() => {
    for (const m of session.visibleMessages()) {
      if (m.role !== "assistant") continue
      if (session.getParts(m.id).some((p) => p.type !== "step-start")) return true
    }
    return false
  })

  const fmtNum = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const vscode = useVSCode()
  const [expanded, setExpanded] = createSignal(true)

  // Read initial value from VS Code settings
  onMount(() => vscode.postMessage({ type: "requestTimelineSetting" }))
  const handler = (e: MessageEvent<ExtensionMessage>) => {
    if (e.data.type === "timelineSettingLoaded") setExpanded(e.data.visible)
  }
  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  const toggle = () => {
    const next = !expanded()
    setExpanded(next)
    vscode.postMessage({ type: "updateSetting", key: "showTaskTimeline", value: next })
  }

  const todos = createMemo(() => session.todos())
  const hasTodos = createMemo(() => todos().length > 0)
  const doneCount = createMemo(() => todos().filter((t: TodoItem) => t.status === "completed").length)
  const totalCount = createMemo(() => todos().length)
  const allDone = createMemo(() => doneCount() === totalCount() && totalCount() > 0)

  const todoSummary = createMemo(() => {
    const done = doneCount()
    const total = totalCount()
    if (total === 0) return ""
    if (done === total) return language.t("task.todos.allDone", { count: String(total) })
    return language.t("task.todos.progress", { done: String(done), total: String(total) })
  })

  const [todosOpen, setTodosOpen] = createSignal(false)
  const [renaming, setRenaming] = createSignal<{ id: string; title: string }>()

  const startRename = () => {
    if (props.readonly) return
    const info = session.currentSession()
    if (!info) return
    setRenaming({ id: info.id, title: info.title ?? "" })
  }

  const commitRename = (title: string) => {
    const info = renaming()
    if (!info) return
    setRenaming(undefined)
    if (title === info.title) return
    session.renameSession(info.id, title)
  }

  const cancelRename = () => {
    setRenaming(undefined)
  }

  createEffect(() => {
    const info = renaming()
    if (info && session.currentSession()?.id !== info.id) setRenaming(undefined)
  })

  const donePart = (idx: number): Part | undefined =>
    todoTarget({ messages: session.messages(), parts: session.allParts() }, idx)

  const revertTodo = (part: Part | undefined) => {
    if (session.status() !== "idle") return
    if (part?.type !== "tool") return
    if (!part.messageID) return
    session.revertSession(part.messageID, part.id)
  }

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header">
        <div data-slot="task-header-title">
          <Show
            when={!renaming()}
            fallback={
              <SessionRenameEditor
                title={renaming()?.title ?? ""}
                autosize
                onSave={commitRename}
                onCancel={cancelRename}
              />
            }
          >
            <span
              data-slot="task-header-title-trigger"
              data-renamable={canRename() ? "" : undefined}
              title={canRename() ? language.t("agentManager.worktree.doubleClickRename") : title()}
              tabIndex={canRename() ? 0 : undefined}
              role={canRename() ? "button" : undefined}
              onDblClick={startRename}
              onKeyDown={(e) => {
                if (!canRename() || (e.key !== "Enter" && e.key !== " ")) return
                e.preventDefault()
                startRename()
              }}
            >
              <span data-slot="task-header-title-label">{title()}</span>
            </span>
          </Show>
        </div>
        <div data-slot="task-header-stats">
          <Show when={maintenanceHint()}>
            {(hint) => (
              <Tooltip value={maintenanceTooltip()} placement="bottom">
                <span data-slot="task-header-maintenance" data-state={hint().state} aria-label={hint().label}>
                  <span data-slot="task-header-maintenance-dot" />
                  <span data-slot="task-header-maintenance-label">{hint().label}</span>
                </span>
              </Tooltip>
            )}
          </Show>
          <Show when={cost()}>
            {(c) => (
              <Tooltip value={costTooltip()} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={context()}>
            {(ctx) => (
              <Tooltip value={ctx().detail} placement="bottom">
                <span>{ctx().pct ?? ctx().tokens}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={hasMessages()}>
            <button
              data-slot="task-header-expand"
              onClick={toggle}
              aria-expanded={expanded()}
              aria-label="Toggle timeline"
            >
              <Icon name="chevron-down" size="small" style={expanded() ? { transform: "rotate(180deg)" } : undefined} />
            </button>
          </Show>
        </div>
      </div>
      {/* Expanded graph section: timeline + context bar + token breakdown */}
      <Show when={expanded() && hasTimeline()}>
        <div data-component="task-header-graph">
          <TaskTimeline />
          <div data-slot="task-header-graph-row">
            <ContextProgress />
          </div>
          <Show when={tokens()}>
            {(tk) => (
              <div class="task-header-tokens">
                <span class="task-header-tokens-label">Tokens</span>
                <Show when={tk().input > 0}>
                  <span class="task-header-tokens-value">
                    <Icon name="arrow-up" size="small" />
                    {fmtNum(tk().input)}
                  </span>
                </Show>
                <Show when={tk().output > 0}>
                  <span class="task-header-tokens-value">
                    <Icon name="arrow-down-to-line" size="small" />
                    {fmtNum(tk().output)}
                  </span>
                </Show>
                <Show when={tk().cached > 0}>
                  <span class="task-header-tokens-value">
                    <Icon name="arrow-down-to-line" size="small" />
                    cache {fmtNum(tk().cached)}
                  </span>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
      <Show when={hasTodos()}>
        <div data-component="task-header-todos">
          <button
            data-slot="task-header-todos-trigger"
            onClick={() => setTodosOpen((v) => !v)}
            aria-expanded={todosOpen()}
          >
            <Icon name="checklist" size="small" />
            <span data-slot="task-header-todos-summary" data-all-done={allDone() ? "" : undefined}>
              {todoSummary()}
            </span>
            <Icon
              name="chevron-down"
              size="small"
              data-slot="task-header-todos-arrow"
              data-open={todosOpen() ? "" : undefined}
            />
          </button>
          <Show when={todosOpen()}>
            <div data-slot="task-header-todos-list">
              <For each={todos()}>
                {(todo: TodoItem, idx) => {
                  const part = createMemo(() => (todo.status === "completed" ? donePart(idx()) : undefined))
                  return (
                    <Tooltip value={part() ? language.t("settings.checkpoints.title") : undefined} placement="bottom">
                      <Checkbox readOnly checked={todo.status === "completed"} onClick={() => revertTodo(part())}>
                        <span
                          data-slot="task-header-todo-content"
                          data-completed={todo.status === "completed" ? "" : undefined}
                        >
                          {todo.content}
                        </span>
                      </Checkbox>
                    </Tooltip>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
