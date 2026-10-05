---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-dom": patch
---

A structural commit in a large document no longer pays the block notifier's whole-document passes (SCALE2, SCALE6). `documentState` gains `rootBlockIds()` and `rootBlockIndexOf(id)`, the top-level sibling list kept by each commit's root edits; `getRootBlockIds` returns it instead of filtering `blockOrder`. The block notifier reads root positions from it, keeps a child-to-parent map as snapshots change instead of scanning every cached snapshot, drops unsubscribed snapshots from the set it recorded them in, and re-segments only the segments a commit's changed span and the runs around it reach. Positions after an edit replay the edits since they were last exact instead of scanning, the normalizer resolves `after` / `before` positions through its pass index, and a removal reads no array for a duplicate entry unless the index lists the id twice.

Breaking: no
