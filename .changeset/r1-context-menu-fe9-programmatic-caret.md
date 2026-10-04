---
"@input/pen-dom": patch
---

Fix two selection bugs: the context-menu gesture window now closes on every `selectionchange` after `contextmenu`, including one that echoes the record, so a later out-of-gesture range change is no longer accepted (R1); and an EditContext keystroke after a host `editor.selectText` (or any other non-typing selection write) now lands at the new caret instead of the last typed one (FE9).

Breaking: no
