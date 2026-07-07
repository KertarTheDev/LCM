// kilocode_change - new file
import { randomBytes } from "node:crypto"
import { createDbUnavailableError } from "./db-errors"
import type {
  ContextItemID,
  ConversationID,
  LcmFileID,
  MapRunID,
  MessageRowID,
  OperationID,
  PartRowID,
  SummaryID,
} from "./types"

export type LcmStableIDPrefix = "conv" | "msg" | "part" | "sum" | "file" | "ctx" | "map" | "op"

type StableIDForPrefix<TPrefix extends LcmStableIDPrefix> = TPrefix extends "conv"
  ? ConversationID
  : TPrefix extends "msg"
    ? MessageRowID
    : TPrefix extends "part"
      ? PartRowID
      : TPrefix extends "sum"
        ? SummaryID
        : TPrefix extends "file"
          ? LcmFileID
          : TPrefix extends "ctx"
            ? ContextItemID
            : TPrefix extends "map"
              ? MapRunID
              : OperationID

export interface StableIDOptions {
  readonly randomBytes?: (size: number) => Uint8Array
}

export interface AllocateStableIDOptions extends StableIDOptions {
  readonly maxAttempts?: number
}

function randomHex128(input?: StableIDOptions) {
  const bytes = input?.randomBytes ? Buffer.from(input.randomBytes(16)) : randomBytes(16)
  return bytes.toString("hex")
}

export function createStableLcmID<TPrefix extends LcmStableIDPrefix>(
  prefix: TPrefix,
  options?: StableIDOptions,
): StableIDForPrefix<TPrefix> {
  return `${prefix}_${randomHex128(options)}` as StableIDForPrefix<TPrefix>
}

export async function allocateStableLcmID<TPrefix extends LcmStableIDPrefix>(
  prefix: TPrefix,
  exists: (id: StableIDForPrefix<TPrefix>) => Promise<boolean>,
  options?: AllocateStableIDOptions,
): Promise<StableIDForPrefix<TPrefix>> {
  const maxAttempts = options?.maxAttempts ?? 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = createStableLcmID(prefix, options)
    if (!(await exists(id))) return id
  }
  throw createDbUnavailableError({ diagnosticCode: "lcm_stable_id_collision_exhausted" })
}

export function createOperationID(): OperationID {
  return createStableLcmID("op")
}

export function createLcmOwnerID() {
  return `owner_${randomHex128()}`
}
