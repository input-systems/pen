# @input/pen-react

## 0.3.0

### Minor Changes

- 4d1c512: List items are announced as lists (AX1), numbering follows the announced list, and focus returns to its invoker by primitive class (AX3).

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

- 55f100d: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

- 4d1c512: Pen draws carets, remote carets and block outlines into one overlay layer per editor root, which the DOM scheduler paints. React's caret overlays are now bindings over it, and Vue gets the overlay with no component.

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

### Patch Changes

- 4d1c512: Accessibility, iframe and binding fixes:

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

- 4d1c512: AI write attribution, undo grouping and review preview fixes:

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

- 4d1c512: Selection, focus and pointer fixes across React, Vue and vanilla `mountEditor`:

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

- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
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
- Updated dependencies [4d1c512]
  - @input/pen-dom@0.3.0
  - @input/pen-types@0.3.0
  - @input/pen-ai@0.3.0
  - @input/pen-core@0.3.0
  - @input/pen-multiplayer@0.3.0
  - @input/pen-search@0.3.0
  - @input/pen-interop@0.3.0
  - @input/pen-schema@0.3.0
  - @input/pen-shortcuts@0.3.0
  - @input/pen-snapshots@0.3.0

## 0.2.14

### Patch Changes

- Updated dependencies [b416b6d]
  - @input/pen-interop@0.2.14
  - @input/pen-core@0.2.14
  - @input/pen-ai@0.2.14
  - @input/pen-multiplayer@0.2.14
  - @input/pen-search@0.2.14
  - @input/pen-shortcuts@0.2.14
  - @input/pen-snapshots@0.2.14
  - @input/pen-dom@0.2.14
  - @input/pen-schema@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [bbf8fe9]
- Updated dependencies [8e2654b]
- Updated dependencies [9032a68]
  - @input/pen-dom@0.2.13
  - @input/pen-core@0.2.13
  - @input/pen-multiplayer@0.2.13
  - @input/pen-search@0.2.13
  - @input/pen-ai@0.2.13
  - @input/pen-interop@0.2.13
  - @input/pen-shortcuts@0.2.13
  - @input/pen-snapshots@0.2.13
  - @input/pen-schema@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- 6197b8c: Position the editor caret overlay against its overlay root instead of the viewport so filtered or transformed ancestors do not trap the caret.
- 859910e: Preserve HTML block structure, blank-line spacing, inline marks, lists, and text alignment when pasting formatted HTML.
- Updated dependencies [eeb5eb2]
- Updated dependencies [859910e]
  - @input/pen-ai@0.2.12
  - @input/pen-interop@0.2.12
  - @input/pen-schema@0.2.12
  - @input/pen-dom@0.2.12
  - @input/pen-multiplayer@0.2.12
  - @input/pen-search@0.2.12
  - @input/pen-shortcuts@0.2.12
  - @input/pen-snapshots@0.2.12
  - @input/pen-core@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- 77e2cda: Add horizontal alignment control to selection toolbars so hosts can anchor them to stable selection edges, and resolve live selection geometry during pre-paint placement.
- 22f354e: Make editor roots a single tab stop that transfers keyboard focus into the active text or selection surface, and keep nested toggle controls at an accessible target size.
- Updated dependencies [22f354e]
  - @input/pen-dom@0.2.11
  - @input/pen-core@0.2.11
  - @input/pen-ai@0.2.11
  - @input/pen-interop@0.2.11
  - @input/pen-multiplayer@0.2.11
  - @input/pen-search@0.2.11
  - @input/pen-shortcuts@0.2.11
  - @input/pen-snapshots@0.2.11
  - @input/pen-schema@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- Updated dependencies [cbe4112]
  - @input/pen-ai@0.2.10
  - @input/pen-core@0.2.10
  - @input/pen-interop@0.2.10
  - @input/pen-multiplayer@0.2.10
  - @input/pen-search@0.2.10
  - @input/pen-shortcuts@0.2.10
  - @input/pen-snapshots@0.2.10
  - @input/pen-dom@0.2.10
  - @input/pen-schema@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- Updated dependencies [8c4116f]
  - @input/pen-ai@0.2.9
  - @input/pen-core@0.2.9
  - @input/pen-interop@0.2.9
  - @input/pen-multiplayer@0.2.9
  - @input/pen-search@0.2.9
  - @input/pen-shortcuts@0.2.9
  - @input/pen-snapshots@0.2.9
  - @input/pen-dom@0.2.9
  - @input/pen-schema@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies [9b0dcd2]
  - @input/pen-ai@0.2.8
  - @input/pen-core@0.2.8
  - @input/pen-interop@0.2.8
  - @input/pen-multiplayer@0.2.8
  - @input/pen-search@0.2.8
  - @input/pen-shortcuts@0.2.8
  - @input/pen-snapshots@0.2.8
  - @input/pen-dom@0.2.8
  - @input/pen-schema@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [d12e779]
  - @input/pen-ai@0.2.7
  - @input/pen-core@0.2.7
  - @input/pen-interop@0.2.7
  - @input/pen-multiplayer@0.2.7
  - @input/pen-search@0.2.7
  - @input/pen-shortcuts@0.2.7
  - @input/pen-snapshots@0.2.7
  - @input/pen-dom@0.2.7
  - @input/pen-schema@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [ba82d14]
- Updated dependencies [a2e17a8]
- Updated dependencies [dcd1573]
  - @input/pen-dom@0.2.6
  - @input/pen-ai@0.2.6
  - @input/pen-core@0.2.6
  - @input/pen-interop@0.2.6
  - @input/pen-multiplayer@0.2.6
  - @input/pen-schema@0.2.6
  - @input/pen-search@0.2.6
  - @input/pen-shortcuts@0.2.6
  - @input/pen-snapshots@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies [f792d89]
  - @input/pen-dom@0.2.5
  - @input/pen-core@0.2.5
  - @input/pen-ai@0.2.5
  - @input/pen-interop@0.2.5
  - @input/pen-multiplayer@0.2.5
  - @input/pen-search@0.2.5
  - @input/pen-shortcuts@0.2.5
  - @input/pen-snapshots@0.2.5
  - @input/pen-schema@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- 4ea7542: Count content blocks, not root blocks, when deciding document placeholder eligibility (RI8). A block schema can now declare `authoring.contentRole: "chrome"` for furniture the host puts in the document — an email signature, a quoted message — and such a block no longer suppresses the empty-document placeholder or pulls a click below the blocks into itself. `getBlockContentRole` (`@input/pen-core`) is the canonical reader; `contentRole` defaults to `"content"`, so existing hosts are unaffected.

  Eligibility names its block. `getDocumentPlaceholderTargetBlockId` (`@input/pen-dom`) returns the one block the hint paints on and the click-below caret lands in, or null when there is no target. The React and Vue bindings paint on the target instead of on the first root block, so a document that opens with chrome now shows the hint on its body. `InlinePlaceholderVisibilityOptions` replaces its `isFirstBlock` and `isDocumentEmpty` fields with a single `isDocumentPlaceholderTarget`.

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4
  - @input/pen-dom@0.2.4
  - @input/pen-multiplayer@0.2.4
  - @input/pen-search@0.2.4
  - @input/pen-ai@0.2.4
  - @input/pen-interop@0.2.4
  - @input/pen-shortcuts@0.2.4
  - @input/pen-snapshots@0.2.4
  - @input/pen-schema@0.2.4

## 0.2.3

### Patch Changes

- 666e814: Keep suggestion menus anchored when their rendered content changes size.
- Updated dependencies [341d6a8]
- Updated dependencies [90e74c2]
  - @input/pen-dom@0.2.3
  - @input/pen-core@0.2.3
  - @input/pen-ai@0.2.3
  - @input/pen-interop@0.2.3
  - @input/pen-multiplayer@0.2.3
  - @input/pen-search@0.2.3
  - @input/pen-shortcuts@0.2.3
  - @input/pen-snapshots@0.2.3
  - @input/pen-schema@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- b359f9a: `Pen.Toolbar.Button` and `Pen.Toolbar.Toggle` compose a host `onClick` with their own action instead of letting it replace the action. A Slot-style wrapper that merges its `onClick` onto the element (a tooltip trigger, for example) no longer silences `onAction` / the mark toggle; the action is skipped only when the button is disabled or the host handler called `preventDefault()`.

  `resolveSelectionRect` measures a selection that spans blocks per block, so the rect covers the selected text rather than the border boxes of the blocks it fully covers. `useSelectionToolbar` reads that rect first for spanning selections; the selection toolbar sits over the text instead of centring on the column.

- Updated dependencies [b359f9a]
- Updated dependencies [b359f9a]
  - @input/pen-dom@0.2.2
  - @input/pen-core@0.2.2
  - @input/pen-multiplayer@0.2.2
  - @input/pen-search@0.2.2
  - @input/pen-ai@0.2.2
  - @input/pen-interop@0.2.2
  - @input/pen-shortcuts@0.2.2
  - @input/pen-snapshots@0.2.2
  - @input/pen-schema@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [879773c]
- Updated dependencies [ab64f16]
- Updated dependencies [1c57d72]
- Updated dependencies [879773c]
  - @input/pen-ai@0.2.1
  - @input/pen-core@0.2.1
  - @input/pen-dom@0.2.1
  - @input/pen-multiplayer@0.2.1
  - @input/pen-search@0.2.1
  - @input/pen-interop@0.2.1
  - @input/pen-shortcuts@0.2.1
  - @input/pen-snapshots@0.2.1
  - @input/pen-schema@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-ai@0.2.0
  - @input/pen-dom@0.2.0
  - @input/pen-interop@0.2.0
  - @input/pen-multiplayer@0.2.0
  - @input/pen-search@0.2.0
  - @input/pen-shortcuts@0.2.0
  - @input/pen-snapshots@0.2.0
  - @input/pen-schema@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [46a28ab]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-dom@0.1.9
  - @input/pen-ai@0.1.9
  - @input/pen-multiplayer@0.1.9
  - @input/pen-search@0.1.9
  - @input/pen-interop@0.1.9
  - @input/pen-shortcuts@0.1.9
  - @input/pen-snapshots@0.1.9
  - @input/pen-schema@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
- Updated dependencies [d4246d2]
- Updated dependencies [cb50239]
- Updated dependencies [15a7820]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [ff491c2]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-dom@0.1.8
  - @input/pen-ai@0.1.8
  - @input/pen-interop@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-multiplayer@0.1.8
  - @input/pen-search@0.1.8
  - @input/pen-shortcuts@0.1.8
  - @input/pen-snapshots@0.1.8
  - @input/pen-schema@0.1.8

## 0.1.7

### Patch Changes

- 56a7f6e: Adopt a default editor chrome stylesheet from PenEditor, EditorRoot, and mountEditor so an empty field fills its block and focus stays visible without host CSS. Opt out with chrome={false}.
- Updated dependencies [56a7f6e]
  - @input/pen-dom@0.1.7
  - @input/pen-core@0.1.7
  - @input/pen-ai@0.1.7
  - @input/pen-interop@0.1.7
  - @input/pen-multiplayer@0.1.7
  - @input/pen-search@0.1.7
  - @input/pen-shortcuts@0.1.7
  - @input/pen-snapshots@0.1.7
  - @input/pen-schema@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-interop@0.1.6
  - @input/pen-core@0.1.6
  - @input/pen-dom@0.1.6
  - @input/pen-ai@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-multiplayer@0.1.6
  - @input/pen-search@0.1.6
  - @input/pen-shortcuts@0.1.6
  - @input/pen-snapshots@0.1.6
  - @input/pen-schema@0.1.6

## 0.1.5

### Patch Changes

- 67bf230: Keep `InlineAtomRenderInteractionProps` imported in the published `@input/pen-react` declarations so `InlineAtomRenderProps.interaction` type-checks with `skipLibCheck: false`.
- c926c5e: Mount inline-atom portal renderers with `createElement` so host renderers that call hooks keep a stable hook order when an atom appears after the first paint.
- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-schema@0.1.5
  - @input/pen-dom@0.1.5
  - @input/pen-ai@0.1.5
  - @input/pen-multiplayer@0.1.5
  - @input/pen-search@0.1.5
  - @input/pen-shortcuts@0.1.5
  - @input/pen-snapshots@0.1.5
  - @input/pen-interop@0.1.5

## 0.1.4

### Patch Changes

- 9fdb74d: Yield block-selection Enter to the host (HOST8) and keep DOM focus on the editor sink while a block or cell is selected (HOST9). Enter is now a bubbling default like Escape, so a listener on the editor element can preventDefault first; hosts that relied on document-capture Enter will see the key reach the subtree. Focus is parked on the sink in the same selectionChange turn so two composers in one document no longer race for a body-targeted Enter.
- Updated dependencies [9fdb74d]
- Updated dependencies [9fdb74d]
  - @input/pen-dom@0.1.4
  - @input/pen-core@0.1.4
  - @input/pen-ai@0.1.4
  - @input/pen-interop@0.1.4
  - @input/pen-multiplayer@0.1.4
  - @input/pen-search@0.1.4
  - @input/pen-shortcuts@0.1.4
  - @input/pen-snapshots@0.1.4
  - @input/pen-schema@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- 15ffd4e: Yield the document Escape selection ladder to capture-phase overlays (HOST7). The ladder is now a bubbling default, so a later-mounted menu or host chrome can preventDefault first instead of leaving trigger text behind as a block selection.
- 7ee119d: Forward host `extraAttributes` and `data-*` through numbered list items onto `ListItemLayout` so composed renderers can paint alignment and other attributes without dropping the ordered-list marker or `start` (HB8). Export `ListItemHostAttributes` as the host-facing shape for cloning a default list-item renderer.

  `ListItemLayout` now writes host attributes before its own, so a host can no longer overwrite `data-block-type`, `data-indent`, `data-selected`, `data-pen-list-item-layout`, `data-counter`, or `data-checked`. This also fixes check list items, where a host `extraAttributes` replaced the renderer's prop wholesale and silently dropped `data-checked`.

- Updated dependencies [7ee119d]
- Updated dependencies [15ffd4e]
- Updated dependencies [15ffd4e]
  - @input/pen-dom@0.1.3
  - @input/pen-core@0.1.3
  - @input/pen-ai@0.1.3
  - @input/pen-interop@0.1.3
  - @input/pen-multiplayer@0.1.3
  - @input/pen-search@0.1.3
  - @input/pen-shortcuts@0.1.3
  - @input/pen-snapshots@0.1.3
  - @input/pen-schema@0.1.3
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
  - @input/pen-schema@0.1.2
  - @input/pen-dom@0.1.2
  - @input/pen-ai@0.1.2
  - @input/pen-interop@0.1.2
  - @input/pen-multiplayer@0.1.2
  - @input/pen-search@0.1.2
  - @input/pen-shortcuts@0.1.2
  - @input/pen-snapshots@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix a collaboration crash where a peer's block selection unmounted the editor.

  `mergeBlockDecorationAttributes` in `@input/pen-react` turned a block decoration's attribute bag into props on the block host without the SEC2 skip that `applyElementAttributes` applies to inline decorations. `@input/pen-multiplayer` puts a `style` attribute on remote presence decorations, so a peer selecting a block sent a CSS string into a React `style` prop and React threw out of the commit phase, taking the editor's root with it. The React helper now skips `/^on/i`, `style`, and `dangerouslySetInnerHTML`, the last of which crashed the same way and is a markup sink only a React prop can reach. Dropping `style` also keeps RI1's `unicode-bidi: isolate` on the block host. `createRemotePresenceAttributes` no longer emits the `style` attribute that every conforming renderer discarded: style presence through `data-user-id`, and peer caret colour still comes from `RemoteCursorState.user.color`.

- d67b176: Show collaborators inside tables.

  A peer editing a table was invisible. `buildLocalAwarenessState` only recognised text and block selections, so a `CellSelection` fell through to `{ cursor: null, selection: null }` and nothing was published — and nothing downstream knew cells existed either, since `RemoteSelectionState` had no cell member.

  Cell selections now travel as `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and no cursor: a grid cell is the smallest region this presence names, so there is no caret to place, and coordinates rather than anchors match AS3's structural treatment of the local cell selection. COL2 validates them against the live grid — a cell on a block that holds no grid, or a row or column outside it, is rejected at ingest with the new `out-of-range-cell` reason — and resolve re-reads the grid on every commit so a peer whose rows were deleted under them clamps onto a live cell instead of vanishing.

  `@input/pen-react`'s table renderer marks the occupied cells with `data-pen-multiplayer-cell-selection`, the peer's head cell with `data-pen-multiplayer-cell-head`, and sets the caret overlay's `--pen-peer-color` on each. Because these come from the renderer rather than a presence decoration, they can carry a colour at all: SEC2 drops `style` from decoration attributes, so presence decorations emit none and every other surface is coloured from `data-user-id`. Hosts rendering their own grid can resolve the same mapping with `resolveRemoteCellPresence`, new on `@input/pen-dom/utils/remoteCellSelection` and re-exported from `@input/pen-react`.

  Both `RemoteSelectionState` and `PresenceRejectionReason` gain a member, so an exhaustive `switch` over either needs a new arm.

- 2f9bbe2: Fix soft breaks rendering as spaces, so a `\n` in a block's text shows up as a line break.

  `pen.insertLineBreak` (Shift+Enter) stores a `\n` in the block's own text, and the markdown ingest keeps single newlines inside a paragraph. Nothing rendered them: text entry surfaces inherited CSS's initial `white-space: normal`, so the browser collapsed every stored newline — and every run of repeated spaces — into a single space. The character was still in the document, still counted by undo and delete, and still exported, but it was invisible on screen and the caret would not move onto it. AI writing showed this most sharply, because the streaming preview renders on a surface that already set `pre-wrap`: text appeared with its line breaks while it streamed and lost them the moment it was applied.

  `white-space: pre-wrap` is now a library-authored inline style on the inline content host and on every table cell content host, in all three renderers, alongside RI1's `unicode-bidi: isolate` and for the same reason. This is correctness rather than taste and is deliberately not overridable by host CSS: a surface that renders its own stored characters incorrectly is not a theme, and HOST6 requires an editor with no host stylesheet to be functional.

  `pre-wrap` honors an interior newline but gives a trailing one no line box, so a field whose text ends with `\n` also gets a trailing `<br>`, maintained by both reconcile paths. Like the empty-block placeholder it is marked (`data-pen-trailing-break`) and contributes no logical length and no logical text, so offset mapping and the DOM/`Y.Text` watchdog read straight through it and it never becomes document content.

  Two consequences for hosts. Ordinary host CSS setting `white-space` on `[data-pen-inline-content]` or a cell content host no longer wins, because an inline style beats a stylesheet rule; a host that genuinely needs another value — a code block wanting `white-space: pre` with horizontal scroll is the real case — needs `!important`. And a field whose text ends with `\n` now has one more child element, which host selectors like `:last-child` or `> *` and any host code walking the surface's children will see.

- d67b176: Fix the slash menu inserting the wrong block type.

  `Pen.SlashMenu.List` in auto mode regrouped `items` by `display.group` and handed each option a counter that restarted from the grouped order, while `confirm(index)`, `select(index)`, and `selectedIndex` all index the flat `items` array from `useSlashMenu`. Any schema whose groups are not contiguous in registration order made the two orders disagree, and the default schema is one: it registers `bulletListItem`, `numberedListItem`, and `checkListItem` between `heading` and `codeBlock`, so `basic` resumes after `lists` has started. Choosing Code Block inserted a bullet list, Divider inserted a numbered list, and Quote inserted an image. Arrow-key navigation moved the active option through the flat order too, so the highlight jumped around the rendered list and `aria-activedescendant` named an option other than the visible one, against AX3.

  `useSlashMenu` now returns items already partitioned by group, so the order the menu navigates is the order it renders, and the query path groups after its relevance sort so the closest match stays at index 0. The list builds group headings by breaking consecutive runs instead of regrouping, which means every option carries its real index in `items` and a list that ever saw an ungrouped array would repeat a heading rather than resolve the wrong block.

  The ordering itself is DOM-free and now ships from `@input/pen-core` as `orderSlashMenuItemsByGroup` and `slashMenuGroupOf`, next to `shouldShowBlockInDefaultMenus` and the `allBlockDisplays()` registry it reorders, so a second renderer's slash menu inherits the invariant instead of reimplementing it (API6).

- 49ff006: Fix the slash menu leaving its trigger text in the document.

  Confirming an entry only deleted the trigger when the block held a lone `/`. Any query took the sibling-insert branch instead, so picking Table after typing `/ta` left a `/ta` paragraph above the new table — the block the author was converting survived as litter. It was also AX3-visible: `getSlashTarget` matches any block whose text starts with `/`, so the listbox reopened as soon as selection returned to the leftover paragraph.

  `confirm` now deletes the whole trigger range — `/` and query together, read from the live document — in the same undo group that installs the chosen block, and decides its shape from what is left over: nothing left means the trigger was the whole block, so the block is converted in place; text left over (a caret parked mid-word, or a confirm with no trigger, which is how a host-supplied `SlashMenu.Input` drives the hook) keeps its block and inserts the chosen type as a sibling.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [2f9bbe2]
- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [49ff006]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-dom@0.1.1
  - @input/pen-multiplayer@0.1.1
  - @input/pen-ai@0.1.1
  - @input/pen-search@0.1.1
  - @input/pen-snapshots@0.1.1
  - @input/pen-interop@0.1.1
  - @input/pen-shortcuts@0.1.1
  - @input/pen-schema@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. React primitives, hooks, and renderers for Pen, bound to the shared DOM engine.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-dom@0.1.0
  - @input/pen-ai@0.1.0
  - @input/pen-interop@0.1.0
  - @input/pen-shortcuts@0.1.0
  - @input/pen-multiplayer@0.1.0
  - @input/pen-schema@0.1.0
  - @input/pen-search@0.1.0
  - @input/pen-snapshots@0.1.0
