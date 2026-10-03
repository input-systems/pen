---
"@input/pen-core": patch
---

Normalization now removes `blockOrder` and `children` entries whose block no longer exists, emitting one `dangling-block-reference` diagnostic per removed id per pass, so a concurrent delete and move no longer leave a dangling or duplicate order entry (COL4). The same structural pass keeps a block that concurrent moves placed under several parents only under the parent whose id sorts lowest, keeps one entry per id in a `children` array, and re-homes a block detached by a children-array cycle break at the end of the root order. The repair reads liveness from the pass-index walk it already performs, so it adds no document reads (SCALE2).

Breaking: no
