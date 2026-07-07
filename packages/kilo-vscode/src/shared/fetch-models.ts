/**
 * Fetch available models from an OpenAI-compatible /models endpoint.
 * Runs in the extension host — no CLI backend dependency.
 */

type Options = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
}

export type ModelEntry = {
  id: string
  name: string
  contextLimit?: number
  outputLimit?: number
}

const FETCH_TIMEOUT_MS = 15_000
const OLLAMA_SHOW_CONCURRENCY = 4

export class FetchModelsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "FetchModelsError"
  }

  get auth() {
    return this.status === 401 || this.status === 403
  }
}

function buildHeaders(opts: Options) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`
  }
  return headers
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "string") return parseInteger(value)
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolveOllamaNativeBaseURL(baseURL: string): string | undefined {
  try {
    const url = new URL(baseURL)
    const normalizedPath = url.pathname.replace(/\/+$/, "")
    if (normalizedPath === "/v1") {
      url.pathname = "/"
    } else if (normalizedPath.endsWith("/v1")) {
      url.pathname = normalizedPath.slice(0, -3) || "/"
    }
    url.search = ""
    url.hash = ""
    return normalizeBaseURL(url.toString())
  } catch {
    return undefined
  }
}

function isLikelyOllamaBaseURL(baseURL: string) {
  try {
    const url = new URL(baseURL)
    return url.port === "11434"
  } catch {
    return false
  }
}

export function extractOllamaContextLimit(show: unknown): number | undefined {
  if (!isRecord(show)) return undefined

  const info = show.model_info
  if (isRecord(info)) {
    for (const [key, value] of Object.entries(info)) {
      const normalized = key.toLowerCase()
      if (
        normalized === "num_ctx" ||
        normalized.endsWith(".num_ctx") ||
        normalized === "context_length" ||
        normalized.endsWith(".context_length")
      ) {
        const limit = positiveInteger(value)
        if (limit) return limit
      }
    }
  }

  if (typeof show.parameters === "string") {
    return (
      parseInteger(show.parameters.match(/^\s*num_ctx\s+(\d+)\s*$/im)?.[1]) ??
      parseInteger(show.parameters.match(/^\s*num_ctx\s*[:=]\s*(\d+)\s*$/im)?.[1]) ??
      parseInteger(show.parameters.match(/(?:^|\s)num_ctx=(\d+)(?:\s|$)/i)?.[1])
    )
  }

  return undefined
}

async function fetchOpenAIModelList(opts: Options, headers: Record<string, string>): Promise<ModelEntry[]> {
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new FetchModelsError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status)
  }

  const body = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
  const items = body?.data
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name: typeof item.name === "string" ? item.name.trim() : id })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

async function fetchOllamaTags(opts: Options, headers: Record<string, string>): Promise<ModelEntry[]> {
  const base = resolveOllamaNativeBaseURL(opts.baseURL)
  if (!base) return []
  const response = await fetch(`${base}/api/tags`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) return []

  const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
  if (!Array.isArray(body.models)) return []

  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const item of body.models) {
    const id = (typeof item.name === "string" ? item.name : item.model)?.trim() ?? ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name: id })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

async function fetchOllamaShow(
  base: string,
  headers: Record<string, string>,
  modelID: string,
): Promise<number | undefined> {
  const response = await fetch(`${base}/api/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: modelID }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  return extractOllamaContextLimit(await response.json())
}

async function enrichOllamaModels(
  opts: Options,
  headers: Record<string, string>,
  models: ModelEntry[],
  confirmedOllamaModels?: Set<string>,
): Promise<ModelEntry[]> {
  if (!isLikelyOllamaBaseURL(opts.baseURL) || models.length === 0) return models
  const base = resolveOllamaNativeBaseURL(opts.baseURL)
  if (!base) return models
  const nativeBase = base
  const confirmed =
    confirmedOllamaModels ??
    new Set(
      (await fetchOllamaTags(opts, headers).catch(() => []))
        .map((model) => model.id)
        .filter((modelID) => modelID.length > 0),
    )
  if (confirmed.size === 0) return models
  const targets = models.filter((model) => confirmed.has(model.id))
  if (targets.length === 0) return models

  const limits = new Map<string, number>()
  let index = 0
  async function worker() {
    while (index < targets.length) {
      const model = targets[index++]
      if (!model) continue
      const limit = await fetchOllamaShow(nativeBase, headers, model.id).catch(() => undefined)
      if (limit) limits.set(model.id, limit)
    }
  }

  const workers = Array.from({ length: Math.min(OLLAMA_SHOW_CONCURRENCY, targets.length) }, () => worker())
  await Promise.all(workers).catch(() => undefined)
  if (limits.size === 0) return models
  return models.map((model) => ({ ...model, ...(limits.has(model.id) ? { contextLimit: limits.get(model.id) } : {}) }))
}

export async function fetchOpenAIModels(opts: Options): Promise<ModelEntry[]> {
  const headers = buildHeaders(opts)
  try {
    const models = await fetchOpenAIModelList(opts, headers)
    return await enrichOllamaModels(opts, headers, models)
  } catch (error) {
    if (!isLikelyOllamaBaseURL(opts.baseURL)) throw error
    const models = await fetchOllamaTags(opts, headers).catch(() => [])
    if (models.length === 0) throw error
    return await enrichOllamaModels(
      opts,
      headers,
      models,
      new Set(models.map((model) => model.id).filter((modelID) => modelID.length > 0)),
    )
  }
}
