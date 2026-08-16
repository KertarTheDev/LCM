#!/usr/bin/env bun
// kilocode_change - new file

import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const read = (relative: string) => Bun.file(path.join(root, relative)).text()
const fail = (message: string): never => {
  throw new Error(`LCM contract drift: ${message}`)
}

const openapi = (await Bun.file(path.join(root, "packages/sdk/openapi.json")).json()) as {
  paths?: Record<string, Record<string, unknown>>
}
const routes = {
  "/session/{sessionID}/lcm/status": "get",
  "/session/{sessionID}/lcm/activity": "get",
  "/session/{sessionID}/lcm/context/export": "post",
} as const
for (const [route, method] of Object.entries(routes)) {
  if (!openapi.paths?.[route]?.[method]) fail(`OpenAPI is missing ${method.toUpperCase()} ${route}`)
}
for (const retired of ["/session/{sessionID}/lcm/export", "/lcm/export"]) {
  if (openapi.paths?.[retired]) fail(`retired route remains generated: ${retired}`)
}

const sdk = await read("packages/sdk/js/src/v2/gen/sdk.gen.ts")
const generatedTypes = await read("packages/sdk/js/src/v2/gen/types.gen.ts")
for (const route of Object.keys(routes)) {
  if (!sdk.includes(route) || !generatedTypes.includes(route)) fail(`generated SDK is missing ${route}`)
}
for (const event of ["session.lcm.status", "session.lcm.activity"]) {
  if (!generatedTypes.includes(event)) fail(`generated SDK is missing ${event}`)
}

const registry = await read("packages/opencode/src/tool/registry.ts")
const kiloRegistry = await read("packages/opencode/src/kilocode/tool/registry.ts")
const lcmRegistry = await read("packages/opencode/src/kilocode/tool/lcm-registry.ts")
const toolFiles = {
  lcm_grep: "lcm-grep.ts",
  lcm_describe: "lcm-describe.ts",
  lcm_expand_query: "lcm-expand-query.ts",
  lcm_expand: "lcm-expand.ts",
  lcm_read: "lcm-read.ts",
} as const
const lcmImports = [...lcmRegistry.matchAll(/import \{ (Lcm\w+Tool) \} from "\.\/lcm-/g)].map(
  (match) => match[1],
)
if (lcmImports.length !== Object.keys(toolFiles).length) {
  fail(`LCM tool bundle has ${lcmImports.length} tool imports instead of exactly five`)
}
for (const [name, filename] of Object.entries(toolFiles)) {
  const source = await read(`packages/opencode/src/kilocode/tool/${filename}`)
  if (!source.includes(`"${name}"`)) fail(`${filename} does not define ${name}`)
}
for (const symbol of ["LcmGrepTool", "LcmDescribeTool", "LcmExpandQueryTool", "LcmExpandTool", "LcmReadTool"]) {
  if (!lcmRegistry.includes(symbol)) fail(`${symbol} is not registered through the LCM tool bundle`)
}
if (!kiloRegistry.includes('import * as LcmToolRegistry from "./lcm-registry"')) {
  fail("Kilo tool registry does not import the LCM tool bundle")
}
if (!kiloRegistry.includes("...LcmToolRegistry.extra(tools.lcm ?? [], cfg)")) {
  fail("Kilo tool registry does not append the configured LCM tools")
}
if (registry.includes("LcmToolRegistry")) {
  fail("shared upstream tool registry directly owns the LCM tool bundle")
}

const common = await read("packages/opencode/src/kilocode/tool/lcm-common.ts")
for (const code of [
  "lcm_not_found",
  "lcm_stale_lineage",
  "lcm_invalid_cursor",
  "lcm_invalid_regex",
  "lcm_cancelled",
  "lcm_unavailable",
]) {
  if (!common.includes(`"${code}"`)) fail(`safe error ${code} is missing`)
}

console.log("LCM public contracts match routes, generated SDK, tools, events, and safe errors.")
