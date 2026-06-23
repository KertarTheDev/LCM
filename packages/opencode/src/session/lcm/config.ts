// kilocode_change - new file
import { Schema } from "effect"
import z from "zod"
import type { LcmStrategy } from "./types"

const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))

export const PublicConfigZod = z
  .object({
    strategy: z.enum(["upward", "dolt"]).optional(),
    freshTailTokens: z.number().int().positive().optional(),
    storage: z
      .object({
        warningThresholdBytes: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const PublicConfigSchema = Schema.Struct({
  strategy: Schema.optional(Schema.Literals(["upward", "dolt"])).annotate({
    description: "LCM strategy setting. User-facing settings are persisted through normal Kilo config storage.",
  }),
  freshTailTokens: Schema.optional(PositiveInt).annotate({
    description:
      "Raw-message token budget kept fresh at the tail before soft backlog summarization. Selection rounds to whole messages.",
  }),
  storage: Schema.optional(
    Schema.Struct({
      warningThresholdBytes: Schema.optional(PositiveInt).annotate({
        description: "Deployment default warning threshold in bytes. It is not a storage cap.",
      }),
    }),
  ),
})

export type PublicConfig = Schema.Schema.Type<typeof PublicConfigSchema>

export const PUBLIC_DEFAULTS = {
  strategy: "upward" as LcmStrategy,
  freshTailTokens: 20_000,
  storage: {
    warningThresholdBytes: 10_737_418_240,
  },
}

export const RUNTIME_DEFAULTS = {
  thresholds: {
    softRatio: 0.6,
    hardRatio: 1,
    maxBlockingRounds: 10,
  },
  performance: {
    targetFreePercentage: 0.25,
    summaryTargetTokens: 1600,
    summaryGenerationMaxOutputTokens: 4096,
    summaryMaxOutputTokens: 1800,
    condenseMaxOutputTokens: 1800,
    freshTailTokens: 20_000,
    minMessagesToSummarize: 3,
    minProtectedTailLeaves: 2,
    softSweepMaxPasses: 1,
    softSweepMaxElapsedMs: 60_000,
  },
  scheduler: {
    maxSoftMaintenanceJobsPerConversation: 1,
    maxBackgroundMaintenanceModelJobsPerWorkspace: 1,
    maxChildSessionsPerRoot: 8,
    maxChildSessionsPerWorkspace: 16,
  },
  db: {
    maxForegroundQueueDepth: 256,
    maxBackgroundQueueDepth: 512,
    defaultRequestTimeoutMs: 0,
    syncRequestTimeoutMs: 120_000,
    tokenBudgetRequestTimeoutMs: 120_000,
    assemblyRequestTimeoutMs: 120_000,
    maintenanceRequestTimeoutMs: 180_000,
    retrievalRequestTimeoutMs: 30_000,
    largeFileRequestTimeoutMs: 120_000,
    mapRequestTimeoutMs: 120_000,
  },
  retrieval: {
    defaultPageLimit: 50,
    maxPageLimit: 100,
    maxToolResultBytes: 40_000,
    maxSnippetBytes: 1000,
    maxRegexPatternBytes: 4096,
    regexStatementTimeoutMs: 30_000,
    regexCancellationReleaseTargetMs: 1000,
    expandQueryMaxAnswerTokens: 2000,
    maxMemoryCuesPerTurn: 3,
    maxMemoryCueTokens: 400,
    maxMemoryCueTotalTokens: 1200,
  },
  largePayloads: {
    tokenThreshold: 10_000,
    promptPayloadThresholdBytes: 40_000,
    toolOutputThresholdBytes: 40_000,
    previewBytes: 4000,
    defaultReadMaxBytes: 100_000,
    maxReadBytes: 1_000_000,
    explorationEnabled: true,
    explorationSampleBytes: 204_800,
    explorationMaxFullLoadBytes: 52_428_800,
    explorerHelperOutputMaxBytes: 1_048_576,
    explorationMaxOutputTokens: 2200,
  },
  map: {
    llmMapWorkers: 16,
    agenticMapWorkers: 8,
    localProviderMapWorkers: 1,
    smallModelLlmMapWorkers: 4,
    smallModelAgenticMapWorkers: 2,
    providerPressureMapWorkers: 1,
    maxRetries: 2,
    maxRetriesLimit: 5,
    itemLeaseMs: 600_000,
    claimHeartbeatMs: 30_000,
  },
  upward: {
    freshTailCount: 2,
    leafChunkTokens: 20_000,
    leafMinFanout: 8,
    condensedMinFanout: 4,
    condensedMinFanoutHard: 2,
    condensedTargetTokens: 2000,
    archiveStubEviction: false,
  },
  dolt: {
    leaves: { soft: 50_000, hysteresisDelta: 5000, target: 50_000, cap: 50_000, freshTailFloor: 4 },
    sprigs: { soft: 10_000, hysteresisDelta: 2000, target: 10_000, minFanout: 4, hardMinFanout: 2 },
    bindles: { soft: 10_000, hysteresisDelta: 2000, target: 10_000, archiveStubEviction: true },
  },
} as const

export type ResolvedConfig = typeof RUNTIME_DEFAULTS & typeof PUBLIC_DEFAULTS

export function resolve(input?: PublicConfig): ResolvedConfig {
  return {
    ...RUNTIME_DEFAULTS,
    strategy: input?.strategy ?? PUBLIC_DEFAULTS.strategy,
    freshTailTokens: input?.freshTailTokens ?? PUBLIC_DEFAULTS.freshTailTokens,
    storage: {
      warningThresholdBytes: input?.storage?.warningThresholdBytes ?? PUBLIC_DEFAULTS.storage.warningThresholdBytes,
    },
  }
}

export function storageWarning(input: { storageBytes: number; warningThresholdBytes: number }) {
  return input.storageBytes >= input.warningThresholdBytes
}

export * as LcmConfig from "./config"
