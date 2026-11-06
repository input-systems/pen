---
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

Re-measure overlay items when a decoration change re-renders their block, so a collaborator's caret follows text that an `omitFromRender` decoration reveals instead of staying where the text ended (OV1). Add an optional `glideMs` to `attachRemoteCarets`, `Pen.Multiplayer.CaretOverlay` and `PenMultiplayerCaretOverlay`: a remote caret glides along its line with a linear transform transition, and jumps when it is new, changes line, or reduced motion is on (OV3, AX6).

Breaking: no
