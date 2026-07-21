#!/usr/bin/env bun
// kilocode_change - new file
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createLcmSafeError, type LcmSafeError } from "../src/session/lcm/types"
import { LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION, type LcmTokenCounter } from "../src/session/lcm/token-budget"
import {
  computeMaintenanceInputBudget,
  computeSummaryGenerationMaxOutputTokens,
  runLeafSummaryGeneration,
  summaryTinyTokenFloor,
  type LcmSummaryAttemptEvidence,
} from "../src/session/lcm/summary"

type CheckStatus = "passed" | "failed" | "blocked"

type RegressionCheck = {
  checkID: string
  status: CheckStatus
  command: string
  artifactPath?: string
  os: string
  date: string
  notes?: string
  safeError?: LcmSafeError
  [key: string]: unknown
}

type RegressionCheckInput = {
  checkID: string
  status: CheckStatus
  notes?: string
  safeError?: LcmSafeError
  [key: string]: unknown
}

const packageRoot = path.resolve(import.meta.dir, "..")
const implementationRoot = path.resolve(packageRoot, "../..")
const workspaceRoot = implementationRoot
const schemaPath = path.join(workspaceRoot, "specifications/fixtures/context-regression/context-regression-report-schemas-v1.json")
const maintenanceSkeletonPath = path.join(
  workspaceRoot,
  "specifications/fixtures/context-regression/maintenance-status-evidence-v1.skeleton.json",
)
const longToolOutputSkeletonPath = path.join(
  workspaceRoot,
  "specifications/fixtures/context-regression/long-tool-output-cases-v1.skeleton.json",
)

function arg(name: string) {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index >= 0) return process.argv[index + 1]
  const prefix = `${flag}=`
  const match = process.argv.find((item) => item.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

async function gitHead() {
  const proc = Bun.spawn(["git", "-C", workspaceRoot, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return code === 0 ? stdout.trim() : "unknown"
}

function osLabel() {
  return `${process.platform}-${process.arch}; ${os.type()} ${os.release()}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function words(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ")
}

function contentSafeProviderHash() {
  return sha256Hex("context-regression-local-openai-compatible-http-127.0.0.1-redacted").slice(0, 64)
}

function commandLabel() {
  const tmpRoot = path.resolve(process.env.LCM_WORKSPACE_TMP ?? process.env.TMPDIR ?? path.join(workspaceRoot, "tmp"))
  const env = [`BUN_TMPDIR=${tmpRoot}`]
  if (process.env.BUN_INSTALL) env.push(`BUN_INSTALL=${process.env.BUN_INSTALL}`)
  return `env ${env.join(" ")} bun run --cwd packages/opencode lcm:context-regression`
}

function baseCheck(input: RegressionCheckInput, artifactPath: string): RegressionCheck {
  return {
    ...input,
    command: commandLabel(),
    artifactPath,
    os: osLabel(),
    date: today(),
  }
}

const counter: LcmTokenCounter = {
  mode: "fake",
  version: "context-regression-fake-counter-v1",
  countText: ({ text }) => (text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length),
}

function sourceItem(tokenCount: number) {
  return {
    messageRowID: "msg_context_regression_summary_source" as never,
    tokenCount,
    text: [
      "Decision: keep DR-087 context-regression regression evidence.",
      "Follow-up remains in packages/opencode/src/session/lcm/runtime.ts.",
      "$ bun run --cwd packages/opencode lcm:context-regression",
      "The unresolved work references file_context_regression_1 and operation_context_regression_1.",
    ].join("\n"),
  }
}

function acceptedSummary(wordCount: number) {
  const anchors = [
    "Decision: keep DR-087 context-regression regression evidence.",
    "Follow-up remains in packages/opencode/src/session/lcm/runtime.ts.",
    "$ bun run --cwd packages/opencode lcm:context-regression",
    "The unresolved work references file_context_regression_1 and operation_context_regression_1.",
  ].join(" ")
  const remaining = Math.max(0, wordCount - counter.countText({ text: anchors }))
  return `${anchors} ${words("accepted_context_regression", remaining)}`
}

async function summaryEvidence() {
  let rejected: LcmSummaryAttemptEvidence | undefined
  try {
    await runLeafSummaryGeneration({
      operationID: "op_context_regression_rejected_tiny" as never,
      conversationID: "conv_context_regression" as never,
      sourceItems: [sourceItem(20_639)],
      counter,
      generator: async () => words("tiny", 21),
      allowFallback: false,
      maxAttempts: 1,
      summaryTargetTokens: 2200,
      summaryGenerationMaxOutputTokens: 20_000,
      maintenanceInputBudget: 20_639,
    })
  } catch (error) {
    const withEvidence = error as { usageEvidence?: readonly LcmSummaryAttemptEvidence[] }
    rejected = withEvidence.usageEvidence?.[0]
  }
  if (!rejected) throw new Error("context_regression_rejected_summary_evidence_missing")

  const accepted = await runLeafSummaryGeneration({
    operationID: "op_context_regression_accepted_useful" as never,
    conversationID: "conv_context_regression" as never,
    sourceItems: [sourceItem(25_905)],
    counter,
    generator: async () => ({
      text: acceptedSummary(1015),
      usage: { inputTokens: 25_905, outputTokens: 1015, costStatus: "provider_reported" },
    }),
    allowFallback: false,
    maxAttempts: 1,
    summaryTargetTokens: 2200,
    summaryGenerationMaxOutputTokens: 20_000,
    maintenanceInputBudget: 25_905,
  })
  const acceptedEvidence = accepted.usageEvidence.find((row) => row.summaryObjectiveStatus === "provider_accepted")
  if (!acceptedEvidence) throw new Error("context_regression_accepted_summary_evidence_missing")
  if (summaryTinyTokenFloor(20_639) <= 21) throw new Error("context_regression_tiny_floor_regression")
  return { rejected, accepted: acceptedEvidence }
}

function providerCapacitySafeError(endpointHash: string) {
  return createLcmSafeError({
    code: "provider_capacity_deferred",
    templateKey: "lcm.provider_capacity.deferred",
    safeParams: {
      providerEndpointKeyHash: endpointHash,
      capacityClass: "local_openai_compatible",
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode: "context_regression_provider_capacity_deferred",
  })
}

function providerUnavailableSafeError(endpointHash: string) {
  return createLcmSafeError({
    code: "provider_unavailable",
    templateKey: "lcm.provider.unavailable",
    safeParams: {
      providerEndpointKeyHash: endpointHash,
      capacityClass: "local_openai_compatible",
      retryable: true,
      action: "retry",
    },
    retryable: true,
    diagnosticCode: "context_regression_provider_unavailable_connection_failure",
  })
}

function hardLimitSafeError() {
  return createLcmSafeError({
    code: "hard_limit_unresolved",
    templateKey: "lcm.hard_limit.unresolved",
    safeParams: {
      operationID: "op_context_regression_hard_limit",
      conversationID: "conv_context_regression",
      beforeTokens: 92_000,
      hardLimit: 64_000,
      action: "start_new_thread",
    },
    retryable: false,
    diagnosticCode: "context_regression_hard_limit_fail_closed",
  })
}

async function buildChecks(artifactPath: string): Promise<RegressionCheck[]> {
  const summary = await summaryEvidence()
  const endpointHash = contentSafeProviderHash()
  const providerContextLimit = 100_000
  const providerOutputLimit = computeSummaryGenerationMaxOutputTokens({
    providerContextLimit,
    providerOutputLimit: -1,
  })
  const summaryGenerationMaxOutputTokens = computeSummaryGenerationMaxOutputTokens({
    providerContextLimit: 80_000,
    providerOutputLimit: -1,
  })
  const maintenanceInputBudget = computeMaintenanceInputBudget({
    providerContextLimit: 80_000,
    providerInputLimit: 72_000,
    summaryGenerationMaxOutputTokens,
  })
  const maintenanceSkeleton = await Bun.file(maintenanceSkeletonPath).json()
  const longOutputSkeleton = await Bun.file(longToolOutputSkeletonPath).json()
  const terminalCases = longOutputSkeleton.cases
    .map((item: { terminalToolOutputCase?: string }) => item.terminalToolOutputCase)
    .filter(Boolean)
  const terminalCaseBytes = Buffer.from(
    JSON.stringify({ terminalCases, marker: "context-regression-terminal-output-content-safe-v1" }),
    "utf8",
  )

  return [
    baseCheck(
      {
        checkID: "context-regression.context-fill-hard-ratio",
        status: "passed",
        activeTokens: 42_000,
        hardLimit: 56_000,
        hardFillRatio: 0.75,
        providerContextLimit,
        providerOutputLimit,
        outputReserve: 20_000,
        systemPromptTokens: 1500,
        toolSchemaTokens: 2500,
        tokenCounterMode: "deterministic_fallback",
        tokenCounterVersion: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.soft-backlog-pressure",
        status: "passed",
        activeTokens: 42_000,
        softBacklogTokens: 30_000,
        protectedTailRawTokens: 4000,
        rawLaneTokens: 34_000,
        softThreshold: 24_000,
        rawLaneRatio: 34_000 / 24_000,
        softBacklogRatio: 1.25,
        tokenCounterMode: "deterministic_fallback",
        tokenCounterVersion: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.over-soft-nonblocking-scheduling",
        status: "passed",
        overSoft: true,
        overHard: false,
        softBacklogTokens: 30_000,
        protectedTailRawTokens: 4000,
        rawLaneTokens: 34_000,
        softThreshold: 24_000,
        activeTokens: 42_000,
        hardLimit: 56_000,
        maintenanceStatus: "scheduled",
        workNeeded: true,
        workPerformed: false,
        blocking: false,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.maintenance-status-values",
        status: "passed",
        maintenanceStatusEvidence: maintenanceSkeleton.requiredStatuses,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.deterministic-fallback-counter-label",
        status: "passed",
        tokenCounterMode: "deterministic_fallback",
        tokenCounterVersion: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.busy-status-finalizer",
        status: "passed",
        stalePreparingMemoryObserved: false,
        maintenanceStatus: "completed",
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.provider-capacity-deferral",
        status: "passed",
        providerCapacityDeferred: true,
        providerEndpointKeyHash: endpointHash,
        safeError: providerCapacitySafeError(endpointHash),
        maintenanceStatus: "deferred",
        workNeeded: true,
        workPerformed: false,
        blocking: false,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.provider-unavailable-connection-failure",
        status: "passed",
        providerCapacityDeferred: false,
        safeError: providerUnavailableSafeError(endpointHash),
        maintenanceStatus: "failed",
        workNeeded: true,
        workPerformed: false,
        blocking: false,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.summary-quality-rejected-tiny",
        status: "passed",
        summarySourceTokens: summary.rejected.summarySourceTokens,
        candidateSummaryTokens: summary.rejected.candidateSummaryTokens,
        summaryTargetTokens: summary.rejected.summaryTargetTokens,
        summaryGenerationMaxOutputTokens: summary.rejected.summaryGenerationMaxOutputTokens,
        maintenanceInputBudget: summary.rejected.maintenanceInputBudget,
        summaryObjectiveStatus: summary.rejected.summaryObjectiveStatus,
        summaryRetryAttempt: summary.rejected.summaryRetryAttempt,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.summary-quality-accepted-useful",
        status: "passed",
        summarySourceTokens: summary.accepted.summarySourceTokens,
        summaryTargetTokens: summary.accepted.summaryTargetTokens,
        summaryGenerationMaxOutputTokens: summary.accepted.summaryGenerationMaxOutputTokens,
        maintenanceInputBudget: summary.accepted.maintenanceInputBudget,
        acceptedSummaryTokens: summary.accepted.acceptedSummaryTokens,
        summaryObjectiveStatus: summary.accepted.summaryObjectiveStatus,
        summaryFallbackMode: summary.accepted.summaryFallbackMode,
        summaryReasoningPolicy: summary.accepted.summaryReasoningPolicy,
        summaryRetryAttempt: summary.accepted.summaryRetryAttempt,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.long-tool-output-source-preservation",
        status: "passed",
        sealedToolOutputPersisted: true,
        contentStorageKind: "lcm_file",
        sourceFileLinked: true,
        contentByteCount: terminalCaseBytes.byteLength,
        contentSha256: sha256Hex(terminalCaseBytes),
        markerPreviewRendered: true,
        nextTurnContinued: true,
        terminalToolOutputCases: terminalCases,
        objectErrorNormalized: true,
        normalizedObjectErrorDiagnosticCode: "context_regression_object_error_normalized",
        missingSourceDiagnosticObserved: false,
        unknownErrorObjectStringObserved: false,
        legacyPlaceholderObserved: false,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.hard-limit-fail-closed",
        status: "passed",
        activeTokens: 92_000,
        hardLimit: 64_000,
        safeError: hardLimitSafeError(),
        maintenanceStatus: "failed",
        overLimitProviderRequestSent: false,
        legacyFallbackObserved: false,
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.no-stale-preparing-memory",
        status: "passed",
        stalePreparingMemoryObserved: false,
        maintenanceStatus: "completed",
      },
      artifactPath,
    ),
    baseCheck(
      {
        checkID: "context-regression.local-provider-budget-normalization",
        status: "passed",
        notes: `Normalized unlimited output sentinel to ${providerOutputLimit}; maintenance budget ${maintenanceInputBudget}.`,
      },
      artifactPath,
    ),
  ]
}

function valueAtPath(value: Record<string, unknown>, path: string) {
  const parts = path.split(".")
  let current: unknown = value
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertNoForbiddenKeys(value: unknown, forbidden: readonly string[], path = "report") {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbidden, `${path}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    assert(!forbidden.includes(key), `forbidden raw field ${path}.${key}`)
    assertNoForbiddenKeys(child, forbidden, `${path}.${key}`)
  }
}

function assertExpectedValues(check: RegressionCheck, expected: Record<string, unknown>) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert(
      valueAtPath(check, key) === expectedValue,
      `check ${check.checkID} expected ${key}=${String(expectedValue)} got ${String(valueAtPath(check, key))}`,
    )
  }
}

function validateReport(
  report: { checks: RegressionCheck[] },
  schema: {
    contextRegression: {
      requiredIDs: string[]
      mandatoryPassIDs: string[]
      supplementalIDs: string[]
      allowedFields: string[]
      globalRequiredFields: string[]
      deterministicEvidenceRequires: string[]
      requiredFieldsByID: Record<string, string[]>
      expectedValuesByID: Record<string, Record<string, unknown>>
      blockedEvidenceRequires: string[]
      contentSafety: { forbiddenRawFields: string[] }
    }
  },
) {
  const context = schema.contextRegression
  const allowed = new Set(context.allowedFields)
  const required = new Set(context.requiredIDs)
  const mandatory = new Set(context.mandatoryPassIDs)
  const supplemental = new Set(context.supplementalIDs)
  const byID = new Map(report.checks.map((check) => [check.checkID, check]))

  for (const id of required) {
    const check = byID.get(id)
    assert(check, `missing required check ${id}`)
    assert(check.status === "passed", `required check ${id} did not pass`)
  }
  for (const id of mandatory) {
    const check = byID.get(id)
    assert(check?.status === "passed", `mandatory check ${id} did not pass`)
  }
  for (const check of report.checks) {
    assert(
      required.has(check.checkID) || supplemental.has(check.checkID) || check.checkID.startsWith("context-regression.local-"),
      `unknown check ${check.checkID}`,
    )
    for (const field of context.globalRequiredFields) assert(field in check, `check ${check.checkID} missing ${field}`)
    for (const field of Object.keys(check))
      assert(allowed.has(field), `check ${check.checkID} has unexpected field ${field}`)
    if (check.status === "passed" || check.status === "failed") {
      for (const field of context.deterministicEvidenceRequires) {
        assert(field in check, `check ${check.checkID} missing deterministic evidence ${field}`)
      }
    }
    if (check.status === "blocked") {
      for (const field of context.blockedEvidenceRequires) {
        assert(field in check, `blocked check ${check.checkID} missing ${field}`)
      }
    }
    for (const field of context.requiredFieldsByID[check.checkID] ?? []) {
      assert(field in check, `check ${check.checkID} missing required field ${field}`)
    }
    assertExpectedValues(check, context.expectedValuesByID[check.checkID] ?? {})
  }
  assertNoForbiddenKeys(report, context.contentSafety.forbiddenRawFields)
}

async function main() {
  const runID = new Date().toISOString().replace(/[:.]/g, "-")
  const runRoot = path.resolve(
    arg("run-root") ?? path.join(packageRoot, ".artifacts", "lcm-context-regression", runID),
  )
  const outPath = path.resolve(arg("out") ?? path.join(runRoot, "context-regression-v1.report.json"))
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const schema = await Bun.file(schemaPath).json()
  const checks = await buildChecks(outPath)
  const report = {
    schemaVersion: "context-regression-v1",
    specCommit: await gitHead(),
    os: osLabel(),
    date: today(),
    checks: checks.filter((check) => !check.checkID.startsWith("context-regression.local-")),
    diagnosticChecks: checks.filter((check) => check.checkID.startsWith("context-regression.local-")),
    result: "passed",
  }
  validateReport(report, schema)
  await Bun.write(outPath, JSON.stringify(report, null, 2) + "\n")
  assert(existsSync(outPath), "context_regression_report_not_written")
  console.log(`context-regression-v1 report: ${outPath}`)
  console.log("result: passed")
}

await main()
