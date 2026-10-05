# @input/pen-dom

## 0.3.0

### Minor Changes

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

- 56b8dfc: Pen draws carets, remote carets and block outlines into one overlay layer per editor root, which the DOM scheduler paints. React's caret overlays are now bindings over it, and Vue gets the overlay with no component.

  - Each editor root holds one `data-pen-overlay-layer` element as its last child. `getRootOverlay(root)` exposes the paint plan and the contributor API.
  - The overlay caret is on by default on every surface. It draws carets beside mentions and inline apps, in empty blocks, and at range endpoints. Block and grid-cell selections get a library outline.
  - New tokens: `--pen-overlay-z-index`, `--pen-editor-endpoint-caret-color`, `--pen-block-selection-outline`, `--pen-block-selection-background`, `--pen-block-selection-radius`, `--pen-selection-range-background` and `--pen-selection-range-opacity`.
  - The editor root is the layer's containing block (OV2). The chrome stylesheet gives it `position: relative` at zero specificity, and a static root gets it inline while attached.
  - `Pen.Editor.CaretOverlay` switches the root to `customCaret` mode, and pen-dom paints the caret. The blink restarts on each edit and caret move.
  - `Pen.Multiplayer.CaretOverlay` registers the remote-caret contributor. Remote carets stay on their text inside transformed ancestors, and the binding drops its `MutationObserver`, rAF loop and scroll listeners.
  - `EditorSelectionRect` draws only the region-selection marquee.

  Host migration:

  - Host CSS that targets the editor root's `:last-child` accounts for the `data-pen-overlay-layer` element.
  - Hosts that already style `[data-selected]` set `--pen-block-selection-outline: none` on the editor root (or drop their rule) to avoid a double outline.
  - Set caret and outline tokens (`--pen-editor-caret-*` included) on the editor root or above, not on a wrapper inside it.
  - Scope `[data-block-id]` selectors to `[data-pen-editor-block]` if they must not match overlay items.
  - Absolutely positioned host elements inside a static editor root now position against the root. Give the root its own non-static `position` to keep another containing block.
  - `renderCaret` (editor and multiplayer) and `renderLabel` position from the `transform` in `caretStyle` / `labelStyle`, not `left` / `top`. Their nodes are portaled into the overlay layer, and `renderCaret` receives `affinity`.
  - Hosts that style `[data-pen-editor-caret-overlay][data-caret-visible]` target `[data-pen-overlay-layer][data-caret-visible]`.
  - Remote carets move from the `[data-pen-multiplayer-caret-overlay]` host into the layer. Restyle them under `[data-pen-overlay-layer] [data-pen-multiplayer-caret]`. They change from `position: fixed` with `left` / `top` to `position: absolute` with a `transform`. The default label is a child of its caret and no longer carries `data-pen-multiplayer-caret` or the user attributes.
  - Hosts that relied on `EditorSelectionRect` to draw a committed block selection style `--pen-block-selection-outline` / `--pen-block-selection-background` on the editor root instead.

  Breaking: yes — hosts update `:last-child`, `[data-selected]`, caret-overlay and remote-caret CSS for the root's `data-pen-overlay-layer`, position custom `renderCaret`/`renderLabel` output from `transform`, set tokens on the root, and give the root its own `position` if it must not be the containing block

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

- 56b8dfc: Accessibility, iframe and binding fixes:

  - **Reduced motion (AX6):** each root has one shared reduced-motion signal. The new `getRootReducedMotion`, `AX6_MOTION_MAPPING` and `REDUCED_MOTION_ATTR` are in pen-dom, and `useReducedMotion()` is in pen-react. The AI suggestion underline no longer animates under reduced motion.
  - **Announcements (AX2):** live-region announcements are written in the scheduler's write phase.
  - **Focus return for custom chrome (AX3):**
    - New `captureFocusReturn` / `restoreFocusReturn` implement the focus-return rule.
    - The slash, suggestion and table column menus dismiss on an outside `pointerdown`.
  - **Iframe-mounted editors:**
    - Every node and event check uses realm-safe guards, exported from the new `@input/pen-dom/utils/domNodes` subpath (`isDomNode`, `isDomElement`, `isDomEvent` and others).
    - Nodes are created in the field's own document, and chrome resolves its document through `resolveEditorOwnerDocument`.
  - **`asChild`:** `asChild` composes the child's handlers, class names and styles with the primitive's instead of replacing them.

  Breaking: no

- 56b8dfc: IME composition no longer loses, duplicates or misplaces text:

  - EditContext compositions have one lifecycle from `compositionstart` to `compositionend` (C4). Multi-update compositions (pinyin, Korean, Japanese) no longer delete text after the caret. Typing no longer duplicates edits in the buffer.
  - Collaborator, AI, extension and history edits that arrive mid-composition are deferred. The composition is rebased over them with Yjs placement on both backends (C2, COL1).
  - A cancelled or empty composition returns the caret to its start and renders deferred decorations (C1).
  - A composition over a cross-block selection no longer crashes React in Firefox. It opens the IME window in the expanded host.
  - An Android `keyCode` 229 keydown no longer deletes a cross-block range by itself (FE2).

  Breaking: no

- 56b8dfc: HTML import no longer drops pasted text.

  - Nested lists from Slack, Apple Notes and Google Docs keep every item at the right indent.
  - Block content wrapped in an inline element (Google Docs' outer `<b>`) stays as separate blocks.
  - Table captions and text outside `<code>` in a `<pre>` are kept.
  - A conversion that would still lose text falls back to plain paragraphs or the literal clipboard text.
  - The sanitizer's `isomorphic-dompurify` moves from `~2.36.0` to `~4.3.0`. Its allowlist and output are unchanged (SEC7).

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
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0
  - @input/pen-core@0.3.0
  - @input/pen-shortcuts@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-core@0.2.14
  - @input/pen-shortcuts@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- bbf8fe9: Keep the caret inside code blocks: ArrowUp/ArrowDown now stop on blank lines instead of skipping past them, and a click in a code block places the caret where it lands instead of at the top.
- 9032a68: Place pasted content (parsed HTML and Markdown, full blocks from the Pen clipboard, and multi-line plain text) at the caret instead of after the caret's block: the first pasted block joins the text before the caret, the last joins the text after it, and blocks in between split the line. A paste whose caret block no longer exists is dropped with a `paste-target-missing` diagnostic.
- Updated dependencies [8e2654b]
  - @input/pen-core@0.2.13
  - @input/pen-shortcuts@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- 859910e: Preserve HTML block structure, blank-line spacing, inline marks, lists, and text alignment when pasting formatted HTML.
- @input/pen-shortcuts@0.2.12
  - @input/pen-core@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- 22f354e: Make editor roots a single tab stop that transfers keyboard focus into the active text or selection surface, and keep nested toggle controls at an accessible target size.
- @input/pen-core@0.2.11
  - @input/pen-shortcuts@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-core@0.2.10
  - @input/pen-shortcuts@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-core@0.2.9
  - @input/pen-shortcuts@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-core@0.2.8
  - @input/pen-shortcuts@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-core@0.2.7
  - @input/pen-shortcuts@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- ba82d14: Fix list input rules eating text when a marker is inserted before existing content on a line. Typing `* ` at the start of a line that already has text (for example `hello`) now converts to a bullet list while preserving the rest of the line.
- a2e17a8: Paste a plain-text URL as an inline link. A collapsed caret inserts the URL as linked text; a text selection keeps the selected text and wraps it in a `link` mark. URLs rejected by `urlPolicy` (for example `javascript:`) fall through to ordinary paste.
- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-core@0.2.6
  - @input/pen-shortcuts@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- f792d89: Preserve backward keyboard selection direction across repeated word-selection commands and allow word selections to continue extending across multiple blocks.
- @input/pen-core@0.2.5
  - @input/pen-shortcuts@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- 4ea7542: Count content blocks, not root blocks, when deciding document placeholder eligibility (RI8). A block schema can now declare `authoring.contentRole: "chrome"` for furniture the host puts in the document — an email signature, a quoted message — and such a block no longer suppresses the empty-document placeholder or pulls a click below the blocks into itself. `getBlockContentRole` (`@input/pen-core`) is the canonical reader; `contentRole` defaults to `"content"`, so existing hosts are unaffected.

  Eligibility names its block. `getDocumentPlaceholderTargetBlockId` (`@input/pen-dom`) returns the one block the hint paints on and the click-below caret lands in, or null when there is no target. The React and Vue bindings paint on the target instead of on the first root block, so a document that opens with chrome now shows the hint on its body. `InlinePlaceholderVisibilityOptions` replaces its `isFirstBlock` and `isDocumentEmpty` fields with a single `isDocumentPlaceholderTarget`.

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4
  - @input/pen-shortcuts@0.2.4

## 0.2.3

### Patch Changes

- 341d6a8: `pointToEditorSelectionPoint` snaps a coordinate above the first block to that block's start and one below the last block to that block's end (G4), instead of resolving the x-nearest offset in the outer block. During a pointer drag that leaves the editor root this is the same range the browser's native drag clamps to, so Pen and the DOM no longer overwrite each other on every `mousemove` and the selection stops flickering.
- 90e74c2: Re-measure cached geometry when a block's live box moved without a resize, font, scroll, or commit generation change, so the overlay caret, selection rects, and menus follow the editor after a window resize re-centres a max-width column.
- @input/pen-core@0.2.3
  - @input/pen-shortcuts@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- b359f9a: `Pen.Toolbar.Button` and `Pen.Toolbar.Toggle` compose a host `onClick` with their own action instead of letting it replace the action. A Slot-style wrapper that merges its `onClick` onto the element (a tooltip trigger, for example) no longer silences `onAction` / the mark toggle; the action is skipped only when the button is disabled or the host handler called `preventDefault()`.

  `resolveSelectionRect` measures a selection that spans blocks per block, so the rect covers the selected text rather than the border boxes of the blocks it fully covers. `useSelectionToolbar` reads that rect first for spanning selections; the selection toolbar sits over the text instead of centring on the column.

- b359f9a: Fix ArrowUp being a no-op (or skipping a line) when the caret sits at the start of a visual line, right after a `\n` soft break or a soft wrap. `pen.caretUp` / `pen.caretDown` now hand the selection's affinity to the geometry measure, and `verticalCaretTarget` measures the current caret on the side it is drawn instead of deriving the side from the motion direction (G5).
- Updated dependencies [b359f9a]
  - @input/pen-core@0.2.2
  - @input/pen-shortcuts@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- 1c57d72: `SessionReconciler` compares the decoration set it last saw against the one a `decorationsChange` carries and only rebuilds the active blocks whose own `forBlock` list changed identity. A paced reveal or a suggestion mark landing on another block no longer rebuilds the editing surface and bumps `domSyncVersion` for every block subscriber. Relies on core's stable decoration identity (SCALE2).
- 879773c: A native text-entry control nested in the editor root keeps its focus (HOST9). Typing in host chrome such as an inline prompt no longer pulls the caret back into the field.
- Updated dependencies [ab64f16]
  - @input/pen-core@0.2.1
  - @input/pen-shortcuts@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Minor Changes

- e9a3129: Map a container's selection around the block when nested children supply the only inline content, and walk visible nested blocks for document-edge caret so Cmd+Down in an opened quote lands in the last nested paragraph instead of selecting the container. A decoration change on an expanded multi-block surface no longer collapses the cross-block selection into each rebuilt block: element-local selection preservation declines when an endpoint lies outside the element, and the selection is projected back from the editor after the rebuild.

### Patch Changes

- e9a3129: A native text-entry control outside the editor keeps its focus (HOST9). While one owns focus, an authority selection write — including `setSelection(null)` — is recorded but not projected into the DOM, and a decoration change that rebuilds the active field no longer writes the selection back into it; both previously pulled focus out of the host's own input and into the editor. Gesture and programmatic projections still project. `FieldEditorDomController` gains an optional `shouldProjectSelectionAfterReconcile()` that the single-field backends consult before restoring the caret after a decoration rebuild.
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-shortcuts@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- 7fb7864: Replace, delete, format, and move the caret through text in nested container children, not only top-level `blockOrder`.
- 46a28ab: Paint the native selection for a text range whose endpoint sits on a block with no inline content, such as a divider or a host's sealed region. The `0..1` unit extent (N2) now maps to the DOM points around the block element, so select-all over such a tail no longer leaves the previous caret on screen while the authority holds a document-wide range (O4).
- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-shortcuts@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- d4246d2: Skip selection projection while a native text input outside the editor owns focus so host fields like composer To keep the caret.
- 15a7820: Target the adjacent line's vertical midpoint for caret up/down so ArrowUp in a full-width RTL field does not stay on the current block.
- ff491c2: Fix the a11y focus sink drawing a visible focus ring when a block or cell selection is active.
- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-shortcuts@0.1.8

## 0.1.7

### Patch Changes

- 56a7f6e: Adopt a default editor chrome stylesheet from PenEditor, EditorRoot, and mountEditor so an empty field fills its block and focus stays visible without host CSS. Opt out with chrome={false}.
- @input/pen-core@0.1.7
  - @input/pen-shortcuts@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Cut and image drop close the undo capture window the same way paste already does. `clipboardFacet` now merges paste-importer tables (last-wins per key) so multiple providers compose, and the starter HTML clipboard contributes through that facet instead of `assignSlot`.
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-shortcuts@0.1.6

## 0.1.5

### Erratum (2026-10)

The clipboard change below was breaking under API7 and should have shipped as `minor`, not `patch`. Commit `9e83fed1` downgraded its changeset to keep the 0.1.x train on 0.1.5.

- c926c5e (clipboard): the Pen JSON clipboard flavor now carries inline-atom embed inserts, and paste rebuilds them. Host action: a host that reads or writes that flavor must accept embed inserts in its deltas.

### Patch Changes

- c926c5e: Keep inline atoms in sliced Pen JSON clipboard deltas and rebuild them on paste (IOP7). Add optional `InlineSchema.serialize.toText` and emit atom interchange text through the existing `toMarkdown` / `toHTML` hooks, defaulting to skip when none are set (IOP8).

  Copy now writes embed inserts into the Pen JSON flavor and paste rebuilds them, so an existing host that read or wrote that flavor sees a different clipboard payload. `toText` on `@input/pen-types` is an optional hook. Kept as `patch` so the 0.1.x train stays on `0.1.5`.

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-shortcuts@0.1.5

## 0.1.4

### Erratum (2026-10)

Both changes below changed host-visible behaviour and should have shipped as `minor`, not `patch` (API7).

- 9fdb74d (HOST8/HOST9): block-selection Enter now bubbles instead of being handled on document capture, and DOM focus moves to the editor sink while a block or cell is selected. Host action: a host that relied on capture-phase Enter, or on focus staying on `document.body`, must listen on the editor element instead.
- 9fdb74d (FE10): a drag that starts in host chrome beside the column now creates a text selection. Host action: a host that expected a background drag to leave the selection unchanged must update that expectation.

### Patch Changes

- 9fdb74d: Yield block-selection Enter to the host (HOST8) and keep DOM focus on the editor sink while a block or cell is selected (HOST9). Enter is now a bubbling default like Escape, so a listener on the editor element can preventDefault first; hosts that relied on document-capture Enter will see the key reach the subtree. Focus is parked on the sink in the same selectionChange turn so two composers in one document no longer race for a body-targeted Enter.
- 9fdb74d: Start a pointer selection from host chrome (FE10). A drag whose mousedown lands beside the column — the content element's padding, or the editor root next to it — now anchors at the nearest block edge (G4) and selects, across blocks or within one, instead of leaving a collapsed caret. Within one block it resolves the range itself, because a drag that never entered a field has no native range to inherit. Clicks are unchanged: a host-chrome gesture that never reached a block still finishes on the click path, so the click-outside affordance keeps owning insert-or-focus. A host asserting that a drag from the background leaves the selection untouched will now see a text selection; a marquee still requires the region-selector primitive and still respects `blockSelection={false}`.
- @input/pen-core@0.1.4
  - @input/pen-shortcuts@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- 7ee119d: Render all three colour marks (`textColor`, `backgroundColor`, `highlight`) through a `var()` fallback and `data-color`, so on-screen colour paints by default and hosts can remap opaque tokens without `!important` (RI7). `textColor` and `backgroundColor` previously fell through to the unknown-mark span and dropped the stored colour entirely.

  The paint is an inline style: a host rule that set `color` or `background-color` on the mark itself used to apply and no longer does. Set `--pen-text-color`, `--pen-background-color`, or `--pen-highlight-color` on the mark instead — see `STYLING.md`. Export and clipboard HTML are unaffected; both come from `schema.serialize.toHTML` and still carry the stored value. Kept as `patch` so the 0.1.x train stays on `0.1.3`.

- 15ffd4e: On A5 mapped `selectionChange` after `editor.apply`, drop leftover `edit-context-textupdate` authority and project the remapped caret into EditContext (FE9), so the next keystroke inserts at the remapped offset instead of clamping or landing in the wrong place.
- 15ffd4e: Yield the document Escape selection ladder to capture-phase overlays (HOST7). The ladder is now a bubbling default, so a later-mounted menu or host chrome can preventDefault first instead of leaving trigger text behind as a block selection.
- @input/pen-core@0.1.3
  - @input/pen-shortcuts@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- e80fedc: Recognize container blocks from the schema and give every surface a children outlet.

  A host-defined container could hold children that no surface rendered. Container-ness was a hardcoded `new Set(["toggle", "callout", "blockquote"])` repeated in the DOM document tree, the DOM navigation utilities, two core command modules, and the React and Vue block renderers, so a host block declaring nested content was recognized by the document model, accepted by `editor.apply`, persisted by the CRDT, and then dropped at render. Nothing reported it: the children existed, `parentOf` resolved, and the block rendered as if empty.

  Containment is now declared. `isContainerBlock` (`@input/pen-core`) treats nested `content` or an explicit `isContainer: true` as containment, `isContainerBlockType` (`@input/pen-core`) resolves it for a block type, and `blockquote`, `callout`, and `toggle` carry the flag rather than being named in the renderers.

  Reading children needed one lookup, because there are two nesting routes and each hid the other. A block's `children` array holds children that are deliberately absent from `blockOrder`; the `parentId` prop holds children that sit in `blockOrder` as siblings. The old helper filtered `blockOrder` on `parentId`, so it could not see children-array children at all. `DocumentState.childrenOf(blockId)` is now the inverse of `parentOf` and covers both, returning children-array order first and `parentId` children in `blockOrder` sequence, backed by an index built in the same `rebuild()` pass that already builds the parent index.

  Each surface exposes one outlet. React gains `Pen.Editor.BlockChildren`, which was the missing half — Vue already passed `ctx.childNodes` to every renderer and the vanilla path already built a children host, so React was the only surface where a custom container renderer had no way to mount its children. Collapse stays the renderer's decision through `shouldRenderContainerChildren`, which reads resolved rather than stored props (`open !== false`), so a container whose `open` defaults to `false` stays collapsed once normalization strips that default from storage — `toggle`'s exact shape, and the reason the predicate cannot read raw storage. DOM navigation calls the same predicate, so keyboard traversal and rendering agree about what is visible.

  Nothing is removed. `@input/pen-dom`'s `getParentIdChildBlockIds` is renamed `getChildBlockIds` on the `./utils/parentIdTree` subpath, since it no longer looks at `parentId`, and the old name stays as a deprecated alias so 0.1.x consumers of that subpath keep working. `@input/pen-vue` picks up children-array support through the same helper with no API change.

  One gap stays stated rather than fixed (`spec/rules/dom.md` RI6): a `parentId` naming a non-container renders nowhere, because `getRootBlockIds` drops every block that has a parent while a non-container is given no children host.

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-shortcuts@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix collaborator carets staying pinned in place while the document scrolls.

  `GeometryReader` caches caret and range rects per block, keyed by the block's commit id plus the viewport-resize and font-load generations (G2). Those rects come from `Range.getClientRects()` and `getBoundingClientRect()`, so they are viewport-relative — and scrolling changed none of the three key parts. After a scroll the reader kept returning the coordinates measured before it, and overlays that paint at those coordinates stayed where they were. `Pen.Multiplayer.CaretOverlay` showed this most clearly: a peer's caret and name label sat at a fixed spot on screen while their block moved away underneath. `Pen.Editor.CaretOverlay` and the selection-rect overlay read through the same cache and drifted the same way.

  The G2 key now carries a scroll generation, bumped by a capture-phase `scroll` listener on the root's document — capture because `scroll` does not bubble, and a scroller nested inside the editor moves cached rects just as an ancestor one does. A scroll in a container that neither contains nor is contained by the root cannot move the root, so it leaves the cache warm. `GeometryReaderOptions.observeScroll` opts out, alongside the existing `observeResize` and `observeFonts`.

  `dispose()` removes the listener, and because nothing calls `dispose()` in production today the listener also drops itself the first time it fires with a disconnected root. A document-level listener that only waited for `dispose()` would keep every unmounted editor root and its cache reachable.

- d67b176: Show collaborators inside tables.

  A peer editing a table was invisible. `buildLocalAwarenessState` only recognised text and block selections, so a `CellSelection` fell through to `{ cursor: null, selection: null }` and nothing was published — and nothing downstream knew cells existed either, since `RemoteSelectionState` had no cell member.

  Cell selections now travel as `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and no cursor: a grid cell is the smallest region this presence names, so there is no caret to place, and coordinates rather than anchors match AS3's structural treatment of the local cell selection. COL2 validates them against the live grid — a cell on a block that holds no grid, or a row or column outside it, is rejected at ingest with the new `out-of-range-cell` reason — and resolve re-reads the grid on every commit so a peer whose rows were deleted under them clamps onto a live cell instead of vanishing.

  `@input/pen-react`'s table renderer marks the occupied cells with `data-pen-multiplayer-cell-selection`, the peer's head cell with `data-pen-multiplayer-cell-head`, and sets the caret overlay's `--pen-peer-color` on each. Because these come from the renderer rather than a presence decoration, they can carry a colour at all: SEC2 drops `style` from decoration attributes, so presence decorations emit none and every other surface is coloured from `data-user-id`. Hosts rendering their own grid can resolve the same mapping with `resolveRemoteCellPresence`, new on `@input/pen-dom/utils/remoteCellSelection` and re-exported from `@input/pen-react`.

  Both `RemoteSelectionState` and `PresenceRejectionReason` gain a member, so an exhaustive `switch` over either needs a new arm.

- 2f9bbe2: Fix the caret briefly showing at its previous position after a mouse click in Chromium.

  Clicking inside the block that already held the caret moved the caret to the old position for the whole time the button was held, then jumped it to the click point on release. Measured on a 90ms hold, the caret rendered at the stale position for 10 of the 11 frames. Clicking into a different block, or into a document with no caret yet, was unaffected — which is why it read as intermittent.

  `EditContextBackend` treats a collapsed DOM selection that disagrees with the authority as a stale echo of its own `updateSelection` write and restores the authority caret. That is the right reading of a divergence nobody asked for, but it was applied unconditionally, including to the `selectionchange` the browser fires when the user clicks — the pointer window is open, the authority still holds the pre-click caret, and the two look identical to the guard. The restore beat the reader's proposal, so the DOM was dragged back to the old caret and only the pointer-settled projection put it right.

  The guard now defers to gesture-window admissibility, matching `spec/rules/selection.md` R3 and the reader algorithm's step 4/5 split: with a window open the proposal is user intent and the reader owns it, so the guard stands down. It consults `isAdmissibleGestureRead()`, the same predicate the reader uses to choose between accepting and diverging, rather than approximating that decision a second time — and the same check `reconcilerFull` already uses to hold off divergence projection during a gesture. `@input/pen-react` gains a regression test covering the same-block click.

  This narrows the guard to the closed-window case; it does not make that case correct. A backend that answers divergence by writing the DOM selection itself still sidesteps the projector, which S1 makes the only component allowed to write it and which P2 routes divergence through so the write is verified and a mismatch is reported. Closing that properly means replacing the restore with a divergence-projection request and folding this predicate onto the stamp-based one the projection controller already owns, which is left to the bridge redesign that `spec/rules/selection.md` and `spec/packages/rendering/dom.md` already flag.

- 2f9bbe2: Fix soft breaks rendering as spaces, so a `\n` in a block's text shows up as a line break.

  `pen.insertLineBreak` (Shift+Enter) stores a `\n` in the block's own text, and the markdown ingest keeps single newlines inside a paragraph. Nothing rendered them: text entry surfaces inherited CSS's initial `white-space: normal`, so the browser collapsed every stored newline — and every run of repeated spaces — into a single space. The character was still in the document, still counted by undo and delete, and still exported, but it was invisible on screen and the caret would not move onto it. AI writing showed this most sharply, because the streaming preview renders on a surface that already set `pre-wrap`: text appeared with its line breaks while it streamed and lost them the moment it was applied.

  `white-space: pre-wrap` is now a library-authored inline style on the inline content host and on every table cell content host, in all three renderers, alongside RI1's `unicode-bidi: isolate` and for the same reason. This is correctness rather than taste and is deliberately not overridable by host CSS: a surface that renders its own stored characters incorrectly is not a theme, and HOST6 requires an editor with no host stylesheet to be functional.

  `pre-wrap` honors an interior newline but gives a trailing one no line box, so a field whose text ends with `\n` also gets a trailing `<br>`, maintained by both reconcile paths. Like the empty-block placeholder it is marked (`data-pen-trailing-break`) and contributes no logical length and no logical text, so offset mapping and the DOM/`Y.Text` watchdog read straight through it and it never becomes document content.

  Two consequences for hosts. Ordinary host CSS setting `white-space` on `[data-pen-inline-content]` or a cell content host no longer wins, because an inline style beats a stylesheet rule; a host that genuinely needs another value — a code block wanting `white-space: pre` with horizontal scroll is the real case — needs `!important`. And a field whose text ends with `\n` now has one more child element, which host selectors like `:last-child` or `> *` and any host code walking the surface's children will see.

- 49ff006: Fix the slash menu leaving its trigger text in the document.

  Confirming an entry only deleted the trigger when the block held a lone `/`. Any query took the sibling-insert branch instead, so picking Table after typing `/ta` left a `/ta` paragraph above the new table — the block the author was converting survived as litter. It was also AX3-visible: `getSlashTarget` matches any block whose text starts with `/`, so the listbox reopened as soon as selection returned to the leftover paragraph.

  `confirm` now deletes the whole trigger range — `/` and query together, read from the live document — in the same undo group that installs the chosen block, and decides its shape from what is left over: nothing left means the trigger was the whole block, so the block is converted in place; text left over (a caret parked mid-word, or a confirm with no trigger, which is how a host-supplied `SlashMenu.Input` drives the hook) keeps its block and inserts the chosen type as a sibling.

- d67b176: Fix Cmd+Backspace clearing a line visually while the document kept the text.

  On macOS, `Cmd+Backspace` cleared the field and the next keystroke brought the deleted text back. Two gaps lined up. The default keymap bound `Cmd-ArrowLeft` to line motion but never bound `Cmd-Backspace` to the matching delete, so the key fell through to the browser; and the EditContext backend listened only for `textupdate`, so nothing else was watching. Chromium does not route line-granularity deletes through an attached EditContext — it runs them as plain DOM edits against the editing host — so the field emptied while the document still held all eleven characters. The next reconcile repainted the model over the DOM, and the text reappeared.

  The keymap now binds `Cmd-Backspace` (delete to line start) and `Ctrl-k` (delete to line end) on macOS, matching that platform's line motion. Windows and Linux are unchanged; they have no line-delete convention.

  The EditContext backend now runs the B1 `beforeinput` policy as a floor, so an editing intent the EditContext never reports is still claimed by the document rather than left to rewrite the field. The rows Chromium does deliver as `textupdate` — `insertText`, `insertReplacementText`, and the composition types — stay allowed there and only there, because preventing their default cancels the `textupdate` with it and loses the keystroke. Anything unrecognised is prevented and reported as `unhandled-input-type` instead of silently editing the DOM.

  `deleteSoftLineForward` and `deleteHardLineForward` were missing from the shared `beforeinput` table and are now mapped alongside their backward counterparts, so `Ctrl-k` is handled on the contenteditable and expanded backends too.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-shortcuts@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The framework-free DOM engine for Pen: field editors (EditContext and contenteditable backends), the selection bridge, key handling, clipboard and transfer, reconciliation, and overlays.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-shortcuts@0.1.0
