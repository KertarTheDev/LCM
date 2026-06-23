import { afterEach, describe, expect, it } from "bun:test"
import { clearNetworkWaits, handleNetworkEvent } from "../../src/kilo-provider/network"
import type {
  EventSessionNetworkAsked,
  EventSessionNetworkReplied,
  EventSessionNetworkRestored,
  KiloClient,
} from "@kilocode/sdk/v2/client"

const ownedSessions = new Set(["session_a", "session_b"])

function networkClient(replies: unknown[]): KiloClient {
  return {
    network: {
      reply(input: unknown) {
        replies.push(input)
        return Promise.resolve({ data: true })
      },
    },
  } as unknown as KiloClient
}

function asked(id: string, sessionID = "session_a"): EventSessionNetworkAsked {
  return {
    type: "session.network.asked",
    properties: {
      id,
      sessionID,
      message: "Network connection was lost.",
      restored: false,
      time: { created: 1700000000000 },
    },
  }
}

function restored(requestID: string, sessionID = "session_a"): EventSessionNetworkRestored {
  return {
    type: "session.network.restored",
    properties: { sessionID, requestID },
  }
}

afterEach(() => {
  clearNetworkWaits(ownedSessions)
})

describe("handleNetworkEvent", () => {
  it("auto-replies when a pending network wait is restored", () => {
    const replies: unknown[] = []

    handleNetworkEvent(asked("network_1"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)
    handleNetworkEvent(restored("network_1"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)

    expect(replies).toEqual([{ requestID: "network_1", directory: "/repo/session_a" }])
  })

  it("does not reply after the wait has been resolved", () => {
    const replies: unknown[] = []
    const replied: EventSessionNetworkReplied = {
      type: "session.network.replied",
      properties: { sessionID: "session_a", requestID: "network_2" },
    }

    handleNetworkEvent(asked("network_2"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)
    handleNetworkEvent(replied, networkClient(replies), (sessionID) => `/repo/${sessionID}`)
    handleNetworkEvent(restored("network_2"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)

    expect(replies).toEqual([])
  })

  it("clears waits owned by a disposing provider", () => {
    const replies: unknown[] = []

    handleNetworkEvent(asked("network_3"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)
    clearNetworkWaits(new Set(["session_a"]))
    handleNetworkEvent(restored("network_3"), networkClient(replies), (sessionID) => `/repo/${sessionID}`)

    expect(replies).toEqual([])
  })
})
