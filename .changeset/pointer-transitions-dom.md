---
"@input/pen-dom": minor
---

The pointer path forms drags and block clicks through core's transitions via the new `resolvePointerSelectionIntent` (`@input/pen-dom/utils/pointerSelection`), and mouseup no longer maps the live DOM selection. The reader reads the gesture's last native range at `pointerup`, while the pointer window is open, so a double- or triple-click expansion and a drag's end reach the authority with origin `pointer` and no frame wait. A drag into a code block keeps the pointer's offset instead of snapping to the block's edge. A pointer selection that moves the session to another block now ends the current undo step, as `activate()` already did. `resolvePointerDragSelection` no longer takes `getBoundaryPoint`, and `PointerSelectionGesture` gains `startSelectionVersion`.

Breaking: yes — hosts that call `resolvePointerDragSelection` drop the `getBoundaryPoint` option, and hosts that build a `PointerSelectionGesture` by hand use `createPointerSelectionGesture` or set `startSelectionVersion`
