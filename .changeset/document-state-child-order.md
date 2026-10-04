---
"@input/pen-core": patch
---

`documentState.childrenOf` and the nested preorder (`preorderBlockIds`, `preorderIndexOf`) follow a reorder within one `children` array again, local or remote (SCALE2, RI6). Since the SCALE2 change a `move-block` to another index of the same parent left both stale until an unrelated top-level length change, so a range over the reordered children resolved in the old order and a range delete could remove a block outside the selection. Each commit now compares only the touched parents' arrays with the index and re-reads the one that changed, without a full rebuild.

Breaking: no
