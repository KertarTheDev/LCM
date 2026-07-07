import path from "path"
// kilocode_change start
import { createHash } from "node:crypto"
// kilocode_change end
import { Global } from "@opencode-ai/core/global"

export const TRUNCATION_DIR = path.join(Global.Path.data, "tool-output")
// kilocode_change start

export const TRUNCATION_OUTPUT_METADATA_VERSION = 1

export interface TruncationOutputMetadata {
  outputPath: string
  outputByteCount: number
  outputSha256: string
  outputSidecarVersion: typeof TRUNCATION_OUTPUT_METADATA_VERSION
}

export function truncationOutputMetadata(input: { outputPath: string; text: string }): TruncationOutputMetadata {
  const bytes = Buffer.from(input.text, "utf8")
  return {
    outputPath: input.outputPath,
    outputByteCount: bytes.byteLength,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    outputSidecarVersion: TRUNCATION_OUTPUT_METADATA_VERSION,
  }
}
// kilocode_change end
