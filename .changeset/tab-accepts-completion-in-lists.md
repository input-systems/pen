---
"@input/pen-dom": patch
---

Tab accepts a visible inline completion inside a list item instead of nesting the item. The completion is checked before the default keymap, so `pen.indent` no longer wins the key. Shift-Tab still outdents while a completion is visible, and Tab still nests when none is.

Breaking: no
