---
"@input/pen-dom": patch
"@input/pen-vue": patch
---

`@input/pen-dom` exports a remote-caret overlay contributor: `attachRemoteCarets(overlay, source)` turns a source's remote cursors (`getRemoteCaretSource(editor)` reads the `@input/pen-multiplayer` controller) into `role: "remote"` caret requests, painted into the overlay layer with `--pen-peer-color`, the `--pen-caret-*` tokens, and a `[data-pen-multiplayer-caret-label]` name label. Caret requests and items gain an optional `color`, and `overlayLabelStyle` is exported for bindings that render the label themselves. Vue gains `PenMultiplayerCaretOverlay`, which registers that contributor from inside `PenEditor`.

Breaking: no
