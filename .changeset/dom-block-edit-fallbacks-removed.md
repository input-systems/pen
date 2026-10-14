---
"@input/pen-dom": minor
---

The field editor no longer carries its own copy of block-level Enter and delete. Enter, Backspace and Delete are decided by the core `pen.splitBlock`, `pen.deleteBackward` and `pen.deleteForward` commands alone; when a delete command declines, the field editor edits only the field's own text, and when `pen.splitBlock` declines nothing happens. The copies could only run after the command had already declined the same case, so no keystroke changes. Removed from `@input/pen-dom/field-editor/commands`: `applyBackspaceBehavior`, `applyDeleteBehavior`, `mergeBackwardAtBlockStart`, `resolveBackspaceAction`, `applyEnterBehavior`, `resolveEnterAction`, `splitBlockAtOffset`, `insertTextAtRange` and `convertBlock`.

Breaking: yes — hosts that called the removed `@input/pen-dom/field-editor/commands` helpers dispatch `splitBlock`, `deleteBackward`, `deleteForward`, `insertText` or `convertBlock` from `@input/pen-core` instead
