// kilocode_change - new file
import { createHash } from "node:crypto"
import type { ModelMessage, Tool as AITool } from "ai"
import { Effect } from "effect"
import type { Agent } from "@/agent/agent"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { Permission } from "@/permission"
import type { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"
import { PartID, SessionID } from "@/session/schema"
import type { Info as SessionInfo } from "@/session/session"
import { computeLcmProviderTransformHash } from "./provider-protocol"
import { canonicalJson } from "./validators"
import {
  createLcmSafeError,
  type LcmConversationCapabilityClass,
  type LcmRenderInputManifestV1,
  type LcmRenderedSpanSourceKind,
  type LcmRenderOnlyHelperKind,
  type LcmSafeError,
  type OperationID,
} from "./types"

export const LCM_RENDERER_VERSION = "message-v2-to-model-messages-v1"
export const LCM_RENDER_PREPARATION_VERSION = "lcm-render-preparation-v1"
export const LCM_SYSTEM_PROMPT_VERSION = "kilo-system-prompt-render-v1"
export const LCM_TOOL_SCHEMA_VERSION = "kilo-tool-schema-render-v1"
export const LCM_PLUGIN_TRANSFORM_VERSION = "kilo-experimental-chat-messages-transform-v1"
export const LCM_DYNAMIC_PROMPT_VERSION = "kilo-dynamic-prompt-render-v1"
export const LCM_MESSAGE_VISIBILITY_VERSION = "kilo-prompt-queue-visibility-v1"

export const LCM_RENDER_ONLY_HELPER_PRODUCERS = [
  "kilo.session.prompt-queue",
  "kilo.session.prompt",
  "kilo.editor-context",
  "opencode.message-v2.renderer",
  "opencode.provider.media-fallback",
  "opencode.plugin.transform",
  "opencode.tool-description-placement",
] as const

export type LcmRenderOnlyHelperProducer = (typeof LCM_RENDER_ONLY_HELPER_PRODUCERS)[number]

export interface LcmRenderOnlyMetadata {
  readonly kind: LcmRenderOnlyHelperKind
  readonly producer: LcmRenderOnlyHelperProducer
  readonly operationID: OperationID
  readonly createdAtMs: number
  readonly clonedPartID: string
  readonly clonedMessageID: string
}

export interface LcmRenderOriginMetadata {
  readonly schemaVersion: "lcm-render-origin-v1"
  readonly renderUnitID: string
  readonly sourceKind: LcmRenderedSpanSourceKind
  readonly sourceHandle?: string
  readonly clonedMessageID: string
  readonly clonedPartID?: string
  readonly sourceMessageID?: string
  readonly sourcePartID?: string
  readonly classification: "source_bearing"
}

type LcmRenderMetadataCarrier = {
  lcmRenderOnly?: LcmRenderOnlyMetadata
  lcmRenderOrigin?: LcmRenderOriginMetadata
}

export type LcmRenderPrepClockPolicy = "runtime_per_preparation" | "fixture_frozen"

export interface LcmRenderPrepClock {
  readonly now: () => number | Date
  readonly policy?: LcmRenderPrepClockPolicy
}

export interface LcmMessageVisibilityInput {
  readonly version: string
  readonly hash: string
  readonly visibleMessageIDs: readonly string[]
  readonly hiddenMessageIDs: readonly string[]
  readonly queueVersion?: number
  readonly targetBaseMessageID?: string
  readonly targetExtraMessageIDs?: readonly string[]
}

export interface LcmRenderPreparationDriftReportV1 {
  readonly schemaVersion: "closure-render-preparation-v1"
  readonly rendererVersion: string
  readonly renderPreparationVersion: string
  readonly sourcePaths: readonly string[]
  readonly preparationOrder: readonly string[]
  readonly pluginHook: {
    readonly name: "experimental.chat.messages.transform"
    readonly version: string
    readonly transformHash: string
  }
  readonly queueVisibility: {
    readonly version: string
    readonly hash: string
    readonly visibleMessageCount: number
    readonly hiddenMessageCount: number
  }
  readonly timeSources: {
    readonly clockPolicy: LcmRenderPrepClockPolicy
    readonly clockHash: string
    readonly systemDateSource: "SystemPrompt.environment"
    readonly editorContextTimeSource: "KiloSessionPrompt.injectEditorContext"
  }
  readonly manifestFields: readonly (keyof LcmRenderInputManifestV1)[]
  readonly contentSafety: {
    readonly rawContentPolicy: "hashes_counts_enums_only"
    readonly rawContentFieldsSerialized: false
  }
  readonly counts: {
    readonly sourceMessages: number
    readonly preparedMessages: number
    readonly toolCount: number
    readonly systemPartCount: number
    readonly modelMessageCount: number
  }
  readonly unmappedPromptMutations: readonly string[]
}

export interface LcmPreparedRenderInput {
  readonly messages: MessageV2.WithParts[]
  readonly system: string[]
  readonly tools: Record<string, AITool>
  readonly format: MessageV2.OutputFormat
  readonly toolChoice?: "required"
  readonly modelMessages: ModelMessage[]
  readonly renderInputManifest: LcmRenderInputManifestV1
  readonly driftReport: LcmRenderPreparationDriftReportV1
  readonly providerMediaCapability: LcmRenderInputManifestV1["providerMediaCapability"]
  readonly stripMedia: boolean
  readonly clockMs: number
}

export interface PrepareKiloModelInput {
  readonly sessionID: SessionID
  readonly session: SessionInfo
  readonly messages: MessageV2.WithParts[]
  readonly lastUser: MessageV2.User
  readonly operationID?: OperationID
  readonly agent: Agent.Info
  readonly model: Provider.Model
  readonly permissionProfile?: Permission.Ruleset
  readonly taskCapabilityClass?: LcmConversationCapabilityClass
  readonly messageVisibility?: LcmMessageVisibilityInput
  readonly envCache: KiloSessionPrompt.EnvCache
  readonly clock?: LcmRenderPrepClock
  readonly stripMedia?: boolean
  readonly format?: MessageV2.OutputFormat
  readonly isLastStep?: boolean
  readonly maxStepMessage?: string
  readonly lcmActive?: boolean
  readonly prepareRenderOnlyMessages?: (input: {
    messages: MessageV2.WithParts[]
    clockMs: number
    operationID: OperationID
  }) => Effect.Effect<MessageV2.WithParts[], LcmSafeError | never>
  readonly transformMessages?: (input: {
    messages: MessageV2.WithParts[]
    clockMs: number
    operationID: OperationID
  }) => Effect.Effect<void, LcmSafeError | never>
  readonly resolveSystem: (input: {
    messages: MessageV2.WithParts[]
    clockMs: number
    operationID: OperationID
  }) => Effect.Effect<string[], LcmSafeError | never>
  readonly resolveTools: (input: {
    messages: MessageV2.WithParts[]
    clockMs: number
    operationID: OperationID
  }) => Effect.Effect<Record<string, AITool>, LcmSafeError | never>
  readonly structuredOutputTool?: (input: {
    format: Extract<MessageV2.OutputFormat, { type: "json_schema" }>
  }) => AITool
}

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function hashValue(value: unknown) {
  return sha256Hex(canonicalJson(value))
}

function hashText(value: string) {
  return sha256Hex(value)
}

function cloneMessageBatch(messages: MessageV2.WithParts[]) {
  return messages.map((message) => ({
    info: structuredClone(message.info),
    parts: message.parts.map((part) => structuredClone(part)),
  }))
}

function normalizeForHash(value: unknown): unknown {
  if (typeof value === "function") return "[function]"
  if (typeof value === "symbol") return String(value)
  if (typeof value === "bigint") return value.toString()
  if (value === undefined || value === null) return value ?? null
  if (Array.isArray(value)) return value.map(normalizeForHash)
  if (typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    output[key] = normalizeForHash((value as Record<string, unknown>)[key])
  }
  return output
}

function contentHash(value: unknown) {
  return hashValue(normalizeForHash(value))
}

function partContentHashes(part: MessageV2.Part) {
  if (part.type === "text") return { textHash: hashText(part.text) }
  if (part.type === "reasoning") return { reasoningHash: hashText(part.text) }
  if (part.type === "file") {
    return {
      fileURLHash: hashText(part.url),
      mime: part.mime,
      filenameHash: part.filename ? hashText(part.filename) : undefined,
      sourceHash: part.source ? contentHash(part.source) : undefined,
    }
  }
  if (part.type === "tool") {
    return {
      tool: part.tool,
      callID: part.callID,
      state: part.state.status,
      inputHash: "input" in part.state ? contentHash(part.state.input) : undefined,
      outputHash: part.state.status === "completed" ? hashText(part.state.output) : undefined,
      errorHash: part.state.status === "error" ? hashText(part.state.error) : undefined,
      metadataHash: contentHash(part.metadata ?? {}),
    }
  }
  return { payloadHash: contentHash(normalizeForHash(part)) }
}

function messageBatchHash(messages: MessageV2.WithParts[]) {
  return hashValue(
    messages.map((message) => ({
      id: message.info.id,
      role: message.info.role,
      parentID: message.info.role === "assistant" ? message.info.parentID : undefined,
      providerID: message.info.role === "assistant" ? message.info.providerID : message.info.model.providerID,
      modelID: message.info.role === "assistant" ? message.info.modelID : message.info.model.modelID,
      agent: message.info.agent,
      ignored: "ignored" in message.info ? message.info.ignored === true : false,
      synthetic: "synthetic" in message.info ? message.info.synthetic === true : false,
      compatibility: "compatibility" in message.info ? message.info.compatibility === true : false,
      parts: message.parts.map((part) => ({
        id: part.id,
        type: part.type,
        ignored: "ignored" in part ? part.ignored === true : false,
        synthetic: "synthetic" in part ? part.synthetic === true : false,
        compatibility: "compatibility" in part ? part.compatibility === true : false,
        content: partContentHashes(part),
      })),
    })),
  )
}

function sourcePartIDSet(messages: MessageV2.WithParts[]) {
  const ids = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) ids.add(part.id)
  }
  return ids
}

function stableRenderPartID(input: { messageID: string; partOrder: number; part: MessageV2.Part }) {
  return PartID.make(
    `prt_lcm_render_${hashValue({
      messageID: input.messageID,
      partOrder: input.partOrder,
      type: input.part.type,
      content: partContentHashes(input.part),
    }).slice(0, 32)}`,
  )
}

function fallbackOperationID(input: { clockMs: number; sessionID: SessionID }) {
  return `op_lcm_render_${hashValue(input).slice(0, 24)}` as OperationID
}

function isRenderOnlyProducer(value: unknown): value is LcmRenderOnlyHelperProducer {
  return typeof value === "string" && LCM_RENDER_ONLY_HELPER_PRODUCERS.includes(value as LcmRenderOnlyHelperProducer)
}

function isRenderOnlyKind(value: unknown): value is LcmRenderOnlyHelperKind {
  return (
    value === "dynamic_editor_context" ||
    value === "environment_details" ||
    value === "plan_reminder" ||
    value === "plan_followup" ||
    value === "code_switch_reminder" ||
    value === "max_step" ||
    value === "close_reason" ||
    value === "plugin_transform" ||
    value === "tool_description_placement" ||
    value === "provider_media_fallback"
  )
}

function carrier(value: unknown): LcmRenderMetadataCarrier {
  return (value ?? {}) as LcmRenderMetadataCarrier
}

export function getLcmRenderOnlyMetadata(value: unknown) {
  return carrier(value).lcmRenderOnly
}

export function getLcmRenderOriginMetadata(value: unknown) {
  return carrier(value).lcmRenderOrigin
}

export function markLcmRenderOnlyPart(
  part: MessageV2.Part,
  input: {
    kind: LcmRenderOnlyHelperKind
    producer: LcmRenderOnlyHelperProducer
    operationID: OperationID
    createdAtMs: number
    clonedPartID?: string
    clonedMessageID?: string
  },
) {
  carrier(part).lcmRenderOnly = {
    kind: input.kind,
    producer: input.producer,
    operationID: input.operationID,
    createdAtMs: input.createdAtMs,
    clonedPartID: input.clonedPartID ?? part.id,
    clonedMessageID: input.clonedMessageID ?? part.messageID,
  }
  delete carrier(part).lcmRenderOrigin
  return part
}

export function attachLcmRenderOriginToMessage(
  message: MessageV2.WithParts,
  input: {
    renderUnitID: string
    sourceKind: LcmRenderedSpanSourceKind
    sourceHandle?: string
  },
) {
  carrier(message.info).lcmRenderOrigin = {
    schemaVersion: "lcm-render-origin-v1",
    renderUnitID: input.renderUnitID,
    sourceKind: input.sourceKind,
    sourceHandle: input.sourceHandle,
    clonedMessageID: message.info.id,
    sourceMessageID: message.info.id,
    classification: "source_bearing",
  }
  for (const part of message.parts) {
    carrier(part).lcmRenderOrigin = {
      schemaVersion: "lcm-render-origin-v1",
      renderUnitID: input.renderUnitID,
      sourceKind: input.sourceKind,
      sourceHandle: input.sourceHandle,
      clonedMessageID: message.info.id,
      clonedPartID: part.id,
      sourceMessageID: message.info.id,
      sourcePartID: part.id,
      classification: "source_bearing",
    }
  }
  return message
}

function validateRenderOnlyMetadata(input: { metadata: LcmRenderOnlyMetadata | undefined; part: MessageV2.Part }) {
  const metadata = input.metadata
  if (!metadata) return "lcm_render_prep_prompt_helper_metadata_missing"
  if (!isRenderOnlyKind(metadata.kind)) return "lcm_render_prep_prompt_helper_unknown_kind"
  if (!isRenderOnlyProducer(metadata.producer)) return "lcm_render_prep_prompt_helper_unknown_producer"
  if (typeof metadata.operationID !== "string" || !metadata.operationID.startsWith("op_")) {
    return "lcm_render_prep_prompt_helper_invalid_operation"
  }
  if (!Number.isFinite(metadata.createdAtMs)) return "lcm_render_prep_prompt_helper_invalid_created_at"
  if (metadata.clonedPartID !== input.part.id) return "lcm_render_prep_prompt_helper_part_binding_mismatch"
  if (metadata.clonedMessageID !== input.part.messageID) return "lcm_render_prep_prompt_helper_message_binding_mismatch"
  return undefined
}

function normalizeNewRenderOnlyPartIDs(messages: MessageV2.WithParts[], sourcePartIDs: ReadonlySet<string>) {
  for (const message of messages) {
    message.parts = message.parts.map((part, index) => {
      if (sourcePartIDs.has(part.id)) return part
      const normalized = {
        ...part,
        id: stableRenderPartID({ messageID: message.info.id, partOrder: index + 1, part }),
      } as MessageV2.Part
      const metadata = getLcmRenderOnlyMetadata(normalized)
      if (metadata) {
        carrier(normalized).lcmRenderOnly = {
          ...metadata,
          clonedPartID: normalized.id,
          clonedMessageID: normalized.messageID,
        }
      }
      return normalized
    })
  }
}

function markUnclassifiedNewRenderOnlyParts(
  messages: MessageV2.WithParts[],
  sourcePartIDs: ReadonlySet<string>,
  input: {
    kind: LcmRenderOnlyHelperKind
    producer: LcmRenderOnlyHelperProducer
    operationID: OperationID
    createdAtMs: number
  },
) {
  for (const message of messages) {
    for (const part of message.parts) {
      if (sourcePartIDs.has(part.id) || getLcmRenderOnlyMetadata(part) || getLcmRenderOriginMetadata(part)) continue
      markLcmRenderOnlyPart(part, {
        kind: input.kind,
        producer: input.producer,
        operationID: input.operationID,
        createdAtMs: input.createdAtMs,
      })
    }
  }
}

function currentClock(input?: LcmRenderPrepClock) {
  const value = input?.now() ?? Date.now()
  return value instanceof Date ? value.getTime() : value
}

function mediaCapability(model: Provider.Model): LcmRenderInputManifestV1["providerMediaCapability"] {
  if (model.capabilities.attachment === true) return "supports_media"
  if (model.capabilities.attachment === false) return "text_only"
  return "unknown"
}

function permissionProfileVersion(permissionProfile?: Permission.Ruleset) {
  return `sha256:${hashValue(permissionProfile ?? [])}`
}

function defaultVisibility(messages: MessageV2.WithParts[]): LcmMessageVisibilityInput {
  const visibleMessageIDs = messages.map((message) => message.info.id)
  return {
    version: LCM_MESSAGE_VISIBILITY_VERSION,
    hash: hashValue({ visibleMessageIDs, hiddenMessageIDs: [] }),
    visibleMessageIDs,
    hiddenMessageIDs: [],
  }
}

export function prepareKiloMessageVisibility(input: { sessionID: SessionID; messages: MessageV2.WithParts[] }): {
  messages: MessageV2.WithParts[]
  visibility: LcmMessageVisibilityInput
} {
  const beforeIDs = input.messages.map((message) => message.info.id)
  const scoped = KiloSessionPromptQueue.scope(input.sessionID, input.messages)
  const visibleMessageIDs = scoped.map((message) => message.info.id)
  const visible = new Set(visibleMessageIDs)
  const hiddenMessageIDs = beforeIDs.filter((id) => !visible.has(id))
  const snapshot = KiloSessionPromptQueue.snapshot(input.sessionID)
  return {
    messages: scoped,
    visibility: {
      version: LCM_MESSAGE_VISIBILITY_VERSION,
      hash: hashValue({
        beforeIDs,
        visibleMessageIDs,
        hiddenMessageIDs,
        snapshot,
      }),
      visibleMessageIDs,
      hiddenMessageIDs,
      queueVersion: snapshot.version,
      targetBaseMessageID: snapshot.targetBaseMessageID,
      targetExtraMessageIDs: snapshot.targetExtraMessageIDs,
    },
  }
}

export type LcmPromptPartClassification = "durable_source" | "render_only_prompt_helper"

export function classifyPromptRenderPart(part: MessageV2.Part): LcmPromptPartClassification {
  return getLcmRenderOnlyMetadata(part) ? "render_only_prompt_helper" : "durable_source"
}

function renderPrepSourceError(diagnosticCode: string): LcmSafeError {
  return createLcmSafeError({
    code: "missing_source",
    templateKey: "lcm.recovery.missing_source",
    safeParams: { action: "repeat_input" },
    retryable: false,
    diagnosticCode,
  })
}

export function validatePromptRenderSourceClassification(input: {
  messages: MessageV2.WithParts[]
  lcmActive?: boolean
}): LcmSafeError | undefined {
  if (!input.lcmActive) return undefined
  for (const message of input.messages) {
    for (const part of message.parts) {
      if (classifyPromptRenderPart(part) !== "render_only_prompt_helper") continue
      const diagnosticCode = validateRenderOnlyMetadata({
        metadata: getLcmRenderOnlyMetadata(part),
        part,
      })
      if (diagnosticCode) {
        return renderPrepSourceError(diagnosticCode)
      }
    }
  }
  return undefined
}

function collectSourceOriginCounts(messages: MessageV2.WithParts[]) {
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const part of message.parts) {
      const origin = getLcmRenderOriginMetadata(part)
      if (!origin || getLcmRenderOnlyMetadata(part)) continue
      const key = `${origin.renderUnitID}:${origin.sourcePartID ?? part.id}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

function validateRenderPreparationMetadata(input: {
  messages: MessageV2.WithParts[]
  sourcePartIDs: ReadonlySet<string>
  beforeSourceOrigins?: ReadonlyMap<string, number>
  lcmActive?: boolean
}): LcmSafeError | undefined {
  if (!input.lcmActive) return undefined
  const requiresOrigins = (input.beforeSourceOrigins?.size ?? 0) > 0
  for (const message of input.messages) {
    for (const part of message.parts) {
      const renderOnly = getLcmRenderOnlyMetadata(part)
      if (renderOnly) {
        const diagnosticCode = validateRenderOnlyMetadata({ metadata: renderOnly, part })
        if (diagnosticCode) return renderPrepSourceError(diagnosticCode)
        continue
      }
      const origin = getLcmRenderOriginMetadata(part)
      if (!origin && requiresOrigins) return renderPrepSourceError("lcm_render_prep_source_origin_missing")
      if (!origin && !input.sourcePartIDs.has(part.id)) {
        return renderPrepSourceError("lcm_render_prep_untrusted_source_part_created")
      }
      if (origin) {
        if (origin.schemaVersion !== "lcm-render-origin-v1") {
          return renderPrepSourceError("lcm_render_prep_source_origin_version_invalid")
        }
        if (origin.clonedMessageID !== part.messageID || origin.clonedPartID !== part.id) {
          return renderPrepSourceError("lcm_render_prep_source_origin_binding_mismatch")
        }
      }
    }
  }

  if (input.beforeSourceOrigins) {
    const after = collectSourceOriginCounts(input.messages)
    for (const [key, count] of input.beforeSourceOrigins) {
      if (after.get(key) !== count) return renderPrepSourceError("lcm_render_prep_source_origin_ambiguous")
    }
  }
  return undefined
}

const manifestFields = [
  "version",
  "rendererVersion",
  "renderPreparationVersion",
  "sourceSelectionHash",
  "requestSnapshotProtectionHash",
  "renderUnitOrderHash",
  "effectivePlacementHash",
  "protectedSpanHash",
  "providerTransformHash",
  "providerValidatorHash",
  "assemblyValidatorHash",
  "systemPromptVersion",
  "systemPromptHash",
  "toolSchemaVersion",
  "toolSchemaHash",
  "pluginTransformVersion",
  "pluginTransformHash",
  "dynamicPromptVersion",
  "dynamicPromptHash",
  "messageVisibilityVersion",
  "messageVisibilityHash",
  "providerMediaCapability",
  "stripMedia",
  "modelID",
  "providerID",
  "providerModelRevision",
  "agentName",
  "permissionProfileVersion",
  "taskCapabilityClass",
  "clockPolicy",
] satisfies readonly (keyof LcmRenderInputManifestV1)[]

export const prepareKiloModelInput = Effect.fn("LcmRenderPrep.prepareKiloModelInput")(function* (
  input: PrepareKiloModelInput,
) {
  const clockMs = currentClock(input.clock)
  const operationID = input.operationID ?? fallbackOperationID({ clockMs, sessionID: input.sessionID })
  const clockPolicy = input.clock?.policy ?? "runtime_per_preparation"
  const stripMedia = input.stripMedia ?? false
  const visibility = input.messageVisibility ?? defaultVisibility(input.messages)
  let messages = cloneMessageBatch(input.messages)
  const durablePartIDs = sourcePartIDSet(messages)

  const classificationError = validatePromptRenderSourceClassification({
    messages,
    lcmActive: input.lcmActive,
  })
  if (classificationError) return yield* Effect.fail(classificationError)

  if (input.prepareRenderOnlyMessages) {
    messages = yield* input.prepareRenderOnlyMessages({ messages, clockMs, operationID })
  }
  markUnclassifiedNewRenderOnlyParts(messages, durablePartIDs, {
    kind: "plan_reminder",
    producer: "kilo.session.prompt",
    operationID,
    createdAtMs: clockMs,
  })
  normalizeNewRenderOnlyPartIDs(messages, durablePartIDs)
  const renderOnlyError = validateRenderPreparationMetadata({
    messages,
    sourcePartIDs: durablePartIDs,
    lcmActive: input.lcmActive,
  })
  if (renderOnlyError) return yield* Effect.fail(renderOnlyError)
  const beforePluginHash = messageBatchHash(messages)
  const beforePluginSourceOrigins = collectSourceOriginCounts(messages)
  if (input.transformMessages) {
    yield* input.transformMessages({ messages, clockMs, operationID })
  }
  normalizeNewRenderOnlyPartIDs(messages, durablePartIDs)
  const pluginOriginError = validateRenderPreparationMetadata({
    messages,
    sourcePartIDs: durablePartIDs,
    beforeSourceOrigins: beforePluginSourceOrigins,
    lcmActive: input.lcmActive,
  })
  if (pluginOriginError) return yield* Effect.fail(pluginOriginError)
  const afterPluginHash = messageBatchHash(messages)

  const clonedLastUser =
    messages.findLast((message) => message.info.role === "user" && message.info.id === input.lastUser.id)?.info ??
    input.lastUser
  if (clonedLastUser.role === "user") {
    const renderLastUser =
      input.lastUser.editorContext === undefined
        ? clonedLastUser
        : {
            ...clonedLastUser,
            editorContext: input.lastUser.editorContext,
          }
    KiloSessionPrompt.injectEditorContext({
      msgs: messages,
      lastUser: renderLastUser,
      sessionID: input.sessionID,
      cache: input.envCache,
      now: clockMs,
    })
  }
  normalizeNewRenderOnlyPartIDs(messages, durablePartIDs)
  for (const message of messages) {
    for (const part of message.parts) {
      if (durablePartIDs.has(part.id) || getLcmRenderOnlyMetadata(part)) continue
      markLcmRenderOnlyPart(part, {
        kind: "environment_details",
        producer: "kilo.editor-context",
        operationID,
        createdAtMs: clockMs,
      })
    }
  }
  const editorContextError = validateRenderPreparationMetadata({
    messages,
    sourcePartIDs: durablePartIDs,
    lcmActive: input.lcmActive,
  })
  if (editorContextError) return yield* Effect.fail(editorContextError)

  const system = yield* input.resolveSystem({ messages, clockMs, operationID })
  const tools = yield* input.resolveTools({ messages, clockMs, operationID })
  const format = input.format ?? { type: "text" }
  if (format.type === "json_schema" && input.structuredOutputTool) {
    tools["StructuredOutput"] = input.structuredOutputTool({ format })
  }

  const modelMessages = yield* MessageV2.toModelMessagesEffect(messages, input.model, { stripMedia })
  const finalModelMessages =
    input.isLastStep && input.maxStepMessage
      ? [...modelMessages, { role: "assistant" as const, content: input.maxStepMessage }]
      : modelMessages

  const dynamicHash = hashValue({
    clockMs,
    beforePluginHash,
    afterEditorHash: messageBatchHash(messages),
    isLastStep: input.isLastStep === true,
    maxStepHash: input.maxStepMessage ? hashText(input.maxStepMessage) : undefined,
  })
  const pluginTransformHash = hashValue({
    beforePluginHash,
    afterPluginHash,
  })
  const manifest: LcmRenderInputManifestV1 = {
    version: 1,
    rendererVersion: LCM_RENDERER_VERSION,
    renderPreparationVersion: LCM_RENDER_PREPARATION_VERSION,
    sourceSelectionHash: messageBatchHash(input.messages),
    requestSnapshotProtectionHash: hashValue({
      namespace: "lcm-request-snapshot-protection-v1",
      snapshots: [],
      protectedCueIDs: [],
    }),
    renderUnitOrderHash: messageBatchHash(input.messages),
    effectivePlacementHash: messageBatchHash(messages),
    protectedSpanHash: hashValue({ namespace: "lcm-protected-span-v1", spans: [] }),
    providerTransformHash: computeLcmProviderTransformHash({ model: input.model }),
    providerValidatorHash: "lcm-provider-validator-pending-m39-v1",
    assemblyValidatorHash: hashValue({
      namespace: "lcm-assembly-validator-v1",
      rendererVersion: LCM_RENDERER_VERSION,
      renderPreparationVersion: LCM_RENDER_PREPARATION_VERSION,
    }),
    systemPromptVersion: LCM_SYSTEM_PROMPT_VERSION,
    systemPromptHash: hashValue(system),
    toolSchemaVersion: LCM_TOOL_SCHEMA_VERSION,
    toolSchemaHash: hashValue(normalizeForHash(tools)),
    pluginTransformVersion: LCM_PLUGIN_TRANSFORM_VERSION,
    pluginTransformHash,
    dynamicPromptVersion: LCM_DYNAMIC_PROMPT_VERSION,
    dynamicPromptHash: dynamicHash,
    messageVisibilityVersion: visibility.version,
    messageVisibilityHash: visibility.hash,
    providerMediaCapability: mediaCapability(input.model),
    stripMedia,
    providerID: input.model.providerID,
    modelID: input.model.id,
    providerModelRevision: input.model.release_date,
    agentName: input.agent.name,
    permissionProfileVersion: permissionProfileVersion(input.permissionProfile),
    taskCapabilityClass: input.taskCapabilityClass ?? "root",
    clockPolicy,
  }

  const driftReport: LcmRenderPreparationDriftReportV1 = {
    schemaVersion: "closure-render-preparation-v1",
    rendererVersion: LCM_RENDERER_VERSION,
    renderPreparationVersion: LCM_RENDER_PREPARATION_VERSION,
    sourcePaths: [
      "packages/opencode/src/session/prompt.ts",
      "packages/opencode/src/kilocode/session/prompt.ts",
      "packages/opencode/src/kilocode/session/prompt-queue.ts",
      "packages/opencode/src/session/system.ts",
      "packages/opencode/src/session/message-v2.ts",
    ],
    preparationOrder: [
      "prompt_queue_scope",
      "durable_source_message_selection",
      "render_only_prompt_wrappers",
      "plugin_experimental_chat_messages_transform",
      "dynamic_editor_context_injection",
      "system_prompt_environment_assembly",
      "tool_schema_resolution",
      "media_options_resolution",
      "message_v2_to_model_messages",
    ],
    pluginHook: {
      name: "experimental.chat.messages.transform",
      version: LCM_PLUGIN_TRANSFORM_VERSION,
      transformHash: pluginTransformHash,
    },
    queueVisibility: {
      version: visibility.version,
      hash: visibility.hash,
      visibleMessageCount: visibility.visibleMessageIDs.length,
      hiddenMessageCount: visibility.hiddenMessageIDs.length,
    },
    timeSources: {
      clockPolicy,
      clockHash: hashValue({ clockMs }),
      systemDateSource: "SystemPrompt.environment",
      editorContextTimeSource: "KiloSessionPrompt.injectEditorContext",
    },
    manifestFields,
    contentSafety: {
      rawContentPolicy: "hashes_counts_enums_only",
      rawContentFieldsSerialized: false,
    },
    counts: {
      sourceMessages: input.messages.length,
      preparedMessages: messages.length,
      toolCount: Object.keys(tools).length,
      systemPartCount: system.length,
      modelMessageCount: finalModelMessages.length,
    },
    unmappedPromptMutations: [],
  }

  return {
    messages,
    system,
    tools,
    format,
    toolChoice: format.type === "json_schema" ? "required" : undefined,
    modelMessages: finalModelMessages,
    renderInputManifest: manifest,
    driftReport,
    providerMediaCapability: manifest.providerMediaCapability,
    stripMedia,
    clockMs,
  } satisfies LcmPreparedRenderInput
})

export function createClosureRenderPreparationArtifact(input: LcmPreparedRenderInput) {
  return input.driftReport
}

export function containsRenderPrepLeak(input: { value: unknown; sentinels: readonly string[] }) {
  const serialized = JSON.stringify(input.value)
  return input.sentinels.some((sentinel) => serialized.includes(sentinel))
}

export function makeFixtureClock(now: Date | number): LcmRenderPrepClock {
  const ms = now instanceof Date ? now.getTime() : now
  return {
    policy: "fixture_frozen",
    now: () => ms,
  }
}
