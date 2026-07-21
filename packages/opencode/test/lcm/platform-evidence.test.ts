// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION,
  REQUIRED_PLATFORM_EVIDENCE_TARGETS,
  validatePlatformPackagedRuntimeEvidence,
  type LcmPlatformPackagedRuntimeSmokeEvidence,
} from "../../script/lcm-platform-evidence"

const tempDirs: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lcm-platform-evidence-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

function evidence(
  target: (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number],
  snapshotSha256 = "candidate-sha",
): LcmPlatformPackagedRuntimeSmokeEvidence {
  return {
    schemaVersion: LCM_PLATFORM_EVIDENCE_SCHEMA_VERSION,
    target,
    generatedAt: "2026-05-27T00:00:00.000Z",
    os: {
      platform: target === "windows" ? "win32" : "darwin",
      arch: target === "darwin-x64" ? "x64" : "arm64",
      type: target === "windows" ? "Windows_NT" : "Darwin",
      release: "release-test",
    },
    artifact: {
      runtimePath: `/artifacts/${target}/kilo`,
      runtimeSha256: `runtime-${target}`,
      snapshotPath: "/artifacts/kilo.vsix",
      snapshotSha256,
      gitHead: "abcdef",
    },
    runtimeSmoke: {
      command: `/artifacts/${target}/kilo debug lcm-db-smoke --data-dir /tmp/lcm-${target} --runtime-mode vscode-bundled --json`,
      code: 0,
      runtimeMode: "vscode-bundled",
      dataDir: `/tmp/lcm-${target}`,
      status: "passed",
      stderrTail: "",
      report: { status: "passed", runtimeMode: "vscode-bundled", checks: [] },
    },
  }
}

async function writeEvidence(
  dir: string,
  target: (typeof REQUIRED_PLATFORM_EVIDENCE_TARGETS)[number],
  payload: unknown,
) {
  await Bun.write(path.join(dir, `platform-packaged-runtime-smoke-${target}.json`), JSON.stringify(payload, null, 2))
}

describe("platform packaged-runtime release evidence", () => {
  test("does not accept filename-only evidence", async () => {
    const dir = await tempDir()
    for (const target of REQUIRED_PLATFORM_EVIDENCE_TARGETS) {
      await Bun.write(path.join(dir, `platform-packaged-runtime-smoke-${target}.json`), "{}")
    }

    const result = await validatePlatformPackagedRuntimeEvidence({
      evidenceDir: dir,
      expectedSnapshotSha256: "candidate-sha",
    })

    expect(result.status).toBe("failed")
    expect(result.actual).toContain("schemaVersion")
    expect(result.missingTargets).toEqual([...REQUIRED_PLATFORM_EVIDENCE_TARGETS])
  })

  test("requires all platform targets to pass the candidate VSIX smoke", async () => {
    const dir = await tempDir()
    for (const target of REQUIRED_PLATFORM_EVIDENCE_TARGETS) {
      await writeEvidence(dir, target, evidence(target))
    }

    const result = await validatePlatformPackagedRuntimeEvidence({
      evidenceDir: dir,
      expectedSnapshotSha256: "candidate-sha",
    })

    expect(result.status).toBe("passed")
    expect(result.missingTargets).toEqual([])
    expect(result.evidenceFiles).toHaveLength(3)
  })

  test("rejects platform evidence from a different VSIX", async () => {
    const dir = await tempDir()
    for (const target of REQUIRED_PLATFORM_EVIDENCE_TARGETS) {
      await writeEvidence(dir, target, evidence(target, target === "windows" ? "old-sha" : "candidate-sha"))
    }

    const result = await validatePlatformPackagedRuntimeEvidence({
      evidenceDir: dir,
      expectedSnapshotSha256: "candidate-sha",
    })

    expect(result.status).toBe("failed")
    expect(result.actual).toContain("snapshotSha256 does not match")
    expect(result.missingTargets).toEqual(["windows"])
  })

  test("rejects target labels that do not match the recorded OS", async () => {
    const dir = await tempDir()
    for (const target of REQUIRED_PLATFORM_EVIDENCE_TARGETS) {
      const payload = evidence(target)
      await writeEvidence(
        dir,
        target,
        target === "darwin-arm64"
          ? {
              ...payload,
              os: { ...payload.os, platform: "linux", arch: "x64" },
            }
          : payload,
      )
    }

    const result = await validatePlatformPackagedRuntimeEvidence({
      evidenceDir: dir,
      expectedSnapshotSha256: "candidate-sha",
    })

    expect(result.status).toBe("failed")
    expect(result.actual).toContain("darwin-arm64 evidence must come from darwin arm64")
    expect(result.missingTargets).toEqual(["darwin-arm64"])
  })

  test("blocks when a required target is missing", async () => {
    const dir = await tempDir()
    await writeEvidence(dir, "windows", evidence("windows"))
    await writeEvidence(dir, "darwin-arm64", evidence("darwin-arm64"))

    const result = await validatePlatformPackagedRuntimeEvidence({
      evidenceDir: dir,
      expectedSnapshotSha256: "candidate-sha",
    })

    expect(result.status).toBe("blocked")
    expect(result.missingTargets).toEqual(["darwin-x64"])
  })
})
