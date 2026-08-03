#!/usr/bin/env node
// kilocode_change - new file

import { execFile as execFileCallback } from "node:child_process"
import { appendFile, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"

const execFile = promisify(execFileCallback)

export const LCM_PRERELEASE_ASSETS = [
  "kilo-linux-arm64.tar.gz",
  "kilo-linux-x64.tar.gz",
  "kilo-linux-x64-baseline.tar.gz",
  "kilo-linux-arm64-musl.tar.gz",
  "kilo-linux-x64-musl.tar.gz",
  "kilo-linux-x64-baseline-musl.tar.gz",
  "kilo-darwin-arm64.zip",
  "kilo-darwin-x64.zip",
  "kilo-darwin-x64-baseline.zip",
  "kilo-windows-arm64.zip",
  "kilo-windows-x64.zip",
  "kilo-windows-x64-baseline.zip",
  "kilo-vscode-linux-x64.vsix",
  "kilo-vscode-linux-arm64.vsix",
  "kilo-vscode-alpine-x64.vsix",
  "kilo-vscode-alpine-arm64.vsix",
  "kilo-vscode-darwin-x64.vsix",
  "kilo-vscode-darwin-arm64.vsix",
  "kilo-vscode-win32-x64.vsix",
  "kilo-vscode-win32-arm64.vsix",
]

export const LCM_PRERELEASE_OVERLAY_PATHS = new Set([
  ".github/workflows/publish.yml",
  "README.md",
  "RELEASING.md",
  "packages/opencode/script/build.ts",
  "script/lcm-prerelease-release.mjs",
  "script/lcm-prerelease-release.test.mjs",
])

function usage() {
  console.log(`Usage:
  lcm-prerelease-release.mjs verify-overlay --base-ref <ref> [--head-ref <ref>]
  lcm-prerelease-release.mjs next-version --repo <owner/repo> --base <x.y.z> --sha <sha> [--output <github-output>]
  lcm-prerelease-release.mjs create-draft --repo <owner/repo> --tag <tag> --sha <sha> --title <title> --body-file <path> [--output <github-output>]
  lcm-prerelease-release.mjs upload-assets --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --profile lcm-prerelease --asset <absolute-path>...
  lcm-prerelease-release.mjs validate-release --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --profile lcm-prerelease --draft <true|false>
  lcm-prerelease-release.mjs publish --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --title <title> --profile lcm-prerelease
  lcm-prerelease-release.mjs cleanup --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha>

Uses GITHUB_TOKEN or GH_TOKEN. Tokens are never printed.
`)
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return { help: true }
  const options = { command: argv[0], assets: [] }
  const repeated = new Set(["--asset"])
  const values = new Set([
    "--repo",
    "--base",
    "--output",
    "--release-id",
    "--tag",
    "--sha",
    "--title",
    "--body-file",
    "--profile",
    "--asset",
    "--draft",
    "--base-ref",
    "--head-ref",
  ])
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }
    if (!values.has(arg)) throw new Error(`Unknown argument: ${arg}`)
    const value = argv[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (repeated.has(arg)) {
      options.assets.push(value)
      continue
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())
    options[key] = value
  }
  return options
}

function required(options, key) {
  const value = options[key]
  if (typeof value !== "string" || value.length === 0) throw new Error(`${options.command} requires --${key}`)
  return value
}

function expectedSha(options) {
  const value = required(options, "sha").toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("--sha must be a full 40-character commit SHA")
  return value
}

function token() {
  const value = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!value) throw new Error("GITHUB_TOKEN or GH_TOKEN is required")
  return value
}

export class GitHubApiError extends Error {
  constructor(status, body) {
    super(`GitHub API ${status}: ${body}`)
    this.status = status
  }
}

export async function github(options, apiPath, init = {}) {
  const url = apiPath.startsWith("https://")
    ? apiPath
    : `https://api.github.com/repos/${required(options, "repo")}${apiPath}`
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) throw new GitHubApiError(response.status, await response.text())
  if (response.status === 204) return undefined
  return response.json()
}

export async function allPages(request, apiPath) {
  const items = []
  for (let page = 1; ; page++) {
    const separator = apiPath.includes("?") ? "&" : "?"
    const data = await request(`${apiPath}${separator}per_page=100&page=${page}`)
    if (!Array.isArray(data)) throw new Error(`Expected an array from ${apiPath}`)
    items.push(...data)
    if (data.length < 100) return items
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function nextPrereleaseVersion(base, releases, refs) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`Invalid upstream base version: ${base}`)
  const expression = new RegExp(`^v${escapeRegExp(base)}-lcm\\.(\\d+)$`)
  const names = [
    ...releases.map((release) => release.tag_name),
    ...refs.map((ref) => ref.ref?.replace(/^refs\/tags\//, "")),
  ]
  const used = names
    .map((name) => (typeof name === "string" ? expression.exec(name)?.[1] : undefined))
    .filter(Boolean)
    .map(Number)
  const suffix = Math.max(0, ...used) + 1
  return { base, version: `${base}-lcm.${suffix}`, tag: `v${base}-lcm.${suffix}` }
}

export function validateAssetManifest(assets, expectedNames = LCM_PRERELEASE_ASSETS) {
  const counts = new Map()
  for (const asset of assets) counts.set(asset.name, (counts.get(asset.name) ?? 0) + 1)
  const expected = new Set(expectedNames)
  const missing = expectedNames.filter((name) => !counts.has(name))
  const extra = [...counts.keys()].filter((name) => !expected.has(name))
  const duplicate = [...counts].filter(([, count]) => count !== 1).map(([name]) => name)
  const empty = assets.filter((asset) => !Number.isFinite(asset.size) || asset.size <= 0).map((asset) => asset.name)
  if (missing.length || extra.length || duplicate.length || empty.length || assets.length !== expectedNames.length) {
    throw new Error(
      `Invalid asset manifest: missing=[${missing}] extra=[${extra}] duplicate=[${duplicate}] empty=[${empty}] count=${assets.length}`,
    )
  }
  return assets
}

export function assertReleaseIdentity(release, input) {
  if (String(release.id) !== String(input.releaseID)) throw new Error(`Release ID changed from ${input.releaseID}`)
  if (release.tag_name !== input.tag)
    throw new Error(`Release ${release.id} has tag ${release.tag_name}, expected ${input.tag}`)
  if (release.target_commitish?.toLowerCase() !== input.sha) {
    throw new Error(`Release ${release.id} targets ${release.target_commitish}, expected ${input.sha}`)
  }
  if (input.draft !== undefined && release.draft !== input.draft) {
    throw new Error(`Release ${release.id} draft=${release.draft}, expected ${input.draft}`)
  }
  return release
}

export async function resolveTagCommitSha(request, tag) {
  let object = (await request(`/git/ref/tags/${encodeURIComponent(tag)}`))?.object
  for (let depth = 0; depth < 8; depth++) {
    if (!object || typeof object.sha !== "string") throw new Error(`Tag ${tag} has no resolvable object`)
    if (object.type === "commit") return object.sha.toLowerCase()
    if (object.type !== "tag") throw new Error(`Tag ${tag} resolves to unsupported object type ${object.type}`)
    object = (await request(`/git/tags/${encodeURIComponent(object.sha)}`))?.object
  }
  throw new Error(`Tag ${tag} exceeds the annotated-tag peel limit`)
}

export async function waitForTagCommitSha(request, tag, sha, input = {}) {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const attempts = input.attempts ?? 10
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resolved = await resolveTagCommitSha(request, tag)
      if (resolved !== sha) throw new Error(`Tag ${tag} resolves to ${resolved}, expected ${sha}`)
      return resolved
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404 || attempt === attempts) throw error
      await sleep(1000)
    }
  }
  throw new Error(`Tag ${tag} did not become visible`)
}

export function assetUploadUrl(uploadURL, name) {
  const base = uploadURL.replace(/\{.*$/, "")
  return `${base}?name=${encodeURIComponent(name)}`
}

async function writeOutputs(file, values) {
  if (!file) return
  await appendFile(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  )
}

function requester(options, request) {
  return request ?? ((apiPath, init) => github(options, apiPath, init))
}

async function releaseAssets(request, releaseID) {
  return allPages(request, `/releases/${encodeURIComponent(releaseID)}/assets`)
}

async function validateLocalAssets(files) {
  const assets = []
  for (const file of files) {
    if (!path.isAbsolute(file)) throw new Error(`Asset path must be absolute: ${file}`)
    const info = await stat(file)
    if (!info.isFile()) throw new Error(`Asset is not a file: ${file}`)
    assets.push({ name: path.basename(file), size: info.size, path: file })
  }
  validateAssetManifest(assets)
  return assets
}

export async function nextVersion(options, input = {}) {
  const base = required(options, "base")
  const sha = expectedSha(options)
  const request = requester(options, input.request)
  const releases = await allPages(request, "/releases")
  const duplicate = releases.filter((release) => release.target_commitish?.toLowerCase() === sha)
  if (duplicate.length > 0) {
    throw new Error(`Commit ${sha} already has release(s): ${duplicate.map((release) => release.tag_name).join(", ")}`)
  }
  const refs = await allPages(request, `/git/matching-refs/tags/${encodeURIComponent(`v${base}-lcm.`)}`)
  const value = nextPrereleaseVersion(base, releases, refs)
  await writeOutputs(options.output, value)
  console.log(`${value.version}\t${value.tag}`)
  return value
}

export async function createDraft(options, input = {}) {
  const sha = expectedSha(options)
  const tag = required(options, "tag")
  const title = required(options, "title")
  const body = await readFile(required(options, "bodyFile"), "utf8")
  const request = requester(options, input.request)
  const release = await request("/releases", {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: title,
      body,
      draft: true,
      prerelease: true,
    }),
  })
  assertReleaseIdentity(release, { releaseID: release.id, tag, sha, draft: true })
  if (!release.prerelease) throw new Error(`Draft ${release.id} is not marked prerelease`)
  if (typeof release.upload_url !== "string") throw new Error(`Draft ${release.id} has no upload URL`)
  await writeOutputs(options.output, { id: release.id, upload_url: release.upload_url })
  console.log(`created\t${release.id}\t${tag}\t${sha}`)
  return release
}

export async function uploadAssets(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  if (options.profile !== "lcm-prerelease") throw new Error("upload-assets requires --profile lcm-prerelease")
  const files = await (input.validateLocalAssets ?? validateLocalAssets)(options.assets)
  const request = requester(options, input.request)
  const release = assertReleaseIdentity(await request(`/releases/${releaseID}`), { releaseID, tag, sha, draft: true })
  if ((await releaseAssets(request, releaseID)).length !== 0) throw new Error(`Draft ${releaseID} already has assets`)
  for (const asset of files) {
    const body = input.readAsset ? await input.readAsset(asset.path) : await readFile(asset.path)
    const uploaded = await request(assetUploadUrl(release.upload_url, asset.name), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    })
    if (uploaded.name !== asset.name || uploaded.size <= 0)
      throw new Error(`Upload failed validation for ${asset.name}`)
  }
  const uploaded = await releaseAssets(request, releaseID)
  validateAssetManifest(uploaded)
  console.log(`uploaded\t${releaseID}\t${uploaded.length}`)
  return uploaded
}

export async function validateRelease(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  if (options.profile !== "lcm-prerelease") throw new Error("validate-release requires --profile lcm-prerelease")
  if (options.draft !== "true" && options.draft !== "false") throw new Error("--draft must be true or false")
  const draft = options.draft === "true"
  const request = requester(options, input.request)
  const release = assertReleaseIdentity(await request(`/releases/${releaseID}`), { releaseID, tag, sha, draft })
  if (!release.prerelease) throw new Error(`Release ${releaseID} is not marked prerelease`)
  const assets = await releaseAssets(request, releaseID)
  validateAssetManifest(assets)
  if (!draft && (await resolveTagCommitSha(request, tag)) !== sha)
    throw new Error(`Tag ${tag} does not resolve to ${sha}`)
  console.log(`validated\t${releaseID}\t${tag}\t${assets.length}\tdraft=${draft}`)
  return { release, assets }
}

export async function publishRelease(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  const title = required(options, "title")
  if (options.profile !== "lcm-prerelease") throw new Error("publish requires --profile lcm-prerelease")
  const request = requester(options, input.request)
  await validateRelease({ ...options, command: "validate-release", draft: "true" }, { request })
  const release = await request(`/releases/${releaseID}`, {
    method: "PATCH",
    body: JSON.stringify({ draft: false, prerelease: true, name: title }),
  })
  assertReleaseIdentity(release, { releaseID, tag, sha, draft: false })
  if (!release.prerelease) throw new Error(`Published release ${releaseID} is not marked prerelease`)
  await waitForTagCommitSha(request, tag, sha, { sleep: input.sleep })
  console.log(`published\t${releaseID}\t${tag}\t${sha}`)
  return release
}

export async function cleanup(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  const request = requester(options, input.request)
  let release
  try {
    release = await request(`/releases/${releaseID}`)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return { releaseDeleted: false, tagDeleted: false }
    throw error
  }
  try {
    assertReleaseIdentity(release, { releaseID, tag, sha, draft: true })
  } catch (error) {
    console.error(`${error.message}; leaving release ${releaseID} intact`)
    return { releaseDeleted: false, tagDeleted: false }
  }
  await request(`/releases/${releaseID}`, { method: "DELETE" })
  let tagSha
  try {
    tagSha = await resolveTagCommitSha(request, tag)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return { releaseDeleted: true, tagDeleted: false }
    throw error
  }
  if (tagSha !== sha) {
    console.error(`Tag ${tag} resolves to ${tagSha}, not ${sha}; leaving it intact`)
    return { releaseDeleted: true, tagDeleted: false }
  }
  await request(`/git/refs/tags/${encodeURIComponent(tag)}`, { method: "DELETE" })
  return { releaseDeleted: true, tagDeleted: true }
}

export function validatePrereleaseOverlayPaths(files) {
  const invalid = files.filter((file) => !LCM_PRERELEASE_OVERLAY_PATHS.has(file))
  if (invalid.length > 0) {
    throw new Error(`Prerelease branch changes product paths: ${invalid.join(", ")}`)
  }
  return files
}

async function runGit(args, cwd) {
  const result = await execFile("git", args, { cwd })
  return result.stdout.trim()
}

export async function verifyPrereleaseOverlay(options, input = {}) {
  const baseRef = required(options, "baseRef")
  const headRef = options.headRef ?? "HEAD"
  const git = input.git ?? ((args) => runGit(args, input.cwd ?? process.cwd()))
  const baseSha = (await git(["rev-parse", `${baseRef}^{commit}`])).toLowerCase()
  const headSha = (await git(["rev-parse", `${headRef}^{commit}`])).toLowerCase()
  const mergeBase = (await git(["merge-base", baseSha, headSha])).toLowerCase()
  if (mergeBase !== baseSha) {
    throw new Error(`Prerelease head ${headSha} is not based on product commit ${baseSha}`)
  }
  const output = await git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${baseSha}..${headSha}`])
  const files = output
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
  validatePrereleaseOverlayPaths(files)
  console.log(`overlay\t${baseSha}\t${headSha}\t${files.length}`)
  return { baseSha, headSha, files }
}

export async function runCommand(options, input = {}) {
  if (options.command === "verify-overlay") return verifyPrereleaseOverlay(options, input)
  if (options.command === "next-version") return nextVersion(options, input)
  if (options.command === "create-draft") return createDraft(options, input)
  if (options.command === "upload-assets") return uploadAssets(options, input)
  if (options.command === "validate-release") return validateRelease(options, input)
  if (options.command === "publish") return publishRelease(options, input)
  if (options.command === "cleanup") return cleanup(options, input)
  throw new Error(`Unknown command: ${options.command}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return usage()
  await runCommand(options)
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
