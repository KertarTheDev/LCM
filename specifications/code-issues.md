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

## Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before cursor pagination, and later pages rerun the search/ranking work. This is not a known correctness or authorization defect, but remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation.

The V1 `session/prompt.ts` adapter is the largest upstream conflict surface until the product prompt path can use the core context-engine dispatch directly.

`packages/opencode/script/build-node.ts` currently fails on an upstream browser/Bun-builtin compatibility path that is not used by the compiled CLI or VSIX release workflow. Keep the limitation visible, but do not weaken the production `build.ts`, VSCode, or packaged-runtime gates and do not add environment-specific bypasses to publishable source.

Agentic map execution is durable in storage but its active scheduler is process-owned. After a runtime restart, `lcm_map_status` intentionally does not recreate child-session work for a nonterminal agentic run; the run must be canceled and recreated. Durable restart recovery needs explicit child-session reconstruction, lease reconciliation, and duplicate-work guarantees before it can replace this fail-closed behavior.

## Prerelease Evidence Status

GitHub workflow run `30057848352` published `v7.4.15-lcm.3` as release `359029133` from exact prerelease head `6a7a1c38ef787c52075c385493c107707f7e6ac1`. Independent verification proved the tag/SHA binding and all 20 required nonempty assets. Packaged Linux x64 DB/continuation smoke passed and uploaded evidence artifact `8583605306`, including first-turn `lcm_grep` registration for a passive old-session scope and durable 3/3 then 4/4 Core/LCM coverage. Superseded release `358693627` and tag `v7.4.15-lcm.2`, bound to `19817f8150c8f78af7ff48d40f6f5e94738d1a06`, were then deleted by exact identity; remote verification confirmed `.2` absent and `.3` still exact with its complete asset profile. This closes the v7.4.15 prerelease automation gap, but it is not stable-release approval.

## Evidence Gaps

- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Collect the required old-session/output-reserve/CLI-VSCode observability captures and complete all nine LCM tools with both local Qwen and authenticated z.ai as specified in `verification.md`.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.15`.
