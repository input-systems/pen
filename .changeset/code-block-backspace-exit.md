---
"@input/pen-core": patch
---

Backspace in an empty code block now converts it to a paragraph, the same as an empty heading, list item or quote. Before, a code block had no exit of its own: Backspace only removed it by merging towards the block above, so a code block that opened the document could never be turned back into a paragraph. An empty code block below another block now takes two presses to remove (convert, then delete) where it took one.

Breaking: no
