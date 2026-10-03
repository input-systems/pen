---
"@input/pen-dom": minor
---

The overlay caret is on by default on every surface: carets beside mentions and inline apps, in empty blocks, and at O4 range endpoints are drawn by Pen into the root's `data-pen-overlay-layer` with `caret-color: transparent` on the field, and block and grid-cell selections get a library outline (`--pen-block-selection-outline`, default an inset 2px `Highlight` ring). A text range over more than fifty blocks draws both endpoint carets, its partial spans and one span over the covered blocks. Overlay items carry `data-block-id` like the old caret did. New tokens: `--pen-overlay-z-index`, `--pen-editor-endpoint-caret-color`, `--pen-block-selection-outline`, `--pen-block-selection-background`, `--pen-block-selection-radius`, `--pen-selection-range-background`, `--pen-selection-range-opacity`.

Breaking: yes — hosts that already style `[data-selected]` set `--pen-block-selection-outline: none` on the editor root (or drop their rule) to avoid a double outline; set caret and outline tokens on the editor root or above, not on a wrapper inside it; scope `[data-block-id]` selectors to `[data-pen-editor-block]` if they must not match overlay items.
