---
"@input/pen-core": patch
---

Return a block to `rootBlockIds()` when it loses its last `children` entry while the root order lists some block twice. The top-level list could only rejoin such a block at a root position, which a root order with a duplicate entry (COL4, until normalization repairs it) does not hold, so the block stayed out of the list until the next rebuild. The held list is now dropped and rebuilt on next read.

Breaking: no
