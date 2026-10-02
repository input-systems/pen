---
"@input/pen-dom": patch
---

The selection projector is now the only code in the renderers that writes the DOM selection (S1). `focus()` on a field with no caret in it commits a caret at the end of the field to the editor selection (origin `programmatic`) and projects it, so `editor.selection` and the DOM agree; before, it placed a native caret the editor did not know about. A block or null selection now clears a native range inside the editor root when it is projected, instead of the region-select and block-normalization gestures clearing it themselves; while a native control outside the field owns focus the clear is withheld (HOST9).

Breaking: no
