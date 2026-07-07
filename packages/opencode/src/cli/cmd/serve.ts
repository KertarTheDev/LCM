import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceRuntime } from "../../project/instance-runtime" // kilocode_change

const VSCODE_MANAGED_PARENT_POLL_MS = 2_000
const VSCODE_MANAGED_SHUTDOWN_TIMEOUT_MS = 8_000

function parsePositiveInt(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function pidIsLive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (
      typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EPERM"
    )
  }
}

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server",
  // Server loads instances per-request via x-kilo-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false, // kilocode_change
  handler: Effect.fn("Cli.serve")(function* (args) {
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))

    // kilocode_change start
    const urls = server.urls

    console.log(`kilo server listening on ${urls.bind}`)
    if (urls.local !== urls.bind) console.log(`  Local:   ${urls.local}`)
    if (urls.network) console.log(`  Network: ${urls.network}`)
    // kilocode_change end

    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    let shutdownPromise: Promise<void> | undefined
    const vscodeManagedParentPid =
      process.env.KILO_VSCODE_MANAGED_SERVER === "1"
        ? parsePositiveInt(process.env.KILO_VSCODE_EXTENSION_HOST_PID)
        : undefined
    let parentWatch: ReturnType<typeof setInterval> | undefined

    function handleShutdownSignal() {
      void shutdown()
    }

    function shutdown() {
      shutdownPromise ??= (async () => {
        const hardExit =
          vscodeManagedParentPid === undefined
            ? undefined
            : setTimeout(() => {
                console.error("kilo managed server shutdown timed out; exiting")
                process.exit(0)
              }, VSCODE_MANAGED_SHUTDOWN_TIMEOUT_MS)
        try {
          await InstanceRuntime.disposeAllInstances()
          await server.stop(true)
        } finally {
          if (hardExit) clearTimeout(hardExit)
          if (parentWatch) clearInterval(parentWatch)
          process.off("SIGTERM", handleShutdownSignal)
          process.off("SIGINT", handleShutdownSignal)
          process.off("SIGHUP", handleShutdownSignal)
          abort.abort()
        }
      })()
      return shutdownPromise
    }
    process.on("SIGTERM", handleShutdownSignal)
    process.on("SIGINT", handleShutdownSignal)
    process.on("SIGHUP", handleShutdownSignal)
    if (vscodeManagedParentPid !== undefined) {
      parentWatch = setInterval(() => {
        if (process.ppid !== vscodeManagedParentPid || !pidIsLive(vscodeManagedParentPid)) void shutdown()
      }, VSCODE_MANAGED_PARENT_POLL_MS)
      parentWatch.unref?.()
    }
    yield* Effect.promise(() => new Promise((resolve) => abort.signal.addEventListener("abort", resolve)))
    // kilocode_change end
  }),
})
