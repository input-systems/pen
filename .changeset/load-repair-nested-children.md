---
"@input/pen-yjs": patch
---

Stop load repair from copying nested children into the root order. `loadDocument` treated every block outside `blockOrder` as an orphan, so each `children`-array child of an ordinary saved document was appended to `blockOrder` on every load, the load reported `repaired` and emitted `crdt:recovered`. A block now counts as placed when it is in `blockOrder` or any live container's `children` array; only blocks in neither are re-homed, in id order so every peer writes the same repair. A container storing an inline title beside its `children` no longer raises `INVALID_BLOCK_STRUCTURE` (DUR2, RI6).

Breaking: no
