import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { sha256 } from "./ids"

const secret = randomBytes(32)

interface Cursor {
  version: 1
  query: string
  offset: number
}

function signature(payload: string) {
  return createHmac("sha256", secret).update(payload).digest()
}

export function encodeCursor(query: unknown, offset: number) {
  const value: Cursor = { version: 1, query: sha256(JSON.stringify(query)), offset }
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${payload}.${signature(payload).toString("base64url")}`
}

export function decodeCursor(query: unknown, cursor?: string) {
  if (!cursor) return 0
  const parts = cursor.split(".")
  if (parts.length !== 2) throw new Error("lcm_invalid_cursor")
  const [payload, encoded] = parts
  if (!payload || !encoded) throw new Error("lcm_invalid_cursor")
  const payloadBytes = Buffer.from(payload, "base64url")
  const expected = signature(payload)
  const actual = Buffer.from(encoded, "base64url")
  if (
    payloadBytes.toString("base64url") !== payload ||
    actual.toString("base64url") !== encoded ||
    expected.byteLength !== actual.byteLength ||
    !timingSafeEqual(expected, actual)
  )
    throw new Error("lcm_invalid_cursor")
  const value = JSON.parse(payloadBytes.toString("utf8")) as Cursor
  if (value.version !== 1 || value.query !== sha256(JSON.stringify(query)) || !Number.isSafeInteger(value.offset))
    throw new Error("lcm_invalid_cursor")
  if (value.offset < 0) throw new Error("lcm_invalid_cursor")
  return value.offset
}
