---
title: "Conversation Memory"
description: "Keep long coding sessions useful with incremental, recoverable context maintenance"
---

# Conversation Memory

Conversation Memory (LCM) lets a session continue when its raw conversation becomes too large for the selected model.
It keeps recent/current work exact, incrementally summarizes consumed older history, and retains stable source handles
so omitted detail can be recovered instead of guessed.

LCM is currently an experimental feature that defaults to enabled. Turn it off in **Settings → Experimental** or set
`experimental.conversation_memory` to `false` to restore Kilo's legacy automatic and manual compaction behavior.

## What counts toward pressure

LCM separates active context into:

- summary roots;
- eligible consumed raw history;
- protected current and recent raw history; and
- fixed upstream input such as system prompts and tool definitions.

Only the two raw-history lanes drive the soft-maintenance percentage. Summary roots and fixed input do not repeatedly
trigger soft work. The complete outgoing request is still checked against the model's hard usable-input limit.

The default soft threshold is 60%. LCM can start one maintenance quantum while a long agent turn is still running, so
a sequence of provider and tool steps does not prevent maintenance indefinitely. Providers that cannot accept
concurrent work are automatically treated as blocking for later steps.

## Exact recent history

Unconsumed current work is always protected. In addition, LCM keeps a recent exact tail equal to 15% of usable input,
clamped between 2,000 and 20,000 tokens. Set `compaction.preserve_recent_tokens` to use an explicit tail size.

A finalized source becomes eligible only after a later successful provider response proves that the model consumed
the request containing it. Cancelled, failed, interrupted, and overflowed requests do not make sources eligible.

## Hard maintenance

When the complete outgoing request reaches usable input, LCM runs blocking hard maintenance. It summarizes eligible
raw history, then promotes complete summary levels until LCM-owned context returns to the configured soft target when
possible.

If fixed/current input itself cannot fit, Kilo reports `lcm_hard_limit_unresolved` without sending the oversized
request. One stricter LCM retry is attempted after a provider reports overflow. Legacy transcript compaction is not
used as the normal fallback.

## Manual compact

Existing compact controls remain available:

- type `/compact` (or `/summarize` in the TUI);
- use the TUI compact keybinding;
- click the compact icon in the VS Code task header; or
- invoke the existing remote/API/SDK session summarize operation.

These controls request one forced full LCM maintenance cycle. They do not add a synthetic summary message to the chat
and do not interrupt the transcript with a compaction control turn. If there is nothing eligible to reduce, the
operation succeeds as an observable no-op. When LCM is disabled, the same controls use legacy compaction and its
summary transcript turn.

## Configuration

```jsonc
{
  "experimental": {
    "conversation_memory": true
  },
  "conversation_memory": {
    "soft_threshold_percent": 60,
    "recovery": {
      "max_queries_per_turn": 2,
      "max_research_steps": 1,
      "max_tool_calls": 2,
      "max_semantic_inferences": 1,
      "max_repair_attempts": 2,
      "research_timeout_seconds": 540,
      "finalizer_timeout_seconds": 600,
      "cleanup_timeout_seconds": 60
    }
  },
  "compaction": {
    "preserve_recent_tokens": 8000,
    "prune": true
  },
  "agent": {
    "compaction": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

|Option|Type|Default|Description|
|---|---|---|---|
|`experimental.conversation_memory`|boolean|`true`|Enable experimental Conversation Memory; set `false` to restore legacy compaction|
|`conversation_memory.soft_threshold_percent`|number or null|`60`|Start soft maintenance when raw conversation lanes reach this percentage of usable input; also the hard-reset target|
|`conversation_memory.recovery.max_queries_per_turn`|non-negative integer|`2`|Maximum isolated recovery children started during one parent user turn; `0` hides `lcm_query`|
|`conversation_memory.recovery.max_research_steps`|positive integer|`1`|Maximum provider steps in one hidden evidence-acquisition session|
|`conversation_memory.recovery.max_tool_calls`|non-negative integer|`2`|Maximum child-only recovery primitive calls per hidden question|
|`conversation_memory.recovery.max_semantic_inferences`|non-negative integer|`1`|Maximum nested excerpt-only semantic calls per hidden question|
|`conversation_memory.recovery.max_repair_attempts`|non-negative integer|`2`|Maximum fresh-session finalizer attempts after same-session synthesis fails|
|`conversation_memory.recovery.research_timeout_seconds`|positive integer|`540`|Wall-time budget for hidden evidence acquisition|
|`conversation_memory.recovery.finalizer_timeout_seconds`|positive integer|`600`|Shared wall-time budget for same-session synthesis and repair|
|`conversation_memory.recovery.cleanup_timeout_seconds`|positive integer|`60`|Reserved cancellation and accounting time|
|`compaction.preserve_recent_tokens`|number|15% usable, clamped 2k–20k|Explicit exact recent-tail token budget|
|`compaction.prune`|boolean|`true`|Allow independent stale tool-output pruning for large payloads|
|`agent.compaction.model`|model ID|current model|Optional model used for summary work|

While LCM is enabled, `compaction.auto` and `compaction.threshold_percent` do not configure its maintenance. When LCM
is disabled, they control legacy compaction normally. The `conversation_memory.recovery` values are advanced
operational budgets; increasing them can increase latency and provider usage. They never expose hidden recovery tools,
transcripts, or raw evidence to the main session, and the returned answer/citation bounds remain fixed.

## Inspecting and recovering detail

The task context header and **Settings → Context** show raw-lane pressure, eligible/protected composition, summaries,
health, and maintenance phase. The TUI/CLI `/lcm status` command shows the same information; `/lcm timeline` shows
interventions and `/lcm export` creates a diagnostic context archive.

During work, the model can use:

- `lcm_grep` to search exact retained sources and summaries;
- `lcm_describe` to inspect a source or summary;
- `lcm_expand_query` to answer a focused question from bounded retrieved evidence;
- `lcm_expand` to list a summary's immediate children; and
- `lcm_read` to read exact digest-verified source content.

These tools and the LCM inspection UI are hidden while the feature is disabled. Existing derived data is preserved
and reused or rebuilt after re-enabling.

The Kilo SQLite conversation remains the source of truth. LCM's separate derived cache can be rebuilt without deleting
or rewriting the chat.

## Related features

- [AGENTS.md](/docs/customize/agents-md) — persistent project guidance
- [Codebase Indexing](/docs/customize/context/codebase-indexing) — code search and retrieval
