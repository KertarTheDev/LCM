// kilocode_change - new file
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  GitHubApiError,
  LCM_CURRENT_PRERELEASE_TAG,
  LCM_PAPER_URL,
  LCM_PREVIOUS_PRERELEASE_TAG,
  LCM_PRERELEASE_ASSETS,
  LCM_PRERELEASE_TRANSLATIONS,
  assetUploadUrl,
  cleanup,
  nextVersion,
  nextPrereleaseVersion,
  publishRelease,
  renderOnboarding,
  renderPrereleaseNotes,
  resolveTagCommitSha,
  validateAssetManifest,
  validateOnboardingReadme,
  validatePrereleaseChangelog,
  validatePrereleaseOverlayPaths,
  validateTranslationReadmePaths,
  verifyPrereleaseOverlay,
  waitForTagCommitSha,
  updateNotes,
} from "./lcm-prerelease-release.mjs"

const sha = "a".repeat(40)
const other = "b".repeat(40)
const tag = "v7.4.23-lcm.1"
const reviewedBody = renderPrereleaseNotes({ base: "7.4.23", tag, sha })

function options(overrides = {}) {
  return {
    command: "publish",
    repo: "owner/repo",
    releaseId: "42",
    tag,
    sha,
    title: "LCM alpha 7.4.23-lcm.1",
    profile: "lcm-prerelease",
    bodyFile: "notes.md",
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
    body: reviewedBody,
    upload_url: "https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}",
    ...overrides,
  }
}

function assets() {
  return LCM_PRERELEASE_ASSETS.map((name, index) => ({ name, size: index + 1 }))
}

test("a free upstream base starts again at lcm.1", () => {
  assert.deepEqual(nextPrereleaseVersion("7.4.23", [], []), {
    base: "7.4.23",
    version: "7.4.23-lcm.1",
    tag: "v7.4.23-lcm.1",
  })
})

test("a published lcm.1 advances to lcm.2", () => {
  assert.deepEqual(nextPrereleaseVersion("7.4.23", [release()], []), {
    base: "7.4.23",
    version: "7.4.23-lcm.2",
    tag: "v7.4.23-lcm.2",
  })
})

test("next prerelease suffix counts releases, drafts, and tags", () => {
  const value = nextPrereleaseVersion(
    "7.4.23",
    [release(), release({ tag_name: "v7.4.23-lcm.3", draft: true })],
    [
      { ref: "refs/tags/v7.4.23-lcm.2" },
      { ref: "refs/tags/v7.4.23-lcm.4" },
      { ref: "refs/tags/v7.4.23-lcm.5" },
      { ref: "refs/tags/v7.4.20-lcm.99" },
    ],
  )
  assert.deepEqual(value, { base: "7.4.23", version: "7.4.23-lcm.6", tag: "v7.4.23-lcm.6" })
})

test("nextVersion refuses a second release for one workflow SHA", async () => {
  await assert.rejects(
    nextVersion(options({ command: "next-version", base: "7.4.23" }), {
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

test("onboarding stays complete in English and every existing README language", () => {
  const files = ["README.md", ...LCM_PRERELEASE_TRANSLATIONS]
  assert.equal(files.length, 22)
  for (const file of files) {
    const locale = file === "README.md" ? "en" : /README\.([^.]+)\.md$/.exec(file)?.[1]
    const block = renderOnboarding(locale, LCM_CURRENT_PRERELEASE_TAG)
    const readme = `${block}\n\nhttps://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code\n`
    assert.deepEqual(
      validateOnboardingReadme(readme, {
        file,
        locale,
        tag: LCM_CURRENT_PRERELEASE_TAG,
        vscodeEngine: "^1.105.1",
      }),
      { file, locale, tag: LCM_CURRENT_PRERELEASE_TAG },
    )
    assert.equal(block.includes(LCM_PAPER_URL), true)
  }
})

test("onboarding translation inventory cannot silently gain or lose a README", () => {
  assert.deepEqual(validateTranslationReadmePaths(LCM_PRERELEASE_TRANSLATIONS), [...LCM_PRERELEASE_TRANSLATIONS].sort())
  assert.throws(
    () => validateTranslationReadmePaths([...LCM_PRERELEASE_TRANSLATIONS, "translations/README.nl.md"]),
    /extra=.*README\.nl\.md/,
  )
  assert.throws(() => validateTranslationReadmePaths(LCM_PRERELEASE_TRANSLATIONS.slice(1)), /missing=/)
})

test("onboarding validation catches stale assets, paper links, and VS Code requirements", () => {
  const block = renderOnboarding("en", LCM_CURRENT_PRERELEASE_TAG)
  const readme = `${block}\nhttps://marketplace.visualstudio.com/`
  const input = { file: "README.md", locale: "en", tag: LCM_CURRENT_PRERELEASE_TAG, vscodeEngine: "^1.105.1" }
  assert.throws(
    () => validateOnboardingReadme(readme.replace("kilo-linux-arm64.tar.gz", "missing.tar.gz"), input),
    /not synchronized|missing/,
  )
  assert.throws(
    () => validateOnboardingReadme(readme.replace(LCM_PAPER_URL, "https://example.com"), input),
    /not synchronized|missing/,
  )
  assert.throws(() => validateOnboardingReadme(readme, { ...input, vscodeEngine: "^1.106.0" }), /missing: 1\.106\.0/)
})

test("release notes bind the setup guide, paper, tag, and SHA", () => {
  const body = renderPrereleaseNotes({ base: "7.4.23", tag, sha })
  assert.match(body, /installation and setup guide/)
  assert.match(body, /#install-lcm-prerelease/)
  assert.equal(body.includes(LCM_PAPER_URL), true)
  assert.equal(body.includes(tag), true)
  assert.equal(body.includes(sha), true)
  assert.match(body, /12 CLI archives or eight VSIX files/)
  assert.match(body, new RegExp(`What changed since ${LCM_PREVIOUS_PRERELEASE_TAG.replaceAll(".", "\\.")}`))
  assert.match(body, /lcm_expand_query.*50%.*64k/s)
  assert.match(body, /coverage: none.*identical exact retry/s)
  assert.match(body, /ordered event ledger.*actual new event/s)
  assert.match(body, /175k.*0\.5.*zero product findings.*does not claim a deterministic score gain/s)
})

test("release notes reject generic boilerplate without a concrete LCM product delta", () => {
  assert.throws(
    () =>
      validatePrereleaseChangelog({
        base: "7.4.23",
        previousTag: LCM_PREVIOUS_PRERELEASE_TAG,
        changes: [
          {
            title: "General improvements one",
            body: "This release contains many useful improvements for users and makes the overall experience better in several important and broadly applicable ways.",
          },
          {
            title: "General improvements two",
            body: "This release also improves quality, reliability, and performance so everyone should have a smoother and more productive experience than before.",
          },
        ],
      }),
    /generic boilerplate/,
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
  let published = false
  const result = await publishRelease(options(), {
    readBody: async () => reviewedBody,
    request: async (apiPath, init) => {
      calls.push({ apiPath, init })
      if (apiPath === "/releases/42" && !init) return release({ draft: !published })
      if (apiPath === "/releases/42/assets?per_page=100&page=1") return assets()
      if (apiPath === "/releases/42" && init?.method === "PATCH") {
        published = true
        return release({ draft: false })
      }
      if (apiPath === `/git/ref/tags/${tag}`) return { object: { type: "commit", sha } }
      throw new Error(`Unexpected request ${apiPath}`)
    },
  })
  assert.equal(result.draft, false)
  assert.equal(calls.find((call) => call.init?.method === "PATCH")?.apiPath, "/releases/42")
})

test("published release notes update only the body after exact identity and asset validation", async () => {
  const calls = []
  const body = `${reviewedBody}\nAdditional 175k evidence will be recorded after the fixed-binary run.\n`
  let patched = false
  const result = await updateNotes(options({ command: "update-notes", bodyFile: "notes.md" }), {
    readBody: async () => body,
    request: async (apiPath, init) => {
      calls.push({ apiPath, init })
      if (apiPath === "/releases/42/assets?per_page=100&page=1") return assets()
      if (apiPath === `/git/ref/tags/${tag}`) return { object: { type: "commit", sha } }
      if (apiPath === "/releases/42" && init?.method === "PATCH") {
        patched = true
        assert.deepEqual(JSON.parse(init.body), { body })
        return release({ draft: false, body })
      }
      if (apiPath === "/releases/42") return release({ draft: false, body: patched ? body : "old" })
      throw new Error(`Unexpected request ${apiPath}`)
    },
  })
  assert.equal(result.body, body)
  assert.equal(calls.filter((call) => call.init?.method === "PATCH").length, 1)
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

test("overlay allowlist accepts synchronized README translations but rejects unrelated churn", () => {
  const overlay = [
    ".github/workflows/publish.yml",
    "README.md",
    "RELEASING.md",
    "packages/opencode/script/build.ts",
    "script/lcm-prerelease-release.mjs",
    "script/lcm-prerelease-release.test.mjs",
    ...LCM_PRERELEASE_TRANSLATIONS,
  ]
  assert.deepEqual(validatePrereleaseOverlayPaths(overlay), overlay)
  assert.throws(() => validatePrereleaseOverlayPaths(["packages/opencode/src/session/prompt.ts"]), /product paths/)
  assert.throws(() => validatePrereleaseOverlayPaths(["translations/README.nl.md"]), /product paths/)
  assert.throws(() => validatePrereleaseOverlayPaths([".github/workflows/codeql.yml"]), /product paths/)
})

test("overlay verification requires exact product ancestry", async () => {
  const result = await verifyPrereleaseOverlay(
    { command: "verify-overlay", baseRef: "product", headRef: "candidate" },
    {
      validateOnboarding: false,
      validateTranslations: false,
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
        validateOnboarding: false,
        validateTranslations: false,
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

test("fork workflow binds release identity and focused v7.4.23 adaptation gates", async () => {
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
    "write-notes",
    "create-draft",
    "upload-assets",
    "validate-release",
    "publish",
    "cleanup",
  ]) {
    assert.equal(fork.includes(`lcm-prerelease-release.mjs\" ${command}`), true)
  }
  for (const command of [
    "upstream-compat.test.ts",
    "prompt-seam.test.ts",
    "test/event-manifest.test.ts",
    "api-contracts.test.ts",
    "processor-effect.test.ts",
    "transcript-source.test.ts",
    "tool-contracts.test.ts",
    "agent-permission-overrides.test.ts",
    "remote-command.test.ts",
    "remote-sender.test.ts",
    "tui-command.test.ts",
    "src/KiloProvider.ts",
    "src/kilo-provider/early-message.ts",
    "src/kilo-provider/conversation-memory.ts",
    "src/services/cli-backend/connection-utils.ts",
    "src/shared/custom-provider.ts",
    "webview-ui/src/components/chat/ContextProgress.tsx",
    "webview-ui/src/components/chat/TaskHeader.tsx",
    "webview-ui/src/components/chat/TaskTimeline.tsx",
    "webview-ui/src/components/settings/ContextTab.tsx",
    "webview-ui/src/components/settings/CustomProviderDialog.tsx",
    "webview-ui/src/components/settings/CustomProviderModelCard.tsx",
    "webview-ui/src/components/settings/CustomProviderValidation.ts",
    "webview-ui/src/components/settings/ExperimentalTab.tsx",
    "webview-ui/src/context/lcm-state.ts",
    "webview-ui/src/context/session.tsx",
    "webview-ui/src/types/messages/lcm.ts",
    "connection-utils.test.ts",
    "conversation-memory-export.test.ts",
    "early-message.test.ts",
    "lcm-ui.test.ts",
    "custom-provider.test.ts",
    "custom-provider-dialog-validate.test.ts",
    "kilo-provider-load-messages.test.ts",
    "i18n-keys.test.ts",
    "lcm:contracts:check",
    "lcm:docs:check",
    "lcm:packaged-smoke",
  ]) {
    assert.equal(fork.includes(command), true)
  }
  for (const skipped of [
    "test/ripgrep.test.ts",
    "cli-shutdown.test.ts",
    "test/kilocode/lcm/config.test.ts",
    "ensure-title-mark.test.ts",
    "session-overflow.test.ts",
    "session-prompt-compaction-safety.test.ts",
    "session-prompt-queue.test.ts",
    "registry.test.ts",
    "lcm:store",
    "lcm:tree",
    "lcm:projection",
    "lcm:api",
    "lcm:export",
    "lcm:upstream-compat",
    "lcm:long-context",
    "lcm:tools",
    "long-context.test.ts",
    "session-prompt-steering.test.ts",
    "session-outcome.test.ts",
    "lcm:map",
    "lcm:scheduler",
    "lcm:sub-agent-scope",
    "pglite",
    "packages/kilo-jetbrains",
  ]) {
    assert.equal(fork.toLowerCase().includes(skipped), false)
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
