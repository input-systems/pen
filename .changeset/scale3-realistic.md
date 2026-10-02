---
"@input/pen-bench": patch
---

Add a realistic SCALE3 variant, `createScale3RealisticEditor()` with `observeScale3Realistic()`, that types into a document held by the real `aiExtension` with eight staged suggestions and the real `searchExtension` with an active query. Its per-keystroke document reads at 100, 1,000 and 5,000 blocks are committed in `baselines/scale3-realistic.counts.json` and compared exactly, and `bench:scale3:realistic` records clocks beside them without comparing. The envelope audit gains a `scale3.realistic` row with a `not-gated` clock trust.

Breaking: no
