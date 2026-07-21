// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { checkContract, writeContract, type LcmApiContractArtifact } from "../../script/lcm-contracts"
import { tmpdir } from "../fixture/fixture"

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

test("generated LCM API contract artifact checks cleanly", async () => {
  await using tmp = await tmpdir()
  const artifact = path.join(tmp.path, "lcm-api-contract.generated.json")

  await writeContract({ artifactPath: artifact })
  const result = await checkContract({ artifactPath: artifact })

  expect(result.ok).toBe(true)
  expect(result.diagnostics).toEqual([])
})

test("committed LCM API contract artifact checks cleanly", async () => {
  const result = await checkContract()

  expect(result.ok).toBe(true)
  expect(result.diagnostics).toEqual([])
})

test("contract checker rejects representative fake drift without a provider", async () => {
  await using tmp = await tmpdir()
  const artifactPath = path.join(tmp.path, "lcm-api-contract.generated.json")
  const baseline = await writeContract({ artifactPath })

  const cases: Array<{
    name: string
    mutate: (artifact: LcmApiContractArtifact) => void
    pathIncludes: string
  }> = [
    {
      name: "public DTO field removal",
      mutate: (artifact) => {
        delete artifact.declarations.interfaces.LcmCapabilities.fields.sessionID
      },
      pathIncludes: "declarations.interfaces.LcmCapabilities.fields.sessionID",
    },
    {
      name: "required field becomes optional",
      mutate: (artifact) => {
        artifact.declarations.interfaces.LcmCapabilities.fields.sessionID.optional = true
      },
      pathIncludes: "declarations.interfaces.LcmCapabilities.fields.sessionID.optional",
    },
    {
      name: "enum literal changes",
      mutate: (artifact) => {
        artifact.declarations.types.LcmStrategy.literals[0] = "sideways"
      },
      pathIncludes: "declarations.types.LcmStrategy.literals",
    },
    {
      name: "route name changes",
      mutate: (artifact) => {
        artifact.routes[0].path = `${artifact.routes[0].path}/drift`
      },
      pathIncludes: "routes",
    },
    {
      name: "webview message name changes",
      mutate: (artifact) => {
        artifact.webviewMessageNames[0] = "requestDifferentMemorySettings"
      },
      pathIncludes: "webviewMessageNames",
    },
    {
      name: "safe-message template changes",
      mutate: (artifact) => {
        artifact.safeMessageTemplates["lcm.db.unavailable"].safeMessage = "Memory is unavailable."
      },
      pathIncludes: "safeMessageTemplates.lcm.db.unavailable.safeMessage",
    },
    {
      name: "canonical tool description changes",
      mutate: (artifact) => {
        artifact.toolDescriptions.lcm_grep = "Search memory."
      },
      pathIncludes: "toolDescriptions.lcm_grep",
    },
  ]

  for (const item of cases) {
    const artifact = structuredClone(baseline)
    item.mutate(artifact)
    await writeJson(artifactPath, artifact)

    const result = await checkContract({ artifactPath })
    expect(result.ok, item.name).toBe(false)
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.path.includes(item.pathIncludes)),
      `${item.name}: ${result.diagnostics.map((diagnostic) => diagnostic.path).join(", ")}`,
    ).toBe(true)
  }
})
