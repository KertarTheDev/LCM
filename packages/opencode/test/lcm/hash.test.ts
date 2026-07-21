// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { namespacedHash, sha256Hex, stableHash } from "../../src/session/lcm/hash"

describe("LCM hash helpers", () => {
  test("uses normal SHA-256 for raw string or byte input", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex("abc"))
  })

  test("stable hashes canonical JSON independent of object key order", () => {
    expect(stableHash({ b: 1, a: [2, "x"] })).toBe(stableHash({ a: [2, "x"], b: 1 }))
    expect(stableHash({ a: [2, "x"], b: 1 })).not.toBe(stableHash({ a: [2, "y"], b: 1 }))
  })

  test("namespaced hashes include the namespace and domain-separate equal values", () => {
    const first = namespacedHash("lcm-hash-test-a", { value: "same" })
    const second = namespacedHash("lcm-hash-test-b", { value: "same" })

    expect(first.startsWith("lcm-hash-test-a:")).toBe(true)
    expect(second.startsWith("lcm-hash-test-b:")).toBe(true)
    expect(first).not.toBe(second)
  })
})
