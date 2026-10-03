---
"@input/pen-dom": minor
---

Focus follows the selection record (W3.R16). Block and cell selections focus the revealed focus sink; app and `null` selections focus the editor root, but only while the editor already owns focus (never on mount or load); no path focuses a block element. Escape writes the selection and lets its projection place focus, so Escape from a caret lands on the sink and Escape from a block selection lands on the root. Deactivating the field no longer focuses the block element or the root itself. The editor root moves focus into the active field only when focus enters it from outside the editor. `handleEscapeSelectionTransition` no longer takes `root`, and `handleFieldEditorRootFocus` needs `requestRootFocus` on its field editor. Only the focus controller calls `HTMLElement.focus` in pen-dom (`pen/no-direct-dom-focus`).

Breaking: yes — hosts that call `handleEscapeSelectionTransition` drop `root`, and hosts that relied on Escape or `deactivate()` focusing the block element focus the sink or root instead
