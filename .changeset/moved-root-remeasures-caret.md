---
"@input/pen-dom": patch
---

Re-measure cached geometry when a block's live box moved without a resize, font, scroll, or commit generation change, so the overlay caret, selection rects, and menus follow the editor after a window resize re-centres a max-width column.
