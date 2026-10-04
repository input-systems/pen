---
"@input/pen-react": patch
---

`Pen.Toolbar.Button` and `Pen.Toolbar.Toggle` keep focus in the field by preventing the primary-button `mousedown` default only, and no longer cancel `pointerdown`. Cancelling `pointerdown` suppressed the compatibility mouse events, so a host `onMouseDown` never ran, document outside-press listeners never closed their menus, and a Radix-style trigger composed onto the control would not open. The slash menu, suggestion menu and table column menu now dismiss on an outside `pointerdown` (AX3).

Breaking: no
