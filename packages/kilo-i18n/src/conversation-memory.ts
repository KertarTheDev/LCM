/**
 * Conversation Memory copy shared by the extension host and webview.
 *
 * Locales deliberately inherit this complete English bundle until translated;
 * keeping one keyed source preserves fallback behavior without locale-file churn.
 */
export const conversationMemory = {
  "provider.custom.models.limit.context.label": "Context window",
  "provider.custom.models.limit.context.placeholder": "131072",
  "provider.custom.models.limit.context.description": "Total tokens supported by the model and serving runtime.",
  "provider.custom.models.limit.output.label": "Maximum output",
  "provider.custom.models.limit.output.placeholder": "32768",
  "provider.custom.models.limit.output.description": "Tokens reserved for one response.",
  "provider.custom.models.limit.input.label": "Maximum input (optional)",
  "provider.custom.models.limit.input.placeholder": "Leave empty",
  "provider.custom.models.limit.input.description": "Use only when the provider declares a separate input limit.",
  "provider.custom.error.limit.positiveInteger": "Enter a positive whole number",
  "provider.custom.error.limit.outputBelowContext": "Must be smaller than the context window",
  "provider.custom.error.limit.inputWithinContext": "Must not exceed the context window",
  "provider.custom.error.limit.inputAboveOutput": "Must be larger than the output reserve",
  "conversationMemory.title": "Conversation Memory",
  "conversationMemory.experimental.title": "Conversation Memory",
  "conversationMemory.experimental.description":
    "Experimentally replace legacy conversation compaction with incremental summary-tree context management.",
  "conversationMemory.threshold.title": "Conversation Memory Soft Threshold",
  "conversationMemory.threshold.description":
    "Start reducing eligible raw conversation history at this percentage of usable input. Leave blank for 60%.",
  "conversationMemory.activeSession": "Active session context",
  "conversationMemory.status.unavailable": "Open a local session to see its active context.",
  "conversationMemory.status.unmeasured": "not measured",
  "conversationMemory.status.capacityUnknown":
    "Model capacity is unknown. Configure context and output token limits for this custom model.",
  "conversationMemory.status.loadFailed": "Context telemetry could not be loaded: {{message}}",
  "conversationMemory.stats.composition":
    "{{eligible}} eligible raw · {{protected}} protected raw · {{summaries}} summaries",
  "conversationMemory.stats.state": "{{mode}} · {{phase}} · {{health}}",
  "conversationMemory.status.summary": "{{mode}} · {{pressure}} pressure · {{summaries}} summaries · {{health}}",
  "conversationMemory.action.timeline": "Inspect timeline",
  "conversationMemory.action.export": "Export full context history",
  "conversationMemory.tooltip.summary": "{{summaries}} summaries · {{rawTokens}} raw tokens retained",
  "conversationMemory.tooltip.state": "Conversation Memory: {{mode}} · {{health}}",
  "conversationMemory.timeline.empty": "No Conversation Memory activity yet",
  "conversationMemory.timeline.select": "Select an event",
  "conversationMemory.timeline.show": "Show Conversation Memory timeline",
  "conversationMemory.timeline.raw": "Raw input: {{tokens}} tokens",
  "conversationMemory.timeline.summary": "Summary representation: {{tokens}} tokens",
  "conversationMemory.timeline.summaries": "Summaries: {{ids}}",
  "conversationMemory.timeline.failed": "Conversation Memory timeline failed: {{message}}",
  "conversationMemory.export.warning":
    "This archive preserves model-visible conversation content and may contain sensitive information.",
  "conversationMemory.export.continue": "Choose export location",
  "conversationMemory.export.save": "Export Context",
  "conversationMemory.export.title": "Export Conversation Context",
  "conversationMemory.export.saved": "Conversation context exported to {{path}}",
  "conversationMemory.export.failed": "Conversation Memory export failed: {{message}}",
} as const
