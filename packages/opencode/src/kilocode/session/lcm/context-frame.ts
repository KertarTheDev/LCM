import { sha256 } from "./ids"
import type { NormalizedModelInput } from "./types"

function binary(value: string | Uint8Array, mediaType?: string) {
  const data =
    typeof value === "string"
      ? Buffer.from(value.slice(value.indexOf(",") + 1), value.includes(";base64,") ? "base64" : "utf8")
      : Buffer.from(value)
  return {
    type: "excluded-binary",
    mediaType: mediaType ?? "application/octet-stream",
    bytes: data.byteLength,
    digest: sha256(data),
  }
}

function normalize(value: unknown, parentType?: string, mediaType?: string): unknown {
  if (value instanceof Uint8Array) return binary(value, mediaType)
  if (Array.isArray(value)) return value.map((item) => normalize(item, parentType, mediaType))
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : parentType
  const mime =
    typeof record.mediaType === "string"
      ? record.mediaType
      : typeof record.mime === "string"
        ? record.mime
        : mediaType
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, item]) => typeof item !== "function" && key !== "execute")
      .map(([key, item]) => {
        if (
          ["file", "image", "media"].includes(type ?? "") &&
          ["data", "image", "url"].includes(key) &&
          ((typeof item === "string" && item.startsWith("data:")) || item instanceof Uint8Array)
        ) {
          return [key, binary(item, mime)]
        }
        return [key, normalize(item, type, mime)]
      }),
  )
}

export function normalizeModelInput(input: {
  system: string[]
  messages: unknown[]
  tools: Record<string, unknown>
}): NormalizedModelInput {
  const tools = Object.fromEntries(
    Object.entries(input.tools).map(([name, value]) => {
      if (!value || typeof value !== "object") return [name, normalize(value)]
      const tool = value as Record<string, unknown>
      return [
        name,
        normalize({
          description: tool.description,
          inputSchema: tool.inputSchema ?? tool.parameters,
        }),
      ]
    }),
  )
  return {
    system: [...input.system],
    messages: normalize(input.messages) as unknown[],
    tools,
  }
}
