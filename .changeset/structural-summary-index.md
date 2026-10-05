---
"@input/pen-core": patch
---

A structural commit advances the change-summary block index by what it touched instead of re-reading the document (SCALE2): the root order's delta is applied to the held roots, each touched `children` array is advanced by its delta or re-read with its owner, and only the blocks the summary names have their text length re-read. A commit the index cannot advance exactly (an id listed in more than one array entry, COL4) still rebuilds it from the document. A summary's `affectedBlockIds` are sorted into document order by each id's ancestor path rather than by a rank over every block, and a removal asks the index whether the block is listed elsewhere instead of scanning every array. Summaries are unchanged.

Breaking: no
