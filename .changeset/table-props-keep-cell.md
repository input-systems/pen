---
"@input/pen-core": patch
---

Keep an edited table cell through a props or meta change on its table. Any non-content key change on a table block was summarized as `table-changed`, so a collaborator's or extension's `set-props`/`set-meta` reset an edited cell selection to cell (0,0) and dropped its `text`, which pulled the user out of the cell. A props or meta change on a table now summarizes as `block-props-changed`, and `table-changed` names grid structure changes only (rows, cells, columns). A real structure change now resets to a collapsed text selection in the first cell (`text: { anchor: 0, focus: 0 }`), as A5 already specified.

Breaking: no
