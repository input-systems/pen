---
"@input/pen-dom": patch
---

A cancelled IME composition (or one committed empty) returns the caret to where the composition started on the contenteditable backend, so the next keystroke lands there instead of inside the discarded run (C1).

Breaking: no
