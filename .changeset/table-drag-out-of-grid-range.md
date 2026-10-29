---
"@input/pen-dom": patch
---

A drag that starts in a table cell and leaves the grid now shows its selection. The editor already held the right range, from the table at offset 0 to the drag's end (T2), but the expanded host refused to attach because the table, with no active cell, has no field text. The page was left with no native selection and focus outside the editor (S2). The expanded host reads no field text, so it now attaches without it.

Breaking: no
