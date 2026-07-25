// kilocode_change - new file
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Option, Schema } from "effect"
import { LCM_RETRIEVAL_TOOL_DESCRIPTIONS } from "../session/lcm/retrieval"
import type { LcmGrepInput, LcmGrepResult, LcmToolErrorResult } from "../session/lcm/types"
import { lcmToolWrapperError } from "./lcm-tool-error"
import * as Tool from "./tool"

const parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "Search text. In literal mode this is one exact contiguous substring, not fuzzy matching or an AND of words.",
  }),
  mode: Schema.optional(Schema.Literals(["regex", "literal"])).annotate({
    description:
      "Search mode. Defaults to exact contiguous literal matching; choose regex only when pattern contains regex syntax.",
  }),
  caseSensitive: Schema.optional(Schema.Boolean).annotate({
    description: "Whether matching is case-sensitive. Defaults to false.",
  }),
  summaryID: Schema.optional(Schema.String).annotate({
    description: "Optional authorized summary handle to scope search.",
  }),
  limit: Schema.optional(PositiveInt).annotate({
    description: "Maximum results on this page. If page.hasMore is true, continue with page.nextCursor.",
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "Opaque page.nextCursor from the same lcm_grep query and limit.",
  }),
})

export const LcmGrepTool = Tool.define(
  "lcm_grep",
  Effect.succeed({
    description: LCM_RETRIEVAL_TOOL_DESCRIPTIONS.lcm_grep,
    parameters,
    execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const lcmRuntimeModule = yield* Effect.promise(() => import("../session/lcm/runtime"))
        const lcmRuntime = Option.getOrUndefined(yield* Effect.serviceOption(lcmRuntimeModule.LcmRuntime.Service))
        if (!lcmRuntime) throw new Error("LCM runtime is unavailable")
        const result = yield* lcmRuntime.grep({
          ...(params as LcmGrepInput),
          sessionID: ctx.sessionID,
          abortSignal: ctx.abort,
        })
        return renderResult(result)
      }).pipe(
        Effect.catchCause(() => Effect.succeed(renderResult(lcmToolWrapperError("lcm_grep_tool_wrapper_failed")))),
      ),
  }),
)

function renderResult(result: LcmGrepResult | LcmToolErrorResult) {
  return {
    title: "LCM Grep",
    metadata: {
      ok: result.ok,
      ...(result.ok
        ? {
            matches: result.results.length,
            hasMore: result.page.hasMore,
            effectiveMode: result.effectiveMode,
            scopeWarning: result.scopeWarning,
          }
        : { code: result.error.code, diagnosticCode: result.error.diagnosticCode }),
      truncated: result.ok ? result.page.hasMore : false,
    },
    output: JSON.stringify(result, null, 2),
  }
}
