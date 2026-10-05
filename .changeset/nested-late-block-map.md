---
"@input/pen-core": patch
---

Put a nested block into the preorder when its block map arrives after its `children` entry. Out-of-order delivery can land a peer's move into a container before the block map another peer wrote; the preorder skipped the entry while the map was missing and never revisited it, so `preorderIndexOf` returned -1 and preorder-scoped consumers such as search never saw the block. The arrival now re-walks the parent's preorder span.

Breaking: no
