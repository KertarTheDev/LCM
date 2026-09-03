import { describe, expect, test } from "bun:test"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { EventManifest as SchemaEventManifest } from "@opencode-ai/schema/event-manifest"
import { Todo } from "@/session/todo"
import { EventManifest } from "@/event-manifest"
import { Drained, Interrupted } from "@opencode-ai/schema/kilocode/session-drain" // kilocode_change
import { Event as ConversationMemoryEvent } from "@/kilocode/session/lcm/events"

describe("public event manifest", () => {
  test("contains every latest public wire type once", () => {
    // kilocode_change start - the application manifest extends the upstream schema with LCM's two live events
    expect(EventManifest.Definitions.length).toBe(SchemaEventManifest.Definitions.length + 2)
    expect(EventManifest.Latest.size).toBe(SchemaEventManifest.Latest.size + 2)
    expect(EventManifest.Latest.get("session.lcm.status")).toBe(ConversationMemoryEvent.Status)
    expect(EventManifest.Latest.get("session.lcm.activity")).toBe(ConversationMemoryEvent.Activity)
    // kilocode_change end
    expect(EventManifest.Durable).toBe(SchemaEventManifest.Durable)
    expect(EventManifest.Latest.get("session.drained")).toBe(Drained) // kilocode_change
    expect(EventManifest.Latest.get("session.drain.interrupted")).toBe(Interrupted) // kilocode_change
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(Todo.Event.Updated)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(EventManifest.Latest.has("server.connected")).toBe(true)
    expect(EventManifest.Latest.has("global.disposed")).toBe(true)
    expect(EventManifest.Latest.has("global.config.updated")).toBe(true) // kilocode_change
  })

  test("contains only the current step settlement versions", () => {
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
