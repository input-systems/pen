---
"@input/pen-yjs": patch
---

Load-time repair no longer removes a `blockOrder` entry whose block map is still in flight (COL4, DUR2). Like normalization's dangling-entry rule, it now removes an entry only when the blocks map holds a deletion for that id, so a document persisted after an order entry arrived ahead of the block map another client wrote keeps the entry, and the block lands in place when its map arrives instead of being left in no array.

Breaking: no
