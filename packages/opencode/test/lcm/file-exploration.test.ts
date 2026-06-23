// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs/promises"
import path from "node:path"
import { createLcmFileStatusEvent } from "../../src/session/lcm/events"
import {
  exploreLargeFileRow,
  LCM_FILE_EXPLORATION_PROMPT_VERSION,
  renderFileExplorationSummaryPrompt,
  updateLargeFileExplorationStatus,
  type LcmFileExplorationGeneratorInput,
} from "../../src/session/lcm/file-exploration"
import {
  addLargeFileMarkerContextItem,
  loadLargeFileStatus,
  registerMapArtifactFile,
  registerPathBackedFile,
} from "../../src/session/lcm/large-files"
import { resolveLcmDbLayout } from "../../src/session/lcm/db-layout"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { LcmRetrieval } from "../../src/session/lcm/retrieval"
import type { ConversationID, LcmFileID, OperationID } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"
import { initializeRetrievalWorker, queryRetrieval, request, runRetrieval } from "./retrieval-fixture"

const now = 1_777_700_240_000
const rootSessionID = "session_m24_root"
const rootConversationID = "conv_m24_root" as ConversationID

function operationID(suffix: string): OperationID {
  return `op_m24_${suffix}` as OperationID
}

async function seedConversation(
  worker: ReturnType<typeof initializeRetrievalWorker> extends Promise<infer T> ? T : never,
  root: string,
) {
  const canonicalRoot = await fs.realpath(root)
  const boundaryMetadata = createHarnessBoundaryMetadata({
    projectID: "project_m24",
    workspaceID: "workspace_m24",
    sessionDirectoryOriginal: root,
    sessionDirectoryCanonical: canonicalRoot,
    worktreeOriginal: root,
    worktreeCanonical: canonicalRoot,
    allowedRootOriginals: [root],
    allowedRootCanonicals: [canonicalRoot],
  })
  await worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
          `
            INSERT INTO lcm_conversations (
              conversation_id,
              source_session_id,
              root_conversation_id,
              project_id,
              workspace_id,
              session_directory,
              worktree_path,
              boundary_metadata_json,
              capability_class,
              orchestration_metadata_json,
              lifecycle_state,
              schema_version,
              feature_version,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, $1, 'project_m24', 'workspace_m24', $3, $3, $4::jsonb, 'root',
                    $5::jsonb, 'lcm_active', $6, 1, $7, $7)
          `,
          [
            rootConversationID,
            rootSessionID,
            canonicalRoot,
            JSON.stringify(boundaryMetadata),
            JSON.stringify({ version: 1, source: "kilo_session", capabilityClass: "root" }),
            LCM_DB_GATE_SCHEMA_VERSION,
            now,
          ],
        )
      },
    }),
  )
  return boundaryMetadata
}

async function registerArtifactFile(input: {
  worker: ReturnType<typeof initializeRetrievalWorker> extends Promise<infer T> ? T : never
  dataDir: string
  bytes: Buffer | Uint8Array | string
  stableSeed: string
  mimeType?: string | null
}) {
  return input.worker.executeForeground(
    request({
      run: (db) =>
        registerMapArtifactFile({
          db: db as PGlite,
          artifactRoot: resolveLcmDbLayout(input.dataDir).artifactsDir,
          conversationID: rootConversationID,
          sourceKind: "map_input",
          bytes: input.bytes,
          stableSeed: input.stableSeed,
          mimeType: input.mimeType,
          nowMs: now,
        }),
    }),
  )
}

async function updateStatus(input: {
  worker: ReturnType<typeof initializeRetrievalWorker> extends Promise<infer T> ? T : never
  fileID: LcmFileID
  outcome: Awaited<ReturnType<typeof exploreLargeFileRow>>
  usageRecordID?: string | null
}) {
  return input.worker.executeForeground(
    request({
      run: (db) =>
        updateLargeFileExplorationStatus({
          db: db as PGlite,
          fileID: input.fileID,
          status: input.outcome.explorationStatus,
          explorerKind: input.outcome.explorerKind,
          safeReason: input.outcome.safeReason,
          sampled: input.outcome.sampled,
          sampleBytes: input.outcome.sampleBytes,
          summaryText: input.outcome.summaryText ?? null,
          promptVersion: input.outcome.promptVersion ?? null,
          usageRecordID: input.usageRecordID ?? null,
          nowMs: now + 1,
        }),
    }),
  )
}

async function insertUsageRecord(input: {
  worker: ReturnType<typeof initializeRetrievalWorker> extends Promise<infer T> ? T : never
  usageRecordID: string
}) {
  await input.worker.executeForeground(
    request({
      run: async (db) => {
        await (db as PGlite).query(
          `
            INSERT INTO lcm_usage_records (
              usage_record_id,
              conversation_id,
              source_session_id,
              job_id,
              purpose,
              mode,
              provider_id,
              model_id,
              input_tokens,
              output_tokens,
              cost_status,
              created_at_ms
            )
            VALUES ($1, $2, $3, $4, 'file_exploration', 'explicit_exploration',
                    'provider_m24', 'model_m24', 11, 7, 'provider_reported', $5)
          `,
          [input.usageRecordID, rootConversationID, rootSessionID, operationID("provider"), now],
        )
      },
    }),
  )
}

test("lcm:explorer-safety text summaries persist status metadata and invalidate marker token caches", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedConversation(worker, tmp.path)
    const row = await registerArtifactFile({
      worker,
      dataDir,
      bytes: "export function m24Alpha() {\n  return 'M24_TEXT_SENTINEL'\n}\n",
      stableSeed: "text-summary",
      mimeType: "text/plain",
    })
    await worker.executeForeground(
      request({
        run: (db) =>
          addLargeFileMarkerContextItem({
            db: db as PGlite,
            conversationID: rootConversationID,
            fileID: row.file_id,
            nowMs: now,
          }),
      }),
    )
    const initialStatus = await worker.executeForeground(
      request({
        run: (db) => loadLargeFileStatus(db as PGlite, row.file_id),
      }),
    )
    expect(initialStatus).toMatchObject({ explorationStatus: "not_started", explorerKind: "none" })
    const queued = await worker.executeForeground(
      request({
        run: (db) =>
          updateLargeFileExplorationStatus({
            db: db as PGlite,
            fileID: row.file_id,
            status: "queued",
            explorerKind: "none",
            nowMs: now,
          }),
      }),
    )
    expect(queued).toMatchObject({ explorationStatus: "queued", explorerKind: "none" })
    const running = await worker.executeForeground(
      request({
        run: (db) =>
          updateLargeFileExplorationStatus({
            db: db as PGlite,
            fileID: row.file_id,
            status: "running",
            explorerKind: "none",
            nowMs: now,
          }),
      }),
    )
    expect(running).toMatchObject({ explorationStatus: "running", explorerKind: "none" })
    await worker.executeForeground(
      request({
        run: async (db) => {
          await (db as PGlite).query(
            `
              UPDATE lcm_context_items
              SET token_count = 99, cache_key = 'stale-cache', cache_version = 1
              WHERE file_id = $1
            `,
            [row.file_id],
          )
        },
      }),
    )

    const outcome = await exploreLargeFileRow({
      row,
      artifactRoot: resolveLcmDbLayout(dataDir).artifactsDir,
      operationID: operationID("text"),
      limits: { maxOutputTokens: 256 },
    })
    expect(outcome).toMatchObject({
      explorationStatus: "completed",
      explorerKind: "text",
      sampled: false,
    })
    expect(outcome.summaryText).toContain("M24_TEXT_SENTINEL")

    const status = await updateStatus({ worker, fileID: row.file_id, outcome })
    expect(status).toMatchObject({
      fileID: row.file_id,
      explorationStatus: "completed",
      explorerKind: "text",
      sampled: false,
      sampleBytes: Buffer.byteLength("export function m24Alpha() {\n  return 'M24_TEXT_SENTINEL'\n}\n"),
    })

    const stored = await queryRetrieval<{
      exploration_summary_text: string | null
      exploration_prompt_version: string | null
      exploration_usage_record_id: string | null
    }>(
      worker,
      `
        SELECT exploration_summary_text, exploration_prompt_version, exploration_usage_record_id
        FROM lcm_large_files
        WHERE file_id = $1
      `,
      [row.file_id],
    )
    expect(stored[0]?.exploration_summary_text).toContain("M24_TEXT_SENTINEL")
    expect(stored[0]?.exploration_prompt_version).toBeNull()
    expect(stored[0]?.exploration_usage_record_id).toBeNull()

    const markerCache = await queryRetrieval<{
      token_count: number | null
      cache_key: string | null
      cache_version: string | null
    }>(
      worker,
      `
        SELECT token_count, cache_key, cache_version
        FROM lcm_context_items
        WHERE file_id = $1
      `,
      [row.file_id],
    )
    expect(markerCache).toEqual([{ token_count: null, cache_key: null, cache_version: null }])
  } finally {
    await worker.close()
  }
})

test("lcm:explorer-safety provider-backed sampled summaries use the canonical prompt and usage linkage", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedConversation(worker, tmp.path)
    const row = await registerArtifactFile({
      worker,
      dataDir,
      bytes: `first line\n${"sampled-body ".repeat(200)}\nlast line`,
      stableSeed: "provider-summary",
      mimeType: "text/plain",
    })

    let generatorInput: LcmFileExplorationGeneratorInput | undefined
    const outcome = await exploreLargeFileRow({
      row,
      artifactRoot: resolveLcmDbLayout(dataDir).artifactsDir,
      operationID: operationID("provider"),
      limits: { maxFullLoadBytes: 32, sampleBytes: 24, maxOutputTokens: 96 },
      generator: async (input) => {
        generatorInput = input
        return {
          text: "provider summary for M24 sampled file",
          usage: {
            providerID: "provider_m24",
            modelID: "model_m24",
            inputTokens: 11,
            outputTokens: 7,
            costStatus: "provider_reported",
          },
        }
      },
    })

    expect(outcome).toMatchObject({
      explorationStatus: "sampled",
      explorerKind: "text",
      safeReason: "sampled",
      promptVersion: LCM_FILE_EXPLORATION_PROMPT_VERSION,
      usage: { providerID: "provider_m24", modelID: "model_m24", inputTokens: 11, outputTokens: 7 },
    })
    expect(generatorInput?.promptVersion).toBe(LCM_FILE_EXPLORATION_PROMPT_VERSION)
    expect(generatorInput?.prompt).toBe(renderFileExplorationSummaryPrompt(generatorInput?.fileSample ?? ""))
    expect(generatorInput?.prompt).toContain("Summarize the bounded file exploration data below")
    expect(generatorInput?.prompt).toContain("Do not claim full-file coverage when the input is sampled")
    expect(generatorInput?.request.messages.map((message) => message.role)).toEqual(["system", "user"])
    expect(generatorInput?.request.user).toContain("<untrusted_file_sample>")
    expect(generatorInput?.sampled).toBe(true)

    const failed = await exploreLargeFileRow({
      row,
      artifactRoot: resolveLcmDbLayout(dataDir).artifactsDir,
      operationID: operationID("provider_failed"),
      generator: async () => "",
    })
    expect(failed).toMatchObject({
      explorationStatus: "failed",
      explorerKind: "text",
      safeReason: "helper_failed",
    })

    await insertUsageRecord({ worker, usageRecordID: "usage_m24_file_exploration" })
    await updateStatus({
      worker,
      fileID: row.file_id,
      outcome,
      usageRecordID: "usage_m24_file_exploration",
    })

    const stored = await queryRetrieval<{
      exploration_status: string
      exploration_safe_reason: string | null
      exploration_summary_text: string | null
      exploration_prompt_version: string | null
      exploration_usage_record_id: string | null
    }>(
      worker,
      `
        SELECT exploration_status, exploration_safe_reason, exploration_summary_text,
               exploration_prompt_version, exploration_usage_record_id
        FROM lcm_large_files
        WHERE file_id = $1
      `,
      [row.file_id],
    )
    expect(stored[0]).toEqual({
      exploration_status: "sampled",
      exploration_safe_reason: "sampled",
      exploration_summary_text: "provider summary for M24 sampled file",
      exploration_prompt_version: LCM_FILE_EXPLORATION_PROMPT_VERSION,
      exploration_usage_record_id: "usage_m24_file_exploration",
    })
  } finally {
    await worker.close()
  }
})

test("lcm:explorer-safety HTML, helper-backed formats, binary inputs, timeout, cancellation, and limits fail safely", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    const boundaryMetadata = await seedConversation(worker, tmp.path)
    const artifactRoot = resolveLcmDbLayout(dataDir).artifactsDir

    const html = await registerArtifactFile({
      worker,
      dataDir,
      bytes: "<html><head><title>M24 title</title></head><body><h1>Heading</h1><p>body</p></body></html>",
      stableSeed: "html-safe",
      mimeType: "text/html",
    })
    const htmlOutcome = await exploreLargeFileRow({
      row: html,
      artifactRoot,
      operationID: operationID("html"),
      limits: { maxOutputTokens: 96 },
    })
    expect(htmlOutcome).toMatchObject({ explorationStatus: "completed", explorerKind: "html" })
    expect(htmlOutcome.summaryText).toContain("Title: M24 title")
    expect(htmlOutcome.summaryText).toContain("Headings: h1 Heading")

    const unsafeHtml = await registerArtifactFile({
      worker,
      dataDir,
      bytes: '<html><body><script>steal()</script><a href="javascript:steal()">x</a></body></html>',
      stableSeed: "html-unsafe",
      mimeType: "text/html",
    })
    const unsafeOutcome = await exploreLargeFileRow({
      row: unsafeHtml,
      artifactRoot,
      operationID: operationID("unsafe"),
    })
    expect(unsafeOutcome).toMatchObject({
      explorationStatus: "unsafe",
      explorerKind: "html",
      safeReason: "unsafe_active_content",
    })
    expect(unsafeOutcome.summaryText).toBeUndefined()

    const corruptText = await registerArtifactFile({
      worker,
      dataDir,
      bytes: "\u0001\u0002\u0003abcdef",
      stableSeed: "text-corrupt",
      mimeType: "text/plain",
    })
    const corruptOutcome = await exploreLargeFileRow({
      row: corruptText,
      artifactRoot,
      operationID: operationID("corrupt"),
    })
    expect(corruptOutcome).toMatchObject({
      explorationStatus: "corrupt",
      explorerKind: "text",
      safeReason: "corrupt_input",
    })

    const helperCases = [
      ["pdf", "application/pdf"],
      ["image", "image/png"],
      ["sqlite", "application/vnd.sqlite3"],
    ] as const
    const platformTargets = ["linux-x64", "win32-x64", "darwin-arm64", "darwin-x64"] as const
    for (const platformTarget of platformTargets) {
      for (const [kind, mimeType] of helperCases) {
        const row = await registerArtifactFile({
          worker,
          dataDir,
          bytes: `helper bytes ${platformTarget}`,
          stableSeed: `helper-${platformTarget}-${kind}`,
          mimeType,
        })
        const outcome = await exploreLargeFileRow({
          row,
          artifactRoot,
          operationID: operationID(`helper_${kind}`),
        })
        expect(outcome).toMatchObject({
          explorationStatus: "unavailable",
          explorerKind: kind,
          safeReason: "missing_helper",
        })
        expect(outcome.summaryText).toBeUndefined()
        expect(JSON.stringify(outcome)).not.toContain("helper bytes")
      }
    }

    const binaryPath = path.join(tmp.path, "binary.bin")
    await fs.writeFile(binaryPath, Buffer.from([0xff, 0xfe, 0xfd, 0xfc]))
    const binary = await worker.executeForeground(
      request({
        run: (db) =>
          registerPathBackedFile({
            db: db as PGlite,
            conversationID: rootConversationID,
            originalPath: binaryPath,
            boundaryMetadata,
            mimeType: null,
            nowMs: now,
          }),
      }),
    )
    const binaryOutcome = await exploreLargeFileRow({
      row: binary,
      artifactRoot,
      operationID: operationID("binary"),
      permissionCheck: () => "allowed",
    })
    expect(binaryOutcome).toMatchObject({
      explorationStatus: "unavailable",
      explorerKind: "unknown",
      safeReason: "unsupported_type",
    })

    const text = await registerArtifactFile({
      worker,
      dataDir,
      bytes: "timeout and cancellation sentinel",
      stableSeed: "terminal-states",
      mimeType: "text/plain",
    })
    await expect(
      exploreLargeFileRow({
        row: text,
        artifactRoot,
        operationID: operationID("timeout"),
        limits: { timeoutMs: 0 },
      }),
    ).resolves.toMatchObject({ explorationStatus: "timeout", safeReason: "timeout" })

    let generatorTimeoutAborted = false
    await expect(
      exploreLargeFileRow({
        row: text,
        artifactRoot,
        operationID: operationID("provider_timeout"),
        limits: { timeoutMs: 100 },
        generator: async (input) => {
          await new Promise<void>((resolve) => {
            input.abortSignal?.addEventListener(
              "abort",
              () => {
                generatorTimeoutAborted = true
                resolve()
              },
              { once: true },
            )
          })
          return "late provider summary"
        },
      }),
    ).resolves.toMatchObject({ explorationStatus: "timeout", safeReason: "timeout" })
    expect(generatorTimeoutAborted).toBe(true)

    const controller = new AbortController()
    controller.abort()
    await expect(
      exploreLargeFileRow({
        row: text,
        artifactRoot,
        operationID: operationID("canceled"),
        abortSignal: controller.signal,
      }),
    ).resolves.toMatchObject({ explorationStatus: "canceled", safeReason: "canceled" })

    const liveController = new AbortController()
    let releaseStarted: (() => void) | undefined
    const generatorStarted = new Promise<void>((resolve) => {
      releaseStarted = resolve
    })
    let generatorCancelAborted = false
    const canceledProvider = exploreLargeFileRow({
      row: text,
      artifactRoot,
      operationID: operationID("provider_canceled"),
      abortSignal: liveController.signal,
      generator: async (input) => {
        releaseStarted?.()
        await new Promise<void>((resolve) => {
          input.abortSignal?.addEventListener(
            "abort",
            () => {
              generatorCancelAborted = true
              resolve()
            },
            { once: true },
          )
        })
        return "late provider summary"
      },
    })
    await generatorStarted
    liveController.abort()
    await expect(canceledProvider).resolves.toMatchObject({ explorationStatus: "canceled", safeReason: "canceled" })
    expect(generatorCancelAborted).toBe(true)

    const nonCooperativeController = new AbortController()
    let releaseNonCooperativeStarted: (() => void) | undefined
    const nonCooperativeStarted = new Promise<void>((resolve) => {
      releaseNonCooperativeStarted = resolve
    })
    const nonCooperativeProvider = exploreLargeFileRow({
      row: text,
      artifactRoot,
      operationID: operationID("provider_noncoop_canceled"),
      abortSignal: nonCooperativeController.signal,
      generator: async () => {
        releaseNonCooperativeStarted?.()
        return new Promise<string>(() => {})
      },
    })
    await nonCooperativeStarted
    nonCooperativeController.abort()
    await expect(nonCooperativeProvider).resolves.toMatchObject({
      explorationStatus: "canceled",
      safeReason: "canceled",
    })

    await expect(
      exploreLargeFileRow({
        row: text,
        artifactRoot,
        operationID: operationID("over_limit"),
        limits: { overLimitBytes: 4 },
      }),
    ).resolves.toMatchObject({ explorationStatus: "over_limit", safeReason: "over_limit", sampleBytes: 0 })
  } finally {
    await worker.close()
  }
})

test("lcm:explorer-safety exploration summaries are marker-only and do not leak through retrieval or status events", async () => {
  await using tmp = await tmpdir({ git: true })
  const dataDir = path.join(tmp.path, "lcm")
  const worker = await initializeRetrievalWorker(dataDir)
  try {
    await seedConversation(worker, tmp.path)
    const row = await registerArtifactFile({
      worker,
      dataDir,
      bytes: "retrieval should search source previews but not exploration summaries",
      stableSeed: "retrieval-boundary",
      mimeType: "text/plain",
    })
    const sentinel = "M24_EXPLORATION_SUMMARY_ONLY_DO_NOT_LEAK"
    await updateStatus({
      worker,
      fileID: row.file_id,
      outcome: {
        fileID: row.file_id,
        conversationID: rootConversationID,
        explorationStatus: "completed",
        explorerKind: "text",
        sampled: false,
        sampleBytes: 12,
        summaryText: sentinel,
      },
    })

    const describe = await runRetrieval(
      worker,
      LcmRetrieval.describe({
        sessionID: rootSessionID,
        dataDir,
        id: row.file_id,
      }),
    )
    expect(describe).toMatchObject({ ok: true, kind: "file", explorationStatus: "completed" })
    expect(JSON.stringify(describe)).not.toContain(sentinel)

    const grep = await runRetrieval(
      worker,
      LcmRetrieval.grep({
        sessionID: rootSessionID,
        dataDir,
        pattern: sentinel,
        mode: "literal",
      }),
    )
    expect(grep).toMatchObject({ ok: true, results: [] })

    const storedSummary = await queryRetrieval<{
      exploration_summary_text: string | null
    }>(worker, "SELECT exploration_summary_text FROM lcm_large_files WHERE file_id = $1", [row.file_id])
    expect(storedSummary[0]?.exploration_summary_text).toBe(sentinel)
    const event = createLcmFileStatusEvent({
      sessionID: rootSessionID,
      conversationID: rootConversationID,
      operationID: operationID("event"),
      status: {
        fileID: row.file_id,
        sourceKind: row.source_kind,
        staleState: "current",
        explorationStatus: "completed",
        explorerKind: "text",
        sampled: false,
        sampleBytes: 12,
        blockingUse: false,
      },
    })
    expect(JSON.stringify(event)).not.toContain(sentinel)
    expect(JSON.stringify(event)).not.toContain("retrieval should search source previews")
  } finally {
    await worker.close()
  }
})
