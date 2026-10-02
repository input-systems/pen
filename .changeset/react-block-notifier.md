---
"@input/pen-react": patch
---

Blocks re-render only when their own state changes (SCALE6). `EditorBlock` and `InlineContent` are memoized and read their block's commit, selection, field, decoration, list and completion state from the field editor's block notifier instead of subscribing to the editor per block, so a keystroke renders one block and a mounted editor holds the same handful of editor-level listeners at any size. `EditorContent` reads root ids from the notifier and stops acknowledging every block after each render; each block acknowledges its own mount. The editor, region-selection and block-drag context values are stable while their inputs are. `useCellTextSnapshot` and `TableCellContent` read the table block's notifier state inside a root.

Breaking: no
