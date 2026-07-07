// kilocode_change - new file
import { createHash } from "node:crypto"
import { canonicalJson } from "./validators"

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

export function stableHash(value: unknown) {
  return sha256Hex(canonicalJson(value))
}

export function namespacedHash(namespace: string, value: unknown) {
  return `${namespace}:${stableHash({ namespace, value })}`
}
