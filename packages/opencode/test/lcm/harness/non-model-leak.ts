// kilocode_change - new file
import { LCM_HARNESS_SENTINELS } from "."

export const LCM_NON_MODEL_LEAK_SENTINELS = {
  ...LCM_HARNESS_SENTINELS,
  summaryText: "LCM_HARNESS_SUMMARY_SENTINEL",
  rawPrompt: "LCM_HARNESS_RAW_PROMPT_SENTINEL",
  rawFile: "LCM_HARNESS_RAW_FILE_SENTINEL",
  helperOutput: "LCM_HARNESS_HELPER_OUTPUT_SENTINEL",
  lockfilePath: "LCM_HARNESS_LOCKFILE_PATH_SENTINEL",
  arbitraryException: "LCM_HARNESS_EXCEPTION_SENTINEL",
} as const

export function assertNoNonModelSentinelLeaks(input: {
  label: string
  value: unknown
  sentinels?: Record<string, string>
}) {
  const sentinels = input.sentinels ?? LCM_NON_MODEL_LEAK_SENTINELS
  const serialized = JSON.stringify(input.value, (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Error) return { name: value.name, message: value.message }
    return value
  })

  for (const [name, sentinel] of Object.entries(sentinels)) {
    if (serialized?.includes(sentinel)) {
      throw new Error(`${input.label} leaked non-model sentinel ${name}`)
    }
  }
}
