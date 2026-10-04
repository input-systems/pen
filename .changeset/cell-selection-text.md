---
"@input/pen-core": minor
---

An edited table cell's caret is part of the selection record (W3.R18, D16). `CellSelection.text` (`{ anchor, focus }` in the cell's logical offsets) carries it: the authority validates it (A1: accepted only when `anchor` equals `head`, otherwise rejected with a `selection-invalid-cell-text` diagnostic; offsets clamp to the cell's length), compares it (A2), mints cell-text anchors for it and repairs them on commit (AS1, AS2, AN10), so a remote insert before the caret maps it. The in-cell caret commands (T6) read and return `CellSelection.text`, so `selectionChange` now fires on in-cell caret moves and typing, and Shift+Arrow inside a cell extends the range. The side-channel seam is removed: `setCellCaretFocus`, `getCellCaretFocus`, `CellCaretFocus` and `CellCaretWrite` leave the barrel.

Breaking: yes — hosts that drove in-cell caret motion through `setCellCaretFocus` write a `CellSelection` with `text` instead (`editor.setSelection({ type: "cell", blockId, anchor: cell, head: cell, text: { anchor: caretOffset, focus: caretOffset } })`, where `cell` is the `{ row, col }` coordinate and the offsets are in the cell's text), and hosts that treated every `selectionChange` to a `cell` selection as a grid move check `text` first
