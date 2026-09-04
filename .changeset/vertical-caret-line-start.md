---
"@input/pen-core": patch
"@input/pen-dom": patch
---

Fix ArrowUp being a no-op (or skipping a line) when the caret sits at the start of a visual line, right after a `\n` soft break or a soft wrap. `pen.caretUp` / `pen.caretDown` now hand the selection's affinity to the geometry measure, and `verticalCaretTarget` measures the current caret on the side it is drawn instead of deriving the side from the motion direction (G5).
