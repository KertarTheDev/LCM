import { afterEach, describe, expect, it } from "bun:test"
import { extractOllamaContextLimit, fetchOpenAIModels, resolveOllamaNativeBaseURL } from "../../src/shared/fetch-models"

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("resolveOllamaNativeBaseURL", () => {
  it("strips the OpenAI-compatible /v1 path for native Ollama calls", () => {
    expect(resolveOllamaNativeBaseURL("http://localhost:11434/v1")).toBe("http://localhost:11434")
    expect(resolveOllamaNativeBaseURL("https://ollama.example/proxy/v1/")).toBe("https://ollama.example/proxy")
  })
})

describe("extractOllamaContextLimit", () => {
  it("reads context length from Ollama model_info", () => {
    expect(extractOllamaContextLimit({ model_info: { "qwen3.context_length": 131072 } })).toBe(131072)
  })

  it("reads context length from Ollama parameters text", () => {
    expect(extractOllamaContextLimit({ parameters: "temperature 0.8\nnum_ctx 65536\n" })).toBe(65536)
  })
})

describe("fetchOpenAIModels", () => {
  it("fetches and sorts OpenAI-compatible /models results", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input) => {
      calls.push(String(input))
      return jsonResponse({ data: [{ id: "z-model" }, { id: "a-model", name: "Alpha" }] })
    }

    const models = await fetchOpenAIModels({ baseURL: "https://api.example.com/v1" })

    expect(calls).toEqual(["https://api.example.com/v1/models"])
    expect(models).toEqual([
      { id: "a-model", name: "Alpha" },
      { id: "z-model", name: "z-model" },
    ])
  })

  it("enriches local Ollama OpenAI-compatible models with native context limits", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`)
      if (String(input).endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "qwen3:32b" }] })
      }
      if (String(input).endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen3:32b" }] })
      }
      if (String(input).endsWith("/api/show")) {
        return jsonResponse({ model_info: { "qwen3.context_length": 100000 } })
      }
      return jsonResponse({}, 404)
    }

    const models = await fetchOpenAIModels({ baseURL: "http://127.0.0.1:11434/v1" })

    expect(calls).toEqual([
      "GET http://127.0.0.1:11434/v1/models",
      "GET http://127.0.0.1:11434/api/tags",
      "POST http://127.0.0.1:11434/api/show",
    ])
    expect(models).toEqual([{ id: "qwen3:32b", name: "qwen3:32b", contextLimit: 100000 }])
  })

  it("falls back to native Ollama tags when /models is unavailable", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`)
      if (String(input).endsWith("/models")) return jsonResponse({ error: "not found" }, 404)
      if (String(input).endsWith("/api/tags")) return jsonResponse({ models: [{ name: "llama3.1:8b" }] })
      if (String(input).endsWith("/api/show")) return jsonResponse({ parameters: "num_ctx=32768" })
      return jsonResponse({}, 404)
    }

    const models = await fetchOpenAIModels({ baseURL: "http://localhost:11434" })

    expect(calls).toEqual([
      "GET http://localhost:11434/models",
      "GET http://localhost:11434/api/tags",
      "POST http://localhost:11434/api/show",
    ])
    expect(models).toEqual([{ id: "llama3.1:8b", name: "llama3.1:8b", contextLimit: 32768 }])
  })

  it("does not probe native Ollama endpoints for other localhost OpenAI-compatible servers", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`)
      if (String(input).endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "local-openai" }] })
      }
      return jsonResponse({}, 500)
    }

    const models = await fetchOpenAIModels({ baseURL: "http://localhost:1234/v1" })

    expect(calls).toEqual(["GET http://localhost:1234/v1/models"])
    expect(models).toEqual([{ id: "local-openai", name: "local-openai" }])
  })
})
