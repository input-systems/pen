---
"@input/pen-core": patch
---

Report a duplicate order entry that lands directly before the original. When two peers move one block to the same place, each delivery adds a second entry for it; one that landed directly before the receiver's own entry read as a move to the index the block already held and was dropped, so the commit's summary was empty and renderers kept a root list one entry short. It now reports `block-inserted` at the new entry.

Breaking: no
