---
"@input/pen-dom": patch
---

Deleting a block that reaches its container through `parentId` now re-segments that container's list and renumbers its remaining items in every binding (AX1). The removal's change summary names no parent for that route, so the block notifier walked only the root list and the container kept the deleted item in its segments while its siblings kept their old `aria-posinset` / `aria-setsize`. The notifier now also walks the container that last rendered the removed block.

Breaking: no
