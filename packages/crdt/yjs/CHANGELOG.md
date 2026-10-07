# @input/pen-yjs

## 0.4.0

### Patch Changes

- Updated dependencies [cc0b350]
  - @input/pen-types@0.4.0

## 0.3.0

### Minor Changes

- 56b8dfc: Structural commits report and revision only the blocks they touched (SCALE2). Awareness moves to its own subpath (API2), and peer colours pass a closed grammar (COL2).

  - `CRDTEvent.affectedBlocks` on remote and undo transactions that touch `blockOrder` lists only the blocks inserted, removed or moved.
  - `editor.getBlockRevision()` advances only for blocks a commit changed.
  - An `insert-block` / `move-block` into a `{ parent }` that does not exist is dropped with `PEN_APPLY_003` (PR5).
  - Awareness lives at `@input/pen-yjs/awareness`, and `y-protocols` becomes an optional peer. `yjsAdapter()` creates no awareness: the multiplayer extension creates its own. A second yjs copy writing to a Pen document emits `YJS_SINGLETON_MISMATCH`.
  - `normalizeMultiplayerColor` accepts only hex, named, `rgb`/`rgba` and `hsl`/`hsla` colours with plain numeric arguments. A colour such as `rgb(0,0,0) url(…)` could make every viewer fetch a URL.

  Host migration:

  - Code that read `CRDTEvent.affectedBlocks` on a remote or undo structural transaction as "every block" treats it as the touched blocks only.
  - Hosts that used a revision bump on every block as a "something structural happened" signal listen to `commit` events.
  - Hosts that inserted or moved blocks into a missing parent handle the `PEN_APPLY_003` drop.
  - Import `createYjsAwareness`, `getYjsAwareness`, `encodeYjsAwarenessUpdate` and `applyYjsAwarenessUpdate` from `@input/pen-yjs/awareness`. Hosts that wire a provider without the multiplayer extension pass `yjsAdapter({ awareness: createYjsAwareness })`.
  - A host that set `user.color` to `var(--…)`, `inherit`, `color-mix(…)`, `oklch(…)` or another colour function passes a hex, named, `rgb` or `hsl` colour instead. Other values fall back to the palette colour.

  Breaking: yes — hosts treat `affectedBlocks`/`getBlockRevision` as touched-blocks-only, handle `PEN_APPLY_003` for missing parents, import awareness helpers from `@input/pen-yjs/awareness` (or pass `yjsAdapter({ awareness: createYjsAwareness })`), and use hex/named/`rgb`/`hsl` peer colours

- c921845: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- 56b8dfc: AI write attribution, undo grouping and review preview fixes:

  - **Undo grouping (AIB4)**
    - Undo capture is keyed. One AI action stays one undo step even when the user types during it, and the user's typing stays its own steps.
    - `directTransport` and `createSSEHandler` give each request one undo group.
  - **Overlapping calls (AIB3)**
    - Overlapping tool calls and generations keep their own write guard and staged-write binding. A call closing out of order no longer drops another call's guard or unstages its writes.
    - `directTransport`, `createSSEHandler` and `processStream` apply the editor's `confirm` / `unconfirmedDestructive` policy and accept their own overrides. They allow destructive calls by default when no `confirm` is set, so a server reachable by clients should pass `"refuse"` or a `confirm`.
  - **Review preview (RS6):** the `edit_document` streaming preview matches what accept will do: multi-block and nested replaces and deletes, insert placement, empty replacements, and moves and formatting. `EditDocumentPreviewUpdate` gains `blockIds`, `placement` and `complete`. `AIStreamingReviewPreviewInput` gains `complete`, `deletesBlocks` and `replacesBlocks`.
  - **Undo drift anchors:** undo reuses the selection authority's anchors through `editor.internals.selectionAnchors()` and `selectionAnchorRepair()` (AN14). This stops spurious `anchor-target-missing` for ranges that end on dividers or tables, and halves `anchor-budget` churn.
  - **Anchor repair (AN2, AN14):** `repairAnchor` reads an anchor's position from before the commit even when something resolved it after the commit landed, so a split no longer moves an anchor to the start of the new block. An anchor that resolved to `null` before a commit stays dead instead of being revived from an older position, and a merge carries an `assoc: -1` anchor at the start of the merged-away block into the target instead of losing it.
  - **React AI chrome:** the AI suggestions popover is scoped to its own editor. `Pen.AI.ContextualPromptComposer` no longer throws a hook-order error when a session opens.

  Breaking: no

- 56b8dfc: Document integrity fixes for concurrent, out-of-order and malformed edits:

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

- 56b8dfc: Keystrokes, caret moves and structural edits cost in proportion to what they touch, not to document size (SCALE2, SCALE6).

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

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
  - @input/pen-types@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
  - @input/pen-types@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-types@0.1.2

## 0.1.1

### Patch Changes

- f4220b9: Report a block that arrives carrying content as an insert of that content, so a peer's split repairs anchors instead of stranding them.

  Yjs leaves a type created inside a transaction out of `txn.changed`. A block whose text is written at construction — a split's tail block, an import, a paste — therefore produced no text delta at all, and `createSummarySource` had nothing to report: observers saw the block appear and its text arrive from nowhere.

  AN14 says a remote peer's split repairs a local position, deriving the move from "same-length delete/insert pairing across blocks". The pairing could never fire. A split reaches the receiving peer as a delete on the source block and a new block whose content was invisible, so `deriveContentMoves` saw a delete with nothing to pair it against and returned no move. Every anchor in the moved range stayed on the source block at the cut offset — including the write head core's `openTextStream` holds, which is why the rule was written in the first place. The only coverage was a hand-built summary carrying an insert splice that a real remote split never produces.

  The gate for reporting the text is the block's entry changing on the `blocks` map, so a reorder — which touches only the order arrays — never restates existing text as an insert. This also corrects the block index, which had been recording a newly arrived block's length as zero.

- @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The Yjs CRDT adapter for Pen: document shape (`blockOrder`, `blocks`, `apps`, `metadata`), transactions, update handling, and undo integration.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [a022804]
  - @input/pen-types@0.1.0
