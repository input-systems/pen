---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-dom": patch
---

Merging a numbered list item into a block outside its run now renumbers the run it left (AX1). A merge reports `blocks-merged` instead of the source's `block-removed` (OB1), so the block notifier never saw the root slot the source vacated: when the target sat in a `children` array or far from the source, and the source was a `parentId` child, the items after it kept their old ordinals. `blocks-merged` now carries `sourceParentId` / `sourceIndex`, the array and pre-commit index the source vacated, and the notifier re-walks the numbered run around that slot.

Breaking: no
