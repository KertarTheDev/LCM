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

Port this reviewed LCM state directly onto Kilo Code v7.5.9, preserving the newer upstream session lifecycle,
provider-response safeguards, editor-context caching, and compaction-model selection. Raise the default soft threshold
from 40% to 60% so ordinary sessions retain more exact history before background maintenance begins; explicit user
thresholds are unchanged.
