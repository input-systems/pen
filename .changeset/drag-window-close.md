---
"@input/pen-dom": patch
---

Close the drag gesture window (R1). The field editors cancel `dragstart`, so neither `drop` nor `dragend` followed and the drag window stayed open until the field deactivated; every later stray `selectionchange` was then accepted as a pointer selection. A cancelled `dragstart` now closes the window in the same handler, and a document `dragend` closes it for drags that are not cancelled. `FieldEditorImpl.getGestureWindows()` exposes the window state the controller interface already declared.

Breaking: no
