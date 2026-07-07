// kilocode_change - new file
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import type { ModelMessage } from "ai"
import { Effect, Layer } from "effect"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { LcmContext, Service as LcmContextService } from "../../src/session/lcm/context"
import { LcmDb } from "../../src/session/lcm/db"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import { MessageV2 } from "../../src/session/message-v2"
import {
  classifyLcmProviderFamily,
  lcmSafeOrHashedID,
  validateLcmFinalProviderPayload,
} from "../../src/session/lcm/provider-protocol"
import {
  LcmSafeErrorFailure,
  type ConversationID,
  type LcmDbRequest,
  type LcmPreparedProviderPayload,
  type LcmRenderInputManifestV1,
  type LcmRenderedSpan,
  type LcmSafeError,
  type LcmValidatedModelMessages,
  type OperationID,
} from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"
import { createHarnessBoundaryMetadata } from "./harness"

const operationID = "op_m39_provider_protocol" as OperationID
const conversationID = "conv_m39_provider_protocol" as ConversationID
const rawSentinel = "M39_RAW_PROVIDER_SENTINEL"

function request<T>(input: Omit<LcmDbRequest<T>, "operationID" | "purpose" | "lane">): Omit<LcmDbRequest<T>, "lane"> {
  return {
    operationID,
    purpose: "debug_support",
    run: input.run,
  }
}

async function initialize(dataDir: string) {
  const worker = createLcmDbWorker()
  const status = await worker.initialize({
    dataDir,
    runtimeMode: "source",
    schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
    smokeMode: true,
  })
  expect(status.status).toBe("ready")
  return worker
}

function contextLayer(worker: ReturnType<typeof createLcmDbWorker>) {
  const dbLayer = Layer.succeed(
    LcmDb.Service,
    LcmDb.Service.of({
      getStatus: () => Effect.sync(() => worker.getStatus()),
      initialize: (input) => Effect.promise(() => worker.initialize(input)),
      execute: (input) =>
        Effect.tryPromise({
          try: () => worker.execute(input),
          catch: (error) => error as LcmSafeError,
        }),
      executeForeground: (input) =>
        Effect.tryPromise({
          try: () => worker.executeForeground(input),
          catch: (error) => error as LcmSafeError,
        }),
      close: () => Effect.promise(() => worker.close()),
    }),
  )
  return LcmContext.layer.pipe(Layer.provide(dbLayer))
}

function runContext<A, E>(
  worker: ReturnType<typeof createLcmDbWorker>,
  effect: Effect.Effect<A, E, LcmContextService>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(contextLayer(worker))))
}

function fakeModel(input: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: (input.id ?? "model-m39") as ModelID,
    providerID: (input.providerID ?? "openai") as ProviderID,
    api: {
      id: input.api?.id ?? "chat",
      npm: input.api?.npm ?? "@ai-sdk/openai",
      url: input.api?.url ?? "https://example.invalid/provider",
    },
    name: "M39 Provider Protocol Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
      ...input.capabilities,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 8_192 },
    status: "active",
    options: input.options ?? {},
    headers: {},
    release_date: "2026-05-08",
    ...input,
  } as Provider.Model
}

function manifest(model: Provider.Model): LcmRenderInputManifestV1 {
  return {
    version: 1,
    rendererVersion: "test-renderer",
    renderPreparationVersion: "test-render-prep",
    sourceSelectionHash: "source-selection",
    requestSnapshotProtectionHash: "request-snapshot-protection",
    renderUnitOrderHash: "render-unit-order",
    effectivePlacementHash: "effective-placement",
    protectedSpanHash: "protected-span",
    providerTransformHash: "provider-transform-pre-m39",
    providerValidatorHash: "lcm-provider-validator-pending-m39-v1",
    assemblyValidatorHash: "assembly-validator",
    systemPromptVersion: "system-v1",
    systemPromptHash: "system-hash",
    toolSchemaVersion: "tool-v1",
    toolSchemaHash: "tool-hash",
    pluginTransformVersion: "plugin-v1",
    pluginTransformHash: "plugin-hash",
    dynamicPromptVersion: "dynamic-v1",
    dynamicPromptHash: "dynamic-hash",
    messageVisibilityVersion: "visibility-v1",
    messageVisibilityHash: "visibility-hash",
    providerMediaCapability: "supports_media",
    stripMedia: false,
    modelID: model.id,
    providerID: model.providerID,
    providerModelRevision: model.release_date,
    agentName: "code",
    taskCapabilityClass: "root",
    clockPolicy: "fixture_frozen",
  }
}

function spans(messages: readonly ModelMessage[]): LcmRenderedSpan[] {
  return messages.map((message, index) => ({
    renderUnitID: `ru_m39_${index}`,
    sourceKind: "raw_message",
    sourceHandle: `msg_row_m39_${index}`,
    canonicalOrder: index + 1,
    effectiveOrder: index + 1,
    placementSlot: index === messages.length - 1 && message.role === "user" ? "current_user" : "history",
    startIndex: index,
    messageCount: 1,
    protected: false,
    providerFamily: "openai_compatible",
    transformStage: "rendered",
    spanHash: `span_m39_${index}`,
  }))
}

function preparedPayload(model: Provider.Model, messages: readonly ModelMessage[]): LcmPreparedProviderPayload {
  return {
    operationID,
    conversationID,
    providerRequestSnapshotID: "rs_m39_provider_protocol",
    providerID: model.providerID,
    modelID: model.id,
    systemPromptHash: "system-hash",
    toolSchemaHash: "tool-hash",
    modelMessages: messages as unknown as LcmValidatedModelMessages,
    renderInputManifest: manifest(model),
    renderedSpans: spans(messages),
    assemblyValidatorHash: "assembly-validator",
  }
}

function transform(messages: readonly ModelMessage[], model: Provider.Model, options: Record<string, unknown> = {}) {
  return ProviderTransform.message(messages.map((message) => ({ ...message })) as ModelMessage[], model, options)
}

test("lcm:provider-protocol provider family classification follows fixture vectors", () => {
  const fixturePath = path.join(
    import.meta.dir,
    "../../../../specifications/fixtures/provider-safe-assembly/provider-family-classification-v1.json",
  )
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    cases: Array<{
      input: {
        providerID: string
        sdkPackage: string
        apiIdentity: string
        modelID: string
        capabilities: string[]
      }
      expectedFamily: string
    }>
  }
  for (const item of fixture.cases) {
    expect(
      classifyLcmProviderFamily({
        providerID: item.input.providerID,
        modelID: item.input.modelID,
        apiNpm: item.input.sdkPackage,
        apiID: item.input.apiIdentity,
        capabilities: item.input.capabilities,
      }),
    ).toBe(item.expectedFamily as ReturnType<typeof classifyLcmProviderFamily>)
  }
})

test("lcm:provider-protocol validates openai-compatible tool adjacency with content-safe projections", () => {
  const unsafeToolID = "call unsafe/秘密"
  const model = fakeModel({
    providerID: "local-compatible" as ProviderID,
    id: "custom-tool-model" as ModelID,
    api: { id: "chat", npm: "@ai-sdk/openai-compatible", url: "https://example.invalid/openai-compatible" },
  })
  const messages = [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: unsafeToolID, toolName: "read_file", input: {} }],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: unsafeToolID, toolName: "read_file", output: rawSentinel }],
    },
    { role: "user", content: `continue without exposing ${rawSentinel}` },
  ] as ModelMessage[]
  const validation = validateLcmFinalProviderPayload({
    preparedPayload: preparedPayload(model, messages),
    transformedMessages: transform(messages, model),
    model,
  })
  expect(validation.ok).toBe(true)
  if (!validation.ok) throw new Error(validation.safeError.diagnosticCode)
  expect(validation.finalProviderPayload.__lcmFinalProviderValidation).toBe(true)
  expect(validation.finalProviderValidatorHash).toStartWith("lcm-provider-validator-v1:")
  expect(validation.normalizedProjection.schemaVersion).toBe("lcm-normalized-provider-projection-v1")
  expect(JSON.stringify(validation.normalizedProjection)).not.toContain(rawSentinel)
  const toolCall = validation.normalizedProjection.items.find((item) => item.kind === "tool_call")
  expect(toolCall?.toolCallID?.kind).toBe("sha256")
  expect(lcmSafeOrHashedID("safe.ID-123")?.kind).toBe("safe")
  expect(lcmSafeOrHashedID("")?.kind).toBe("sha256")
})

test("lcm:provider-protocol fails closed before provider calls when tool results are missing", () => {
  const model = fakeModel()
  const messages = [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call_missing", toolName: "read_file", input: {} }],
    },
    { role: "user", content: "next turn" },
  ] as ModelMessage[]
  const validation = validateLcmFinalProviderPayload({
    preparedPayload: preparedPayload(model, messages),
    transformedMessages: transform(messages, model),
    model,
  })
  expect(validation.ok).toBe(false)
  if (validation.ok) throw new Error("expected validation failure")
  expect(validation.safeError.diagnosticCode).toBe("lcm_provider_protocol_tool_result_not_adjacent")
  const assistantError = MessageV2.fromError(new LcmSafeErrorFailure(validation.safeError), {
    providerID: model.providerID,
  })
  expect(assistantError).toMatchObject({
    name: "LcmMemoryError",
    data: {
      code: "invalid_request",
      templateKey: "lcm.request.invalid",
      diagnosticCode: "lcm_provider_protocol_tool_result_not_adjacent",
    },
  })
})

test("lcm:provider-protocol validates anthropic tool-use ordering after provider transform", () => {
  const model = fakeModel({
    providerID: "anthropic" as ProviderID,
    id: "claude-sonnet-4" as ModelID,
    api: { id: "messages", npm: "@ai-sdk/anthropic", url: "https://example.invalid/anthropic" },
  })
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "call.anthropic", toolName: "read_file", input: {} },
        { type: "text", text: "tool call note" },
      ],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call.anthropic", toolName: "read_file", output: "done" }],
    },
  ] as ModelMessage[]
  const transformed = transform(messages, model)
  const validation = validateLcmFinalProviderPayload({
    preparedPayload: preparedPayload(model, messages),
    transformedMessages: transformed,
    model,
  })
  expect(validation.ok).toBe(true)
  if (!validation.ok) throw new Error(validation.safeError.diagnosticCode)
  expect(validation.providerFamily).toBe("anthropic")
  expect(transformed.map((message) => message.role)).toEqual(["assistant", "assistant", "tool"])
})

test("lcm:provider-protocol includes mistral sequence repair as provider-transform overhead evidence", () => {
  const model = fakeModel({
    providerID: "mistral" as ProviderID,
    id: "devstral-medium" as ModelID,
    api: { id: "chat", npm: "@ai-sdk/mistral", url: "https://example.invalid/mistral" },
  })
  const messages = [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-mistral-001", toolName: "grep", input: {} }],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-mistral-001", toolName: "grep", output: "done" }],
    },
    { role: "user", content: "next user" },
  ] as ModelMessage[]
  const transformed = transform(messages, model)
  const validation = validateLcmFinalProviderPayload({
    preparedPayload: preparedPayload(model, messages),
    transformedMessages: transformed,
    model,
  })
  expect(validation.ok).toBe(true)
  if (!validation.ok) throw new Error(validation.safeError.diagnosticCode)
  expect(validation.providerFamily).toBe("mistral")
  expect(transformed.map((message) => message.role)).toEqual(["assistant", "tool", "assistant", "user"])
  expect(
    validation.normalizedProjection.items.some(
      (item) => item.kind === "provider_transform_overhead" && item.markerKind === "provider_transform_overhead",
    ),
  ).toBe(true)
  expect(validation.providerTransformOverheadTokenCount).toBeGreaterThan(0)
})

test("lcm:provider-protocol covers media fallback, large markers, zero-part assistants, and generic fallback", () => {
  const model = fakeModel({
    providerID: "unknown" as ProviderID,
    id: "plain" as ModelID,
    api: { id: "generic", npm: "@local/generic", url: "https://example.invalid/generic" },
    capabilities: {
      input: { text: true, audio: false, image: false, video: false, pdf: false },
    } as Provider.Model["capabilities"],
  })
  const messages = [
    { role: "assistant", content: [] },
    {
      role: "user",
      content: [
        { type: "image", image: "data:image/png;base64,abc" },
        { type: "text", text: "Inspect file_m39_large_marker without leaking raw text" },
      ],
    },
  ] as ModelMessage[]
  const validation = validateLcmFinalProviderPayload({
    preparedPayload: preparedPayload(model, messages),
    transformedMessages: transform(messages, model),
    model,
  })
  expect(validation.ok).toBe(true)
  if (!validation.ok) throw new Error(validation.safeError.diagnosticCode)
  expect(validation.providerFamily).toBe("generic")
  const markers = validation.normalizedProjection.items.map((item) => item.markerKind).filter(Boolean)
  expect(markers).toContain("media_fallback")
  expect(markers).toContain("large_file_marker")
  expect(JSON.stringify(validation.normalizedProjection)).not.toContain("Inspect")
})

test("lcm:provider-protocol records final provider validator hashes before SDK calls", async () => {
  await using tmp = await tmpdir()
  const worker = await initialize(path.join(tmp.path, "lcm"))
  try {
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
                session_directory,
                boundary_metadata_json,
                lifecycle_state,
                schema_version,
                feature_version,
                created_at_ms,
                updated_at_ms
              )
              VALUES ($1, 'ses_m39_provider_protocol', $1, 'project_m39', '/workspace/m39', $2::jsonb, 'lcm_active', 1, 1, 1, 1)
            `,
            [conversationID, JSON.stringify(createHarnessBoundaryMetadata({ projectID: "project_m39" }))],
          )
          await (db as PGlite).query(
            `
              INSERT INTO lcm_provider_request_snapshots (
                request_snapshot_id,
                operation_id,
                conversation_id,
                source_session_id,
                provider_id,
                model_id,
                status,
                cue_ids_json,
                render_unit_ids_json,
                source_selection_hash,
                request_snapshot_protection_hash,
                visibility_hash,
                protected_span_hash,
                provider_transform_hash,
                provider_validator_hash,
                created_at_ms,
                expires_at_ms,
                terminal_at_ms
              )
              VALUES (
                'rs_m39_final_validation',
                $1,
                $2,
                'ses_m39_provider_protocol',
                'openai',
                'model-m39',
                'in_flight',
                '[]'::jsonb,
                '[]'::jsonb,
                'source-selection',
                'request-snapshot-protection',
                'visibility',
                'protected-span',
                'provider-transform',
                NULL,
                1,
                1800001,
                NULL
              )
            `,
            [operationID, conversationID],
          )
        },
      }),
    )
    await runContext(
      worker,
      LcmContextService.use((svc) =>
        svc.recordProviderRequestSnapshotFinalValidation({
          requestSnapshotID: "rs_m39_final_validation",
          conversationID,
          providerValidatorHash: "lcm-provider-validator-v1:test",
          providerFamily: "openai_compatible",
          providerTransformOverheadTokenCount: 77,
        }),
      ),
    )
    await expect(
      runContext(
        worker,
        LcmContextService.use((svc) =>
          svc.recordProviderRequestSnapshotFinalValidation({
            requestSnapshotID: "rs_m39_final_validation",
            conversationID: "conv_m39_provider_protocol_other" as ConversationID,
            providerValidatorHash: "lcm-provider-validator-v1:wrong-conversation",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      diagnosticCode: "lcm_provider_request_snapshot_final_validation_unavailable",
    })
    const rows = await worker.executeForeground(
      request({
        run: async (db) =>
          (
            await (db as PGlite).query<{
              status: string
              provider_validator_hash: string | null
              max_observed_tokens: number | null
              sample_count: number | null
            }>(
              `
                SELECT
                  snapshot.status,
                  snapshot.provider_validator_hash,
                  overhead.max_observed_tokens,
                  overhead.sample_count
                FROM lcm_provider_request_snapshots snapshot
                LEFT JOIN lcm_provider_transform_overheads overhead
                  ON overhead.provider_id = snapshot.provider_id
                  AND overhead.model_id = snapshot.model_id
                  AND overhead.provider_family = 'openai_compatible'
                WHERE snapshot.request_snapshot_id = 'rs_m39_final_validation'
              `,
            )
          ).rows,
      }),
    )
    expect(rows[0]).toEqual({
      status: "in_flight",
      provider_validator_hash: "lcm-provider-validator-v1:test",
      max_observed_tokens: 77,
      sample_count: 1,
    })
  } finally {
    await worker.close()
  }
})
