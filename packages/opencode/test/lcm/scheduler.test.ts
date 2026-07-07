// kilocode_change - new file
import { expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import path from "node:path"
import { createLcmDbWorker } from "../../src/session/lcm/db-worker"
import { LCM_DB_GATE_SCHEMA_VERSION } from "../../src/session/lcm/db-smoke"
import {
  classifyLcmProviderCapacity,
  createLcmProviderCapacityRegistry,
  isLcmProviderCapacityDeferredError,
  lcmProviderCapacityInputFromModel,
  lcmProviderCapacityKeyHash,
  lcmProviderCapacityLane,
} from "../../src/session/lcm/provider-capacity"
import {
  createLcmSoftSweepBudget,
  lcmCountWorkspaceSoftMaintenance,
  lcmDeferredSoftMaintenanceRetryDelayMs,
  lcmMaintenanceWorkspaceKey,
  lcmRecordSummaryFailureBackoff,
  lcmSoftSweepShouldStartPass,
  lcmSummaryFailureBackoffKey,
  lcmSummaryFailureBackoffRemainingMs,
  lcmSummaryFailureBackoffTelemetry,
} from "../../src/session/lcm/runtime"
import { decideMaintenanceTrigger } from "../../src/session/lcm/scheduler"
import {
  createLcmSafeError,
  type ConversationID,
  type LcmDbRequest,
  type LcmThresholdDecision,
  type OperationID,
} from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

function operationID(suffix: string): OperationID {
  return `op_m11_scheduler_${suffix}` as OperationID
}

function threshold(input: { activeTokens: number; soft: number; hard: number }): LcmThresholdDecision {
  return {
    conversationID: "conv_m11_scheduler" as ConversationID,
    strategy: "upward",
    activeTokens: input.activeTokens,
    hardLimit: input.hard,
    softThreshold: input.soft,
    freshTailTokens: 20_000,
    softBacklogTokens: input.activeTokens,
    softBacklogItemCount: 10,
    freshTailRawTokens: 0,
    freshTailRawItemCount: 0,
    unconsumedRawTokens: 0,
    unconsumedRawItemCount: 0,
    outputReserve: 10,
    systemPromptTokens: 1,
    toolSchemaTokens: 1,
    providerContextLimit: input.hard + 10,
    hardFillRatio: input.hard > 0 ? input.activeTokens / input.hard : 0,
    protectedTailRawTokens: 0,
    protectedTailRawItemCount: 0,
    rawLaneTokens: input.activeTokens,
    rawLaneRatio: input.soft > 0 ? input.activeTokens / input.soft : 0,
    softBacklogRatio: input.soft > 0 ? input.activeTokens / input.soft : 0,
    tokenCounterMode: "fake",
    tokenCounterVersion: "scheduler-test",
    overSoft: input.activeTokens > input.soft,
    overHard: input.activeTokens > input.hard,
    lanes: {
      rawLeaves: {
        lane: "raw_leaves",
        tokens: input.activeTokens,
        itemCount: 10,
        targetTokens: 20_000,
        overTarget: true,
        eligibleItemCount: 8,
        nextAction: "summarize_leaves",
      },
      sprigs: {
        lane: "sprigs",
        tokens: 0,
        itemCount: 0,
        targetTokens: 2000,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      },
      bindles: {
        lane: "bindles",
        tokens: 0,
        itemCount: 0,
        targetTokens: 2000,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      },
      archiveStubs: {
        lane: "archive_stubs",
        tokens: 0,
        itemCount: 0,
        targetTokens: 0,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      },
      largeFileMarkers: {
        lane: "large_file_markers",
        tokens: 0,
        itemCount: 0,
        targetTokens: 0,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      },
      retrievalCues: {
        lane: "retrieval_cues",
        tokens: 0,
        itemCount: 0,
        targetTokens: 1200,
        overTarget: false,
        eligibleItemCount: 0,
        nextAction: "none",
      },
    },
  }
}

function request<T>(
  input: Omit<LcmDbRequest<T>, "operationID" | "purpose"> & { purpose?: LcmDbRequest<T>["purpose"] },
): LcmDbRequest<T> {
  return {
    operationID: operationID("db"),
    purpose: input.purpose ?? "debug_support",
    lane: input.lane,
    run: input.run,
  }
}

async function waitForValue<T>(read: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error(`timed out waiting for ${label}`)
}

test("lcm:scheduler creates nonblocking soft and blocking hard trigger records", () => {
  expect(
    decideMaintenanceTrigger({
      threshold: threshold({ activeTokens: 10, soft: 20, hard: 30 }),
      operationID: operationID("none"),
    }),
  ).toMatchObject({
    trigger: "none",
    result: { workNeeded: false, blocking: false, status: "healthy" },
  })
  expect(
    decideMaintenanceTrigger({
      threshold: threshold({ activeTokens: 25, soft: 20, hard: 30 }),
      operationID: operationID("soft"),
    }),
  ).toMatchObject({
    trigger: "soft_background",
    result: { workNeeded: true, blocking: false, reason: "soft_threshold", workPerformed: false },
  })
  expect(
    decideMaintenanceTrigger({
      threshold: threshold({ activeTokens: 35, soft: 20, hard: 30 }),
      operationID: operationID("hard"),
    }),
  ).toMatchObject({
    trigger: "hard_blocking",
    result: { workNeeded: true, blocking: true, reason: "hard_limit", workPerformed: false },
  })
})

test("lcm:scheduler respects soft-maintenance caps without blocking foreground turns", () => {
  expect(
    decideMaintenanceTrigger({
      threshold: threshold({ activeTokens: 25, soft: 20, hard: 30 }),
      state: { softMaintenanceJobsForConversation: 1, backgroundJobsInWorkspace: 0 },
      operationID: operationID("conversation_cap"),
    }),
  ).toMatchObject({ trigger: "soft_cap_deferred", result: { blocking: false, workNeeded: true } })
  expect(
    decideMaintenanceTrigger({
      threshold: threshold({ activeTokens: 25, soft: 20, hard: 30 }),
      state: { softMaintenanceJobsForConversation: 0, backgroundJobsInWorkspace: 2 },
      operationID: operationID("workspace_cap"),
    }),
  ).toMatchObject({ trigger: "soft_cap_deferred", result: { blocking: false, workNeeded: true } })
})

test("lcm:scheduler uses capped backoff for deferred soft-maintenance retries", () => {
  expect(lcmDeferredSoftMaintenanceRetryDelayMs(0)).toBe(2_000)
  expect(lcmDeferredSoftMaintenanceRetryDelayMs(1)).toBe(2_000)
  expect(lcmDeferredSoftMaintenanceRetryDelayMs(2)).toBe(4_000)
  expect(lcmDeferredSoftMaintenanceRetryDelayMs(3)).toBe(8_000)
  expect(lcmDeferredSoftMaintenanceRetryDelayMs(99)).toBe(30_000)
})

test("lcm:scheduler bounds soft sweeps by pass and elapsed budgets", () => {
  const budget = createLcmSoftSweepBudget({
    startedAtMs: 1_000,
    maxPasses: 1,
    maxElapsedMs: 5_000,
  })

  expect(lcmSoftSweepShouldStartPass({ budget, passesCompleted: 0, nowMs: 1_000 })).toEqual({
    canStart: true,
    elapsedMs: 0,
  })
  expect(lcmSoftSweepShouldStartPass({ budget, passesCompleted: 1, nowMs: 1_100 })).toEqual({
    canStart: false,
    elapsedMs: 100,
    stopReason: "iteration_cap",
  })
  expect(
    lcmSoftSweepShouldStartPass({
      budget: createLcmSoftSweepBudget({ startedAtMs: 1_000, maxPasses: 1, maxElapsedMs: 0 }),
      passesCompleted: 0,
      nowMs: 1_000,
    }),
  ).toEqual({
    canStart: false,
    elapsedMs: 0,
    stopReason: "elapsed_cap",
  })
})

test("lcm:scheduler tracks summary failure cooldown by route and recovers after cooldown", () => {
  const route = {
    conversationID: "conv_m11_scheduler_backoff" as ConversationID,
    purpose: "leaf_summary",
    promptVersion: "summary-leaf-v2",
    providerID: "ollama",
    modelID: "qwen3",
  } as const
  const safeError = createLcmSafeError({
    code: "timeout",
    templateKey: "lcm.operation.timeout",
    safeParams: { retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "m11_soft_summary_timeout",
  })

  const first = lcmRecordSummaryFailureBackoff({ route, safeError, nowMs: 10_000 })
  expect(lcmSummaryFailureBackoffRemainingMs({ state: first, nowMs: 10_000 })).toBe(0)

  const second = lcmRecordSummaryFailureBackoff({ route, state: first, safeError, nowMs: 10_500 })
  expect(second.failureCount).toBe(2)
  expect(lcmSummaryFailureBackoffRemainingMs({ state: second, nowMs: 10_500 })).toBe(4_000)
  expect(lcmSummaryFailureBackoffTelemetry({ state: second, nowMs: 11_500 })).toMatchObject({
    summaryPromptVersion: "summary-leaf-v2",
    summaryBackoffPurpose: "leaf_summary",
    summaryBackoffFailureCount: 2,
    summaryBackoffDelayMs: 4_000,
    summaryBackoffRemainingMs: 3_000,
  })
  expect(lcmSummaryFailureBackoffRemainingMs({ state: second, nowMs: second.nextAllowedAtMs })).toBe(0)
  expect(lcmSummaryFailureBackoffKey(route)).not.toBe(
    lcmSummaryFailureBackoffKey({ ...route, purpose: "hard_limit_maintenance" }),
  )
})

test("lcm:scheduler counts soft-maintenance capacity per explicit workspace key", () => {
  expect(
    lcmMaintenanceWorkspaceKey({
      familyID: "family_scheduler_workspace",
      projectID: "project_a",
      workspaceID: "workspace_a",
    }),
  ).toBe("workspace:workspace_a")
  expect(
    lcmMaintenanceWorkspaceKey({
      familyID: "family_scheduler_project",
      projectID: "project_b",
    }),
  ).toBe("project:project_b")
  expect(
    lcmCountWorkspaceSoftMaintenance(
      ["workspace:workspace_a", "workspace:workspace_b", "workspace:workspace_a"],
      "workspace:workspace_a",
    ),
  ).toBe(2)
})

test("lcm:scheduler classifies Ollama and local OpenAI-compatible providers as local capacity targets", () => {
  expect(
    classifyLcmProviderCapacity({
      providerID: "ollama",
      modelID: "qwen3",
      apiID: "ollama-openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      apiURL: "http://127.0.0.1:11434/v1",
    }),
  ).toBe("local_ollama")
  expect(
    classifyLcmProviderCapacity({
      providerID: "local-compatible",
      modelID: "custom-tool-model",
      apiID: "openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      baseURL: "http://localhost:8000/v1",
    }),
  ).toBe("local_openai_compatible")
  expect(
    classifyLcmProviderCapacity({
      providerID: "studio-compatible",
      modelID: "custom-tool-model",
      apiID: "openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      baseURL: "http://studio.local:8000/v1",
    }),
  ).toBe("local_openai_compatible")
  expect(
    classifyLcmProviderCapacity({
      providerID: "openai-compatible-cloud",
      modelID: "hosted",
      apiID: "openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      baseURL: "https://api.example.com/v1",
    }),
  ).toBe("remote_or_unknown")
  expect(
    classifyLcmProviderCapacity({
      providerID: "lan-compatible",
      modelID: "qwen3",
      apiID: "openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      baseURL: "http://nobara-ollama:11434/v1",
    }),
  ).toBe("local_ollama")
})

test("lcm:scheduler derives local capacity from provider-level custom OpenAI-compatible base URLs", () => {
  const input = lcmProviderCapacityInputFromModel({
    model: {
      id: "qwen3",
      providerID: "custom-openai-compatible",
      api: {
        id: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
      },
      options: {},
    },
    priority: "foreground",
    providerOptions: {
      baseURL: "http://127.0.0.1:11434/v1",
    },
  })

  expect(input.baseURL).toBe("http://127.0.0.1:11434/v1")
  expect(classifyLcmProviderCapacity(input)).toBe("local_ollama")
  expect(lcmProviderCapacityLane(input)).toMatchObject({
    capacityClass: "local_ollama",
    endpoint: "http://127.0.0.1:11434",
    key: "local_ollama|http://127.0.0.1:11434",
  })
})

test("lcm:scheduler derives stable local capacity lanes for LAN Ollama hostnames", () => {
  const input = lcmProviderCapacityInputFromModel({
    model: {
      id: "qwen3",
      providerID: "custom-openai-compatible",
      api: {
        id: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
      },
      options: {},
    },
    priority: "background",
    providerOptions: {
      baseURL: "http://nobara-ollama:11434/v1",
    },
  })

  expect(classifyLcmProviderCapacity(input)).toBe("local_ollama")
  expect(lcmProviderCapacityLane(input)).toMatchObject({
    capacityClass: "local_ollama",
    endpoint: "http://nobara-ollama:11434",
    key: "local_ollama|http://nobara-ollama:11434",
  })
})

test("lcm:scheduler defers local background model jobs while a foreground Ollama request is active", async () => {
  const registry = createLcmProviderCapacityRegistry()
  const request = {
    providerID: "ollama",
    modelID: "qwen3",
    apiID: "ollama-openai-compatible",
    apiNpm: "@ai-sdk/openai-compatible",
    apiURL: "http://127.0.0.1:11434/v1",
  }
  let releaseForeground!: () => void
  const foreground = registry.run({ ...request, priority: "foreground" }, async () => {
    await new Promise<void>((resolve) => {
      releaseForeground = resolve
    })
  })
  await Promise.resolve()

  let backgroundRan = false
  try {
    await registry.run({ ...request, priority: "background", operationID: operationID("local_busy") }, async () => {
      backgroundRan = true
    })
    throw new Error("expected background local provider work to defer")
  } catch (error) {
    expect(isLcmProviderCapacityDeferredError(error)).toBe(true)
    if (isLcmProviderCapacityDeferredError(error)) {
      expect(error.safeError.code).toBe("provider_capacity_deferred")
      expect(error.safeError.templateKey).toBe("lcm.provider_capacity.deferred")
      expect(error.safeError.retryable).toBe(true)
      expect(error.safeError.diagnosticCode).toBe("lcm_provider_capacity_background_deferred")
      expect(error.safeError.safeParams).toMatchObject({
        providerEndpointKeyHash: lcmProviderCapacityKeyHash("local_ollama|http://127.0.0.1:11434"),
        capacityClass: "local_ollama",
        retryable: true,
        action: "retry",
      })
    }
  } finally {
    releaseForeground()
    await foreground
  }
  expect(backgroundRan).toBe(false)
})

test("lcm:scheduler removes aborted foreground waiters from local provider queues", async () => {
  const registry = createLcmProviderCapacityRegistry()
  const request = {
    providerID: "ollama",
    modelID: "qwen3",
    apiID: "ollama-openai-compatible",
    apiNpm: "@ai-sdk/openai-compatible",
    apiURL: "http://127.0.0.1:11434/v1",
  }
  let releaseForeground!: () => void
  const foreground = registry.run({ ...request, priority: "foreground" }, async () => {
    await new Promise<void>((resolve) => {
      releaseForeground = resolve
    })
  })
  await Promise.resolve()

  const controller = new AbortController()
  const queued = registry
    .run({ ...request, priority: "foreground", abortSignal: controller.signal }, async () => {
      throw new Error("aborted queued work should not start")
    })
    .catch((error) => error)
  await Promise.resolve()
  expect(registry.snapshot({ ...request, priority: "foreground" })).toMatchObject({
    active: 1,
    foregroundQueued: 1,
  })

  controller.abort(new Error("queued local provider request canceled"))
  const queuedError = await queued
  expect(queuedError).toBeInstanceOf(Error)
  expect(registry.snapshot({ ...request, priority: "foreground" })).toMatchObject({
    active: 1,
    foregroundQueued: 0,
  })

  releaseForeground()
  await foreground
  await expect(registry.run({ ...request, priority: "foreground" }, async () => "next")).resolves.toBe("next")
})

test("lcm:scheduler serializes foreground local provider work behind an active background job", async () => {
  const registry = createLcmProviderCapacityRegistry()
  const request = {
    providerID: "ollama",
    modelID: "qwen3",
    apiID: "ollama-openai-compatible",
    apiNpm: "@ai-sdk/openai-compatible",
    apiURL: "http://127.0.0.1:11434/v1",
  }
  const order: string[] = []
  let releaseBackground!: () => void
  const background = registry.run({ ...request, priority: "background" }, async () => {
    order.push("background-start")
    await new Promise<void>((resolve) => {
      releaseBackground = resolve
    })
    order.push("background-end")
  })
  await Promise.resolve()
  const foreground = registry.run({ ...request, priority: "foreground" }, async () => {
    order.push("foreground")
  })
  await Promise.resolve()

  expect(order).toEqual(["background-start"])
  releaseBackground()
  await Promise.all([background, foreground])
  expect(order).toEqual(["background-start", "background-end", "foreground"])
})

test("lcm:scheduler treats one local Ollama endpoint as shared capacity across models", async () => {
  const registry = createLcmProviderCapacityRegistry()
  const request = {
    providerID: "ollama",
    apiID: "ollama-openai-compatible",
    apiNpm: "@ai-sdk/openai-compatible",
    apiURL: "http://127.0.0.1:11434/v1",
  }
  let releaseForeground!: () => void
  const foreground = registry.run({ ...request, modelID: "main-dialog", priority: "foreground" }, async () => {
    await new Promise<void>((resolve) => {
      releaseForeground = resolve
    })
  })
  await Promise.resolve()

  try {
    await registry.run({ ...request, modelID: "background-maintenance", priority: "background" }, async () => {
      throw new Error("background should not start while endpoint is busy")
    })
    throw new Error("expected shared local endpoint capacity to defer background work")
  } catch (error) {
    expect(isLcmProviderCapacityDeferredError(error)).toBe(true)
    if (isLcmProviderCapacityDeferredError(error)) {
      expect(error.safeError.diagnosticCode).toBe("lcm_provider_capacity_background_deferred")
      expect(error.safeError.safeParams).toMatchObject({
        providerEndpointKeyHash: lcmProviderCapacityKeyHash("local_ollama|http://127.0.0.1:11434"),
        capacityClass: "local_ollama",
      })
    }
  } finally {
    releaseForeground()
    await foreground
  }
})

test("lcm:scheduler treats provider aliases for one local endpoint as shared capacity", async () => {
  const registry = createLcmProviderCapacityRegistry()
  let releaseForeground!: () => void
  const foreground = registry.run(
    {
      providerID: "ollama",
      modelID: "main-dialog",
      apiID: "ollama-openai-compatible",
      apiNpm: "@ai-sdk/openai-compatible",
      apiURL: "http://127.0.0.1:11434/v1",
      priority: "foreground",
    },
    async () => {
      await new Promise<void>((resolve) => {
        releaseForeground = resolve
      })
    },
  )
  await Promise.resolve()

  try {
    await registry.run(
      {
        providerID: "local-ollama-alias",
        modelID: "background-maintenance",
        apiID: "ollama-openai-compatible",
        apiNpm: "@ai-sdk/openai-compatible",
        apiURL: "http://127.0.0.1:11434/v1",
        priority: "background",
      },
      async () => {
        throw new Error("background should not start while endpoint alias is busy")
      },
    )
    throw new Error("expected shared endpoint alias capacity to defer background work")
  } catch (error) {
    expect(isLcmProviderCapacityDeferredError(error)).toBe(true)
    if (isLcmProviderCapacityDeferredError(error)) {
      expect(error.safeError.diagnosticCode).toBe("lcm_provider_capacity_background_deferred")
      expect(error.safeError.safeParams).toMatchObject({
        providerEndpointKeyHash: lcmProviderCapacityKeyHash("local_ollama|http://127.0.0.1:11434"),
        capacityClass: "local_ollama",
      })
    }
  } finally {
    releaseForeground()
    await foreground
  }
})

test("lcm:scheduler does not report post-invocation local provider failures as capacity deferrals", async () => {
  const registry = createLcmProviderCapacityRegistry()
  const providerFailure = new Error("raw local provider failure text")
  try {
    await registry.run(
      {
        providerID: "ollama",
        modelID: "qwen3",
        apiID: "ollama-openai-compatible",
        apiNpm: "@ai-sdk/openai-compatible",
        apiURL: "http://127.0.0.1:11434/v1",
        priority: "background",
        operationID: operationID("local_failure"),
      },
      async () => {
        throw providerFailure
      },
    )
    throw new Error("expected background local provider failure to propagate")
  } catch (error) {
    expect(error).toBe(providerFailure)
    expect(isLcmProviderCapacityDeferredError(error)).toBe(false)
  }
  await expect(
    registry.run(
      {
        providerID: "ollama",
        modelID: "qwen3",
        apiID: "ollama-openai-compatible",
        apiNpm: "@ai-sdk/openai-compatible",
        apiURL: "http://127.0.0.1:11434/v1",
        priority: "background",
      },
      async () => "next background call",
    ),
  ).resolves.toBe("next background call")
})

test("lcm:scheduler foreground token-budget work runs before queued background maintenance DB work", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker()
  expect(
    (
      await worker.initialize({
        dataDir: path.join(tmp.path, "lcm"),
        runtimeMode: "source",
        schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
        smokeMode: true,
      })
    ).status,
  ).toBe("ready")

  const order: string[] = []
  let releaseFirstBackground: (() => void) | undefined
  const firstBackground = worker.execute(
    request({
      lane: "background",
      purpose: "maintenance",
      run: async () => {
        order.push("background-1-start")
        await new Promise<void>((resolve) => {
          releaseFirstBackground = resolve
        })
        order.push("background-1-end")
      },
    }),
  )
  const secondBackground = worker.execute(
    request({
      lane: "background",
      purpose: "maintenance",
      run: async () => {
        order.push("background-2")
      },
    }),
  )
  const foreground = worker.executeForeground({
    operationID: operationID("foreground"),
    purpose: "token_budget",
    run: async (db) => {
      order.push("foreground")
      await (db as PGlite).query("SELECT 1")
    },
  })

  try {
    const release = await waitForValue(() => releaseFirstBackground, "first background DB request")
    release()
    await Promise.all([firstBackground, secondBackground, foreground])
    expect(order).toEqual(["background-1-start", "background-1-end", "foreground", "background-2"])
  } finally {
    await worker.close()
  }
})

test("lcm:scheduler gives queued background DB work a turn after a foreground burst", async () => {
  await using tmp = await tmpdir()
  const worker = createLcmDbWorker()
  expect(
    (
      await worker.initialize({
        dataDir: path.join(tmp.path, "lcm"),
        runtimeMode: "source",
        schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
        smokeMode: true,
      })
    ).status,
  ).toBe("ready")

  const order: string[] = []
  let releaseFirstBackground: (() => void) | undefined
  const firstBackground = worker.execute(
    request({
      lane: "background",
      purpose: "maintenance",
      run: async () => {
        order.push("background-1-start")
        await new Promise<void>((resolve) => {
          releaseFirstBackground = resolve
        })
        order.push("background-1-end")
      },
    }),
  )
  const secondBackground = worker.execute(
    request({
      lane: "background",
      purpose: "maintenance",
      run: async () => {
        order.push("background-2")
      },
    }),
  )
  const foreground = Array.from({ length: 9 }, (_, index) =>
    worker.executeForeground({
      operationID: operationID(`foreground_burst_${index}`),
      purpose: "token_budget",
      run: async (db) => {
        order.push(`foreground-${index}`)
        await (db as PGlite).query("SELECT 1")
      },
    }),
  )

  try {
    const release = await waitForValue(() => releaseFirstBackground, "first background DB request")
    release()
    await Promise.all([firstBackground, secondBackground, ...foreground])
    expect(order).toEqual([
      "background-1-start",
      "background-1-end",
      "foreground-0",
      "foreground-1",
      "foreground-2",
      "foreground-3",
      "foreground-4",
      "foreground-5",
      "foreground-6",
      "foreground-7",
      "background-2",
      "foreground-8",
    ])
  } finally {
    await worker.close()
  }
})
