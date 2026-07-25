// kilocode_change - new file
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { SessionID } from "../../src/session/schema"

test("ordinary parent cancellation preserves trusted map-child subtrees", async () => {
  const root = SessionID.make("ses_map_cancel_root")
  const task = SessionID.make("ses_map_cancel_task")
  const taskNested = SessionID.make("ses_map_cancel_task_nested")
  const map = SessionID.make("ses_map_cancel_worker")
  const mapNested = SessionID.make("ses_map_cancel_worker_nested")
  const children = new Map<SessionID, SessionID[]>([
    [root, [task, map]],
    [task, [taskNested]],
    [map, [mapNested]],
  ])
  const canceled: SessionID[] = []
  const inspected: SessionID[] = []

  await Effect.runPromise(
    KiloSessionPrompt.cancelTree({
      sessionID: root,
      sessions: {
        children: (sessionID) => Effect.succeed((children.get(sessionID) ?? []).map((id) => ({ id })) as never),
      },
      cancel: (sessionID) =>
        Effect.sync(() => {
          canceled.push(sessionID)
        }),
      skipDescendant: (sessionID) =>
        Effect.sync(() => {
          inspected.push(sessionID)
          return sessionID === map
        }),
    }),
  )

  expect(new Set(canceled)).toEqual(new Set([root, task, taskNested]))
  expect(inspected).toContain(task)
  expect(inspected).toContain(taskNested)
  expect(inspected).toContain(map)
  expect(inspected).not.toContain(mapNested)
})

test("explicit cancellation of a map child still cancels that child and its descendants", async () => {
  const map = SessionID.make("ses_map_cancel_explicit")
  const nested = SessionID.make("ses_map_cancel_explicit_nested")
  const canceled: SessionID[] = []

  await Effect.runPromise(
    KiloSessionPrompt.cancelTree({
      sessionID: map,
      sessions: {
        children: (sessionID) => Effect.succeed(sessionID === map ? ([{ id: nested }] as never) : []),
      },
      cancel: (sessionID) =>
        Effect.sync(() => {
          canceled.push(sessionID)
        }),
      skipDescendant: () => Effect.succeed(false),
    }),
  )

  expect(new Set(canceled)).toEqual(new Set([map, nested]))
})
