---
"@input/pen-core": patch
---

Keep every block on one nesting route (RI6). `delete-block` on a container now deletes its `children`-array descendants instead of leaving their block maps in storage outside every array, and normalization clears a `parentId` on a block stored in a different block's `children` array with a `nesting-route-conflict` diagnostic, so the reported parent no longer depends on map iteration order across peers.

Breaking: no
