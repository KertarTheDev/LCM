# Release support

Status: normative v7.4.17 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.17`
(`a0364858a6e1b69a2e2dc5434a82d5cefbe79ea7`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

Until a v7.4.17 replacement is completely verified, the current public prerelease remains `v7.4.16-lcm.3`. It was
published from candidate
`2cab563d6c58552b9abd4e7b58579cdc7ba39a3a`, containing verified product
`82b79ba06fa892b3e3a778a420992ed67938c68e`, with the exact expected 20 assets and successful packaged-runtime smoke.
The incompatible `.1` and faulty `.2` releases and tags are absent, their Actions audit history is retained, and
upstream version/build/publish jobs remained skipped.

For a future differently tagged correction, keep the current prerelease until the replacement product, overlay,
workflow SHA, non-draft release, tag, asset manifest, and packaged runtime are verified. Then re-resolve and delete only
the captured obsolete release ID and exact matching tag/assets. If publication fails, delete only a captured failed
draft/release and matching tag. If failure occurs before draft creation, verify that no release or tag exists and
perform no deletion.

Release evidence includes clean second generation, focused semantic-adaptation suites, annotations, VS Code
compile/snapshot and install identity, extracted CLI/VSIX smoke, exact source/artifact hashes, and final clean status.
JetBrains source and its separately versioned, signed Marketplace release pipeline remain upstream-owned and are
excluded from the LCM prerelease test and asset profiles.
