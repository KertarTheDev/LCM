# LCM Current-Code Issues

Status date: 2026-06-19.

This document records code issues noticed during the current-code specification rebaseline that appear to need fixes for LCM to work correctly.

## Current Findings

No new current code issue requiring an implementation fix was identified during this documentation rebaseline.

The rebaseline inspected the current runtime, prompt integration, retrieval, file/provenance, map, settings, VSCode webview, package scripts, and maintainer acceptance documentation.

## Evidence Gaps

The remaining gap is external release evidence, not a known code defect:

- Installed-editor evidence from a candidate VSIX still has to be collected on maintainer-selected target editors.
- Strict long-context release approval requires packaged-runtime DB smoke and any required external/manual evidence; source-tree checks alone are not enough.

The broader maintainer acceptance review records release gates, migration policy documentation, maintainability hardening, and CI/drift ownership. The remaining hard blocker is external installed-editor and packaged-runtime evidence.

Do not treat historical issue notes or archived milestone findings as active defects unless they reproduce against the current branch.
