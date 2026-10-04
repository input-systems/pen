---
"@input/pen-dom": patch
---

A plain click on an inline chip in the field that is already editing puts the caret on the side of the chip that was clicked (O1, W35.R16) under `mountEditor` and every host that uses `handleFieldEditorPointerActivate` (the Vue binding). Before, the browser's own mousedown put the DOM caret inside the `contenteditable="false"` chip's text, which read back as after the atom whichever half was clicked. Double clicks and shift-clicks on a chip stay the browser's.

Breaking: no
