# Release support

Status: normative v7.4.21 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.21`
(`a5aaef74a81edaa9b5dac9b6b459d7700b973b62`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The current public prerelease is `v7.4.21-lcm.2`. It was published on 2026-08-12 from candidate
`5b0ff9b3618c8d27d1fedb86b9e4d6a253871053`, containing verified product
`b3db0028e4a80804e2b18c595393f0564a2c41be`. Exact-SHA workflow run
[`31642534580`](https://github.com/KertarTheDev/LCM/actions/runs/31642534580) completed successfully, including exact
27-path overlay verification, focused v7.4.21 adaptation tests, canonical affected-package typechecks, stable contract
generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime smoke. Release
[`369542832`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.21-lcm.2) is a non-draft prerelease whose tag
resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|50,128,527|`41f432825de8bb901a852155ba683e75f787ce598d157e183ef6c173385c1985`|
|`kilo-darwin-x64-baseline.zip`|52,449,616|`93b5c3e49bb4185db4e36b5b1e20e134bb471da9ec3834976ec36a31c658064d`|
|`kilo-darwin-x64.zip`|52,449,616|`dc86e20972a1a54631a3cd57c6a012312c04ff7a64e12a3d916edc1f5761d395`|
|`kilo-linux-arm64-musl.tar.gz`|62,505,464|`c36fb315dc4ac8d54ffd5e3b6e64aa2bed192ff0ee86ad2f35989aeb487b5e26`|
|`kilo-linux-arm64.tar.gz`|63,914,808|`9c8579dd3e71828081e6779b39b80f87379290b15e93d6bfcabc4c69b41b8a25`|
|`kilo-linux-x64-baseline-musl.tar.gz`|62,937,568|`f8454979c7527f82ee29ce6b0cddbbd6b3bb70679d067a1fe665303b39ff17e2`|
|`kilo-linux-x64-baseline.tar.gz`|64,168,374|`aabf2ead4392b96cc2087925ae7a0a519afc7fd6ef45ea3da6b1443b2846776e`|
|`kilo-linux-x64-musl.tar.gz`|62,937,553|`bee5418a6236e2e283b36d2c269a42061165bd1ae943c03415a4bfd452f67109`|
|`kilo-linux-x64.tar.gz`|64,167,860|`5431e7e6583da7f588d444615cd13cb06e5dd73d8ea92587094631325742d5d1`|
|`kilo-vscode-alpine-arm64.vsix`|103,150,653|`9a650ac71133ed318843460da5755f90c94a433fcb58c2284d32bff3cb2e7ff5`|
|`kilo-vscode-alpine-x64.vsix`|110,314,324|`2fda5f6e564c9bb69523d69b8ddbb4b2c3a841236e8adc9d5400d93f03027d59`|
|`kilo-vscode-darwin-arm64.vsix`|90,336,354|`8f6c35b9fd2e28bde0910ea9fa9382453bbf1c9d9f81bab071c834524198dcda`|
|`kilo-vscode-darwin-x64.vsix`|98,469,398|`f2fde8e7d46723329a4695171d4618e2b1f4f9465525ff272abe7afd4565f562`|
|`kilo-vscode-linux-arm64.vsix`|104,571,902|`c460e0969959367ae240258d62f98161cddd993dc5ec4afd0b2970a1971e81e1`|
|`kilo-vscode-linux-x64.vsix`|111,525,963|`20759d597ef1eec56fec1b88fddee6e955edf29be284f179165d507f2abcd479`|
|`kilo-vscode-win32-arm64.vsix`|87,303,053|`704aba2c49c7d5f98f4a888cb90cc277d4db0bab5ac6a6f79c973a0bd591a6ca`|
|`kilo-vscode-win32-x64.vsix`|111,333,775|`80143000f2bd3ca17dfa40c0337199d05e4943b1a450dc143da80a6833b5cf90`|
|`kilo-windows-arm64.zip`|62,809,956|`1e767c1f4f336b59e132ec0deb807debcac13240aab5c09b9b6b7ce3252c6d08`|
|`kilo-windows-x64-baseline.zip`|64,475,502|`b65595a0d7e136658e6b29c90bd844b8134a8a6ac5b1fc67c883b2fc2927184a`|
|`kilo-windows-x64.zip`|64,475,502|`794797ee02dc74d3368621be96bee9a691ad8c76dea22bbe7dfa899800d56f40`|

The known-faulty `v7.4.21-lcm.1` release ID `368913653` and matching tag were removed only after `.2` passed exact
publication verification. `.1` omitted finalized LCM recovery-tool results from derived source lineage, so successive
tool calls could accumulate as protected raw provider context instead of becoming consumed and eligible after the next
successful provider step. It also accepted model summaries with no recovery handle and negligible content. The raw
Kilo transcript was not affected, and `.2` rebuilds the disposable pre-v6 sidecar.

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

Replacement audit run [`31641865296`](https://github.com/KertarTheDev/LCM/actions/runs/31641865296) likewise failed
safely before versioning or draft creation and created no release or tag. Canonical OpenCode typecheck then exposed
plain string message and part IDs in the same recovery fixture's direct `WithParts` assertions. The fixture now uses
the real branded ID types in ordinary product commit `c4b4c08338d0606aa78122032431d83ed44f32f3`; the failed run's Actions audit
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
target from "latest" or from tag order. There is currently no authorized replacement deletion.

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
