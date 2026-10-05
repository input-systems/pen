---
"@input/pen-dom": patch
---

Let a shift-click on an inline atom extend from a block or cell selection in another block (T5). The atom's own shift-click handler only stepped aside for a text anchor, so on React a block-selected paragraph plus a shift-click on a mention in another block selected just the mention instead of extending from the block's start, as vanilla and Vue do.

Breaking: no
