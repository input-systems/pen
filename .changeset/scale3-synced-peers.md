---
"@input/pen-bench": patch
---

SCALE3 gains a synced-peer axis: one keystroke on real forked `Y.Doc`s at 2, 4 and 8 peers, each with the real `multiplayerExtension`, gated on counts in `baselines/scale3-peers.json` (deliveries, remote commits, blocks per remote commit, remote carets on the typist, peers observing the keystroke). `bench:scale3:peers` records the typist and fan-out clocks beside an empty-relay floor; they are not gated. `SCALE3_AXES` lists `synced-peer-count`, and an axis may have more than two points.

Breaking: no
