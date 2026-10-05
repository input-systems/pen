---
"@input/pen-core": patch
---

An edit inside a `children` array no longer rebuilds the document index (SCALE2). An insert, move or delete inside a container — an Enter in a toggle or callout child — rebuilt `documentState`'s parent, child and position indexes from every block and dropped the nested preorder. Each transaction now names the `children` arrays its delta touched; the index re-reads only those arrays, and each edited container's preorder span is replaced by a fresh walk of its subtree. A typing edit in a container no longer drops the preorder either. Such an insert at 50,000 blocks drops from about 41 ms to about 0.15 ms. A document that lists a block in two arrays or on both nesting routes (COL4, RI6) still rebuilds until normalization repairs it.

Breaking: no
