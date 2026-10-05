---
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-vue": patch
"@input/pen-multiplayer": patch
---

Additive overlay APIs and remote-caret safety and contrast fixes:

- `RootOverlay.holdCaretMode`, `overlayItemStyle` and `overlayLabelStyle` are exported for bindings.
- `attachRemoteCarets(overlay, source)` and `getRemoteCaretSource(editor)` paint collaborators' carets. Vue gains `PenMultiplayerCaretOverlay`.
- `FieldEditorImpl.setReadOnly` carries the renderer `readonly` prop.
- New `isSafeCssColor` in `@input/pen-core`. Every `--pen-peer-color` write is re-validated, and carets paint through `background-color` so a colour cannot become an image fetch (COL2).
- The default peer palette (`MULTIPLAYER_COLORS`) uses darker shades so labels meet 4.5:1 contrast. Hosts that pass `user.color` are unaffected.
- A local keystroke that leaves every peer in place no longer notifies multiplayer subscribers or repaints remote carets.

Breaking: no
