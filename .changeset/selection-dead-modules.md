---
"@input/pen-dom": minor
---

The field editor keeps one selection truth (W3.R10). The selection coordinator, its write-depth "authority", the history projection coordinator and the passive-attach suppression flag are gone; `FieldEditorImpl` drives the projector and reader directly, a passive attach passes its focus options to the backend, and `focusTextSelection` commits once. Backends no longer pre-filter selection reads (the contenteditable full-block echo predicate and the EditContext stale-caret guard are deleted: echoes stop at the reader's equivalence step, closed-window divergence is projected back by P2), and their restore paths write through `updateSelection`. When the DOM already shows the record but an EditContext buffer lags, the projector syncs the buffer without rewriting the native range. EditContext's `ignoreNextTextFormatUpdate` is folded into a C4 `compositionPhase`. The click after a pointer gesture is skipped through the gesture's own `committed` field (`PointerSelectionGesture.committed`) instead of a shared `skipNextClick` slot.

Breaking: yes — hosts that call `attachContentGestures` drop `skipNextClick` from `state`, and code that builds a `PointerSelectionGesture` by hand sets `committed: false` (or uses `createPointerSelectionGesture`)
