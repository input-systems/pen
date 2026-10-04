---
"@input/pen-dom": patch
---

Withhold a P2 divergence projection while editor chrome inside the root owns focus. A block handle, a detached menu item or a toolbar button keeps focus; previously, a native range left divergent by a block reorder (reported by Firefox) was projected back into the field and took focus from the block handle that AX3 had just returned it to.

Breaking: no
