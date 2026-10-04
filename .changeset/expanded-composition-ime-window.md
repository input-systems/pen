---
"@input/pen-dom": patch
---

A composition in the expanded (cross-block) host now opens the C1 ime window, so selection projections are withheld while the engine composes, and the reader does not take the composing caret as a selection: the cross-block range stays the record and the expanded host keeps composing until the commit replaces the range. A re-attached expanded backend no longer carries a composition over from its previous attachment (FE2, C1).

Breaking: no
