import { describe, expect, it } from "bun:test"
import { LcmPrewarmer } from "../../src/kilo-provider/lcm-prewarm"

type TimerRecord = {
  callback: () => void
  cleared: boolean
  delayMs: number
}

function createFakeTimers() {
  const timers: TimerRecord[] = []
  return {
    timers,
    api: {
      setTimeout(callback: () => void, delayMs: number) {
        const record = { callback, cleared: false, delayMs }
        timers.push(record)
        return record as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout(handle: ReturnType<typeof setTimeout>) {
        const timer = handle as unknown as TimerRecord
        timer.cleared = true
      },
    },
    flush(index: number) {
      const timer = timers[index]
      if (timer && !timer.cleared) timer.callback()
    },
  }
}

function clientWithCapabilities(handler: (input: unknown) => Promise<unknown>) {
  return {
    session: {
      lcm: {
        capabilities: handler,
      },
    },
  } as any
}

function retryableRouteError(retryable: boolean) {
  return {
    ok: false,
    error: {
      code: "db_unavailable",
      templateKey: "lcm.db.unavailable",
      safeParams: {},
      safeMessage: "Memory storage is not ready. Follow the shown recovery action.",
      retryable,
    },
  }
}

function malformedSafeError() {
  return {
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: {},
    safeMessage: "Raw backend text must not be trusted.",
    retryable: true,
  }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("LcmPrewarmer", () => {
  it("coalesces by session, directory, and workspace", () => {
    const calls: unknown[] = []
    const client = clientWithCapabilities((input) => {
      calls.push(input)
      return new Promise(() => undefined)
    })
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })

    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    })
    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    })
    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_b",
      reason: "test",
    })

    expect(calls).toHaveLength(2)
  })

  it("retries retryable route errors with bounded backoff", async () => {
    const fake = createFakeTimers()
    let calls = 0
    const warnings: unknown[] = []
    const client = clientWithCapabilities(async () => {
      calls += 1
      if (calls === 1) return { error: retryableRouteError(true) }
      return { data: { dbReady: true } }
    })
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    })

    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    })
    await settle()

    expect(fake.timers).toHaveLength(1)
    expect(fake.timers[0]?.delayMs).toBe(25)

    fake.flush(0)
    await settle()

    expect(calls).toBe(2)
    expect(warnings).toHaveLength(0)
  })

  it("logs only terminal route readiness failures", async () => {
    const fake = createFakeTimers()
    const warnings: unknown[] = []
    let calls = 0
    const client = clientWithCapabilities(async () => {
      calls += 1
      return { error: retryableRouteError(true) }
    })
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    })

    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    })
    await settle()

    expect(warnings).toHaveLength(0)
    fake.flush(0)
    await settle()

    expect(calls).toBe(2)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject([
      "[Kilo New] KiloProvider: LCM prewarm failed",
      { sessionID: "session_a", reason: "test", retrying: false },
    ])
  })

  it("does not retry non-retryable route errors", async () => {
    const fake = createFakeTimers()
    const client = clientWithCapabilities(async () => ({ error: retryableRouteError(false) }))
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: () => undefined },
    })

    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "test",
    })
    await settle()

    expect(fake.timers).toHaveLength(0)
  })

  it("invalidates ready cache entries for a session", async () => {
    let calls = 0
    const client = clientWithCapabilities(async () => {
      calls += 1
      return { data: { dbReady: true } }
    })
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })
    const input = {
      client,
      connectionState: "connected" as const,
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    }

    prewarmer.prewarm(input)
    await settle()
    prewarmer.prewarm(input)
    expect(calls).toBe(1)

    prewarmer.invalidate({ sessionID: "session_a" })
    prewarmer.prewarm(input)
    await settle()

    expect(calls).toBe(2)
  })

  it("ignores stale completions after invalidation", async () => {
    let resolveFirst: ((result: unknown) => void) | undefined
    let calls = 0
    const client = clientWithCapabilities(() => {
      calls += 1
      if (calls === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ data: { dbReady: true } })
    })
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })
    const input = {
      client,
      connectionState: "connected" as const,
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    }

    prewarmer.prewarm(input)
    prewarmer.invalidate({ sessionID: "session_a" })
    resolveFirst?.({ data: { dbReady: true } })
    await settle()

    prewarmer.prewarm(input)
    await settle()

    expect(calls).toBe(2)
  })

  it("clears scheduled retries on reset", async () => {
    const fake = createFakeTimers()
    let calls = 0
    const client = clientWithCapabilities(async () => {
      calls += 1
      return { error: retryableRouteError(true) }
    })
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: () => undefined },
    })

    prewarmer.prewarm({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "test",
    })
    await settle()
    prewarmer.reset()
    fake.flush(0)
    await settle()

    expect(fake.timers[0]?.cleared).toBe(true)
    expect(calls).toBe(1)
  })

  it("uses an in-flight prewarm for explicit readiness probes", async () => {
    let resolveFirst: ((result: unknown) => void) | undefined
    let calls = 0
    const client = clientWithCapabilities(() => {
      calls += 1
      return new Promise((resolve) => {
        resolveFirst = resolve
      })
    })
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })
    const input = {
      client,
      connectionState: "connected" as const,
      sessionID: "session_a",
      directory: "/repo",
      workspace: "workspace_a",
      reason: "test",
    }

    prewarmer.prewarm(input)
    const readiness = prewarmer.ensureReady(input)
    resolveFirst?.({ data: { dbReady: true } })
    await settle()

    expect(await readiness).toEqual({ ok: true })
    expect(calls).toBe(1)
  })

  it("runs explicit readiness probes immediately when a retry is scheduled", async () => {
    const fake = createFakeTimers()
    let calls = 0
    const client = clientWithCapabilities(async () => {
      calls += 1
      if (calls === 1) return { data: { dbReady: false, safeError: retryableRouteError(true).error } }
      return { data: { dbReady: true } }
    })
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: () => undefined },
    })
    const input = {
      client,
      connectionState: "connected" as const,
      sessionID: "session_a",
      directory: "/repo",
      reason: "test",
    }

    prewarmer.prewarm(input)
    await settle()
    const readiness = await prewarmer.ensureReady(input)

    expect(readiness).toEqual({ ok: true })
    expect(fake.timers[0]?.cleared).toBe(true)
    expect(calls).toBe(2)
  })

  it("keeps prompt prewarm advisory when readiness times out", async () => {
    const fake = createFakeTimers()
    const client = clientWithCapabilities(() => new Promise(() => undefined))
    const warnings: unknown[] = []
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [],
      readinessTimeoutMs: 25,
      timers: fake.api,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    })

    expect(() =>
      prewarmer.prewarm({
        client,
        connectionState: "connected",
        sessionID: "session_a",
        directory: "/repo",
        reason: "promptSend",
      }),
    ).not.toThrow()
    await settle()

    expect(fake.timers[0]?.delayMs).toBe(25)

    fake.flush(0)
    await settle()

    expect(warnings).toMatchObject([
      [
        "[Kilo New] KiloProvider: LCM prewarm failed",
        {
          sessionID: "session_a",
          reason: "promptSend",
          error: "Memory readiness check timed out.",
          retrying: false,
        },
      ],
    ])
  })

  it("returns structured readiness errors for explicit readiness probes", async () => {
    const safeError = retryableRouteError(true).error
    const client = clientWithCapabilities(async () => ({ data: { dbReady: false, safeError } }))
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })

    const result = await prewarmer.ensureReady({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "diagnostic",
    })

    expect(result).toEqual({
      ok: false,
      safeMessage: safeError.safeMessage,
      retryable: true,
      safeError,
    })
  })

  it("rejects malformed readiness safe errors instead of surfacing their text", async () => {
    const client = clientWithCapabilities(async () => ({ data: { dbReady: false, safeError: malformedSafeError() } }))
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })

    const result = await prewarmer.ensureReady({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "diagnostic",
    })

    expect(result).toEqual({
      ok: false,
      safeMessage: "Memory storage is not ready.",
      retryable: false,
    })
  })

  it("rejects malformed route safe errors instead of surfacing their text", async () => {
    const client = clientWithCapabilities(async () => ({ error: { error: malformedSafeError() } }))
    const prewarmer = new LcmPrewarmer({ readinessTimeoutMs: 0, logger: { warn: () => undefined } })

    const result = await prewarmer.ensureReady({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "diagnostic",
    })

    expect(result).toEqual({
      ok: false,
      safeMessage: "Memory is not ready.",
      retryable: false,
    })
  })

  it("preserves structured readiness errors when explicit probes reject", async () => {
    const fake = createFakeTimers()
    const routeError = retryableRouteError(false)
    const client = clientWithCapabilities(async () => {
      throw routeError
    })
    const prewarmer = new LcmPrewarmer({
      retryDelaysMs: [25],
      readinessTimeoutMs: 0,
      timers: fake.api,
      logger: { warn: () => undefined },
    })

    const result = await prewarmer.ensureReady({
      client,
      connectionState: "connected",
      sessionID: "session_a",
      directory: "/repo",
      reason: "diagnostic",
    })

    expect(fake.timers).toHaveLength(0)
    expect(result).toEqual({
      ok: false,
      safeMessage: routeError.error.safeMessage,
      retryable: false,
      safeError: routeError.error,
    })
  })
})
