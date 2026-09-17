#!/usr/bin/env bun
// kilocode_change - new file

import path from "node:path"
import { existsSync } from "node:fs"

const root = path.resolve(import.meta.dir, "../../..")
const specs = path.join(root, "specifications")
const required = [
  "README.md",
  "product-contract.md",
  "architecture-and-lifecycle.md",
  "storage-and-rebuild.md",
  "context-tree.md",
  "memory-tools.md",
  "api-ui-and-export.md",
  "verification-and-upstream-compatibility.md",
  "release-support.md",
]

const fail = (message: string): never => {
  throw new Error(`LCM documentation drift: ${message}`)
}

for (const filename of required) {
  const target = path.join(specs, filename)
  if (!(await Bun.file(target).exists())) fail(`missing specifications/${filename}`)
  const text = await Bun.file(target).text()
  if (!/^Status: (?:normative|current)/m.test(text)) fail(`${filename} has no current authority status`)
  if (/\bupward\b|\bdolt\b|legacy compaction (?:is|as|remains).{0,30}(?:hard )?fallback/i.test(text)) {
    fail(`${filename} contains a retired target claim`)
  }
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1]!
    if (/^(?:https?:|#)/.test(href)) continue
    const resolved = path.resolve(path.dirname(target), href.split("#", 1)[0]!)
    if (!existsSync(resolved)) fail(`${filename} links to missing ${href}`)
  }
}

const authority = await Promise.all(required.map((filename) => Bun.file(path.join(specs, filename)).text()))
const contract = authority.join("\n")
for (const requiredClaim of [
  "conversation_memory.soft_threshold_percent",
  "conversation_memory.recovery.max_queries_per_turn",
  "conversation_memory.recovery.max_research_steps",
  "conversation_memory.recovery.max_tool_calls",
  "conversation_memory.recovery.max_semantic_inferences",
  "conversation_memory.recovery.max_repair_attempts",
  "conversation_memory.recovery.research_timeout_seconds",
  "conversation_memory.recovery.finalizer_timeout_seconds",
  "conversation_memory.recovery.cleanup_timeout_seconds",
  "newest-first",
  "lcm_hard_limit_unresolved",
  "lcm_query",
  "prior-turn",
  "manual",
  "60%",
]) {
  if (!contract.includes(requiredClaim)) fail(`current authority omits ${requiredClaim}`)
}

const fixture = path.join(specs, "fixtures/binding-state.json")
if (!(await Bun.file(fixture).exists())) fail("missing binding-state fixture")
const parsed = (await Bun.file(fixture).json()) as { entries?: unknown[]; bindings?: unknown[] }
if (!Array.isArray(parsed.entries) || parsed.entries.length < 12) fail("binding-state fixture is not a long session")
if (!Array.isArray(parsed.bindings) || parsed.bindings.length < 8) fail("binding-state fixture lacks binding facts")

console.log("LCM specifications have one current authority set with valid links and fixtures.")
