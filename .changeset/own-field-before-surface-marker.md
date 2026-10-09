---
"@input/pen-dom": patch
---

A selection a `selectionChange` listener writes in the same turn as a multi-block range is projected. The expanded blocks host counted as a foreign text control until the framework binding painted its field-surface marker, so the write was withheld and focus fell to the document body with the earlier range left in the DOM (HOST9).

Breaking: no
