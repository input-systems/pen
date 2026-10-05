---
"@input/pen-core": patch
"@input/pen-dom": patch
---

A structural commit that names more than one block (an Enter, a merge) no longer scans the root order to sort its `affectedBlockIds` into document order (SCALE2): the change-summary block index keeps positions over its root order and advances them with each commit's deletes before its inserts. The block notifier's segment patch copies its segment list once instead of three times.

Breaking: no
