// kilocode_change - new file
import { expect, test } from "bun:test"
import {
  validateObservedPathState,
  validateRegisteredPathRecord,
  type LcmPathBackedFileRecord,
} from "../../src/session/lcm/path-provenance"
import { createHarnessBoundaryMetadata } from "./harness"

const posixBoundary = createHarnessBoundaryMetadata({
  projectID: "project_m22",
  workspaceID: "workspace_m22",
  sessionDirectoryOriginal: "/workspace/m22",
  sessionDirectoryCanonical: "/workspace/m22",
  worktreeOriginal: "/workspace/m22",
  worktreeCanonical: "/workspace/m22",
  allowedRootOriginals: ["/workspace/m22"],
  allowedRootCanonicals: ["/workspace/m22"],
})

const winBoundary = {
  ...posixBoundary,
  platformPathFlavor: "win32" as const,
  caseSensitivity: "insensitive" as const,
  sessionDirectoryOriginal: "C:\\work\\m22",
  sessionDirectoryCanonical: "C:\\work\\m22",
  worktreeOriginal: "C:\\work\\m22",
  worktreeCanonical: "C:\\work\\m22",
  allowedRootOriginals: ["C:\\work\\m22"],
  allowedRootCanonicals: ["C:\\work\\m22"],
}

function record(input: Partial<LcmPathBackedFileRecord> = {}): LcmPathBackedFileRecord {
  return {
    fileID: "file_m22_path",
    sourceKind: "path",
    originalPath: "/workspace/m22/src/index.ts",
    canonicalPath: "/workspace/m22/src/index.ts",
    pathSizeBytes: 12,
    pathMtimeMs: 1_777_600_220_000,
    pathContentSha256: "a".repeat(64),
    pathHashMode: "full",
    boundaryMetadata: posixBoundary,
    ...input,
  }
}

test("lcm:path-provenance validates complete POSIX path-backed registrations", () => {
  const result = validateRegisteredPathRecord(record())
  expect(result).toMatchObject({ ok: true, staleState: "current", insideBoundary: true })

  const outside = validateRegisteredPathRecord(record({ canonicalPath: "/tmp/outside.ts" }))
  expect(outside).toMatchObject({ ok: true, staleState: "current", insideBoundary: false })

  const incomplete = validateRegisteredPathRecord(record({ boundaryMetadata: {} }))
  expect(incomplete).toMatchObject({ ok: false, staleState: "unknown" })
})

test("lcm:path-provenance supports Windows case-insensitive boundary checks", () => {
  const result = validateRegisteredPathRecord(
    record({
      originalPath: "C:\\work\\m22\\SRC\\Index.ts",
      canonicalPath: "C:\\WORK\\M22\\SRC\\Index.ts",
      boundaryMetadata: winBoundary,
    }),
  )
  expect(result).toMatchObject({ ok: true, staleState: "current", insideBoundary: true })
})

test("lcm:path-provenance rejects stale or inaccessible observed files before reads", () => {
  const current = record()
  expect(
    validateObservedPathState(current, {
      canonicalPath: "/workspace/m22/src/index.ts",
      sizeBytes: 12,
      mtimeMs: 1_777_600_220_000,
      contentSha256: "a".repeat(64),
      permission: "allowed",
    }),
  ).toMatchObject({ ok: true, staleState: "current" })

  expect(
    validateObservedPathState(current, {
      canonicalPath: "/workspace/m22/src/index.ts",
      sizeBytes: 12,
      mtimeMs: 1_777_600_220_000,
      contentSha256: "b".repeat(64),
      permission: "allowed",
    }),
  ).toMatchObject({ ok: false, staleState: "hash_mismatch" })

  expect(
    validateObservedPathState(current, {
      canonicalPath: "/workspace/m22/src/index.ts",
      sizeBytes: 12,
      mtimeMs: 1_777_600_220_000,
      contentSha256: "a".repeat(64),
      permission: "denied",
    }),
  ).toMatchObject({ ok: false, staleState: "permission_denied" })

  const external = record({ canonicalPath: "/external/path-backed.txt", originalPath: "/external/path-backed.txt" })
  expect(
    validateObservedPathState(external, {
      canonicalPath: "/external/path-backed.txt",
      sizeBytes: 12,
      mtimeMs: 1_777_600_220_000,
      contentSha256: "a".repeat(64),
      permission: "allowed",
    }),
  ).toMatchObject({ ok: true, staleState: "current", insideBoundary: false })
})
