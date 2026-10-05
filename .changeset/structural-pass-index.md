---
"@input/pen-core": patch
---

The normalization pass index is no longer rebuilt from the whole document after every structural commit (SCALE2). The block executors and the pass's own repairs advance it at each write, a remote or undo commit advances it by its delta, and the executors resolve `after` / `before` positions and find a block's entries through it instead of scanning `blockOrder` and every block's `children`. Where a block is listed by several `children` arrays (COL4), the lowest parent id is now the one the structural rules treat as its container, matching the parent Rule 11 keeps, so the choice no longer depends on block-map iteration order. Normalized documents are unchanged.

Breaking: no
