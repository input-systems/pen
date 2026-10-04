---
"@input/pen-multiplayer": patch
"@input/pen-dom": patch
---

A local keystroke that leaves every peer where it was no longer notifies multiplayer subscribers or re-renders binding-painted carets. The controller keeps the previous cursor, selection, streaming, and peer objects when a commit re-resolves them to equal values, and the overlay keeps its painted plan when a read resolves identical items under a newer selection version — the layer's `data-pen-overlay-selection-version` still records the newest version (OV4), so `plan.selectionVersion` can now trail it.

Breaking: no
