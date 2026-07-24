// kilocode_change - new file

import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  ACTIONLINT_VERSION,
  actionlintAsset,
  downloadActionlintArchive,
  ensureActionlint,
  runActionlint,
  verifyActionlintVersion,
  verifySha256,
  workflowDrift,
} from "./check-workflows"

const tempRoots: string[] = []

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
})

describe("workflow allowlist", () => {
  test("accepts an exact list and rejects additions and removals", () => {
    expect(workflowDrift(["a.yml"], ["a.yml"])).toEqual([])
    expect(workflowDrift(["a.yml"], ["a.yml", "b.yml"])).toEqual([
      "unexpected workflow: b.yml — if this was added intentionally, add it to script/check-workflows.ts",
    ])
    expect(workflowDrift(["a.yml", "b.yml"], ["a.yml"])).toEqual([
      "expected workflow not found: b.yml — if this was removed intentionally, remove it from script/check-workflows.ts",
    ])
  })
})

describe("pinned actionlint distribution", () => {
  test("selects every supported platform archive", () => {
    expect(actionlintAsset("linux", "x64").archive).toBe("actionlint_1.7.12_linux_amd64.tar.gz")
    expect(actionlintAsset("linux", "arm64").archive).toBe("actionlint_1.7.12_linux_arm64.tar.gz")
    expect(actionlintAsset("darwin", "x64").archive).toBe("actionlint_1.7.12_darwin_amd64.tar.gz")
    expect(actionlintAsset("darwin", "arm64").archive).toBe("actionlint_1.7.12_darwin_arm64.tar.gz")
    expect(actionlintAsset("win32", "x64").archive).toBe("actionlint_1.7.12_windows_amd64.zip")
    expect(actionlintAsset("win32", "arm64").archive).toBe("actionlint_1.7.12_windows_arm64.zip")
    expect(() => actionlintAsset("freebsd", "x64")).toThrow("does not support freebsd/x64")
  })

  test("rejects a checksum mismatch", () => {
    expect(() => verifySha256(new TextEncoder().encode("archive"), "0".repeat(64))).toThrow("checksum mismatch")
  })

  test("rejects a wrong binary version", async () => {
    await expect(
      verifyActionlintVersion("actionlint", async () => ({
        exitCode: 0,
        stdout: "1.7.11\n",
        stderr: "",
      })),
    ).rejects.toThrow(`actionlint ${ACTIONLINT_VERSION} is required`)
  })

  test("fails closed when the archive cannot be downloaded", async () => {
    const asset = actionlintAsset("linux", "x64")
    await expect(
      downloadActionlintArchive(asset, async () => new Response("unavailable", { status: 503 }), 1),
    ).rejects.toThrow("failed to download verified actionlint")
  })
})

test("actionlint accepts a valid workflow and rejects duplicate mapping keys", async () => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "check-workflows-test-"))
  tempRoots.push(root)
  const workflowDir = path.join(root, ".github", "workflows")
  await mkdir(workflowDir, { recursive: true })
  const valid = path.join(workflowDir, "valid.yml")
  const duplicate = path.join(workflowDir, "duplicate.yml")
  await writeFile(
    valid,
    `name: Valid
on:
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ok
`,
  )
  await writeFile(
    duplicate,
    `name: Duplicate
on:
  workflow_dispatch:
jobs:
  check:
    if: always()
    runs-on: ubuntu-24.04
    if: success()
    steps:
      - run: echo broken
`,
  )

  const binary = await ensureActionlint()
  await expect(runActionlint(binary, [path.relative(root, valid)], root)).resolves.toBeUndefined()
  await expect(runActionlint(binary, [path.relative(root, duplicate)], root)).rejects.toThrow(/key "if" is duplicated/)
})
