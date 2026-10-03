---
"@input/pen-bench": patch
"@input/pen-test": patch
---

SCALE1's concurrent-peer row is measured, not asserted: `concurrentPeers-2` counts the peers that observed every peer's insert after sync, so a dropped delivery lowers it and fails drift by name. The envelope grades concurrent peers verified at five (`createPeerHarness` + `assertPeerEditsSurvive`) and measured at two.

Breaking: no
