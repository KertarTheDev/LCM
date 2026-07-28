// kilocode_change - new file
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  GitHubApiError,
  LCM_PRERELEASE_ASSETS,
  assetUploadUrl,
  cleanup,
  nextVersion,
  nextPrereleaseVersion,
  publishRelease,
  resolveTagCommitSha,
  validateAssetManifest,
  validatePrereleaseOverlayPaths,
  verifyPrereleaseOverlay,
  waitForTagCommitSha,
} from "./lcm-prerelease-release.mjs"

const sha = "a".repeat(40)
const other = "b".repeat(40)
const tag = "v7.4.16-lcm.1"

function options(overrides = {}) {
  return {
    command: "publish",
    repo: "owner/repo",
    releaseId: "42",
    tag,
    sha,
    title: "LCM alpha 7.4.16-lcm.1",
    profile: "lcm-prerelease",
    ...overrides,
  }
}

function release(overrides = {}) {
  return {
    id: 42,
    tag_name: tag,
    target_commitish: sha,
    draft: true,
    prerelease: true,
    upload_url: "https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}",
    ...overrides,
  }
}

function assets() {
  return LCM_PRERELEASE_ASSETS.map((name, index) => ({ name, size: index + 1 }))
}

test("a free upstream base starts again at lcm.1", () => {
  assert.deepEqual(nextPrereleaseVersion("7.4.16", [], []), {
    base: "7.4.16",
    version: "7.4.16-lcm.1",
    tag: "v7.4.16-lcm.1",
  })
})

test("a published lcm.1 advances to lcm.2", () => {
  assert.deepEqual(nextPrereleaseVersion("7.4.16", [release()], []), {
    base: "7.4.16",
    version: "7.4.16-lcm.2",
    tag: "v7.4.16-lcm.2",
  })
})

test("next prerelease suffix counts releases, drafts, and tags", () => {
  const value = nextPrereleaseVersion(
    "7.4.16",
    [release(), release({ tag_name: "v7.4.16-lcm.3", draft: true })],
    [{ ref: "refs/tags/v7.4.16-lcm.2" }, { ref: "refs/tags/v7.4.15-lcm.99" }],
  )
  assert.deepEqual(value, { base: "7.4.16", version: "7.4.16-lcm.4", tag: "v7.4.16-lcm.4" })
})

test("nextVersion refuses a second release for one workflow SHA", async () => {
  await assert.rejects(
    nextVersion(options({ command: "next-version", base: "7.4.16" }), {
      request: async (apiPath) => {
        if (apiPath === "/releases?per_page=100&page=1") return [release()]
        throw new Error(`Unexpected request ${apiPath}`)
      },
    }),
    /already has release/,
  )
})

test("asset manifest requires the exact non-empty 20-asset profile", () => {
  assert.equal(validateAssetManifest(assets()).length, 20)
  assert.throws(() => validateAssetManifest(assets().slice(1)), /missing=/)
  assert.throws(() => validateAssetManifest([...assets(), { name: "unexpected", size: 1 }]), /extra=/)
  assert.throws(
    () => validateAssetManifest(assets().map((asset, index) => (index ? asset : { ...asset, size: 0 }))),
    /empty=/,
  )
})

test("asset upload URL binds the encoded name to the captured URL", () => {
  assert.equal(
    assetUploadUrl(release().upload_url, "kilo linux.tar.gz"),
    "https://uploads.github.com/repos/owner/repo/releases/42/assets?name=kilo%20linux.tar.gz",
  )
})

test("tag resolution peels annotated tags", async () => {
  const value = await resolveTagCommitSha(async (apiPath) => {
    if (apiPath === `/git/ref/tags/${tag}`) return { object: { type: "tag", sha: other } }
    if (apiPath === `/git/tags/${other}`) return { object: { type: "commit", sha } }
    throw new Error(`Unexpected request ${apiPath}`)
  }, tag)
  assert.equal(value, sha)
})

test("tag visibility retries 404 without accepting the wrong SHA", async () => {
  let calls = 0
  assert.equal(
    await waitForTagCommitSha(
      async () => {
        calls++
        if (calls === 1) throw new GitHubApiError(404, "not visible")
        return { object: { type: "commit", sha } }
      },
      tag,
      sha,
      { attempts: 2, sleep: async () => {} },
    ),
    sha,
  )
  assert.equal(calls, 2)
  await assert.rejects(
    waitForTagCommitSha(async () => ({ object: { type: "commit", sha: other } }), tag, sha, {
      attempts: 2,
      sleep: async () => {},
    }),
    /expected/,
  )
})

test("publish validates the captured draft and assets before patching its ID", async () => {
  const calls = []
  const result = await publishRelease(options(), {
    request: async (apiPath, init) => {
      calls.push({ apiPath, init })
      if (apiPath === "/releases/42" && !init) return release()
      if (apiPath === "/releases/42/assets?per_page=100&page=1") return assets()
      if (apiPath === "/releases/42" && init?.method === "PATCH") return release({ draft: false })
      if (apiPath === `/git/ref/tags/${tag}`) return { object: { type: "commit", sha } }
      throw new Error(`Unexpected request ${apiPath}`)
    },
  })
  assert.equal(result.draft, false)
  assert.equal(calls.find((call) => call.init?.method === "PATCH")?.apiPath, "/releases/42")
})

test("cleanup leaves mismatched state intact and accepts an absent release", async () => {
  const calls = []
  assert.deepEqual(
    await cleanup(options({ command: "cleanup" }), {
      request: async (apiPath, init) => {
        calls.push({ apiPath, init })
        return release({ target_commitish: other })
      },
    }),
    { releaseDeleted: false, tagDeleted: false },
  )
  assert.equal(
    calls.some((call) => call.init?.method === "DELETE"),
    false,
  )
  assert.deepEqual(
    await cleanup(options({ command: "cleanup" }), {
      request: async () => {
        throw new GitHubApiError(404, "missing")
      },
    }),
    { releaseDeleted: false, tagDeleted: false },
  )
})

test("overlay allowlist rejects product and translation churn", () => {
  const overlay = [
    ".github/workflows/publish.yml",
    "README.md",
    "RELEASING.md",
    "packages/opencode/script/build.ts",
    "script/lcm-prerelease-release.mjs",
    "script/lcm-prerelease-release.test.mjs",
  ]
  assert.deepEqual(validatePrereleaseOverlayPaths(overlay), overlay)
  assert.throws(() => validatePrereleaseOverlayPaths(["packages/opencode/src/session/prompt.ts"]), /product paths/)
  assert.throws(() => validatePrereleaseOverlayPaths(["translations/README.de.md"]), /product paths/)
  assert.throws(() => validatePrereleaseOverlayPaths([".github/workflows/codeql.yml"]), /product paths/)
})

test("overlay verification requires exact product ancestry", async () => {
  const result = await verifyPrereleaseOverlay(
    { command: "verify-overlay", baseRef: "product", headRef: "candidate" },
    {
      git: async (args) => {
        if (args[0] === "rev-parse") return args[1].startsWith("product") ? sha : other
        if (args[0] === "merge-base") return sha
        if (args[0] === "diff") return ".github/workflows/publish.yml\nscript/lcm-prerelease-release.mjs"
        throw new Error(`Unexpected git command: ${args.join(" ")}`)
      },
    },
  )
  assert.deepEqual(result, {
    baseSha: sha,
    headSha: other,
    files: [".github/workflows/publish.yml", "script/lcm-prerelease-release.mjs"],
  })
  await assert.rejects(
    verifyPrereleaseOverlay(
      { command: "verify-overlay", baseRef: "product", headRef: "candidate" },
      {
        git: async (args) => {
          if (args[0] === "rev-parse") return args[1].startsWith("product") ? sha : other
          if (args[0] === "merge-base") return other
          throw new Error(`Unexpected git command: ${args.join(" ")}`)
        },
      },
    ),
    /is not based on product commit/,
  )
})

test("fork workflow binds release identity and current architecture gates", async () => {
  const workflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")
  const build = await readFile(new URL("../packages/opencode/script/build.ts", import.meta.url), "utf8")
  const start = workflow.indexOf("lcm-prerelease-artifacts:")
  const end = workflow.indexOf("\n  version:", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const fork = workflow.slice(start, end)
  assert.equal(fork.includes("gh release upload"), false)
  assert.equal(fork.includes("gh release edit"), false)
  assert.equal(fork.match(/--asset "\$GITHUB_WORKSPACE\//g)?.length, 20)
  for (const command of [
    "verify-overlay",
    "next-version",
    "create-draft",
    "upload-assets",
    "validate-release",
    "publish",
    "cleanup",
  ]) {
    assert.equal(fork.includes(`lcm-prerelease-release.mjs\" ${command}`), true)
  }
  for (const command of [
    "lcm:store",
    "lcm:tree",
    "lcm:projection",
    "lcm:tools",
    "lcm:api",
    "lcm:export",
    "lcm:upstream-compat",
    "lcm:long-context",
    "lcm:contracts:check",
    "lcm:docs:check",
    "lcm:packaged-smoke",
  ]) {
    assert.equal(fork.includes(command), true)
  }
  for (const retired of ["lcm:map", "lcm:scheduler", "lcm:sub-agent-scope", "pglite"]) {
    assert.equal(fork.toLowerCase().includes(retired), false)
  }
  assert.equal(fork.includes("origin/kilocode-lcm-v${base}"), true)
  assert.equal(fork.includes('KILO_RELEASE_ARCHIVE_ONLY: "true"'), true)
  assert.equal(build.includes('process.env.KILO_RELEASE_ARCHIVE_ONLY !== "true"'), true)
  const vscodeStart = fork.indexOf("      - name: Build VSIX packages")
  const vscodeEnd = fork.indexOf("\n      - name:", vscodeStart + 1)
  const vscodeStep = fork.slice(vscodeStart, vscodeEnd)
  assert.match(vscodeStep, /^        run: bun script\/build\.ts$/m)
  assert.match(vscodeStep, /^        working-directory: packages\/kilo-vscode$/m)
})
