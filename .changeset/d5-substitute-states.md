---
"@input/pen-dom": patch
"@input/pen-types": patch
---

S2 (W3.R17): the two declared S2 exceptions now show a pinned substitute state instead of a stale range in one field. A text range over more than 50 blocks (`block-surface-range`) and a multi-block range whose write the engine confines to one field (`engine-confined-range`, detected on read-back and taken once without a `selection-projection-mismatch`) leave no native range in the editor root, move focus to the focus sink revealed as a text range (`role="group"`, labeled by the new `pen.a11y.textRangeSelected` catalog key), and are painted by the overlay as both endpoint carets plus the range items. While the pointer window is open the dragged native range stands; the pointerup projection applies the substitute. `FieldEditorSession.getSubstituteState()` exposes the state (the overlay reads it). While a substitute holds, the sink routes keys through the text keymap (a printable key replaces the range, Backspace and Delete delete it), a composition keystroke deletes the range and focuses the caret's field in the same `keydown`, and `copy`, `cut` and `paste` on the sink reach the field transfer handlers (block selections included).

Breaking: no
