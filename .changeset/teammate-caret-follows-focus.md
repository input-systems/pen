---
"@input/pen-types": patch
"@input/pen-dom": patch
"@input/pen-multiplayer": patch
---

Hide a teammate's caret while their focus is outside the editor (COL7). `@input/pen-multiplayer` now publishes `cursor: null, selection: null` while focus is outside every editor of the scope, keeping `user`, `streaming`, and host keys, and publishes the selection again on refocus; a window or tab switch keeps the caret. A host that reads `cursor` to show who is editing reads `user` instead.

- `@input/pen-dom` tracks whether focus is within the editor root, ignoring window activity, and reports it as `FieldEditor.hasFocusWithin` and the new `focusWithinChange` editor event: on root attach, on each entry or exit, and `false` when a focused root detaches.
- Focus edges publish at the end of the 50 ms presence interval, so a click into the editor shows where it lands rather than the stale selection.

Both additions are read-only surface Pen implements: hosts read `FieldEditor` and subscribe to `PenEventMap`, so no host code has to change.

Breaking: no
