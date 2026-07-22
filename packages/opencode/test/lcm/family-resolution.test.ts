// kilocode_change - new file
import { expect, test } from "bun:test"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import path from "node:path"
import * as Instance from "../../src/kilocode/instance"
import * as SessionModule from "../../src/session/session"
import { deriveLcmFamilyID, resolveSessionFamilyTargetEffect } from "../../src/session/lcm/family"
import { tmpdir } from "../fixture/fixture"

function runSession<A, E>(effect: Effect.Effect<A, E, SessionModule.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionModule.defaultLayer)))
}

test("production family resolution reads old session lineage from the authoritative Core database", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.env.KILO_LCM_TEST_DATA_DIR
  process.env.KILO_LCM_TEST_DATA_DIR = path.join(tmp.path, "kilo-data")

  try {
    const sessions = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await runSession(SessionModule.Service.use((session) => session.create({ title: "old root" })))
        const child = await runSession(
          SessionModule.Service.use((session) => session.create({ title: "old child", parentID: root.id })),
        )
        return { root, child }
      },
    })

    const resolved = await Effect.runPromise(
      resolveSessionFamilyTargetEffect({ sessionID: sessions.child.id }).pipe(
        Effect.provide(CoreDatabase.defaultLayer),
      ),
    )
    expect(resolved.rootSession.id).toBe(sessions.root.id)
    expect(resolved.target.rootSessionID).toBe(sessions.root.id)
    expect(resolved.target.familyID).toBe(deriveLcmFamilyID(sessions.root.id))

    const missing = await Effect.runPromise(
      resolveSessionFamilyTargetEffect({ sessionID: "ses_missing_old" }).pipe(
        Effect.provide(CoreDatabase.defaultLayer),
        Effect.flip,
      ),
    )
    expect(missing).toMatchObject({
      code: "not_found",
      diagnosticCode: "lcm_family_session_not_found",
    })
  } finally {
    if (previous === undefined) delete process.env.KILO_LCM_TEST_DATA_DIR
    else process.env.KILO_LCM_TEST_DATA_DIR = previous
  }
})
