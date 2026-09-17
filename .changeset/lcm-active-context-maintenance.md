---
"kilo-code": patch
---

Correct Conversation Memory to use incremental raw-lane pressure, stable summary frontiers, blocking hard maintenance,
and forced LCM manual compact cycles. Add a default-on `experimental.conversation_memory` switch that restores
upstream automatic, overflow, and manual compaction behavior when explicitly disabled. Replace direct raw-recovery
tools in the parent model context with one bounded `lcm_query` that delegates to an isolated read-only recovery child
and returns only a concise answer plus optional host-verified exact citations. Prefetch broad hidden recovery evidence
from the active frontier before overlapping lexical descendants, then reserve separate bounded steps for navigation
and exact verification so detail lookup does not spend its first provider round trip merely requesting evidence or stop
immediately after locating the relevant scope.

Port the complete LCM implementation directly onto Kilo Code v7.7.3, reusing native session lifecycle,
provider safeguards, transient-part classification, typed tool errors, recall indexes and model selection.
Preserve the 60% soft threshold, recent-tail protection and default recovery budgets. Improve continuation
summaries, copy-ready recovery citations, complete-request hard fitting, and durable frontier ordering.
