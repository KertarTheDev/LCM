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
import type { ContextUsage } from "../../types/messages"

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function percentFromRatio(ratio: number | null | undefined, numerator: number, denominator: number): number | null {
  if (ratio !== undefined && ratio !== null) return Math.round(ratio * 100)
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null
}

function buildContextProgressData(usage: ContextUsage, providerLimit: number, providerOutput: number) {
  const limit = usage.limit ?? providerLimit
  if (limit === 0) return undefined

  const output = usage.source === "lcm_active_budget" ? 0 : providerOutput
  const used = Math.min(usage.tokens, limit)
  const reserved = Math.min(output, limit - used)
  const available = Math.max(0, limit - used - reserved)
  const softThreshold = usage.softThreshold ?? 0
  const softBacklogTokens = usage.softBacklogTokens ?? 0
  const protectedTailRawTokens = usage.protectedTailRawTokens ?? 0
  const rawLaneTokens = usage.rawLaneTokens ?? softBacklogTokens + protectedTailRawTokens
  const rawLanePct = percentFromRatio(usage.rawLaneRatio, rawLaneTokens, softThreshold)
  const softBacklogPct = percentFromRatio(usage.softBacklogRatio, softBacklogTokens, softThreshold)

  return {
    used,
    reserved,
    available,
    limit,
    pctUsed: (used / limit) * 100,
    pctReserved: (reserved / limit) * 100,
    pctAvail: (available / limit) * 100,
    output,
    softThreshold,
    softBacklogTokens,
    protectedTailRawTokens,
    rawLaneTokens,
    rawLanePct,
    softBacklogPct,
    maintenancePending: (rawLanePct ?? 0) >= 100 || (softBacklogPct ?? 0) >= 100,
  }
}

export const ContextProgress: Component = () => {
  const session = useSession()
  const provider = useProvider()

  const data = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage || usage.tokens === 0) return undefined

    const sel = session.selected()
    const model = sel ? provider.findModel(sel) : undefined
    const providerLimit = model?.limit?.context ?? model?.contextLength ?? 0
    return buildContextProgressData(usage, providerLimit, model?.limit?.output ?? 0)
  })

  const tip = createMemo(() => {
    const d = data()
    if (!d) return ""
    const usage = session.contextUsage()
    const lines = [`${usage?.label ?? "Context"}: ${fmt(d.used)} / ${fmt(d.limit)} tokens used`]
    if (usage?.providerContextLimit) lines.push(`${fmt(usage.providerContextLimit)} provider context`)
    if (usage?.outputReserve) lines.push(`${fmt(usage.outputReserve)} reserved for output`)
    if (usage?.systemPromptTokens) lines.push(`${fmt(usage.systemPromptTokens)} system prompt tokens`)
    if (usage?.toolSchemaTokens) lines.push(`${fmt(usage.toolSchemaTokens)} tool schema tokens`)
    if (usage?.tokenCounterMode) lines.push(`Token counter: ${usage.tokenCounterMode}`)
    if (usage?.softBacklogTokens !== undefined && usage.softThreshold !== undefined) {
      lines.push(`${fmt(d.rawLaneTokens)} / ${fmt(usage.softThreshold)} raw lane pressure`)
      lines.push(`${fmt(usage.softBacklogTokens)} / ${fmt(usage.softThreshold)} raw backlog pressure`)
      lines.push(`${fmt(d.protectedTailRawTokens)} protected tail tokens`)
    }
    if (d.output > 0) lines.push(`${fmt(d.output)} reserved for output`)
    if (d.available > 0) lines.push(`${fmt(d.available)} available`)
    return lines.join("\n")
  })

  return (
    <Show when={data()}>
      {(d) => (
        <div class="context-progress-stack">
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
          <Show when={d().softThreshold > 0 || d().reserved > 0}>
            <div class="context-progress-detail">
              Hard {Math.round(d().pctUsed)}%<Show when={d().rawLanePct !== null}> · Raw {d().rawLanePct}%</Show>
              <Show when={d().softBacklogPct !== null}> · Backlog {d().softBacklogPct}%</Show>
              <Show when={d().maintenancePending}> · Memory pending</Show>
              <Show when={d().reserved > 0}> · Reserve {fmt(d().reserved)}</Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}
