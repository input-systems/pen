---
"@input/pen-types": patch
"@input/pen-dom": patch
"@input/pen-react": patch
---

Keep the selection toolbar closed while a pointer drag is held, so it no longer flickers under the pointer. The toolbar sat over the line the drag was heading into, and under the pointer whenever the drag's head was in an empty block, so the next hit-test landed on the toolbar, the selection head jumped, the toolbar moved away, and every mouse move flipped the selection between the two.

- `@input/pen-dom` reports when a pointer gesture in the content starts or ends as the new `pointerGestureChange` editor event: `true` on a press in the content (R2 filters chrome and overlays), `false` on its `pointerup`, `pointercancel` or `contextmenu`, and `false` when the root detaches mid-press.
- `@input/pen-react`'s `useSelectionToolbar` stays closed while that gesture is active and measures the settled selection on release. `SelectionToolbar.Content` carries `data-pen-ignore-pointer-gesture`, so a press on a toolbar rendered inside the root is chrome, not a content gesture.

Hosts see the toolbar hide on each press in the content and appear on release, instead of during the drag; keyboard selection is unchanged. Vanilla and Vue hosts that build their own toolbar can do the same from `pointerGestureChange`.

Breaking: no
