// kilocode_change - new file
import { createHash } from "node:crypto"
import { createStableLcmID, type LcmStableIDPrefix } from "../../../src/session/lcm/id"
import { MESSAGE_V2_SYNC_TAXONOMY } from "../../../src/session/lcm/source-sync"
import {
  canonicalJson,
  serializeMessagePartSearchText,
  type LcmBoundaryMetadataV1,
  type ValidatorResult,
} from "../../../src/session/lcm/validators"
import {
  createLcmSafeError,
  type ContextItemID,
  type ConversationID,
  type LcmRecoveryResult,
  type LcmSafeError,
  type LcmTokenCounterMode,
  type MessageRowID,
  type OperationID,
  type SummaryID,
} from "../../../src/session/lcm/types"

export const LCM_FAKE_TOKEN_COUNTER_VERSION = "lcm-fake-token-counter-v1"
export const LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION = "lcm-deterministic-fallback-token-counter-v1"
export const LCM_PROVIDER_TOKEN_COUNTER_VERSION = "lcm-provider-token-counter-v1-fixture"

export const LCM_TOKEN_COUNTER_FIXTURES = {
  provider: {
    mode: "provider",
    version: LCM_PROVIDER_TOKEN_COUNTER_VERSION,
  },
  deterministicFallback: {
    mode: "deterministic_fallback",
    version: LCM_DETERMINISTIC_FALLBACK_TOKEN_COUNTER_VERSION,
  },
  fake: {
    mode: "fake",
    version: LCM_FAKE_TOKEN_COUNTER_VERSION,
  },
} satisfies Record<string, { mode: LcmTokenCounterMode; version: string }>

export const LCM_HARNESS_SENTINELS = {
  sourceText: "LCM_HARNESS_SOURCE_SENTINEL",
  toolOutput: "LCM_HARNESS_TOOL_OUTPUT_SENTINEL",
  artifactBytes: "LCM_HARNESS_ARTIFACT_SENTINEL",
  promptBoundary: "LCM_HARNESS_PROMPT_BOUNDARY_SENTINEL",
} as const

export interface TokenCacheKeyInput {
  readonly mode: LcmTokenCounterMode
  readonly version: string
  readonly providerID?: string
  readonly modelID?: string
  readonly contentKind: "message" | "summary" | "prompt" | "tool_schema" | "marker"
  readonly contentID?: string
  readonly contentSha256?: string
  readonly text?: string
}

export function sha256Hex(input: string | Uint8Array) {
  return createHash("sha256").update(input).digest("hex")
}

export function deterministicFallbackTokenCount(text: string) {
  return Math.ceil(text.length / 4)
}

export function createTokenCacheKey(input: TokenCacheKeyInput) {
  return sha256Hex(canonicalJson(input))
}

export function createFakeTokenCounter(counts: Record<string, number>) {
  return {
    mode: "fake" as const,
    version: LCM_FAKE_TOKEN_COUNTER_VERSION,
    count(input: { cacheKey?: string; text?: string }) {
      const key = input.cacheKey ?? input.text
      if (!key) throw new Error("lcm_fake_token_counter_missing_key")
      const count = counts[key]
      if (count === undefined) throw new Error(`lcm_fake_token_counter_missing_fixture:${key}`)
      return count
    },
  }
}

export type ScriptedGenerationOutcome<TValue> =
  | { kind: "success"; value: TValue }
  | { kind: "error"; diagnosticCode: string }
  | { kind: "timeout"; diagnosticCode?: string }

export class LcmHarnessScriptedError extends Error {
  constructor(
    readonly kind: "error" | "timeout",
    readonly diagnosticCode: string,
  ) {
    super(diagnosticCode)
    this.name = kind === "timeout" ? "LcmHarnessTimeoutError" : "LcmHarnessScriptedError"
  }
}

export function createScriptedGenerator<TInput, TValue>(script: readonly ScriptedGenerationOutcome<TValue>[]) {
  let index = 0
  return {
    get attempts() {
      return index
    },
    async generate(_input: TInput): Promise<TValue> {
      const outcome = script[index]
      index++
      if (!outcome) throw new LcmHarnessScriptedError("error", "lcm_script_exhausted")
      if (outcome.kind === "success") return outcome.value
      if (outcome.kind === "timeout") {
        throw new LcmHarnessScriptedError("timeout", outcome.diagnosticCode ?? "lcm_script_timeout")
      }
      throw new LcmHarnessScriptedError("error", outcome.diagnosticCode)
    },
  }
}

export const LCM_FAKE_SUMMARY_OUTPUTS = {
  validSmaller: "chronological continuity summary",
  empty: "",
  nonSmaller:
    "chronological continuity summary chronological continuity summary chronological continuity summary chronological continuity summary",
  lowQualitySmaller: "ok",
} as const

export function classifySummaryOutput(input: { text: string; sourceTokens: number; summaryTokens: number }) {
  if (input.text.length === 0) return "empty"
  if (input.summaryTokens >= input.sourceTokens) return "non_smaller"
  if (input.text === LCM_FAKE_SUMMARY_OUTPUTS.lowQualitySmaller) return "low_quality_smaller"
  return "valid_smaller"
}

export function createFakeSummarizer(script: readonly ScriptedGenerationOutcome<string>[]) {
  return createScriptedGenerator<{ sourceItems: string }, string>(script)
}

export function createFakeModelRunner(script: readonly ScriptedGenerationOutcome<string>[]) {
  const runner = createScriptedGenerator<{ prompt: string }, string>(script)
  return {
    get attempts() {
      return runner.attempts
    },
    async generateJson(input: { prompt: string; schema?: unknown }) {
      const text = await runner.generate(input)
      try {
        const value = JSON.parse(text)
        if (input.schema) {
          const validation = validateJsonValueWithLocalSchema(value, input.schema)
          if (!validation.ok) {
            return { ok: false as const, kind: "schema_invalid" as const, text, reason: validation.reason }
          }
        }
        return { ok: true as const, text, value }
      } catch {
        return { ok: false as const, kind: "invalid_json" as const, text, reason: "invalid_json" }
      }
    },
  }
}

export function createDeterministicClock(startMs = 0) {
  let current = startMs
  const sleepers = new Set<{
    wakeAt: number
    resolve: () => void
    reject: (error: unknown) => void
    signal?: AbortSignal
    onAbort?: () => void
  }>()

  function flush() {
    for (const sleeper of Array.from(sleepers)) {
      if (sleeper.wakeAt > current) continue
      sleepers.delete(sleeper)
      if (sleeper.signal && sleeper.onAbort) sleeper.signal.removeEventListener("abort", sleeper.onAbort)
      sleeper.resolve()
    }
  }

  return {
    now() {
      return current
    },
    advance(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error("lcm_clock_invalid_advance")
      current += ms
      flush()
    },
    sleep(ms: number, signal?: AbortSignal) {
      if (!Number.isFinite(ms) || ms < 0) return Promise.reject(new Error("lcm_clock_invalid_sleep"))
      if (signal?.aborted) return Promise.reject(new Error("lcm_clock_sleep_canceled"))
      if (ms === 0) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const sleeper = {
          wakeAt: current + ms,
          resolve,
          reject,
          signal,
          onAbort: undefined as (() => void) | undefined,
        }
        if (signal) {
          sleeper.onAbort = () => {
            sleepers.delete(sleeper)
            reject(new Error("lcm_clock_sleep_canceled"))
          }
          signal.addEventListener("abort", sleeper.onAbort, { once: true })
        }
        sleepers.add(sleeper)
      })
    },
  }
}

export function createHarnessCancellationSource() {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    cancel() {
      controller.abort()
    },
  }
}

function bytesFromHex(hex: string, size: number) {
  const bytes = Buffer.from(hex, "hex")
  if (bytes.length !== size) throw new Error(`lcm_fixed_random_size_mismatch:${bytes.length}:${size}`)
  return bytes
}

export function fixedRandomBytesFromHex(hex: string) {
  return (size: number) => bytesFromHex(hex, size)
}

export function fixedRandomBytesSequence(hexes: readonly string[]) {
  let index = 0
  return (size: number) => {
    const hex = hexes[index]
    index++
    if (!hex) throw new Error("lcm_fixed_random_sequence_exhausted")
    return bytesFromHex(hex, size)
  }
}

export function createFixedStableID<TPrefix extends LcmStableIDPrefix>(prefix: TPrefix, hex: string) {
  return createStableLcmID(prefix, { randomBytes: fixedRandomBytesFromHex(hex) })
}

export function createHarnessBoundaryMetadata(overrides: Partial<LcmBoundaryMetadataV1> = {}): LcmBoundaryMetadataV1 {
  return {
    version: 1,
    projectID: "project_harness",
    workspaceID: "workspace_harness",
    platformPathFlavor: "posix",
    caseSensitivity: "sensitive",
    sessionDirectoryOriginal: "/workspace/harness",
    sessionDirectoryCanonical: "/workspace/harness",
    worktreeOriginal: "/workspace/harness",
    worktreeCanonical: "/workspace/harness",
    allowedRootOriginals: ["/workspace/harness"],
    allowedRootCanonicals: ["/workspace/harness"],
    kiloPermissionContext: {
      source: "worktree",
      permissionProfileID: "profile_harness",
    },
    ...overrides,
  }
}

export function createBenchmarkFixtureManifest() {
  return {
    fixtureID: "benchmark-fixture-standard-v1",
    rowCounts: {
      conversations: 1,
      messages: 2,
      messageParts: 3,
      summaries: 1,
      contextItems: 2,
      largeFiles: 1,
      mapRuns: 0,
    },
    artifactBytes: 128,
    tokenCounterFixtures: [
      LCM_TOKEN_COUNTER_FIXTURES.provider,
      LCM_TOKEN_COUNTER_FIXTURES.deterministicFallback,
      LCM_TOKEN_COUNTER_FIXTURES.fake,
    ],
    cacheState: "cold",
    commandMetadata: {
      suiteID: "lcm:recovery",
      concurrency: 1,
    },
  }
}

export function createVerticalSliceFixture() {
  return {
    fixtureID: "vertical-slice-acceptance-matrix-v1",
    sealedMessageIDs: ["msg_harness_user", "msg_harness_assistant"],
    activeContextItemIDs: ["ctx_harness_raw", "ctx_harness_summary"],
    fakeProviderID: "provider_harness",
    retrievalHandles: ["sum_harness_sprig", "file_harness_inline"],
    largeFileID: "file_harness_inline",
    mapInputFileID: "file_harness_map_input",
    sentinel: LCM_HARNESS_SENTINELS.promptBoundary,
  }
}

export function classifyRecoveryFixture(input: {
  readonly hasImmutableSource: boolean
  readonly hasDerivedContext: boolean
  readonly hasArtifactBytes?: boolean
  readonly hasArtifactMetadata?: boolean
}) {
  if (!input.hasImmutableSource) return "missing_source"
  if (input.hasArtifactBytes && !input.hasArtifactMetadata) return "unprovable_artifact_only"
  if (!input.hasDerivedContext) return "rebuildable_derived"
  return "healthy"
}

export function validateMessageV2Discriminators(input: {
  readonly role?: string
  readonly partKind?: string
  readonly toolState?: string
}): ValidatorResult {
  if (input.role && !(MESSAGE_V2_SYNC_TAXONOMY.roles as readonly string[]).includes(input.role)) {
    return { ok: false, reason: "unknown_message_role" }
  }
  if (input.partKind && !(MESSAGE_V2_SYNC_TAXONOMY.partKinds as readonly string[]).includes(input.partKind)) {
    return { ok: false, reason: "unknown_part_kind" }
  }
  if (input.toolState && !(MESSAGE_V2_SYNC_TAXONOMY.toolStates as readonly string[]).includes(input.toolState)) {
    return { ok: false, reason: "unknown_tool_state" }
  }
  return { ok: true }
}

type JsonSchema = boolean | Record<string, unknown>

export interface LocalJsonSchemaOptions {
  readonly maxSchemaBytes?: number
  readonly maxDepth?: number
  readonly maxProperties?: number
  readonly maxRefVisits?: number
}

const defaultSchemaOptions = {
  maxSchemaBytes: 16_384,
  maxDepth: 16,
  maxProperties: 256,
  maxRefVisits: 64,
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function schemaOptions(input?: LocalJsonSchemaOptions) {
  return { ...defaultSchemaOptions, ...input }
}

function resolveLocalRef(root: unknown, ref: string): ValidatorResult & { value?: unknown } {
  if (ref === "#") return { ok: true, value: root }
  if (!ref.startsWith("#/")) return { ok: false, reason: "external_ref_rejected" }
  let current = root
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~")
    if (!isObject(current) && !Array.isArray(current)) return { ok: false, reason: "ref_target_missing" }
    current = (current as Record<string, unknown>)[segment]
  }
  return current === undefined ? { ok: false, reason: "ref_target_missing" } : { ok: true, value: current }
}

function inspectSchema(
  root: unknown,
  node: unknown,
  options: Required<LocalJsonSchemaOptions>,
  state: { depth: number; properties: number; refs: number },
): ValidatorResult {
  const bytes = Buffer.byteLength(canonicalJson(root), "utf8")
  if (bytes > options.maxSchemaBytes) return { ok: false, reason: "schema_too_large" }
  if (state.depth > options.maxDepth) return { ok: false, reason: "schema_too_deep" }
  if (typeof node === "boolean") return { ok: true }
  if (!isObject(node)) return { ok: false, reason: "schema_not_object" }
  const ref = node.$ref
  if (ref !== undefined) {
    if (typeof ref !== "string") return { ok: false, reason: "ref_not_string" }
    if (/^(https?:|file:)/i.test(ref)) return { ok: false, reason: "remote_ref_rejected" }
    state.refs++
    if (state.refs > options.maxRefVisits) return { ok: false, reason: "ref_limit_exceeded" }
    const resolved = resolveLocalRef(root, ref)
    if (!resolved.ok) return resolved
    return inspectSchema(root, resolved.value, options, { ...state, depth: state.depth + 1 })
  }
  const properties = node.properties
  if (isObject(properties)) {
    state.properties += Object.keys(properties).length
    if (state.properties > options.maxProperties) return { ok: false, reason: "schema_property_limit_exceeded" }
    for (const child of Object.values(properties)) {
      const result = inspectSchema(root, child, options, { ...state, depth: state.depth + 1 })
      if (!result.ok) return result
    }
  }
  const defs = node.$defs
  if (isObject(defs)) {
    for (const child of Object.values(defs)) {
      const result = inspectSchema(root, child, options, { ...state, depth: state.depth + 1 })
      if (!result.ok) return result
    }
  }
  if (node.items !== undefined) {
    const result = inspectSchema(root, node.items, options, { ...state, depth: state.depth + 1 })
    if (!result.ok) return result
  }
  return { ok: true }
}

function valueType(value: unknown) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (Number.isInteger(value)) return "integer"
  return typeof value
}

function validateValue(root: unknown, value: unknown, schema: JsonSchema): ValidatorResult {
  if (schema === true) return { ok: true }
  if (schema === false) return { ok: false, reason: "false_schema" }
  const ref = schema.$ref
  if (typeof ref === "string") {
    const resolved = resolveLocalRef(root, ref)
    if (!resolved.ok) return resolved
    return validateValue(root, value, resolved.value as JsonSchema)
  }
  if (schema.const !== undefined && canonicalJson(schema.const) !== canonicalJson(value)) {
    return { ok: false, reason: "const_mismatch" }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonicalJson(item) === canonicalJson(value))) {
    return { ok: false, reason: "enum_mismatch" }
  }
  const type = schema.type
  if (typeof type === "string") {
    const actual = valueType(value)
    const matches = type === "number" ? actual === "number" || actual === "integer" : actual === type
    if (!matches) return { ok: false, reason: "type_mismatch" }
  }
  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === "string" && !(key in value)) return { ok: false, reason: "required_missing" }
    }
    const properties = isObject(schema.properties) ? schema.properties : {}
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) {
        const result = validateValue(root, value[key], child as JsonSchema)
        if (!result.ok) return result
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) return { ok: false, reason: "additional_property" }
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    for (const item of value) {
      const result = validateValue(root, item, schema.items as JsonSchema)
      if (!result.ok) return result
    }
  }
  return { ok: true }
}

export function hashLocalJsonSchema(schema: unknown) {
  return sha256Hex(canonicalJson(schema))
}

export function validateLocalJsonSchemaDocument(
  schema: unknown,
  inputOptions?: LocalJsonSchemaOptions,
): ValidatorResult {
  const options = schemaOptions(inputOptions)
  return inspectSchema(schema, schema, options, { depth: 0, properties: 0, refs: 0 })
}

export function validateJsonValueWithLocalSchema(
  value: unknown,
  schema: unknown,
  inputOptions?: LocalJsonSchemaOptions,
): ValidatorResult {
  const schemaResult = validateLocalJsonSchemaDocument(schema, inputOptions)
  if (!schemaResult.ok) return schemaResult
  return validateValue(schema, value, schema as JsonSchema)
}

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export const LCM_RECOVERY_FIXTURE_IDS = {
  conversationID: "conv_harness_recovery" as ConversationID,
  sessionID: "session_harness_recovery",
  messageRowID: "msg_harness_user" as MessageRowID,
  summaryID: "sum_harness_sprig" as SummaryID,
  rawContextID: "ctx_harness_raw" as ContextItemID,
  summaryContextID: "ctx_harness_summary" as ContextItemID,
  operationID: "op_harness_recovery" as OperationID,
} as const

function missingSourceError(conversationID: ConversationID): LcmSafeError<"lcm.recovery.missing_source"> {
  return createLcmSafeError({
    code: "missing_source",
    templateKey: "lcm.recovery.missing_source",
    safeParams: {
      conversationID,
      action: "repeat_input",
    },
    retryable: false,
    diagnosticCode: "lcm_recovery_fixture_missing_source",
  })
}

export async function seedRecoveryConversationFixture(db: Queryable) {
  const boundary = JSON.stringify(createHarnessBoundaryMetadata())
  const now = 1_777_500_007_000
  const searchText = serializeMessagePartSearchText({
    textContent: `sealed source ${LCM_HARNESS_SENTINELS.sourceText}`,
  })

  await db.query(
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
        lifecycle_state,
        schema_version,
        feature_version,
        created_at_ms,
        updated_at_ms
      )
      VALUES (
        $1,
        $2,
        $1,
        'project_harness',
        'workspace_harness',
        '/workspace/harness',
        '/workspace/harness',
        $3::jsonb,
        'passive_synced',
        4,
        1,
        $4,
        $4
      )
    `,
    [LCM_RECOVERY_FIXTURE_IDS.conversationID, LCM_RECOVERY_FIXTURE_IDS.sessionID, boundary, now],
  )
  await db.query(
    `
      INSERT INTO lcm_messages (
        message_row_id,
        conversation_id,
        source_session_id,
        source_message_id,
        role,
        message_order,
        created_at_ms,
        metadata_json
      )
      VALUES ($1, $2, $3, 'source_msg_harness_user', 'user', 1, $4, '{}'::jsonb)
    `,
    [
      LCM_RECOVERY_FIXTURE_IDS.messageRowID,
      LCM_RECOVERY_FIXTURE_IDS.conversationID,
      LCM_RECOVERY_FIXTURE_IDS.sessionID,
      now,
    ],
  )
  await db.query(
    `
      INSERT INTO lcm_message_parts (
        part_row_id,
        message_row_id,
        conversation_id,
        source_part_key,
        part_order,
        part_kind,
        text_content,
        content_sha256,
        search_text,
        created_at_ms
      )
      VALUES (
        'part_harness_text',
        $1,
        $2,
        'derived:source_msg_harness_user:1:text:i0s0c0',
        1,
        'text',
        $3,
        $4,
        $5,
        $6
      )
    `,
    [
      LCM_RECOVERY_FIXTURE_IDS.messageRowID,
      LCM_RECOVERY_FIXTURE_IDS.conversationID,
      `sealed source ${LCM_HARNESS_SENTINELS.sourceText}`,
      "1".repeat(64),
      searchText,
      now,
    ],
  )
  await db.query(
    `
      INSERT INTO lcm_summaries (
        summary_id,
        conversation_id,
        summary_type,
        content_text,
        source_token_count,
        summary_token_count,
        prompt_version,
        strategy,
        objective_status,
        fallback_mode,
        created_at_ms
      )
      VALUES ($1, $2, 'sprig', 'safe summary handle only', 100, 20, 'summary-leaf-v2', 'upward', 'accepted', 'none', $3)
    `,
    [LCM_RECOVERY_FIXTURE_IDS.summaryID, LCM_RECOVERY_FIXTURE_IDS.conversationID, now],
  )
  await db.query("INSERT INTO lcm_summary_messages (summary_id, message_row_id, source_order) VALUES ($1, $2, 1)", [
    LCM_RECOVERY_FIXTURE_IDS.summaryID,
    LCM_RECOVERY_FIXTURE_IDS.messageRowID,
  ])
  await db.query(
    `
      INSERT INTO lcm_context_items (
        context_item_id,
        conversation_id,
        item_order,
        item_type,
        message_row_id,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, 1, 'raw_message', $3, $4, $4)
    `,
    [
      LCM_RECOVERY_FIXTURE_IDS.rawContextID,
      LCM_RECOVERY_FIXTURE_IDS.conversationID,
      LCM_RECOVERY_FIXTURE_IDS.messageRowID,
      now,
    ],
  )
  await db.query(
    `
      INSERT INTO lcm_context_items (
        context_item_id,
        conversation_id,
        item_order,
        item_type,
        summary_id,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, 2, 'summary', $3, $4, $4)
    `,
    [
      LCM_RECOVERY_FIXTURE_IDS.summaryContextID,
      LCM_RECOVERY_FIXTURE_IDS.conversationID,
      LCM_RECOVERY_FIXTURE_IDS.summaryID,
      now,
    ],
  )
}

export async function rebuildDerivedContextFromImmutableFixture(
  db: Queryable,
  conversationID: ConversationID,
): Promise<LcmRecoveryResult> {
  const sourceRows = (
    await db.query<{ message_row_id: MessageRowID; message_order: number }>(
      `
        SELECT message_row_id, message_order
        FROM lcm_messages
        WHERE conversation_id = $1
        ORDER BY message_order, message_row_id
      `,
      [conversationID],
    )
  ).rows
  const summaryRows = (
    await db.query<{ summary_id: SummaryID; created_at_ms: number }>(
      `
        SELECT summary_id, created_at_ms
        FROM lcm_summaries
        WHERE conversation_id = $1
        ORDER BY created_at_ms, summary_id
      `,
      [conversationID],
    )
  ).rows
  if (sourceRows.length === 0 && summaryRows.length === 0) {
    return {
      conversationID,
      status: "failed",
      itemsRebuilt: 0,
      lifecycleState: "recovery_failed",
      safeError: missingSourceError(conversationID),
    }
  }

  await db.query("DELETE FROM lcm_context_items WHERE conversation_id = $1", [conversationID])
  let order = 1
  const now = 1_777_500_007_500
  for (const row of sourceRows) {
    await db.query(
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          message_row_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, 'raw_message', $4, $5, $5)
      `,
      [`ctx_rebuilt_raw_${order}`, conversationID, order, row.message_row_id, now],
    )
    order++
  }
  for (const row of summaryRows) {
    await db.query(
      `
        INSERT INTO lcm_context_items (
          context_item_id,
          conversation_id,
          item_order,
          item_type,
          summary_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, 'summary', $4, $5, $5)
      `,
      [`ctx_rebuilt_summary_${order}`, conversationID, order, row.summary_id, now],
    )
    order++
  }

  return {
    conversationID,
    status: "rebuilt",
    itemsRebuilt: order - 1,
    lifecycleState: "passive_synced",
  }
}
