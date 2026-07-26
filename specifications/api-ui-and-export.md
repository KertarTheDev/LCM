# API, UI, and export

Status: normative current-code product-surface contract.

The instance API exposes:

- `GET /session/:sessionID/lcm/status`
- `GET /session/:sessionID/lcm/activity`
- `POST /session/:sessionID/lcm/context/export`

Every route uses the normal instance/workspace authorization middleware and first verifies the Kilo session exists.
Status returns mode, health, a durable monotonically increasing sequence, context capacity, raw/summary composition,
whether summarization is running, separate memory-work usage, last intervention, and a safe issue when degraded. The
sequence survives process reopen and advances for every status-visible transition, including background start/finish.

Activity returns newest-first records with maximum page size 100. Its opaque signed cursor binds session and page size.
Activity kinds are `frontier_advanced`, `intervention`, `fallback`, and `rebuild`.

`session.lcm.status` and `session.lcm.activity` use the ordinary EventV2 stream. VS Code accepts events only from the
tracked session directory, ignores foreign-session and non-increasing status updates, deduplicates activity by ID,
sorts it by sequence, and clears both when switching sessions.

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

CLI/TUI export first verifies the session exists, writes a complete mode-`0600` file atomically, and refuses overwrite.
VS Code uses a no-overwrite workspace rename, applies restrictive permissions for local files, and removes its
temporary file after any write, permission, or rename failure. Partial failures leave no apparently complete target.
