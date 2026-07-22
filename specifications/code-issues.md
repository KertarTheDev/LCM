# LCM Current-Code Issues

Status date: 2026-07-22.

This file records current engineering or evidence gaps for the v7.4.13 integration.

## Architecture Findings Resolved

- The port now begins with target-release context-engine and V1 prompt seams on clean v7.4.13. The older LCM branch is an isolated-module/test source, not the architectural base.
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

## Completed Prerelease Evidence

GitHub workflow run `29916707618` published `v7.4.13-lcm.2` from `03af6c8fbb6d42699fee337b83023ca46b3973bf`. The run completed the release-critical LCM gates, built 12 CLI archives and 8 nonempty VSIX assets, and passed packaged Linux x64 LCM DB smoke. Earlier replacement runs exposed an undeclared Core database service in alternate activation layers and a VSIX build invoked outside its package working directory; both were corrected before the successful run. The faulty `.1` release and matching tag were removed only after `.2` passed exact release/tag/asset verification. This closes the compiler/candidate-build automation gap for that prerelease, but it is not stable-release approval.

## Evidence Gaps

- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Collect the required old-session/output-reserve/CLI-VSCode observability captures and complete all nine LCM tools with both local Qwen and authenticated z.ai as specified in `verification.md`.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.13`.
