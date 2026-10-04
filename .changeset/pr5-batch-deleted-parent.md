---
"@input/pen-core": patch
---

Drop an `insert-block` or `move-block` into a parent deleted earlier in the same `apply` batch with `PEN_APPLY_003` (PR5), instead of writing the block into the deleted parent's array and leaving it outside the tree. Validation now reads block liveness as the batch leaves it, so a block deleted and re-inserted in one batch can be targeted again.

Breaking: no
