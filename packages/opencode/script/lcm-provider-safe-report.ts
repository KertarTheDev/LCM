// kilocode_change - new file
import fs from "node:fs/promises"
import path from "node:path"

export type ProviderSafeCheckID =
  | "provider-safe.render-unit-assembly"
  | "provider-safe.target-current-user-dedup"
  | "provider-safe.post-transform-validation"
  | "provider-safe.request-snapshot-cleanup"
  | "provider-safe.cue-lifecycle"
  | "provider-safe.snapshot-v2-repair"
  | "provider-safe.missing-tool-result-regression"

export type ProviderSafeReleaseStepID =
  | "provider-safe.assembly-validation"
  | "provider-safe.final-provider-validation"
  | "provider-safe.request-snapshot-cleanup"
  | "provider-safe.cue-lifecycle"
  | "provider-safe.snapshot-v2-repair"
  | "provider-safe.missing-tool-result-regression"

export type ProviderSafeCheckStatus = "passed" | "failed" | "blocked"

export interface ProviderSafeSafeError {
  readonly code: string
  readonly templateKey: string
  readonly safeMessage?: string
  readonly safeParams: Record<string, unknown>
  readonly retryable: boolean
  readonly diagnosticCode: string
}

export interface ProviderSafeReportEntry {
  readonly checkID: ProviderSafeCheckID
  readonly status: ProviderSafeCheckStatus
  readonly command?: string
  readonly artifactPath?: string
  readonly runtimePath?: string
  readonly evidencePath?: string
  readonly safeError?: ProviderSafeSafeError
  readonly notes?: string
}

export interface ProviderSafeReleaseStepEntry {
  readonly stepID: ProviderSafeReleaseStepID
  readonly status: ProviderSafeCheckStatus
  readonly command?: string
  readonly artifactPath?: string
  readonly runtimePath?: string
  readonly evidencePath?: string
  readonly safeError?: ProviderSafeSafeError
  readonly notes?: string
}

interface ProviderSafeReportSchema {
  readonly statusEnum: readonly ProviderSafeCheckStatus[]
  readonly blockedRequires: readonly string[]
  readonly familyAdaptation: ProviderSafeSectionSchema
  readonly releaseScenario: ProviderSafeReleaseSectionSchema
}

interface ProviderSafeSectionSchema {
  readonly reportSchemaVersion: string
  readonly arrayField: "providerSafeChecks"
  readonly idField: "checkID"
  readonly requiredIDs: readonly ProviderSafeCheckID[]
  readonly allowedFields: readonly (keyof ProviderSafeReportEntry)[]
}

interface ProviderSafeReleaseSectionSchema {
  readonly reportSchemaVersion: string
  readonly arrayField: "providerSafeSteps"
  readonly idField: "stepID"
  readonly requiredIDs: readonly ProviderSafeReleaseStepID[]
  readonly allowedFields: readonly (keyof ProviderSafeReleaseStepEntry)[]
}

const workspaceRoot = path.resolve(import.meta.dir, "../../..")
const schemaPath = path.join(
  workspaceRoot,
  "specifications/fixtures/provider-safe-assembly/provider-safe-report-schemas-v1.json",
)

export const PROVIDER_SAFE_CHECK_IDS: readonly ProviderSafeCheckID[] = [
  "provider-safe.render-unit-assembly",
  "provider-safe.target-current-user-dedup",
  "provider-safe.post-transform-validation",
  "provider-safe.request-snapshot-cleanup",
  "provider-safe.cue-lifecycle",
  "provider-safe.snapshot-v2-repair",
  "provider-safe.missing-tool-result-regression",
]

export const PROVIDER_SAFE_RELEASE_STEP_IDS: readonly ProviderSafeReleaseStepID[] = [
  "provider-safe.assembly-validation",
  "provider-safe.final-provider-validation",
  "provider-safe.request-snapshot-cleanup",
  "provider-safe.cue-lifecycle",
  "provider-safe.snapshot-v2-repair",
  "provider-safe.missing-tool-result-regression",
]

export function providerSafeSafeError(diagnosticCode: string): ProviderSafeSafeError {
  return {
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeMessage: "The memory request is outside the supported limits.",
    safeParams: {},
    retryable: false,
    diagnosticCode,
  }
}

export function providerSafePass(
  checkID: ProviderSafeCheckID,
  input: Omit<ProviderSafeReportEntry, "checkID" | "status" | "safeError"> = {},
): ProviderSafeReportEntry {
  return {
    checkID,
    status: "passed",
    ...input,
  }
}

export function providerSafeFail(
  checkID: ProviderSafeCheckID,
  diagnosticCode: string,
  input: Omit<ProviderSafeReportEntry, "checkID" | "status" | "safeError"> = {},
): ProviderSafeReportEntry {
  return {
    checkID,
    status: "failed",
    safeError: providerSafeSafeError(diagnosticCode),
    ...input,
  }
}

export function providerSafeBlocked(
  checkID: ProviderSafeCheckID,
  input: Omit<ProviderSafeReportEntry, "checkID" | "status">,
): ProviderSafeReportEntry {
  return {
    checkID,
    status: "blocked",
    ...input,
  }
}

export function providerSafeReleasePass(
  stepID: ProviderSafeReleaseStepID,
  input: Omit<ProviderSafeReleaseStepEntry, "stepID" | "status" | "safeError"> = {},
): ProviderSafeReleaseStepEntry {
  return {
    stepID,
    status: "passed",
    ...input,
  }
}

export function providerSafeReleaseFail(
  stepID: ProviderSafeReleaseStepID,
  diagnosticCode: string,
  input: Omit<ProviderSafeReleaseStepEntry, "stepID" | "status" | "safeError"> = {},
): ProviderSafeReleaseStepEntry {
  return {
    stepID,
    status: "failed",
    safeError: providerSafeSafeError(diagnosticCode),
    ...input,
  }
}

export function providerSafeReleaseBlocked(
  stepID: ProviderSafeReleaseStepID,
  input: Omit<ProviderSafeReleaseStepEntry, "stepID" | "status">,
): ProviderSafeReleaseStepEntry {
  return {
    stepID,
    status: "blocked",
    ...input,
  }
}

export async function readProviderSafeReportSchema(): Promise<ProviderSafeReportSchema> {
  return JSON.parse(await fs.readFile(schemaPath, "utf8")) as ProviderSafeReportSchema
}

export async function validateProviderSafeChecks(
  reportKind: "familyAdaptation",
  entries: readonly ProviderSafeReportEntry[],
) {
  const schema = await readProviderSafeReportSchema()
  const section = schema[reportKind]
  const statusSet = new Set(schema.statusEnum)
  const required = section.requiredIDs
  const allowedFields = new Set(section.allowedFields)
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!required.includes(entry.checkID)) throw new Error(`lcm_provider_safe_unexpected_check_${entry.checkID}`)
    if (seen.has(entry.checkID)) throw new Error(`lcm_provider_safe_duplicate_check_${entry.checkID}`)
    seen.add(entry.checkID)
    if (!statusSet.has(entry.status)) throw new Error(`lcm_provider_safe_invalid_status_${entry.status}`)
    if (entry.status === "blocked" && !entry.safeError && !entry.notes) {
      throw new Error(`lcm_provider_safe_blocked_without_reason_${entry.checkID}`)
    }
    for (const key of Object.keys(entry)) {
      if (!allowedFields.has(key as keyof ProviderSafeReportEntry)) {
        throw new Error(`lcm_provider_safe_unexpected_field_${entry.checkID}_${key}`)
      }
    }
  }

  for (const checkID of required) {
    if (!seen.has(checkID)) throw new Error(`lcm_provider_safe_missing_check_${checkID}`)
  }
  if (seen.size !== required.length) throw new Error("lcm_provider_safe_check_count_mismatch")
}

export async function validateProviderSafeReleaseSteps(entries: readonly ProviderSafeReleaseStepEntry[]) {
  const schema = await readProviderSafeReportSchema()
  const section = schema.releaseScenario
  const statusSet = new Set(schema.statusEnum)
  const required = section.requiredIDs
  const allowedFields = new Set(section.allowedFields)
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!required.includes(entry.stepID)) throw new Error(`lcm_provider_safe_unexpected_release_step_${entry.stepID}`)
    if (seen.has(entry.stepID)) throw new Error(`lcm_provider_safe_duplicate_release_step_${entry.stepID}`)
    seen.add(entry.stepID)
    if (!statusSet.has(entry.status)) throw new Error(`lcm_provider_safe_invalid_release_status_${entry.status}`)
    if (entry.status === "blocked" && !entry.safeError && !entry.notes) {
      throw new Error(`lcm_provider_safe_release_blocked_without_reason_${entry.stepID}`)
    }
    for (const key of Object.keys(entry)) {
      if (!allowedFields.has(key as keyof ProviderSafeReleaseStepEntry)) {
        throw new Error(`lcm_provider_safe_unexpected_release_field_${entry.stepID}_${key}`)
      }
    }
  }

  for (const stepID of required) {
    if (!seen.has(stepID)) throw new Error(`lcm_provider_safe_missing_release_step_${stepID}`)
  }
  if (seen.size !== required.length) throw new Error("lcm_provider_safe_release_step_count_mismatch")
}
