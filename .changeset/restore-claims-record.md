---
"@input/pen-core": patch
"@input/pen-dom": patch
---

Undo and redo scroll the restored selection into view even when the history commit already mapped the caret to the same place: a `restore` write now claims an equal record instead of being dropped as a no-op (S3, D17). Projection scroll deltas round away from zero to whole pixels, so a caret on the last visible line lands fully inside the viewport instead of a subpixel short.

Breaking: no
