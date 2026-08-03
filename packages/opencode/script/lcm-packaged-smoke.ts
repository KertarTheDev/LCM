#!/usr/bin/env bun
// kilocode_change - new file

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

function digest(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(bytes)
  return hash.digest("hex")
}

async function run(binary: string, args: string[], root: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn([binary, ...args], {
    cwd: root,
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
      KILO_DISABLE_MODELS_FETCH: "1",
      KILO_DISABLE_PROJECT_CONFIG: "1",
      KILO_DISABLE_AUTOUPDATE: "1",
      KILO_PURE: "1",
      KILO_AUTH_CONTENT: "{}",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(30_000),
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`Packaged CLI failed (${args.join(" ")}): ${stderr || stdout}`)
  return { stdout, stderr }
}

function providerConfig(conversationMemory: boolean) {
  return {
    model: "test/test-model",
    formatter: false,
    lsp: false,
    experimental: { conversation_memory: conversationMemory },
    provider: {
      test: {
        name: "Packaged smoke",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Packaged smoke model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "packaged-smoke", baseURL: "http://127.0.0.1:1/v1" },
      },
    },
  }
}

const cliOption = option("cli") ?? process.env.LCM_PACKAGED_CLI
const vsixOption = option("vsix") ?? process.env.LCM_PACKAGED_VSIX
if (!cliOption && !vsixOption) {
  throw new Error(
    "Provide --cli <packaged binary> or --vsix <snapshot.vsix>. This gate intentionally refuses source-tree smoke.",
  )
}

const temporary = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "lcm-packaged-smoke-"))
try {
  let binary = cliOption ? path.resolve(cliOption) : undefined
  let vsixDigest: string | undefined
  if (vsixOption) {
    const vsix = new Uint8Array(await Bun.file(path.resolve(vsixOption)).arrayBuffer())
    vsixDigest = digest(vsix)
    const zip = new ZipReader(new Uint8ArrayReader(vsix))
    const entries = await zip.getEntries()
    const forbidden = entries
      .map((entry) => entry.filename)
      .filter((name) => /pglite|lcm[_-](?:map|settings|maintain|doctor)/i.test(name))
    if (forbidden.length > 0) throw new Error(`Retired LCM assets are packaged: ${forbidden.join(", ")}`)
    if (!entries.some((entry) => entry.filename === "extension/dist/extension.js")) {
      throw new Error("VSIX does not contain the production extension bundle")
    }
    if (!binary) {
      const name = process.platform === "win32" ? "extension/bin/kilo.exe" : "extension/bin/kilo"
      const entry = entries.find((item) => item.filename === name)
      if (!entry?.getData) throw new Error(`VSIX does not contain ${name}`)
      const bytes = await entry.getData(new Uint8ArrayWriter())
      binary = path.join(temporary, process.platform === "win32" ? "kilo.exe" : "kilo")
      await writeFile(binary, bytes, { mode: 0o700 })
      await chmod(binary, 0o700)
    }
    await zip.close()
  }

  if (!binary) throw new Error("No packaged CLI was resolved")
  const version = (await run(binary, ["--version"], temporary)).stdout.trim()
  const helpResult = await run(binary, ["lcm", "--help"], temporary)
  const help = helpResult.stdout + helpResult.stderr
  for (const command of ["status", "timeline", "export"]) {
    if (!help.includes(command)) throw new Error(`Packaged CLI help is missing the LCM ${command} command`)
  }
  const lcmTools = ["lcm_grep", "lcm_describe", "lcm_expand_query", "lcm_expand", "lcm_read"]
  const agents = ["ask", "plan", "explore", "orchestrator"]
  const enabledConfig = JSON.stringify(providerConfig(true))
  for (const agent of agents) {
    const output = await run(binary, ["debug", "agent", agent], temporary, { KILO_CONFIG_CONTENT: enabledConfig })
    const parsed = JSON.parse(output.stdout) as { tools?: Record<string, boolean> }
    for (const tool of lcmTools) {
      if (parsed.tools?.[tool] !== true) throw new Error(`Packaged ${agent} agent does not expose ${tool}`)
    }
  }
  const disabled = await run(binary, ["debug", "agent", "ask"], temporary, {
    KILO_CONFIG_CONTENT: JSON.stringify(providerConfig(false)),
  })
  const disabledTools = (JSON.parse(disabled.stdout) as { tools?: Record<string, boolean> }).tools ?? {}
  for (const tool of lcmTools) {
    if (tool in disabledTools) throw new Error(`Packaged disabled agent still exposes ${tool}`)
  }
  const cliBytes = new Uint8Array(await Bun.file(binary).arrayBuffer())
  console.log(
    JSON.stringify(
      {
        version,
        cliSha256: digest(cliBytes),
        ...(vsixDigest ? { vsixSha256: vsixDigest } : {}),
        lcmCommands: ["status", "timeline", "export"],
        lcmTools,
        verifiedAgents: agents,
        disabledToolsHidden: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
