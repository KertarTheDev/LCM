# Release support

Status: normative v7.4.17 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.17`
(`a0364858a6e1b69a2e2dc5434a82d5cefbe79ea7`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The current public prerelease is `v7.4.17-lcm.1`. It was published on 2026-07-31 from candidate
`65f61c86364f0ee50db87b7ba356b002440bb883`, containing verified product
`93113f09f462e3c47191ebf02789d79aedf98108`. Exact-SHA workflow run
[`30617008748`](https://github.com/KertarTheDev/LCM/actions/runs/30617008748) completed successfully, including focused
v7.4.17 adaptation tests, affected-package typechecks, stable contract generation, all 12 CLI and eight VSIX builds,
and extracted Linux VSIX runtime smoke. Release
[`362945030`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.17-lcm.1) is a non-draft prerelease targeting the
candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|49,757,284|`acf1b6c5567d8a79319ab4ed0240d2ea1ffffc06db9549544b93acf1610fbef5`|
|`kilo-darwin-x64-baseline.zip`|52,093,971|`bffbc558f3db5cf3f0d41f50f9341023a9fe627bbdd28d693a96fd73ac6e8f02`|
|`kilo-darwin-x64.zip`|52,088,501|`face561f3feaef8f4fcefb5a39596169ed4d22fccbfa8bcb0956154166725536`|
|`kilo-linux-arm64-musl.tar.gz`|62,146,134|`ef5008e97db4f675be20ffb0f53b7e12c5b71486083c4921d0bc16f1df529a22`|
|`kilo-linux-arm64.tar.gz`|63,549,477|`6ca0f6a0554476bebfea7a5fafc4d0972f104b15dd777eddc6a2e776a134f82e`|
|`kilo-linux-x64-baseline-musl.tar.gz`|62,571,214|`452f7c8bc8aed07bd86741af923feea85688ca955809a3b60dcd33f54071c8af`|
|`kilo-linux-x64-baseline.tar.gz`|63,803,301|`a5ad0912137939f3a45aa193b3b2dc898d9ea8c16ccef108d6a8ae7b6d2d8921`|
|`kilo-linux-x64-musl.tar.gz`|62,571,274|`bfa1d0c6b986f722028e831d8c844f0394d9ae6a50e499908bf8f4e000120c5c`|
|`kilo-linux-x64.tar.gz`|63,809,620|`599db0a4fb26204da4f1cd6f52b96a8b1e4bec6844b4088b71e750883d89ef67`|
|`kilo-vscode-alpine-arm64.vsix`|102,404,389|`d9845ea830c3cf92c28cd8df5df7db4101f072a21b37436a620d6965d3cee275`|
|`kilo-vscode-alpine-x64.vsix`|109,568,544|`40af7f550f7c36f702ca0b8f4cb0ee7a43aa634d263eef4a7053c8ad5712fd68`|
|`kilo-vscode-darwin-arm64.vsix`|89,578,650|`f872657b4153b45f7170c48f144ba9ef6fb1516f600f31a09e1d0a28efb3de5d`|
|`kilo-vscode-darwin-x64.vsix`|97,723,573|`56e3d1550355a7631e376bf07c3b115758b941eb8339be15d82a8e2b04e3503d`|
|`kilo-vscode-linux-arm64.vsix`|103,834,107|`0b92147907c8731a5e62f145f956613e56a792217b841dda0d2f79d25d0f7860`|
|`kilo-vscode-linux-x64.vsix`|110,786,112|`dff47530dd1b15d4718fcddd5781eac5f1155c37a3e4afa190f3a8a9072d6a7d`|
|`kilo-vscode-win32-arm64.vsix`|86,562,223|`6544c47deb3a06a85482c39993db6fb869c93ae3423e311f5e40dae3222e74de`|
|`kilo-vscode-win32-x64.vsix`|110,588,865|`8f4de85b6406f627bfa7948ab55a067bb5982c0f705c5538a6a9e0ce69699a9d`|
|`kilo-windows-arm64.zip`|62,450,627|`29f6091b775de06f57ee401614241ac78d5c14acdd65f8f8693bfc715317cc2f`|
|`kilo-windows-x64-baseline.zip`|64,124,821|`330d91ee123de21f8c3b78b5db29ae37722adf1697a56ca01b15a951d6c42bbf`|
|`kilo-windows-x64.zip`|64,116,099|`912c4db64e42238db5557c25857d5387e1de8f270507e1ebadf98864f3dd7857`|

The previous `v7.4.16-lcm.3` release remains published as retained history. The incompatible v7.4.16 `.1` and faulty
`.2` releases and tags remain absent. The first v7.4.17 candidate run
[`30616648218`](https://github.com/KertarTheDev/LCM/actions/runs/30616648218) failed before draft creation because its
workflow combined mock-heavy tests in one Bun process; no release or tag was created, and its Actions audit history is
retained. Upstream version/build/publish jobs remained skipped for both v7.4.17 runs.

For a future differently tagged correction, keep the current prerelease until the replacement product, overlay,
workflow SHA, non-draft release, tag, asset manifest, and packaged runtime are verified. Then re-resolve and delete only
the captured obsolete release ID and exact matching tag/assets. If publication fails, delete only a captured failed
draft/release and matching tag. If failure occurs before draft creation, verify that no release or tag exists and
perform no deletion.

Release evidence includes clean second generation, focused semantic-adaptation suites, annotations, VS Code
compile/snapshot and install identity, extracted CLI/VSIX smoke, exact source/artifact hashes, and final clean status.
JetBrains source and its separately versioned, signed Marketplace release pipeline remain upstream-owned and are
excluded from the LCM prerelease test and asset profiles.
