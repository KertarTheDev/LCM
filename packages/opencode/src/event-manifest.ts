export * as EventManifest from "./event-manifest"

// kilocode_change start - keep LCM's live events in the application manifest without changing the upstream schema
import { Event } from "@opencode-ai/schema/event"
import { Definitions as UpstreamDefinitions, Durable } from "@opencode-ai/schema/event-manifest"
import { Event as ConversationMemoryEvent } from "@/kilocode/session/lcm/events"

export const Definitions = Event.inventory(
  ...UpstreamDefinitions,
  ConversationMemoryEvent.Status,
  ConversationMemoryEvent.Activity,
)
export const Latest = Event.latest(Definitions)

export { Durable }
// kilocode_change end
