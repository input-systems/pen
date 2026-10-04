---
"@input/pen-react": patch
---

`Pen.Editor.CaretOverlay` and `Pen.Multiplayer.CaretOverlay` keep `left: 0` and `top: 0` in the `caretStyle` and `labelStyle` they hand to `renderCaret` / `renderLabel` (OV2). Without them, an absolutely positioned caret or label in an RTL host took its static position at its container's right edge, so binding-rendered carets sat one caret width left of the text and remote labels a whole label width left of their caret.

Breaking: no
