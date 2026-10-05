---
"@input/pen-core": patch
---

Reject a `parentId` prop that names no live block. `set-props { parentId: "nope" }`, or an `insert-block` carrying one, was accepted and took the block out of `rootBlockIds()`, rendering it nowhere. Such an op is now dropped at validate with `PEN_APPLY_003`, as an insert or move into a non-existent `{ parent }` already is (PR5); a parent inserted earlier in the same batch is still valid, and clearing `parentId` always is.

Breaking: no
