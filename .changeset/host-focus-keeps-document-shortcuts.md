---
"@input/pen-dom": patch
---

A host element focused beside the editor keeps Mod-a, Mod-z and Mod-Shift-z (HOST9). The document key handler claimed them for any editor left with a caret, so Mod-z on a focused host element undid the editor's last edit instead of reaching the host. With focus on the body, or on a wrapper of the editor root, they still reach the editor.

Breaking: no
