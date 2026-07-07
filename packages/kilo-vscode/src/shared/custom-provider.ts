import { z } from "zod"
import { CUSTOM_PROVIDER_PACKAGE, CUSTOM_PROVIDER_PACKAGES, PROVIDER_ID_PATTERN } from "./provider-model"
import type { CustomProviderPackage } from "./provider-model"

const INVALID_PROVIDER_ID = "Invalid provider ID"
const INVALID_ENV = "Invalid environment variable name"
const INVALID_BASE_URL = "Base URL must start with http:// or https://"

export const ProviderIDSchema = z.string().trim().regex(PROVIDER_ID_PATTERN, INVALID_PROVIDER_ID)
export const EnvSchema = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/, INVALID_ENV)

const VariantConfigSchema = z
  .object({
    disabled: z.boolean().optional(),
    enable_thinking: z.boolean().optional(),
    thinking: z
      .object({ type: z.enum(["enabled", "disabled", "adaptive"]) })
      .strict()
      .optional(),
    reasoning_split: z.boolean().optional(),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    chat_template_args: z.object({ enable_thinking: z.boolean() }).strict().optional(),
  })
  .catchall(z.unknown())

export type VariantConfig = z.infer<typeof VariantConfigSchema>

const PositiveIntSchema = z.number().int().positive()
const TimeoutSchema = z.union([PositiveIntSchema, z.literal(false)])
const ModelLimitSchema = z
  .object({
    context: PositiveIntSchema,
    input: PositiveIntSchema.optional(),
    output: PositiveIntSchema,
  })
  .strict()
const ProviderOptionsSchema = z
  .object({
    baseURL: z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
        message: INVALID_BASE_URL,
      }),
    enterpriseUrl: z.string().optional(),
    setCacheKey: z.boolean().optional(),
    timeout: TimeoutSchema.optional(),
    chunkTimeout: PositiveIntSchema.optional(),
    headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
  })
  .catchall(z.unknown())
const ModelProviderSchema = z.object({ npm: z.string().optional(), api: z.string().optional() }).strict()
const ModelCostSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    context_over_200k: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
const ModelModalitiesSchema = z
  .object({
    input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
    output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
  })
  .strict()
const ModelInterleavedSchema = z.union([
  z.literal(true),
  z.object({ field: z.enum(["reasoning_content", "reasoning_details"]) }).strict(),
])
const ModelConfigSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(200),
    family: z.string().trim().min(1).optional(),
    release_date: z.string().trim().min(1).optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    temperature: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    interleaved: ModelInterleavedSchema.optional(),
    cost: ModelCostSchema.optional(),
    limit: ModelLimitSchema.optional(),
    modalities: ModelModalitiesSchema.optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    provider: ModelProviderSchema.optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
    variants: z.record(z.string().trim().min(1), VariantConfigSchema).optional(),
  })
  .strict()

export const CustomProviderConfigSchema = z
  .object({
    api: z.string().optional(),
    npm: z.enum(CUSTOM_PROVIDER_PACKAGES).default(CUSTOM_PROVIDER_PACKAGE),
    name: z.string().trim().min(1).max(200),
    env: z.array(EnvSchema).optional(),
    id: z.string().optional(),
    whitelist: z.array(z.string()).optional(),
    blacklist: z.array(z.string()).optional(),
    options: ProviderOptionsSchema,
    models: z
      .record(z.string().trim().min(1), ModelConfigSchema)
      .refine((value) => Object.keys(value).length > 0, "At least one model is required"),
  })
  .strict()

type SanitizedProviderOptions = Record<string, unknown> & {
  baseURL: string
  headers?: Record<string, string>
}

type SanitizedModelConfig = Record<string, unknown> & {
  name: string
  limit?: { context: number; input?: number; output: number }
  variants?: Record<string, VariantConfig | null>
}

export type SanitizedProviderConfig = {
  npm: CustomProviderPackage
  api?: string
  name: string
  env?: string[]
  id?: string
  whitelist?: string[]
  blacklist?: string[]
  options: SanitizedProviderOptions
  models: Record<string, SanitizedModelConfig | null>
}

export type CustomProviderAuthChange = { mode: "preserve" } | { mode: "clear" } | { mode: "set"; key: string }

export const MASKED_CUSTOM_PROVIDER_KEY = "********"

type Issue = { error: string; issue?: z.ZodIssue }
const SECRET_PROVIDER_OPTION_KEYS = new Set([
  "apikey",
  "api_key",
  "api-key",
  "access_token",
  "accesstoken",
  "access-token",
  "auth_token",
  "authtoken",
  "auth-token",
  "bearertoken",
  "bearer_token",
  "bearer-token",
])

function fail(error: string, issue?: z.ZodIssue): Issue {
  return issue ? { error, issue } : { error }
}

function isSecretProviderOptionKey(key: string) {
  return SECRET_PROVIDER_OPTION_KEYS.has(key.trim().toLowerCase())
}

function stripSecretProviderOptions(options: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !isSecretProviderOptionKey(key)))
}

export function validateProviderID(providerID: string): { value: string } | Issue {
  const result = ProviderIDSchema.safeParse(providerID)
  if (result.success) return { value: result.data }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_PROVIDER_ID, issue)
}

export function parseCustomProviderSecret(raw: string): { value: { apiKey?: string; env?: string } } | Issue {
  const value = raw.trim()
  if (!value) return { value: {} }

  const match = value.match(/^\{env:([^}]+)\}$/)
  if (!match) return { value: { apiKey: value } }

  const env = match[1]?.trim() ?? ""
  const result = EnvSchema.safeParse(env)
  if (result.success) return { value: { env: result.data } }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_ENV, issue)
}

export function resolveCustomProviderAuth(apiKey: string | undefined, changed: boolean): CustomProviderAuthChange {
  const key = apiKey?.trim()
  if (!changed) return { mode: "preserve" }
  if (key) return { mode: "set", key }
  return { mode: "clear" }
}

export function resolveCustomProviderKey(auth: "api" | "oauth" | "wellknown" | undefined) {
  if (auth !== "api") return ""
  return MASKED_CUSTOM_PROVIDER_KEY
}

export function normalizeCustomProviderConfig(
  config: z.output<typeof CustomProviderConfigSchema>,
): SanitizedProviderConfig {
  const headers = config.options.headers
    ? Object.fromEntries(
        Object.entries(config.options.headers)
          .map(([key, value]) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key.length > 0 && value.length > 0),
      )
    : undefined

  const { baseURL, headers: _headers, ...optionRest } = config.options
  const safeOptionRest = stripSecretProviderOptions(optionRest)
  const provider: SanitizedProviderConfig = {
    npm: config.npm,
    name: config.name.trim(),
    ...(config.api ? { api: config.api.trim() } : {}),
    ...(config.env ? { env: config.env.map((item) => item.trim()) } : {}),
    ...(config.id ? { id: config.id.trim() } : {}),
    ...(config.whitelist ? { whitelist: config.whitelist.map((item) => item.trim()).filter(Boolean) } : {}),
    ...(config.blacklist ? { blacklist: config.blacklist.map((item) => item.trim()).filter(Boolean) } : {}),
    options: {
      ...safeOptionRest,
      baseURL: baseURL.trim(),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
    models: Object.fromEntries(
      Object.entries(config.models).map(([id, model]) => {
        const {
          name,
          id: modelID,
          family,
          release_date,
          provider: modelProvider,
          headers: modelHeaders,
          limit,
          variants,
          ...modelRest
        } = model
        const normalizedModel: SanitizedModelConfig = {
          ...modelRest,
          name: name.trim(),
        }
        if (modelID) normalizedModel.id = modelID.trim()
        if (family) normalizedModel.family = family.trim()
        if (release_date) normalizedModel.release_date = release_date.trim()
        if (modelProvider) {
          const providerConfig = {
            ...(modelProvider.npm ? { npm: modelProvider.npm.trim() } : {}),
            ...(modelProvider.api ? { api: modelProvider.api.trim() } : {}),
          }
          if (Object.keys(providerConfig).length > 0) normalizedModel.provider = providerConfig
        }
        if (modelHeaders) {
          const normalizedHeaders = Object.fromEntries(
            Object.entries(modelHeaders)
              .map(([key, value]) => [key.trim(), value.trim()] as const)
              .filter(([key, value]) => key.length > 0 && value.length > 0),
          )
          if (Object.keys(normalizedHeaders).length > 0) normalizedModel.headers = normalizedHeaders
        }
        if (limit) {
          normalizedModel.limit = {
            context: limit.context,
            ...(limit.input ? { input: limit.input } : {}),
            output: limit.output,
          }
        }
        if (variants && Object.keys(variants).length > 0) normalizedModel.variants = variants
        return [id.trim(), normalizedModel]
      }),
    ),
  }
  return provider
}

export function sanitizeCustomProviderConfig(provider: unknown): { value: SanitizedProviderConfig } | Issue {
  const result = CustomProviderConfigSchema.safeParse(provider)
  if (!result.success) {
    const issue = result.error.issues[0]
    return fail(issue?.message ?? "Invalid custom provider config", issue)
  }

  return { value: normalizeCustomProviderConfig(result.data) }
}

type AnyRecord = Record<string, unknown>
type VariantPatch = Partial<{ [Key in keyof VariantConfig]: VariantConfig[Key] | null }>
type ProviderPatch = Omit<SanitizedProviderConfig, "models"> & {
  models: Record<
    string,
    null | {
      name: string
      reasoning?: true | null
      variants?: Record<string, VariantConfig | VariantPatch | null>
    }
  >
}

function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Build a provider patch that includes null sentinels for model properties,
 * variants, and variant options that existed in the previous config but are
 * absent from the new one. The CLI `config.update` endpoint deep-merges the
 * payload with the existing config; without explicit nulls, removed entries
 * would persist on disk.
 */
export function withCustomProviderDeletions(existing: unknown, next: SanitizedProviderConfig): SanitizedProviderConfig {
  if (!isRecord(existing)) return next
  const oldModels = isRecord(existing.models) ? existing.models : {}
  const patched: ProviderPatch["models"] = { ...next.models }

  for (const id of Object.keys(oldModels)) {
    if (!(id in patched)) {
      patched[id] = null
      continue
    }
    const oldModel = oldModels[id]
    const newModel = patched[id]
    if (!isRecord(oldModel) || !isRecord(newModel)) continue
    const oldVariants = isRecord(oldModel.variants) ? oldModel.variants : {}
    const newVariants = isRecord(newModel.variants) ? newModel.variants : {}
    const changes: Record<string, VariantPatch | null> = {}
    for (const [name, oldVariant] of Object.entries(oldVariants)) {
      if (!(name in newVariants)) {
        changes[name] = null
        continue
      }
      const newVariant = newVariants[name]
      if (!isRecord(oldVariant) || !isRecord(newVariant)) continue
      const removed = Object.keys(oldVariant).filter((key) => !(key in newVariant))
      if (removed.length === 0) continue
      const nulls = Object.fromEntries(removed.map((key) => [key, null]))
      changes[name] = { ...newVariant, ...nulls } as VariantPatch
    }
    const variants = Object.keys(changes).length > 0 ? { ...newVariants, ...changes } : newModel.variants
    patched[id] = {
      ...newModel,
      ...(variants ? { variants } : {}),
      ...(oldModel.reasoning !== undefined && newModel.reasoning === undefined ? { reasoning: null } : {}),
    }
  }

  return { ...next, models: patched } as SanitizedProviderConfig
}
