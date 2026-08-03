# Release support

Status: normative v7.4.17 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.17`
(`a0364858a6e1b69a2e2dc5434a82d5cefbe79ea7`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The current public prerelease is `v7.4.17-lcm.2`. It was published on 2026-08-03 from candidate
`f44368ca82defa4aeeb2dd822e95b96061132a0a`, containing verified product
`d934b8332a81dacd9617a6a0be8dad362b35f96e`. Exact-SHA workflow run
[`30789485003`](https://github.com/KertarTheDev/LCM/actions/runs/30789485003) completed successfully, including focused
v7.4.17 adaptation and LCM tool-visibility tests, canonical affected-package typechecks, stable contract generation,
all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime smoke. Release
[`364019885`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.17-lcm.2) is a non-draft prerelease targeting the
candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|49,783,069|`295c79bc0f36382ca9c6125de9dd31017a89a7d3b8e093b1d837ff5475edafe3`|
|`kilo-darwin-x64-baseline.zip`|52,115,596|`aab7252119181d4383363d279935b321b90a3163c86d9b1f8dc8e5065291f829`|
|`kilo-darwin-x64.zip`|52,115,596|`f8a6ca5481b84adf0e021f5574f500ad442b0089a96b568938ccaa666930c9f5`|
|`kilo-linux-arm64-musl.tar.gz`|62,177,087|`e9de836eead9681b7b37476ce210707e3e3690892fab1fb0d42f7df9abc3a7da`|
|`kilo-linux-arm64.tar.gz`|63,582,381|`70bfa72958c615da4c21b8be29744324d71bb665b70407293324924249746d3a`|
|`kilo-linux-x64-baseline-musl.tar.gz`|62,601,190|`a34b087c9f69151d1e2941da9a05d415893296b2eb2cb4897e33172fc54ed9ab`|
|`kilo-linux-x64-baseline.tar.gz`|63,830,180|`4bc59371c54dfde65457ba4f05fe61819d38bcb31bb4346c9169782408f8f678`|
|`kilo-linux-x64-musl.tar.gz`|62,601,413|`645c76a90105992a8b1f09074008387c74880c9dce98fbe461c828fd13f6d8ad`|
|`kilo-linux-x64.tar.gz`|63,830,520|`b54156523abbd327e136348f498f94ce420fe35460a902273090fc616a580dd2`|
|`kilo-vscode-alpine-arm64.vsix`|102,439,710|`e6a98b4f2a793dcc3cb4959179eff7d170c0728a5db5352e17de3736f89e4730`|
|`kilo-vscode-alpine-x64.vsix`|109,595,173|`d148e56652363b1d88fd2c71415e672df5f71270f829d29f70cb8a6b024dca0f`|
|`kilo-vscode-darwin-arm64.vsix`|89,604,898|`9f7bd65b3c7cec9043cd949e958412dad7c14780e47cbbc2cb1fc55638924ad6`|
|`kilo-vscode-darwin-x64.vsix`|97,753,302|`292ae1cbcf53c34df0746feb06a8b273867a5726dbad7dfbe58e82888cc012ee`|
|`kilo-vscode-linux-arm64.vsix`|103,866,254|`0804bef2e9e629c4dd011e3c2d0ed6288434b4f0f8fa1a3f0fd147a76ca23885`|
|`kilo-vscode-linux-x64.vsix`|110,806,065|`7cdf842ba9fe7b1a691f5c8c147685984849d3788ebbb2c8f4ae2416adc37e10`|
|`kilo-vscode-win32-arm64.vsix`|86,594,437|`571e0ea99f07655fa066d23ac1e7d0d3d375275878e0249696827e0a18cb76e9`|
|`kilo-vscode-win32-x64.vsix`|110,617,651|`2ebdcefb75952d94322b017dd297e7d02316c093505758b53c392b616ad7ef9b`|
|`kilo-windows-arm64.zip`|62,489,543|`8fa319efc56fd4082008f1e5e58c21b01e7e5a02163eb148a48f2e0e807760f2`|
|`kilo-windows-x64-baseline.zip`|64,139,665|`4c0f38f29deed1603ca3597f94bde8afbe76d0531854f099e2c7428dc2f45adf`|
|`kilo-windows-x64.zip`|64,139,665|`37d54d8746da12570d1de78c69a5898aedc3e10ca9faf1048ddc88ce69d935b7`|

The obsolete `v7.4.17-lcm.1` release ID `362945030` and its matching tag were deleted on 2026-08-03 only after the
replacement's exact workflow, non-draft prerelease, tag, candidate SHA, 20-asset manifest, and packaged runtime were
verified. Release [`360907867`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.16-lcm.3) remains published as
retained history. The incompatible v7.4.16 `.1` and faulty `.2` releases and tags remain absent.

Two replacement audit runs failed safely before draft creation and created no release or tag. Run
[`30787770063`](https://github.com/KertarTheDev/LCM/actions/runs/30787770063) exposed invalid branded-ID and
heterogeneous-tool typings in the focused registry fixture during canonical typecheck. Run
[`30788730029`](https://github.com/KertarTheDev/LCM/actions/runs/30788730029) exposed a packaged-help smoke assertion
that inspected only stdout even though this CLI emitted help on stderr. Both defects were corrected on the product
branch, their Actions audit history is retained, and unrelated upstream version/build/publish jobs remained skipped.

For a future differently tagged correction, keep the current prerelease until the replacement product, overlay,
workflow SHA, non-draft release, tag, asset manifest, and packaged runtime are verified. Then re-resolve and delete only
the captured obsolete release ID and exact matching tag/assets. If publication fails, delete only a captured failed
draft/release and matching tag. If failure occurs before draft creation, verify that no release or tag exists and
perform no deletion.

Release evidence includes clean second generation, focused semantic-adaptation suites, annotations, VS Code
compile/snapshot and install identity, extracted CLI/VSIX smoke, exact source/artifact hashes, and final clean status.
JetBrains source and its separately versioned, signed Marketplace release pipeline remain upstream-owned and are
excluded from the LCM prerelease test and asset profiles.
