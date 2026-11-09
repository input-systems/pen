---
"@input/pen-dom": patch
---

Mod-a, Mod-z and Mod-Shift-z on a body that focus fell to now go to whatever held focus last (HOST9). Before, any editor that still had a caret claimed them, so when a host menu closed by unmounting its focused item, the editor beside it ran its own undo and stopped the key, and the host's undo never ran. With two editors on a page, the first one mounted won. Now the editor takes them only if focus was last inside its root, or on a wrapper of it, before it fell to the body. `bindEditorDocumentKeyDown` tracks this with a document `focusin` listener. `shouldHandleEditorKeyboardEvent` gains an optional `heldFocusLast` for hosts that route keys themselves; without it, the old behavior applies.

Graded patch, as earlier HOST9 changes were. Clicking on nothing focusable from inside the editor still leaves these keys with the editor. The keys now go to the host instead only where an element beside the editor held focus last, or where the editor has not held focus since it mounted.

Breaking: no
