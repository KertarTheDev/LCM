# LCM Current-Code Issues

Status date: 2026-07-21.

This file records current engineering or evidence gaps for the v7.4.13 integration.

## Architecture Findings Resolved

- The port now begins with target-release context-engine and V1 prompt seams on clean v7.4.13. The older LCM branch is an isolated-module/test source, not the architectural base.
- Upstream project memory is retained separately from LCM conversation context. `/memory` remains project memory; `/lcm` owns conversation-context settings.
- Upstream recall retains prior-session ownership. Current-session recall is rejected in favor of trusted-lineage LCM retrieval.
- Final persisted SWE-pruned ToolParts are canonical LCM source. A validated truncation sidecar is recovery/provenance evidence and cannot silently replace the persisted result.
- Upstream compaction remains installed for non-LCM paths and public compatibility surfaces. Active LCM failures and overflow never fall back to it.
- Public LCM settings remain limited to strategy and storage warning threshold.

## Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before cursor pagination, and later pages rerun the search/ranking work. This is not a known correctness or authorization defect, but remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation.

The V1 `session/prompt.ts` adapter is the largest upstream conflict surface until the product prompt path can use the core context-engine dispatch directly.

`packages/opencode/script/build-node.ts` currently fails on an upstream browser/Bun-builtin compatibility path that is not used by the compiled CLI or VSIX release workflow. Keep the limitation visible, but do not weaken the production `build.ts`, VSCode, or packaged-runtime gates and do not add environment-specific bypasses to publishable source.

## Completed Prerelease Evidence

GitHub workflow run `29844020302` published `v7.4.13-lcm.1` from `cbd5d6dbb2bfca3c887fd5847744638b1ffdb59a`. The run completed the release-critical LCM gates, built 12 CLI archives and 8 VSIX assets, and passed packaged Linux x64 LCM DB smoke. This closes the earlier compiler/candidate-build automation gap for that prerelease, but it is not stable-release approval.

## Evidence Gaps

- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.13`.
