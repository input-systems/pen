---
"@input/pen-dom": patch
---

`captureFocusReturn` and `restoreFocusReturn` implement the AX3 focus-return rule for custom chrome: return to the recorded target when it is still connected and usable, otherwise to the editor surface (the active field, then the revealed focus sink, then the root), synchronously and through the focus controller, never stealing from a native text-entry control (HOST9).

Breaking: no
