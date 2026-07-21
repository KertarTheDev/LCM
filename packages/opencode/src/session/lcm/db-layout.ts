// kilocode_change - new file
import fs from "node:fs/promises"
import path from "node:path"

export interface LcmDbLayout {
  readonly rootDir: string
  readonly pgliteDir: string
  readonly artifactsDir: string
  readonly ownerLockPath: string
}

export function resolveLcmControlRoot(kiloDataDir: string) {
  return path.resolve(kiloDataDir, "lcm")
}

export function resolveLcmControlDataRoot(kiloDataDir: string) {
  return path.join(resolveLcmControlRoot(kiloDataDir), "control")
}

export function resolveLcmFamiliesRoot(kiloDataDir: string) {
  return path.join(resolveLcmControlRoot(kiloDataDir), "families")
}

export function resolveLcmFamilyRoot(input: { kiloDataDir: string; familyID: string }) {
  return path.join(resolveLcmFamiliesRoot(input.kiloDataDir), input.familyID)
}

export function resolveLcmRoot(input: { kiloDataDir: string; overrideDataDir?: string }) {
  return path.resolve(input.overrideDataDir ?? path.join(input.kiloDataDir, "lcm"))
}

export function resolveLcmDbLayout(dataDir: string): LcmDbLayout {
  const rootDir = path.resolve(dataDir)
  return {
    rootDir,
    pgliteDir: path.join(rootDir, "pglite"),
    artifactsDir: path.join(rootDir, "artifacts"),
    ownerLockPath: path.join(rootDir, "owner.lock"),
  }
}

export async function canonicalizeLcmPath(value: string) {
  const resolved = path.resolve(value)
  const exact = await fs.realpath(resolved).catch(() => undefined)
  if (exact) return normalizeRegistryPath(exact)

  let current = resolved
  const missing: string[] = []
  while (true) {
    const parent = path.dirname(current)
    const realParent = await fs.realpath(current).catch(() => undefined)
    if (realParent) {
      return normalizeRegistryPath(path.join(realParent, ...missing.reverse()))
    }
    if (parent === current) return normalizeRegistryPath(resolved)
    missing.push(path.basename(current))
    current = parent
  }
}

export function normalizeRegistryPath(value: string) {
  const normalized = path.normalize(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

export async function ensureLcmRoot(layout: LcmDbLayout) {
  await fs.mkdir(layout.rootDir, { recursive: true })
}

export async function ensureLcmStorageDirectories(layout: LcmDbLayout) {
  await fs.mkdir(layout.pgliteDir, { recursive: true })
  await fs.mkdir(layout.artifactsDir, { recursive: true })
}
