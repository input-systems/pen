# @input/pen-search

## 0.3.0

### Minor Changes

- 55f100d: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- 4d1c512: Document integrity fixes for concurrent, out-of-order and malformed edits:

  - **Encodable ops (OPB1):** `editor.apply` drops an op whose payload the CRDT cannot encode, with `PEN_APPLY_004`. Examples are a `set-meta` without a namespace, cyclic or non-plain prop, meta and app values, and non-finite mark values. Before, such an op could stop the document from syncing or persisting, or leave a partial write.
  - **Missing parents:** a `parentId` that names no live block, and an insert or move into a parent deleted earlier in the same batch, are dropped with `PEN_APPLY_003` (PR5).
  - **Dangling entries (COL4)**
    - Normalization removes `blockOrder` / `children` entries whose block was deleted (`dangling-block-reference`). Entries whose block map has not arrived yet are kept (new optional `CRDTAdapter.isBlockDeleted`).
    - Iteration APIs skip dangling entries instead of throwing `Block not found`.
  - **Structural repairs on the next commit (COL4):** after a remote or undo commit, the next local commit repairs cycles, duplicates and cross-array membership. Orphans are re-homed with `orphan-block-rehomed`.
  - **One nesting route (RI6):** deleting a container deletes its `children` descendants. A conflicting `parentId` is cleared with `nesting-route-conflict`.
  - **Change summaries:** summaries now report the right `block-inserted` / `block-removed` / `block-moved` for concurrent delete-and-move, duplicate entries, replaced `children` arrays and container maps, re-entered containers, and deleted subtrees. Renderers, search and AI indexes no longer keep dead blocks or miss live ones (OB1, COL4). This adds `RawCommitDelta.absentBlockIds` and `arrivedChildArrays`. A block that loses one of two order entries while its map is deleted or not stored is reported `block-removed`, and a block whose map a commit replaced whole reports `block-props-changed` (`"type"` when it changed, plus the arrived map's prop and meta keys). A write a commit listener makes while a remote delivery or undo is being committed now has a summary naming every insert and delete it made; before, a block it moved could be reported removed and some deletes went missing.
  - **Loading (DUR2):** load repair no longer copies nested children into the root order, and no longer removes an entry whose map is in flight.
  - **System-origin writes:** normalization outside an apply runs in one `"system"`-origin transaction, so its repairs leave the undo stack. `setDocumentProfile()` no longer emits `ORIGIN_UNKNOWN`.
  - **Awareness:** `DocumentSession.ensureAwareness(scopeId, factory)` lets the multiplayer extension create its own awareness. The extension now depends on `@input/pen-yjs` and peers on `yjs` and `y-protocols`.

  Breaking: no

- 4d1c512: Keystrokes, caret moves and structural edits cost in proportion to what they touch, not to document size (SCALE2, SCALE6).

  - **Indexes:**
    - `DocumentState` gains `preorderIndexOf`, `preorderBlockIds`, `rootBlockIds` and `rootBlockIndexOf`.
    - Root and `children` edits advance the position, parent, child and preorder indexes in place instead of rebuilding them.
    - The change-summary index and the normalization pass index advance by each commit's delta.
    - Measured at 50,000 blocks: an insert inside a container drops from about 41 ms to 0.15 ms, and a delete from about 11 ms to 0.3 ms.
  - **Selection reads:** selection validation, anchor resolution, `buildLazyNormalPositionSnapshot` and vertical caret motion no longer read every block.
  - **Scoped decorations:** new `scopedDecorationSource({ interest, decorate })` recomputes only the blocks a commit names. `decorationsChange` passes `(generation, changedBlockIds)`. `requestDecorationUpdate({ source?, blockIds })` targets sources, and with no argument it recomputes only function-form and static sources. AI suggestions and search use scoped sources, so typing with either installed no longer reads the whole document.
  - **Block notifier:** new `fieldEditor.blockNotifier` fans editor events out per block. React (`EditorBlock`, `InlineContent`), Vue (`PenBlock`, `PenInlineContent`) and the vanilla `mountEditor` tree re-render only the blocks whose state changed. Each block acknowledges its own mount. `blocks-merged` carries `sourceParentId` / `sourceIndex`. Its list slices are rebuilt after a commit that moves the document index without a structural change, such as a duplicate-entry repair.
  - **Multiplayer:** remote selection ranges look up positions in O(1).
  - **Normalization:** the structural rules treat the lowest parent id as the container of a block listed in several arrays. Normalized documents are unchanged.

  Breaking: no

- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [55f100d]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
  - @input/pen-types@0.3.0
  - @input/pen-core@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-core@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [8e2654b]
  - @input/pen-core@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- @input/pen-core@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-core@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-core@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-core@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-core@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-core@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-core@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-core@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-core@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [b359f9a]
  - @input/pen-core@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [ab64f16]
  - @input/pen-core@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. Document search and replacement primitives for Pen.

### Patch Changes

- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
