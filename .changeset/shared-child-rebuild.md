---
"@input/pen-core": patch
---

Keep a block's parent when one of two `children` arrays listing it drops its entry. Concurrent moves of one block into two containers list it in both until normalization repairs it; an undo or remote commit that removed one entry took the block's parent away in `documentState` although the other array still listed it, so `parentOf` returned null and the block appeared in `rootBlockIds()`. While any id is listed by two arrays, a `children` edit now rebuilds the document index, as SCALE2 states.

Breaking: no
