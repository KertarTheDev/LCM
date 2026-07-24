// kilocode_change - new file
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "./provider-ids"
import { ProviderTransform } from "@/provider/transform"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { generateText, type ModelMessage } from "ai"
import { Effect } from "effect"
import * as LcmConfig from "./config"
import type { LcmLeafCompactionRuntimeInput } from "./context"
import { resolveLcmMapWorkerCount, type LcmMapModelSelection } from "./map"
import { resolveLcmModelLimits } from "./model-limits"
import {
  defaultLcmProviderCapacityRegistry,
  lcmProviderBaseURLFromOptions,
  lcmProviderCapacityInputFromModel,
  runWithLcmProviderCapacity,
  type LcmProviderCapacityPriority,
} from "./provider-capacity"
import {
  invalidRequest,
  lcmGenerationMessages,
  lcmMaxOutputTokens,
  lcmProviderDiagnostics,
  mergeLcmProviderOptions,
  pending,
  providerUsageFromGeneration,
  type LcmGenerationMessage,
} from "./runtime-support"
import type { ConversationID, LcmPreflightInput, LlmMapInput, OperationID } from "./types"

export type RuntimeSummaryGenerator = (input: {
  prompt: string
  request?: { readonly messages: readonly LcmGenerationMessage[] }
  operationID?: OperationID
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}) => Promise<{ text: string; usage: ReturnType<typeof providerUsageFromGeneration> }>

/**
 * Centralizes all runtime-owned model invocation policy. New provider-backed
 * LCM operations must pass through this factory so transforms, local capacity,
 * retry policy, and output limits cannot drift between maintenance and tools.
 */
export function createRuntimeProvider(input: { provider?: Provider.Interface }) {
  const provider = input.provider

  const runProviderGeneration = async <T>(
    model: Provider.Model,
    priority: LcmProviderCapacityPriority,
    operationID: OperationID | undefined,
    run: () => Promise<T>,
    options?: { abortSignal?: AbortSignal; sessionID?: string },
  ) => {
    const providerInfo = provider
      ? await Effect.runPromise(
          provider.getProvider(model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined))),
        )
      : undefined
    const providerBaseURL = lcmProviderBaseURLFromOptions(providerInfo?.options)
    return runWithLcmProviderCapacity(
      lcmProviderCapacityInputFromModel({
        model,
        ...(options?.sessionID ? { sessionID: options.sessionID } : {}),
        priority,
        ...(operationID ? { operationID } : {}),
        ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(providerBaseURL ? { providerBaseURL } : {}),
      }),
      run,
    )
  }

  const runLcmTextGeneration = async (input: {
    readonly model: Provider.Model
    readonly language: LanguageModelV3
    readonly sessionID: string
    readonly priority: LcmProviderCapacityPriority
    readonly operationID?: OperationID
    readonly prompt: string
    readonly request?: { readonly messages: readonly LcmGenerationMessage[] }
    readonly maxOutputTokens?: number
    readonly reserveReasoningTokens?: boolean
    readonly abortSignal?: AbortSignal
  }) => {
    const providerInfo = provider
      ? await Effect.runPromise(
          provider.getProvider(input.model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined))),
        )
      : undefined
    const options = mergeLcmProviderOptions({
      model: input.model,
      sessionID: input.sessionID,
      ...(providerInfo ? { providerOptions: providerInfo.options } : {}),
    })
    const messages = ProviderTransform.message(
      lcmGenerationMessages({
        prompt: input.prompt,
        ...(input.request ? { request: input.request } : {}),
      }) as ModelMessage[],
      input.model,
      options,
    )
    const generated = await runProviderGeneration(
      input.model,
      input.priority,
      input.operationID,
      () =>
        generateText({
          model: input.language,
          temperature: input.model.capabilities.temperature ? 0 : undefined,
          topP: ProviderTransform.topP(input.model),
          topK: ProviderTransform.topK(input.model),
          providerOptions: ProviderTransform.providerOptions(input.model, options),
          maxOutputTokens: lcmMaxOutputTokens({
            model: input.model,
            maxOutputTokens: input.maxOutputTokens,
            reserveReasoningTokens: input.reserveReasoningTokens,
          }),
          maxRetries: 0,
          abortSignal: input.abortSignal,
          messages,
        }),
      {
        sessionID: input.sessionID,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    )
    return {
      text: generated.text,
      usage: generated.usage,
      providerDiagnostics: lcmProviderDiagnostics({ generation: generated, text: generated.text }),
    }
  }

  const makeSummaryGenerator = (
    model: Provider.Model,
    sessionID: string,
    renderOptions: LcmPreflightInput["renderOptions"],
    priority: LcmProviderCapacityPriority = "foreground",
    defaultMaxOutputTokens: number = LcmConfig.RUNTIME_DEFAULTS.performance.summaryGenerationMaxOutputTokens,
  ): RuntimeSummaryGenerator => {
    let languagePromise: Promise<LanguageModelV3> | undefined
    return async ({
      prompt,
      request,
      operationID,
      maxOutputTokens,
      abortSignal,
    }: {
      prompt: string
      request?: { readonly messages: readonly LcmGenerationMessage[] }
      operationID?: OperationID
      maxOutputTokens?: number
      abortSignal?: AbortSignal
    }) => {
      if (!provider) throw pending("lcm_preflight_provider_missing")
      const language = await (languagePromise ??= Effect.runPromise(provider.getLanguage(model)))
      const result = await runLcmTextGeneration({
        model,
        language,
        sessionID,
        priority,
        operationID,
        prompt,
        request,
        maxOutputTokens: maxOutputTokens ?? defaultMaxOutputTokens,
        abortSignal,
      })
      return {
        text: result.text,
        usage: providerUsageFromGeneration({
          usage: result.usage,
          providerID: renderOptions.providerID,
          modelID: renderOptions.modelID,
        }),
      }
    }
  }

  const resolveMapModel = Effect.fn("LcmRuntime.resolveMapModel")(function* (input: {
    selection?: LlmMapInput["model"]
    providerID?: string
    modelID?: string
    operationID: OperationID
    conversationID?: ConversationID
  }) {
    if (!provider) {
      return yield* Effect.fail(
        invalidRequest("lcm_map_provider_missing", {
          operationID: input.operationID,
          conversationID: input.conversationID,
        }),
      )
    }

    const modelFromCurrent = Effect.fn("LcmRuntime.resolveCurrentMapModel")(function* () {
      if (input.providerID && input.modelID) {
        return yield* provider.getModel(ProviderID.make(input.providerID), ModelID.make(input.modelID)).pipe(
          Effect.catch(() =>
            Effect.fail(
              invalidRequest("lcm_map_current_model_not_found", {
                operationID: input.operationID,
                conversationID: input.conversationID,
              }),
            ),
          ),
        )
      }
      const defaults = yield* provider.defaultModel().pipe(
        Effect.catch(() =>
          Effect.fail(
            invalidRequest("lcm_map_default_model_not_found", {
              operationID: input.operationID,
              conversationID: input.conversationID,
            }),
          ),
        ),
      )
      return yield* provider.getModel(defaults.providerID, defaults.modelID).pipe(
        Effect.catch(() =>
          Effect.fail(
            invalidRequest("lcm_map_default_model_unavailable", {
              operationID: input.operationID,
              conversationID: input.conversationID,
            }),
          ),
        ),
      )
    })

    const selector = input.selection ?? "default"
    if (selector === "default") {
      const model = yield* modelFromCurrent()
      return {
        model,
        modelSelection: {
          selector: "default",
          providerID: model.providerID,
          modelID: model.id,
        } satisfies LcmMapModelSelection,
      }
    }

    if (selector === "small") {
      const base = input.providerID
        ? ProviderID.make(input.providerID)
        : (yield* provider.defaultModel().pipe(
            Effect.catch(() =>
              Effect.fail(
                invalidRequest("lcm_map_small_base_model_not_found", {
                  operationID: input.operationID,
                  conversationID: input.conversationID,
                }),
              ),
            ),
          )).providerID
      const model = yield* provider.getSmallModel(base).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!model) {
        return yield* Effect.fail(
          invalidRequest("lcm_map_small_model_not_found", {
            operationID: input.operationID,
            conversationID: input.conversationID,
          }),
        )
      }
      return {
        model,
        modelSelection: {
          selector: "small",
          providerID: model.providerID,
          modelID: model.id,
        } satisfies LcmMapModelSelection,
      }
    }

    const model = yield* provider.getModel(ProviderID.make(selector.providerID), ModelID.make(selector.modelID)).pipe(
      Effect.catch(() =>
        Effect.fail(
          invalidRequest("lcm_map_explicit_model_not_found", {
            operationID: input.operationID,
            conversationID: input.conversationID,
          }),
        ),
      ),
    )
    return {
      model,
      modelSelection: {
        selector: "explicit",
        providerID: model.providerID,
        modelID: model.id,
      } satisfies LcmMapModelSelection,
    }
  })

  const resolveRuntimeMapWorkers = async (input: {
    toolKind: "llm_map" | "agentic_map"
    mapInput: LlmMapInput
    resolved: {
      model: Provider.Model
      modelSelection: LcmMapModelSelection
    }
  }) => {
    const providerInfo = provider
      ? await Effect.runPromise(
          provider.getProvider(input.resolved.model.providerID).pipe(Effect.catch(() => Effect.succeed(undefined))),
        )
      : undefined
    const capacityInput = lcmProviderCapacityInputFromModel({
      model: input.resolved.model,
      priority: "background",
      ...(providerInfo ? { provider: providerInfo } : {}),
    })
    const snapshot = defaultLcmProviderCapacityRegistry.snapshot(capacityInput)
    return resolveLcmMapWorkerCount({
      toolKind: input.toolKind,
      requestedWorkers: input.mapInput.workers,
      modelSelector: input.resolved.modelSelection.selector,
      providerCapacityClass: snapshot.capacityClass,
      providerActive: snapshot.active,
      providerForegroundQueued: snapshot.foregroundQueued,
    })
  }

  return {
    runLcmTextGeneration,
    makeSummaryGenerator,
    resolveMapModel,
    resolveRuntimeMapWorkers,
  }
}
