---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

Count content blocks, not root blocks, when deciding document placeholder eligibility (RI8). A block schema can now declare `authoring.contentRole: "chrome"` for furniture the host puts in the document — an email signature, a quoted message — and such a block no longer suppresses the empty-document placeholder or pulls a click below the blocks into itself. `getBlockContentRole` (`@input/pen-core`) is the canonical reader; `contentRole` defaults to `"content"`, so existing hosts are unaffected.

Eligibility names its block. `getDocumentPlaceholderTargetBlockId` (`@input/pen-dom`) returns the one block the hint paints on and the click-below caret lands in, or null when there is no target. The React and Vue bindings paint on the target instead of on the first root block, so a document that opens with chrome now shows the hint on its body. `InlinePlaceholderVisibilityOptions` replaces its `isFirstBlock` and `isDocumentEmpty` fields with a single `isDocumentPlaceholderTarget`.
