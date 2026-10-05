# Scale envelope

Generated from `packages/tooling/test/src/fixtures/envelope/metadata.json`. Do not edit by hand. Regenerate with `node scripts/envelope-table.mjs`.

Published next to the HOST3 runtime floor (`spec/rules/host.md`). Rule: SCALE1 (`spec/rules/scale.md`).

## Envelope

| Axis | Verified | Measured | Untested above |
| ---- | -------- | -------- | -------------- |
| Block count | 5,000 (`@input/pen-test` SCALE1 `envelopeLadder`) | 1,000 (`@input/pen-bench` `createLargeDocument`) | 5,000 |
| Longest single block | 100,000 characters (`@input/pen-test` SCALE1 `envelopeLadder`) | — | 100,000 characters |
| Nesting depth | 10 (`@input/pen-test` SCALE1 `envelopeLadder`) | — | 10 |
| Table | 50 × 20 (`@input/pen-test` SCALE1 `envelopeLadder`) | — | 50 × 20 |
| Concurrent peers | 5 (`@input/pen-test` `createPeerHarness` + `assertPeerEditsSurvive`) | — | 5 |

Grades: **verified** — a suite asserts behavior at this size on every run. **measured** — a benchmark records it, no pass/fail gate. **untested above** — the honest ceiling.

Verification for the ladder is headless (`createTestEditor`). No renderer suite yet asserts these sizes.

## Fixture ladder

| Rung | Size | Storage |
| ---- | ---- | ------- |
| `blocks-100` | 100 blocks | committed `src/fixtures/envelope/committed/blocks-100.json` |
| `blocks-1000` | 1,000 blocks | generated at runtime |
| `blocks-5000` | 5,000 blocks | generated at runtime |
| `long-block` | 100,000 characters | generated at runtime |
| `nesting-10` | depth 10 | generated at runtime |
| `table-50x20` | 50 × 20 | generated at runtime |

5,000-block and 1,000-row fixtures are generated at runtime rather than committed: a Yjs dump of those sizes is large and adds nothing beyond the generator plus this table. The committed 100-block JSON is the checked-in rung; every other size is produced by the same scripts.

## Past the ceiling

Past these sizes, per-commit decoration collection and full-document render degrade first — Pen does not virtualize (`spec/rules/dom.md`). Hosts that need larger documents window blocks themselves (`packages/rendering/react/VIRTUALIZATION.md`, SCALE5).

## Correction notes

- 2026-08-21 / 2026-08-24: Concurrent peers stayed at **2**, but the earlier verified grade did not measure collaboration. Independently populated Y.Docs exchange full state and LWW-keep one `Y.Text`; the 2026-08-24 probe ended at `Hello B` on both sides (later client id wins; the 2026-08-21 note said `Hello A`). `assertDocEquals` still passes on that loss. `createTestCollaboration` now forks both peers from one encoded seed (`createTwoPeerHarness`). The grade is re-verified by `assertPeerEditsSurvive` plus the merged text `Hello A B` / `Hello B A`, which fail on that independently-seeded fixture and pass on the shared-seed harness. Re-measured the bench row on that harness: published path (A insert + sync) p50 0.198 ms versus the committed 1.49 ms; concurrent A+B insert + sync p50 0.434 ms; empty-timer floor p50 0.000 ms (n=21). The table number is the peer count, not the clock.
