---
"@input/pen-core": minor
---

`BlockHandle.length()` counts each inline embed as one offset even when a block holds only atoms, so an atom-only block has length 1 instead of 0 (N1); caret commands, Enter and Backspace now see its content. Arrow keys beside an inline atom select the atom on the side of travel even between two adjacent atoms, and a shift-extend backward over an atom ends at its start.

Breaking: yes — hosts that read `length() === 0` as "this block has no text" check `textContent() === ""` instead when an atom-only block must count as empty
