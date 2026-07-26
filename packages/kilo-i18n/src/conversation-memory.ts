/**
 * Conversation Memory copy shared by the extension host and webview.
 *
 * Locales deliberately inherit this complete English bundle until translated;
 * keeping one keyed source preserves fallback behavior and locale completeness.
 */
export const conversationMemory = {
  "conversationMemory.title": "Conversation Memory",
  "conversationMemory.activeSession": "Active session context",
  "conversationMemory.status.unavailable": "Open a local session to see its active context.",
  "conversationMemory.status.unmeasured": "not measured",
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
