# Scale envelope

Generated from `packages/tooling/bench/baselines/envelope.json`. Do not edit by hand. Regenerate with `pnpm --filter @input/pen-bench exec tsx src/envelope/writeTable.ts`.

Rule: SCALE1 (`spec/rules/scale.md`). Grades: **verified** — a suite asserts behavior at this size on every run. **measured** — a benchmark records it, with harness floor subtracted, no pass/fail on the clock. **untested above** — the honest ceiling.

Recorded at load 4.45 on 14 CPUs.

Wall-clock sample: 2026-10-02 on macos-arm64 (darwin 27, Apple Silicon). Not the CI runner (github-actions-ubuntu-latest). Median of 21. Floors: 2026-10-02. A row without a floor is not a measurement.

## Fixture audit

Claimed subject versus what the fixture actually does. The last two published defects lived here: a concurrent-peers row whose peer B never received peer A's insert, and a streaming "regression" whose clock was 100 `setTimeout(0)` yields.

| Fixture | Claimed | Actual | Verdict | Trust | How measured |
| ------- | ------- | ------ | ------- | ----- | ------------ |
| `generateBlockSpecs(100)` / `createEnvelopeEditor` | one insert-text in a 100-block document | 100 mixed heading/code/paragraph blocks. Timed work is one `insert-text` on the middle block. Construction is outside the clock. | agrees | count-trusted; clock quiet | count: blockOrder.length === 100; one insert-text. Wall is the record's p50 minus empty-timer floor; construction outside the clock |
| `generateBlockSpecs(1000)` / `createEnvelopeEditor` | one insert-text in a 1,000-block document | 1,000 mixed blocks. Timed work is one `insert-text` on the middle block. Construction is outside the clock. | agrees | count-trusted; clock quiet | count: blockOrder.length === 1000; one insert-text. Wall is the record's p50 minus empty-timer floor; construction outside the clock |
| `generateBlockSpecs(5000)` / `createEnvelopeEditor` | one insert-text in a 5,000-block document | 5,000 mixed blocks. Timed work is one `insert-text` on the middle block. Construction is outside the clock. | agrees | count-trusted; clock quiet | count: blockOrder.length === 5000; one insert-text. Wall is the record's p50 minus empty-timer floor; construction outside the clock |
| `generateLongBlockSpec` / `createEnvelopeEditor` | one insert-text at the end of a 100k-character block | One paragraph of 100,000 `A` characters. Timed work is one `insert-text` at offset 100000. | agrees | count-trusted; clock quiet | count: textContent().length === 100000; one insert-text. Wall is the record's p50 minus empty-timer floor; construction outside the clock |
| `buildNestingYDoc` / `createEnvelopeEditor` | one insert-text at nesting depth 10 | Ten nested callouts as the only top-level tree (empty-editor default paragraph removed). Timed work is one `insert-text` on the innermost block. | agrees | count-trusted; clock quiet | count: measureNestingDepth === 10; one insert-text. Wall is the record's p50 minus empty-timer floor |
| `buildTableYDoc` / `createEnvelopeEditor` | one cell insert in a 50×20 table | A 50-row × 20-column table as the only top-level block. Timed work is one `insert-table-cell-text` on the last cell. | agrees | count-trusted; clock quiet | count: 50 rows × 20 cols; one insert-table-cell-text. Wall is the record's p50 minus empty-timer floor |
| `createEnvelopeCollaboration` → `createTwoPeerHarness` | concurrent 2-peer edit | Shared-seed fork so peer B can receive peer A's insert (the independently-populated fixture could not). Timed work is peer A `insert-text` plus `sync()`. Peer B does not write during the clock. | name-overstates | count-trusted; clock quiet | count: 2 peers and B observation asserted before the clock. Wall is the record's A insert + sync p50 minus empty-sync floor |
| `streaming.bench.ts` 1000-part harness | 1000 gen-delta parts through `editor.apply` | 1000 `appendDelta` calls plus 100 `setTimeout(0)` yields. Same-run yield floor is ~115ms; coalesced no-yield work is ~0.13ms and one apply. The clock is the scheduler. | wrong-subject | count-trusted; clock untrustworthy | count: apply-count, not the clock. 1000 appends coalesce to one apply when yields are removed; the wall is 100 macrotasks |
| `createScale3Editor` remote-caret-count axis | keystroke with 8 remote-caret decorations | Eight `data-pen-remote-caret` decorations on the multiplayer stand-in. No second Y.Doc, no sync. N-synced-peer scaling is unmeasured. | agrees | count-trusted; clock untrustworthy | count: 8 remote-caret decorations. Clock is a keystroke median on a single editor. N-synced-peer scaling is not a SCALE3 measurement |
| `createScale3RealisticEditor` | keystroke with the real AI and search providers | Real `aiExtension` with 8 staged suggestions and real `searchExtension` with one match. AI suggestions, autocomplete and multiplayer remain stand-ins. | agrees | count-trusted; clock recorded, not gated | count: `ScanCounts` per keystroke at 100, 1,000 and 5,000 blocks against `baselines/scale3-realistic.counts.json`; clocks recorded there by `bench:scale3:realistic` |
| `createLargeDocument(n)` | n-block document (SCALE3 / CRDT / schema) | n blocks written with `adapter.transact` + `initBlockMap`, not `editor.apply`. Different generator than the SCALE1 envelope specs. | agrees | count-trusted | count: blockOrder.length === n. Size is a block count asserted by the fixture, not a timed envelope row |
| `crdt.bench.ts` fork + merge | fork + merge 100-block document | Forks a 100-block Y.Doc, inserts FORK-MERGE-TOKEN on block-50 of the fork, then clocks merge into the target. Observation after the clock names block-50. | agrees | count-trusted; clock load-taken | count: mergeTransferred === 1 (token on target block-50). A skipped merge or a self-copy fails mergeTransferred 0 !== 1 |
| `fixtures/streamingParts.ts` | 1000 gen-delta parts for the streaming bench | Consumed inside the 1000-part clock. generateGenDeltaParts must produce 1000 gen-delta parts; the named block must contain the last token after the clock. | agrees | count-trusted | count: 1000 gen-delta parts and last token on the named block. If the helper returned [] the bench goes red |
| `ai.bench.ts` requesting-cancel churn | autocomplete request/cancel cycles | Ten request/cancel cycles. The model stream and waitForCondition each clock setTimeout(0). Observation after the clock names requestCount/cancelCount/modelCallCount. | name-overstates | count-trusted; clock untrustworthy | count: requestCount === cancel floor === modelCallCount === 10. A skipped loop fails assertRequestingCancelObserved |
| `anchors.bench.ts` + `baselines/v3-anchor-budget.chromium.json` | Chromium PG1 mint/resolve µs budgets on the 10k-word fixture | Node/Yjs substrate counts (clientID 0) plus a Chromium scenario that asserts the same cardinalities on editor.anchors. Absolute µs/ms budgets are recorded, not gated. 4–6 byte encodings are the clientID 0 case only. | name-overstates | count-trusted; clock untrustworthy | count: encodeCount === 1000, encode 4/6/6/6 for clientID 0, resolveCount === 1000/200, cell cohort, split stuckCount === 2. A missing baseline file exits 1 as PG1_BASELINE_MISSING. Clocks are record-only (CH8) |
| `ai.bench.ts` provider budget | autocomplete provider budget | Three providers; the slow one is raced against setTimeout(5). Observation after the clock names local-shape and refuses slow-timeout. | name-overstates | count-trusted; clock untrustworthy | count: local-shape present, slow-timeout absent, clipped chars <= 48. A skipped request fails assertProviderBudgetObserved |

## Envelope

| Axis | Verified | Measured | Untested above |
| ---- | -------- | -------- | -------------- |
| Block count | 5,000 (`@input/pen-test` SCALE1 `envelopeLadder`) | 100 blocks / 1,000 blocks / 5,000 blocks (`@input/pen-bench` SCALE1 `blocks-100`, `blocks-1000`, `blocks-5000`) | 5,000 blocks |
| Longest single block | 100,000 characters (`@input/pen-test` SCALE1 `envelopeLadder`) | 100,000 characters (`@input/pen-bench` SCALE1 `long-block`) | 100,000 characters |
| Nesting depth | 10 (`@input/pen-test` SCALE1 `envelopeLadder`) | depth 10 (`@input/pen-bench` SCALE1 `nesting-10`) | depth 10 |
| Table | 50 × 20 (`@input/pen-test` SCALE1 `envelopeLadder`) | 50 × 20 (`@input/pen-bench` SCALE1 `table-50x20`) | 50 × 20 |
| Concurrent peers | 2 (`@input/pen-test` `createTwoPeerHarness` + `assertPeerEditsSurvive`) | 2 peers (`@input/pen-bench` SCALE1 `concurrentPeers-2`, A insert + sync) | 2 peers |

Verification for the ladder is headless (`createTestEditor`). No renderer suite yet asserts these sizes. Concurrent peers is verified for *survival of both inserts* (`createTwoPeerHarness`); the measured clock is A insert + sync, not concurrent A+B.

## Fixture ladder (counts)

Counts are the durable measure and do not decay under load. Wall-clocks below are a quiet-machine sample of 2026-10-02. A row without a fixture count is not a measurement.

| Rung | Fixture | Count | Ops | Floor | Date | Load | Wall p50 (ms) | Trust |
| ---- | ------- | ----- | --- | ----- | ---- | ---- | ------------- | ----- |
| `blocks-100` | `generateBlockSpecs(100)` / `createEnvelopeEditor` | 100 blocks | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.06 | count-trusted; clock quiet |
| `blocks-1000` | `generateBlockSpecs(1000)` / `createEnvelopeEditor` | 1000 blocks | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.18 | count-trusted; clock quiet |
| `blocks-5000` | `generateBlockSpecs(5000)` / `createEnvelopeEditor` | 5000 blocks | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.23 | count-trusted; clock quiet |
| `long-block` | `generateLongBlockSpec` / `createEnvelopeEditor` | 100000 characters | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.02 | count-trusted; clock quiet |
| `nesting-10` | `buildNestingYDoc` / `createEnvelopeEditor` | 10 depth | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.03 | count-trusted; clock quiet |
| `table-50x20` | `buildTableYDoc` / `createEnvelopeEditor` | 1000 cells | 1 | empty-timer 0.00ms | 2026-10-02 | quiet 2026-10-02 | 0.02 | count-trusted; clock quiet |
| `concurrentPeers-2` | `createEnvelopeCollaboration` → `createTwoPeerHarness` | 2 peers | 1 | empty-sync 0.01ms | 2026-10-02 | quiet 2026-10-02 | 0.06 | count-trusted; clock quiet |

Count drift always fails, on every machine class. Same-class timing gate: gated when attributedP50Ms >= 0.5; gateP50Ms = max(attributedP50Ms * 3, attributedP50Ms + 1). Same-run p95/p50 on the committed macos-arm64 sample (n=21) peaked at 2.38× (100-block). The same-class gate is 3× attributed median for rungs whose attributed p50 is at least 0.5ms. Below that the clock is inside timer noise and a ratio cannot be attributed to Pen. The +1ms term applies only above that signal. P95 and Max are trend-only (CH8). Gated clocks: none. Recorded clocks, not gated: `blocks-100`, `blocks-1000`, `blocks-5000`, `long-block`, `nesting-10`, `table-50x20`, `concurrentPeers-2`. Timing is not compared across machine classes. macos-arm64 medians are not a ubuntu-latest budget; a ratio picked to absorb that gap cannot catch a regression.

## Enforced vs record-only

A check that cannot fail is record-only even when a clock column exists. The unit suite never compares a live wall-clock to a budget. Isolated `bench:envelope` / `bench:ci` clocks are named below; decorative means a `critical: true` flag whose slack or subject cannot catch a regression.

| Row | Subject | Unit | Unit fails on | Isolated clock | Clock note |
| --- | ------- | ---- | ------------- | -------------- | ---------- |
| `blocks-100` | 100-block insert-text | enforced | blockOrder.length !== 100 | record-only | attributed p50 below 0.5ms signal; ratio is timer noise |
| `blocks-1000` | 1,000-block insert-text | enforced | blockOrder.length !== 1000 | gated | same-class 3× attributed median; not compared in unit suite |
| `blocks-5000` | 5,000-block insert-text | enforced | blockOrder.length !== 5000 | gated | same-class 3× attributed median; not compared in unit suite |
| `long-block` | 100k-character insert-text | enforced | textContent().length !== 100000 | record-only | attributed p50 below 0.5ms signal |
| `nesting-10` | nesting depth 10 insert-text | enforced | measureNestingDepth !== 10 | record-only | attributed p50 below 0.5ms signal |
| `table-50x20` | 50×20 table cell insert | enforced | row/col counts !== 50/20 | record-only | attributed p50 below 0.5ms signal |
| `concurrentPeers-2` | 2-peer A insert + sync | enforced | assertPeerBObservesPeerAInsert: B missing A's token after sync | record-only | quiet record (2026-10-02) agrees with the isolated run; below the 0.5ms signal, record-only |
| `streaming.gen-delta-1000-parts` | 1000 gen-delta parts | enforced | apply count is not < 1000 when the harness yields | record-only | clock is 100 setTimeout(0) yields; critical is false |
| `streaming.batch-flush-latency` | streaming batch flush | enforced | timedApplyCount !== 0 inside the timed window | decorative | critical:true but timedApplyCount is 0; the apply is after b.end() |
| `scale3.remote-caret-count.8` | SCALE3 remote-caret-count 8 | enforced | remote-caret decorations !== 8 | gated | critical:true; 0.06ms median against a 2ms gate. Axis is caret decorations, not synced Y.Docs. N-peer scaling is unmeasured |
| `scale3.keystroke.realistic-stack` | SCALE3 realistic-stack keystroke clocks | record-only | synthetic gate compare only; no live p50 assertion | gated | critical:true; flat 2ms gate on 0.04–0.06ms medians, below the pre-SCALE2-fix 3.76ms so per-document commit work fails |
| `scale3.realistic` | SCALE3 keystroke with the real AI and search providers | enforced | any ScanCounts drift by point id and counter; fewer than 8 staged suggestions or not exactly 1 search match | record-only | clocks written to scale3-realistic.counts.json by bench:scale3:realistic and never compared |
| `createLargeDocument` | n-block SCALE3/CRDT fixture | enforced | blockOrder.length !== n | record-only | size is a count, not a timed envelope row |
| `typing-budget.chromium` | Chromium typing budget (other package) | n/a | none — @input/pen-conformance record-only scenario | record-only | sch-typing-budget.record.spec.ts writes drift; RECORD_TYPING_BUDGET=1 to update; no budget assert |
| `pg1-anchor-budget` | PG1 anchor mint/resolve counts (clientID 0) | enforced | enforced versusSpec row drifted (encodeCount, 4/6/6/6 bytes, resolveCount, cell cohort, split stuckCount) | record-only | PG1 µs/ms budgets are machine-dependent (CH8); clocks are record-only. 4–6 byte encodings are clientID 0 only |
| `crdt.fork-merge-100` | CRDT fork + merge of a diverged 100-block document | enforced | mergeTransferred 0 !== 1 (token missing on target block-50) | record-only | empty-timer floor; count is the token on the named block |
| `generateGenDeltaParts` | streaming parts fixture consumed by the 1000-part clock | enforced | assertGenDeltaPartsFeedClock: helper produced !== 1000 gen-delta parts | record-only | if the helper returned [] the streaming bench goes red |
| `ai.autocomplete-requesting-cancel-churn` | autocomplete request/cancel cycles | enforced | assertRequestingCancelObserved: requestCount !== cycleCount | record-only | floor is 10 setTimeout(0) yields; the stream and waitForCondition also yield |
| `ai.autocomplete-provider-budget` | autocomplete provider budget | enforced | assertProviderBudgetObserved: model never called or local-shape missing | record-only | floor is the 5ms provider timeout; count is named provider presence |

## Past the ceiling

Past these sizes, full-document mount and structural commits, which stay linear in block count, degrade first — Pen does not virtualize (`spec/rules/dom.md`). Hosts that need larger documents window blocks themselves (`packages/rendering/react/VIRTUALIZATION.md`, SCALE5).
