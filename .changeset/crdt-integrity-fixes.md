---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-yjs": patch
"@input/pen-multiplayer": patch
"@input/pen-ai": patch
"@input/pen-search": patch
---

Document integrity fixes for concurrent, out-of-order and malformed edits:

- **Encodable ops (OPB1):** `editor.apply` drops an op whose payload the CRDT cannot encode, with `PEN_APPLY_004`. Examples are a `set-meta` without a namespace, cyclic or non-plain prop, meta and app values, and non-finite mark values. Before, such an op could stop the document from syncing or persisting, or leave a partial write.
- **Missing parents:** a `parentId` that names no live block, and an insert or move into a parent deleted earlier in the same batch, are dropped with `PEN_APPLY_003` (PR5).
- **Dangling entries (COL4)**
  - Normalization removes `blockOrder` / `children` entries whose block was deleted (`dangling-block-reference`). Entries whose block map has not arrived yet are kept (new optional `CRDTAdapter.isBlockDeleted`).
  - Iteration APIs skip dangling entries instead of throwing `Block not found`.
- **Structural repairs on the next commit (COL4):** after a remote or undo commit, the next local commit repairs cycles, duplicates and cross-array membership. Orphans are re-homed with `orphan-block-rehomed`.
- **One nesting route (RI6):** deleting a container deletes its `children` descendants. A conflicting `parentId` is cleared with `nesting-route-conflict`.
- **Change summaries:** summaries now report the right `block-inserted` / `block-removed` / `block-moved` for concurrent delete-and-move, duplicate entries, replaced `children` arrays and container maps, re-entered containers, and deleted subtrees. Renderers, search and AI indexes no longer keep dead blocks or miss live ones (OB1, COL4). This adds `RawCommitDelta.absentBlockIds` and `arrivedChildArrays`.
- **Loading (DUR2):** load repair no longer copies nested children into the root order, and no longer removes an entry whose map is in flight.
- **System-origin writes:** normalization outside an apply runs in one `"system"`-origin transaction, so its repairs leave the undo stack. `setDocumentProfile()` no longer emits `ORIGIN_UNKNOWN`.
- **Awareness:** `DocumentSession.ensureAwareness(scopeId, factory)` lets the multiplayer extension create its own awareness. The extension now depends on `@input/pen-yjs` and peers on `yjs` and `y-protocols`.

Breaking: no
