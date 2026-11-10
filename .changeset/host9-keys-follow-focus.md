---
"@input/pen-dom": patch
---

An editor without focus no longer takes keys (HOST9). The document key handler routes a key to the editor only while DOM focus is inside its root. Before, an editor that had lost focus still claimed keys whenever it was left with a selection. So when a host menu closed by unmounting its focused item, the chat composer beside it ran its own undo on Mod-z and stopped the key, and the host's undo never ran. With a host control focused, a leftover block or cell selection also took arrow keys from host menus, Tab from host forms, and Enter from host buttons (cancelling the click), and Backspace deleted the selected blocks. Now all of these reach the host. This includes Mod-z and Mod-a after a click on empty space beside the editor: a host that wants those to act on the editor focuses it. `shouldHandleEditorKeyboardEvent`'s `hasMappedDomSelection` option is deprecated and no longer consulted.

Graded patch, as earlier HOST9 changes were: no host code has to change, and keys inside a focused editor behave as before.

Breaking: no
