# API, UI, and export

Status: normative current-code product-surface contract.

The instance API exposes:

- `GET /session/:sessionID/lcm/status`
- `GET /session/:sessionID/lcm/activity`
- `POST /session/:sessionID/lcm/context/export`

Every route uses the normal instance/workspace authorization middleware and first verifies the Kilo session exists.
Status returns mode, health, monotonically increasing sequence, context capacity, raw/summary composition, background
state, separate memory-work usage, last intervention, and a safe issue when degraded.

Activity returns newest-first records with maximum page size 100. Its opaque signed cursor binds session and page size.
Activity kinds are `summary_created`, `frontier_advanced`, `intervention`, `fallback`, and `rebuild`.

`session.lcm.status` and `session.lcm.activity` use the ordinary EventV2 stream. VS Code ignores foreign-session and
out-of-order status updates, deduplicates activity by ID, sorts by sequence, and clears both when switching sessions.

VS Code shows passive pressure/composition in the existing context area, adds intervention markers to the existing
task timeline, and provides timeline inspection and export from the Context preferences tab. It does not expose
maintenance controls. TUI `/lcm`, `/lcm status`, `/lcm timeline`, and `/lcm export` provide equivalent inspection.
Headless CLI uses `kilo lcm status|timeline|export [sessionID]`.

Export is a ZIP with `context.json`, `context.md`, and `manifest.json`. It includes product/upstream identity, health,
all retained intervention frames plus the latest active frame, referenced revisions, source metadata, summaries and
children, and the complete activity history. Manifest hashes cover the JSON and Markdown files.

Normalized pre/post frames preserve model-visible system, message, and tool-schema content. Executable functions,
credentials, headers, provider metadata/options, provider wire bodies, and raw inline binary bytes are excluded.
Secret-looking text that was actually model-visible is intentionally preserved; the UI warns before export.

CLI/TUI export writes a complete mode-`0600` file atomically and refuses overwrite. VS Code uses a no-overwrite
workspace rename and applies restrictive permissions for local files. Partial failures leave no apparently complete
target.
