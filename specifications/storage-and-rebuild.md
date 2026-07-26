# Storage and rebuild

Status: normative current-code storage contract.

The Kilo SQLite transcript is the sole source of raw conversation truth. Conversation Memory uses a separate
rebuildable SQLite sidecar for derived state so the feature does not change Kilo's core schema.

`sidecarPath` places the file adjacent to the selected Kilo database. A `.db` suffix becomes `.lcm.db`; a suffixless
path gains `.lcm`; tests may use an independent `:memory:` database. A newly created file is mode `0600`.

The runtime uses Bun SQLite in Bun builds and Node's SQLite adapter in Node builds through the `#lcm-db` package import.
Connections enable foreign keys, WAL, synchronous `NORMAL`, and a 250 ms busy timeout.

Schema version 2 contains:

- `lcm_meta` and `lcm_session` for version, lineage, state, health, and issue state;
- `lcm_source` for stable source references, digests, sizes, and bounded excerpts;
- `lcm_summary`, `lcm_summary_edge`, and `lcm_summary_attempt` for immutable tree nodes and model-work provenance;
- `lcm_frontier_revision` and `lcm_frontier_item` for atomic active cuts;
- `lcm_activity` for ordered user-visible events;
- `lcm_context_frame` and `lcm_blob` for normalized pre/post request evidence;
- `lcm_lease` for bounded work ownership.

`lcm_source` never stores the full raw body. Reads resolve the persisted message/part again and verify its digest.
Summary text and normalized diagnostic frames are derived durable content.

Source IDs are content-derived from session, message, part, source kind, and final digest. Summary structural keys use
ordered child IDs and digests plus the policy version; summary IDs additionally include generated text. Rebuilding the
same transcript therefore reproduces source identities and tree grouping even when a later model summary differs.

Source replacement, summary plus edges, and frontier revisions commit transactionally. A revision activates only for
its exact lineage and only after all referenced objects exist. Historical summaries, revisions, and frames may remain
for export, but current projection and tools cannot authorize them through a different lineage.

An absent file is created lazily. A corrupt or incompatible file is closed and renamed with a bounded
`.incompatible-<timestamp>` suffix; a fresh current-schema file is then opened and source metadata is rebuilt from the
Kilo transcript. The runtime records rebuild activity after recovery. If opening or rebuilding cannot proceed, status
is degraded and the prompt uses normal Kilo behavior.

No user action is required to repair derived storage. Released schema changes require an explicit migration or cleanup
decision in release notes; unreleased development caches may be discarded.
