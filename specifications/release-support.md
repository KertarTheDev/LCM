# Release support

Status: normative v7.4.23 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.23`
(`40fa10e50a75c4887978d892520d1246515413bf`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The current public prerelease is `v7.4.23-lcm.2`. It was published on 2026-08-25 from candidate
`ac853c4c7964cfedb9673528d232af9fbae823a9`, containing verified product
`5f1f7c7c15facf39fd214f29ca0eb7ef23d64680`. Exact-SHA workflow run
[`32793536639`](https://github.com/KertarTheDev/LCM/actions/runs/32793536639) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Release [`376067342`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.2) is a non-draft
prerelease whose tag resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,509,267|`ce2e37d3b18b6b36da79bbe874b961f8b4b85ec7d8f4ef96b6362bb6e987aadb`|
|`kilo-darwin-x64-baseline.zip`|54,765,647|`44f578cb9ff91a2a88cab8ba6a61b2581e2b46c2456820b167b3572e46c1efba`|
|`kilo-darwin-x64.zip`|54,765,647|`045960a12d6c175429dce1918786161a9d9a22a55b659aa629620d9500353237`|
|`kilo-linux-arm64-musl.tar.gz`|69,283,493|`fa391e46143eadbaf7ceb2a0ea4c3be7e65c63bd234f872db3a9114dec9ebd8e`|
|`kilo-linux-arm64.tar.gz`|67,179,656|`5c7b65dcd85677945c54bcd9c8fb198e633e6b8f129ea89c77f8287ff58e29a3`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,771,705|`1c872b24ad0fef4867c949e4b241cce79b2e9edf3f6acbded7868b9d072d9cf4`|
|`kilo-linux-x64-baseline.tar.gz`|67,420,666|`f8b1ed1bfc7cf694a46463ca18143ccb5a358fd2fca95e664a34431a944c8821`|
|`kilo-linux-x64-musl.tar.gz`|69,771,346|`65b6d8fff6062e172a17616b299875fecfdcae119e665489b856e1f01d24c449`|
|`kilo-linux-x64.tar.gz`|67,416,454|`7d1cff3fa7bd0f39c463bad5045b138035c135b27eaea2b0ce87eeba578a5e80`|
|`kilo-vscode-alpine-arm64.vsix`|110,091,995|`b1ae86c71c81ed3481e3aaed29989c6c3e35da53a5d4d246a1473af8c032a03e`|
|`kilo-vscode-alpine-x64.vsix`|117,299,641|`e5e33045815010275c1aa77427fc9c369c4c8f62271bd960120503ebe458cfbe`|
|`kilo-vscode-darwin-arm64.vsix`|92,827,010|`fc4c9397e811f37715bc66f7fb42046c0c5ab14f210021a0dd17d642f2056842`|
|`kilo-vscode-darwin-x64.vsix`|100,895,418|`5a7fcd6758c6c896712fcaf8801982c11bf6c98a05eaba6524987394238b7799`|
|`kilo-vscode-linux-arm64.vsix`|107,929,032|`d84b532d686eb33cfa106a9a4dfe9e1606c5cb2951462c85206dcc20b0a94f3e`|
|`kilo-vscode-linux-x64.vsix`|114,875,063|`3cf8bb8cf44ec633a4f8972e584141346738e5072f999c3d2971117995f4dcae`|
|`kilo-vscode-win32-arm64.vsix`|89,703,071|`ecb5a67e30e97f4342314fa39325c7660aae80ccb4e438af2cdd464ab6f7144f`|
|`kilo-vscode-win32-x64.vsix`|113,746,528|`d822db9badd26922abeafde005471fbd9dad9371be1d0d245a5ffc752d910507`|
|`kilo-windows-arm64.zip`|65,095,755|`2eced120631b5d0551f4a2af926a61081cc173e8a0ca99b12695728ce8bea425`|
|`kilo-windows-x64-baseline.zip`|66,769,949|`eb7bae46ec2df84f0c57437c6576c3e622c525afbb7b49cbb7e6211959134205`|
|`kilo-windows-x64.zip`|66,769,949|`52ab25edab235d13efe48b89de742cc4eda5674963e56a1c71a1999884220187`|

The superseded `v7.4.23-lcm.1` release ID `375779703` and matching tag were removed only after `.2` passed exact
publication verification. `.1` was published from candidate `cc4db8d99fea02c8ab057b884607354ea290a680`, containing
product `941ed964867c275244ec19778d8d601e4b9a204d`, by retained workflow run
[`32740430840`](https://github.com/KertarTheDev/LCM/actions/runs/32740430840). A live 175k-token run showed that replacing
only an unconsumed retried user suffix correctly invalidated derived lineage but also left the rebuilt sidecar with
`consumed_through = -1`, despite retained successful assistant responses independently proving the older prefix had
been consumed. Hard maintenance then saw no eligible sources and failed closed with `lcm_hard_limit_unresolved`.
`.2` preserves replacement invalidation while reapplying only that proof-backed retained prefix; the replacement
suffix remains protected. It also records the required activity evidence for changed and irreducible direct
hard-pressure preparation. The raw Kilo transcript was never affected. Deletion removed `.1`'s release assets and tag;
its Actions audit history is retained, and no older historical prerelease was removed.

An exact retained-release audit on 2026-08-25 found the same retry-lineage implementation in every still-published
LCM prerelease from v7.4.16 through v7.4.22. Under hard context pressure, replacing a retried suffix can erase the
proof-backed consumed prefix, leave no eligible history for maintenance, and make the request fail closed even though
the retained transcript is reducible. These builds remain usable outside that specific long-session retry/recovery
edge case and are retained as historical prereleases rather than current recommendations. The separate missing
hard-preparation activity record is an observability defect and is not by itself a removal reason. The exact affected
public identities are:

|Tag|Release ID|Candidate|Product|
|---|---:|---|---|
|`v7.4.22-lcm.1`|`371341991`|`9234be5dc51a3e2e8f5ae52366c90a451b49edfa`|`3e5be03a2b8436587f14dfcbe04ba81366b551a4`|
|`v7.4.21-lcm.2`|`369542832`|`5b0ff9b3618c8d27d1fedb86b9e4d6a253871053`|`b3db0028e4a80804e2b18c595393f0564a2c41be`|
|`v7.4.20-lcm.1`|`365487957`|`682beec3b0b823e3cfee509be358734dc1691845`|`ce062e57f1748bf76070e0cd072792ed3a532ab6`|
|`v7.4.17-lcm.2`|`364019885`|`f44368ca82defa4aeeb2dd822e95b96061132a0a`|`d934b8332a81dacd9617a6a0be8dad362b35f96e`|
|`v7.4.16-lcm.3`|`360907867`|`2cab563d6c58552b9abd4e7b58579cdc7ba39a3a`|`82b79ba06fa892b3e3a778a420992ed67938c68e`|

Keep those exact older releases and tags published as historical prereleases after `v7.4.23-lcm.2` is verified. The
current replacement operation does not authorize deleting any of these five releases. Only the separately captured
`v7.4.23-lcm.1` release and matching tag were removed after the fixed replacement passed exact release, tag, asset,
and packaged-runtime verification. Older already-absent faulty releases require no action.

The previous affected prerelease `v7.4.22-lcm.1` remains published as retained history. It was published on 2026-08-16
from candidate
`9234be5dc51a3e2e8f5ae52366c90a451b49edfa`, containing verified product
`3e5be03a2b8436587f14dfcbe04ba81366b551a4`. Exact-SHA workflow run
[`31951340616`](https://github.com/KertarTheDev/LCM/actions/runs/31951340616) completed successfully, including exact
27-path overlay verification, focused v7.4.22 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Release [`371341991`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.22-lcm.1) is a non-draft
prerelease whose tag resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,449,271|`cca6f78bbd52871c928b7f9d390edec441e00c3041df41ebe451832ae9bda7ba`|
|`kilo-darwin-x64-baseline.zip`|54,705,957|`2f46b41ace088e10aae69980310682ec0d907afe67c33716e1ec4606e02eed0a`|
|`kilo-darwin-x64.zip`|54,705,957|`db6aec9653d91943452cf66ceed60ba3a86fa8965eb1f36bd0a22cfe543aa075`|
|`kilo-linux-arm64-musl.tar.gz`|69,233,048|`05f1d10baf06b9206ec489b20f19b0f5fc38a1d1868ee1b4159d9367e6579dd8`|
|`kilo-linux-arm64.tar.gz`|67,113,672|`39eb9b68a60789dd25930e3c7bc4c8f7754e44309075fe94903ba7bda9b72150`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,728,149|`e2d2d7428286db936108d3ff12f9082e1af1fb627f967c0c8547001b63b0dde3`|
|`kilo-linux-x64-baseline.tar.gz`|67,357,553|`278d392988077b711ec3b5b74410cdfdb96f94bf672447da50acd5981a14bf72`|
|`kilo-linux-x64-musl.tar.gz`|69,727,933|`f576e942553547a966147cef264c4540016118bb36e72db2e6fe975f2cfe447a`|
|`kilo-linux-x64.tar.gz`|67,357,596|`6f2c1e35491667cc3545009feec07c7d8e1d15a13f294b75266fe59f1337b597`|
|`kilo-vscode-alpine-arm64.vsix`|110,043,640|`8203ed32247b4e99ccccca0bb3d5491a9c94364111d00eaa5722e3756437b86b`|
|`kilo-vscode-alpine-x64.vsix`|117,257,506|`6cf2fec3c92edafd7316e27a169d542f3c905ebd3902a737ea530b629afeed15`|
|`kilo-vscode-darwin-arm64.vsix`|92,782,310|`d69f86a13fe5094f1ba1da07c30543fefa2d55d507be3cdc926157f435e94756`|
|`kilo-vscode-darwin-x64.vsix`|100,850,077|`4a8a23fb186cbf3adb852fcb3e5d3de35a3a215d1efc21c3a273e35cad264515`|
|`kilo-vscode-linux-arm64.vsix`|107,882,217|`fcdefc559d617fa2d0ad09f5beaa553e726b5e6c6761cb6621956405d6069729`|
|`kilo-vscode-linux-x64.vsix`|114,827,138|`1ea34545d1ad75428acec079f72f2085773a02c45122c5014d8e7a535ef7a498`|
|`kilo-vscode-win32-arm64.vsix`|89,661,781|`f5ceed2e5c6e1c072756729b18587854aeea30868d2d5df6389ff178bc9ebeab`|
|`kilo-vscode-win32-x64.vsix`|113,700,261|`aa4ec1106bd04e63021d111db4acc4de89d98d8017402033c74a149111f14471`|
|`kilo-windows-arm64.zip`|65,036,201|`d3393750f06733060381594bfb0bd69f32949b46e835a6eac613da30d6ec78ff`|
|`kilo-windows-x64-baseline.zip`|66,711,696|`f53209e1bfd32bac5d967c9ec262cb6a0ffee93e43873ef4ca571e34c9c16d3c`|
|`kilo-windows-x64.zip`|66,711,696|`305ce04eb2db2a83f8338bd3311cddcfe68198fcc208d8b6d4e920880ff20034`|

The earlier affected prerelease `v7.4.21-lcm.2` remains published as retained history. It was published on 2026-08-12
from candidate
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

Historical release [`365487957`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.20-lcm.1), release
[`364019885`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.17-lcm.2), and release
[`360907867`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.16-lcm.3) remain published as retained history. The
obsolete `v7.4.17-lcm.1` release ID `362945030` and its matching tag remain absent, as do the incompatible v7.4.16
`.1` and faulty `.2` releases and tags.

One v7.4.22 audit run failed safely before versioning or draft creation and created no release or tag. Run
[`31950195767`](https://github.com/KertarTheDev/LCM/actions/runs/31950195767) exposed the new LCM tool collection as a
required Kilo registry-helper input during canonical OpenCode typecheck, which made otherwise unchanged upstream test
fixtures model an LCM-only field. Ordinary product commit `3e5be03a2b8436587f14dfcbe04ba81366b551a4` keeps the
additive collection optional with an empty helper-boundary default while production still supplies all five tools, and
binds that seam to the static contract check. The failed run's Actions audit history is retained, and unrelated
upstream version/build/publish jobs remained skipped.

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

Historical prereleases are retained by default. Publishing a newer prerelease does not authorize deleting the
release it replaces. A successful differently tagged replacement may delete an older published prerelease only when
this document already identifies that exact tag and release ID as known faulty, states the defect, and requires its
removal after the fixed replacement is verified. Capture and re-resolve the exact release ID/tag/SHA before deletion;
never infer the target from "latest" or from tag order. The replacement operation described above authorizes deletion
of only release ID `375779703` and tag `v7.4.23-lcm.1`; that cleanup is complete. No further replacement deletion is
authorized.

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
