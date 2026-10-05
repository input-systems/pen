---
"@input/pen-dom": patch
---

Let a host-built field-editor controller drive the published backends and `attachContentGestures` again. The controller types strip pen-dom's own `reader`, `projector` and `pendingMarks` parts, but the contenteditable and EditContext backends, the transfer events and the content gestures called them unconditionally, so a controller that type-checked against the published types threw on its first composition, pointer, drag, typed character or decoration change. They now read the parts optionally and fall back to the behaviour they had before the parts existed: no gesture notification, inserts that take the marks at the insert position, and a selection projection after a decoration rebuild. The published types are unchanged.

Breaking: no
