---
"@input/pen-core": patch
"@input/pen-ai": patch
"@input/pen-search": patch
---

Drop suggestions, review decorations, and search matches inside a deleted parent block. Deleting a block took its `children`-array subtree out of the document, but the change summary named only the block itself, so per-block indexes kept the descendants' staged suggestions, decorations, and matches. The summary now reports `block-removed` for each removed descendant (bounded by the removed subtree, SCALE2), the decoration collector never asks a scoped source to re-read a removed block, and the AI and search indexes drop removed ids instead of re-reading their surviving stored maps.

Breaking: no
