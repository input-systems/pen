---
"@input/pen-dom": patch
---

S1: the selection reader is the only module that reads the DOM selection. The contenteditable and EditContext backends take their in-field ranges from the reader through `FieldEditor.readFieldSelectionOffsets`, and the projector takes the `Selection` it writes through from the reader. `domSelectionToEditor`, `getSelectionOffsets`, `getDirectionalSelectionOffsets` and `getCaretOffset` keep their signatures on `./field-editor/selectionBridge`, and now read the selection of the element's own document instead of the global `window`'s.

Breaking: no
