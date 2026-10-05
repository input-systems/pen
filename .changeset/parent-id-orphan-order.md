---
"@input/pen-core": patch
---

Order a `parentId` child that lost its root entry as a rebuild does. A remote or undo commit can remove such a child's order entry without placing it anywhere else (COL4, until the next local pass re-homes it); `documentState` kept it where it was among its parent's children while a rebuild orders it first, so `childrenOf` depended on whether the index had been rebuilt. That commit now rebuilds the document index (SCALE2).

Breaking: no
