---
"@input/pen-dom": patch
---

Projecting the selection now scrolls it into view when the move came from the keyboard, an IME, undo or redo, or local typing (a `mapped` record from the local user's commit): the caret, or the head block of a block selection, is measured in a scheduler read phase and its scroll container is scrolled to the nearest edge in the following write phase. Pointer, programmatic and collaborator-driven selection changes do not scroll. `FieldEditorImpl.scrollIntoView(target, scroll)` brings a block or the current selection into view through the same path.

Breaking: no
