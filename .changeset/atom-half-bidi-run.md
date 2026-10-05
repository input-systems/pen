---
"@input/pen-dom": patch
---

Take an inline atom's clicked half in the direction of the atom's bidi run, not the block's (T5, O1). A mention among Latin words in a right-to-left block (`مرحبا abc @Ada def عالم`) resolved its visual left half to its logical end, for plain and shift clicks on every binding; the reverse case, an atom in a right-to-left run inside a left-to-right block, was wrong the same way. The side now follows the run `computeBidiRuns` resolves for the atom over the block's logical text, the same runs the overlay draws its caret from.

Breaking: no
