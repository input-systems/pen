---
"@input/pen-core": patch
"@input/pen-dom": patch
---

The DOM selection read on every `selectionchange` and caret motion no longer read every block's text (SCALE2). `buildLazyNormalPositionSnapshot(editor)` reads the document on demand, and `NormalPositionSnapshot` gains an optional `has(blockId)` so a visibility check does not materialise the block order. The block notifier also reports `inlineCompletionVisible` for blocks that can show a placeholder, notifies a container when a child joins it through `parentId`, and `isInlineAtomSelectedInSlice` reads a block's selection slice.

Breaking: no
