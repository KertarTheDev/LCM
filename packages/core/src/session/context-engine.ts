// kilocode_change - pluggable session context ownership for Kilo runtimes
import type { LLMRequest, Model, PreparedRequest } from "@opencode-ai/llm"
import { Context, Effect, Schema } from "effect"
import type { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export namespace SessionContextEngine {
  export type Entry = {
    readonly seq: number
    readonly message: SessionMessage.Message
  }

  export type Input = {
    readonly sessionID: SessionSchema.ID
    readonly entries: readonly Entry[]
    readonly model: Model
    readonly request: LLMRequest
  }

  export type Prepared = {
    readonly request: LLMRequest
    readonly token?: string
  }

  export type Outcome = "success" | "failure" | "interrupted" | "overflow"

  export class Error extends Schema.TaggedErrorClass<Error>()("SessionContextEngine.Error", {
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }) {}

  export interface Interface {
    /** Return undefined after committing state that requires the runner to rebuild from durable history. */
    readonly prepare: (input: Input) => Effect.Effect<Prepared | undefined, Error>
    /** Validate the exact compiled provider body before the transport starts. */
    readonly validate: (input: {
      readonly sessionID: SessionSchema.ID
      readonly token?: string
      readonly prepared: PreparedRequest
    }) => Effect.Effect<void, Error>
    /** Commit bounded recovery state and request one rebuild after a pre-output context overflow. */
    readonly recover: (input: Input) => Effect.Effect<boolean, Error>
    /** Resolve request evidence without treating interrupted or failed calls as consumed context. */
    readonly settle: (input: {
      readonly sessionID: SessionSchema.ID
      readonly token?: string
      readonly outcome: Outcome
    }) => Effect.Effect<void, Error>
    /** Synchronize finalized output and run any required between-step maintenance barrier. */
    readonly checkpoint: (input: { readonly sessionID: SessionSchema.ID }) => Effect.Effect<void, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextEngine") {}

  export const upstream = (compaction: {
    readonly compactIfNeeded: (input: Input) => Effect.Effect<boolean>
    readonly compactAfterOverflow: (input: Input) => Effect.Effect<boolean>
  }): Interface => ({
    prepare: (input) =>
      compaction
        .compactIfNeeded(input)
        .pipe(Effect.map((changed) => (changed ? undefined : { request: input.request }))),
    validate: () => Effect.void,
    recover: compaction.compactAfterOverflow,
    settle: () => Effect.void,
    checkpoint: () => Effect.void,
  })
}
