---
"@input/pen-types": patch
"@input/pen-dom": patch
"@input/pen-multiplayer": patch
---

Hide a teammate's caret while their focus is outside the editor (COL7). `@input/pen-dom` emits a new `focusChange` editor event when focus enters or leaves the root (a window switch is no change) and exposes it as `FieldEditor.hasFocusWithin`, and `@input/pen-multiplayer` publishes `cursor: null, selection: null` while focus is elsewhere, keeping `user`, `streaming`, and host keys. Focus edges publish at the end of the presence interval, so a click-in shows the selection it lands on rather than the stale one.

Breaking: no
