import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { sha256, sortableID } from "./ids"
import type {
  ActivityRecord,
  ContextFrame,
  ConversationMemoryStore,
  FrontierRevision,
  SummaryAttempt,
  SummaryNode,
} from "./types"

export const CONTEXT_EXPORT_VERSION = 1
export const LCM_IMPLEMENTATION_VERSION = 1
export const LCM_UPSTREAM_BASE = "v7.5.9"

export interface ContextExport {
  id: string
  bytes: Uint8Array
  digest: string
  frameCount: number
  filename: string
}

async function allActivity(store: ConversationMemoryStore, sessionID: string) {
  const result: ActivityRecord[] = []
  let before: number | undefined
  while (true) {
    const page = await store.listActivity(sessionID, { ...(before === undefined ? {} : { before }), limit: 101 })
    result.push(...page)
    if (page.length < 101) return result
    before = page.at(-1)!.sequence
  }
}

function markdownFrame(frame: ContextFrame) {
  const ratio = frame.pressureAfter ?? frame.pressureBefore
  return [
    `## ${frame.reason} — ${new Date(frame.createdAt).toISOString()}`,
    "",
    `- Frame: \`${frame.id}\``,
    `- Request: ${frame.requestID ? `\`${frame.requestID}\`` : "not recorded"}`,
    `- Revision: ${frame.revisionID ? `\`${frame.revisionID}\`` : "raw context"}`,
    `- Pressure: ${ratio === undefined ? "unknown" : `${Math.round(ratio * 100)}%`}`,
    `- Raw input tokens: ${frame.rawTokens}`,
    `- Summary tokens: ${frame.summaryTokens}`,
    "",
    "### Model input before projection",
    "",
    "```json",
    JSON.stringify(frame.pre, null, 2),
    "```",
    "",
    "### Model input after projection",
    "",
    "```json",
    JSON.stringify(frame.post, null, 2),
    "```",
  ].join("\n")
}

function markdown(input: {
  sessionID: string
  frames: ContextFrame[]
  summaries: SummaryNode[]
  attempts: SummaryAttempt[]
  activity: ActivityRecord[]
}) {
  return [
    "# Conversation context export",
    "",
    `Session: \`${input.sessionID}\``,
    "",
    "This diagnostic contains normalized model inputs. Executable tool functions, request headers, credentials,",
    "provider wire metadata, and inline binary bytes are intentionally excluded.",
    "",
    "Warning: model-visible conversation content is intentionally preserved and may contain sensitive information.",
    "",
    "## Memory activity",
    "",
    input.activity.length === 0
      ? "No Conversation Memory activity was recorded."
      : input.activity
          .map((item) => `- ${new Date(item.createdAt).toISOString()} — ${item.kind}: ${item.message}`)
          .join("\n"),
    "",
    "## Summary attempts",
    "",
    input.attempts.length === 0
      ? "No summary model attempts were recorded."
      : input.attempts
          .map(
            (item) =>
              `- ${new Date(item.createdAt).toISOString()} — ${item.mode} on \`${item.nodeKey}\`: ${item.errorCode ?? item.finish ?? "completed"}; ${item.inputTokens} input / ${item.outputTokens} output / ${item.reasoningTokens} reasoning tokens; ${item.durationMs} ms`,
          )
          .join("\n"),
    "",
    "## Retained summary nodes",
    "",
    input.summaries.length === 0
      ? "No summary nodes were active at export time."
      : input.summaries
          .map(
            (item) =>
              `### ${item.id}\n\nSources ${item.firstOrdinal}-${item.lastOrdinal}; level ${item.level}.\n\n${item.text}`,
          )
          .join("\n\n"),
    "",
    "# Context frames",
    "",
    ...input.frames.map(markdownFrame),
    "",
  ].join("\n")
}

export async function createContextExport(input: {
  sessionID: string
  store: ConversationMemoryStore
}): Promise<ContextExport> {
  const [state, frames, summaries, attempts, activity] = await Promise.all([
    input.store.inspect(input.sessionID),
    input.store.listFrames(input.sessionID),
    input.store.listSummaries(input.sessionID),
    input.store.listAttempts(input.sessionID),
    allActivity(input.store, input.sessionID),
  ])
  const active = frames.filter((frame) => frame.active)
  const interventions = frames.filter((frame) => frame.reason !== "latest")
  const selected = [...new Map([...interventions, ...active].map((frame) => [frame.id, frame])).values()].toSorted(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
  const [sources, summaryEntries, revisions] = await Promise.all([
    input.store.listSources(input.sessionID),
    Promise.all(
      summaries.map(async (summary) => ({
        summary,
        children: await input.store.listChildren(input.sessionID, summary.id),
      })),
    ),
    Promise.all(
      [...new Set(selected.flatMap((frame) => (frame.revisionID === undefined ? [] : [frame.revisionID])))].map(
        (revisionID) => input.store.getRevision(input.sessionID, revisionID),
      ),
    ).then((items) => items.filter((item): item is FrontierRevision => item !== undefined)),
  ])
  const createdAt = Date.now()
  const product = {
    name: "Kilo Code LCM",
    version: InstallationVersion,
    upstreamBase: LCM_UPSTREAM_BASE,
    implementationVersion: LCM_IMPLEMENTATION_VERSION,
  }
  const context = {
    formatVersion: CONTEXT_EXPORT_VERSION,
    product,
    sessionID: input.sessionID,
    createdAt,
    exclusions: ["binary-bytes", "credentials", "executable-tool-functions", "headers", "provider-wire-metadata"],
    frames: selected,
    revisions,
    sources,
    summaries: summaryEntries,
    attempts,
    activity: activity.toReversed(),
    health: {
      status: state.health,
      issue: state.issue,
    },
  }
  const json = `${JSON.stringify(context, null, 2)}\n`
  const md = markdown({
    sessionID: input.sessionID,
    frames: selected,
    summaries,
    attempts,
    activity: activity.toReversed(),
  })
  const manifest = {
    formatVersion: CONTEXT_EXPORT_VERSION,
    product,
    sessionID: input.sessionID,
    createdAt,
    frameCount: selected.length,
    frameIndex: selected.map((frame) => ({
      id: frame.id,
      active: frame.active,
      reason: frame.reason,
      lineageDigest: frame.lineageDigest,
      requestID: frame.requestID,
      revisionID: frame.revisionID,
      createdAt: frame.createdAt,
    })),
    revisionIDs: revisions.map((revision) => revision.id),
    sourceCount: sources.length,
    summaryCount: summaryEntries.length,
    attemptCount: attempts.length,
    exclusions: context.exclusions,
    files: {
      "context.json": { sha256: sha256(json), bytes: Buffer.byteLength(json) },
      "context.md": { sha256: sha256(md), bytes: Buffer.byteLength(md) },
    },
  }
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add("context.json", new TextReader(json))
  await writer.add("context.md", new TextReader(md))
  await writer.add("manifest.json", new TextReader(`${JSON.stringify(manifest, null, 2)}\n`))
  const bytes = await writer.close()
  const id = sortableID("export")
  return {
    id,
    bytes,
    digest: sha256(bytes),
    frameCount: selected.length,
    filename: `kilo-context-${input.sessionID}-${id}.zip`,
  }
}
