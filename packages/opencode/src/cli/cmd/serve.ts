import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceRuntime } from "../../project/instance-runtime" // kilocode_change

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
    if (urls.network) {
      console.log(`  Local:   ${urls.local}`)
      console.log(`  Network: ${urls.network}`)
    }
    // kilocode_change end

    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    let shutdownPromise: Promise<void> | undefined

    function handleShutdownSignal() {
      void shutdown()
    }

    function shutdown() {
      shutdownPromise ??= (async () => {
        try {
          await InstanceRuntime.disposeAllInstances()
          await server.stop(true)
        } finally {
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
    yield* Effect.promise(() => new Promise((resolve) => abort.signal.addEventListener("abort", resolve)))
    // kilocode_change end
  }),
})
