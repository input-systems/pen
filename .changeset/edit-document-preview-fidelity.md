---
"@input/pen-ai": patch
---

The `edit_document` streaming preview now shows what accepting will do (RS6): multi-block replaces and deletes cover every block they name, a delete hides its blocks whole, inserts preview on the side they will land, a finished replacement shorter than the text it replaces hides the old tail, and moves, formatting, and prop changes no longer blank the block while they stream. `EditDocumentPreviewUpdate` (on `GenerationState.editPreview`) gains `blockIds`, `placement`, and `complete`; `AIStreamingReviewPreviewInput` gains optional `complete` and `deletesBlocks`.

Breaking: no
