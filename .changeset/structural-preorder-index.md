---
"@input/pen-core": patch
---

`documentState`'s nested preorder survives root-level structural commits (SCALE2): a removed root's subtree span leaves it and an inserted or moved root's subtree enters it ahead of the next root's span, with positions after the edit re-indexed lazily, instead of the whole preorder being dropped and re-walked on the next `preorderIndexOf`. An edit inside a `children` array, or a preorder that met a block twice (COL4), still rebuilds it on next read. `preorderBlockIds()` returns a fresh array after every change.

Breaking: no
