import { createHash } from "node:crypto"
import { ulid } from "ulid"
import type { FinalSource, SummaryChild } from "./types"

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function stable(prefix: string, value: string) {
  return `${prefix}_${sha256(value).slice(0, 24)}`
}

export function sourceID(input: {
  sessionID: string
  messageID: string
  partID: string
  kind: string
  digest: string
}) {
  return stable("src", [input.sessionID, input.messageID, input.partID, input.kind, input.digest].join("\u0000"))
}

export function nodeKey(children: Array<Pick<SummaryChild, "kind" | "id">>, sourceDigest: string, policy: string) {
  return stable(
    "node",
    JSON.stringify({
      children: children.map((child) => [child.kind, child.id]),
      sourceDigest,
      policy,
    }),
  )
}

export function summaryID(input: { nodeKey: string; text: string }) {
  return stable("sum", `${input.nodeKey}\u0000${sha256(input.text)}`)
}

export function lineageDigest(sources: Array<Pick<FinalSource, "id" | "digest" | "ordinal">>) {
  return sha256(JSON.stringify(sources.map((source) => [source.ordinal, source.id, source.digest])))
}

export function sortableID(prefix: "rev" | "frame" | "activity" | "attempt" | "export" | "lease" | "boundary") {
  return `${prefix}_${ulid()}`
}
