# Release support

Status: normative current-code release policy.

The product branch is based directly on upstream Kilo Code `v7.4.16`
(`f80ebff83b32550333da7c50c91c4755e4524d0d`). Product commits must remain understandable as a minimal upstream pull
request; older branch commits are historical reference, not a replay sequence.

Before a prerelease candidate:

1. Run every focused LCM gate and deterministic fixture.
2. Regenerate OpenAPI/SDK output and prove a second generation is clean.
3. Run affected type checks, extension compile, marker/annotation checks, and formatting checks.
4. Reconstruct the narrow prerelease overlay on the verified product SHA, then build the CLI and VSIX from that exact
   candidate SHA.
5. Run `lcm:packaged-smoke` against the extracted artifacts.
6. Exercise runtime rebuild, four-tool recovery, events/routes, export verification, failure fallback, and manual
   compaction.
7. Record artifact SHA-256 values and the exact source SHA.

The inherited prompt-queue cancellation exception documented in
`verification-and-upstream-compatibility.md` requires a pristine-v7.4.16 reproduction in the candidate evidence. It
does not authorize ignoring any other queue failure or changing LCM behavior to compensate for the upstream runner.

External prerelease validation uses the same artifacts on Linux/VSCodium and macOS/VS Code, including a small-context
model. It records intervention count, detail recovery, task completion, latency, storage growth, fallback behavior,
and export usability.

Derived schema, settings, or user-visible changes after a public prerelease require an explicit migration, cleanup, or
release-note decision. Private development caches may be discarded; Kilo transcript data must never be deleted as
part of that cleanup.

The prerelease overlay, workflow dispatch, branch push, release publication, and pull-request submission are separate
authorized operations. They are not part of local product implementation.
