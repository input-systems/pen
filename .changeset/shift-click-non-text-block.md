---
"@input/pen-dom": patch
---

Extend a shift-click on a divider or other block with no text position over that block on Vue and the vanilla mount (T5). `handleFieldEditorPointerActivate` left non-text blocks before its shift branch, so a shift-click on a divider fell through to the browser and the selection collapsed to the end of the anchor's paragraph. It now extends from the anchor to the block's far edge, as the React content gestures do.

Breaking: no
