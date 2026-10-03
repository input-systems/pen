---
"@input/pen-bench": patch
---

`ENVELOPE.md` gains a Renderer section: one row per surface (React, Vue, vanilla) at 1k, 5k, 10k and 50k root blocks, graded measured, generated from the conformance `scale-render` clocks with a Pen-removed floor. `EnvelopeRecord` gains `renderer`, the new `bench:envelope:renderer` script regenerates it, and `bench-envelope-drift` fails when either the rows or the table drift from their source.

Breaking: no
