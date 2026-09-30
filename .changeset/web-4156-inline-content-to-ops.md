---
"@input/pen-core": patch
---

Export `inlineContentToOps(block, blockId, offset)`, which writes a pending block's inline content (text, marks, inline nodes) into an existing block. `blocksToOps` uses it for new blocks.
