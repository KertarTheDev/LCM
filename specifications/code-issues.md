# LCM Current-Code Issues

Status date: 2026-07-20.

This file records current engineering or evidence gaps for the v7.4.11 integration.

## Architecture Findings Resolved

- The port now begins with target-release context-engine and V1 prompt seams on clean v7.4.11. The older LCM branch is an isolated-module/test source, not the architectural base.
- Upstream project memory is retained separately from LCM conversation context. `/memory` remains project memory; `/lcm` owns conversation-context settings.
- Upstream recall retains prior-session ownership. Current-session recall is rejected in favor of trusted-lineage LCM retrieval.
- Final persisted SWE-pruned ToolParts are canonical LCM source. A validated truncation sidecar is recovery/provenance evidence and cannot silently replace the persisted result.
- Upstream compaction remains installed for non-LCM paths and public compatibility surfaces. Active LCM failures and overflow never fall back to it.
- Public LCM settings remain limited to strategy and storage warning threshold.

## Engineering Concern

`lcm_grep` currently loads and ranks the full authorized lineage candidate set before cursor pagination, and later pages rerun the search/ranking work. This is not a known correctness or authorization defect, but remains a scalability investigation for very large family databases. Any optimization must preserve current-lineage authorization, stable ordering, cursor scope validation, and regex cancellation.

The V1 `session/prompt.ts` adapter is the largest upstream conflict surface until the product prompt path can use the core context-engine dispatch directly.

## Evidence Gaps

- Complete the focused/package compiler gates and candidate VSIX build for this v7.4.11 branch.
- Collect installed-editor evidence from the exact candidate VSIX on the supported Nobara/VSCodium and macOS/VSCode targets.
- Strict long-context release approval requires packaged-runtime DB smoke and external/manual evidence; source-tree checks alone are insufficient.

Do not treat archived milestone findings as current defects unless they reproduce against `kilocode-lcm-v7.4.11`.
