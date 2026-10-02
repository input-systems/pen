---
"@input/pen-dom": patch
---

The vanilla `mountEditor` document tree updates only the blocks the field editor's block notifier names (SCALE6). It no longer re-syncs every block on each commit and field-editor change: each block node listens to its own block, writes an attribute or style only when it differs, reconciles inline content only when the block's revision moved or the field editor released it, and a reorder moves only the nodes out of place. `DocumentTree` gains `destroy()`.

Breaking: no
