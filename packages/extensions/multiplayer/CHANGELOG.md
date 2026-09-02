# @input/pen-multiplayer

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
