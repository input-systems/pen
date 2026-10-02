---
"@input/pen-dom": minor
---

Every DOM selection and EditContext selection write in the field editor's backends now goes through one module, the selection projector (S1). `editorSelectionToDOM` is removed from `@input/pen-dom/field-editor` and `@input/pen-dom/field-editor/selectionBridge`: hosts that placed the selection with it should call `editor.setSelection` and let the field editor project it. `findDOMPoint`, which maps a block offset to a DOM point, is now exported from `@input/pen-dom/field-editor/selectionBridge`.

Breaking: yes
