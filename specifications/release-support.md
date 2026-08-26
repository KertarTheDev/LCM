# Release support

Status: normative v7.4.23 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.23`
(`40fa10e50a75c4887978d892520d1246515413bf`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

Public retention is one verified best-performing healthy prerelease per upstream Kilo version. A newer tag is not a
reason to delete a different upstream version. For the same upstream version, publish and independently verify the
replacement first, then remove each exact superseded release ID and matching tag while retaining Actions audit
history. Never select a deletion target from `latest` or tag ordering; capture and re-resolve its tag, release ID, and
candidate SHA immediately before deletion.

The current public prerelease is `v7.4.23-lcm.10`. It was published on 2026-08-26 from candidate
`072e84c88b8d0a15c5668cee661e71b2ca15bce2`, containing verified product
`f84e2c71e7d52d92ba05ab14e020254b34a73ac9`. Exact-SHA workflow run
[`33001320509`](https://github.com/KertarTheDev/LCM/actions/runs/33001320509) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Release [`377351189`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.10) is a non-draft
prerelease whose tag resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,547,403|`e4dde70555b7d324d76966138675b987ec26faa9b90a38565cca5c8c292a23c9`|
|`kilo-darwin-x64-baseline.zip`|54,805,752|`023c3ffa0916e60c8ca540ac1e47071f0abba551f478bc588b3d013d03f7b97b`|
|`kilo-darwin-x64.zip`|54,805,752|`a94b3ce508471ee7a70423a26c9970ca0c784e1f0579fad1530e355b64ec014e`|
|`kilo-linux-arm64-musl.tar.gz`|69,326,922|`5caaed62bfd0305db091486e059e2ebd06db74890876b2cb0b6972ba78fe8044`|
|`kilo-linux-arm64.tar.gz`|67,206,527|`b57af2f3fc8a474b2c2e5fa61797f2cfbd048bd9815a7f2c77594c980766e41d`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,814,203|`0eaef08054325a22c0f8db4f4a22b9293b68fdf5f84a110f3b6e16f25b3837dd`|
|`kilo-linux-x64-baseline.tar.gz`|67,451,896|`57f994714cdbc9039c2870551273ce820bc8240f5fdeee8713d4f73bff02a85e`|
|`kilo-linux-x64-musl.tar.gz`|69,814,247|`df005e3328173fedc9fa4e6bf4150ca9c50631bc644e02fcd2c456d10e07e63c`|
|`kilo-linux-x64.tar.gz`|67,450,947|`52ae856e02858513a825da3055d61c8b156c215a42760f854689ac5282ea44c8`|
|`kilo-vscode-alpine-arm64.vsix`|110,132,836|`7df1b225cf8c40aef5fa3f2b86bb4e60cc892f17a97c8bdbee7f23b84fdb2834`|
|`kilo-vscode-alpine-x64.vsix`|117,331,999|`43004a0ee4065364b9f9a8cc15161805e0d726235950be51806517ca0d6a56c3`|
|`kilo-vscode-darwin-arm64.vsix`|92,867,671|`778f45141153e4de16be18d48acfa03d99300360a04a5cebc391fdcf40637a1f`|
|`kilo-vscode-darwin-x64.vsix`|100,938,109|`6b46887c335537ae7ba83344d4d9f938f7f4564c7d92f8b3f03d96601e65fb65`|
|`kilo-vscode-linux-arm64.vsix`|107,962,956|`fedb42c30381aa81f25f35071fe990c9a51711a9e374064cd18211cab2f454ed`|
|`kilo-vscode-linux-x64.vsix`|114,909,780|`22a9e9fa5dcf390722d5f54672a6eacf28ab37e093be8fd2a7de9f08c08f817f`|
|`kilo-vscode-win32-arm64.vsix`|89,743,373|`1340bd29ce994d2f7362a63c5927c9672cdfcd7773942f1464a105ea5eec37f6`|
|`kilo-vscode-win32-x64.vsix`|113,783,533|`3288bf7253ef6c2548367e251fcdd7c258f2f999ed2985e74ec25e6313cb1ae4`|
|`kilo-windows-arm64.zip`|65,138,364|`c930143b1d853f7e0764be8056ede2704c1f53d1e27bce355922607ac8996698`|
|`kilo-windows-x64-baseline.zip`|66,815,807|`ab62617aaa5632219eb4e72e38e9f6d4207ccaeede024e1cad741197f47413fc`|
|`kilo-windows-x64.zip`|66,815,807|`c8accbaced7627e38ce0bb19ecdf7b47c19af97545545ca8033da4b9715b031e`|

`.10` corrects the two remaining defects observed in the exact published `.9` 175k trace. Repeated identical
`lcm_grep` and `lcm_read` calls now return compact prior-result facts instead of replaying full evidence payloads, and
semantic duplicate detection treats omitted defaults and their explicit default values equivalently. Recovery
guidance prioritizes answering the user's question, requests concise numeric/count results with the shortest
sufficient proof, and distinguishes a generated `lcm_expand_query` answer from its extractive fallback. Summary
validation rejects summary-task commentary while preserving paired structural unit maps, and the recovery tools expose
an explicit stable metadata type at the host boundary. These changes passed focused LCM tool tests plus the canonical
release typechecks and packaged-runtime gate. Schema-v13/tree-v10 rebuilds disposable `.9` sidecars so retained
summaries use these rules; Kilo SQLite remains the raw source of truth. A fresh provider-backed 175k comparison remains
pending after the OpenRouter quota reset; the prerelease remains experimental and does not claim that external result
in advance.

The GitHub Actions major outage on 2026-08-26 produced retained audit runs
[`32985474928`](https://github.com/KertarTheDev/LCM/actions/runs/32985474928), which ended in `startup_failure` before a
job or release existed, and [`32985701284`](https://github.com/KertarTheDev/LCM/actions/runs/32985701284), which remained
outage-stalled with zero jobs and no draft, tag, or release. Runs
[`32999403320`](https://github.com/KertarTheDev/LCM/actions/runs/32999403320) and
[`33000623888`](https://github.com/KertarTheDev/LCM/actions/runs/33000623888) stopped before versioning or draft creation
when canonical typecheck exposed and then confirmed an overly narrow inferred recovery-tool metadata union. Product
commits `69fa4bc6e5719a34546d107bfa3b4574d82496ff` and `f84e2c71e7d52d92ba05ab14e020254b34a73ac9`
made that boundary explicit; successful run `33001320509` is the publication authority. No failed-run release object
or temporary tag exists to remove, and the Actions audit history is retained.

The previous public prerelease was `v7.4.23-lcm.9`. It was published on 2026-08-26 from candidate
`f9721629bda860f84b497bc9efe6f1fd73929dec`, containing verified product
`b74948920f6a0aebfd30aa7150b15311ad78206d`. Exact-SHA workflow run
[`32947939389`](https://github.com/KertarTheDev/LCM/actions/runs/32947939389) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Release [`376985526`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.9) is a non-draft
prerelease whose tag resolves to the candidate SHA. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,541,247|`777d92d5d33dc3f795ce6a3f98117fefe927b835679422ac8656ca930fca4ca4`|
|`kilo-darwin-x64-baseline.zip`|54,795,377|`aec110173beb8cb320cd3f38f771570f99b2dfaffee95736d0f0166b6d7152fe`|
|`kilo-darwin-x64.zip`|54,795,377|`15d67841f0b9af4d62cd8c4a96c71f1b138e5972b37dacd914e6a6a4cd6fcb26`|
|`kilo-linux-arm64-musl.tar.gz`|69,316,384|`de20a1b3a97543ac035f4580bed986453c3be25dafa44bddf172bcde12d125f4`|
|`kilo-linux-arm64.tar.gz`|67,198,802|`476352263c9572cc2d3250d18f427ef909014fe6d4cb29278ddb31295bc859c9`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,811,330|`5b50bd8e9feed4e8b4f5309d6376c83679d88039a7337331b63b5d93fadf4274`|
|`kilo-linux-x64-baseline.tar.gz`|67,445,822|`703ee153da9be166f7ddbdb8b77acd73569d9aa01c17936411670a36f95b1056`|
|`kilo-linux-x64-musl.tar.gz`|69,811,608|`837bee08b2c2e1a831a98c61a29df5e401561ac5f857a5fadab54a0fe02c9f7e`|
|`kilo-linux-x64.tar.gz`|67,443,170|`40692b1f13ee4dc0a51d065be25d67113d5fb0f0d8097595d4fbef71d3a5529a`|
|`kilo-vscode-alpine-arm64.vsix`|110,121,930|`ac00a19b340461ab2f347605f4e086c4b6739ab80f756108f44e7b7b4bb336bb`|
|`kilo-vscode-alpine-x64.vsix`|117,331,151|`5fdaf5c12fe9d422e546019f310334e0aa225724987cf58996cb5066482d42f8`|
|`kilo-vscode-darwin-arm64.vsix`|92,865,614|`e52358547f98d38ae3f01c9f098cbd70bce80dcb5483a99d04c3a96249b86655`|
|`kilo-vscode-darwin-x64.vsix`|100,927,435|`f014f1db7d6d806dfd3d8f9bfa5454f8a0cdf100b09df51d1b32e78a454b6a84`|
|`kilo-vscode-linux-arm64.vsix`|107,955,456|`655d485cb2cb00b436641636ca09c6b2759dc190d62689902db670c809c40184`|
|`kilo-vscode-linux-x64.vsix`|114,902,128|`62c6cf569e4f27e5c76135141838e4abd91c93ae05b3ed1e967426afc06ec2a0`|
|`kilo-vscode-win32-arm64.vsix`|89,736,824|`0b3fec48af2d5806c66ed08d157244e3651b97bfcea90d04cde940f23e161b47`|
|`kilo-vscode-win32-x64.vsix`|113,776,507|`304847d6bc930b6e4aabb50d6c35d3239a3036470021d78d30574515359bebea`|
|`kilo-windows-arm64.zip`|65,129,769|`742575b6d680e90427ba036991f7261c5a13819b632cf04e5f6704d626bb50a8`|
|`kilo-windows-x64-baseline.zip`|66,805,394|`842ae10ba9b2827277fa66843955e344612907e4a608a864392c7a3909681159`|
|`kilo-windows-x64.zip`|66,805,394|`947496fbad8585f4ce4d7c15b7fd63a5ebe9edf1eab0590cc5119640dd85ce49`|

`.9` superseded `.8` after the exact published `.8` 175k trace exposed remaining general
summary-quality and semantic-recovery defects. Summary requests now quote every historical payload line as inert data,
preserve investigation uncertainty and exact verified bounds, and reject generic historical answer wrappers. Rejected
foreground generations prefer a fair, bounded full-content extractive fallback with exact structural markers,
bookends, sanitized recovery handles, and no partial sanitization markers. Recovery projection now directs the model
to construct ordered exact byte ranges for a semantic unit. `lcm_expand_query` accepts 1–32 chronological,
non-overlapping source ranges, fairly represents every range, samples useful occurrences throughout long records, and
reports relevant, selected, and truncated coverage separately. `lcm_read` can enforce an exclusive structural
`endOffset`, while `lcm_grep` exposes a direct last-occurrence page offset and places guidance before recovered
content. Schema-v12/tree-v9 rebuilds disposable `.8` sidecars so retained summaries use these rules; Kilo SQLite
remains the raw source of truth. The exact published `.9` 175k diagnostic later showed that repeated deterministic
tool calls still replayed full evidence payloads and that summary-task commentary could survive validation. `.9`
is therefore known inferior to `.10`; exact release ID `376985526`, tag `v7.4.23-lcm.9`, and candidate
`f9721629bda860f84b497bc9efe6f1fd73929dec` are authorized for removal only after `.10` remains independently verified.

The following same-upstream releases were inferior to verified `.10` for the defects described in their retained
records below:

|Tag|Release ID|Candidate|
|---|---:|---|
|`v7.4.23-lcm.3`|`376453274`|`4a0b14cc0c1aac5027fa9f6c1ee76308824546cd`|
|`v7.4.23-lcm.4`|`376822950`|`08e446abf764525b42634da9fcaf60c2bff8e75c`|
|`v7.4.23-lcm.5`|`376851777`|`b84ce3b28383d9674395fcdea9c6b6406fba1155`|
|`v7.4.23-lcm.6`|`376875819`|`7bb325306df2fa3e4318e9875a61e8f9b3b1432b`|
|`v7.4.23-lcm.7`|`376895230`|`9d296d785f21af51d9cd050c0b3d41aa5330a404`|
|`v7.4.23-lcm.8`|`376933665`|`5ae5396a540f1698272bce345c30714d8172e393`|
|`v7.4.23-lcm.9`|`376985526`|`f9721629bda860f84b497bc9efe6f1fd73929dec`|

On 2026-08-26, the `.3` through `.9` exact release IDs and matching tags were removed under the one-best policy after
their remote identities were re-resolved. A subsequent release/tag audit confirmed their absence, confirmed `.9`
resolved to `f9721629bda860f84b497bc9efe6f1fd73929dec` with all 20 assets before its deletion, and confirmed that `.10`
still resolves to `072e84c88b8d0a15c5668cee661e71b2ca15bce2` with all 20 assets afterward. Their release assets and tags are no
longer recoverable from GitHub; Actions audit history remains. The sole prerelease for every other upstream version
was untouched by the v7.4.23 cleanup.

The previous public prerelease was `v7.4.23-lcm.8`. It was published on 2026-08-26 from candidate
`5ae5396a540f1698272bce345c30714d8172e393`, containing verified product
`d67d15b0dc9831a94e93fb056dbcf710ae1144af`. Exact-SHA workflow run
[`32939810930`](https://github.com/KertarTheDev/LCM/actions/runs/32939810930) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376933665` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,535,625|`9963693bb793673f510193869e0eca33c9a3b8c12a3abde2ff37962c2f4d9443`|
|`kilo-darwin-x64-baseline.zip`|54,787,975|`3df70a85bb3467d3eb19ab00d5629a39849958d8a45cec4de593538cd5700d95`|
|`kilo-darwin-x64.zip`|54,787,975|`a013c2fcf8ce8354ec469b746e813089f0de7c88dffc98573b2a66cbadcb4185`|
|`kilo-linux-arm64-musl.tar.gz`|69,324,661|`0f7e98dc3911da66dd9e75ef811f4f86c2ffb9824c0ee56acd35dc79df0e10df`|
|`kilo-linux-arm64.tar.gz`|67,200,308|`a8f6d9496ab3ed6d2f34cada3b25032105abd55e2dbf7a70bbea41620a0bc49a`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,802,879|`4742e352f4362c0c4fc7e30ef4f406404453e94ca2e9c51ef431074f86bda523`|
|`kilo-linux-x64-baseline.tar.gz`|67,442,159|`d9141a111c37b97c8147aa7f1540062de7e3be4750d0860ea9def255a43505a3`|
|`kilo-linux-x64-musl.tar.gz`|69,803,531|`e55b11caae1c361d595fa8ccb84ac566e35dadaa7ff72f7c5100a77a1faa31da`|
|`kilo-linux-x64.tar.gz`|67,443,611|`49b8571047e5e53557fc344d7f8787247d3e184fed90ab79bf983fa177d323cd`|
|`kilo-vscode-alpine-arm64.vsix`|110,114,676|`f4e7a87bb2a2fef9feedb04aa79523369a733fb2b4da539cf02d447d0d0ae5c3`|
|`kilo-vscode-alpine-x64.vsix`|117,325,965|`a5666038679bbb59074d34af445f7f73887924d6d5b0ca5706ee9449cce87109`|
|`kilo-vscode-darwin-arm64.vsix`|92,855,642|`8cfcb6f54fbe9ee43f614d8149e487a47b60904c2472881c5edcbdfb7516d214`|
|`kilo-vscode-darwin-x64.vsix`|100,920,188|`0a56b39ec467a50ea4e774cc5799a536de7ecffb52ef2a27326bfb083e5913f5`|
|`kilo-vscode-linux-arm64.vsix`|107,953,342|`11e119e55785a33f537f49df7e773a69cb5eaa7810e1b0b1e75af1c49aca7328`|
|`kilo-vscode-linux-x64.vsix`|114,897,457|`ef2aeb6573eb53218dbe07b862a998a078a9f21319166742fa25502c0881a9f0`|
|`kilo-vscode-win32-arm64.vsix`|89,731,962|`743b587209f1eda713578933b4be0644c0a211f2c4f537c3c1a316248459f8a4`|
|`kilo-vscode-win32-x64.vsix`|113,771,488|`518dfbf0d8faaa6cbc8c657e7182987d3f944ccc6ca08709941c14eaffc4942a`|
|`kilo-windows-arm64.zip`|65,122,464|`b66226cd01bdd36137049199cff9500253bd8da9a3c7fced5574f726beed8edb`|
|`kilo-windows-x64-baseline.zip`|66,795,635|`3b2db805c23b437dbce7f63bbb273390c313d36422dc604b86aa670178f8a73f`|
|`kilo-windows-x64.zip`|66,795,635|`8d541cb8fd71469eafa5612f3c8bdfd641b30152ed081d97fe3da12f65f90422`|

`.8` supersedes `.7` as the recommended build after the exact published `.7` 175k trace exposed general recovery
and summary-quality defects. Deterministic recovery calls now report canonical scope and completed identical-call
counts, so a model is explicitly told to change its next action or answer instead of repeating a successful call.
Source reads and scoped searches disclose transport chronology, including the nearest later non-receipt source, and
warn that transport-source EOF is not a semantic-unit boundary; recovery guidance now follows later sources until an
opened unit closes and requires structural bounds before per-unit aggregation. Summary requests provide an
authoritative handle allowlist, replace receipt-only source bodies with typed omission labels, and reject embedded
protocol receipts, transformation-completion scaffolding, invalid handles, and conservatively detected zero-overlap
output. Schema-v11/tree-v8 rebuilds disposable `.7` sidecars so retained summaries use those rules; Kilo SQLite
remains the raw source of truth. `.8` and the earlier v7.4.23 iterations are superseded by `.9`.

The previous public prerelease was `v7.4.23-lcm.7`. It was published on 2026-08-26 from candidate
`9d296d785f21af51d9cd050c0b3d41aa5330a404`, containing verified product
`075dd6274053f557c025046ddf620014157a4461`. Exact-SHA workflow run
[`32932738149`](https://github.com/KertarTheDev/LCM/actions/runs/32932738149) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376895230` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,531,133|`8b8e1ffd5febdc174d9909af620cc801a4d88c3411f7df4dbee4c69999a03a6d`|
|`kilo-darwin-x64-baseline.zip`|54,785,997|`68ef827e46b653d5af502711599393e6b4d307fc0390513797a28c628f54f67e`|
|`kilo-darwin-x64.zip`|54,785,997|`8d273fcad257bbf5dac57afdd6b756cbac239afe4dd132b1b28c18e170ad3993`|
|`kilo-linux-arm64-musl.tar.gz`|69,300,368|`9d8eec6e7be49e36b0406f5a3a1a4d67f1bffd6e9d4abc5d33bd1765296bc72c`|
|`kilo-linux-arm64.tar.gz`|67,196,476|`846bb79523f36f9664ca0f1fd7c17337fb8d56cc52edd42730d0a9fabad26b41`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,796,489|`05aaabcbac0762498e30ba9c713c0cc1bfcad63a0839e28cf5faef09cba9a1d9`|
|`kilo-linux-x64-baseline.tar.gz`|67,439,950|`289a9ef9017c3460d9900837bf0a5b21bdfca0a3df665502ddfb1fa61b63c330`|
|`kilo-linux-x64-musl.tar.gz`|69,796,069|`99541ebd9dd30d871c65a5c603769543536c12525f48f431676b2ec1e0c4a04c`|
|`kilo-linux-x64.tar.gz`|67,439,860|`74b291f03e90bc0e759096319d13887b031f5b93d0bf54715b06bbfc55445038`|
|`kilo-vscode-alpine-arm64.vsix`|110,113,989|`e91f288f7cf7299f519eaef7b790572982ca44313d10886858786f8c2127cf01`|
|`kilo-vscode-alpine-x64.vsix`|117,321,619|`4602f65d7e7926f896c845b511b99d1fce9a84012a26911215d5d4ee4cfc3718`|
|`kilo-vscode-darwin-arm64.vsix`|92,847,479|`e41ab18f52a481251c8125da5e8c8b87aaa40236ef34e72c12b2fb59b80ac4f0`|
|`kilo-vscode-darwin-x64.vsix`|100,915,821|`0d37b062061230efb1164eec6ed86af07ede6e158a992d256de1412e662098f0`|
|`kilo-vscode-linux-arm64.vsix`|107,950,207|`9db8757543116efadeedfd00584077f11636575bdb30cf412eb9e6cbee8898ea`|
|`kilo-vscode-linux-x64.vsix`|114,891,536|`5606195e519ce86e15551ab4013c7de3c95aef080c8a569af256a38408468854`|
|`kilo-vscode-win32-arm64.vsix`|89,726,367|`16bcc4e14c7caeaa7dbeab7298b50f18ebdb9fe891ffdd26bc4e6edc80fa090e`|
|`kilo-vscode-win32-x64.vsix`|113,764,584|`2353242e10036a3ea778a9d683885d4462e765c4bb587083a07c6a275156c82b`|
|`kilo-windows-arm64.zip`|65,117,010|`8fe3e254928e68eec3d16f2d7f61ebd39e994ebbcca771a8ac6558f90d9c59c8`|
|`kilo-windows-x64-baseline.zip`|66,791,512|`99193f6dda2db443b0f551827177a7dffdf37508f6555a8993e8f6dc47929394`|
|`kilo-windows-x64.zip`|66,791,512|`f1430ada5125bc46388dab38b6343d05de1adf57a64efde0948c6348f6333db7`|

`.7` supersedes `.6` as the recommended build after the exact published `.6` 175k trace exposed two general recovery
and summary-quality defects. A completed `lcm_read` page could be retried with an offset calculated from decoded string
length rather than UTF-8 byte length; an offset past EOF was then misreported as a UTF-8-boundary error. `.7` makes
terminal continuation fields explicitly null, instructs callers to copy returned byte offsets or opaque cursors, and
clamps past-EOF reads to a terminal empty result with the requested and effective offsets disclosed. Broad source
searches now recommend refinement or `lcm_expand_query` when paging is unlikely to help. Summary validation rejects
malformed or truncated handle-like tokens, and summary instructions omit receipt-only acknowledgements and unrelated
compliance commentary. Schema-v10/tree-v7 rebuilds disposable `.6` sidecars so retained summaries use those rules;
Kilo SQLite remains the raw source of truth. `.7` and the earlier v7.4.23 iterations are superseded by `.9`.

The previous public prerelease was `v7.4.23-lcm.6`. It was published on 2026-08-26 from candidate
`7bb325306df2fa3e4318e9875a61e8f9b3b1432b`, containing verified product
`a19d1a8c4142ee2911f946b70b6b1ba95487b322`. Exact-SHA workflow run
[`32928803641`](https://github.com/KertarTheDev/LCM/actions/runs/32928803641) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376875819` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,529,316|`bad4ef461b1a7c4a5b2c896113a56e6967bd2bd7996f71465e15121b94a56fb8`|
|`kilo-darwin-x64-baseline.zip`|54,784,879|`fb56e956ca855753c5d0410afe496219680c053bf2ff25f87576590827849508`|
|`kilo-darwin-x64.zip`|54,784,879|`5d6afb81e1d112d518e213d45bd11035fe1ddf0f4126dd491ad3d6e773ac352b`|
|`kilo-linux-arm64-musl.tar.gz`|69,306,127|`44664498bd9c2ce3545e8db9872f930f2a8720229fc3c2c4c773c485c7e06d63`|
|`kilo-linux-arm64.tar.gz`|67,190,753|`723453c724036182a96f6f0396868222fb687b77fdce7baac9d0d5ee793fc8cd`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,796,842|`d8bbcb842dd78b04df5ff18d10fb0c1c2da91d17e9fe03f2bbd9a602d4ef83ba`|
|`kilo-linux-x64-baseline.tar.gz`|67,441,562|`a41f7cd74a85df6a365f8bcb1ace63d07603fdf3a7a4ad4545dc843ad5d2b149`|
|`kilo-linux-x64-musl.tar.gz`|69,793,690|`68e7e934f7979260d7cfa10f44607d78f99058596f6d91a3fca60ea9a16356cd`|
|`kilo-linux-x64.tar.gz`|67,441,709|`92d70296b1abb21cf6a88b894067cae04b594f8c6ef20a12ebc97d333025ddfd`|
|`kilo-vscode-alpine-arm64.vsix`|110,113,173|`dd716cd6ab8868b5fcd835783843a73381a6c17443df5bf0f497a5c99dd9cfbd`|
|`kilo-vscode-alpine-x64.vsix`|117,322,001|`1b18c1e7c8f41069c0f88e1e41aad645b0642d09a6f60d9ccf6d7dc8b38df949`|
|`kilo-vscode-darwin-arm64.vsix`|92,845,614|`86be06440d9ac47495b521251da0d46cb17816a14b51b592e212d9391bb0b2ed`|
|`kilo-vscode-darwin-x64.vsix`|100,915,667|`b3bfdd2813c988442e9bad115344c4e6c36b8357cf0ebbd40d0a9625a85782ef`|
|`kilo-vscode-linux-arm64.vsix`|107,948,431|`02c85063a6829657579d3698f703cb08c70c3fe3a071fe28e679faaee69e3b77`|
|`kilo-vscode-linux-x64.vsix`|114,888,465|`381f0f13c81d7a7835ff0543b677dcc3f78814e73036f07ebe4e1288086c4ea0`|
|`kilo-vscode-win32-arm64.vsix`|89,724,403|`02f0dfca37f6d228c113ada49172680877994264685801a57bf3566eadd9c68d`|
|`kilo-vscode-win32-x64.vsix`|113,763,323|`5624869b5560c0da03efc76c41759b68ec7182600f7c598699000decf8ad78ea`|
|`kilo-windows-arm64.zip`|65,115,718|`42a2ec31ad1d4dfbfe24e428929e5b3dd51c1e4d722005f893d145b107309079`|
|`kilo-windows-x64-baseline.zip`|66,792,893|`bf3949f838f4d1a9bda07130010d8b797ce8b1614464d5daadb5880970f3f8ed`|
|`kilo-windows-x64.zip`|66,792,893|`e77dac0a60d2ea1c250496ca71f96493454086fc153c03bd03c62e8ec95719d3`|

`.6` supersedes `.5` as the recommended build after the exact published `.5` 175k trace showed that recovery could
find the decisive evidence yet lose the answer to redundant verification, repeat a completed source page, copy an
opaque cursor incorrectly, or repeat an overlong regex because its specific error was hidden by the Effect promise
wrapper. `.6` unwraps specific worker failures, explains literal punctuation and the 512-character regex bound,
reports explicit read completion plus a copy-safe numeric continuation, directs aggregation to focused query/search,
and tells the agent to stop recovery and answer once exact evidence resolves the task. Summary instructions now require
handles to be copied character-for-character. Schema-v9/tree-v6 rebuilds disposable earlier sidecars so retained
summaries use that guidance; Kilo SQLite remains the raw source of truth. `.6` and the earlier v7.4.23 iterations are
superseded by `.9`.

The previous public prerelease was `v7.4.23-lcm.5`. It was published on 2026-08-26 from candidate
`b84ce3b28383d9674395fcdea9c6b6406fba1155`, containing verified product
`ce2455b4cb3ab4aecd7e12f13498e9e69d21be9c`. Exact-SHA workflow run
[`32923865662`](https://github.com/KertarTheDev/LCM/actions/runs/32923865662) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376851777` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,525,962|`572e77b99f91a54cb09c803c5a866876f5d7d3cde15b3fdced932b5829889415`|
|`kilo-darwin-x64-baseline.zip`|54,784,353|`633688a4dc5e391126e0b5f4db4a5db542585a9981d324cd6cc801a19cb3c9de`|
|`kilo-darwin-x64.zip`|54,784,353|`eb0bd41df346fdca381dd47c6173ea637d149b6934e149d5fefe6a1402b42eec`|
|`kilo-linux-arm64-musl.tar.gz`|69,303,571|`d7ab3d7d174238ee72e0f8cf3a506d3825875cd403d96478596b64beb2f0df64`|
|`kilo-linux-arm64.tar.gz`|67,181,461|`7ff6460274161f30f80d566edeb0183adafcd86eddce931f661df42e331e9625`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,797,378|`6c363fe7165645dae1c1ce803e8b77f936faf812e87c0276961204b46834ad96`|
|`kilo-linux-x64-baseline.tar.gz`|67,439,709|`82b98bab970ba8a41f2ae0f0381f43474e3a54356f77b7a6ade11069c8f4c449`|
|`kilo-linux-x64-musl.tar.gz`|69,797,073|`7cacf79681e56e5c576b121048f6bd3a43e35a6df0ed705d125d011064268d83`|
|`kilo-linux-x64.tar.gz`|67,439,439|`7b57ed9f60a9802bac5de74383628a76035dea8e0e1b5d230ebad5f28594e4b6`|
|`kilo-vscode-alpine-arm64.vsix`|110,110,030|`8a25c37125205c99715c29d9a8a24cca82e653545d70ea1737302013ab9ccada`|
|`kilo-vscode-alpine-x64.vsix`|117,319,353|`abf212eaeaa129bb61d13f0e37b24861ebb918b95b2c53cb51e759400c06b538`|
|`kilo-vscode-darwin-arm64.vsix`|92,841,542|`659ebf93832273d74a1053dc1b13356bbc9edcfee5f76f021e6e0e915f4eeab5`|
|`kilo-vscode-darwin-x64.vsix`|100,914,586|`2ce129c99a556801ad3d8420851a0ccc0f22a127d182dc41ede0c97604f4ac8d`|
|`kilo-vscode-linux-arm64.vsix`|107,945,768|`5514ca38ffba5d816a758356e118a4ff3e4c7a8ced808d46482112f0246436a7`|
|`kilo-vscode-linux-x64.vsix`|114,886,969|`58f13f6b66a8c0fd5efa3616355b3e374fbbb98c00fb2757a81f73a685b666b9`|
|`kilo-vscode-win32-arm64.vsix`|89,720,774|`37168fd74267e292d4f715400b72fee207c2722840e1e726454330febc45aca4`|
|`kilo-vscode-win32-x64.vsix`|113,762,831|`546421549694b10140c8d4ef8182663eb050ab3024bc4fcc4ba4363d9f7e5230`|
|`kilo-windows-arm64.zip`|65,114,278|`b3fcc5b21f39a28a9a80ea747636ef1e0f4e46ddd71bd1d5d505e43456ea3ba0`|
|`kilo-windows-x64-baseline.zip`|66,788,267|`a1029c03024a57e9ddf76057bd98a5e9489d204b296974fa1200efea6810244c`|
|`kilo-windows-x64.zip`|66,788,267|`ed0cf095eb3a0d5e2e307fafc8227a3688a43869806db219301466106a30d12a`|

`.5` supersedes `.4` as the recommended build after the exact `.4` 175k trace exposed three general recovery defects.
The packaged CLI omitted the isolated regex worker even though source tests passed; `.5` embeds the worker as a real
build entrypoint, distinguishes startup, execution-timeout, and syntax failures, and tells the model not to repeat an
unchanged failed call. Summary requests now isolate every historical child behind a request-specific inert-data
boundary, repeat the active task after it, reject protocol-only output, and add deterministic exact provenance to an
otherwise valid reduced summary that omitted handles. Structural anchors now include exact half-open UTF-8 byte
intervals, and `lcm_grep` can constrain a source search to those intervals so evidence outside a semantic unit cannot
answer a per-unit question. Schema-v8/tree-v5 rebuilds disposable earlier sidecars; Kilo SQLite remains the raw source
of truth. `.5` and the earlier v7.4.23 iterations are superseded by `.9`.

Audit run [`32923478082`](https://github.com/KertarTheDev/LCM/actions/runs/32923478082) failed safely before versioning,
tag, or draft creation. Canonical OpenCode typecheck found two worker-response discriminant narrowings that were lost
inside completion closures and a request-boundary ID prefix omitted from the internal sortable-ID union. Ordinary
product commit `ce2455b4cb3ab4aecd7e12f13498e9e69d21be9c` fixes those types; the successful replacement run above proves the
canonical package typechecks. The failed run's Actions audit history is retained.

The previous public prerelease was `v7.4.23-lcm.4`. It was published on 2026-08-26 from candidate
`08e446abf764525b42634da9fcaf60c2bff8e75c`, containing verified product
`e68e034a87212c5c80781cd4416af661337e6edd`. Exact-SHA workflow run
[`32917997402`](https://github.com/KertarTheDev/LCM/actions/runs/32917997402) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376822950` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,523,054|`57100763e22791fb69994569720ba9c0914ddd378019ea9d8a01cf971254c921`|
|`kilo-darwin-x64-baseline.zip`|54,778,027|`ad2007a86dc958d8a17f2f4e23981c576eec5d45d38096736ff94b5a1300e803`|
|`kilo-darwin-x64.zip`|54,778,027|`93b998e0d0482706a12bce7274c57b7300965b8296c6dcca14b8be2ee1102ed5`|
|`kilo-linux-arm64-musl.tar.gz`|69,295,716|`2884a456dea2c7a1e4ff50de584191a96a570fc0dd3d615748b21a650768475b`|
|`kilo-linux-arm64.tar.gz`|67,191,480|`623d933ccb2394411b23251cee6412ce4e7caf96323135c39c42089fb29fa779`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,783,852|`b13700190c88fa2873bd4edc90d9d677a7d0c916050f9eed465cb2da59e4a3bf`|
|`kilo-linux-x64-baseline.tar.gz`|67,435,049|`abf7d7e3896f247bc87a241c9941fc2f581303353160979311787a39f54b1961`|
|`kilo-linux-x64-musl.tar.gz`|69,784,636|`af6aa62ef2a0c18e0c994ce73e76963d55b4fedf677a40331a225f0f306ddec5`|
|`kilo-linux-x64.tar.gz`|67,435,566|`4edf4012fa9ffb35b40cfbaa8bc433309c67c58f04c21987c431410e6672add1`|
|`kilo-vscode-alpine-arm64.vsix`|110,106,250|`f44e8597373b2fd1212aa6c5fa49a5dd111102093102d75932f25c3302cd91d6`|
|`kilo-vscode-alpine-x64.vsix`|117,311,285|`a64c7a17fbeee1ec5eed898a86749617217ab172fa5534ae3bb4f5ac1eafaaa9`|
|`kilo-vscode-darwin-arm64.vsix`|92,839,365|`f416709e9fd56a21848a1784663c74633488c1cbfb71e9882b3bccded5a5ceef`|
|`kilo-vscode-darwin-x64.vsix`|100,911,724|`f6124dd1bbcd106939180285f83528168f14f2fd50496f49ac0e1113548d614b`|
|`kilo-vscode-linux-arm64.vsix`|107,941,191|`e6434e708b07140a1b436cf32370a8f7de8d04c0479fc3e73fda28cf28bb6aa7`|
|`kilo-vscode-linux-x64.vsix`|114,885,625|`d870c95013575e97381495de98ba2314122483bbe2aa123c72a088f220d5626b`|
|`kilo-vscode-win32-arm64.vsix`|89,716,502|`590c1f356d84d23f860fd779e33ac0ae59f3ff39efa14619f9fe828bea8cc9e0`|
|`kilo-vscode-win32-x64.vsix`|113,757,293|`b053914bc8f1585df55b9edb8f2a83e943229aca17642af4d8f9f162182d9e62`|
|`kilo-windows-arm64.zip`|65,107,800|`129a019e56dd8b1cfd8e86ac3dbc4e8c9a7b0987477d700829fbf672df8e58d2`|
|`kilo-windows-x64-baseline.zip`|66,784,544|`271202b37251b07d4803a9c39e77d4c9bd145a0103481178d8ce7c6f0ee73092`|
|`kilo-windows-x64.zip`|66,784,544|`96d66251b654db3715e4d856ee5af195421f7e0180773d9a33cf96389e9a6a06`|

`.4` supersedes `.3` as the recommended build after high-quality-model trace review exposed several general recovery
and maintenance quality defects. It constrains transformation output at the model boundary, accepts model summaries
only after a terminal `stop`, rebuilds disposable caches that could contain truncated summaries, improves summary and
query prompts, makes recovery output smaller and better scoped, provides fair match-centred candidate extraction,
hardens cursor validation and regex cancellation cleanup, and removes cancelled maintenance work from the queue
immediately. The retained raw Kilo transcript remains the source of truth. `.4` and `.3` are superseded by `.9`.

The previous public prerelease was `v7.4.23-lcm.3`. It was published on 2026-08-25 from candidate
`4a0b14cc0c1aac5027fa9f6c1ee76308824546cd`, containing verified product
`7837cb58afd07677641eb728db2f56485f013d18`. Exact-SHA workflow run
[`32856216753`](https://github.com/KertarTheDev/LCM/actions/runs/32856216753) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `376453274` was a non-draft
prerelease whose tag resolved to the candidate SHA before removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,515,027|`1e2e5611562d9565a4aaddd09f9d9cb4c0e14c87359a311da63b8b513a34864e`|
|`kilo-darwin-x64-baseline.zip`|54,771,435|`9e6e812fefbe0922f71858345fe193978356a0d32a2f52cbedcae05cbcd7c583`|
|`kilo-darwin-x64.zip`|54,771,435|`8ed930f42eed7ccdd466024699943dd4ecfff2eeb3d083f49f0b003f84c2b8b0`|
|`kilo-linux-arm64-musl.tar.gz`|69,293,410|`76a2dbb9c3795aad895d15ba62d216a218584eb6661ab62e26db802bfbb1400a`|
|`kilo-linux-arm64.tar.gz`|67,178,880|`4464e156943d7b39e65063a7c1cb5597e7c74fe3fa7785460e7898901cd9d01f`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,788,427|`e279851d45655c082b32e2b7ea14f065f1e48ea77f8fc909caa8c9e142188014`|
|`kilo-linux-x64-baseline.tar.gz`|67,421,997|`13413d3e070e78c29e5dae66a3fdb7473fafd7819270094df44e4051cd6f6789`|
|`kilo-linux-x64-musl.tar.gz`|69,787,950|`29d4feb275b58a658967b5780387d2235e7a70fdb286ac603ec319f235a5b0f7`|
|`kilo-linux-x64.tar.gz`|67,423,505|`1354f2f7564e93f65c6d3c8d57c260e35d7508bec9451aeea2e0455a3ab054d5`|
|`kilo-vscode-alpine-arm64.vsix`|110,098,052|`7288eec1d269c87db5ddfbe1baca836284e719368e747669ea6448c89f06f2e4`|
|`kilo-vscode-alpine-x64.vsix`|117,306,974|`a35996f78d3bd969847533b6ba19788b807323274fca206e409d55e2bbc50fab`|
|`kilo-vscode-darwin-arm64.vsix`|92,838,314|`7c48ffdc08108e0d2418685d4e90bb723d06dac9b52ba318d75c3fac4322f9bd`|
|`kilo-vscode-darwin-x64.vsix`|100,901,800|`12e164380045dba663ed04d9d539163c77339bfa58ad096a4d860ff382aa534c`|
|`kilo-vscode-linux-arm64.vsix`|107,931,530|`ce3e632fd7a8bfbe7e1f6e48f62787c98cae90a91131791381f994c1e76c12d9`|
|`kilo-vscode-linux-x64.vsix`|114,877,280|`e7b0d8e66d15d7c04bc4e4f221deca6a056033182995544155316dbab8dc52ef`|
|`kilo-vscode-win32-arm64.vsix`|89,710,474|`660c3a38ccbad3b859e75f46db1631bd04d8031653086b83a4da2d220608d089`|
|`kilo-vscode-win32-x64.vsix`|113,752,605|`25967207ccb361e19baf344b7ade059ab495e942419af44612ed1f02929e0953`|
|`kilo-windows-arm64.zip`|65,102,632|`4c9105d8096a58a4cd03d2b44b4522be0102280d379b81db6751ec61d9560f7b`|
|`kilo-windows-x64-baseline.zip`|66,773,865|`7f54381b23c1a9cb7291704a023a3ff96ea15bca35d419c5ba93000f47670e45`|
|`kilo-windows-x64.zip`|66,773,865|`e3b940e0dd50551998deae1c39bc215c6e02eccbf2c53ee997373ef6136b4f9d`|

The known-faulty `v7.4.23-lcm.2` release ID `376067342` and matching tag were removed on 2026-08-26 after `.3` passed
exact publication verification. `.2` was published from candidate `ac853c4c7964cfedb9673528d232af9fbae823a9`,
containing product `5f1f7c7c15facf39fd214f29ca0eb7ef23d64680`, by retained workflow run
[`32793536639`](https://github.com/KertarTheDev/LCM/actions/runs/32793536639). Subsequent 175k-token reference QA showed
that `.2` could not reliably preserve or expose exhaustive evidence after compression: model summaries could omit
structural boundaries, unscoped recovery could match the current recovery turn, and capped grep ranges did not report
an exact total or support source-scoped occurrence paging. A staged summary that never activated could also leave a
legacy durable `preparing` mode. `.3` preserves an ordered exact structural-anchor map across every consumed source,
including the protected recent tail; bounds unscoped recovery before the current turn; adds exact occurrence totals,
source-scoped paging, and seekable byte ranges; repairs stale mode; improves summary provenance and retry behavior; and
exports sanitized summary-attempt evidence. The raw Kilo transcript was never affected. Deletion removed `.2`'s
release assets and tag; its Actions audit history is retained.

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
its Actions audit history is retained.

The separate historical v7.4.1 line still has two published prereleases. `v7.4.1-lcm.1` release ID `350208679` was
published from candidate `ce4d4c059f49295f4b9220d11680d87f71ae1c58`, containing product `e3fa8dccf3`. Its
same-upstream replacement `v7.4.1-lcm.2` release ID `351918329` was published from candidate
`eb88d06a35f7a71adddab905322ef7299507dd79`, containing corrective product commit
`afd5e68ea63213739e29d2884391ad22a1db8c23`, and was independently reverified with all 20 expected assets on
2026-08-26. `.1` could reuse cached thresholds or assembled context after preparation, conversation, strategy,
provider-budget, consumption, overhead, active-context, or rendered-marker authority changed. It also lacked the
replacement's transactional rollback when request-header, snapshot-item, terminalization, or consumption persistence
failed. Those defects could submit stale or inconsistent active context and leave partially persisted provider state;
`.2` binds caches to the complete authority snapshot, rejects drift, and makes those persistence transitions atomic.
Under the one-best-per-upstream policy, exact `.1` release ID `350208679`, tag `v7.4.1-lcm.1`, and candidate
`ce4d4c059f49295f4b9220d11680d87f71ae1c58` are authorized for removal only while the independently verified `.2`
identity above remains published.

An exact retained-release audit on 2026-08-25 found the same retry-lineage implementation in every still-published
LCM prerelease from v7.4.16 through v7.4.22. Under hard context pressure, replacing a retried suffix can erase the
proof-backed consumed prefix, leave no eligible history for maintenance, and make the request fail closed even though
the retained transcript is reducible. These builds remain usable outside that specific long-session retry/recovery
edge case but are the sole retained prerelease for their respective upstream versions. The separate missing
hard-preparation activity record is an observability defect. The exact affected
public identities are:

|Tag|Release ID|Candidate|Product|
|---|---:|---|---|
|`v7.4.22-lcm.1`|`371341991`|`9234be5dc51a3e2e8f5ae52366c90a451b49edfa`|`3e5be03a2b8436587f14dfcbe04ba81366b551a4`|
|`v7.4.21-lcm.2`|`369542832`|`5b0ff9b3618c8d27d1fedb86b9e4d6a253871053`|`b3db0028e4a80804e2b18c595393f0564a2c41be`|
|`v7.4.20-lcm.1`|`365487957`|`682beec3b0b823e3cfee509be358734dc1691845`|`ce062e57f1748bf76070e0cd072792ed3a532ab6`|
|`v7.4.17-lcm.2`|`364019885`|`f44368ca82defa4aeeb2dd822e95b96061132a0a`|`d934b8332a81dacd9617a6a0be8dad362b35f96e`|
|`v7.4.16-lcm.3`|`360907867`|`2cab563d6c58552b9abd4e7b58579cdc7ba39a3a`|`82b79ba06fa892b3e3a778a420992ed67938c68e`|

Keep those exact older releases and tags published because each is the only remaining prerelease for its upstream
version. The v7.4.23 consolidation does not authorize deleting them. Older already-absent faulty releases require no
action.

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

Release notes retain the audit history of superseded builds, but the public release list retains only one verified
best-performing healthy prerelease for each upstream Kilo version. After a same-upstream replacement is independently
verified, this document must identify every exact inferior tag, release ID, candidate SHA, and corrected defect before
deletion. Capture and re-resolve those identities immediately before deleting only that release ID and matching tag.

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
