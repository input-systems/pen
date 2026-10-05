---
"@input/pen-core": patch
---

Report a block removed, not moved, when one commit drops one of its two order entries and deletes its map. Concurrent moves can list a block in two arrays (COL4); a peer's undo that drops one entry, delivered with a delete that took the block's map, was reported as a move to the surviving entry, so the block notifier kept the dead entry in its root ids. Such a block is now reported `block-removed` where it sat, as a move arriving with the delete of the block it moves already is.

Breaking: no
