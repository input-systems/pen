---
"@input/pen-dom": patch
---

Keep the block notifier's list segments and selection slices equal to a fresh read (AX1, SCALE6). Merging a `parentId`-route child away, moving one into a `children` array, and a move into an array the index resolves elsewhere now re-segment the container the block left and the array it entered; a selection that changes kind re-slices the blocks inside both selections; and a structural commit re-slices a multi-block text range's endpoints, whose partial ranges follow their document order.

Breaking: no
