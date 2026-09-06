import { Effect } from "effect"
import path from "node:path"
import { CliError, effectCmd, fail } from "@/cli/effect-cmd"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { ConversationMemory } from "@/kilocode/session/lcm/service"
import * as ConversationMemoryFeature from "@/kilocode/session/lcm/feature"
import { Config } from "@/config/config"
import { createContextExport } from "@/kilocode/session/lcm/context-export"
import { writePrivateFileExclusive } from "@/kilocode/session/lcm/atomic-export"

export const LcmCommand = effectCmd({
  command: "lcm <action> [sessionID]",
  describe: "inspect or export Conversation Memory context",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "operation",
        type: "string",
        choices: ["status", "timeline", "export"] as const,
        demandOption: true,
      })
      .positional("sessionID", {
        describe: "session ID; defaults to the latest session",
        type: "string",
      })
      .option("output", {
        alias: "o",
        describe: "output ZIP path for the export action",
        type: "string",
      }),
  handler: Effect.fn("Cli.lcm")(function* (args) {
    const config = yield* Config.Service
    if (!ConversationMemoryFeature.enabled(yield* config.get()))
      return yield* fail(ConversationMemoryFeature.DISABLED_MESSAGE)
    const sessions = yield* Session.Service
    const memory = yield* ConversationMemory.Service
    const sessionID = args.sessionID
      ? SessionID.make(args.sessionID)
      : (yield* sessions.list()).toSorted((a, b) => b.time.updated - a.time.updated)[0]?.id
    if (!sessionID) return yield* fail("No sessions found.")
    yield* sessions
      .get(sessionID)
      .pipe(Effect.mapError(() => new CliError({ message: `Session not found: ${sessionID}` })))
    if (args.action === "status") {
      process.stdout.write(`${JSON.stringify(yield* memory.status(sessionID), null, 2)}\n`)
      return
    }
    if (args.action === "timeline") {
      process.stdout.write(`${JSON.stringify({ items: yield* memory.activity(sessionID, { limit: 100 }) }, null, 2)}\n`)
      return
    }
    const access = yield* memory.access(sessionID)
    if (!access) return yield* fail("Conversation Memory export is temporarily unavailable.")
    const output = yield* Effect.promise(() => createContextExport({ sessionID, store: access.store }))
    const target = path.resolve(args.output ?? output.filename)
    yield* Effect.tryPromise({
      try: () => writePrivateFileExclusive(target, output.bytes),
      catch: (error) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
          ? new CliError({ message: `Refusing to overwrite existing file: ${target}` })
          : new CliError({
              message: error instanceof Error ? error.message : "Failed to write Conversation Memory export.",
            }),
    })
    process.stdout.write(`${target}\n`)
  }),
})
