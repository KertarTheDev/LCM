# Release support

Status: normative v7.4.21 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.21`
(`a5aaef74a81edaa9b5dac9b6b459d7700b973b62`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The current public prerelease is `v7.4.21-lcm.1`. It was published on 2026-08-12 from candidate
`d7f5c2c59babb027fcbabdd08d9e34567344a484`, containing verified product
`400cf2c116f482b5f9a84d338926bc4145f3fac0`. Exact-SHA workflow run
[`31547434768`](https://github.com/KertarTheDev/LCM/actions/runs/31547434768) completed successfully, including exact
27-path overlay verification, focused v7.4.21 adaptation tests, canonical affected-package typechecks, stable contract
generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime smoke. Release
[`368913653`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.21-lcm.1) is a non-draft prerelease whose tag
resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|50,115,670|`61d66be2ae29380229dbae20c2ad8e5d7697cc4519db22f5f9a4eeada9063fc7`|
|`kilo-darwin-x64-baseline.zip`|52,444,457|`d3ab213cbfa4ede9615116b9dd4ef859784d021965bed8158d96c353db8eae81`|
|`kilo-darwin-x64.zip`|52,444,457|`3569bd45212ced578843d279b50ad5b8377d692754a52fdf7ea49f795f03026e`|
|`kilo-linux-arm64-musl.tar.gz`|62,508,388|`058ee8f81b803150840acafd2d1412ad473d57a908f67e3ef73e913bb898fd26`|
|`kilo-linux-arm64.tar.gz`|63,906,808|`7d2e88dee723a8677f82523841d7edb88c92bbfc83ff44decec509da37ddf61c`|
|`kilo-linux-x64-baseline-musl.tar.gz`|62,924,639|`b55cfd4c6c3c9b91640d6992e66738ad67368aec3d1ce64dfcb46a1ef4345a1f`|
|`kilo-linux-x64-baseline.tar.gz`|64,161,165|`ea04ddd02d28a124cdc5961597d29097a71b91887f515399da8deb60e5ad0f5b`|
|`kilo-linux-x64-musl.tar.gz`|62,925,483|`fe49b507d293abc540f58310e83878f3a2920b2c6374c273eb115c13626caf1d`|
|`kilo-linux-x64.tar.gz`|64,165,375|`aee4ec30893758fc61ea7709141b58b2d38606928d46fb87f926fc980c51e69d`|
|`kilo-vscode-alpine-arm64.vsix`|103,146,428|`90bc8a0d746ca6803aa1d34531d5d2af60270d8b5126499c865945a666dbb997`|
|`kilo-vscode-alpine-x64.vsix`|110,304,529|`6cd3647f6901c902b17d8034c1f6297cce28d64a7dbf83fcf0644bd0c5d752b0`|
|`kilo-vscode-darwin-arm64.vsix`|90,324,040|`dfdc488d797b653aaf1c87fea7fe2cc31ce05da6877b33e8a49241defebe2630`|
|`kilo-vscode-darwin-x64.vsix`|98,464,313|`3af204aba586e72b34f036330e575b2bbb457321ff38d05e98413ed4fc789318`|
|`kilo-vscode-linux-arm64.vsix`|104,566,369|`15ee721b8b844b2c0dd1ce99b3f7f4629048ddcd4c5994f1b062794eec97874f`|
|`kilo-vscode-linux-x64.vsix`|111,527,950|`e5818b6fe741027597a459afe88951341f1a008f7dc636a28cbc5818b41693bd`|
|`kilo-vscode-win32-arm64.vsix`|87,298,810|`9b97b0cc194b8244062b4cbc08e2ce01912134c979d08bd44590ffef2105cff7`|
|`kilo-vscode-win32-x64.vsix`|111,324,326|`24d2f255174a8fbd6402cfdf20f90ce328a3867b1f8b0c8942f047ce9065a32b`|
|`kilo-windows-arm64.zip`|62,801,646|`80c221dcba407a2664c803a597f07bf4e20344df7d9fd37b326b7847d2117028`|
|`kilo-windows-x64-baseline.zip`|64,467,528|`8ce9e0e4b844add8bb10d0851db048097994a56a434adc61270790b9581b994f`|
|`kilo-windows-x64.zip`|64,467,528|`0b8fd907908f1245ba4dd4d8a5bedabe4802f8fc3142cb073c8a3873918222c4`|

`v7.4.21-lcm.1`, exact release ID `368913653`, is known faulty. It permanently omitted finalized LCM recovery-tool
results from derived source lineage, so successive tool calls could accumulate as protected raw provider context
instead of becoming consumed and eligible after the next successful provider step. It also accepted model summaries
with no recovery handle and negligible content. Publish and fully verify the differently tagged fixed replacement
`v7.4.21-lcm.2` first; only then remove this exact release ID and its matching `.1` tag. The raw Kilo transcript is not
affected, and `.2` rebuilds the disposable pre-v6 sidecar.

Release [`365487957`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.20-lcm.1), release
[`364019885`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.17-lcm.2), and release
[`360907867`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.16-lcm.3) remain published as retained history. The
obsolete `v7.4.17-lcm.1` release ID `362945030` and its matching tag remain absent, as do the incompatible v7.4.16
`.1` and faulty `.2` releases and tags.

One v7.4.21 audit run failed safely before draft creation and created no release or tag. Run
[`31546846529`](https://github.com/KertarTheDev/LCM/actions/runs/31546846529) exposed the v7.4.21 branded manual-compaction
input types, static application event manifest, and remote-command route return contract during canonical typecheck.
Those narrow adapters and their focused tests were corrected in ordinary product commit
`400cf2c116f482b5f9a84d338926bc4145f3fac0`; the failed run's Actions audit history is retained, and unrelated upstream
version/build/publish jobs remained skipped.

Replacement audit run [`31641322213`](https://github.com/KertarTheDev/LCM/actions/runs/31641322213) also failed safely
before versioning or draft creation and created no release or tag. Canonical OpenCode typecheck exposed a missing
`ToolPart` union guard in the new successive-recovery-call fixture after every focused product and overlay gate passed.
The fixture was narrowed in ordinary product commit `dfe6884946c2c20e587bc934023f2e9c81dfd424`; the failed run's Actions audit
history is retained, and unrelated upstream version/build/publish jobs remained skipped.

Two v7.4.20 audit runs failed safely before draft creation and created no release or tag. Run
[`31000761855`](https://github.com/KertarTheDev/LCM/actions/runs/31000761855) exposed the missing Conversation Memory
layer in the v7.4.20 `ensure-title-mark` integration fixture during canonical typecheck. Run
[`31001269592`](https://github.com/KertarTheDev/LCM/actions/runs/31001269592) exposed upstream lint-budget overruns in
the adapted VS Code early-message router and session context during VSIX packaging. Both defects were corrected in the
single product port commit before publication, their Actions audit history is retained, and unrelated upstream
version/build/publish jobs remained skipped.

Two replacement audit runs failed safely before draft creation and created no release or tag. Run
[`30787770063`](https://github.com/KertarTheDev/LCM/actions/runs/30787770063) exposed invalid branded-ID and
heterogeneous-tool typings in the focused registry fixture during canonical typecheck. Run
[`30788730029`](https://github.com/KertarTheDev/LCM/actions/runs/30788730029) exposed a packaged-help smoke assertion
that inspected only stdout even though this CLI emitted help on stderr. Both defects were corrected on the product
branch, their Actions audit history is retained, and unrelated upstream version/build/publish jobs remained skipped.

Healthy prereleases are retained history. Publishing a newer prerelease does not authorize deleting the release it
replaces. A successful differently tagged replacement may delete an older published prerelease only when this document
already identifies that exact tag and release ID as known faulty, states the defect, and requires its removal after the
fixed replacement is verified. Capture and re-resolve the exact release ID/tag/SHA before deletion; never infer the
target from "latest" or from tag order. The only currently authorized replacement deletion is exact release ID
`368913653` and tag `v7.4.21-lcm.1`, and only after verified publication of `v7.4.21-lcm.2`.

Failed same-run publication cleanup is separate from replacement cleanup. If publication fails after creating a new
draft or release, delete only that captured failed release ID and its matching tag. If failure occurs before draft
creation, verify that no release or tag exists and perform no deletion. Retain Actions audit history in either case.

Release evidence includes clean second generation, focused semantic-adaptation suites, annotations, VS Code
compile/snapshot and install identity, extracted CLI/VSIX smoke, exact source/artifact hashes, and final clean status.
JetBrains source and its separately versioned, signed Marketplace release pipeline remain upstream-owned and are
excluded from the LCM prerelease test and asset profiles.

## Public prerelease onboarding

The public default branch is the friendly starting point for prerelease users, not an operator log. Its README must
lead with a plain-language explanation, a prominent link to the original
[LCM paper](https://arxiv.org/abs/2605.04050), and complete setup help for both VSIX and CLI users. It must make clear
that Marketplace, Open VSX, npm, Homebrew, AUR, cloud, and JetBrains packages are upstream Kilo rather than LCM builds.

The same marked LCM onboarding block must appear in every existing `translations/README.*.md` language. The English
block is the semantic source. Translate the prose naturally and preserve commands, config keys, asset filenames, URLs,
warnings, and the paper link exactly. Translation-only overlay changes are allowed only inside that block (plus the
language navigation when necessary); unrelated upstream README translation churn remains excluded.

Before each prerelease, check every onboarding block against the exact release asset profile, the VS Code engine
requirement, current Conversation Memory settings/defaults, custom-model capacity fields, Ollama guidance, supported
systems, verification, troubleshooting, upgrade, and rollback. Use short sentences, direct second-person language, and
explain unavoidable terms such as x64, ARM64, baseline, glibc, and musl where they first appear.

Generated release notes must use the same friendly summary, link the matching onboarding anchor and original paper,
and retain the exact tag and candidate SHA. After a release is verified and its evidence commit lands on the product
branch, rebuild the public default branch on that documentation head without dispatching another workflow so the
published checksum manifest and onboarding stay current together.
