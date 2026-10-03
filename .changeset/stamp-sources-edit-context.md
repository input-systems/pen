---
"@input/pen-dom": patch
---

The field editor's backend selection stamps no longer include `edit-context-textupdate`, and the EditContext selection snapshot is gone (W3.R10, FE9 amended). The last caret a `textupdate` resolved is now the EditContext backend's own trusted typing caret: an input to `resolveEditContextTextUpdateRange` and the key-down range only, never projected, cleared on an A5 `mapped` `selectionChange` (forwarded to the backend through `InputBackend.selectionMapped`), a pointerdown, a navigation key and history. `restoreDOMCaret` restores from the authority, else the EditContext buffer; inside the apply the buffer (which the backend wrote before the apply) drives the caret, and P1 projects the record afterwards. Text-update range resolution falls back to the authority caret where it read the snapshot. `FieldEditorSelectionSource` is now `"cell"`; `setEditContextSelectionSnapshot` / `getEditContextSelectionSnapshot` are removed from the field-editor session.

Breaking: no
