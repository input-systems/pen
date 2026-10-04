---
"@input/pen-dom": patch
---

A shift-click into another block now extends the selection on vanilla `mountEditor` and Vue, as it does on React: from the anchor to the clicked block's far edge. `handleFieldEditorPointerActivate` used to activate a collapsed caret at the clicked point, whatever the modifier. `FieldEditorPointerTarget` gains an optional `applyDocumentTextSelection`, which `FieldEditorImpl` provides.

Breaking: no
