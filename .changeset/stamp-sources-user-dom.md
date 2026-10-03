---
"@input/pen-dom": patch
---

The field editor's backend selection stamps no longer include `user-dom`, `composition` or `history` (W3.R10). `composition` and `history` were never written; `user-dom` was written by the EditContext backend and read only by the contenteditable backend, so it never affected a live field. `FieldEditorSelectionSource` is now `"programmatic" | "edit-context-textupdate" | "cell"`.

Breaking: no
