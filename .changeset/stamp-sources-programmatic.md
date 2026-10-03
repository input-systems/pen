---
"@input/pen-dom": patch
---

The field editor's backend selection stamps no longer include `programmatic` (W3.R10). Text input, input rules and dispatched edits already wrote the authority with `keyboard` or `ime`; the stamp only shadowed that write inside the backends. The contenteditable backend restores the caret from the authority alone, a rebuilt field projects the record (P3) during an edit too, and the contenteditable echo restore that compared a collapsed caret with the last projected offsets is gone: such a read now diverges and P2 projects the record back. The EditContext backend moves its buffer caret before the apply when the buffer already holds the edit, so the projection the edit triggers finds it agreeing. `FieldEditorSelectionSource` is now `"edit-context-textupdate" | "cell"`.

Breaking: no
