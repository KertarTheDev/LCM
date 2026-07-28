# Release support

Status: normative v7.4.16 release policy.

The product branch remains a direct, narrow augmentation of upstream tag `v7.4.16`
(`f80ebff83b32550333da7c50c91c4755e4524d0d`). Correct the product branch with ordinary reviewable commits; do not
rewrite its published history or replay old LCM branches.

The faulty public `v7.4.16-lcm.2` has no compatibility contract. After the fixed product and packaged candidate are
fully verified:

1. push the verified product branch;
2. reconstruct the narrow prerelease overlay directly on that product SHA;
3. push `kilocode-lcm-prerelease` with an exact fetched force-with-lease;
4. dispatch the prerelease workflow for the exact corrected candidate SHA and require version
   `v7.4.16-lcm.3`;
5. verify a non-draft prerelease at the exact SHA with the exact expected 20 assets and packaged-runtime smoke;
6. re-resolve and delete only the captured faulty `v7.4.16-lcm.2` GitHub release ID, its exact matching tag, and
   assets;
7. verify the old release and tag are absent while retaining Actions run audit history; and
8. confirm upstream version/build/publish jobs remained skipped.

If replacement publication fails, delete only the captured failed draft/release and matching tag. Do not restore the
incorrect prerelease.

Release evidence includes clean second generation, focused/affected suites, annotations, VS Code compile/snapshot and
install identity, relevant JetBrains checks, extracted CLI/VSIX smoke, exact source/artifact hashes, and final clean
status.
