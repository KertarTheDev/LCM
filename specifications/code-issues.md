# LCM Current-Code Issues

Status date: 2026-07-25.

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
- Retrieval hits now expose stored source/part provenance and rank original evidence ahead of assistant discussion and direct tool echoes. `lcm_expand_query` globally ranks derived-query candidates, loads covered source for explicit summaries, and returns an honest no-answer when provider synthesis fails without sufficiently relevant fallback evidence instead of concatenating arbitrary lexical hits.
- Runtime-owned non-agentic LCM generation now shares one reasoning/output policy. Reasoning-capable local Ollama calls receive a final operation-level no-reasoning override, supported retrieval synthesis uses a fixed native structured-output schema, and usage records report the effective policy rather than the caller's requested default.
- Agentic-map protocol v5 preserves typed structured values through durable JSONB/output publication, confines wrapper/string compatibility to one schema-gated boundary, gives diagnostic-specific durable retries, and describes `provider_invalid_response` as finalization rejection rather than child-launch proof.

## Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before cursor pagination, and later pages rerun the search/ranking work. This is not a known correctness or authorization defect, but remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation.

The V1 `session/prompt.ts` adapter is the largest upstream conflict surface until the product prompt path can use the core context-engine dispatch directly.

`packages/opencode/script/build-node.ts` currently fails on an upstream browser/Bun-builtin compatibility path that is not used by the compiled CLI or VSIX release workflow. Keep the limitation visible, but do not weaken the production `build.ts`, VSCode, or packaged-runtime gates and do not add environment-specific bypasses to publishable source.

## Prerelease Evidence Status

GitHub workflow run `30137172326` published `v7.4.15-lcm.9` as release `359614020` from exact prerelease head `e69b533aa6d18f2a2e4d86919f995c8c9fee366e`, based on product commit `e0037474272a3db361bd6e51288b1a5d655c3dbe`. The prerelease overlay guard and exact-SHA map/runtime release-candidate checks passed, including cancellation-tree, provider-visible tool-contract, sub-agent-scope, and full production-service agentic child execution. Independent verification proved the tag/SHA binding, fix-specific alpha description, and all 20 required nonempty assets. Packaged Linux x64 runtime smoke passed and uploaded evidence artifact `8613321200`; CLI and VSIX workflow artifacts are `8613280730` and `8613338035`. After replacement verification, superseded release `359305370` and tag `v7.4.15-lcm.8`, bound to `587eaca0fa8e03704078bfc2f398447cf8b241fb`, were deleted by exact identity; after GitHub's short ref-consistency delay remote checks returned `404` for both old identities and `200` for the `.9` release and tag.

GitHub workflow run `30075575942` published `v7.4.15-lcm.5` as release `359146564` from exact prerelease head `a37433fc0665aa3b1a5406bb40f9e4ff92c37587`. Independent verification proved the tag/SHA binding and all 20 required nonempty assets. Packaged Linux x64 DB/continuation smoke passed and uploaded evidence artifact `8589933348`, including DB worker/regex-cancellation checks, first-turn `lcm_grep` registration for a passive old-session scope, and durable 3/3 then 4/4 Core/LCM coverage across the three-process seed/continuation probe. After replacement verification, superseded release `359118859` and tag `v7.4.15-lcm.4`, bound to `15ebfcc659e81cb973c625227e00049ba3b4b5c1`, were deleted by exact identity; remote verification confirmed `.4` absent and `.5` still exact with its complete asset profile. This evidence remains valid for the unchanged LCM subsystems, but its full-item local-provider reservation behavior is superseded by runtime-owned agentic recovery and turn-level fair provider admission and therefore is not release evidence for the next candidate.

## Evidence Gaps

- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Collect the required old-session/output-reserve/CLI-VSCode observability captures and complete all nine LCM tools with both local Qwen and authenticated z.ai as specified in `verification.md`.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.15`.
