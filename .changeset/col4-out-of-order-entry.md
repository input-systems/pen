---
"@input/pen-types": patch
"@input/pen-yjs": patch
"@input/pen-core": patch
---

Keep an order or children entry whose block map has not arrived yet instead of removing it as dangling (COL4). Out-of-order delivery can land an order entry one client wrote before the block map another client wrote; normalization now removes an entry only when the blocks map holds a deletion for its id, read through the new optional `CRDTAdapter.isBlockDeleted(doc, blockId)`, which `yjsAdapter` implements.

Breaking: no
