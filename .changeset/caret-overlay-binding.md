---
"@input/pen-react": minor
---

`Pen.Editor.CaretOverlay` is now a binding over `@input/pen-dom`'s overlay: while mounted it switches the root to `customCaret` mode and `@input/pen-dom` measures and paints the caret into the root's overlay layer. It no longer measures or renders a host element of its own when `renderCaret` is omitted. `renderCaret` receives a transform-positioned `caretStyle` (no `left`/`top`) and a new `affinity`, and its node is portaled into the overlay layer. `data-caret-visible` moves to the `data-pen-overlay-layer` element. The 500 ms blink pause is gone: the blink restarts on each user edit and caret move by replacing the caret element. `Pen.Editor.Root` passes `readonly` to `FieldEditorImpl.setReadOnly`.

Breaking: yes — hosts that read `left`/`top` from `renderCaret`'s `caretStyle` position with its `transform` instead; hosts that style `[data-pen-editor-caret-overlay][data-caret-visible]` target `[data-pen-overlay-layer][data-caret-visible]`; set `--pen-editor-caret-*` tokens on the editor root or above.
