# @input/pen-undo

## 0.4.0

### Patch Changes

- Updated dependencies [84f4d84]
- Updated dependencies [cc0b350]
- Updated dependencies [cc0b350]
  - @input/pen-core@0.4.0
  - @input/pen-types@0.4.0

## 0.3.0

### Minor Changes

- c921845: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

- 56b8dfc: The editor selection record is now the single source of truth for every caret, range, cell, focus and pointer path. The renderers read and write the DOM selection only through it (S1), and every selection write carries its real origin (S3).

  - Arrow keys beside inline atoms go through the keymap. In right-to-left blocks they follow the visual direction (M2).
  - `BlockHandle.length()` counts each inline embed as one offset, so a block that holds only atoms has length 1 (N1).
  - An edited table cell's caret is `CellSelection.text` (`{ anchor, focus }` in the cell's offsets). It is validated, anchored and mapped through remote edits. `selectionChange` now fires for in-cell caret moves, and Shift+Arrow inside a cell extends the range. `setCellCaretFocus`, `getCellCaretFocus`, `CellCaretFocus` and `CellCaretWrite` are removed.
  - Pointer gestures, drops and pointer pastes write origin `pointer`. Keymap commands, text input and shortcut pastes write `keyboard`, or `ime` while composing. Undo and redo write `restore`. Keyboard, IME and history moves scroll into view.
  - Focus follows the selection record. Block and cell selections focus the focus sink. App and `null` selections focus the root, but only while the editor already owns focus. Escape writes the selection and lets its projection place focus (W3.R16).
  - `programmatic`, `mapped` and `gc` writes no longer take focus the editor does not own (HOST9). Projection and focus work in editors mounted in an iframe. Tabbing into a multi-block range projects it.
  - A reconcile no longer saves and restores the native selection. Rebuilt blocks are projected through `fieldEditor.projectAfterRebuild(blockIds)` (P3).
  - A parked projection resolves on the mount ack of its own block (P4). `DomScheduler` no longer projects selections.
  - Pointer drags and block clicks are resolved through core's transitions (`resolvePointerSelectionIntent`). A pointer selection that moves to another block ends the current undo step.
  - The contenteditable, EditContext and expanded backends share one base class (CS5).
  - `FieldEditorImpl` and `FieldEditorSession` drop methods that only forwarded to pen-dom internals. pen-dom reports gestures itself.

  Host migration:

  - Hosts that relied on ArrowLeft always meaning "previous atom" in right-to-left blocks now get the visual direction. There is no API change.
  - Hosts that read `length() === 0` as "this block has no text" check `textContent() === ""` instead when an atom-only block must count as empty.
  - Hosts that drove in-cell caret motion through `setCellCaretFocus` write a `CellSelection` with `text` instead: `editor.setSelection({ type: "cell", blockId, anchor: cell, head: cell, text: { anchor: caretOffset, focus: caretOffset } })`. Hosts that treated every `selectionChange` to a `cell` selection as a grid move check `text` first.
  - Hosts that call `applyDocumentTextSelection` or `applyDomTextSelection` pass the gesture's origin, for example `"pointer"`.
  - Hosts that read `selectionChange` origins see `restore` for history restores and drop any `programmatic` check they used to detect them.
  - Hosts that call `handleEscapeSelectionTransition` drop `root`. Hosts that relied on Escape or `deactivate()` focusing the block element focus the sink or root instead.
  - Hosts that called `editor.setSelection` (or another programmatic write) while focus was outside the editor, and relied on it focusing the editor, now focus it explicitly. In React use `useFocusController().text(…)` / `.range(…)`; elsewhere use the field editor's `focus()`.
  - Hosts that called `saveSelection` / `restoreSelection` or passed `preserveSelection` to `fullReconcileToDOM` / `fullReconcileDeltasToDOM` drop them and call `fieldEditor.projectAfterRebuild([blockId])` after rebuilding a block.
  - Hosts that called `editorSelectionToDOM` call `editor.setSelection` instead and let the field editor project it. `findDOMPoint` is now exported from `@input/pen-dom/field-editor/selectionBridge`.
  - Hosts that passed `onProjectSelection`, called `setProjector` or read `projectedThisFlush` on a `DomScheduler` drop those calls, and the `SelectionProjector` type is gone. Selection projection runs in the field editor.
  - Hosts that call `resolvePointerDragSelection` drop the `getBoundaryPoint` option. Hosts that build a `PointerSelectionGesture` by hand use `createPointerSelectionGesture`, or set `startSelectionVersion` and `committed: false`.
  - Hosts that call `attachContentGestures` drop `skipNextClick` from `state`.
  - Hosts that subclass a backend and use a removed protected member move to the new members:
    - `ContentEditableBackend`: `fullReconcileActiveField` becomes `rebuildField(inlineDecorations?, blockId?)`, and `applyTextDiffAsOps` drops its `deferredRemoteDeltas` argument.
    - `EditContextBackend`: `resolveEditorSelectionRange`, `resolveCollapsedEditorSelectionRange`, `getAuthoritativeTextInputSelection` and `resolveKeyDownRange` become `authorityRangeIn(blockId)` / `trustedCaretIn(blockId)`.
  - Hosts drop calls to the removed field-editor forwarders: `beginPointerSelection`, `endPointerSelection`, `notifyGestureEvent`, `isAdmissibleGestureRead`, `getGestureWindows`, `requestDivergenceProjection`, `shouldProjectSelectionAfterReconcile`, `requestActivation` and `resolveInsertMarks`. Focus, pending marks and post-rebuild projection keep their session methods.

  Breaking: yes — hosts apply the migration list above (pass origins, write `CellSelection.text` instead of `setCellCaretFocus`, replace `saveSelection`/`restoreSelection`/`editorSelectionToDOM` with `editor.setSelection` plus `projectAfterRebuild`, drop removed scheduler/gesture/forwarder members, focus the editor explicitly after programmatic writes)

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

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
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

- a022804: First public release. Undo and redo for Pen, with origin tagging so user, AI, and collaborator edits group correctly.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
