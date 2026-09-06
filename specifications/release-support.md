# Release support

Status: normative v7.5.15 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.5.15`
(`e0ef9096391ebffba8560875665a2d7249ac6dc5`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

Publish and independently verify replacements before recommending them. Retain healthy older prereleases: publication
alone never authorizes deletion. A differently tagged replacement may remove a previous build only with separate
authorization or when this document already names its exact tag, release ID, and known defect. Retain Actions audit
history. Never select a deletion target from `latest` or tag ordering; capture and re-resolve its tag, release ID, and
candidate SHA immediately before an authorized deletion.

The published v7.5.15 port adapts the accumulated v7.5.9 LCM implementation through
`fdc590135bc8c909ecad14371411c8235a283a92` directly to the new tag without replaying its commit history. The 60%
threshold remains a cost-informed research starting point, not a proven optimum. Upstream shared boards, provider
headers, native-plan permissions, and continued subagent execution after permission denial remain upstream-owned.
Board tools and notifications remain unavailable to both hidden recovery phases; ordinary agents retain board
support. Upstream single-turn pruning remains available to ordinary sessions while hidden recovery keeps its exact
transcript bypass. Verified release evidence and the asset manifest follow below.

The subsequent v7.5.15 corrections restore general-purpose task decomposition. Exhausting memory queries no longer
removes ordinary tools, forces a final answer, or ends the parent turn. The focused recovery question is the trusted
assignment throughout retrieval, private inference, and finalization; the surrounding user task is context only.
Independent questions, including prerequisite lookups, may use the configured allowance after full, partial, empty,
or failed recovery and may reserve it in parallel. Normalized duplicates, actual child-start and attempted-call
budgets, cancellation, and private evidence isolation remain enforced. Optional preceding bounded results are inert
context rather than mandatory narrower-follow-up assignments. The obsolete lexical admission guards and answer-only
parent controls have been removed.

Focused recovery, tool-contract, prompt-seam, and live ordinary-tool-continuation tests verify these corrections.
The 60% threshold and existing user-configurable recovery defaults remain unchanged pending further evidence.
No new hosted-model quality result is claimed. The chronological research records below describe their exact older
source revisions; superseded admission rules in those records are historical findings, not the current contract.

The first v7.5.15 canonical candidate passed the LCM/adaptation and overlay gates but failed the opencode typecheck
before version selection or draft creation. A semantic-query error branch inferred its reason as `string` instead
of the existing `cancelled | provider_error` union. The correction explicitly binds that branch to the existing
semantic result type without changing runtime behavior. Focused tool contracts and the corrected canonical
typecheck pass.

The current public prerelease is [v7.5.15-lcm.1](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.15-lcm.1),
release ID `383480404`, published on 2026-09-06 from candidate `db58dc86efafe939c6f0dad26e797c87824c9e0e`
containing product `88c4db6b45d649e52533b58b2c948541cfdd1669`.
[Exact-SHA workflow 34014557476](https://github.com/KertarTheDev/LCM/actions/runs/34014557476) succeeded:
LCM/adaptation checks, exact 27-path overlay, affected-package typechecks, stable contract generation, all 12 CLI
and eight VSIX builds, and packaged Linux x64 Conversation Memory smoke passed. Unrelated upstream publication
jobs were skipped. Independent REST verification confirmed the non-draft prerelease, resolved tag/candidate SHA,
exact nonempty 20-asset profile, and byte-equivalent reviewed release-note body after outer whitespace normalization.
Healthy older releases were retained; no release or tag was deleted. No new hosted-model benchmark was run for this
port, and neither the 60% threshold nor recovery defaults are claimed optimal.

GitHub-reported published asset manifest:

|Asset|Bytes|SHA-256|
|---|---:|---|
|kilo-darwin-arm64.zip|52544681|afdeec772832b563e81d7c71d0403363d59e09f841fca8b55a51fd284934fd87|
|kilo-darwin-x64-baseline.zip|54803267|3181add0ea5fa461071004d561e5b1abab5a0aaecff2d9ae5d25bad1f1bc6c44|
|kilo-darwin-x64.zip|54803267|e10b1ad3a8af6588918d26419b65aa3de2e1066d6d8ec88e556851249cc123ad|
|kilo-linux-arm64-musl.tar.gz|69320399|f4043519b52157a0078d6f2e493529809d8011b675da78fc28756755762eebc2|
|kilo-linux-arm64.tar.gz|67206669|aafc38139cd69d671cb3989268cdb0f14c6b88ea42dcc5b3ef972cc586ed4be2|
|kilo-linux-x64-baseline-musl.tar.gz|69808493|ea2c3ef697dcbe442e4c6b519f7eb7380a594b2c0fc73adff97034fc1d45defd|
|kilo-linux-x64-baseline.tar.gz|67443012|985a36bd16438beff8e2cf4d56500460914fd2e936035050f9b35fe4d19e8937|
|kilo-linux-x64-musl.tar.gz|69808035|609034b35f8b7bb6cdf35dbd99a5e11b4077d6a7fa30c38102419f5d4603ec98|
|kilo-linux-x64.tar.gz|67442988|32c42c741d5daae2541a4923ae7545501b64f8fcf45d7470b99d9fe38eda4f63|
|kilo-vscode-alpine-arm64.vsix|118919493|8c0f1bb9944ce3c3ed5256afc2a7b1d231cbf9ced435f2ca606e7ee03a2ec85c|
|kilo-vscode-alpine-x64.vsix|126131192|cdffc7e6802f91eac70d553a35835fda37eaee7f02e6381700678f87a9a2e399|
|kilo-vscode-darwin-arm64.vsix|101658925|0ced7a16b009e5c24fcbe723139403b56824aedcb2483e43139309f4acbc3317|
|kilo-vscode-darwin-x64.vsix|109724657|5fc01f764313d4806f44b0cdf2a446802a9662ec43b4638788875ef5ed2bd6fc|
|kilo-vscode-linux-arm64.vsix|116762029|cfc556df41211087d589f52158d05e6210c202fe72132b9b5c9bc8a41e19a956|
|kilo-vscode-linux-x64.vsix|123702848|f43ded4b1d054796eca1a23e881e573d909dcf3d209023ebeab2e1083b7cd34d|
|kilo-vscode-win32-arm64.vsix|98531773|29d784bf9d4e2e03b8c3d37c0d9abc05d21ba1b43eae7375cec91c983add62de|
|kilo-vscode-win32-x64.vsix|122573294|ebc26a11aecd1afd4238b62cde0566123a091172082ac462daacf75d48af343a|
|kilo-windows-arm64.zip|65130442|05fa6885cf8c426152a3a75a2329fc6482e2d4de3bc358058f94402776e24c0d|
|kilo-windows-x64-baseline.zip|66802703|b41c5d6316655e7264f05b77bea89df85801c65fbe2d28460a864f6fd1a89854|
|kilo-windows-x64.zip|66802703|535857d01f75572b615a6409eb3854b9a5f3eee3d2058804689cddb089812a8e|

The retained previous public prerelease is `v7.5.9-lcm.1`. It was published on 2026-09-03 from candidate
`58dfd2fa193b724f9dedc161bef10e122c1962c9`, containing verified product
`5e7df6a67c55e5c43c2bbbb488df9c7eea2e7b0d`. Exact-SHA workflow run
[`33737939477`](https://github.com/KertarTheDev/LCM/actions/runs/33737939477) completed successfully. Its LCM job
proved exact 27-path overlay ancestry, the focused v7.5.9 adaptation suites, all affected-package typechecks, stable
second contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime
isolation; unrelated upstream version, build, validation, and publish jobs were skipped. Release
[`381892341`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1) is a non-draft prerelease whose tag resolves
to the candidate SHA. Its published body describes the direct v7.5.9 port, the model-neutral isolated `lcm_query`
contract, the 60% default as a cost-informed research starting point, the honest retained 175k limitations, and the
schema-v14/tree-v11 disposable-cache rebuild. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,468,333|`a50992f938ba8a8f9def18d6ee270e6ea376269c569bbeb496ca931fdad6455e`|
|`kilo-darwin-x64-baseline.zip`|54,727,246|`6e732b35d2ea87cf0621dd00bd19531d29a25b8d21f44ee5b493732d848697a8`|
|`kilo-darwin-x64.zip`|54,727,246|`155e67f8c924f6e88cceae048e375019d37ef508aa2ceec6043e6cca02b84692`|
|`kilo-linux-arm64-musl.tar.gz`|69,246,071|`54911575e74ac8c368c36577b2fa1f6cf302d992323271d6c41400e8b98bfc9b`|
|`kilo-linux-arm64.tar.gz`|67,130,967|`fd079ebc09bcde823c04401f9a073cae94e6ad9086ce958d1a7f52e167f2355c`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,737,897|`a08965c378f2cf0ef63b0e1a48f5f7e7bbe0f9060b0d0bdda070519a9e91da78`|
|`kilo-linux-x64-baseline.tar.gz`|67,374,095|`8e0bda3bff42d7eee8867682adec45d0859ef88cd8e250767ef5c3f95dd74b80`|
|`kilo-linux-x64-musl.tar.gz`|69,737,059|`9b258de315135a01644f3007d4414e9b49e0b58572d780553b4b60ae98263c92`|
|`kilo-linux-x64.tar.gz`|67,374,150|`589bab56a70529115c1ced592e8a23bd1d3196b67d99f01b295dc5c8a143ed00`|
|`kilo-vscode-alpine-arm64.vsix`|118,699,502|`144c9bd20c707798a300922c7079ba680739c90c3f127e5153df9a9078e00852`|
|`kilo-vscode-alpine-x64.vsix`|125,909,208|`fa0eec14ab31905ac829abcf68ade65949de85f1beaf88a9f3ee9e67e336f317`|
|`kilo-vscode-darwin-arm64.vsix`|101,438,688|`b4ccb19ec7f7206ff1692238735be81d7b8b38dc81f1d1e94f14f6a1a97290a2`|
|`kilo-vscode-darwin-x64.vsix`|109,504,538|`f82b7cfd697f272f0abb645f1c31fcd77eced2d9377e01b7cd42d8d880f01ef7`|
|`kilo-vscode-linux-arm64.vsix`|116,538,756|`d2ab96fe146fdfad1041c5030e23fed7762df2a8f18d304a6965f198c33de782`|
|`kilo-vscode-linux-x64.vsix`|123,481,304|`3c9ecfb30d88e54efded209693db7b83a07700aea1e146e03d5c56628fa80773`|
|`kilo-vscode-win32-arm64.vsix`|98,313,134|`93c8d3c847d94aa9a1a4145a9c172b255721c0e15bdc1c3a1c2e17692a857f0d`|
|`kilo-vscode-win32-x64.vsix`|122,354,053|`e2337b20f202e933be568056086aaca9823bdfad5f3fa1dc391db4c3456c3d81`|
|`kilo-windows-arm64.zip`|65,055,832|`557653055b1923ff45edcae4f56c881f6ba3e66f2bdcbd4a82ab613bb2333648`|
|`kilo-windows-x64-baseline.zip`|66,728,886|`8693016b51ec3af211be17de3b6ef833b1ac00524e0011c88c937b9f3255703e`|
|`kilo-windows-x64.zip`|66,728,886|`aa1b94c55b9197d2c40c0ff9e243cd1732096af66862c2c9a5da5198d9946d42`|

The product is rebuilt directly on upstream tag `v7.5.9`; no old LCM commit history was replayed. It reuses upstream
compaction-model selection, incomplete-response retry/output caps, per-user editor-context stability, and the newer
drain/cancel/background/queue lifecycle while retaining LCM's separate exact-lineage tree and isolated current-session
recovery. The default `conversation_memory.soft_threshold_percent` is 60%. No new full benchmark was run for this
port; the next research phase resumes from that default with controlled canaries before another expensive full run.

The current unreleased continuation includes all recovery implementation summarized below; product commit
`9b4d444a15e78c9e40702a8afc5362635ddc3358` is the latest source-attested benchmark checkpoint, while
`40942f0e0d315dbe722319a253ac417777527077` is the current unbenchmarked recovery-contract continuation. Changes
after the public release-evidence commit add
trusted question semantics and prompt isolation, bounded and validated dynamic semantic sharding, negative-result
normalization, independent reduction audits and disagreement handling, evidence-bearing finalization, atomic
semantic-budget accounting, host-owned coverage ceilings, directional evidence localization, clipped structural
coverage, question-aware citation relevance, ranked recovery over complete exact units whose preliminary evidence
view was clipped, host-side ordering of exact-quote-bound event records, an unambiguous final structural response
schema, active-revision semantic-scope deduplication, serialized result-informed child handoff, and narrower
partial-boundary follow-up guidance. Later changes also preserve failed and conflicting pass evidence, make repair
shards inspect uncertain ordinal boundaries, retain bounded inward and edge scopes for omitted-candidate checks, and
keep hidden recovery transcripts outside their own LCM capture/projection path. A failed broader cross-child scope
ledger and a coarser shard experiment were reverted after negative canaries. These changes preserve the
one-public-query/five-private-primitive isolation contract and do not encode a provider, model, threshold, benchmark
term, or expected answer.

A source-identical 118k LCM-off control at product source `e830f484d461556c8cf4d94eba7e673a77d5b7fb` completed
without task, provider, product, or resource failure but scored `0` on the spell-order question. Its one automatic
legacy compaction retained a 2,051-character summary that named `Alter Self` but did not preserve the requested cast
order. Upstream active-session recall then returned one truncated 51,649-character read; the model repeated the same
`Control Water` search ten times and answered `Grasping Vine`. This contrasts with the LCM worker's exact ordered
reconstruction while showing that raw availability alone does not make recovery efficient. The control also exposed
that oversized legacy compaction deleted temporary chunk/reduction messages without transferring their provider usage
to the retained summary, leaving one real model call and its non-empty output recorded as zero tokens. The current
continuation accumulates every such worker's input, output, reasoning, cache, and cost onto that summary, including
oversized replay work, so subsequent LCM-on/off price comparisons can count the complete lifecycle.

The corrected off-only repeat at accounting-fix source `375e9be529cdc2d108510452388a335030a4259a` again scored
`0` and answered `Grasping Vine`. The retained legacy summary now accounts for 57,741 fresh-input, 54,400 cache-read,
and 3,154 output tokens across its deleted workers. Complete off-mode setup and answering used 279,285 fresh-input,
553,600 cache-read, 832,885 logical-input, and 3,567 output tokens. The model used one broad 51,648-character truncated
active-session recall read and still omitted the correct ordered sequence. The earlier behavior-identical LCM path
scored `1.0` with 566,786 fresh-input, 609,600 cache-read, 1,176,386 logical-input, and 5,092 output tokens; its hidden
worker recovered the missing `Water Breathing`, `Beast Shape`, `Alter Self` order and returned only three short exact
citations. This single controlled question therefore demonstrates a real quality gain at higher token cost, not an
aggregate price-performance result or a reason to run the full benchmark yet.

The exact-source `47cf2334acc0bcf4739113360bbb830c2fd151e6` canary used qwen3.8 with 100,000 input tokens,
4,096 output tokens, temperature zero, the 60% threshold, two parent queries, 12 research steps, 24 primitive calls,
and 32 semantic inferences. It scored `0.50` on the retained cross-episode question and completed without a task
failure, product finding, provider retry, fallback, legacy compaction, or resource stop. The complete lifecycle used
1,555,430 fresh-input tokens, 536,000 cache-read tokens, 2,091,430 logical-input tokens, 17,422 output tokens, and 79
provider calls. Its snapshot frame contained 35,664 active tokens: 8,351 summary, 17,725 raw-lane, and 9,588 fixed
input tokens. Exact context inspection found both missed values in the supplied summary/raw evidence, so those errors
were interpretation failures rather than irreversible compaction loss. A verbose answer could still attach a genuine
excerpt by matching only an actor or context word copied from the focused question. Commit `b8742e7ddb` therefore
requires an answer-specific phrase, distinctive long answer word, or sole remaining answer anchor while retaining the
existing numeric/computed-answer behavior. Its final 36-test isolated-recovery gate passed with 316 assertions; the
complete 86-test tool/isolation suite, registry/permission tests, documentation authority, public contracts, and
annotation audit also pass. Parameter canaries remain research evidence; no post-`.1` release has been published.

The source-pinned semantic-ceiling ablation at product source
`0b577b75e6436a76cab0d3efffe04c33ecf2f4b5`, run group
`qwen38-v759-0b577-c100-t60-r12-t24-s64-canary-20260904`, changed only the configured private semantic ceiling from
32 to 64. It scored `0.25` and used 1,245,816 fresh-input tokens, 203,200 cache-read tokens, 1,449,016 logical-input
tokens, 16,249 output tokens, and 60 provider calls across the complete lifecycle. The single hidden child still used
exactly 32 semantic inferences: the four complete-unit hierarchies required `8 + 8 + 9 + 7`, and the agent made no
additional semantic call despite the unused capacity. Its snapshot had the same 17,725-token raw lane as the prior
semantic-32 run; only the generated summary varied, from 8,351 to 9,014 tokens, while the decisive correct facts
remained available. The lower cost resulted from one rather than two parent queries, not from the larger ceiling.
Semantic 64 is therefore rejected as a default candidate: it changed neither the executed recovery plan nor evidence
availability and did not improve quality.

Two source-identical threshold canaries at product source `09e37fbfd760cdc49e44cb2b4c34ff80e22165e6` retained the
same recovery profile while changing only `soft_threshold_percent`. The 70% run scored `0.75` and used 1,234,626
fresh-input tokens, 272,000 cache-read tokens, 1,506,626 logical-input tokens, 15,306 output tokens, and 61 provider
calls. The 80% run returned the same answer and score but used 1,757,717 fresh-input tokens, 593,600 cache-read tokens,
2,351,317 logical-input tokens, 25,619 output tokens, and 81 calls after taking a second hidden query and an empty-stop
technical continuation. Both post-ingestion frames retained the exact same 17,725-token protected raw lane and ten
summary roots; the active totals differed only because independently generated summaries were 9,074 and 9,477 tokens.
The earlier 60% canaries retained that same raw frontier. This sample therefore did not create a meaningful
threshold-dependent context difference, and its score/cost variance cannot justify changing the 60% default. A future
threshold comparison must first select a context whose projected frontier actually differs; no full benchmark is
justified by these canaries.

The shipped-default 118k ordered-detail canary then showed that one child research step was insufficient, while a
moderate two-query/eight-step/16-tool/16-semantic profile still performed zero semantic inferences because the
host-verified 304,606-byte unit exceeded the preliminary evidence cap. Commit `36609e3963` retains deterministic
behavior for an unverified clipped scope but lets a complete host-verified unit build its hierarchy from every exact
source range. It also generalizes directional selection to bounded Nth-from-start or Nth-from-end questions without
confusing a document ordinal with the requested event ordinal. The focused regression, 50-test tool contract suite,
complete LCM tools gate, prompt/maintenance tests, documentation check, and public-contract check pass.

The source-pinned post-fix canary used that same moderate profile and completed without a task failure, product
finding, provider retry, fallback, legacy compaction, or resource stop. Both admitted children now executed the exact
ten-shard-plus-reducer-plus-auditor plan, reporting 12 semantic inferences apiece despite a clipped preliminary view.
The final `Chain Lightning` answer still scored `0`, but the first child explicitly retained `Alter Self` as the
alternative when the failed `Call Lightning` attempt is excluded, and the second child returned exact early-event
evidence. The remaining disagreement concerns the benchmark's unstated treatment of failed and item-mediated casts,
not missing raw detail or a disabled hierarchy. Complete setup and answer work used 1,149,406 fresh-input, 651,200
cache-read, and 17,974 output tokens across 52 provider calls. This validates the architecture correction but is too
ambiguous and expensive to select recovery defaults; a different source-grounded canary must discriminate settings
before a full benchmark.

That discriminator used a different 119k context and asked for the first spell in its second structural episode. One
hidden child recovered `Polymorph`, established the exact quote “I'm going to Polymorph into an eagle,” and returned
one 36-byte host-verified citation; the parent also answered `Polymorph`. The stored numeric score is nevertheless `0`
because its tagged answer added an unrequested caster parenthetical and the official exact scorer correctly compared
the complete tagged value rather than searching it for the gold substring. This is a semantic LCM success and a
benchmark-output-contract failure, not a reason to weaken scoring or repeat the provider run. Complete setup and
answer work used 576,133 fresh-input, 537,600 cache-read, and 5,208 output tokens across 23 provider calls. The child
used eight research primitives and one nested semantic inference, so an eight-step/16-tool profile is sufficient for
this complete single-pass unit but does not yet establish a default for longer hierarchical units.

The next source-identical 118k ordinal canary, run group
`qwen38-v759-ba2e-h7ba7-c100-t60-q2-r8-t16-s16-118k-thirdspell-episode1-canary-20260904`, exercised host-side ranked
event selection at product source `ba2e200a39`. It completed without a task, provider, product, fallback, legacy
compaction, or resource failure but answered `Light` instead of `Lightning Bolt` for score `0`. The post-ingestion
frame retained exactly the same 55,042 raw-lane tokens, nine raw items, 32,176 eligible raw tokens, and 22,866
protected raw tokens as the preceding source-identical successful canary. Its four summaries used 3,104 rather than
3,597 tokens; the new summary explicitly named `Lightning Bolt`, while neither summary set preserved the earlier
`Wall of Stone`, `Prestidigitation`, `Lightning Bolt` ordering. The exact raw source retained all three events. The
quality difference was therefore inside recovery, not caused by a different active raw frontier or irreversible
compaction loss.

The two hidden children remained isolated and ran three complete six-shard-plus-reducer-plus-auditor attempts, or 24
nested semantic calls. Twelve positive phases omitted the newly required structured `events` array, two returned no
JSON object, one returned malformed JSON, and two valid negative/no-answer passes could not override surviving later
candidates. Early-shard evidence was consequently rejected while late-episode candidates survived. The first child
correctly returned only partial coverage; the second manually reconstructed `Lightning Bolt`, `Alter Self`, `Light`
and led the parent to the wrong third item. The failure exposed a general prompt-contract contradiction: the generic
query prompt said to finish immediately after answer, citations, and optional evidence, while the later structural
mode required an additional event map. Product commit `661c81ad13` removes that premature completion instruction and
ends every shard, reducer, and auditor prompt with the same explicit positive and negative JSON shapes whose `events`
array is always required. Missing event maps still fail closed as partial rather than weakening host verification.

Complete setup and answer work used 1,087,472 fresh-input, 697,600 cache-read, 1,785,072 logical-input, and 16,286
output tokens across 53 provider calls. At the stated official price assumption this is approximately `$2.447060`;
the CodeOnTime endpoint charged zero. The prompt-policy test passed with 103 assertions, the 50-test tool-contract
suite passed with 335 assertions, the complete 86-test tools/isolation gate plus four registry/permission tests
passed, and documentation and public-contract checks passed. This negative result blocks parameter reduction and a
full benchmark until the exact-source canary validates the corrected response contract.

The source-identical corrected-contract canary, run group
`qwen38-v759-c942-h7ba7-c100-t60-q2-r8-t16-s16-118k-thirdspell-schema-canary-20260904`, then answered `Lightning Bolt`
exactly for score `1.0`. It completed without a task, provider, product, fallback, legacy-compaction, or resource
failure. Its post-ingestion frame retained the same 55,042-token raw frontier, nine raw items, 32,176 eligible raw
tokens, and 22,866 protected raw tokens as the preceding failure, plus 4,109 summary and 9,607 fixed tokens. The
quality change therefore occurred inside recovery rather than through a different exact-detail frontier. The parent
received only bounded child results; two actual children ran, the attempted third query was rejected by the configured
allowance, and a technical empty-stop continuation produced the exact value-only answer.

Complete lifecycle work used 1,137,009 fresh-input, 811,200 cache-read, 1,948,209 logical-input, and 18,780 output
tokens across 56 provider calls. At the stated official cached-input price assumption this is `$2.589498`; the
CodeOnTime endpoint charged zero. Across the three long semantic hierarchies, 19 of 24 nested phases returned valid
schema-conforming results, and the second child combined exact grep/read evidence into `Wall of Stone`,
`Prestidigitation`, and `Lightning Bolt`. This validates the corrected response contract and the isolated evidence
handoff, while remaining one canary rather than an aggregate quality claim.

Trace inspection also found that the first child ran two semantically identical hierarchies over the same active
revision, exact unit, ordered ranges, direction, and rank after changing only its model-written query text. The second
hierarchy did not resolve that child and spent eight provider calls, 117,950 fresh-input tokens, and 1,251 output
tokens, or `$0.243406` at the same official price assumption. Product commit `3e0fdba59e` atomically reserves that
host-resolved semantic identity per child, suppresses equivalent sequential or parallel calls without another nested
inference or coverage regression, and permits an exact retry only after provider failure or cancellation while
retaining started-work accounting. Its final 87-test tools/recovery gate passed with 665 assertions, four
registry/permission isolation tests passed with 36 assertions, and the API, documentation, and public-contract gates
passed in verifier artifacts `.artifacts/vps-verification/2026-09-04T21-28-50-390Z-focused-opencode`,
`.artifacts/vps-verification/2026-09-04T21-36-10-036Z-focused-opencode`,
`.artifacts/vps-verification/2026-09-04T21-30-05-346Z-focused-opencode`, and
`.artifacts/vps-verification/2026-09-04T21-30-14-054Z-focused-opencode`. A source-identical canary on this commit is
the next gate before reducing recovery budgets or starting a full benchmark.

That source-identical canary, run group
`qwen38-v759-6f9-h7ba7-c100-t60-q2-r8-t16-s16-118k-thirdspell-scope-dedup-canary-20260904`, completed cleanly but
answered `Light` for score `0`. It retained the same 55,042-token raw frontier, 32,176 eligible raw tokens, and 22,866
protected raw tokens as the preceding exact-answer run; its 4,094 summary and 9,610 fixed tokens produced a 68,746-token
active frame. It used 1,023,138 fresh-input, 798,400 cache-read, 1,821,538 logical-input, and 11,634 output tokens across
47 provider calls, or `$2.315680` at the stated official cached-input price assumption; CodeOnTime charged zero. Neither
child repeated a semantic identity, so the canary did not exercise the new suppression and its lower cost cannot be
credited to that change. The first child's host-provided boundary covered the complete early unit, but its subsequent
model-authored grep scope truncated that unit before `Lightning Bolt`. The second child recovered `Lightning Bolt` and
`Alter Self` but returned the incomplete order `Lightning Bolt`, `Alter Self`, `Light`.

Trace review then exposed a separate general recovery-contract defect: the host allowed supposedly narrower child
queries to start as parallel siblings before the first bounded result existed, and a later sequential child received
neither that result nor its named unresolved gap. Product commit `c363e5b494` serializes actual child starts, returns a
non-terminal no-child receipt to parallel siblings without spending the allowance, prevents another child after full
coverage, and places the preceding bounded parent-visible result—not the private child transcript—inside a later
follow-up's inert evidence handoff. The follow-up must investigate only its newly focused unresolved gap. The complete
87-test tools/recovery suite and four registry/permission isolation tests pass in verifier artifact
`.artifacts/vps-verification/2026-09-04T22-23-34-127Z-focused-opencode`; documentation and public-contract gates pass in
`.artifacts/vps-verification/2026-09-04T22-22-36-589Z-focused-opencode` and
`.artifacts/vps-verification/2026-09-04T22-22-41-394Z-focused-opencode`. A source-identical canary on this correction is
required before recovery-limit optimization resumes.

The source-identical result-handoff canary, run group
`qwen38-v759-862-h7ba7-c100-t60-q2-r8-t16-s16-118k-thirdspell-result-handoff-canary-20260904`, used product source
`862747acf1` and returned exact `Lightning Bolt` for score `1.0`, with no task, provider, product, fallback, legacy
compaction, or resource failure. The post-ingestion context retained the same 55,042 raw-lane, 32,176 eligible raw,
and 22,866 protected raw tokens as both preceding canaries. Its 3,755-token summary was shorter and less useful for the
question than either preceding summary: it named stored `Lightning Bolt` but omitted the early `Wall of Stone`,
`Prestidigitation`, `Lightning Bolt` order. The answer therefore came from exact isolated recovery rather than improved
summary content.

The first child returned bounded partial `Lightning Bolt`, one exact citation, and two candidate ambiguities. Only
after that result existed, the parent asked a focused question about those ambiguities. The second child prompt
contained the preceding 2,570-character parent-visible result inside the inert evidence boundary and contained none of
the first child's private transcript; it preserved `Lightning Bolt`, reconstructed the first four casts, and returned
three exact citations. The parent received 6,745 characters across the two bounded outputs, while the child evidence
and working transcripts remained isolated. Complete setup and answer work used 1,024,930 fresh-input, 563,200
cache-read, 1,588,130 logical-input, and 15,790 output tokens across 44 provider calls. At the stated official price
assumption this is `$2.285400` with cache discounts or `$3.271000` with all input treated as fresh; CodeOnTime charged
zero. Compared with the preceding exact-answer canary, this saved 12 calls, 360,079 logical-input tokens, and
`$0.304098` under the cached assumption. The second child still used eight whole-unit semantic inferences because the
clipped-structural-scope workflow is unconditional; treat narrowing that work as a separate optimization question, not
as a proven benefit of the handoff fix.

Product commit `4fabb6c638` corrects that remaining workflow contradiction without weakening initial recovery: the
first child must still resolve every clipped exact unit, while a result-informed follow-up preserves the preceding
bounded facts and checks only its materially narrower named gap. An exact candidate or boundary uses host-verified
candidate evidence or one bounded grep/read before another semantic pass; new semantic inference must cover a genuinely
narrower trusted unit or range. The 87-test tools/recovery suite and four registry/permission isolation tests pass in
verifier artifact `.artifacts/vps-verification/2026-09-04T22-59-53-864Z-focused-opencode`; documentation and
public-contract gates pass in `.artifacts/vps-verification/2026-09-04T23-04-01-027Z-focused-opencode` and
`.artifacts/vps-verification/2026-09-04T23-04-07-293Z-focused-opencode`. A source-identical canary must now prove that
the second child avoids the redundant whole-unit hierarchy without losing the exact answer before recovery-limit or
threshold optimization resumes.

The source-identical canary on that commit, run group
`qwen38-v759-9b3-h7ba7-c100-t60-q2-r8-t16-s16-118k-thirdspell-narrow-followup-canary-20260904`, retained the same
55,042-token raw frontier, 32,176 eligible raw tokens, and 22,866 protected raw tokens as the preceding three runs. Its
4,275-token summary was larger than the preceding successful run's 3,755 tokens, so context inspection again excludes
raw-frontier loss as the cause. The run completed without task, provider, product, fallback, legacy-compaction, or
resource failure but answered `Prestidigitation` instead of `Lightning Bolt` for score `0` and started only one hidden
child, so it did not exercise the intended result-informed second-child behavior.

That child used one six-shard/reducer/auditor semantic hierarchy plus five exact primitives. The hierarchy retained
`Wall of Stone`, `Prestidigitation`, and `Light` as host-verified candidates but missed the intervening `Lightning Bolt`;
both reducer and blind auditor returned invalid no-answer results, leaving partial coverage. Although the `Light`
candidate carried a complete multi-range earlier boundary, the child read and searched only the prefix ending near
`Prestidigitation`, claimed full coverage, and was correctly host-downgraded to partial. The parent then treated that
partial candidate as exact instead of using its available narrower follow-up. Complete lifecycle work used 699,344
fresh-input, 528,000 cache-read, 1,227,344 logical-input, and 7,421 output tokens across 31 calls, or `$1.575214` under
the official cached-price assumption; CodeOnTime charged zero. The lower cost accompanied the wrong answer and is not
an efficiency win.

Product commit `d89c762070` corrects both general guidance gaps without raising any configured ceiling. A partial
first/last/Nth/count/list semantic result may use one genuinely narrower host-provided boundary in `lcm_expand_query`
when lexical search or a single-range read cannot exclude omitted or paraphrased events; it may not infer completeness
from a prefix-only read. In the parent, a partial result with an unresolved exact/count/ordered boundary cannot be
presented as exact unless independently visible active context closes the entire named gap, so the available narrower
follow-up must run first. The 87-test tools/recovery suite plus four registry/permission isolation tests passes in
`.artifacts/vps-verification/2026-09-04T23-27-59-212Z-focused-opencode`; documentation and public-contract gates pass
in `.artifacts/vps-verification/2026-09-04T23-29-07-462Z-focused-opencode` and
`.artifacts/vps-verification/2026-09-04T23-29-20-046Z-focused-opencode`. Another source-identical canary is required
before either recovery-limit or threshold optimization resumes.

The source-pinned canary on product commit `6a7f776cb2`, run group
`qwen38-v759-6a7-h30fac-c100-t60-q2-r8-t16-s16-118k-thirdspell-replay-guard-canary-20260905`, used harness v69 at
parent source `30fac3852a`, the unchanged 100,000/4,096 model limits, temperature zero, 60% threshold, and
two-query/eight-step/16-tool/16-semantic recovery profile. It returned exact `Lightning Bolt` for score `1.0` with no
task, product, provider, resource, fallback, or legacy-compaction failure. Its post-ingestion frame retained the same
nine raw items, 55,042 raw-lane tokens, 32,176 eligible raw tokens, and 22,866 protected raw tokens as the preceding
source-identical canaries. Two hidden children ran; the first used eight semantic inferences and the result-informed
second used one. Harness v69 preserved the original question's allowance across technical continuations, so the
parent made no third query attempt.

Complete lifecycle work used 636,664 fresh-input, 652,800 cache-read, 1,289,464 logical-input, and 10,005 output tokens
across 32 provider calls. At the stated official price assumption this is `$1.496558` with cache discounts or
`$2.638958` with all input fresh; CodeOnTime charged zero. The result is materially cheaper than the earlier exact
result-handoff canary, but one sample cannot assign all savings to one implementation change.

Product commit `925ae959cf` then tested a broader cross-child semantic-scope ledger. Its source-identical run group
`qwen38-v759-925-h30fac-c100-t60-q2-r8-t16-s16-118k-thirdspell-crosschild-replay-guard-canary-20260905` proved that
the new suppression executed: the first child used eight semantic inferences, while the second child's five-range
superset used zero. Neither bounded child result recovered `Lightning Bolt`, and the parent returned a wrong
exact-tagged answer for score `0`, without a task, product, provider, resource, fallback, or legacy-compaction failure.
The run used 634,138 fresh-input, 779,200 cache-read, 1,413,338 logical-input, and 9,072 output tokens across the same 32
provider calls, or `$1.517508` with cache discounts and `$2.881108` with all input fresh. The broader guard therefore
cost slightly more and removed useful recovery work rather than improving efficiency.

Product commit `6b142ee195` reverts that broader ledger. The rejected canary demonstrates that overlapping exact raw
ranges across hidden children do not establish equivalent semantic work when the locked questions differ. The
committed product retained identical normalized parent-question rejection and per-child semantic-scope single-flight
while the contract boundary was reviewed.

After explicit authorization to make recovery changes that prevent irreversible detail loss in very long sessions,
product commit `8e56684ee3` removes the remaining result-informed complete-unit veto. A later child has a distinct
locked semantic question and may therefore interpret the same exact unit when its narrower gap requires it; equal raw
bytes do not establish equal semantic work across different questions. Identical normalized parent questions still
cannot start another child, result-informed guidance still forbids restarting the broad plan, and equivalent semantic
scopes remain single-flight within each child. The new child-local regression plus the complete 51-test tool-contract
and 37-test isolated-recovery suites pass in verifier artifacts
`.artifacts/vps-verification/2026-09-05T01-42-09-906Z-focused-opencode` and
`.artifacts/vps-verification/2026-09-05T02-07-17-350Z-focused-opencode`. Documentation and public-contract gates pass
in `.artifacts/vps-verification/2026-09-05T02-07-34-572Z-focused-opencode` and
`.artifacts/vps-verification/2026-09-05T02-07-36-011Z-focused-opencode`. A source-pinned canary on the exact product
commit is the next gate before recovery-limit or threshold optimization resumes.

That source-pinned canary, run group
`qwen38-v759-f5f-h30fac-c100-t60-q2-r8-t16-s16-118k-thirdspell-question-scoped-canary-20260905`, used product source
`f5f6509c96`, harness v69, the unchanged 100,000/4,096 model limits, temperature zero, 60% threshold, and
two-query/eight-step/16-tool/16-semantic recovery profile. It completed without task, product, provider, resource,
fallback, or legacy-compaction failure but returned `Gust of Wind` instead of `Lightning Bolt` for score `0`. The
post-ingestion projection retained the source-identical nine raw items, 55,042 raw-lane tokens, 32,176 eligible raw
tokens, and 22,866 protected raw tokens, so compaction did not remove the decisive source.

Both permitted hidden children ran. The second evidence-bearing child found the decisive exact bytes and persisted a
host-valid structured draft containing `Lightning Bolt`, but claimed full coverage after clipped evidence. The host
therefore forced a second same-transcript synthesis step. That step returned partial `Gust of Wind`, and only the
newest result reached the parent even though the earlier supported candidate remained in the isolated transcript and
immediate ledger. Complete lifecycle work used 1,203,729 fresh-input, 440,000 cache-read, 1,643,729 logical-input, and
9,969 output tokens across 38 provider calls, or `$2.577272` with cache discounts and `$3.347272` with all input fresh;
CodeOnTime charged zero.

Product commit `5560535a2b` fixes this general lossy handoff. A host-valid bounded answer now returns unchanged while
host-known clipped, conflicting, or incomplete evidence deterministically downgrades its coverage to partial and
adds the exact gaps. Same-transcript synthesis remains only for an absent or invalid evidence-bearing submission, and
its gap prompt no longer invents a prior full-coverage draft when none exists. This does not change the threshold,
model, benchmark vocabulary, isolation boundary, citation bounds, or configurable worker ceilings. The affected
47-test recovery/prompt-seam selection, complete 88-test tools/recovery suite, four registry/permission isolation
tests, 33-test projection suite, documentation check, and public-contract check pass in verifier artifact
`.artifacts/vps-verification/2026-09-05T02-41-25-672Z-focused-opencode`. A source-pinned recovery canary remains
required before the first post-correction 175k canary.

The same source-pinned validation on product source `bf934e504e`, run group
`qwen38-v759-bf9-h30fac-c100-t60-q2-r8-t16-s16-118k-thirdspell-preserve-answer-canary-r2-20260905`, confirmed the
new handoff behavior but did not recover the gold answer. It completed without task, product, provider, resource,
fallback, or legacy-compaction failure and returned `Wall of Stone` instead of `Lightning Bolt` for score `0`. The
post-ingestion projection again retained nine raw items, 55,042 raw-lane tokens, 32,176 eligible raw tokens, 22,866
protected raw tokens, 3,509 summary tokens, and 9,750 fixed-input tokens.

Both permitted children returned their first host-valid structured submission directly with host-downgraded partial
coverage. No same-transcript synthesis or fresh repair child ran, and ordinary parent question calls fell from five in
the preceding canary to three. The first child used eight nested semantic inferences and the result-informed second
used two. Exact private grep evidence and one host-verified semantic candidate interval contained `Lightning Bolt`,
but neither child's structured answer selected it. Both focused parent questions omitted the requested actor, while
the locked hidden assignments correctly retained the original request and its actor criterion; the model nevertheless
selected events performed by other actors. This is a remaining semantic-recovery reliability problem, not an
isolation, handoff, context-composition, or irreversible-compaction failure.

Complete lifecycle work used 923,236 fresh-input, 568,000 cache-read, 1,491,236 logical-input, and 9,525 output tokens
across 37 provider calls. At the official price assumption this is `$2.045622` with cache discounts and `$3.039622`
with all input fresh; CodeOnTime charged zero. The preserved-answer path saved two ordinary question calls and an
estimated `$0.531650` under cached pricing relative to the preceding failed canary, but the wrong answer means this is
only a validated safety/efficiency improvement. Do not claim improved 175k quality or start the full benchmark. A
post-correction 175k canary remains gated on a general way to keep the original semantic criteria effective throughout
private candidate selection.

The first post-correction 175k canary, run group
`qwen38-v759-b071-h30fac-c100-t60-q2-r12-t24-s48-175k-isolation-inward-canary-20260905`, used product source
`b0711ff2e6`, the unchanged v69 harness, 100,000/4,096 model limits, temperature zero, threshold 60%, and the loose
two-query/12-step/24-tool/48-semantic recovery profile. It completed without task, product, provider, resource,
fallback, or legacy-compaction failure. It returned `Call Lightning, Gust of Wind, Plant Growth, Foresight` against
the pinned `Cure Wounds, Gust of Wind, Plant Growth, Grasping Vine` answer for score `0.5`: both middle values were
exact while both edge values were wrong.

The post-ingestion frame was healthy at 37,712 active tokens: 9,997 summary, 17,725 raw-lane, and 9,990 fixed-input
tokens. It retained the same exact raw frontier as the other 60% 175k canaries. The summary named the missed
`Cure Wounds`, while the protected raw lane retained the later missed `Grasping Vine`; the failure was therefore not
irreversible compaction loss. The one actual hidden query ran 12 private primitives and 47 semantic inferences across
55 provider calls. Its nine-message research transcript stayed exact and private, with no child-owned LCM summary or
source namespace, and only its bounded answer, gaps, and four host-verified citations entered the parent. This
validates the hidden-session isolation and non-lossy evidence-handoff changes even though the final score did not
improve.

Complete setup and answer work used 1,360,946 fresh-input, 649,600 cache-read, 2,010,546 logical-input, and 21,608
output tokens across 83 provider calls. At the official price assumption this is `$3.013940` with cache discounts and
`$4.150740` with all input fresh; CodeOnTime charged zero. The question phase took 14.31 minutes and setup plus answer
took about 26.37 minutes. Compared with the immediately preceding semantic-64 175k miss, it used 628,164 fewer logical
input tokens, 29 fewer calls, about 16.68 fewer question minutes, and `$1.270114` less under cached pricing. The
configurations and realized query paths differ, so that is observed efficiency rather than a causal parameter result.
The best retained semantic-48 175k sample still scored `1.0` at `$2.684016`, 79 calls, and 1,729,559 logical-input
tokens. Current 175k quality is consequently nondeterministic, not demonstrably better than that earlier success.

The new trace exposed a separate general `lcm_grep` contract defect. A child supplied an `occurrenceOffset` as though
it were a source byte offset. When that zero-based match-page index was beyond the last occurrence, both literal and
regex paths discarded the positive exact match count and returned lexical-absence guidance. The current product keeps
that positive-count record with an empty occurrence page, reports earlier occurrences and a copy-ready final-page
offset, explicitly says the pattern is present, and documents that callers must omit the index initially and copy only
a returned page offset. Focused tools/isolation, registry/permission, API, documentation, and contract gates pass in
`.artifacts/vps-verification/2026-09-05T21-24-29-892Z-focused-opencode`. This correction is independent of context
size, threshold, model, benchmark vocabulary, and expected answer. It has not yet been revalidated by another provider
canary.

The parent made three rejected correction attempts after the bounded partial result, while only one child actually
started. The first follow-up did not identify the preceding result, the next changed the original event criteria, and
the first valid result-linked narrowing arrived only after the separate four-attempt ceiling was exhausted. That
ceiling deliberately bounds malformed or adversarial parent loops at twice the configured child-start allowance and
does not warrant removal based on one model trace. More copy-ready follow-up guidance remains a possible general
reliability improvement, but it requires its own contract design and tests. Do not run the full benchmark or reduce
worker limits until the grep correction and result-informed follow-up behavior are revalidated on a focused 175k
canary.

The first source-pinned revalidation after that correction used product source `e216dd3c48`, the same v69 harness,
100,000/4,096 model limits, temperature zero, threshold 60%, and the intentionally loose
two-query/12-step/24-tool/48-semantic profile. It again scored `0.5`, returning
`Call Lightning, Gust of Wind, Plant Growth, Foresight`. The corrected out-of-range grep state did not recur, so this
provider run did not behaviorally exercise that fix. Instead, its second hidden child emitted 12 consecutive
schema-invalid private calls, including repeated unterminated oversized JSON, until the research-step limit stopped
the loop. That child performed no semantic inference and added 38,146 output tokens across 13 provider calls without
improving the answer. Complete setup and answer work used 1,692,275 fresh-input, 1,841,600 cache-read, 3,533,875
logical-input, and 55,523 output tokens across 100 calls, or `$4.178088` with cache discounts and `$7.400888` with all
input fresh; CodeOnTime charged zero. Setup took about 12.46 minutes and the question phase about 28.75 minutes.

Product commit `09738a1b07` addresses that general failure mode without interpreting or repairing malformed model
arguments. Two consecutive schema-invalid private recovery calls since the latest user boundary now end the research
loop and hand the exact same hidden transcript to the existing bounded, tool-free finalizer. A valid private call,
an ordinary operational failure, or a new trusted user boundary resets the consecutive count. The fixed circuit
breaker does not reduce the configurable research-step, primitive-call, semantic-inference, repair, or wall-time
budgets. The focused isolated-recovery, processor, prompt/maintenance, documentation, contract, upstream-compatibility,
and annotation selections pass in verifier artifacts
`.artifacts/vps-verification/2026-09-05T22-36-54-114Z-focused-opencode`,
`.artifacts/vps-verification/2026-09-05T22-41-45-978Z-focused-opencode`, and
`.artifacts/vps-verification/2026-09-05T22-43-27-908Z-focused-opencode`.

The exact-source canary on that guard, run group
`qwen38-v759-0973-h30fac-c100-t60-q2-r12-t24-s64-175k-guard-boundary-canary-20260906`, changed the semantic ceiling to
64 while keeping the other settings above. It completed without task, product, provider, resource, fallback, or
legacy-compaction failure, but again scored `0.5`: it returned
`Call Lightning, Gust of Wind, Plant Growth, Wild Shape` against the pinned
`Cure Wounds, Gust of Wind, Plant Growth, Grasping Vine` answer. No schema-invalid call occurred, so the new guard was
not exercised by this provider path; its real-run evidence is operational non-interference, while the focused
processor/prompt tests prove the malformed-loop cutoff.

The post-ingestion context remained useful and lossless for this question at 36,795 active tokens: 9,082 summary,
17,725 raw-lane, and 9,988 fixed-input tokens. Its exact protected raw frontier matched the preceding 60% canaries.
The summaries retained `Cure Wounds`, and the later raw episode remained available for exact recovery. The final
frame used 30,049 active tokens: 9,082 summary, 19,683 raw, and 1,284 fixed. The first hidden child processed all four
host-matched units, exhausted all 64 semantic inferences, and returned three explicitly incomplete or conflicting
unit gaps. Its exact candidate evidence itself showed that `Call Lightning` was a continuation of an already-active
effect, and a later exact read showed the closing healing action; nevertheless the child submitted the provisional
four-item list. The host correctly removed four semantically irrelevant citation intervals and downgraded coverage to
partial. A result-informed second child spent 15 more semantic inferences on unit 4, retained conflicting exact
evidence, and still submitted `Wild Shape`. The parent ignored both partial-coverage warnings and repeated those
candidates as the final exact list. Isolation therefore worked; semantic candidate selection and parent calibration
did not.

Complete setup and answer work used 1,683,956 fresh-input, 939,200 cache-read, 2,623,156 logical-input, and 18,373
output tokens across 120 provider calls, or `$3.712950` with cache discounts and `$5.356550` with all input fresh;
CodeOnTime charged zero. Setup took about 10.93 minutes and the question phase about 20.13 minutes. Relative to the
preceding malformed-loop canary, logical input fell 25.8%, output fell 66.9%, cached-price estimate fell 11.1%, and
question time fell 30.0%, despite 20 more short provider calls. The semantic ceiling and realized provider path also
changed, so these are observed efficiency differences rather than a causal parameter result.

This canary rejects a larger semantic ceiling as the next optimization direction: the worker consumed the additional
capacity and did not improve quality. It also identifies a remaining general interface risk. For an exact,
exhaustive, boundary-sensitive, count, or ordinal question, a host-known incomplete/conflicting child result can still
return a polished provisional answer beside its gaps, and the parent may anchor on it despite explicit guidance. The
next correction should make that unsafe state mechanically harder to mistake for a complete answer while preserving
supported partial detail for ordinary non-exhaustive questions. Do not start the full benchmark or tighten worker
limits until that contract is fixed and revalidated with a focused canary.

Product commit `3b42bcf4b0` corrects that isolation-boundary defect without changing the hidden worker's evidence or
resource budgets. When a first/last, ordinal, count, exhaustive-list, or other completeness-sensitive result remains
partial, the host now withholds its polished candidate from the parent and returns an empty answer with
`candidateAnswerWithheld: true`, the named gaps, and any independently bounded citations. Non-exhaustive partial fact
answers remain visible. Numeric structural-unit gaps also match equivalent first-through-twelfth ordinal wording in a
narrower follow-up, so withholding the candidate does not strand the second child allowance. Focused recovery/tool
tests and the selected integration, documentation, contract, compatibility, and annotation gates pass in verifier
artifacts `.artifacts/vps-verification/2026-09-05T23-27-57-914Z-focused-opencode`,
`.artifacts/vps-verification/2026-09-05T23-29-40-304Z-integration-opencode`, and
`.artifacts/vps-verification/2026-09-05T23-32-23-576Z-focused-opencode`. This is a mechanically verified general
safety change, not yet a demonstrated 175k score improvement. Revalidate it with one semantic-48 175k canary before
changing optimization parameters or starting the full benchmark.

That source-pinned revalidation, run group
`qwen38-v759-005f-h30fac-c100-t60-q2-r12-t24-s48-175k-partial-boundary-canary-r2-20260906`, used the same 100,000/4,096
model limits, temperature zero, 60% threshold, and two-query/12-step/24-tool/48-semantic profile. It completed without
task, product, provider, resource, fallback, or legacy-compaction failure, but again scored `0.5`, returning
`Call Lightning, Gust of Wind, Foresight, Plant Growth` against
`Cure Wounds, Gust of Wind, Plant Growth, Grasping Vine`. Both hidden children returned partial coverage. The host
withheld both polished candidates exactly as designed, retained their named gaps and bounded citations, and exposed no
private transcript to the parent. The parent then synthesized the wrong edge values and shifted the two later episode
values from active summaries, so this canary validates the safer partial-answer boundary but does not demonstrate a
175k quality gain.

The post-ingestion frame remained healthy at 38,202 active tokens: 10,418 summary, 17,725 raw-lane, and 10,059
fixed-input tokens. Exact context inspection again found `Cure Wounds` in a summary and retained the later
`Grasping Vine` source in protected raw history. The final frame remained below threshold at 40,755 active tokens.
Complete setup and answer work used 1,558,579 fresh-input, 988,800 cache-read, 2,547,379 logical-input, and 18,818
output tokens across 93 provider calls. At the official price assumption this is `$3.477266` with cache discounts or
`$5.207666` with all input fresh; CodeOnTime charged zero. Setup took about 11.64 minutes and the question phase about
18.37 minutes.

Trace inspection found that the parent changed the user criterion from `last spell cast` to `last spell explicitly
cast` in both focused questions. The pre-child lexical guard failed to reject that change because the benchmark's
independent answer-format trailer contained the incidental phrase `values explicitly requested`, and the old
bag-of-words check treated any earlier `explicit` token as semantic authorization. Product commit `98f0739f55`
distinguishes request-reference uses such as `explicitly requested` from event restrictions such as `explicitly cast`.
It rejects that initial or follow-up criteria rewrite without spending a child allowance while preserving cases where
the user's event criterion really was explicit. The 45-test isolated-recovery suite, documentation authority, and
public-contract checks pass in verifier artifact
`.artifacts/vps-verification/2026-09-06T00-19-56-343Z-focused-opencode`. This is a model-, context-, threshold-, and
benchmark-answer-independent isolation fix. Revalidate the exact product commit with one more semantic-48 175k canary
before changing optimization parameters or starting the full benchmark.

A clean-checkout diagnostic on the intervening `b71e7408d87ad1627e162e45235b76cef4aae4f8` runtime improved the 175k
answer to `Call Lightning, Gust of Wind, Plant Growth, Grasping Vine`, or `0.75`, with no task, product, provider,
resource, fallback, or legacy-compaction failure. The run group was
`qwen38-v759-b71-h30fac-c100-t60-q2-r12-t24-s48-175k-criteria-context-canary-20260906`. It omitted the harness
`--source-repo` and `--source-sha` options, so its recorded source kind is `runtime-artifact`, not `source-checkout`.
The checkout was clean before and after the run, the runtime directly loaded that product tree, and the runtime and
harness hashes are pinned, but this remains diagnostic rather than release-grade source-attested evidence.

The criteria-context fix worked: neither admitted child changed `last spell cast` to `explicitly cast`. Both bounded
children still reported incomplete coverage and the host withheld their candidate answers. The parent recovered three
of four values from verified citations, but the first child and the unit-one follow-up both selected a prior
`Call Lightning` event instead of the later `Cure Wounds`. Context inspection proved that `Cure Wounds` remained in an
active summary and in the exact unit-one source read; `Grasping Vine` also remained in protected raw history. The miss
was therefore semantic selection inside recovery, not irreversible compaction loss. The post-ingestion frame held
36,275 active tokens: 8,494 summary, 17,725 raw-lane, and 10,056 fixed-input tokens. The final frame held 39,366.

Complete setup and answer work used 1,752,729 fresh-input, 1,267,200 cache-read, 3,019,929 logical-input, and 17,939
output tokens across 111 calls. At the official price assumption this is `$3.929892` with cache discounts or
`$6.147492` with all input fresh; CodeOnTime charged zero. Setup took about 11.31 minutes and the question phase about
22.66 minutes. Relative to the preceding canary, the score increased by `0.25`, while logical input increased 18.55%,
the cached-price estimate increased about 13.0%, and total wall time increased about four minutes. Provider paths were
not identical, so those quality and cost changes cannot all be attributed to the contract fix.

The diagnostic also exposed a second general admission false positive: the parent's original focused question kept
the event definition intact but requested an `exact source cue`, and the guard treated `exact` as a new event-status
criterion. Product commit `d596ed99ff` distinguishes bounded output/evidence wording such as `final answer` or
`exact source cue` from semantic restrictions such as `final spell`, `exact action`, or `source confirmed the action`.
Evidence wording is exempt only when the evidence noun follows the restriction word, preserving the conservative
semantic guard. The same classification prevents an earlier `final answer` trailer from authorizing a later
`final spell` rewrite. The 45-test isolated-recovery suite with 439 assertions, documentation authority, and public
contract checks pass in verifier artifact
`.artifacts/vps-verification/2026-09-06T01-12-19-297Z-focused-opencode`. Revalidate the exact committed source with one
semantic-48 175k canary before changing optimization parameters or starting the full benchmark.

That exact-source canary, run group
`qwen38-v759-9b4-h30fac-c100-t60-q2-r12-t24-s48-175k-evidence-context-canary-20260906`, pinned clean product source
`9b4d444a15e78c9e40702a8afc5362635ddc3358`, the v69 harness, the provider-confirmed qwen3.8 alias, 100,000/4,096
model limits, temperature zero, threshold 60%, and the same intentionally generous
two-query/12-step/24-tool/48-semantic recovery profile. It completed on the first attempt with no task, product,
provider, resource, fallback, or legacy-compaction failure and scored `1.0`, returning the exact
`Cure Wounds, Gust of Wind, Plant Growth, Grasping Vine` sequence.

The complete context remained useful rather than merely small. After ingestion it held 36,020 active tokens: 8,239
summary, 17,725 raw-lane, and 10,056 fixed-input tokens, or 37.6% pressure. The final frame held 39,906 active tokens,
or 41.6% pressure. The first hidden child returned partial coverage after 48 semantic inferences over four exact
structural units. Its candidate evidence included the exact `Cure Wounds` cast, but its finalizer still selected a
prior `Call Lightning`; it correctly recovered bounded `Gust of Wind`, `Plant Growth`, and `Grasping Vine` evidence.
The second child used 12 exact grep/read calls and no semantic inference to investigate a named unit-one gap, remained
partial, and again had its polished candidate withheld. The parent closed the decisive first-episode gap from the
active summary and used the bounded later citations. Isolation therefore worked end to end, but the children alone
were not yet reliably complete. The parent's explanation also misattributed the healing recipient to Grog, while
the retained exact cast and summary identify Scanlan. The exact list score therefore overstates the quality of the
accompanying explanation and does not establish reliable evidence interpretation.

Complete setup and answer work used 1,679,797 fresh-input, 1,137,600 cache-read, 2,817,397 logical-input, and 22,018
output tokens across 99 provider calls. At the official model-developer price assumption this is `$3.776102` with
cache discounts or `$5.766902` with all input fresh; CodeOnTime charged zero. Setup took about 11.32 minutes and the
question phase about 22.30 minutes. Relative to the immediately preceding runtime-artifact diagnostic, logical input
fell 6.71%, calls fell by 12, and the cached-price estimate fell 3.91%, while output rose 22.74%; differing provider
paths prevent attributing all changes to the contract correction. Relative to the preceding source-attested `005f`
canary, score rose from `0.5` to `1.0` while logical input rose 10.60% and cached-price estimate rose 8.59%.

Trace inspection exposed one remaining general admission inefficiency. The current user request already required the
`last spell`, but two focused calls using the synonymous `final spell` wording were rejected as newly restricted. The
rejections spent no child allowance and did not prevent the exact result, but they consumed parent correction steps
and encouraged a broader `list the spells in order` query. Product commit `40942f0e0d` normalizes `last` and `final`
as the same event-boundary criterion. It still rejects either boundary when the user requested only an unrestricted
event list, and output-only wording such as `final answer` remains non-authorizing. The focused isolated-recovery
suite passes 45 tests and 441 assertions with documentation and contract checks in
`.artifacts/vps-verification/2026-09-06T01-55-48-039Z-focused-opencode`; annotation checking finds no shared upstream
source delta.

The current evidence demonstrates a real post-rebaseline 175k success and no irreversible detail loss, but one exact
sample does not erase the retained `0.5` runs or prove stable child-only retrieval. Do not start the full benchmark yet.
Resume controlled parameter research from the 60% default on exact source `40942f0e0d`; when comparing a changed
setting, include a same-source 60% canary so the admission-path change is not confused with the parameter effect.

The retained previous public prerelease is `v7.4.23-lcm.13`. It was published on 2026-08-27 from candidate
`6f3c08417b89b8195c33130658e013912f25e1ca`, containing verified product
`e63a527f31f6f819628f2a733fb7e565a9e1c266`. Exact-SHA workflow run
[`33101947543`](https://github.com/KertarTheDev/LCM/actions/runs/33101947543) completed successfully. Its LCM job
proved exact 27-path overlay ancestry, focused v7.4.23 adaptation tests, all affected-package typechecks, stable
second contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime
smoke; unrelated upstream version, build, validation, and publish jobs were skipped. Release
[`378031971`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13) is a non-draft prerelease whose tag
resolves to the candidate SHA. Its published body contains the reviewed
`What changed since v7.4.23-lcm.12` delta, honest 175k limitations, storage and upgrade guidance, and the exact tag
and candidate. Its exact GitHub-reported asset manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,558,350|`56a628d9335f1ff5a3e90ced187b2b3555e36906da3a4219a1e8592e98d995af`|
|`kilo-darwin-x64-baseline.zip`|54,810,868|`c38a307818d7636e5e03c1183b3bb4ca2809a4bc5ddafd3c78b60e6742dd34ea`|
|`kilo-darwin-x64.zip`|54,810,868|`7bec0ee7aa74d704d65f5c6da77235d7388586cfc266987b6b9be11682210227`|
|`kilo-linux-arm64-musl.tar.gz`|69,333,451|`9e4ea473b0a6429f582cecbebe78d4b21cd98edbff2d32b53b2f0708e01bb7e2`|
|`kilo-linux-arm64.tar.gz`|67,211,531|`91d85e65a844c00be17adc448b5c0070622ee35ca8909c049342185fb3c8bf34`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,819,599|`7a42a3fda504f3d3eaa1b2bef8cddd8aab77df1ec6db92a1e41f0efd493a6480`|
|`kilo-linux-x64-baseline.tar.gz`|67,469,042|`723e6f92cffe05aabfb69b36005e5a9ba838a8a808e2c06905f42be83c64dd42`|
|`kilo-linux-x64-musl.tar.gz`|69,820,472|`509487dc5f07831cd9e52049b5f10e1a938cf78267c61040ba75badf2c2a2ec6`|
|`kilo-linux-x64.tar.gz`|67,469,040|`72ec1f71e8e8b3934c59cca84a4826d681bfcbc016ea51acb3247011ae5a96eb`|
|`kilo-vscode-alpine-arm64.vsix`|110,141,739|`0004ad2d78d717b71f88d80d337c3229c54cba1a115fcc9ccf8cfd9279aa865d`|
|`kilo-vscode-alpine-x64.vsix`|117,345,019|`ea532d36143197e453c744ba8e5311a6bd8ac12edcfe2fd61b2ec4627de000e4`|
|`kilo-vscode-darwin-arm64.vsix`|92,873,656|`1fc44cdabd23fcfd914521ab117e0ab2524e2fd51a6c3341c51da577bbcfa66b`|
|`kilo-vscode-darwin-x64.vsix`|100,943,334|`38add975380c7ed98306d49d59dd294b72c5fed2b70ce81c5286306cfc5b2d81`|
|`kilo-vscode-linux-arm64.vsix`|107,973,591|`5fc66425b3683e0a1d07a0ebe716f254adfc1094458ee5c9a052f9eae2f4faba`|
|`kilo-vscode-linux-x64.vsix`|114,918,416|`3de1f13ecc07abb2a966d2bf4b281ca64cb7bdb88f809cc0d155752d75b5d0c0`|
|`kilo-vscode-win32-arm64.vsix`|89,750,822|`da1db7fc78b334678d6e243e501a4ede64d3838da9fc5654a70029383d13cb75`|
|`kilo-vscode-win32-x64.vsix`|113,794,579|`d4eceaf004a69ed08b23c411170f790831a6ac3c45adedc5a9e56c7288f02198`|
|`kilo-windows-arm64.zip`|65,146,176|`231bc5d4ef2b15f4164d1c89923e04bb77fe9844506da4ea46c946af259e0444`|
|`kilo-windows-x64-baseline.zip`|66,819,280|`4ba8ce41b3d49108ac86274864d73254756fd2b18182e0551997a55d567c9867`|
|`kilo-windows-x64.zip`|66,819,280|`3013c1e3d74c1f6add87185a924f7a18e6d83ecfc1a8a1ff8a5d356efe21649d`|

`.13` lets an explicitly bounded `lcm_expand_query` use up to 50% of usable model input, capped at 64k tokens, while
unscoped exploration retains its 20%/16k limit. Deterministic water-filling redistributes unused allocation from
short records so longer selected ranges can preserve the complete bounded semantic unit. Blank generated answers
claiming `coverage: none` are rejected, transient semantic-provider fallback directs one identical exact retry before
bounded verification, and other failure causes continue to require a narrower query. Boundary-sensitive synthesis
now constructs an ordered event ledger and distinguishes new events from mentions, rejected attempts, and continuing
effects. These are model-neutral recovery improvements; the five-tool contract, raw Kilo SQLite storage, and
rebuildable sidecar schema are unchanged.

The published `.12` qwen3.8 175k LCM-only baseline scored 0, 0.25, and 0. An exact-scope candidate canary improved the
cross-episode list to 0.5 with full non-truncated semantic inputs, but the final three-question candidate repeat had
one malformed-tool task failure and two zero scores while recording zero product findings, healthy LCM state, no
legacy summaries, and no context-integrity loss. Retained traces attribute the misses to provider/model tool-call
variance, repeated manual search after decisive evidence, and a benchmark cast-definition ambiguity; `.13` therefore
does not claim a deterministic score gain. Focused and integration verification passed locally. The clean exact-SHA
local release typecheck stopped safely under the VPS resource guard and was not resumed; canonical workflow run
`33101947543` subsequently passed the authoritative typechecks and every release gate.

Three v7.5.9 audit candidates failed safely before publication. Candidate
`67887ecd84e56dc376331cb69ed2b5c40f3a7175` stopped in exact-SHA workflow run
[`33734467246`](https://github.com/KertarTheDev/LCM/actions/runs/33734467246) during the OpenCode typecheck, before
versioning or draft creation. Canonical compilation exposed a metadata-union inference mismatch in
`lcm_expand_query`, missing assistant/completed-state discriminant guards in isolated recovery, an optional attachment
access across host-suppressed query results, and two readonly/message-role test-fixture narrowings. The product now
makes those boundaries explicit without changing runtime behavior. Candidate
`e0afef836b1a4bf3a7ccbd5c05098c86d494fb6c` stopped in run
[`33735789387`](https://github.com/KertarTheDev/LCM/actions/runs/33735789387) during the adaptation gate because the
release workflow batched independent stateful OpenCode files into one Bun process; each owning test passed in
isolation, and the workflow now gives those files separate processes. Candidate
`2b814b0edcce642b70ad0e8ccba45fbfe3119f4e` stopped in run
[`33736191375`](https://github.com/KertarTheDev/LCM/actions/runs/33736191375) after all typechecks and artifact builds,
when packaged smoke still expected the five raw primitives on ordinary agents instead of asserting the current
isolation contract. Product commit `5e7df6a67c55e5c43c2bbbb488df9c7eea2e7b0d` makes packaged smoke require only
`lcm_query` and reject every hidden primitive on ordinary agents. All three failed candidates have no release, tag, or
assets; their Actions audit history is retained.

The healthy `v7.4.23-lcm.12` release remains published because prerelease publication authorization does not authorize
release or tag deletion. No release, tag, asset, or Actions history was deleted. It is retained pending separate
deletion authorization even though `.13` is the independently verified current recommendation.

The previous healthy prerelease is `v7.4.23-lcm.12`. It was published on 2026-08-27 from candidate
`043871bfdf8db1f930ba9c24e2baa421db50ff15`, containing verified product
`18b87e3110a09edb9f3d71188db7f74b108dfbb4`. Exact-SHA workflow run
[`33048213799`](https://github.com/KertarTheDev/LCM/actions/runs/33048213799) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical affected-package typechecks, stable contract
generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory runtime smoke. Release
[`377625464`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.12) is a non-draft prerelease whose tag
resolves to the candidate SHA. Its published body includes a concrete `What changed since v7.4.23-lcm.11` section,
verification and 175k limitations, storage/migration impact, and upgrade guidance. Its exact GitHub-reported asset
manifest is:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,562,193|`ef54a9ac27c390a9bd41034945b4fd5d7049f9250ae28799efbd11149c77588d`|
|`kilo-darwin-x64-baseline.zip`|54,813,498|`fb0e9abd21c16caccb6fb166b9c2e15f885d818c65b821f77f530430e02c0fbb`|
|`kilo-darwin-x64.zip`|54,813,498|`e06b08580498c8d7da4f95d7ab4e0add829bf85dc84dbf39c3cd9a241bdca3d1`|
|`kilo-linux-arm64-musl.tar.gz`|69,333,640|`6ba50f7cb8f92a9feccf812d5c67fcc75185047ff3fcf2cce4099f6472be6a49`|
|`kilo-linux-arm64.tar.gz`|67,214,436|`7511767367bc133e84708f9c01708f8a457c140a5992e282a8386b7e42291189`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,824,884|`b99ff2365d245ad258099526376868447fb3d64d52ac5c5a762dc25c6695af57`|
|`kilo-linux-x64-baseline.tar.gz`|67,461,886|`4ab62a9607b99b7bdd2426bfebe42869a559b00d8215cf1e7440c96f5ecd460d`|
|`kilo-linux-x64-musl.tar.gz`|69,824,883|`6182414caacbae73c5074a4331768eb490cbcec10d227960e03b3d04c41d7c21`|
|`kilo-linux-x64.tar.gz`|67,461,874|`19bd144440807419f82342c629f6f90f0fbb3d502bd84a993cab11f905119883`|
|`kilo-vscode-alpine-arm64.vsix`|110,140,294|`d778e17211561ea47de279ad7fcd56cfb507b4b5827907a909161967fdcc04a1`|
|`kilo-vscode-alpine-x64.vsix`|117,343,795|`43014f94378269214c857307325ef8fd575cf62b74e2ad94c3fd324d8e5b178b`|
|`kilo-vscode-darwin-arm64.vsix`|92,872,099|`09dc798ab5394abcdfa15d039a642ea4edbdd30d0665d1b3cd161375b3228431`|
|`kilo-vscode-darwin-x64.vsix`|100,943,582|`4e0d0d0448b72ca5c32651ab5f1d1d9b2f388f95f603b5efdf579736ac16e7f7`|
|`kilo-vscode-linux-arm64.vsix`|107,972,204|`74728c68b7250d2a49fc46720d28bf09b97750c582cec1c43e95f36702fd77c5`|
|`kilo-vscode-linux-x64.vsix`|114,916,522|`168330d8497be21f086117f1bdedd4cfe50328c9b8740f19c511697226357ed1`|
|`kilo-vscode-win32-arm64.vsix`|89,748,673|`8efa201adee9a8f3fe1337c10225909460d54df88ec8be1bbfb96b098b91cd29`|
|`kilo-vscode-win32-x64.vsix`|113,792,658|`572ccee8b7eff03c0542bae5918ebebeb9b2f162552f93d5317090de69dd9e62`|
|`kilo-windows-arm64.zip`|65,142,600|`c43110bb5d9f4c24d9f734b303cd1ac2060f0b31fb7329aea77d83ad71f7d2a3`|
|`kilo-windows-x64-baseline.zip`|66,823,218|`ff0427dcc733ded7979a629df09a45a447f3ecbab29f3735f3cc4493cb64e630`|
|`kilo-windows-x64.zip`|66,823,218|`645d56ac937ba54b28c6764ee14fd638119fad258b48e2b4dc0409bdcfd772c8`|

`.12` adds one exact ordered-range search contract shared by `lcm_grep` and `lcm_expand_query`, so a model can search
or count across a complete structurally bounded unit without one call per transport source. Grep preserves range
order and effective bounds, deduplicates source-record totals, and keeps complete literal occurrence totals even when
returned excerpts are bounded. Semantic query recovery now permits one ordinary transient-provider retry, and any
generated `full` claim is downgraded to `partial` when retrieval clipped or omitted in-scope evidence. These are
model-neutral recovery-interface corrections; raw Kilo SQLite storage and the rebuildable sidecar schema are unchanged.

The published Linux x64 archive is 67,461,874 bytes with SHA-256
`19bd144440807419f82342c629f6f90f0fbb3d502bd84a993cab11f905119883`; its extracted `kilo` runtime has SHA-256
`475d4946acc02fb74ad7262bdfb1b34638c294851b0b7db4c81e1cbb5c7e50fe`. The fixed-binary 175k LCM-only diagnostic
`laguna21-v49-v7423-lcm12-175k-lcm-only-20260827T071749Z` used driver
`81e9f54f4bb1e6a4ce077c47eca2ab1421c2675edc3db0b9b05c1dfeb09fb2ec` and `poolside/laguna-s-2.1:free`. All 12
ingestion turns and all three independent questions completed with zero task failures, zero product findings, zero LCM
fallbacks, and zero legacy automatic summaries. Scores were 0, 0.25, and 0; the second question improved from `.11`'s
provider-call-budget failure to a completed partial answer at the same 24-call boundary.

The retained traces separate remaining model behavior from LCM defects. The first question received one complete
five-range exact grep result, then abandoned it for repeated manual reads and omitted the required answer tags. In the
second, 21 failed calls were the identical over-512-character regex repeated after `lcm_invalid_regex` explicitly said
not to retry it unchanged; LCM rejected the malformed input consistently. The third used one seven-range semantic
query plus scoped grep/read verification, saw the gold spell mention, but interpreted it as not an actual cast. Its
incomplete semantic generation correctly reported `coverage: partial`, `truncated: true`, and
`providerFailureReason: incomplete_response` before providing extractive fallback evidence. The run therefore reveals
model concision, instruction-following, and semantic-judgment limitations without exposing another generally useful
LCM correction. Across question attempts, minimum available host memory was 2,590,617,600 bytes, maximum runner RSS
was 184,696,832 bytes, maximum Kilo-tree RSS was 1,387,679,744 bytes, peak full memory PSI avg10 was 0.06%, and new
swap paging was zero.

The previous public prerelease was `v7.4.23-lcm.11`. It was published on 2026-08-27 from candidate
`830e62c281d76b71b2f6a989100e85dc1511f2b1`, containing verified product
`20a5d1a704cdbde8a1cf33e5768923eaedced482`. Exact-SHA workflow run
[`33042416377`](https://github.com/KertarTheDev/LCM/actions/runs/33042416377) completed successfully, including exact
27-path overlay verification, focused v7.4.23 adaptation tests, canonical OpenCode, SDK, Kilo i18n, TUI, and VS Code
typechecks, stable contract generation, all 12 CLI and eight VSIX builds, and packaged Linux x64 Conversation Memory
runtime smoke. Former release ID `377584687` was a non-draft prerelease whose tag resolved to the candidate SHA before
removal. Its exact GitHub-reported asset manifest was:

|Asset|Bytes|SHA-256|
|---|---:|---|
|`kilo-darwin-arm64.zip`|52,556,351|`f97f007f4778177aa99ecb10970a5edbed745ccb34e621f33364aa78fc879235`|
|`kilo-darwin-x64-baseline.zip`|54,806,681|`e7bb8aa593241315f890d7ce1a3fcfa92dca074e2dd42009560a72952aa1222b`|
|`kilo-darwin-x64.zip`|54,806,681|`c0f9396f3a613d59e196c46a96729917da59e5f64d99a867a2ffda909f4e3ca3`|
|`kilo-linux-arm64-musl.tar.gz`|69,320,537|`0827dd60ef5ff07fc46db2e51fc6c0fdc5703b1d4f7887d85aab5386b840a498`|
|`kilo-linux-arm64.tar.gz`|67,223,622|`b9f9cf276a367e831f80bcbf9c294b46409fe74b3804bcca5d00d3380b498b2a`|
|`kilo-linux-x64-baseline-musl.tar.gz`|69,818,739|`b6a5889c5ae6e1e9f236f27e8ba86597ee482bc41ed4dd0401682584c0a822ce`|
|`kilo-linux-x64-baseline.tar.gz`|67,457,921|`4d8c4fa9e6095a9f242ff2aa8d41fb8009217fbe59805f2908e5b8b00e16fdf1`|
|`kilo-linux-x64-musl.tar.gz`|69,820,223|`5dc75dae24496f036cfbb36b2af6923ccff0a326d37ba5afd877e386bd9735c3`|
|`kilo-linux-x64.tar.gz`|67,457,143|`39b3df75612c587881802593137686520c41e88586282d094eec5c40c1e12645`|
|`kilo-vscode-alpine-arm64.vsix`|110,138,571|`2d9b832d439bc828e7c7dc2b0e91b047c0c397e9ff18e1760183dabf6164af21`|
|`kilo-vscode-alpine-x64.vsix`|117,341,372|`c7d2fa194ba9b5f0b4bf7c192091cec044692f3be122727f30c2b00ed3581147`|
|`kilo-vscode-darwin-arm64.vsix`|92,869,548|`003d5f213e94139c5fec6909da90daced509dff96292a09e95711db52aa95337`|
|`kilo-vscode-darwin-x64.vsix`|100,943,840|`fad4e839f7d944c54e5f9cf75b5ef0178692ab69819ad2683bc20710ddd424fb`|
|`kilo-vscode-linux-arm64.vsix`|107,969,959|`cf61bd092b25a67bb1755985dcd1f9c7c29928e89adc7a99a786d6aee0e73780`|
|`kilo-vscode-linux-x64.vsix`|114,915,527|`7c42519a81ecdf2f27e47d8bc7bcb93687e83b43f82d158aec9ac1b192171b3e`|
|`kilo-vscode-win32-arm64.vsix`|89,747,873|`a51b4c7e971dc01b66ed1aa1775e470901e4619848dfba9a083a90d7c026321e`|
|`kilo-vscode-win32-x64.vsix`|113,791,698|`6ffade8acfaf00c8946c1d339e73898292e52f0383015fd6379bae2c7d0ebe29`|
|`kilo-windows-arm64.zip`|65,142,429|`e9690ed5f2f0272fdce3ca7437e7c2fee31285222a2fe5c26affcc94188decdb`|
|`kilo-windows-x64-baseline.zip`|66,820,262|`0f34a901ff30dfdd5ce67980b8d610108a1878fae3cb85a9ed57ebbaacf3532b`|
|`kilo-windows-x64.zip`|66,820,262|`5c10a123149363de60ebe890dd101b94537a149103c1b2ba8a4e8a9242db5d6c`|

`.11` adds event-status-aware summaries, sanitizes historical handles that are outside the current lineage, makes
semantic query synthesis primary, mixes relevance-ranked and chronological recovery evidence within a fixed budget,
samples the active frontier when literal overlap is absent, and advises against open-ended exact recovery after five
grep/read calls without imposing a hard tool limit. Schema-v14/tree-v11 rebuilds the disposable sidecar; Kilo SQLite
remains the raw source of truth.

The exact published `.11` 175k LCM-only trace exposed three general recovery-interface defects. `lcm_grep`
silently ignored ordered `sourceRanges`, forcing one call per transport source and allowing exact searches to escape
their intended semantic unit. `lcm_expand_query` made no retry after a transient provider failure, while summary
generation already allowed one, and could preserve a generated `full` coverage claim even when retrieval reported
clipped input. `.12` implements the general corrections described above. After `.12` release `377625464`, tag, exact
candidate, published changelog, and 20 assets were independently verified, `.11` release ID `377584687` and matching
tag were re-resolved to candidate `830e62c281d76b71b2f6a989100e85dc1511f2b1` and removed. A post-deletion exact-SHA
lookup found zero releases; older historical prereleases for other upstream versions remain untouched.

The first `.12` candidate `7cc3a29f4696b39b8d43c0ae162d85f397244464` stopped in exact-SHA workflow run
[`33047780488`](https://github.com/KertarTheDev/LCM/actions/runs/33047780488) before versioning or draft creation. Hosted
OpenCode typecheck proved that the ordinary-source branch of the new grep result union did not expose an explicit
optional `rangeIndex`, even though focused runtime tests passed. The product now makes that metadata boundary explicit;
no draft, release, tag, or assets existed to delete, and the Actions audit run is retained.

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

The following same-upstream releases were inferior to verified `.11` for the defects described in their retained
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
|`v7.4.23-lcm.10`|`377351189`|`072e84c88b8d0a15c5668cee661e71b2ca15bce2`|

On 2026-08-26, the `.3` through `.9` exact release IDs and matching tags were removed under the one-best policy after
their remote identities were re-resolved. On 2026-08-27, `.10` release ID `377351189` and its matching tag were removed
only after `.11` was independently verified. Audits confirmed every deletion target's exact candidate and 20-asset
manifest first, then confirmed its release and tag absent while `.11` still resolved to
`830e62c281d76b71b2f6a989100e85dc1511f2b1` with all 20 assets. Removed release assets and tags are no longer
recoverable from GitHub; Actions audit history remains. The sole prerelease for every other upstream version was
untouched by the v7.4.23 cleanup.

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

The separate historical v7.4.1 line had two published prereleases. `v7.4.1-lcm.1` release ID `350208679` was
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
`ce4d4c059f49295f4b9220d11680d87f71ae1c58` were removed on 2026-08-26 only after those identities were re-resolved
and `.2` was reverified. A post-deletion audit found no release or tag for `.1` and reconfirmed `.2` with all 20 assets.
The removed assets and tag are not recoverable from GitHub; Actions audit history remains.

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

Release notes retain the audit history of superseded builds, and healthy older prereleases remain available for
rollback. A newer or better-scoring release does not authorize deletion. Removal requires separate authorization or
an exact known-faulty tag, release ID, candidate SHA, and documented defect recorded here before replacement. Verify
the replacement first, then capture and re-resolve those identities before deleting only that release ID and matching
tag.

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
