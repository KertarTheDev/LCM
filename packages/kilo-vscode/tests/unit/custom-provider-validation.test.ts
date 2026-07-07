import { describe, expect, it } from "bun:test"
import {
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_LIMIT,
  CUSTOM_PROVIDER_DEFAULT_OUTPUT_LIMIT,
} from "../../webview-ui/src/components/settings/CustomProviderLimits"
import {
  validateCustomProvider,
  type FormState,
} from "../../webview-ui/src/components/settings/CustomProviderValidation"

const t = (key: string) => key

function baseForm(overrides: Partial<FormState> = {}): FormState {
  return {
    providerID: "local",
    name: "Local",
    baseURL: "http://127.0.0.1:11434/v1",
    apiKey: "",
    models: [
      {
        id: "qwen-local",
        name: "Qwen Local",
        contextLimit: CUSTOM_PROVIDER_DEFAULT_CONTEXT_LIMIT,
        outputLimit: CUSTOM_PROVIDER_DEFAULT_OUTPUT_LIMIT,
        reasoning: false,
        variants: [],
      },
    ],
    headers: [{ key: "", value: "" }],
    saving: false,
    ...overrides,
  }
}

describe("validateCustomProvider", () => {
  it("serializes default custom model limits", () => {
    const result = validateCustomProvider({
      form: baseForm(),
      t,
      editing: false,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "qwen-local": {
        name: "Qwen Local",
        limit: { context: 100000, output: 20000 },
      },
    })
  })

  it("rejects non-positive model limits", () => {
    const result = validateCustomProvider({
      form: baseForm({
        models: [
          {
            id: "qwen-local",
            name: "Qwen Local",
            contextLimit: "0",
            outputLimit: "1.5",
            reasoning: false,
            variants: [],
          },
        ],
      }),
      t,
      editing: false,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.errors.models[0]?.contextLimit).toBe("provider.custom.error.positiveInteger")
    expect(result.errors.models[0]?.outputLimit).toBe("provider.custom.error.positiveInteger")
  })
})
