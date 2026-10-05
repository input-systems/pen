---
"@input/pen-yjs": patch
"@input/pen-core": patch
---

Report an order entry removed when its block map arrived and was deleted in the same commit. A merged or late update can carry a block's insert, its delete, and a peer's move of it together; the summary took the map's arrival for an ordinary insert and reported `block-inserted` for a block that does not exist, so renderers drew a dead entry. The summary source now lists the changed block-map entries it found absent (`RawCommitDelta.absentBlockIds`, read from the block map read it already makes), and such an entry reports `block-removed` where it sits with no extra document read.

Breaking: no
