---
"@input/pen-core": patch
---

Deleting a block no longer reads every stored block's `parentId` (SCALE2). Normalization Rule 10, which promotes a deleted block's `parentId` children, now reads the blocks a `parentId` index lists under the deleted id — built on the first delete and advanced by every transaction's delta, local, remote and undo alike — plus the blocks the open transaction's ops and pass touched since the last observed commit. A delete at 50,000 blocks drops from about 11 ms to about 0.3 ms.

Breaking: no
