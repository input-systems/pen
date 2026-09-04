---
"@input/pen-react": patch
"@input/pen-dom": patch
---

`Pen.Toolbar.Button` and `Pen.Toolbar.Toggle` compose a host `onClick` with their own action instead of letting it replace the action. A Slot-style wrapper that merges its `onClick` onto the element (a tooltip trigger, for example) no longer silences `onAction` / the mark toggle; the action is skipped only when the button is disabled or the host handler called `preventDefault()`.

`resolveSelectionRect` measures a selection that spans blocks per block, so the rect covers the selected text rather than the border boxes of the blocks it fully covers. `useSelectionToolbar` reads that rect first for spanning selections; the selection toolbar sits over the text instead of centring on the column.
