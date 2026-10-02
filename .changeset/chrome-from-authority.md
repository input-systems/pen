---
"@input/pen-react": patch
"@input/pen-dom": patch
---

The selection toolbar, the contextual AI prompt and the slash and suggestion menus position themselves from the editor selection through the geometry reader and react to `editor.onSelectionChange`, instead of reading the live DOM range or listening for `selectionchange` (S1). The toolbar no longer falls back to the native range rect, so it shows only for a selection in rendered editor content. `DomScheduler.measureNow` now drops cached geometry for blocks changed by commits since the last flush before it measures (SCH2), so a measurement taken between a commit and the next frame no longer returns pre-commit rects.

Breaking: no
