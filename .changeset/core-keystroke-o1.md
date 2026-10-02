---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-yjs": patch
"@input/pen-dom": patch
---

A keystroke and a caret move no longer read the whole document (SCALE2). `DocumentState` gains `preorderIndexOf(id)` and `preorderBlockIds()`, the nested order `allBlocks()` yields, cached until the next structural change, and `getSelectionBlockRange` accepts a `DocumentState` and slices it. The unknown-block-type sweep is gated on `documentState.generation` instead of `blocks.size`, which iterates every block in Yjs. Selection validation reads the block order only for a mixed text and structural range. `DocumentState` no longer scans every block to check a top-level block's parent, and no longer rebuilds on every edit inside a block nested in a `children` array. Anchor resolution in `@input/pen-yjs` finds a position's block by walking up from its `Y.Text` instead of scanning the blocks map.

Breaking: no
