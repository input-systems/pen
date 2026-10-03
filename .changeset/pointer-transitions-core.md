---
"@input/pen-core": patch
---

Export the pointer transitions `convertPointerDrag` (T2) and `clickSelectableBlock` (T5), `buildTransitionSnapshot` (with an optional `blockIds` scope), and the `TransitionSnapshot` and `TransitionBlock` types. `convertPointerDrag` now covers a structural end of a cross-block range in the drag's direction (`0..1`), which pen-dom used to do itself, using core's text/structural split, so a code block is text for the pointer as it is for the authority.

Breaking: no
