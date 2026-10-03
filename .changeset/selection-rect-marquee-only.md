---
"@input/pen-react": minor
---

`EditorSelectionRect` draws only the region-selection marquee while a drag is selecting blocks. A committed block selection is no longer drawn by it: `@input/pen-dom` paints block and grid-cell selections as O3 outlines in the root's overlay layer, and `EditorSelectionRect` measures nothing.

Breaking: yes — hosts that relied on `EditorSelectionRect` to draw a committed block selection style the overlay outline tokens (`--pen-block-selection-outline`, `--pen-block-selection-background`) on the editor root instead
