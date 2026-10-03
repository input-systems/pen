---
"@input/pen-core": patch
"@input/pen-dom": patch
---

COL4: a remote delete against a concurrent move no longer leaves a deleted block on screen. The move keeps the block's order entry, so the commit used to name nothing; its summary now reports `block-removed` for a block whose map entry the commit deleted, and the block notifier drops ids it saw die from `rootIds`, so React, Vue, and vanilla stop rendering the dead entry until the next local structural pass removes it.

Breaking: no
