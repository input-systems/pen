---
"@input/pen-core": patch
---

Skip order and children entries whose block map is gone (COL4) in `editor.blocks()`, `blockCount()`, `firstBlock()`, `lastBlock()`, `documentState.blocks`, `documentState.blockCount` and `preorderBlockIds()`, so a concurrent delete-against-move no longer hands out a handle that throws `Block not found`, and range commands no longer emit `delete-block` for the missing block before the structural pass removes the entry.

Breaking: no
