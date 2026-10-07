# @input/pen-core

## 0.4.0

### Minor Changes

- cc0b350: `resolveSuggestionMenuTarget` with `boundary: "whitespace"` now anchors on the last trigger that has whitespace (or the start of the lookbehind) before it, instead of rejecting when the last trigger character does not. A later trigger character becomes part of the query, so `@ada@example` resolves as one mention query rather than closing the menu at the second `@`. Hosts that relied on a second trigger character closing the menu, such as `:smile:`, should set `closingChar`. `boundary: "any"` is unchanged.

  Breaking: yes — hosts whose `boundary: "whitespace"` trigger relied on a second trigger character closing the menu set `closingChar`

### Patch Changes

- 84f4d84: Snapshot op payloads for `onBeforeApply` hooks without recursing into cycles, so a cyclic payload is dropped with `PEN_APPLY_004` instead of overflowing the stack, reporting `PEN_APPLY_007`, and skipping the document-profile boundary hook.

  Breaking: no

- cc0b350: `useSuggestionMenu` no longer blanks an open menu on every keystroke. A synchronous `getItems` result is applied in the same state update that opens or retargets the menu, with no intermediate `loading` render. For an async `getItems`, a refined query on the same trigger keeps the previous `items` while `status` is `loading`, then swaps in its own; stale responses are still dropped. A `getItems` that throws synchronously now lands in the `error` state instead of escaping the refresh. `@input/pen-types` exports the `isPromiseLike` guard, which the hook and core's extension lifecycle now share.

  Breaking: no

- Updated dependencies [cc0b350]
  - @input/pen-types@0.4.0
  - @input/pen-yjs@0.4.0

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

- 56b8dfc: List items are announced as lists (AX1), numbering follows the announced list, and focus returns to its invoker by primitive class (AX3).

  - Each run of list items renders inside a `div[data-pen-list-group][role="list"]`. Each item's host carries `role="listitem"`, `aria-level`, `aria-posinset` and `aria-setsize`. This applies on React, Vue and `mountEditor`.
  - New core helpers `getListSegments`, `getListItemSemantics` and `isListItemType` describe these lists.
  - `getNumberedListItemValue` and the notifier's `list.ordinal` count numbered items over the item's sibling list instead of the root `blockOrder`. Markdown export's list `start` follows the same count.
  - Toolbar buttons and toggles keep focus in the field: they prevent the primary-button `mousedown` default. Escape returns focus to the editor.
  - The selection toolbar, block handle menu, table column menu, AI command menu and AI contextual prompt return focus to their invoker synchronously.

  Host migration:

  - Hosts that walk the blocks host's direct children, or style list items with `[data-pen-editor-block] + [data-pen-editor-block]`, must also look inside the `[data-pen-list-group]` wrappers. Items moving between groups are remounted by React and Vue.
  - A numbered item that follows a container with numbered `parentId` children now starts at 1, and items in a `children` array number 1, 2, 3. Hosts or snapshots that expect the old numbering update it. There is no API change.
  - Hosts whose toolbar `onClick` handlers relied on the button holding focus (for example by reading `document.activeElement`) read the editor selection instead.
  - Hosts that refocused the editor themselves after the AI command menu or contextual prompt closed remove that refocus.

  Breaking: yes — hosts look inside `[data-pen-list-group]` wrappers when walking or styling list items, update expected numbered-list values after containers, read the editor selection instead of toolbar focus, and drop their own refocus after AI menus close

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

- 56b8dfc: Additive overlay APIs and remote-caret safety and contrast fixes:

  - `RootOverlay.holdCaretMode`, `overlayItemStyle` and `overlayLabelStyle` are exported for bindings.
  - `attachRemoteCarets(overlay, source)` and `getRemoteCaretSource(editor)` paint collaborators' carets. Vue gains `PenMultiplayerCaretOverlay`.
  - `FieldEditorImpl.setReadOnly` carries the renderer `readonly` prop.
  - New `isSafeCssColor` in `@input/pen-core`. Every `--pen-peer-color` write is re-validated, and carets paint through `background-color` so a colour cannot become an image fetch (COL2).
  - The default peer palette (`MULTIPLAYER_COLORS`) uses darker shades so labels meet 4.5:1 contrast. Hosts that pass `user.color` are unaffected.
  - A local keystroke that leaves every peer in place no longer notifies multiplayer subscribers or repaints remote carets.

  Breaking: no

- 56b8dfc: Selection, focus and pointer fixes across React, Vue and vanilla `mountEditor`:

  - **Reading and writing the selection**
    - One `selectionchange` reader per root and one projector are the only code that reads or writes the DOM selection (S1).
    - Input edits the editor selection instead of re-reading the DOM.
    - `focus()` on a field with no caret commits one to the record.
    - Every projection reads the selection back. A mismatch emits `selection-projection-mismatch` once and is not rewritten (W3.R1).
    - The backend selection stamps (`FieldEditorSelectionSource`) are gone.
  - **Focus and projection timing**
    - Projections are withheld while an IME composes, while editor chrome holds focus, and while a host control holds focus (HOST9).
    - Undo/redo rebuilds and passive attaches no longer write the native range or steal focus.
  - **New APIs**
    - The selection convenience setters take an optional `SelectionWriteOptions` with `origin` (S3).
    - `FieldEditorImpl.scrollIntoView` and `FieldEditorImpl.setMountRequester` are new. A projection parked on an unmounted block asks the mount requester to mount it. `selection-target-unmounted` is emitted once per park, and `BlockScrollAlign` is added.
    - `FieldEditorImpl.connect()` keeps the field editor live under React Strict Mode.
    - `focusTextSelection` and `useFocusController` run in the calling turn (S4).
  - **Undo, redo and scrolling:** undo and redo scroll the restored selection into view even when the caret did not move. Scroll deltas round to whole pixels.
  - **Ranges over more than 50 blocks (S2):** these ranges, and ranges the engine confines to one field, show a substitute state with the focus sink revealed (`getSubstituteState()`, `pen.a11y.textRangeSelected`). Typing, deleting, IME input and clipboard actions work there.
  - **Fuzzer findings:** S2 cross-block projections now handle code blocks, tables, unit-block gaps, unmounted endpoints and WebKit drags.
  - **Gesture windows:**
    - Gesture windows survive a field switch.
    - `pointercancel` ends a pointer gesture, and drag and context-menu windows close properly (R1).
    - Touch selection handles keep their range (`native-range` window).
    - An EditContext keystroke after `editor.selectText` lands at the new caret (FE9).
  - **Clicks and arrows around atoms and blocks:**
    - A shift-click into another block extends to the offset under the pointer on every binding, including from a block or cell selection and over dividers.
    - Clicking an inline atom puts the caret on the clicked side, following the atom's bidi run (O1, T5).
    - `pen.caretUp` / `pen.caretDown` into a table select its edge cell (T5).
    - A click in a table cell during a text range selects the cell.
  - **Atom layout:** atoms share the text line, and a caret beside a chip takes the line's height. Compositions beside atoms no longer insert U+FFFC.
  - **Table cells:**
    - `CellSelection.text` is in `@input/pen-types`, and an edited cell keeps DOM focus (W3.R18).
    - `Mod-b`/`i`/`u` in a cell fail closed on keydown in every browser (FE6).
    - A table props/meta change no longer resets an edited cell.
    - Backspace and Delete in an edited cell delete the range or one character instead of clearing the cell. `editor.deleteSelection()` on a `CellSelection` with `text` deletes only that range (A1, T6).
  - **Positioned chrome:** the selection toolbar, AI prompt and slash/suggestion menus position from the editor selection, not the live DOM range. `DomScheduler.measureNow` drops geometry stale since the last commit (SCH2).
  - **Focus and activation:**
    - Shift+Tab out of the editor works in Firefox.
    - Overlay focus follows window blur (`bindEditorRootFocus`).
    - The toggle empty state, block-type select and slash-menu table insert activate in the same turn.

  Breaking: no

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0
  - @input/pen-yjs@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-yjs@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- 8e2654b: Export `inlineContentToOps(block, blockId, offset)`, which writes a pending block's inline content (text, marks, inline nodes) into an existing block. `blocksToOps` uses it for new blocks.
- @input/pen-yjs@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- @input/pen-yjs@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-yjs@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-yjs@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-yjs@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-yjs@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-yjs@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-types@0.2.6
  - @input/pen-yjs@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-yjs@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- 4ea7542: Count content blocks, not root blocks, when deciding document placeholder eligibility (RI8). A block schema can now declare `authoring.contentRole: "chrome"` for furniture the host puts in the document — an email signature, a quoted message — and such a block no longer suppresses the empty-document placeholder or pulls a click below the blocks into itself. `getBlockContentRole` (`@input/pen-core`) is the canonical reader; `contentRole` defaults to `"content"`, so existing hosts are unaffected.

  Eligibility names its block. `getDocumentPlaceholderTargetBlockId` (`@input/pen-dom`) returns the one block the hint paints on and the click-below caret lands in, or null when there is no target. The React and Vue bindings paint on the target instead of on the first root block, so a document that opens with chrome now shows the hint on its body. `InlinePlaceholderVisibilityOptions` replaces its `isFirstBlock` and `isDocumentEmpty` fields with a single `isDocumentPlaceholderTarget`.

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-yjs@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-yjs@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- b359f9a: Fix ArrowUp being a no-op (or skipping a line) when the caret sits at the start of a visual line, right after a `\n` soft break or a soft wrap. `pen.caretUp` / `pen.caretDown` now hand the selection's affinity to the geometry measure, and `verticalCaretTarget` measures the current caret on the side it is drawn instead of deriving the side from the motion direction (G5).
- @input/pen-yjs@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- ab64f16: `requestDecorationUpdate` and the commit-path refresh now reconcile the freshly collected decorations against the previous set: blocks whose decorations are structurally unchanged keep their `forBlock` list by identity, and a refresh that changes nothing keeps the set (and its generation) and emits no `decorationsChange`. Providers rebuild every decoration object on each pass, so before this a single-block change — one revealed word in a paced stream, one suggestion mark — re-rendered every block subscriber in the document. This is the SCALE2 identity contract applied to the explicit-request path.
- @input/pen-yjs@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Minor Changes

- e9a3129: Map a container's selection around the block when nested children supply the only inline content, and walk visible nested blocks for document-edge caret so Cmd+Down in an opened quote lands in the last nested paragraph instead of selecting the container. A decoration change on an expanded multi-block surface no longer collapses the cross-block selection into each rebuilt block: element-local selection preservation declines when an endpoint lies outside the element, and the selection is projected back from the editor after the rebuild.

### Patch Changes

- e9a3129: A plain ArrowLeft/ArrowRight on a non-collapsed text selection now collapses it to the range's start or end (T7) instead of trying to step the focus. A select-all followed by ArrowRight previously left the whole document selected because the focus already sat at the document end, so the next keystroke replaced everything.
- @input/pen-yjs@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- 7fb7864: Replace, delete, format, and move the caret through text in nested container children, not only top-level `blockOrder`.
- 7fb7864: Add a smooth-stream extension that paces paint of streamed text while the document stays complete.
- @input/pen-yjs@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Copy enumerable own symbol keys when snapshotting ops for onBeforeApply so opaque owner tokens survive the apply pipeline.
- cb50239: Regenerate `validateProps` from the merged `propSchema` when `override()` adds props without an explicit validator, so apply no longer strips the new props.
- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
  - @input/pen-types@0.1.8
  - @input/pen-yjs@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-yjs@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Cut and image drop close the undo capture window the same way paste already does. `clipboardFacet` now merges paste-importer tables (last-wins per key) so multiple providers compose, and the starter HTML clipboard contributes through that facet instead of `assignSlot`.
- Updated dependencies [d6a3b79]
  - @input/pen-types@0.1.6
  - @input/pen-yjs@0.1.6

## 0.1.5

### Erratum (2026-10)

Two changes below were breaking under API7 and should have shipped as `minor`, not `patch`. Commit `9e83fed1` downgraded their changesets to keep the 0.1.x train on 0.1.5.

- 67bf230: inline-atom schema registration now throws on a prop named `type`. Host action: rename that prop.
- c926c5e (vertical caret): a geometry-path vertical caret that lands on a non-text block now writes a `BlockSelection` instead of a collapsed text caret. Host action: handle `BlockSelection` on that path, and drop any window-level Enter workaround that relied on focus resting on `document.body`.

The `BlockSchema` `Content` widening (c926c5e) is types-only and stays graded `patch`.

### Patch Changes

- c926c5e: Widen `BlockSchema`'s `Content` default from `"inline"` to `ContentType` so nested, `none`, `table`, and `subdocument` blocks are bare `BlockSchema` values and belong in `SchemaRegistry.extend` without a cast (API10). `DefinedBlockSchema.a11y` is now the resolved spec intersected with the AX4 fluent attach, so `defineBlock()` is assignable to `BlockSchema`. Serialize/normalize callbacks on `BlockSchema` use method syntax so a specific `Type` remains assignable to the wide schema.

  This is graded patch, not minor: existing call sites that passed a correct `BlockSchema` still type-check, and hosts that already cast (the previous workaround) can delete the cast. The inference change is that `BlockSchema["content"]` is the `ContentType` union instead of the `"inline"` literal — that is the truthful type, not a break of a documented contract. Same grading as HOST8/HOST9, which shipped a real behavior change as patch with the reason written down; this change is types-only.

- 67bf230: Reject inline-atom schemas that declare a prop named `type`. Y.Text embed records use `type` as the atom discriminator and flatten props onto the same record, so that prop cannot be stored. Registration now throws at schema build time (SCH1). Hosts that declared the prop should rename it. Kept as `patch` so the 0.1.x train stays on `0.1.5`.
- c926c5e: Escalate a geometry-path vertical caret that lands on a non-text block to `BlockSelection`, matching the logical `crossBlock` path and N2. Hosts whose `setVerticalCaretMeasure` mapped the next line onto a textless block previously got a collapsed text caret there (`anchor-target-missing`, DOM focus on `document.body`). A measured collapsed caret on a table stays a text point so table autocomplete stays enabled. An existing host now receives a `BlockSelection` where this path previously wrote a collapsed text caret. Downstream composers that kept a window-level Enter listener alive only because this path left focus on `document.body` can drop that workaround after they bump. Kept as `patch` so the 0.1.x train stays on `0.1.5`.
- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-yjs@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-yjs@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-yjs@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- e80fedc: Fix silent content loss when an `insert-block` op names a block that already exists.

  Applying `insert-block` with a live block's id replaced that block's text, props, and meta with empty ones, emitted no diagnostic, and left a document that looked structurally intact. Reproduced on a paragraph holding `"user content"` with `origin: "user"`: after the second insert the block read `""` and its props were `{}`, with zero diagnostics.

  Three things combined to make it silent. Validate's block-existence guard explicitly exempts `insert-block`, since an insert is the one op whose target is expected not to exist yet. The executor then calls `initBlockMap`, which builds a fresh block map and sets it unconditionally rather than checking for an occupant. Normalization's duplicate-order rule finally stripped the second `blockOrder` entry, removing the only externally visible trace.

  Validate now claims a block id once per document: an `insert-block` whose id is already live, or already pending earlier in the same batch, is dropped with `diagnostic { code: "PEN_APPLY_010" }` and the existing block keeps its content. Pending-insert validation is unchanged, so a later op in the same batch may still target a block being inserted (`spec/rules/pipeline.md` PR3).

  The tool surfaces were not exposed and are unchanged: `edit_document`'s `insert_blocks` takes markdown plus a placement, and the standalone `insert_block` tool mints its own id, so a model cannot name the id of a block it inserts. The reachable callers were host code choosing its own ids and a `block-insert` stream part, where a server names the id — which is how this surfaced, since a transport that re-delivers one part destroyed a block. `@input/pen-tools` payload validation still accepts an `insert-block` naming a live block; apply is now the backstop that refuses it.

- e80fedc: Recognize container blocks from the schema and give every surface a children outlet.

  A host-defined container could hold children that no surface rendered. Container-ness was a hardcoded `new Set(["toggle", "callout", "blockquote"])` repeated in the DOM document tree, the DOM navigation utilities, two core command modules, and the React and Vue block renderers, so a host block declaring nested content was recognized by the document model, accepted by `editor.apply`, persisted by the CRDT, and then dropped at render. Nothing reported it: the children existed, `parentOf` resolved, and the block rendered as if empty.

  Containment is now declared. `isContainerBlock` (`@input/pen-core`) treats nested `content` or an explicit `isContainer: true` as containment, `isContainerBlockType` (`@input/pen-core`) resolves it for a block type, and `blockquote`, `callout`, and `toggle` carry the flag rather than being named in the renderers.

  Reading children needed one lookup, because there are two nesting routes and each hid the other. A block's `children` array holds children that are deliberately absent from `blockOrder`; the `parentId` prop holds children that sit in `blockOrder` as siblings. The old helper filtered `blockOrder` on `parentId`, so it could not see children-array children at all. `DocumentState.childrenOf(blockId)` is now the inverse of `parentOf` and covers both, returning children-array order first and `parentId` children in `blockOrder` sequence, backed by an index built in the same `rebuild()` pass that already builds the parent index.

  Each surface exposes one outlet. React gains `Pen.Editor.BlockChildren`, which was the missing half — Vue already passed `ctx.childNodes` to every renderer and the vanilla path already built a children host, so React was the only surface where a custom container renderer had no way to mount its children. Collapse stays the renderer's decision through `shouldRenderContainerChildren`, which reads resolved rather than stored props (`open !== false`), so a container whose `open` defaults to `false` stays collapsed once normalization strips that default from storage — `toggle`'s exact shape, and the reason the predicate cannot read raw storage. DOM navigation calls the same predicate, so keyboard traversal and rendering agree about what is visible.

  Nothing is removed. `@input/pen-dom`'s `getParentIdChildBlockIds` is renamed `getChildBlockIds` on the `./utils/parentIdTree` subpath, since it no longer looks at `parentId`, and the old name stays as a deprecated alias so 0.1.x consumers of that subpath keep working. `@input/pen-vue` picks up children-array support through the same helper with no API change.

  One gap stays stated rather than fixed (`spec/rules/dom.md` RI6): a `parentId` naming a non-container renders nowhere, because `getRootBlockIds` drops every block that has a parent while a non-container is given no children host.

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-types@0.1.2
  - @input/pen-yjs@0.1.2

## 0.1.1

### Patch Changes

- 2f9bbe2: Stop the commit path from re-reading the whole document on every apply.

  Held Backspace felt slow because each keystroke cost time proportional to document size, not to the change (`spec/rules/scale.md` SCALE2). On the SCALE3 realistic-stack bench a keystroke took 0.48ms at 100 blocks and 3.76ms at 1000 — a 7.8× rise for 10× the blocks, so a held key on a large document fell behind auto-repeat. CPU profiling of a 2000-block backspace burst attributed the time to three whole-document passes, all on the per-commit path.

  `createBlockIndexSnapshotFromDocument` (36.6% of profiled time) rebuilt the block index from storage on every Yjs transaction, calling `toString()` on every block's `Y.Text` to recover lengths the commit already knew. The index now advances in place for a text-only commit, applying the splice lengths the change summary carries, and only re-reads the document when a commit changes structure — where the shape genuinely has to come from storage rather than from replayed summaries. The unused `apply(summary)` entry point that tried to replay structure into the index is gone rather than fixed; nothing called it, and reconstructing document shape from a summary is the thing this split is avoiding.

  The normalizer's pass index (40.2%) was discarded and rebuilt from `blockOrder` and every `children` array once per dirty block, then once more at the end of the pass. It is now invalidated where structure actually changes: `SchemaEngineImpl.notifyStructureChanged()`, called by the apply pipeline when it executes an `insert-block`, `delete-block`, or `move-block`, and by the change-summary installer when a remote or undo transaction moves `blockOrder` or a `children` array. That second caller is the one the engine cannot see for itself — normalization runs only inside a local apply, so a peer's structural edit would otherwise be invisible to the next pass's cached index.

  `reportUnknownBlocksInDocument` (8.3%) scanned every block and linearly compared its type against the registry to satisfy `spec/rules/durability.md` DUR3. Validation (PEN_APPLY_002) already rejects a local op carrying an unregistered type, so only a remote update or a load can introduce one, and either changes the block count. The scan is now gated on that count and skipped when it has not moved.

  Also short-circuits `affectedBlockIdsFromSummary`, which built a document-order rank map to sort a list that, on the common commit, holds one id.

  After the fix the same bench reads 0.04ms at 100 blocks and 0.06ms at 1000, and the direct backspace probe is 18.7× faster at 2000 blocks with per-block cost falling rather than flat. Every SCALE3 median now sits below the 0.5ms attribution floor, so a ratio between two of these points would be timer noise. The recorded baselines move and the gate becomes a flat 2ms, which is 4× the floor and below the 3.58–3.76ms the 1000-block rungs cost before the fix; the old 25–50ms slack was wide enough that a full return to per-document commit work would have passed. That leaves 33–50× headroom on this machine class, in the same range as the 10–52× the previous gates carried. The 100-block rung takes the same 2ms rather than something tighter: it cost 0.48ms before the fix, so any gate able to catch a regression there would sit under the attribution floor.

  `@input/pen-core` gains three regression tests that each fail when their own fix is reverted — incremental block lengths (observed through a merge's `joinOffset`), a remote structural change reaching the next local normalization, and an unknown type arriving by remote commit still raising DUR3's diagnostic.

- d67b176: Fix the slash menu inserting the wrong block type.

  `Pen.SlashMenu.List` in auto mode regrouped `items` by `display.group` and handed each option a counter that restarted from the grouped order, while `confirm(index)`, `select(index)`, and `selectedIndex` all index the flat `items` array from `useSlashMenu`. Any schema whose groups are not contiguous in registration order made the two orders disagree, and the default schema is one: it registers `bulletListItem`, `numberedListItem`, and `checkListItem` between `heading` and `codeBlock`, so `basic` resumes after `lists` has started. Choosing Code Block inserted a bullet list, Divider inserted a numbered list, and Quote inserted an image. Arrow-key navigation moved the active option through the flat order too, so the highlight jumped around the rendered list and `aria-activedescendant` named an option other than the visible one, against AX3.

  `useSlashMenu` now returns items already partitioned by group, so the order the menu navigates is the order it renders, and the query path groups after its relevance sort so the closest match stays at index 0. The list builds group headings by breaking consecutive runs instead of regrouping, which means every option carries its real index in `items` and a list that ever saw an ungrouped array would repeat a heading rather than resolve the wrong block.

  The ordering itself is DOM-free and now ships from `@input/pen-core` as `orderSlashMenuItemsByGroup` and `slashMenuGroupOf`, next to `shouldShowBlockInDefaultMenus` and the `allBlockDisplays()` registry it reorders, so a second renderer's slash menu inherits the invariant instead of reimplementing it (API6).

- d67b176: Fix Cmd+Backspace clearing a line visually while the document kept the text.

  On macOS, `Cmd+Backspace` cleared the field and the next keystroke brought the deleted text back. Two gaps lined up. The default keymap bound `Cmd-ArrowLeft` to line motion but never bound `Cmd-Backspace` to the matching delete, so the key fell through to the browser; and the EditContext backend listened only for `textupdate`, so nothing else was watching. Chromium does not route line-granularity deletes through an attached EditContext — it runs them as plain DOM edits against the editing host — so the field emptied while the document still held all eleven characters. The next reconcile repainted the model over the DOM, and the text reappeared.

  The keymap now binds `Cmd-Backspace` (delete to line start) and `Ctrl-k` (delete to line end) on macOS, matching that platform's line motion. Windows and Linux are unchanged; they have no line-delete convention.

  The EditContext backend now runs the B1 `beforeinput` policy as a floor, so an editing intent the EditContext never reports is still claimed by the document rather than left to rewrite the field. The rows Chromium does deliver as `textupdate` — `insertText`, `insertReplacementText`, and the composition types — stay allowed there and only there, because preventing their default cancels the `textupdate` with it and loses the keystroke. Anything unrecognised is prevented and reported as `unhandled-input-type` instead of silently editing the DOM.

  `deleteSoftLineForward` and `deleteHardLineForward` were missing from the shared `beforeinput` table and are now mapped alongside their backward counterparts, so `Ctrl-k` is handled on the contenteditable and expanded backends too.

- Updated dependencies [f4220b9]
  - @input/pen-yjs@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The headless, extension-first editor engine for human-AI co-authoring: the `editor.apply(ops, { origin })` mutation pipeline, validation, normalization, selection, the extension manager, and the event surface. Runs without a DOM via `createHeadlessEditor`.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- f4e78f9: Index blockOrder membership and child-to-parent links for each normalize pass so `normalizeAll` on envelope-sized documents stays linear instead of scanning the document per block.
- Updated dependencies [e88ceeb]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-types@0.1.0
  - @input/pen-yjs@0.1.0
