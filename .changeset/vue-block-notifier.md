---
"@input/pen-vue": patch
---

Blocks re-render only when their own state changes (SCALE6). `PenBlock`, `PenInlineContent` and `PenTableCellContent` read their block's commit, selection, field, decoration and list state from the field editor's block notifier instead of the editor selection, the full field-editor store and per-block commit listeners, so a keystroke renders one block and a mounted editor holds the same handful of editor-level listeners at any size. `PenContent` reads root ids from the notifier and no longer acknowledges every block on each update. A numbered item's marker now updates when an item is inserted above it. `useBlockList` returns the notifier's root ids inside a root, so a text-only commit does not change it.

Breaking: no
