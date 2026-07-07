// kilocode_change - new file
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { MessageID, SessionID } from "../../src/session/schema"
import {
  createLcmFinalizedSyncPendingStore,
  createLcmFinalizedSyncRetryController,
} from "../../src/session/lcm/finalized-sync-retry"
import { createLcmSafeError, type ConversationID, type LcmSyncResult } from "../../src/session/lcm/types"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_finalized_sync_retry")
const messageID = MessageID.make("msg_finalized_sync_retry")
const conversationID = "conv_finalized_sync_retry" as ConversationID

function syncResult(input: Partial<LcmSyncResult> = {}): LcmSyncResult {
  return {
    sessionID,
    conversationID,
    insertedMessages: 0,
    insertedParts: 0,
    skippedUnsealedMessages: 0,
    skippedUnsealedParts: 0,
    idempotent: true,
    lifecycleState: "lcm_active",
    ...input,
  }
}

test("lcm:finalized-sync-retry surfaces post-turn failures and retries before the next turn", async () => {
  const safeError = createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "lcm_test_sync_transient",
  })
  const published: unknown[] = []
  const attempts: string[] = []
  const controller = createLcmFinalizedSyncRetryController({
    syncFinalizedMessages: () => {
      attempts.push("sync")
      return attempts.length === 1 ? Effect.fail(safeError) : Effect.succeed(syncResult())
    },
    publishError: (event) =>
      Effect.sync(() => {
        published.push(event)
      }),
  })

  await Effect.runPromise(
    controller.sync({ sessionID, upToMessageID: messageID, reason: "post_turn", scheduleRetry: false }),
  )
  expect(controller.getPending(sessionID)).toMatchObject({
    sessionID,
    upToMessageID: messageID,
    attempts: 1,
  })
  expect(published).toHaveLength(1)
  expect(published[0]).toMatchObject({
    sessionID,
    error: {
      name: "LcmMemoryError",
      data: {
        code: "db_unavailable",
        diagnosticCode: "lcm_test_sync_transient",
        action: "retry",
      },
    },
  })

  await Effect.runPromise(controller.retryPendingBeforeTurn(sessionID))
  expect(attempts).toHaveLength(2)
  expect(controller.getPending(sessionID)).toBeUndefined()
})

test("lcm:finalized-sync-retry does not repeatedly publish the same pending failure", async () => {
  const safeError = createLcmSafeError({
    code: "recovery_failed",
    templateKey: "lcm.recovery.missing_source",
    safeParams: { action: "repeat_input" },
    retryable: false,
    diagnosticCode: "lcm_test_sync_persistent",
  })
  const published: unknown[] = []
  const controller = createLcmFinalizedSyncRetryController({
    syncFinalizedMessages: () => Effect.fail(safeError),
    publishError: (event) =>
      Effect.sync(() => {
        published.push(event)
      }),
  })

  await Effect.runPromise(
    controller.sync({ sessionID, upToMessageID: messageID, reason: "post_turn", scheduleRetry: false }),
  )
  await Effect.runPromise(controller.retryPendingBeforeTurn(sessionID))

  expect(controller.getPending(sessionID)).toMatchObject({ attempts: 2 })
  expect(published).toHaveLength(1)
})

test("lcm:finalized-sync-retry reloads pending retry state after restart", async () => {
  await using tmp = await tmpdir()
  const store = createLcmFinalizedSyncPendingStore({ rootDir: tmp.path })
  const safeError = createLcmSafeError({
    code: "db_unavailable",
    templateKey: "lcm.db.unavailable",
    safeParams: { retryable: true, action: "retry" },
    retryable: true,
    diagnosticCode: "lcm_test_sync_restart_transient",
  })
  const first = createLcmFinalizedSyncRetryController({
    pendingStore: store,
    syncFinalizedMessages: () => Effect.fail(safeError),
    publishError: () => Effect.void,
  })

  await Effect.runPromise(first.sync({ sessionID, upToMessageID: messageID, scheduleRetry: false }))
  expect(first.getPending(sessionID)).toMatchObject({ attempts: 1 })

  const retryAttempts: string[] = []
  const restarted = createLcmFinalizedSyncRetryController({
    pendingStore: store,
    syncFinalizedMessages: () =>
      Effect.sync(() => {
        retryAttempts.push("retry")
        return syncResult()
      }),
    publishError: () => Effect.void,
  })
  await Effect.runPromise(restarted.retryPendingBeforeTurn(sessionID))
  expect(retryAttempts).toEqual(["retry"])
  expect(restarted.getPending(sessionID)).toBeUndefined()

  const afterSuccessAttempts: string[] = []
  const afterSuccess = createLcmFinalizedSyncRetryController({
    pendingStore: store,
    syncFinalizedMessages: () =>
      Effect.sync(() => {
        afterSuccessAttempts.push("unexpected")
        return syncResult()
      }),
    publishError: () => Effect.void,
  })
  await Effect.runPromise(afterSuccess.retryPendingBeforeTurn(sessionID))
  expect(afterSuccessAttempts).toEqual([])
})
