---
"@input/pen-core": patch
---

T5: `pen.caretUp` / `pen.caretDown` that land on a table now select its edge cell (the first row moving down, the last moving up) as a `CellSelection`, as a click on a cell does. Previously they left a text caret on the table block, which no field could show and which dropped focus. With Shift held the motion extends over the table as a block.

Breaking: no
