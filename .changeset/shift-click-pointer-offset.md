---
"@input/pen-dom": patch
---

Extend a shift-click into another block to the offset under the pointer (T5). A shift-click in a block other than the selection anchor's used to extend the selection to that block's far edge (its end going forward, its start going back) on React, Vue and vanilla; it now extends to the logical offset a plain click at the same point collapses to, resolved by `pointToEditorSelectionPoint`, and falls back to the far edge only when geometry resolves no point in the clicked block. A shift-click inside an inline atom takes the side of the half it lands on.

- Clicking inside an inline atom in a right-to-left block now takes the atom's logical side: the visual left half is its end and the right half its start. It used to treat the left half as the start in every direction (O1).
- `selectInlineAtomRangeFromShiftClick` returns `false` and writes nothing when the selection is anchored in another block, leaving the cross-block extend to the content gestures, and an atom's pointerdown with Shift held never starts an atom drag. It used to select the atom alone.

Breaking: no
