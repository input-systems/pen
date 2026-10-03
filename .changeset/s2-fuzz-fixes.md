---
"@input/pen-dom": patch
---

S2 fixes found by the DOM fuzzer (seeds 23, 37, 41):

- A code block that a multi-block selection stamps `data-surface-role="delegated"` still maps text offsets, so a range ending inside it reads back where it was written.
- After a drag, the projector writes the gesture's last selection again at `pointerup`; Chromium had re-clamped a drag that started in a code block to that block.
- A null, app, block or (not edited) cell selection projects without a text read-back, so undo restoring `null` or an arrow onto a divider no longer reports `selection-projection-mismatch`. A cell selection clears a stale native range outside its table.
- A DOM point in the gap beside an image or divider maps back to that block's 0..1 extent, and identical endpoints are equivalent without building a snapshot (fewer document reads per keystroke).
- A text selection set while no field is active activates its block when the editor owns focus, instead of leaving the caret undrawn.

Breaking: no
