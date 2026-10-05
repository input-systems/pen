---
"@input/pen-core": patch
"@input/pen-yjs": patch
---

Report what a commit did to blocks that arrive or survive under COL4 states, so per-block indexes stay equal to a full recompute (OB, SCALE2). A block that arrives with a `children` array (an undo restoring a container, a peer's insert, a first child creating the array) now reports each descendant `block-inserted`, read from the new optional `RawCommitDelta.arrivedChildArrays`; a repair that removes one of a block's two entries reports `block-moved` to the surviving one instead of `block-removed`; an inserted entry without a block map reports `block-removed`, and a map arriving for an already listed entry reports `block-inserted`; an entry deleted and re-inserted in one commit reports `block-moved` even when its indexes coincide. The change-summary block index rebuilds on any array edit or block-map arrival, and the document index follows the blocks a commit's summary names as well as those its ops wrote, and drops its preorder when a root entry's block map leaves or arrives.

Breaking: no
