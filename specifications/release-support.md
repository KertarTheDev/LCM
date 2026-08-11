# Release support

Status: normative v7.4.21 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.21`
(`a5aaef74a81edaa9b5dac9b6b459d7700b973b62`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The reserved replacement identity is `v7.4.21-lcm.1`. It remains unpublished until the clean product SHA, release
overlay, exact-SHA workflow, artifacts, and packaged runtime have been authorized and verified. Until then,
`v7.4.20-lcm.1` remains the current public prerelease.

The current public prerelease is `v7.4.20-lcm.1`. It was published on 2026-08-05 from candidate
`682beec3b0b823e3cfee509be358734dc1691845`, containing verified product
`ce062e57f1748bf76070e0cd072792ed3a532ab6`. Exact-SHA workflow run
[`31002184691`](https://github.com/KertarTheDev/LCM/actions/runs/31002184691) completed successfully, including exact
six-file overlay verification, focused v7.4.20 adaptation tests and lint, canonical affected-package typechecks,
stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime
smoke. Release [`365487957`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.20-lcm.1) is a non-draft prerelease
whose tag resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|49,957,773|`582c7b7e826b373a3f610bce209465b7a258b83e37222e4d133db575fad53fe8`|
|`kilo-darwin-x64-baseline.zip`|52,292,215|`0df0fdd318fa2f8632e6a1de3b112e6f7ed809319c5c3db5badae6bc53a43ca1`|
|`kilo-darwin-x64.zip`|52,292,215|`7faef8cfd239e0568e50fcd8fed0177b203ae4b5f75e149b98820f43b5cbed8a`|
|`kilo-linux-arm64-musl.tar.gz`|62,339,920|`1b9f300943df10a9c9320e78be4362689ed09b047d37f32f1c805e103d424f2d`|
|`kilo-linux-arm64.tar.gz`|63,749,800|`9ccc578bbc37ff6bf55cb24a10d4746f36fa878c6ba89c486edb5dd436cfea7d`|
|`kilo-linux-x64-baseline-musl.tar.gz`|62,763,670|`9473f84064683615cf1c695e2feef980ac665cc7b1a3923a7671c9c75093879c`|
|`kilo-linux-x64-baseline.tar.gz`|64,004,508|`edb51fbea016f2876541948155274e5dd068efd7b3b05c19718f4528769302c2`|
|`kilo-linux-x64-musl.tar.gz`|62,763,346|`9807cf4011060b3b94f9fed6d7f58f5715e68eb1512186735bd7620305553f63`|
|`kilo-linux-x64.tar.gz`|63,999,321|`c6e2cecc9edbaa734cb59eaaad0641f169a079ca3fbe67ec8b16421e2ecdaa26`|
|`kilo-vscode-alpine-arm64.vsix`|103,006,506|`a76cb227ccb20872a4e42abada13b2a0b8493d7f218e335b4d7c627d53a19110`|
|`kilo-vscode-alpine-x64.vsix`|110,169,888|`7427d7b7503b5bd61bc51283eb5f8610b341d6b994f8c04c32b4155a3e50bac1`|
|`kilo-vscode-darwin-arm64.vsix`|90,188,649|`a1afbbb237b93774aa7a742074357e69d7b7e82fafce6448782470ea9617e60c`|
|`kilo-vscode-darwin-x64.vsix`|98,333,535|`641cdb1a2f6a613ee55474cb431853e605c216026768f8a15e4fe28bda47e1e0`|
|`kilo-vscode-linux-arm64.vsix`|104,438,848|`732975378df80353f81ba0227311ad38ddd622c1200b0624054ddead1b211078`|
|`kilo-vscode-linux-x64.vsix`|111,384,174|`1302d53dcb81a0035560c8da2c1100868d4773adc4ea73aac6bedff4797a2754`|
|`kilo-vscode-win32-arm64.vsix`|87,171,422|`9e4d95f95720caa8e621b2554d01a32759ac84e0749785708f975951ba80b22a`|
|`kilo-vscode-win32-x64.vsix`|111,194,300|`1d81957d2fe7d638ee36f7c9fcbe03b12406a368721ca19e1aeb423182cf74ad`|
|`kilo-windows-arm64.zip`|62,646,592|`381fa125d57e147424dd44cdecf1451b61c23642cc94e0796b248c059f8d72da`|
|`kilo-windows-x64-baseline.zip`|64,305,683|`25784af26d325797929a13027d0418bc3c1e7061890bf398596e37a5447c8a59`|
|`kilo-windows-x64.zip`|64,305,683|`b793a5ace98e39368179495c18949940aa099f3c305a917e8a377657713317d0`|

Release [`364019885`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.17-lcm.2) and release
[`360907867`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.16-lcm.3) remain published as retained history. The
obsolete `v7.4.17-lcm.1` release ID `362945030` and its matching tag remain absent, as do the incompatible v7.4.16
`.1` and faulty `.2` releases and tags.

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
target from "latest" or from tag order. There are currently no published prereleases authorized for deletion.

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
