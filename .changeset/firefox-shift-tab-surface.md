---
"@input/pen-dom": patch
---

Fix Shift+Tab out of the editor in Firefox 155. The active contenteditable surface now uses `tabindex="0"` instead of `-1`, because Firefox does not move focus backward out of a focused contenteditable with `tabindex="-1"`. The editor is still a single tab stop.
