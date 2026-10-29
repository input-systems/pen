---
"@input/pen-dom": patch
---

A multi-block selection that a commit maps (typing over a range, undo, a collaborator's edit) is no longer written into the blocks before they rebuild. It was projected into DOM that did not show the commit yet, so the read-back reported a `selection-projection-mismatch` that the rebuild then corrected. The rebuild now projects it.

Breaking: no
