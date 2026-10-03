---
"@input/pen-dom": patch
"@input/pen-vue": patch
---

`@input/pen-dom` registers its local-selection overlay contributor on every root. In `customCaret` mode (held through `RootOverlay.holdCaretMode("all")`) it draws every collapsed caret the field allows, measured with the record's affinity, hidden while composing, unfocused or read-only, solid under reduced motion, and restarted on each user edit and pointer, keyboard or ime caret move with no timer. Default mode draws nothing yet. `overlayItemStyle` is exported for bindings that render an item themselves. A root that is detached and re-attached for the same editor keeps its overlay, contributors and holds. `FieldEditorImpl.setReadOnly` carries the renderer `readonly` prop; Vue's `PenEditor` now passes it.

Breaking: no
