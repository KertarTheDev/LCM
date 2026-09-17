/**
 * ContextProgress — three-segment progress bar showing context window usage.
 *
 * Segments:
 *   1. Used tokens (foreground color, turns red when >= 50%)
 *   2. Reserved for output (medium gray)
 *   3. Available (transparent / background)
 *
 * Token counts flanking the bar: used on left, total on right.
 */

import { Component, createMemo, Show } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useProvider } from "../../context/provider"
import { formatCompactCount as fmt } from "../../utils/format"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"

export const ContextProgress: Component = () => {
  const session = useSession()
  const provider = useProvider()
  const vscode = useVSCode()
  const language = useLanguage()
  const memory = createMemo(() => session.lcmStatus())

  const model = createMemo(() => {
    const sel = session.selected()
    return sel ? provider.findModel(sel) : undefined
  })

  const limit = createMemo(() => model()?.limit?.context ?? model()?.contextLength ?? 0)

  const data = createMemo(() => {
    const currentMemory = memory()
    if (
      currentMemory?.capacity.known &&
      currentMemory.capacity.activeInputTokens !== undefined &&
      currentMemory.capacity.usableInputTokens
    ) {
      const used = Math.min(currentMemory.capacity.activeInputTokens, currentMemory.capacity.usableInputTokens)
      const limit = currentMemory.capacity.usableInputTokens
      const available = Math.max(0, limit - used)
      return {
        used,
        reserved: 0,
        available,
        limit,
        pctUsed: (used / limit) * 100,
        pctReserved: 0,
        pctAvail: (available / limit) * 100,
        output: 0,
        memory: currentMemory,
      }
    }
    const usage = session.contextUsage()
    const max = limit()
    if (!usage || usage.tokens === 0 || max === 0) return undefined

    const output = model()?.limit?.output ?? 0

    const used = Math.min(usage.tokens, max)
    const reserved = Math.min(output, max - used)
    const available = Math.max(0, max - used - reserved)

    const pctUsed = (used / max) * 100
    const pctReserved = (reserved / max) * 100
    const pctAvail = (available / max) * 100

    return { used, reserved, available, limit: max, pctUsed, pctReserved, pctAvail, output, memory: currentMemory }
  })

  // The skeleton is a loading state, so it shows only while a turn is running
  // and the context is not resolvable yet. The row itself is always rendered to
  // keep the header height fixed. Without a context limit the row stays empty,
  // as it did before, instead of pulsing forever.
  const pending = createMemo(() => session.status() === "busy" && limit() > 0 && !data())

  const tip = createMemo(() => {
    const d = data()
    if (!d) return ""
    const lines = [`${fmt(d.used)} / ${fmt(d.limit)} tokens used`]
    if (d.output > 0) lines.push(`${fmt(d.output)} reserved for output`)
    if (d.available > 0) lines.push(`${fmt(d.available)} available`)
    if (d.memory) {
      lines.push(
        language.t("conversationMemory.tooltip.summary", {
          summaries: d.memory.composition.summaryItems,
          rawTokens: fmt(d.memory.composition.rawTokens),
        }),
      )
      lines.push(
        language.t("conversationMemory.tooltip.state", {
          mode: `${d.memory.mode}/${d.memory.background.phase}`,
          health: d.memory.health,
        }),
      )
      lines.push(
        `Raw conversation: ${fmt(d.memory.composition.eligibleRawTokens)} eligible + ${fmt(
          d.memory.composition.protectedRawTokens,
        )} protected`,
      )
      lines.push(
        `Protected raw: ${fmt(d.memory.composition.recentConsumedRawTokens)} recent consumed + ${fmt(
          d.memory.composition.unconsumedRawTokens,
        )} not yet consumed`,
      )
      if (d.memory.capacity.fixedInputTokens !== undefined)
        lines.push(`Fixed upstream input: ${fmt(d.memory.capacity.fixedInputTokens)}`)
    }
    return lines.join("\n")
  })

  return (
    <Show
      when={data() || memory() || session.lcmStatusError()}
      fallback={
        <div class="context-progress" aria-hidden="true">
          <Show when={pending()}>
            <div class="task-header-skeleton" style={{ width: "32px" }} />
            <div class="task-header-skeleton" style={{ flex: 1, height: "4px" }} />
            <div class="task-header-skeleton" style={{ width: "32px" }} />
          </Show>
        </div>
      }
    >
      <div class="context-progress-stack">
        <Show when={data()}>
          {(d) => (
            <div class="context-progress">
              <span class="context-progress-count">{fmt(d().used)}</span>
              <Tooltip value={tip()} placement="top">
                <div class="context-progress-bar">
                  <div
                    class="context-progress-used"
                    classList={{ "context-progress-used--hot": d().pctUsed >= 50 }}
                    style={{ width: `${d().pctUsed}%` }}
                  />
                  <div class="context-progress-reserved" style={{ width: `${d().pctReserved}%` }} />
                  <Show when={d().pctAvail > 0}>
                    <div class="context-progress-available" style={{ width: `${d().pctAvail}%` }} />
                  </Show>
                </div>
              </Tooltip>
              <span class="context-progress-count">{fmt(d().limit)}</span>
            </div>
          )}
        </Show>
        <Show when={memory()}>
          {(status) => (
            <div class="context-memory-details">
              <div>
                {language.t("conversationMemory.stats.composition", {
                  eligible: fmt(status().composition.eligibleRawTokens),
                  protected: fmt(status().composition.protectedRawTokens),
                  summaries: String(status().composition.summaryItems),
                })}
              </div>
              <div>
                Protected: {fmt(status().composition.recentConsumedRawTokens)} recent consumed +{" "}
                {fmt(status().composition.unconsumedRawTokens)} not yet consumed
              </div>
              <div>
                {language.t("conversationMemory.stats.state", {
                  mode: status().mode,
                  phase: status().background.phase,
                  health: status().health,
                })}
              </div>
              <Show when={!status().capacity.known}>
                <div class="context-memory-warning">
                  {status().issue?.message ?? language.t("conversationMemory.status.capacityUnknown")}
                </div>
              </Show>
              <Show when={status().capacity.known && status().issue}>
                <div class="context-memory-warning">{status().issue!.message}</div>
              </Show>
              <Show when={status().sessionID && !status().sessionID.startsWith("cloud:")}>
                <button
                  type="button"
                  aria-label={language.t("conversationMemory.timeline.show")}
                  title={language.t("conversationMemory.timeline.show")}
                  onClick={() =>
                    vscode.postMessage({
                      type: "showLcmTimeline",
                      sessionID: status().sessionID,
                    })
                  }
                >
                  {language.t("conversationMemory.action.timeline")}
                </button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={session.lcmStatusError()}>
          {(error) => (
            <div class="context-memory-warning">
              {language.t("conversationMemory.status.loadFailed", { message: error() })}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
