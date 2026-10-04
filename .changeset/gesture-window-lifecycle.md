---
"@input/pen-dom": patch
---

Keep the selection reader's gesture windows across a field session switch (R1). A press in a block other than the one being edited deactivated that field in the same gesture, and the deactivation closed every window: a touch long-press there lost its native-range window, so moving a selection handle snapped the range back; a drag's reads were projected back against the native range; and a drag over more than 50 blocks had its substitute written mid-drag. Windows are now root-level reader state that only their closing inputs and the root's detach change; a field torn down mid-composition still ends its composition window. A document `pointercancel` now ends the pointer gesture as `pointerup` does, so a touch pan or a native drag no longer leaves the pointer window open and admits later reads as `pointer`. Detaching the root or destroying the field editor releases the gesture's document listeners, so a pointer release after `destroy()` does nothing. A click in a table cell while a text range is selected now selects the cell instead of collapsing the range to a text caret on the table, which no field could show.

Breaking: no
