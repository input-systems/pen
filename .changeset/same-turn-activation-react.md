---
"@input/pen-react": patch
---

The toggle empty state, the toolbar block-type select and the slash menu's table insert activate the new block or cell in the same turn instead of waiting an animation frame; the new block's mount ack projects the caret once it renders.

Breaking: no
