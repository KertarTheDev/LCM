# LCM Fixture Skeletons

This directory indexes technical closure artifacts that are required by milestone owners. A skeleton is a planning artifact only: it names the expected fixture, owner milestone, blocking path, and evidence shape so teams do not invent incompatible proofs later.

`manifest.json` is the machine-readable index for the current public fixture set. An entry with `implemented: false` must not be cited as passing evidence. The owning area must replace or extend the skeleton with runnable commands, real fixture data, OS/date/result evidence, and any approved deviation before the consumed behavior proceeds.

Current skeleton groups:

- `message-v2/`: current Kilo `MessageV2` shape and taxonomy drift report.
- `release-scenario/`: machine-readable long-context release report skeleton.
- `provider-safe-assembly/`: active render-unit, provider protocol, cue placement, and long-context release fixture skeletons.
- `context-regression/`: raw-backlog soft maintenance, maintenance summary quality, and context regression fixture/report schemas.
