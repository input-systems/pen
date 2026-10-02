---
"@input/pen-core": minor
---

Block revisions advance only for the blocks a commit changed, including remote and undo structural commits (SCALE2). A structural commit rebuilds the change-summary block index without reading the text of blocks its summary does not name, and the index takes ownership of the fresh snapshot instead of cloning it. An `insert-block` or `move-block` into a `{ parent }` that does not exist is now dropped with `PEN_APPLY_003` (PR5); before, an insert left an orphaned block and a move detached the block from the tree.

Breaking: yes — `editor.getBlockRevision()` no longer advances for blocks a remote or undo structural commit did not touch; hosts that used a revision bump on every block as a "something structural happened" signal must listen to `commit` events instead.
