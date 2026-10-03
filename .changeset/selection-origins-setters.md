---
"@input/pen-types": patch
"@input/pen-core": patch
---

The selection convenience setters (`selectBlock`, `selectBlocks`, `selectCell`, `selectCellRange`, `selectText`, `selectTextRange`, `selectAll`) take an optional trailing `SelectionWriteOptions` whose `origin` defaults to `programmatic` (S3); `origin: "gc"` is still rejected (A4). `FieldEditorFocusOptions` gains an optional `origin`.

Breaking: no
