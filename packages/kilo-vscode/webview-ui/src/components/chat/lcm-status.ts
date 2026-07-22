import type { LcmMetricsSnapshot } from "@kilocode/sdk/v2/client"

function metric(value: LcmMetricsSnapshot["activeTokens"]) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function isNewerLcmMetrics(current: LcmMetricsSnapshot | undefined, next: LcmMetricsSnapshot) {
  return !current || Date.parse(next.updatedAt) >= Date.parse(current.updatedAt)
}

export function lcmPressureDisplay(value: LcmMetricsSnapshot, locale: string) {
  const active = metric(value.activeTokens)
  const hard = metric(value.hardLimit)
  const raw = metric(value.rawLaneTokens)
  const soft = metric(value.softThreshold)
  const backlog = metric(value.softBacklogTokens)
  const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0)
  return {
    active,
    hard,
    collapsed: `${active.toLocaleString(locale)} / ${hard.toLocaleString(locale)}`,
    expanded: `Hard ${pct(active, hard)}% · Raw ${pct(raw, soft)}% · Backlog ${pct(backlog, soft)}%`,
  }
}
