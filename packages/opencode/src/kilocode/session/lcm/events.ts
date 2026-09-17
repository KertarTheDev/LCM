import { EventV2 } from "@opencode-ai/core/event"
import { SessionID } from "@/session/schema"
import * as Contract from "./contracts"

export const Event = {
  Status: EventV2.define({
    type: "session.lcm.status",
    schema: {
      sessionID: SessionID,
      status: Contract.Status,
    },
  }),
  Activity: EventV2.define({
    type: "session.lcm.activity",
    schema: {
      sessionID: SessionID,
      activity: Contract.Activity,
    },
  }),
}
