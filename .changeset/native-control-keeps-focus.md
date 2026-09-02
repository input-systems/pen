---
"@input/pen-dom": patch
---

A native text-entry control outside the editor keeps its focus (HOST9). While one owns focus, an authority selection write — including `setSelection(null)` — is recorded but not projected into the DOM, and a decoration change that rebuilds the active field no longer writes the selection back into it; both previously pulled focus out of the host's own input and into the editor. Gesture and programmatic projections still project. `FieldEditorDomController` gains an optional `shouldProjectSelectionAfterReconcile()` that the single-field backends consult before restoring the caret after a decoration rebuild.
