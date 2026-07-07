// kilocode_change - new file
import type { ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { namespacedHash, sha256Hex, stableHash } from "./hash"
import { deterministicFallbackTokenCount, stableTokenText } from "./token-budget"
import {
  createLcmSafeError,
  type LcmFinalValidatedProviderPayload,
  type LcmNormalizedProviderProjection,
  type LcmNormalizedProviderProjectionItem,
  type LcmNormalizedProviderProjectionKind,
  type LcmPreparedProviderPayload,
  type LcmRenderedSpan,
  type LcmRenderedSpanProviderFamily,
  type LcmSafeError,
  type LcmSafeOrHashedID,
} from "./types"

export const LCM_PROVIDER_PROTOCOL_RULE_VERSION = "m39-provider-protocol-matrix-v1"
export const LCM_PROVIDER_VALIDATOR_NAMESPACE = "lcm-provider-validator-v1"
export const LCM_PROVIDER_TRANSFORM_RULE_VERSION = "m39-provider-transform-rules-v1"

const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export interface LcmProviderFamilyClassificationInput {
  readonly providerID: string
  readonly modelID: string
  readonly apiNpm?: string
  readonly apiID?: string
  readonly interleaved?: boolean
  readonly capabilities?: readonly string[]
}

export interface LcmFinalProviderValidationInput {
  readonly preparedPayload: LcmPreparedProviderPayload
  readonly transformedMessages: readonly ModelMessage[]
  readonly model: Provider.Model
  readonly providerOptions?: Record<string, unknown>
  readonly modelOptions?: Record<string, unknown>
}

export type LcmFinalProviderValidationResult =
  | {
      readonly ok: true
      readonly providerFamily: LcmRenderedSpanProviderFamily
      readonly finalProviderTransformHash: string
      readonly finalProviderValidatorHash: string
      readonly providerTransformOverheadTokenCount: number
      readonly finalProviderPayload: LcmFinalValidatedProviderPayload
      readonly normalizedProjection: LcmNormalizedProviderProjection
    }
  | {
      readonly ok: false
      readonly safeError: LcmSafeError
      readonly normalizedProjection?: LcmNormalizedProviderProjection
    }

function invalidProviderProtocol(diagnosticCode: string) {
  return createLcmSafeError({
    code: "invalid_request",
    templateKey: "lcm.request.invalid",
    safeParams: { action: "retry" },
    retryable: false,
    diagnosticCode,
  })
}

function lower(value: string | undefined) {
  return value?.toLowerCase() ?? ""
}

export function classifyLcmProviderFamily(input: LcmProviderFamilyClassificationInput): LcmRenderedSpanProviderFamily {
  const providerID = lower(input.providerID)
  const modelID = lower(input.modelID)
  const apiNpm = lower(input.apiNpm)
  const apiID = lower(input.apiID)
  const interleaved =
    input.interleaved === true ||
    input.capabilities?.some((capability) => lower(capability) === "interleaved_reasoning")

  if (providerID.includes("copilot") || apiID.includes("copilot")) return "copilot"
  if (
    apiNpm.includes("anthropic") ||
    providerID.includes("anthropic") ||
    apiID.includes("anthropic") ||
    apiID.includes("claude")
  ) {
    return "anthropic"
  }
  if (
    apiNpm.includes("mistral") ||
    providerID.includes("mistral") ||
    modelID.includes("mistral") ||
    modelID.includes("devstral") ||
    apiID.includes("devstral")
  ) {
    return "mistral"
  }
  if (
    apiNpm.includes("openai") ||
    providerID === "openai" ||
    providerID.includes("openai") ||
    providerID.includes("ollama") ||
    apiID.includes("openai-compatible") ||
    apiID.includes("ollama")
  ) {
    return "openai_compatible"
  }
  if (interleaved) return "interleaved_reasoning"
  return "generic"
}

export function lcmSafeOrHashedID(value: string | undefined | null): LcmSafeOrHashedID | undefined {
  if (value === undefined || value === null) return undefined
  if (SAFE_ID_PATTERN.test(value)) return { kind: "safe", safeID: value }
  return { kind: "sha256", sha256: sha256Hex(Buffer.from(value, "utf8")) }
}

function requiredSafeOrHashedID(value: string) {
  return lcmSafeOrHashedID(value) ?? { kind: "sha256", sha256: sha256Hex(Buffer.from("", "utf8")) }
}

function capabilityLabels(model: Provider.Model): string[] {
  const labels: string[] = []
  const capabilities = model.capabilities as Record<string, unknown>
  if (capabilities.reasoning) labels.push("reasoning")
  if (capabilities.interleaved) labels.push("interleaved_reasoning")
  const input = capabilities.input
  if (input && typeof input === "object") {
    for (const [key, enabled] of Object.entries(input)) {
      if (enabled === true) labels.push(`input:${key}`)
    }
  }
  return labels.sort()
}

export function computeLcmProviderTransformHash(input: {
  readonly model: Provider.Model
  readonly providerFamily?: LcmRenderedSpanProviderFamily
  readonly providerOptions?: Record<string, unknown>
  readonly modelOptions?: Record<string, unknown>
}) {
  const providerFamily =
    input.providerFamily ??
    classifyLcmProviderFamily({
      providerID: input.model.providerID,
      modelID: input.model.id,
      apiNpm: input.model.api.npm,
      apiID: input.model.api.id,
      interleaved: input.model.capabilities?.interleaved === true,
    })
  return namespacedHash("lcm-provider-transform-v1", {
    ruleVersion: LCM_PROVIDER_TRANSFORM_RULE_VERSION,
    providerFamily,
    providerID: input.model.providerID,
    modelID: input.model.id,
    sdkPackage: input.model.api.npm,
    apiIdentity: input.model.api.id,
    mediaHandling: mediaHandling(input.model),
    ruleFlags: providerRuleFlags(providerFamily, input.model),
    capabilityLabels: capabilityLabels(input.model),
    providerOptionsHash: stableHash(input.providerOptions ?? {}),
    modelOptionsHash: stableHash(input.modelOptions ?? input.model.options ?? {}),
  })
}

export function computeLcmProviderValidatorHash(input: {
  readonly model: Provider.Model
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly providerOptions?: Record<string, unknown>
  readonly modelOptions?: Record<string, unknown>
}) {
  return namespacedHash(LCM_PROVIDER_VALIDATOR_NAMESPACE, {
    ruleVersion: LCM_PROVIDER_PROTOCOL_RULE_VERSION,
    providerFamily: input.providerFamily,
    providerID: input.model.providerID,
    modelID: input.model.id,
    sdkPackage: input.model.api.npm,
    apiIdentity: input.model.api.id,
    capabilityLabels: capabilityLabels(input.model),
    providerOptionsHash: stableHash(input.providerOptions ?? {}),
    modelOptionsHash: stableHash(input.modelOptions ?? input.model.options ?? {}),
  })
}

function mediaHandling(model: Provider.Model) {
  const input = model.capabilities.input
  if (input.image || input.audio || input.video || input.pdf) return "supports_media"
  return "text_only"
}

function providerRuleFlags(providerFamily: LcmRenderedSpanProviderFamily, model: Provider.Model) {
  const flags = new Set<string>()
  if (providerFamily === "mistral") flags.add("mistral_sequence_repair")
  if (providerFamily === "anthropic") flags.add("anthropic_tool_use_ordering")
  if (providerFamily === "copilot") flags.add("copilot_openai_tool_adjacency")
  if (providerFamily === "openai_compatible") flags.add("openai_compatible_tool_adjacency")
  if (model.capabilities?.interleaved) flags.add("interleaved_reasoning")
  if (!model.capabilities.input.image && !model.capabilities.input.pdf) flags.add("media_text_fallback")
  return [...flags].sort()
}

function messageContent(message: ModelMessage): unknown[] {
  const content = (message as { content?: unknown }).content
  if (Array.isArray(content)) return content
  if (content === undefined || content === null || content === "") return []
  return [{ type: "text", text: content }]
}

function partType(part: unknown) {
  return part && typeof part === "object" && "type" in part ? String((part as { type?: unknown }).type) : "unknown"
}

function partString(part: unknown, key: string) {
  if (!part || typeof part !== "object" || !(key in part)) return undefined
  const value = (part as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

function messageRole(message: ModelMessage) {
  return String((message as { role?: unknown }).role)
}

function knownRole(role: string): role is "system" | "user" | "assistant" | "tool" {
  return role === "system" || role === "user" || role === "assistant" || role === "tool"
}

function toolCalls(message: ModelMessage) {
  return messageContent(message)
    .filter((part) => partType(part) === "tool-call")
    .map((part) => ({
      id: partString(part, "toolCallId"),
      name: partString(part, "toolName"),
    }))
}

function toolResults(message: ModelMessage) {
  return messageContent(message)
    .filter((part) => partType(part) === "tool-result")
    .map((part) => ({
      id: partString(part, "toolCallId"),
      name: partString(part, "toolName"),
    }))
}

function validateCommonProviderProtocol(input: {
  readonly messages: readonly ModelMessage[]
  readonly providerFamily: LcmRenderedSpanProviderFamily
}) {
  let pendingToolCallIDs: string[] = []
  for (const [index, message] of input.messages.entries()) {
    const role = messageRole(message)
    if (!knownRole(role)) return "lcm_provider_protocol_unknown_role"
    const calls = toolCalls(message)
    const results = toolResults(message)
    if (calls.some((call) => !call.id || !call.name)) return "lcm_provider_protocol_tool_call_missing_id"
    if (results.some((result) => !result.id)) return "lcm_provider_protocol_tool_result_missing_id"
    if (input.providerFamily === "anthropic" && role === "assistant") {
      const parts = messageContent(message)
      const firstTool = parts.findIndex((part) => partType(part) === "tool-call")
      if (firstTool !== -1 && parts.slice(firstTool).some((part) => partType(part) !== "tool-call")) {
        return "lcm_provider_protocol_anthropic_tool_use_order_invalid"
      }
    }
    if (pendingToolCallIDs.length > 0) {
      if (results.length === 0) return "lcm_provider_protocol_tool_result_not_adjacent"
      for (const result of results) {
        if (!pendingToolCallIDs.includes(result.id!)) return "lcm_provider_protocol_orphan_tool_result"
        pendingToolCallIDs = pendingToolCallIDs.filter((id) => id !== result.id)
      }
      if (calls.length > 0) return "lcm_provider_protocol_tool_call_before_results_complete"
      continue
    }
    if (results.length > 0) return "lcm_provider_protocol_orphan_tool_result"
    if (calls.length > 0) pendingToolCallIDs = calls.map((call) => call.id!)
    const nextMessage = input.messages[index + 1]
    if (input.providerFamily === "mistral" && role === "tool" && nextMessage && messageRole(nextMessage) === "user") {
      return "lcm_provider_protocol_mistral_tool_user_sequence"
    }
  }
  if (pendingToolCallIDs.length > 0) return "lcm_provider_protocol_tool_result_missing"
  return undefined
}

function markerForText(
  text: string | undefined,
): Pick<LcmNormalizedProviderProjectionItem, "markerHandle" | "markerKind" | "mediaFallbackKind" | "reasoningKind"> {
  if (!text) return {}
  const fileHandle = text.match(/\bfile_[A-Za-z0-9_.:-]{1,128}\b/)?.[0]
  if (fileHandle) return { markerKind: "large_file_marker", markerHandle: fileHandle }
  if (text.startsWith("ERROR: Cannot read ") || text.startsWith("ERROR: Image file is empty")) {
    return { markerKind: "media_fallback", mediaFallbackKind: "provider_text_fallback" }
  }
  if (text.includes("tool is still running") || text.includes("tool result is pending")) {
    return { markerKind: "tool_placeholder" }
  }
  return {}
}

function kindForPart(part: unknown): LcmNormalizedProviderProjectionKind {
  const type = partType(part)
  if (type === "reasoning") return "reasoning_part"
  if (type === "tool-call") return "tool_call"
  if (type === "tool-result") return "tool_result"
  if (type === "file" || type === "image") return "media_fallback"
  return "text_part"
}

function spanForMessageIndex(input: {
  readonly spans: readonly LcmRenderedSpan[]
  readonly modelMessageIndex: number
}) {
  return input.spans.find((span) => {
    if (span.messageCount === 0) return span.startIndex === input.modelMessageIndex
    return span.startIndex <= input.modelMessageIndex && input.modelMessageIndex < span.startIndex + span.messageCount
  })
}

function messageProtocolTypes(message: ModelMessage) {
  return messageContent(message).map((part) => partType(part))
}

function messageProtocolCompatible(finalMessage: ModelMessage, originalMessage: ModelMessage | undefined) {
  if (!originalMessage) return false
  if (messageRole(finalMessage) !== messageRole(originalMessage)) return false
  const originalTypes = messageProtocolTypes(originalMessage)
  const finalTypes = messageProtocolTypes(finalMessage)
  if (originalTypes.length === 0 && finalTypes.length === 0) return true
  return finalTypes.every((type) => originalTypes.includes(type))
}

function finalMessageSourceIndexes(input: {
  readonly finalMessages: readonly ModelMessage[]
  readonly originalMessages: readonly ModelMessage[]
}) {
  const result: Array<number | undefined> = []
  let originalIndex = 0
  for (const finalMessage of input.finalMessages) {
    if (messageRole(finalMessage) === "system") {
      result.push(undefined)
      continue
    }
    if (messageProtocolCompatible(finalMessage, input.originalMessages[originalIndex])) {
      result.push(originalIndex)
      originalIndex++
      continue
    }
    result.push(undefined)
  }
  return result
}

function countProviderTransformOverheadTokens(input: {
  readonly finalMessages: readonly ModelMessage[]
  readonly originalMessages: readonly ModelMessage[]
}) {
  const sourceIndexes = finalMessageSourceIndexes(input)
  return input.finalMessages.reduce((total, message, index) => {
    if (sourceIndexes[index] !== undefined) return total
    return total + deterministicFallbackTokenCount(stableTokenText(message))
  }, 0)
}

function adjacencyGroupID(input: {
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly kind: "tool_call" | "tool_result"
  readonly id?: string
  readonly itemIndexes: readonly number[]
  readonly transformStage: string
}) {
  return namespacedHash("lcm-provider-adjacency-group-v1", {
    providerFamily: input.providerFamily,
    kind: input.kind,
    id: input.id ? lcmSafeOrHashedID(input.id) : undefined,
    itemIndexes: input.itemIndexes,
    transformStage: input.transformStage,
  })
}

export function normalizeLcmProviderProjection(input: {
  readonly messages: readonly ModelMessage[]
  readonly preparedPayload: LcmPreparedProviderPayload
  readonly providerFamily: LcmRenderedSpanProviderFamily
  readonly providerTransformHash: string
  readonly providerValidatorHash: string
}): LcmNormalizedProviderProjection {
  const items: LcmNormalizedProviderProjectionItem[] = []
  const sourceIndexes = finalMessageSourceIndexes({
    finalMessages: input.messages,
    originalMessages: input.preparedPayload.modelMessages as readonly ModelMessage[],
  })
  for (const [messageIndex, message] of input.messages.entries()) {
    const role = messageRole(message)
    const modelMessageIndex = sourceIndexes[messageIndex]
    const span =
      modelMessageIndex !== undefined
        ? spanForMessageIndex({ spans: input.preparedPayload.renderedSpans, modelMessageIndex })
        : undefined
    const messageItemIndex = items.length
    items.push({
      itemIndex: messageItemIndex,
      kind: span ? "message" : "provider_transform_overhead",
      providerFamily: input.providerFamily,
      messageIndex,
      role: knownRole(role) ? role : undefined,
      ...(span
        ? {
            protocolSpanID: span.protected ? span.protocolSpanID : undefined,
            renderUnitID: span.renderUnitID,
            sourceHandle: span.sourceHandle,
            spanHash: span.spanHash,
          }
        : {
            providerTransformOverheadID: namespacedHash("lcm-provider-transform-overhead-v1", {
              providerFamily: input.providerFamily,
              providerTransformHash: input.providerTransformHash,
              transformStage: "provider_transformed",
              overheadKind: "message_without_rendered_span",
              insertionIndex: messageIndex,
              operationID: input.preparedPayload.operationID,
            }),
            markerKind: "provider_transform_overhead",
          }),
      transformStage: "provider_transformed",
    })
    for (const [partIndex, part] of messageContent(message).entries()) {
      const type = partType(part)
      const text = partString(part, "text")
      const toolCallID = partString(part, "toolCallId")
      const toolName = partString(part, "toolName")
      const kind = kindForPart(part)
      items.push({
        itemIndex: items.length,
        kind,
        providerFamily: input.providerFamily,
        messageIndex,
        partIndex,
        role: knownRole(role) ? role : undefined,
        partKind: type,
        ...(toolCallID ? { toolCallID: requiredSafeOrHashedID(toolCallID) } : {}),
        ...(kind === "tool_result" && toolCallID ? { toolResultID: requiredSafeOrHashedID(toolCallID) } : {}),
        ...(toolName ? { toolName: requiredSafeOrHashedID(toolName) } : {}),
        ...(kind === "tool_call" || kind === "tool_result"
          ? {
              adjacencyGroupID: adjacencyGroupID({
                providerFamily: input.providerFamily,
                kind: kind === "tool_call" ? "tool_call" : "tool_result",
                id: toolCallID,
                itemIndexes: [messageItemIndex, items.length],
                transformStage: "provider_transformed",
              }),
            }
          : {}),
        ...(type === "reasoning"
          ? { reasoningKind: input.providerFamily === "interleaved_reasoning" ? "interleaved" : "native" }
          : {}),
        ...markerForText(text),
        ...(span
          ? {
              protocolSpanID: span.protected ? span.protocolSpanID : undefined,
              renderUnitID: span.renderUnitID,
              sourceHandle: span.sourceHandle,
              spanHash: span.spanHash,
            }
          : {}),
        transformStage: "provider_transformed",
      })
    }
  }
  return {
    schemaVersion: "lcm-normalized-provider-projection-v1",
    providerID: requiredSafeOrHashedID(input.preparedPayload.providerID),
    modelID: requiredSafeOrHashedID(input.preparedPayload.modelID),
    providerFamily: input.providerFamily,
    providerTransformHash: input.providerTransformHash,
    providerValidatorHash: input.providerValidatorHash,
    items,
  }
}

function projectionContainsUnsafeRawID(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(projectionContainsUnsafeRawID)
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.kind === "safe") return typeof record.safeID !== "string" || !SAFE_ID_PATTERN.test(record.safeID)
  return Object.values(record).some(projectionContainsUnsafeRawID)
}

export function validateLcmFinalProviderPayload(
  input: LcmFinalProviderValidationInput,
): LcmFinalProviderValidationResult {
  if (input.preparedPayload.providerID !== input.model.providerID || input.preparedPayload.modelID !== input.model.id) {
    return { ok: false, safeError: invalidProviderProtocol("lcm_provider_protocol_payload_model_mismatch") }
  }
  if (
    !Array.isArray(input.transformedMessages) ||
    input.transformedMessages.some((message) => !message || typeof message !== "object")
  ) {
    return { ok: false, safeError: invalidProviderProtocol("lcm_provider_protocol_messages_invalid") }
  }
  const providerFamily = classifyLcmProviderFamily({
    providerID: input.model.providerID,
    modelID: input.model.id,
    apiNpm: input.model.api.npm,
    apiID: input.model.api.id,
    interleaved: input.model.capabilities?.interleaved === true,
  })
  const finalProviderTransformHash = computeLcmProviderTransformHash({
    model: input.model,
    providerFamily,
    providerOptions: input.providerOptions,
    modelOptions: input.modelOptions,
  })
  const finalProviderValidatorHash = computeLcmProviderValidatorHash({
    model: input.model,
    providerFamily,
    providerOptions: input.providerOptions,
    modelOptions: input.modelOptions,
  })
  const protocolDiagnostic = validateCommonProviderProtocol({
    messages: input.transformedMessages,
    providerFamily,
  })
  const normalizedProjection = normalizeLcmProviderProjection({
    messages: input.transformedMessages,
    preparedPayload: input.preparedPayload,
    providerFamily,
    providerTransformHash: finalProviderTransformHash,
    providerValidatorHash: finalProviderValidatorHash,
  })
  if (projectionContainsUnsafeRawID(normalizedProjection)) {
    return {
      ok: false,
      safeError: invalidProviderProtocol("lcm_provider_protocol_projection_unsafe_id"),
      normalizedProjection,
    }
  }
  if (protocolDiagnostic) {
    return {
      ok: false,
      safeError: invalidProviderProtocol(protocolDiagnostic),
      normalizedProjection,
    }
  }
  return {
    ok: true,
    providerFamily,
    finalProviderTransformHash,
    finalProviderValidatorHash,
    providerTransformOverheadTokenCount: countProviderTransformOverheadTokens({
      finalMessages: input.transformedMessages,
      originalMessages: input.preparedPayload.modelMessages as readonly ModelMessage[],
    }),
    normalizedProjection,
    finalProviderPayload: {
      ...input.preparedPayload,
      __lcmFinalProviderValidation: true,
      finalProviderValidatorHash,
      finalProviderTransformHash,
    } as LcmFinalValidatedProviderPayload,
  }
}
