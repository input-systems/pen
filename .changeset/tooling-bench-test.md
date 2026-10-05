---
"@input/pen-bench": patch
"@input/pen-test": patch
---

Scale measurement and multi-peer test tooling.

- `@input/pen-test` adds:
  - `createPeerHarness(n)`, with seeded delivery schedules (`PEER_SCHEDULES`, `runPeerSchedules`), `quiesce()` and an awareness relay. `createTwoPeerHarness()` is now its two-peer form and also destroys each `Y.Doc`.
  - The COL4 structural oracle (`findStructuralViolations`, `assertStructuralInvariants`).
  - `createScanProbe(editor)` for counting document reads.
  - The mixed 1k–50k block fixture (`generateMixedBlockSpecs`, `mixedFixtureOps` and related helpers).
- `@input/pen-bench` adds:
  - A realistic SCALE3 variant with AI and search installed.
  - A synced-peer SCALE3 axis.
  - Structural-commit read gates.
  - Renderer rows in `ENVELOPE.md`, and a measured concurrent-peer row.
  - The envelope re-recorded on a quiet machine.
- `bench:caches` fails on any diagnostic except `anchor-budget`.

Breaking: no
