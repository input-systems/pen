---
"@input/pen-vue": minor
---

Vue editors gain the overlay layer, atom-adjacent and empty-block carets, and block outlines from `@input/pen-dom`, with no Vue component.

Breaking: yes — hosts that style `[data-selected]` set `--pen-block-selection-outline: none` on the editor root to avoid a double outline, and hosts whose CSS targets the root's `:last-child` account for the `data-pen-overlay-layer` element.
