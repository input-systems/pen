# @input/pen-multiplayer

## 0.3.0

### Minor Changes

- 4d1c512: Structural commits report and revision only the blocks they touched (SCALE2). Awareness moves to its own subpath (API2), and peer colours pass a closed grammar (COL2).

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

- 4d1c512: Additive overlay APIs and remote-caret safety and contrast fixes:

  - `RootOverlay.holdCaretMode`, `overlayItemStyle` and `overlayLabelStyle` are exported for bindings.
  - `attachRemoteCarets(overlay, source)` and `getRemoteCaretSource(editor)` paint collaborators' carets. Vue gains `PenMultiplayerCaretOverlay`.
  - `FieldEditorImpl.setReadOnly` carries the renderer `readonly` prop.
  - New `isSafeCssColor` in `@input/pen-core`. Every `--pen-peer-color` write is re-validated, and carets paint through `background-color` so a colour cannot become an image fetch (COL2).
  - The default peer palette (`MULTIPLAYER_COLORS`) uses darker shades so labels meet 4.5:1 contrast. Hosts that pass `user.color` are unaffected.
  - A local keystroke that leaves every peer in place no longer notifies multiplayer subscribers or repaints remote carets.

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
  - @input/pen-yjs@0.3.0

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

- d67b176: Fix a collaboration crash where a peer's block selection unmounted the editor.

  `mergeBlockDecorationAttributes` in `@input/pen-react` turned a block decoration's attribute bag into props on the block host without the SEC2 skip that `applyElementAttributes` applies to inline decorations. `@input/pen-multiplayer` puts a `style` attribute on remote presence decorations, so a peer selecting a block sent a CSS string into a React `style` prop and React threw out of the commit phase, taking the editor's root with it. The React helper now skips `/^on/i`, `style`, and `dangerouslySetInnerHTML`, the last of which crashed the same way and is a markup sink only a React prop can reach. Dropping `style` also keeps RI1's `unicode-bidi: isolate` on the block host. `createRemotePresenceAttributes` no longer emits the `style` attribute that every conforming renderer discarded: style presence through `data-user-id`, and peer caret colour still comes from `RemoteCursorState.user.color`.

- d67b176: Show collaborators inside tables.

  A peer editing a table was invisible. `buildLocalAwarenessState` only recognised text and block selections, so a `CellSelection` fell through to `{ cursor: null, selection: null }` and nothing was published — and nothing downstream knew cells existed either, since `RemoteSelectionState` had no cell member.

  Cell selections now travel as `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and no cursor: a grid cell is the smallest region this presence names, so there is no caret to place, and coordinates rather than anchors match AS3's structural treatment of the local cell selection. COL2 validates them against the live grid — a cell on a block that holds no grid, or a row or column outside it, is rejected at ingest with the new `out-of-range-cell` reason — and resolve re-reads the grid on every commit so a peer whose rows were deleted under them clamps onto a live cell instead of vanishing.

  `@input/pen-react`'s table renderer marks the occupied cells with `data-pen-multiplayer-cell-selection`, the peer's head cell with `data-pen-multiplayer-cell-head`, and sets the caret overlay's `--pen-peer-color` on each. Because these come from the renderer rather than a presence decoration, they can carry a colour at all: SEC2 drops `style` from decoration attributes, so presence decorations emit none and every other surface is coloured from `data-user-id`. Hosts rendering their own grid can resolve the same mapping with `resolveRemoteCellPresence`, new on `@input/pen-dom/utils/remoteCellSelection` and re-exported from `@input/pen-react`.

  Both `RemoteSelectionState` and `PresenceRejectionReason` gain a member, so an exhaustive `switch` over either needs a new arm.

- d67b176: Fix AI generations losing their text when a collaborator types in the same block, and make a peer's AI run visible.

  Two separate faults met in the same block. `handleExternalCommit` cancels an active generation when a non-AI commit touches the block being written, which is right for the local user taking the keyboard back, but every update arriving through `applyUpdate` is `origin: "collaborator"` (COL1) and those were cancelling too. A peer typing anywhere in the block killed the run mid-stream and the model's remaining text never landed. The origins that leave a generation running are now a named set, and `collaborator` is in it.

  The `suggestion-splice` streaming sink then wrote each delta at the selection's original end offset plus the length streamed so far. Those offsets describe a document that stopped existing the moment a peer edited ahead of the write head: a two-character insert before the selection made every later delta land two characters early, splicing the arriving text into the middle of the text it was meant to follow. The sink now holds an anchor pair minted once at the start of the rewrite — a write head at the selection end and a delete start outside it — repairs both on content-move commits, and resolves them per delta, so a concurrent edit or a block split moves the head instead of corrupting it (ST2, AN14). Losing the rewritten text to a structural edit, or the block itself to a deletion, now reports a diagnostic instead of quietly appending.

  A peer's AI run is now visible as presence. The streaming preview is a local decoration and never enters the document (RS1), so there is nothing for a collaborator to sync; the run publishes a `streaming: { blockId }` awareness payload instead. That key was already being written but never arrived: the multiplayer validator dropped it as undeclared, and local presence writes replaced the awareness state wholesale, so any selection change unpublished it. `streaming` is now a declared, validated key, presence writes merge rather than replace, and `MultiplayerController.getRemoteStreaming()` plus a `pen-multiplayer-streaming` block decoration expose it to renderers. The run publishes the key once rather than on every flush, since the block id does not change and resending it would spend the peer's whole presence rate budget. COL2 is amended to name the declared key set — it claimed a `pen.*` namespace that no key has ever used.

  `createTwoPeerHarness` accepts `extensionsFor`, building each peer's extensions separately. An extension factory closes over the controller it activates, so two peers handed one instance share it, which made a headless two-peer test of any stateful extension impossible to write.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. Multiplayer presence and sync primitives for Pen.

### Patch Changes

- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
