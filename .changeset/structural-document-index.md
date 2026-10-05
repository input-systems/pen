---
"@input/pen-core": patch
---

`documentState` no longer rebuilds its position, parent and child indexes when a commit inserts, deletes, splits or moves a root block (SCALE2). Each transaction's `blockOrder` delta advances the root order in place, positions after an edit are re-indexed lazily, a removed block leaves the parent and child indexes, and a root block placed under a `parentId` joins its parent's children in root order; a root order that lists an id twice (COL4), or a delta that does not fit, still rebuilds. `documentState.blockOrder` is still a fresh array after every root edit. The DUR3 unknown-type sweep now runs on the first apply after a load and otherwise checks only the blocks a remote or undo commit stored or retyped, instead of every block after each structural commit. The commit dispatch, the summary and both indexes share one read of each named block map per commit.

Breaking: no
