# LCM Current-Code Issues

Status date: 2026-07-24.

This file records current engineering or evidence gaps for the v7.4.15 integration.

## Architecture Findings Resolved

- The port now begins with target-release context-engine and V1 prompt seams on clean v7.4.15. Older LCM release branches are isolated-module/test sources, not the architectural base.
- Upstream project memory is retained separately from LCM conversation context. `/memory` remains project memory; `/lcm` owns conversation-context settings.
- Upstream recall retains prior-session ownership. Current-session recall is rejected in favor of trusted-lineage LCM retrieval.
- Final persisted SWE-pruned ToolParts are canonical LCM source. A validated truncation sidecar is recovery/provenance evidence and cannot silently replace the persisted result.
- Upstream V1 compaction remains only as explicitly named compatibility/test construction. Product default layers and graph nodes are fail-closed LCM guards; summarize, remote compact, old markers, LCM failures, and overflow cannot select it.
- Public LCM settings remain limited to strategy and storage warning threshold.
- Product family resolution now reads authoritative Core Kilo session/project lineage and reports stage-specific lookup/boundary/root diagnostics instead of collapsing old-session failures into `lcm_family_resolution_failed`. The resolver consumes the ambient app/default-layer Core service when present and scopes a Core default layer only for isolated embedders, avoiding both an undeclared Effect requirement and a second module-owned database runtime.
- The final provider request now enforces the output reserve admitted by LCM, closing the path where a long session could grow from roughly 75K input toward a 131K context ceiling through a recomputed output allowance.
- CLI, TUI, and VSCode now expose hard/raw/backlog plus bounded paid-token LCM activity; VSCode restores prompt export and debug backend logging and merges paid LCM requests into the task timeline.
- Map execution planning now separates requested and effective workers, and both map kinds use the same fair local-provider wait lane. Local contention and map-child slot pressure are observable queue states rather than worker-validation or provider-capacity failures; typed item failures no longer fall through to caller `invalid_request`.

## Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before cursor pagination, and later pages rerun the search/ranking work. This is not a known correctness or authorization defect, but remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation.

The V1 `session/prompt.ts` adapter is the largest upstream conflict surface until the product prompt path can use the core context-engine dispatch directly.

`packages/opencode/script/build-node.ts` currently fails on an upstream browser/Bun-builtin compatibility path that is not used by the compiled CLI or VSIX release workflow. Keep the limitation visible, but do not weaken the production `build.ts`, VSCode, or packaged-runtime gates and do not add environment-specific bypasses to publishable source.

## Prerelease Evidence Status

GitHub workflow run `30094567166` published `v7.4.15-lcm.8` as release `359305370` from exact prerelease head `587eaca0fa8e03704078bfc2f398447cf8b241fb`, based on product commit `45ab20ca0d599e399a57070cdf317bf06a5bad4a`. The prerelease overlay guard passed, as did the focused contract, map, scheduler, sub-agent-scope, and provider-assembly checks. Independent verification proved the tag/SHA binding, requested alpha description, and all 20 required nonempty assets. Packaged Linux x64 runtime smoke passed and uploaded evidence artifact `8597268056`; CLI and VSIX workflow artifacts are `8597190999` and `8597313330`. After replacement verification, faulty release `359240777` and tag `v7.4.15-lcm.7`, bound to `39ffbfb4edd20f2fd434eaff672bcef8d943d87c`, were deleted by exact identity; remote checks returned `404` for both old identities and `200` for the `.8` release and tag.

GitHub workflow run `30075575942` published `v7.4.15-lcm.5` as release `359146564` from exact prerelease head `a37433fc0665aa3b1a5406bb40f9e4ff92c37587`. Independent verification proved the tag/SHA binding and all 20 required nonempty assets. Packaged Linux x64 DB/continuation smoke passed and uploaded evidence artifact `8589933348`, including DB worker/regex-cancellation checks, first-turn `lcm_grep` registration for a passive old-session scope, and durable 3/3 then 4/4 Core/LCM coverage across the three-process seed/continuation probe. After replacement verification, superseded release `359118859` and tag `v7.4.15-lcm.4`, bound to `15ebfcc659e81cb973c625227e00049ba3b4b5c1`, were deleted by exact identity; remote verification confirmed `.4` absent and `.5` still exact with its complete asset profile. This evidence remains valid for the unchanged LCM subsystems, but its full-item local-provider reservation behavior is superseded by runtime-owned agentic recovery and turn-level fair provider admission and therefore is not release evidence for the next candidate.

## Evidence Gaps

- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Collect the required old-session/output-reserve/CLI-VSCode observability captures and complete all nine LCM tools with both local Qwen and authenticated z.ai as specified in `verification.md`.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.15`.
