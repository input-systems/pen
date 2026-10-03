---
"@input/pen-types": patch
"@input/pen-dom": patch
---

`CellSelection`, `ReadonlySelectionState` and `SelectionRecordState` gain the optional `text` range of a cell being edited (W3.R18). In the field editor the `cell` backend stamp is gone, and with it the last stamp source and `writeLegacyFieldRange` (W3.R10): activating a cell writes `CellSelection.text` (a caret at the cell's end unless the record already edits that cell), typing and in-cell arrows write it, the selection reader maps a range inside the edited cell to it, and the projector writes it into the cell element and reads it back. A written `CellSelection.text` for another cell moves cell editing there (FE6). An edited cell keeps DOM focus: only a grid cell selection claims the focus sink.

Breaking: no
