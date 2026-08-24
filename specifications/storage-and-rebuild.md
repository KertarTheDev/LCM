# Storage and rebuild

Status: normative v7.4.23 storage contract.

Kilo SQLite is the sole raw conversation source of truth. Conversation Memory uses a separate rebuildable SQLite
sidecar and never stores full raw source bodies. Exact reads resolve the retained Kilo message/part and verify its
digest.

Schema version 6 contains session lineage and durable `consumed_through`, bounded source metadata/excerpts, immutable
summary nodes/edges/attempts, frontier revisions, activity, normalized context frames/blobs, and leases. Tree policy
`lcm-tree-v3` is part of summary structural identity.

Consumption advances only for the exact lineage and only after a successful terminal provider response. It is clamped
to indexed history. On first cache creation or recovery, retained successful non-summary assistant responses
bootstrap the conservative proven prefix that precedes the newest such response; that response's own parts are not
marked consumed. A strict append preserves the bound; rewrite/revert/import resets it and rebuilds the active frontier.
When recovery replaces a failed or unconsumed suffix, the reset lineage re-applies that same retained-response proof
without consuming the replacement suffix.

Source replacement, summary creation, consumption advancement, and frontier activation are transactional at their
own boundaries. A frontier activates only after every referenced source/summary exists for the exact lineage.
Historical evidence may remain for export but cannot be authorized by current tools or projection.

An absent sidecar is created lazily. A corrupt or incompatible file is closed, renamed with
`.incompatible-<timestamp>`, and replaced with a fresh current-schema file. All pre-v6 caches are deliberately
incompatible and receive this rebuild treatment. There is no derived-cache migration: current source metadata and the
tree are rebuilt from retained Kilo SQLite, while raw chats remain untouched. No PGlite detection or Kilo transcript
cleanup is performed.

Explicitly disabling Conversation Memory closes an open sidecar and prevents all subsequent creation, migration,
rename, write, and deletion work. The file is preserved byte-for-byte while disabled. Re-enabling lazily applies the
ordinary compatibility and rebuild rules.

Sidecars use WAL, foreign keys, synchronous `NORMAL`, a 250 ms busy timeout, and mode `0600` on POSIX. Session deletion
removes only that session's derived state.
