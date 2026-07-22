// kilocode_change - new file
import fs from "node:fs/promises"
import { EOL } from "node:os"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
import { LcmRuntime } from "@/session/lcm/runtime"
import { deriveLcmFamilyID } from "@/session/lcm/family"
import { resolveLcmFamilyRoot } from "@/session/lcm/db-layout"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

type Phase = "seed" | "continue"

function userMessage(sessionID: SessionID, index: number): MessageV2.User {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() + index },
    agent: "build",
    model: { providerID: "lcm-smoke", modelID: "lcm-smoke" },
  }
}

function assistantMessage(sessionID: SessionID, parentID: MessageID): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    sessionID,
    parentID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: process.cwd(), root: process.cwd() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "lcm-smoke",
    providerID: "lcm-smoke",
    time: { created: Date.now() + 1, completed: Date.now() + 2 },
    finish: "stop",
  }
}

function textPart(sessionID: SessionID, messageID: MessageID): MessageV2.TextPart {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "text",
    text: "packaged continuation smoke",
  }
}

async function seed() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "LCM packaged continuation smoke" })
      const user = userMessage(session.id, 0)
      const assistant = assistantMessage(session.id, user.id)
      yield* sessions.updateMessage(user)
      yield* sessions.updatePart(textPart(session.id, user.id))
      yield* sessions.updateMessage(assistant)
      yield* sessions.updatePart(textPart(session.id, assistant.id))
      const familyRoot = resolveLcmFamilyRoot({
        kiloDataDir: Global.Path.data,
        familyID: deriveLcmFamilyID(session.id),
      })
      const familyCreated = yield* Effect.promise(() =>
        fs
          .stat(familyRoot)
          .then(() => true)
          .catch(() => false),
      )
      return {
        status: familyCreated ? ("failed" as const) : ("passed" as const),
        phase: "seed" as const,
        sessionID: session.id,
        coreMessages: 2,
        coreParts: 2,
        familyCreated,
      }
    }),
  )
}

async function continueSession(sessionID: SessionID) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      yield* sessions.get(sessionID)
      const user = userMessage(sessionID, 0)
      yield* sessions.updateMessage(user)
      yield* sessions.updatePart(textPart(sessionID, user.id))

      const lcm = yield* LcmRuntime.Service
      const conversationID = yield* lcm.getOrCreateConversation({ sessionID })
      yield* lcm.syncFinalizedMessages({ sessionID, upToMessageID: user.id })
      const scope = yield* lcm.getConversationScope({ sessionID })
      const core = yield* sessions.messages({ sessionID })
      const coreParts = core.reduce((count, message) => count + message.parts.length, 0)
      const passed =
        scope.lifecycleState === "passive_synced" &&
        scope.sourceCoverageCounts.messages === core.length &&
        scope.sourceCoverageCounts.parts === coreParts
      return {
        status: passed ? ("passed" as const) : ("failed" as const),
        phase: "continue" as const,
        sessionID,
        conversationID,
        lifecycleState: scope.lifecycleState,
        coreMessages: core.length,
        coreParts,
        lcmMessages: scope.sourceCoverageCounts.messages,
        lcmParts: scope.sourceCoverageCounts.parts,
      }
    }),
  )
}

export const LcmSessionContinuationSmokeCommand = cmd({
  command: "lcm-session-continuation-smoke <phase>",
  describe: "seed or continue a content-safe packaged-runtime LCM session smoke",
  builder: (yargs) =>
    yargs
      .positional("phase", { choices: ["seed", "continue"] as const, demandOption: true })
      .option("session-id", { type: "string", describe: "session id emitted by a preceding seed process" })
      .option("json", { type: "boolean", default: false, describe: "print JSON report" }),
  async handler(args) {
    const phase = args.phase as Phase
    if (phase === "continue" && !args.sessionId) throw new Error("continue requires --session-id")
    await bootstrap(process.cwd(), async () => {
      const report = phase === "seed" ? await seed() : await continueSession(SessionID.make(args.sessionId!))
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      process.exit(report.status === "passed" ? 0 : 1)
    })
  },
})
