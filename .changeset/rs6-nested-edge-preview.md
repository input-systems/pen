---
"@input/pen-ai": patch
---

Preview nested and empty-edge blocks in `edit_document` replace and delete operations (RS6). The preview ordered the named blocks through the top-level block order, so `delete_blocks` or `replace_blocks` over blocks inside a toggle named only the first one; it now orders them by nested document order. A replace also hides an empty block at the edge of its range, which had no text to strike and stayed on screen as an empty line accept removes; `AIStreamingReviewPreviewInput` gains `replacesBlocks` to carry that.

Breaking: no
